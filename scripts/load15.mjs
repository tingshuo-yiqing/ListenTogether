#!/usr/bin/env node
/**
 * LOAD-15：15 路并发读取受鉴权 MP3 的负载脚本（见 docs/execution-plan.md 第 4 节）。
 *
 * 用法：
 *   node scripts/load15.mjs --model playback   [--duration 600] [--bitrate 192] [--track demo-load]
 *   node scripts/load15.mjs --model throughput [--cycles 2]
 *   公共参数：--target http://127.0.0.1:3000 --members 15
 *   选曲：默认逐首探测后取码率最高者；--track 显式指定。
 *
 * 两种模型（分开报告，不互相替代）：
 * - playback：按目标码率（默认 192kbps）做节奏化 Range 读取，持续 --duration 秒；
 *   每秒采样每路字节数；成员读到文件尾回绕、随机跳转、每路一次中途取消，覆盖
 *   完整读取 / Range 跳转 / 读取取消。注意这是“按目标码率的字节读取模型”，
 *   不等于解码器的真实拉动速率；曲库若为低码率测试音需在报告标注。
 * - throughput：无节流全量读取（200/206），只测容量上限，重复 --cycles 轮。
 *
 * 通过标准（脚本退出码）：全部请求仅 200/206，无非预期失败；playback 模型
 * 每路平均速率 ≥ 目标 × 0.9。CPU/内存/句柄只记录实测与趋势，不设合格阈值。
 * finally 中清理自身创建的全部成员连接与房间成员资格。
 */
import { argv, exit } from 'node:process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

// 复用后端依赖的 ws 客户端（自动回应服务端 ping，防止被心跳判定离线）。
const require2 = createRequire(pathToFileURL(fileURLToPath(new URL('../server/package.json', import.meta.url))))
const WebSocket = require2('ws')

