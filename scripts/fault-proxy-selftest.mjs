#!/usr/bin/env node
/**
 * 故障注入代理自测：不依赖手机，用脚本客户端验证代理本身的行为。
 * 前置：演示后端已在本机 3000 端口运行（node scripts/start-demo.ps1）。
 * 用法：node scripts/fault-proxy-selftest.mjs
 * 场景：透传、延迟注入、WS 经代建立、断线窗口拒绝与恢复。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const PROXY_PORT = 3101
const TARGET = 'http://127.0.0.1:3000'
const BASE = `http://127.0.0.1:${PROXY_PORT}`

const require2 = createRequire(pathToFileURL(fileURLToPath(new URL('../server/package.json', import.meta.url))))
const WebSocket = require2('ws')

const fail = message => { console.error('FAIL: ' + message); process.exitCode = 1 }

async function admin(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error('admin ' + path + ' -> ' + res.status)
  return res.json()
}

async function health() {
  const started = Date.now()
  const res = await fetch(BASE + '/health', { signal: AbortSignal.timeout(5000) })
  return { ok: (await res.json()).ok === true, ms: Date.now() - started }
}

function openRoomWs(code, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/' + code, { headers: { Authorization: 'Bearer ' + token } })
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS 快照超时')) }, 8000)
    ws.on('message', text => {
      const json = JSON.parse(text)
      if (json.type === 'state') { clearTimeout(timer); resolve({ ws, trackId: json.trackId }) }
    })
    ws.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

async function createRoom() {
  const res = await fetch(BASE + '/api/rooms', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname: 'ProxySelfTest' }), signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) throw new Error('创建房间失败 ' + res.status)
  return res.json()
}

// 前置检查：目标后端必须在线，否则结论无意义。
const direct = await fetch(TARGET + '/health', { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null)
if (!direct || direct.ok !== true) { fail('目标后端未运行：' + TARGET + '/health'); process.exit(1) }

const proxy = spawn(process.execPath, ['scripts/fault-proxy.mjs', '--port', String(PROXY_PORT), '--target', TARGET], { stdio: ['ignore', 'inherit', 'inherit'] })
await new Promise((resolve, reject) => { proxy.on('spawn', resolve); proxy.on('error', reject) })
await new Promise(r => setTimeout(r, 800))

try {
  // A 透传
  const a = await health()
  a.ok ? console.log(`PASS A 透传 health ${a.ms}ms`) : fail('A health 内容异常')

  // B 延迟注入：响应整体延迟生效
  await admin('/__fault/delay?ms=300')
  const b = await health()
  b.ms >= 280 ? console.log(`PASS B 延迟注入 ${b.ms}ms ≥ 300ms 注入`) : fail(`B 延迟未生效 ${b.ms}ms`)
  await admin('/__fault/clear')

  // C WS 经代理建立并收到快照
  const room = await createRoom()
  const { ws, trackId } = await openRoomWs(room.code, room.token)
  if (!trackId) throw new Error('快照缺少 trackId，无法测音频路由')
  console.log('PASS C WS 经代理建立，收到房间快照 code=' + room.code)

  // D 断线窗口：现有连接被切，窗口内新连接被拒，窗口后自动恢复
  await admin('/__fault/cut?seconds=2')
  const cutDuring = await new Promise(resolve => {
    const attempt = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/' + room.code, { headers: { Authorization: 'Bearer ' + room.token } })
    attempt.on('open', () => { attempt.close(); resolve(false) })
    attempt.on('error', () => resolve(true))
    attempt.on('close', () => resolve(true))
    setTimeout(() => { attempt.terminate(); resolve(false) }, 4000)
  })
  cutDuring ? console.log('PASS D1 断线窗口内新连接被拒绝') : fail('D1 窗口内仍可连接')
  const oldClosed = await new Promise(resolve => {
    if (ws.readyState === WebSocket.CLOSED) return resolve(true)
    ws.on('close', () => resolve(true)); setTimeout(() => resolve(false), 4000)
  })
  oldClosed ? console.log('PASS D2 断线窗口切断既有连接') : fail('D2 既有连接未被切断')
  await new Promise(r => setTimeout(r, 2500))
  const ws2 = await openRoomWs(room.code, room.token)
  ws2.ws.close()
  console.log('PASS D3 窗口结束后自动恢复，可重新建立 WS')

  // 音频请求工具：带鉴权与 Range 的正常音频读取
  const audioGet = async () => {
    const res = await fetch(`${BASE}/api/rooms/${room.code}/audio/${trackId}`, {
      headers: { Authorization: 'Bearer ' + room.token, Range: 'bytes=0-99' }, signal: AbortSignal.timeout(5000)
    })
    const json = await res.json().catch(() => null) // 音频 401 时为 JSON 错误体；正常时为 null
    if (res.body) await res.arrayBuffer().catch(() => {})
    return { status: res.status, json }
  }
  const baseline = await audioGet()
  if (baseline.status !== 206 && baseline.status !== 200) fail(`E0 注入前音频请求异常 ${baseline.status}`)
  else console.log(`PASS E0 注入前音频读取 ${baseline.status}`)

  // E 音频 401：窗口内仅音频路由返回 401，HTTP 其余路径与 WS 保持可用
  await admin('/__fault/audio401?seconds=2')
  const e1 = await audioGet()
  const e1ok = e1.status === 401 && e1.json && e1.json.message === '成员令牌无效，请重新加入'
  e1ok ? console.log('PASS E1 音频请求被注入 401，响应体与后端 Fault(401) 一致') : fail(`E1 音频 401 注入异常 ${e1.status} ${JSON.stringify(e1.json)}`)
  const e2 = await health()
  const e3 = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'ProxySelfTest401' }), signal: AbortSignal.timeout(5000) })
  await e3.arrayBuffer()
  const e4 = await openRoomWs(room.code, room.token)
  e2.ok && e3.status === 200 && e4.ws ? console.log(`PASS E2 注入窗口内 health=${e2.ok} 新建房间=${e3.status} 既有房间 WS 可用`) : fail(`E2 非音频路径受牵连 health=${e2.ok} create=${e3.status}`)
  e4.ws.close()

  // F 窗口到期自动恢复（seconds=2，等待后不再需要 clear）
  await new Promise(r => setTimeout(r, 2300))
  const f = await audioGet()
  f.status === 206 || f.status === 200 ? console.log('PASS F 音频 401 窗口到期自动恢复') : fail(`F 窗口到期后仍被注入 ${f.status}`)

  // G clear 立即清除注入
  await admin('/__fault/audio401?seconds=60')
  const g1 = await audioGet()
  if (g1.status !== 401) fail('G1 重新注入未生效')
  await admin('/__fault/clear')
  const g2 = await audioGet()
  g2.status === 206 || g2.status === 200 ? console.log('PASS G clear 立即恢复音频透传') : fail(`G clear 后仍被注入 ${g2.status}`)

  console.log('PASS 故障注入代理自测全部通过')
} catch (err) {
  fail(err.message)
} finally {
  proxy.kill()
}
