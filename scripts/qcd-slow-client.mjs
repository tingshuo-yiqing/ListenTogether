#!/usr/bin/env node
/**
 * QC-D 慢客户端：①单成员以 20 条/秒刷聊天（高于聊天配额 5/10s、低于 100 条/秒硬保护）
 * ——应收到 429（带 retryAfterMs）而连接保持，停手后可正常同步；其他成员全程不受影响。
 * ②10 名成员把历史灌满 100 条长消息（各 500 码点中文），新成员入房收分块快照并完整重组，
 * 再经 fault-proxy 延迟模拟慢网断开重连，重组结果必须与重连前一致（不误踢、不缺块）。
 *
 * 用法：node scripts/qcd-slow-client.mjs [--media .workbuddy/qcd-fixture-1000] [--keep-proxy]
 * 前置：cd server && npm run build；fault-proxy 由脚本自起（端口 3102 → 3101）。
 * 退出码：0=断言全过；1=有失败。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { argv, exit } from 'node:process'

const require2 = createRequire(pathToFileURL(fileURLToPath(new URL('../server/package.json', import.meta.url))))
const WebSocket = require2('ws')

function argOf(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const media = argOf('--media', '.workbuddy/qcd-fixture-1000')
const keepProxy = argv.includes('--keep-proxy')
const API = 'http://127.0.0.1:3101'
const PROXY = 'http://127.0.0.1:3102'
const V2 = { 'x-listentogether-protocol': '2' }
const say = obj => console.log(JSON.stringify(obj))

const server = spawn(process.execPath, ['server/dist/index.js'], { env: { ...process.env, MEDIA_DIR: media, PORT: '3101', HOST: '127.0.0.1' }, stdio: 'ignore' })
const proxy = spawn(process.execPath, ['scripts/fault-proxy.mjs', '--port', '3102', '--target', 'http://127.0.0.1:3101'], { stdio: 'ignore' })
async function waitHealthy(url) {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(url + '/health'); if (r.ok) return } catch { /* 未就绪 */ } await new Promise(r => setTimeout(r, 200)) }
  throw new Error('等待服务超时：' + url)
}
await waitHealthy(API); await waitHealthy(PROXY)
const teardown = () => { if (!keepProxy) proxy.kill(); server.kill() }

function connect(base, creds, onMessage) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws/' + creds.code, { headers: { authorization: 'Bearer ' + creds.token, ...V2 } })
  ws.on('message', data => onMessage(JSON.parse(data.toString())))
  return new Promise((resolve, reject) => { ws.once('open', () => resolve(ws)); ws.once('error', reject) })
}
const join = async (name, base = API) => (await (await fetch(`${base}/api/rooms/${room.code}/join`, { method: 'POST', headers: { ...V2, 'content-type': 'application/json' }, body: JSON.stringify({ nickname: name }) })).json())

// ============ 场景①：超配额刷屏（20 条/秒 × 20 秒）============
let room
{
  room = await (await fetch(API + '/api/rooms', { method: 'POST', headers: { ...V2, 'content-type': 'application/json' }, body: JSON.stringify({ nickname: '刷屏房主' }) })).json()
  const spam = await join('刷屏成员')
  const normal = await join('正常成员A')
  const normal2 = await join('正常成员B')
  let limited = 0, other = [], spamClosed = null
  let normalBroadcasts = 0, normal429 = 0, normalErrors = []
  const wsSpam = await connect(API, spam, m => {
    if (m.type === 'error') { if (m.status === 429) { limited++; if (typeof m.retryAfterMs !== 'number') other.push('429 缺 retryAfterMs') } else other.push(m.message) }
  })
  wsSpam.on('close', code => { spamClosed = code })
  await connect(API, normal, m => { if (m.type === 'chat.message') normalBroadcasts++; if (m.type === 'error') { if (m.status === 429) normal429++; else normalErrors.push(m.message) } })
  const wsNormal2 = await connect(API, normal2, m => { if (m.type === 'error') normalErrors.push(m.message) })
  const stopAt = Date.now() + 20000
  let spamSent = 0
  const spammer = setInterval(() => {
    if (Date.now() > stopAt) { clearInterval(spammer); return }
    for (let i = 0; i < 20; i++) wsSpam.send(JSON.stringify({ type: 'chat.send', clientMessageId: randomUUID(), issuedAtMs: Date.now(), text: `刷屏 ${++spamSent}` }))
  }, 1000)
  await new Promise(r => setTimeout(r, 21000))
  say({ event: 'spam-phase', spamSent, rateLimited429: limited, otherErrors: other, spamConnectionClosed: spamClosed, normalBroadcasts, normal429, normalErrors })
  // 停手后：连接仍可用于正常同步；正常成员自己发的消息不受刷屏影响。
  const syncOk = await new Promise(resolve => {
    const on = data => { const m = JSON.parse(data.toString()); if (m.type === 'queue.state') { wsSpam.off('message', on); resolve(true) } }
    wsSpam.on('message', on); wsSpam.send(JSON.stringify({ type: 'queue.sync' })); setTimeout(() => resolve(false), 3000)
  })
  const chatAck = await new Promise(resolve => {
    const id = randomUUID()
    const on = data => { const m = JSON.parse(data.toString()); if (m.type === 'ack' && m.clientMessageId === id) { wsNormal2.off('message', on); resolve(m.ok === true) } }
    wsNormal2.on('message', on); wsNormal2.send(JSON.stringify({ type: 'chat.send', clientMessageId: id, issuedAtMs: Date.now(), text: '刷屏期间正常发言' }))
    setTimeout(() => resolve(false), 3000)
  })
  wsSpam.close(1000, 'done'); wsNormal2.close(1000, 'done')
  const pass1 = limited > 0 && spamClosed === null && syncOk && chatAck && normal429 === 0 && normalErrors.length === 0 && other.length === 0 && normalBroadcasts > 0
  say({ event: 'assert', name: '刷屏限频不误踢', pass: pass1, detail: `429=${limited} 连接保持=${spamClosed === null} 停手后sync可用=${syncOk} 他人广播收到=${normalBroadcasts} 他人429=${normal429}` })
  if (!pass1) { teardown(); exit(1) }
}

