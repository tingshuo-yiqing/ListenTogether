#!/usr/bin/env node
/**
 * 本地故障注入代理：夹在客户端与本机后端之间，按场景注入延迟与断线，
 * 用于 M1/M3 的故障矩阵测试（见 docs/modules/10-testing-observability.md）。
 *
 * 用法：node scripts/fault-proxy.mjs [--port 3001] [--target http://127.0.0.1:3000]
 *
 * 不转发的管理路径（客户端 APP 不会调用）：
 *   GET /__fault/status          当前模式与连接数
 *   GET /__fault/delay?ms=200    之后所有 HTTP 响应与 WS 帧双向延迟 ms 毫秒
 *   GET /__fault/cut?seconds=10  立即切断全部连接，并在窗口内拒绝新连接
 *   GET /__fault/audio401?seconds=30  窗口内仅音频路由返回 401（模拟令牌失效/鉴权故障），
 *                                     HTTP/WS 其余路径保持透传；到期自动恢复
 *   GET /__fault/clear           清除延迟、断线窗口与音频 401 注入
 *
 * 实现说明：
 * - HTTP 逐请求转发（方法/头/体），响应整体延迟；Range 音频请求同样生效。
 * - 音频 401 注入按路径匹配 /api/rooms/:code/audio/:id，响应体与后端 Fault(401) 一致
 *   （{message}），状态码保持 401，供 PlaybackFailure 分类与诊断取证（M3-AUTH）。
 * - WebSocket 升级用原始 TCP 隧道逐字节透传，不解析业务帧之外的内容；
 *   注入延迟时按 RFC6455 帧边界缓冲完整帧后延迟转发（不修改掩码与负载）。
 * - 断线窗口内直接销毁新连接，模拟服务器不可达；窗口结束自动恢复透传。
 * - 所有事件带本地时间戳打印到 stdout，便于与客户端诊断 JSONL 对齐。
 */
import http from 'node:http'
import net from 'node:net'
import { argv, exit } from 'node:process'

function argOf(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const port = Number(argOf('--port', 3001))
const target = new URL(argOf('--target', 'http://127.0.0.1:3000'))
if (target.protocol !== 'http:') { console.error('target 仅支持 http'); exit(1) }

let delayMs = 0
let cuttingUntil = 0
let audio401Until = 0
let tunnels = new Set()
let stats = { http: 0, ws: 0, cutDropped: 0, audio401: 0 }

const log = (event, detail = '') =>
  console.log(`[${new Date().toISOString()}] ${event}${detail ? ' ' + detail : ''}`)

const cutting = () => Date.now() < cuttingUntil
const audio401 = () => Date.now() < audio401Until
// 音频路由（含查询串之前的部分）；401 注入只作用于该路径，其余 HTTP/WS 保持透传。
const AUDIO_PATH = /^\/api\/rooms\/[^/]+\/audio\/[^/?]+/

function respond(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/__fault/')) {
    const url = new URL(req.url, 'http://admin')
    if (url.pathname === '/__fault/status') {
      return respond(res, 200, { delayMs, cutting: cutting(), audio401: audio401(), audio401Until: audio401Until ? new Date(audio401Until).toISOString() : null, tunnels: tunnels.size, stats })
    }
    if (url.pathname === '/__fault/delay') {
      delayMs = Math.max(0, Math.min(5000, Number(url.searchParams.get('ms') ?? 0) || 0))
      log('fault-delay', `delayMs=${delayMs}`)
      return respond(res, 200, { delayMs })
    }
    if (url.pathname === '/__fault/cut') {
      const seconds = Math.max(1, Math.min(120, Number(url.searchParams.get('seconds') ?? 5) || 5))
      cuttingUntil = Date.now() + seconds * 1000
      for (const t of tunnels) t.destroy()
      tunnels.clear()
      log('fault-cut', `seconds=${seconds}`)
      return respond(res, 200, { cuttingUntil: new Date(cuttingUntil).toISOString() })
    }
    if (url.pathname === '/__fault/audio401') {
      const seconds = Math.max(1, Math.min(600, Number(url.searchParams.get('seconds') ?? 30) || 30))
      audio401Until = Date.now() + seconds * 1000
      log('fault-audio401', `seconds=${seconds} until=${new Date(audio401Until).toISOString()}`)
      return respond(res, 200, { audio401Until: new Date(audio401Until).toISOString() })
    }
    if (url.pathname === '/__fault/clear') {
      delayMs = 0; cuttingUntil = 0; audio401Until = 0
      log('fault-clear')
      return respond(res, 200, { delayMs, cutting: false, audio401: false })
    }
    return respond(res, 404, { error: 'unknown admin path' })
  }

  if (cutting()) { stats.cutDropped++; req.socket.destroy(); return }
  // M3-AUTH：窗口内仅音频路由返回 401，响应体与后端 Fault(401) 一致，其余请求原样转发。
  if (audio401() && AUDIO_PATH.test(req.url.split('?')[0])) {
    stats.audio401++
    log('fault-audio401-hit', `${req.method} ${req.url}`)
    return respond(res, 401, { message: '成员令牌无效，请重新加入' })
  }
  stats.http++
  const started = Date.now()
  const forward = () => {
    const headers = { ...req.headers, host: target.host }
    const upstream = http.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers }, up => {
      const send = () => {
        res.writeHead(up.statusCode, up.statusMessage, up.headers)
        up.pipe(res)
      }
      delayMs > 0 ? setTimeout(send, delayMs) : send()
    })
    upstream.on('error', err => {
      log('http-upstream-error', `${req.method} ${req.url} ${err.message}`)
      if (!res.headersSent) respond(res, 502, { error: 'upstream unreachable' })
      else res.destroy()
    })
    req.pipe(upstream)
  }
  delayMs > 0 ? setTimeout(forward, delayMs) : forward()
})

