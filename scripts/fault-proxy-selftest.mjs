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
      if (json.type === 'state') { clearTimeout(timer); resolve(ws) }
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
  const ws = await openRoomWs(room.code, room.token)
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
  ws2.close()
  console.log('PASS D3 窗口结束后自动恢复，可重新建立 WS')
  console.log('PASS 故障注入代理自测全部通过')
} catch (err) {
  fail(err.message)
} finally {
  proxy.kill()
}