// ============ 场景②：满 100 条长消息 + 慢网重连恢复 ============
{
  // 先把聊天窗口外的旧消息清场：用全新房间。
  room = await (await fetch(API + '/api/rooms', { method: 'POST', headers: { ...V2, 'content-type': 'application/json' }, body: JSON.stringify({ nickname: '长消息房主' }) })).json()
  const senders = [ { creds: room } ]
  for (let i = 1; i < 10; i++) senders.push({ creds: await join(`长消息成员${i}`) })
  const sockets = []
  const LONG = '长'.repeat(500) // 500 码点中文 = 1500 UTF-8 字节
  let seq = 0
  for (const { creds } of senders) sockets.push(await connect(API, creds, m => { if (m.type === 'chat.message') seq = Math.max(seq, m.message.seq) }))
  // 每人 5 条/10s 配额：10 人并行 ≈5 条/秒，灌 100 条约 20 秒（含确认等待）。
  const sent = new Set()
  for (let round = 0; round < 2; round++) {
    for (let batch = 0; batch < 5; batch++) {
      // 消息恰为 500 码点上限（拼任何标签都会被 400 拒），条目身份由服务端 messageId 区分。
      for (let i = 0; i < sockets.length; i++) sockets[i].send(JSON.stringify({ type: 'chat.send', clientMessageId: randomUUID(), issuedAtMs: Date.now(), text: LONG }))
      await new Promise(r => setTimeout(r, 2300)) // 每人 5 条/11.5s，配额（5/10s）内留余量
    }
  }
  // 等 window 收满 100（服务端环形窗口只留最近 100 条）。
  for (let i = 0; i < 100 && seq < 100; i++) await new Promise(r => setTimeout(r, 200))
  say({ event: 'fill-phase', chatSeq: seq })
  // 新成员经 fault-proxy（300ms 延迟）入房：收分块快照并重组。
  await fetch(PROXY + '/__fault/delay?ms=300')
  const slow = await join('慢网成员', PROXY)
  const chunks = new Map()
  const wsSlow = await connect(PROXY, slow, m => {
    if (m.type === 'chat.snapshot') {
      const key = m.snapshotId
      if (!chunks.has(key)) chunks.set(key, { count: m.chunkCount, parts: new Map() })
      const c = chunks.get(key)
      c.parts.set(m.chunkIndex, m.messages)
    }
  })
  let reassembled = null
  for (let i = 0; i < 300; i++) {
    const ready = [...chunks.values()].find(c => c.parts.size >= c.count)
    if (ready) { reassembled = [...ready.parts.keys()].sort().flatMap(k => ready.parts.get(k)); break }
    await new Promise(r => setTimeout(r, 200))
  }
  const firstOk = Array.isArray(reassembled) && reassembled.length === 100 && reassembled.every(m => m.text.startsWith(LONG))
  // 慢网断开重连：服务端 cut 后等窗口过，再经代理重连并重新收完整快照。
  wsSlow.close(1000, 'cut')
  await fetch(PROXY + '/__fault/clear')
  const wsSlow2 = await connect(PROXY, slow, m => {
    if (m.type === 'chat.snapshot') {
      const c = chunks.get(m.snapshotId) ?? { count: m.chunkCount, parts: new Map() }
      c.count = m.chunkCount; c.parts.set(m.chunkIndex, m.messages); chunks.set(m.snapshotId, c)
    }
  })
  let reassembled2 = null
  for (let i = 0; i < 300; i++) {
    const ready = [...chunks.values()].find(c => c.parts.size >= c.count)
    if (ready) { reassembled2 = [...ready.parts.keys()].sort().flatMap(k => ready.parts.get(k)); break }
    await new Promise(r => setTimeout(r, 200))
  }
  const secondOk = Array.isArray(reassembled2) && reassembled2.length === 100 && reassembled2.map(m => m.messageId).join() === reassembled.map(m => m.messageId).join()
  const snapshotFrames = [...chunks.values()].reduce((n, c) => n + c.parts.size, 0)
  say({ event: 'recovery-phase', snapshotFrames, first100: firstOk, reconnect100Identical: secondOk, slowClosed: wsSlow2.readyState === WebSocket.CLOSED })
  wsSlow2.close(1000, 'done'); sockets.forEach(s => s.close(1000, 'done'))
  const pass2 = firstOk && secondOk && wsSlow2.readyState !== WebSocket.CLOSED
  say({ event: 'assert', name: '满 100 条长消息慢网重连恢复', pass: pass2, detail: `首连重组=${firstOk} 重连逐条一致=${secondOk} 连接保持=${wsSlow2.readyState !== WebSocket.CLOSED}` })
  if (!pass2) { teardown(); exit(1) }
}
teardown()
say({ event: 'done' })
exit(0)
