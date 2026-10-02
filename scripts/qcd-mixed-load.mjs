#!/usr/bin/env node
/**
 * QC-D 混合负载：15 名脚本成员（1 房主 + 14 成员）按配额内节奏并发点歌/聊天/校时/播放，
 * 默认 600 秒。合法请求不得被错误限频（429=0）、聊天 seq 不允许出现跳变、
 * 房主命令确认 p95 与校时 RTT 记录为规模证据；eventLoop 取自 /health（累计口径）。
 *
 * 用法：node scripts/qcd-mixed-load.mjs [--duration 600] [--members 15]
 *        [--target http://127.0.0.1:3111]   # 缺省自起本地服务端（MEDIA_DIR=--media）
 *        [--media .workbuddy/qcd-fixture-1000]
 * 前置：cd server && npm run build；夹具可用 scripts/qcd-fixture.mjs 生成。
 * 退出码：0=全部断言通过（无 429/无意外错误/seq 无跳变）；1=存在失败。
 */
import { performance } from 'node:perf_hooks'
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
const durationS = Number(argOf('--duration', '600'))
const memberCount = Math.min(Number(argOf('--members', '15')), 15)
const target = argOf('--target', '')
const media = argOf('--media', '.workbuddy/qcd-fixture-1000')
const port = Number(new URL(target || 'http://127.0.0.1:3111').port)
const base = target || `http://127.0.0.1:${port}`
const say = obj => console.log(JSON.stringify(obj))
// ±10% 抖动；聊天/队列节奏按最坏间隔校验滑动窗口配额（2600ms→最坏 2340ms ⇒ 4.3 条/10s < 5）。
const jitter = ms => ms * (0.9 + Math.random() * 0.2)
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10 }