/**
 * WS 帧切分器：从字节流中按帧边界取出完整帧并回调。
 * 只读帧头长度字段，不解释负载；掩码保持原样转发。
 */
function makeFramer(onFrame) {
  let buf = Buffer.alloc(0)
  return chunk => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 2) return
      const len7 = buf[1] & 0x7f
      let offset = 2, payloadLen = len7
      if (len7 === 126) { if (buf.length < 4) return; payloadLen = buf.readUInt16BE(2); offset = 4 }
      else if (len7 === 127) { if (buf.length < 10) return; payloadLen = Number(buf.readBigUInt64BE(2)); offset = 10 }
      if (buf[1] & 0x80) offset += 4
      if (buf.length < offset + payloadLen) return
      const frame = Buffer.from(buf.subarray(0, offset + payloadLen))
      buf = buf.subarray(offset + payloadLen)
      onFrame(frame)
    }
  }
}

/** 建立到目标的原始 TCP 隧道并双向转发升级请求；both 方向按帧延迟。 */
function tunnel(req, socket, head) {
  if (cutting()) { stats.cutDropped++; socket.destroy(); return }
  stats.ws++
  const upstream = net.connect(Number(target.port), target.hostname, () => {
    // 原样转发升级请求行与头（替换 Host），随后是可能随升级到达的早期数据。
    const lines = [`GET ${req.url} HTTP/1.1`]
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === 'host') continue
      lines.push(`${k}: ${v}`)
    }
    lines.push(`Host: ${target.host}`, '', '')
    upstream.write(lines.join('\r\n'))
    if (head.length) upstream.write(head)
  })
  const clientToUp = makeFramer(frame => delayMs > 0 ? setTimeout(() => upstream.write(frame), delayMs) : upstream.write(frame))
  // 上游先回 HTTP/1.1 101 升级响应头（原样透传），其后的字节才是 WS 帧。
  let upHeadDone = false
  let upHead = Buffer.alloc(0)
  const upToClientRaw = chunk => {
    if (upHeadDone) return upToClient(chunk)
    upHead = Buffer.concat([upHead, chunk])
    const end = upHead.indexOf('\r\n\r\n')
    if (end < 0) return
    upHeadDone = true
    socket.write(upHead.subarray(0, end + 4))
    upToClient(upHead.subarray(end + 4))
  }
  const upToClient = makeFramer(frame => delayMs > 0 ? setTimeout(() => socket.write(frame), delayMs) : socket.write(frame))
  const pair = { destroy: () => { socket.destroy(); upstream.destroy() } }
  tunnels.add(pair)
  socket.on('data', c => cutting() ? pair.destroy() : clientToUp(c))
  upstream.on('data', c => cutting() ? pair.destroy() : upToClientRaw(c))
  const cleanup = why => { if (tunnels.delete(pair)) log('ws-closed', `${req.url} ${why} active=${tunnels.size}`) }
  socket.on('close', () => cleanup('client-close'))
  socket.on('error', e => cleanup('client-error ' + e.message))
  upstream.on('close', () => cleanup('upstream-close'))
  upstream.on('error', e => { cleanup('upstream-error ' + e.message); socket.destroy() })
}

server.on('upgrade', tunnel)
server.on('clientError', (_err, socket) => socket.destroy())

server.listen(port, '127.0.0.1', () =>
  log('proxy-listening', `port=${port} target=${target.host}`))
