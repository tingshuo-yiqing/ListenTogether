#!/usr/bin/env node
/**
 * 脚本成员：单机验收"房间里的人"（成员进出、掉线、回来、房主转移）时替代第二台手机。
 * 背景：服务端按"离线 60 秒"清扫无连接成员，纯 HTTP 的假成员会被踢光（陷阱 6 节），
 * 所以这里的每个成员都必须持有 WS；ws 客户端自动回 pong。
 *
 * 用法（--target 默认 http://127.0.0.1:3000，可用云端地址）：
 *   node scripts/member-sim.mjs create <昵称> [--hold 秒]      # 建房并作为房主持有 WS
 *   node scripts/member-sim.mjs join   <房间码> <昵称> [--hold 秒]  # 加入并持有 WS
 *   node scripts/member-sim.mjs resume <房间码> <令牌> [--hold 秒]  # 用既有令牌重连（模拟"回来了"）
 *   node scripts/member-sim.mjs leave  <房间码> <令牌>              # 主动退出（触发"离开了"/房主转移）
 *
 * --hold 默认 60 秒；进程结束（不调 DELETE）等于"掉线"，由服务端置 offline。
 * 输出为逐行 JSON，便于和手机界面上的动态文案逐一对照：
 *   {"event":"created|joined|resumed|left","code":..,"memberId":..,"token":..}
 *   {"event":"state","code":..,"members":[{"name":..,"online":..}]}   # members 变化时才打印
 * 令牌只打印给调用方做后续 resume/leave，不写文件、不进日志。
 * 退出码：0=正常结束；1=后端不可达或接口失败。
 */
import { argv, exit } from 'node:process'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

// 复用后端依赖的 ws 客户端（自动回应服务端 ping，防止被心跳判定离线）。
const require2 = createRequire(pathToFileURL(fileURLToPath(new URL('../server/package.json', import.meta.url))))
const WebSocket = require2('ws')

function argOf(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

// 位置参数：跳过 --target/--hold 及其取值，其余按顺序取（避免 indexOf 在重复取值上失准）。
const rawArgs = argv.slice(2)
const positional = []
for (let i = 0; i < rawArgs.length; i++) {
  const current = rawArgs[i]
  if (current === '--target' || current === '--hold') { i += 1; continue }
  if (current.startsWith('--')) continue
  positional.push(current)
}
const COMMAND = positional[0]
const TARGET = argOf('--target', 'http://127.0.0.1:3000').replace(/\/$/, '')
const HOLD_SECONDS = Math.max(0, Number(argOf('--hold', 60)) || 60)
const out = line => console.log(JSON.stringify(line))

async function jsonFetch(path, options = {}) {
  const res = await fetch(TARGET + path, { signal: AbortSignal.timeout(8000), ...options })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

/** 持有 WS 直到 --hold 到期或收到 SIGINT；返回前不主动 DELETE，进程退出即"掉线"。 */
function hold(code, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(TARGET.replace(/^http/, 'ws') + '/ws/' + code, { headers: { Authorization: 'Bearer ' + token } })
    let lastSignature = ''
    let timer = null
    const done = () => { if (timer) clearTimeout(timer); try { ws.terminate() } catch { /* 已关闭 */ } resolve() }
    // --hold 0 表示一直保持（由调用方 kill）；否则从连接时刻起算，不因收到快照而顺延。
    if (HOLD_SECONDS > 0) timer = setTimeout(done, HOLD_SECONDS * 1000)
    ws.on('message', text => {
      let message
      try { message = JSON.parse(text) } catch { return }
      if (message.type !== 'state') return
      // 只在成员名单变化时打印，便于把服务端事实与手机界面逐条对齐。
      const members = (message.members ?? []).map(m => ({ name: m.name, online: !!m.online }))
      const signature = JSON.stringify(members)
      if (signature === lastSignature) return
      lastSignature = signature
      out({ event: 'state', code, members })
    })
    ws.on('error', err => { if (timer) clearTimeout(timer); reject(err) })
    ws.on('close', done)
    process.on('SIGINT', done)
  })
}

async function main() {
  const health = await jsonFetch('/health')
  if (health.status !== 200 || health.body?.ok !== true) throw new Error('后端不在线：' + TARGET)

  if (COMMAND === 'create') {
    const nickname = positional[1]
    if (!nickname) throw new Error('用法：create <昵称>')
    const created = await jsonFetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }) })
    if (created.status !== 200) throw new Error('创建房间失败 ' + created.status)
    out({ event: 'created', code: created.body.code, memberId: created.body.memberId, token: created.body.token })
    await hold(created.body.code, created.body.token)
    return
  }

  if (COMMAND === 'join') {
    const [, code, nickname] = positional
    if (!code || !nickname) throw new Error('用法：join <房间码> <昵称>')
    const joined = await jsonFetch(`/api/rooms/${code}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }) })
    if (joined.status !== 200) throw new Error(`加入失败 ${joined.status} ${JSON.stringify(joined.body)}`)
    out({ event: 'joined', code, memberId: joined.body.memberId, token: joined.body.token })
    await hold(code, joined.body.token)
    return
  }

  if (COMMAND === 'resume') {
    const [, code, token] = positional
    if (!code || !token) throw new Error('用法：resume <房间码> <令牌>')
    out({ event: 'resumed', code })
    await hold(code, token)
    return
  }

  if (COMMAND === 'leave') {
    const [, code, token] = positional
    if (!code || !token) throw new Error('用法：leave <房间码> <令牌>')
    const left = await jsonFetch(`/api/rooms/${code}/membership`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
    if (left.status !== 200) throw new Error(`退出失败 ${left.status}`)
    out({ event: 'left', code })
    return
  }

  throw new Error('未知命令：' + COMMAND + '（可用 create / join / resume / leave）')
}

main().then(() => exit(0)).catch(err => { console.error(String(err.message ?? err)); exit(1) })