let server = null
if (!target) {
  server = spawn(process.execPath, ['server/dist/index.js'], { env: { ...process.env, MEDIA_DIR: media, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
  say({ event: 'server-spawned', port, media })
}
const deadline = Date.now() + durationS * 1000

async function waitHealth() {
  for (let i = 0; i < 100; i++) {
    try { const res = await fetch(base + '/health'); if (res.ok) return await res.json() } catch { /* 未就绪 */ }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('服务端健康检查超时')
}

const stats = { rtt: [], chatAck: [], queueAck: [], cmdAck: [], rateLimited: 0, errors: [], seqGaps: 0, seqRegress: 0, reconnects: 0, ackTimeouts: 0, chatSeqMax: 0, eventLoop: [] }

// —— 单个成员：WS + 配额内节奏的 sync/聊天/队列循环 ——
function startMember(name, creds, isHost, trackIds) {
  const state = { ws: null, lastSeq: 0, resync: false, queueVersion: -1, queued: new Set(), chatN: 0, stopped: false }
  const pending = new Map() // id -> {at, kind}
  let clockSeq = 0
  const connect = () => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws/' + creds.code, { headers: { authorization: 'Bearer ' + creds.token, 'x-listentogether-protocol': '2' } })
    state.ws = ws
    ws.on('message', data => {
      const m = JSON.parse(data.toString())
      if (m.type === 'clock') { const p = pending.get(String(m.clientTimeMs)); if (p) { pending.delete(String(m.clientTimeMs)); stats.rtt.push(performance.now() - p.at) } }
      else if (m.type === 'ack') {
        const id = m.requestId ?? m.clientMessageId
        const p = pending.get(id)
        if (p) { pending.delete(id); const dt = performance.now() - p.at; (stats[p.kind] ??= []).push(dt) }
      } else if (m.type === 'error') {
        if (m.status === 429) stats.rateLimited++
        else stats.errors.push({ member: name, status: m.status, message: m.message, code: m.code ?? null })
      } else if (m.type === 'chat.message') {
        if (state.resync) { state.resync = false; state.lastSeq = m.message.seq } // 重连快照后的首条只重置基线
        else if (m.message.seq <= state.lastSeq) stats.seqRegress++
        else if (m.message.seq > state.lastSeq + 1) stats.seqGaps++
        state.lastSeq = Math.max(state.lastSeq, m.message.seq)
        stats.chatSeqMax = Math.max(stats.chatSeqMax, m.message.seq)
      } else if (m.type === 'state') {
        state.hasCurrent = m.track != null
        if (state.cmdSentAt !== undefined) { stats.cmdAck.push(performance.now() - state.cmdSentAt); state.cmdSentAt = undefined } // play/pause/seek 无 ack，以跟随的 state 广播为确认
      }
      else if (m.type === 'queue.state') {
        if (state.queueVersion >= 0 && m.queueVersion <= state.queueVersion) return // 乱序旧快照忽略
        state.queueVersion = m.queueVersion
        state.queueEntries = m.entries
        state.queued = new Set(m.entries.map(e => e.entryId))
      } else if (m.type === 'chat.snapshot') { state.lastSeq = Math.max(state.lastSeq, m.latestSeq); state.resync = true }
    })
    ws.on('close', () => {
      if (state.stopped || Date.now() > deadline) return
      stats.reconnects++
      setTimeout(() => { if (!state.stopped) connect() }, 1200)
    })
    return ws
  }
  connect()
  const send = obj => { if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(obj)) }
  const awaitAck = (id, kind) => new Promise(resolve => { pending.set(id, { at: performance.now(), kind }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); stats.ackTimeouts++; resolve(null) } }, 5000) })
  const loop = (fn, ms) => { const tick = async () => { if (state.stopped || Date.now() > deadline) return; try { await fn() } catch { /* 单次失败不中断 */ } setTimeout(tick, jitter(ms)) }; setTimeout(tick, jitter(ms)) }
  // 校时 1 次/秒（配额 2/s）；聊天 ≈1/2.6s（配额 5/10s）；队列操作 ≈1/2.8s（配额 5/10s）
  loop(() => { const clientTimeMs = ++clockSeq; awaitAck(String(clientTimeMs), 'rtt'); send({ type: 'sync', clientTimeMs }) }, 1000)
  if (!isHost) {
    loop(() => { const clientMessageId = randomUUID(); awaitAck(clientMessageId, 'chatAck'); send({ type: 'chat.send', clientMessageId, issuedAtMs: Date.now(), text: `${name} 的第 ${++state.chatN} 条消息 🎵` }) }, 2600)
    loop(async () => {
      const entries = state.queueEntries ?? []
      if (Math.random() < 0.35 && state.queued.size) { // 撤回自己的点歌
        const own = entries.find(e => e.requestedByName === name && e.entryId && state.queued.has(e.entryId))
        if (own) { const requestId = randomUUID(); awaitAck(requestId, 'queueAck'); send({ type: 'queue.remove', requestId, issuedAtMs: Date.now(), entryId: own.entryId }) }
      } else if (entries.length < 60) { // 点歌（不顶满队列/配额）
        const trackId = trackIds[Math.floor(Math.random() * trackIds.length)]
        const requestId = randomUUID(); awaitAck(requestId, 'queueAck')
        send({ type: 'queue.add', requestId, issuedAtMs: Date.now(), trackId })
      }
    }, 2800)
  } else {
    loop(async () => { // 房主：播放/暂停 + 偶尔 seek（无当前曲时命令 409 属预期业务失败，不计错误）
      const hasTrack = (state.queueEntries ?? []).length > 0 || state.hasCurrent
      if (!hasTrack) return
      const action = Math.random() < 0.15 ? 'seek' : (Math.random() < 0.5 ? 'play' : 'pause')
      state.cmdSentAt = performance.now()
      send({ type: 'command', requestId: randomUUID(), issuedAtMs: Date.now(), action, ...(action === 'seek' ? { positionMs: Math.floor(Math.random() * 60000) } : {}) })
    }, 5000)
    loop(() => { const entries = state.queueEntries ?? []; if (entries.length < 30) return; const trackId = trackIds[Math.floor(Math.random() * trackIds.length)]; const requestId = randomUUID(); awaitAck(requestId, 'queueAck'); send({ type: 'queue.add', requestId, issuedAtMs: Date.now(), trackId }) }, 2800)
    loop(() => { if ((state.queueEntries ?? []).length > 3) { const requestId = randomUUID(); awaitAck(requestId, 'cmdAck'); send({ type: 'skip-next', requestId, issuedAtMs: Date.now() }) } }, 30000)
  }
  return { stop: () => { state.stopped = true; try { state.ws?.close(1000, 'done') } catch { /* 已关 */ } } }
}