function argOf(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const TARGET = argOf('--target', 'http://127.0.0.1:3000')
const MEMBERS = Math.max(1, Math.min(15, Number(argOf('--members', 15)) || 15))
const MODEL = argOf('--model', 'playback')
const DURATION = Math.max(5, Number(argOf('--duration', 600)) || 600) // 秒
const BITRATE_KBPS = Math.max(32, Number(argOf('--bitrate', 192)) || 192)
const CYCLES = Math.max(1, Number(argOf('--cycles', 2)) || 2)
const PACE_SECONDS = 1 // 每次请求代表 PACE_SECONDS 秒的音频字节量

const log = (event, detail = '') => console.log(`[${new Date().toISOString()}] ${event}${detail ? ' ' + detail : ''}`)

async function jsonFetch(path, options = {}) {
  const res = await fetch(TARGET + path, { signal: AbortSignal.timeout(8000), ...options })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function main() {
  const health = await jsonFetch('/health')
  if (health.status !== 200 || health.body?.ok !== true) throw new Error('后端不在线：' + TARGET)

  // 1. 房主建房 + (members-1) 名成员加入；令牌只存在于脚本内存。
  const created = await jsonFetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'Load15Host' }) })
  if (created.status !== 200) throw new Error('创建房间失败 ' + created.status)
  const code = created.body.code
  const members = [{ name: 'Load15Host', token: created.body.token }]
  for (let i = 1; i < MEMBERS; i++) {
    const joined = await jsonFetch(`/api/rooms/${code}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: `Load15-${i}` }) })
    if (joined.status !== 200) throw new Error(`成员 ${i} 加入失败 ${joined.status}`)
    members.push({ name: joined.body.memberId, token: joined.body.token })
  }
  // 成员必须持有 WS：服务端按“离线 60 秒”清扫无连接成员，纯 HTTP 成员会被踢光。
  // ws 客户端自动回 pong；快照收到即视为就绪。
  const sockets = []
  for (const m of members) {
    const ws = new WebSocket(TARGET.replace(/^http/, 'ws') + '/ws/' + code, { headers: { Authorization: 'Bearer ' + m.token } })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('成员 WS 建立超时')) }, 8000)
      ws.on('message', text => { if (JSON.parse(text).type === 'state') { clearTimeout(timer); resolve() } })
      ws.on('error', err => { clearTimeout(timer); reject(err) })
    })
    sockets.push(ws)
  }
  log('room-ready', `code=${code} members=${members.length} ws=${sockets.length}`)

  // 2. 选曲目：逐首探测大小后取码率最高的一首（负载代表性；32kbps 测试音不代表
  //    192kbps 负载）。可用 --track <id> 显式指定，跳过探测。
  const catalog = await jsonFetch(`/api/rooms/${code}/catalog`, { headers: { Authorization: 'Bearer ' + members[0].token } })
  if (catalog.status !== 200) throw new Error('曲库获取失败 ' + catalog.status)
  const wanted = argOf('--track', null)
  const probed = []
  for (const t of catalog.body) {
    const res = await fetch(`${TARGET}/api/rooms/${code}/audio/${t.id}`, {
      headers: { Authorization: 'Bearer ' + members[0].token, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(8000)
    })
    await res.arrayBuffer()
    const cr = res.headers.get('content-range') // bytes 0-0/<size>
    const bytes = cr ? Number(cr.split('/')[1]) : Number(res.headers.get('content-length'))
    if (!Number.isFinite(bytes) || bytes <= 0) throw new Error(`无法确定 ${t.id} 文件大小`)
    probed.push({ ...t, bytes, kbps: Math.round(bytes * 8 / (t.durationMs / 1000) / 1000) })
    if (wanted && t.id === wanted) break
  }
  const track = wanted ? probed.find(t => t.id === wanted) : probed.reduce((a, b) => (a.kbps >= b.kbps ? a : b))
  if (!track) throw new Error('曲目不存在：' + wanted)
  const size = track.bytes
  log('track-selected', `${track.id} durationMs=${track.durationMs} bytes=${size} kbps=${track.kbps}`)

  const stats = members.map((m, i) => ({
    index: i, name: m.name, bytes: 0, chunks: 0, failures: 0,
    statuses: {}, canceled: 0, seeks: 0, fullReads: 0,
    perSecond: new Map(), // 秒序号 → 字节数（采样粒度 1 秒）
  }))
  const serverSamples = []
  let serverTimer = null

  // 本机 node 进程合计（后端/脚本混在一起，仅作趋势参考，不设阈值）。
  const sampleServer = () => {
    const rss = process.memoryUsage().rss
    const cpu = process.cpuUsage().user / 1000
    serverSamples.push({ t: Date.now(), rss, cpu })
  }

  /** 单次 Range 读取；返回读取字节数，失败计入 failures。
   *  cancelAfterHeaders=true 时在响应头到手后立即中止，确定性覆盖“读取取消”路径。 */
  async function readRange(index, token, start, end, { cancelAfterHeaders = false } = {}) {
    const controller = new AbortController()
    try {
      const res = await fetch(`${TARGET}/api/rooms/${code}/audio/${track.id}`, {
        headers: { Authorization: 'Bearer ' + token, Range: `bytes=${start}-${end}` },
        signal: controller.signal
      })
      if (cancelAfterHeaders) controller.abort()
      const reader = res.body.getReader()
      let bytes = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.length
      }
      stats[index].statuses[res.status] = (stats[index].statuses[res.status] ?? 0) + 1
      if (res.status !== 200 && res.status !== 206) { stats[index].failures++; return 0 }
      if (start === 0 && end >= size - 1) stats[index].fullReads++
      return bytes
    } catch (err) {
      if (cancelAfterHeaders && controller.signal.aborted) { stats[index].canceled++; return 0 }
      stats[index].failures++
      log('read-error', `member=${index} ${err.message}`)
      return 0
    }
  }

  /** playback 模型成员：按目标码率节奏读取，覆盖回绕跳转/随机跳转/中途取消。 */
  async function playbackMember(index, token, deadline) {
    const targetBytesPerSec = BITRATE_KBPS * 1000 / 8
    const chunk = Math.min(Math.floor(targetBytesPerSec * PACE_SECONDS), size)
    let pos = Math.floor(size * index / MEMBERS) // 错开起始位置，模拟中途加入
    let canceledOnce = false
    let seekedOnce = false
    const started = Date.now()
    while (Date.now() < deadline) {
      const second = Math.floor((Date.now() - started) / 1000)
      const end = Math.min(pos + chunk - 1, size - 1)
      // 每名成员首轮做一次“读取取消”（响应头到手即中止），此后正常读取。
      const bytes = canceledOnce
        ? await readRange(index, token, pos, end)
        : await readRange(index, token, pos, end, { cancelAfterHeaders: true })
      canceledOnce = true
      if (bytes > 0) {
        stats[index].bytes += bytes; stats[index].chunks++
        stats[index].perSecond.set(second, (stats[index].perSecond.get(second) ?? 0) + bytes)
      }
      pos += chunk
      // 读到文件尾回绕=一次 Range 跳转；另在半程做一次显式随机跳转。
      if (pos >= size) { pos = 0; stats[index].seeks++ }
      if (!seekedOnce && Date.now() - started > DURATION * 500) {
        pos = Math.floor(Math.random() * (size - chunk)); stats[index].seeks++; seekedOnce = true
        log('seek', `member=${index} pos=${pos}`)
      }
      const elapsed = (Date.now() - started) % (PACE_SECONDS * 1000)
      await new Promise(r => setTimeout(r, Math.max(0, PACE_SECONDS * 1000 - elapsed)))
    }
  }

  /** throughput 模型成员：无节流全量读取若干轮。 */
  async function throughputMember(index, token, rounds) {
    for (let r = 0; r < rounds; r++) {
      const bytes = await readRange(index, token, 0, size - 1)
      stats[index].bytes += bytes
      stats[index].chunks++
    }
  }

  const deadline = Date.now() + DURATION * 1000
  const started = Date.now()
  sampleServer()
  serverTimer = setInterval(sampleServer, 10000)

  log('load-start', `model=${MODEL} members=${MEMBERS}`)
  if (MODEL === 'playback') {
    await Promise.all(members.map((m, i) => playbackMember(i, m.token, deadline)))
  } else if (MODEL === 'throughput') {
    await Promise.all(members.map((m, i) => throughputMember(i, m.token, CYCLES)))
  } else throw new Error('未知模型：' + MODEL)
  const wallSeconds = (Date.now() - started) / 1000
  clearInterval(serverTimer)
  sampleServer()

  // 4. 汇总报告。
  const targetBps = MODEL === 'playback' ? BITRATE_KBPS * 1000 / 8 : 0
  let failed = false
  const perMember = stats.map(s => {
    const rate = s.bytes / wallSeconds
    const rateOk = MODEL !== 'playback' || rate >= targetBps * 0.9
    if (s.failures > 0 || !rateOk) failed = true
    const seconds = [...s.perSecond.entries()].sort((a, b) => a[0] - b[0])
    const minSec = seconds.length ? Math.min(...seconds.map(e => e[1])) : 0
    return { member: s.index, bytes: s.bytes, chunks: s.chunks, avgBps: Math.round(rate), rateOk,
      statuses: s.statuses, failures: s.failures, canceled: s.canceled, seeks: s.seeks,
      fullReads: s.fullReads, minSecondBytes: minSec, granularity: '1s' }
  })
  const totalBytes = stats.reduce((a, s) => a + s.bytes, 0)
  const first = serverSamples[0], last = serverSamples[serverSamples.length - 1]
  const summary = {
    model: MODEL, target: TARGET, code, trackId: track.id, trackKbps: track.kbps, sizeBytes: size, members: MEMBERS,
    wallSeconds: Math.round(wallSeconds * 10) / 10,
    bitrateKbps: MODEL === 'playback' ? BITRATE_KBPS : null,
    totalBytes, totalMbps: Math.round(totalBytes * 8 / wallSeconds / 1e6 * 1000) / 1000,
    unexpectedStatuses: perMember.flatMap(p => Object.entries(p.statuses).filter(([k]) => k !== '200' && k !== '206').map(([k, v]) => `member${p.member}:${k}×${v}`)),
    processTrend: { rssStart: first.rss, rssEnd: last.rss, cpuMsStart: Math.round(first.cpu), cpuMsEnd: Math.round(last.cpu),
      note: '本机 node 进程自身指标（含后端与脚本的合计不可分），仅记录趋势；不设合格阈值' },
    perMember
  }
  console.log('=== LOAD15 SUMMARY ===')
  console.log(JSON.stringify(summary, null, 2))
  const bad = summary.unexpectedStatuses
  if (bad.length) { console.error('FAIL: 非预期状态码 ' + bad.join(' ')); failed = true }
  if (failed) process.exitCode = 1
  else log('load-pass', `total=${(totalBytes / 1e6).toFixed(1)}MB over ${wallSeconds.toFixed(0)}s`)
  return { code, tokens: members.map(m => m.token), sockets }
}

// 5. 清理：先关闭成员 WS，再删除本次创建的全部成员资格；失败不掩盖负载结论，但打印告警。
const ctx = await main().catch(err => { console.error('FAIL: ' + err.message); process.exitCode = 1; return null })
if (ctx) {
  for (const ws of ctx.sockets) { try { ws.close() } catch {} }
  await new Promise(r => setTimeout(r, 300))
  for (const token of ctx.tokens) {
    await fetch(`${TARGET}/api/rooms/${ctx.code}/membership`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) })
      .then(r => r.arrayBuffer()).catch(() => {})
  }
  log('cleanup-done', `code=${ctx.code} members-removed=${ctx.tokens.length}`)
}
exit()