const health = await waitHealth()
say({ event: 'health-ready', ok: health.ok })
const V2 = { 'x-listentogether-protocol': '2' }
const createRes = await fetch(base + '/api/rooms', { method: 'POST', headers: { ...V2, 'content-type': 'application/json' }, body: JSON.stringify({ nickname: '负载房主' }) })
if (!createRes.ok) { console.error('建房失败：' + createRes.status); exit(1) }
const host = await createRes.json()
const join = async name => (await (await fetch(`${base}/api/rooms/${host.code}/join`, { method: 'POST', headers: { ...V2, 'content-type': 'application/json' }, body: JSON.stringify({ nickname: name }) })).json())
const catalog = await (await fetch(`${base}/api/rooms/${host.code}/catalog`, { headers: { authorization: 'Bearer ' + host.token, ...V2 } })).json()
const trackIds = catalog.map(t => t.id)
say({ event: 'room-ready', code: host.code, tracks: trackIds.length, durationS, members: memberCount })

const members = [startMember('负载房主', host, true, trackIds)]
for (let i = 1; i < memberCount; i++) members.push(startMember(`负载成员${i}`, await join(`负载成员${i}`), false, trackIds))
const healthTimer = setInterval(async () => {
  try { const h = await (await fetch(base + '/health')).json(); stats.eventLoop.push({ t: Math.round(performance.now() / 1000), p50: h.eventLoop?.p50Ms ?? null, p99: h.eventLoop?.p99Ms ?? null, max: h.eventLoop?.maxMs ?? null, ws: h.wsConnections }) } catch { /* 采样失败不计 */ }
}, 10000)
healthTimer.unref?.()

await new Promise(r => setTimeout(r, durationS * 1000))
members.forEach(m => m.stop())
await new Promise(r => setTimeout(r, 1500))
clearInterval(healthTimer)
if (server) server.kill()

const summary = {
  event: 'summary', durationS, members: memberCount,
  clockRttMs: { p50: pct(stats.rtt, 0.5), p95: pct(stats.rtt, 0.95), p99: pct(stats.rtt, 0.99), samples: stats.rtt.length },
  hostCmdAckMs: { p50: pct(stats.cmdAck, 0.5), p95: pct(stats.cmdAck, 0.95), samples: stats.cmdAck.length },
  queueAckMs: { p50: pct(stats.queueAck, 0.5), p95: pct(stats.queueAck, 0.95), samples: stats.queueAck.length },
  chatAckMs: { p50: pct(stats.chatAck, 0.5), p95: pct(stats.chatAck, 0.95), samples: stats.chatAck.length },
  rateLimited429: stats.rateLimited, ackTimeouts: stats.ackTimeouts, reconnects: stats.reconnects,
  unexpectedErrors: stats.errors, seqGaps: stats.seqGaps, seqRegress: stats.seqRegress, chatSeqMax: stats.chatSeqMax,
  eventLoopSamples: stats.eventLoop.length,
  eventLoopP99MsMax: stats.eventLoop.reduce((m, s) => Math.max(m, s.p99 ?? 0), 0),
  eventLoopMaxMsMax: stats.eventLoop.reduce((m, s) => Math.max(m, s.max ?? 0), 0)
}
say(summary)
const pass = stats.rateLimited === 0 && stats.ackTimeouts === 0 && stats.seqGaps === 0 && stats.seqRegress === 0 && stats.errors.length === 0
say({ event: 'assert', name: 'mixed-load: 配额内合法请求零限频/零意外错误/seq 连续', pass, detail: `429=${stats.rateLimited} errors=${stats.errors.length} gaps=${stats.seqGaps} regress=${stats.seqRegress}` })
exit(pass ? 0 : 1)
