#!/usr/bin/env node
/**
 * QC-D 规模基准：对 qcd-fixture 生成的隔离夹具做启动耗时 / 峰值内存 / 解析峰值并发 /
 * 搜索延迟（p95 ≤100ms，预热后 ≥1000 次，完整报告错误率）/ 封面缓存峰值与清退稳定值测量。
 * 全程进程内口径（loadCatalog + buildApp 不监听，即启动成本主体）；不访问公网、不碰真实 media/。
 *
 * 用法：node scripts/qcd-bench.mjs --media .workbuddy/qcd-fixture-2000
 * 前置：cd server && npm run build（脚本读 server/dist 编译产物）。
 * 输出逐行 JSON；"assert" 行为规模门槛断言（p95 ≤100ms、缓存字节 ≤32MiB、解析并发 ≤4）。
 */
import { performance } from 'node:perf_hooks'
import os from 'node:os'
import { argv } from 'node:process'

function argOf(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const media = argOf('--media', '.workbuddy/qcd-fixture-1000')
const say = obj => console.log(JSON.stringify(obj))

const dist = rel => new URL(`../server/dist/${rel}`, import.meta.url).href
const { loadCatalog, PARSE_CONCURRENCY } = await import(dist('library/catalog.js'))
const { CatalogIndex } = await import(dist('library/catalog-index.js'))
const { CoverCache, COVER_CACHE_LIMIT_BYTES, COVER_IO_CONCURRENCY } = await import(dist('library/cover-cache.js'))
const { buildApp } = await import(dist('app.js'))

say({ event: 'env', node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, totalMemGB: Math.round(os.totalmem() / 1073741824 * 10) / 10, media })

// ---- 冷启动：loadCatalog（采样 RSS）+ buildApp（不监听）----
const rssSamples = []
const sampler = setInterval(() => rssSamples.push(process.memoryUsage().rss), 25)
sampler.unref?.()
const t0 = performance.now()
const loadStats = { peak: 0 }
const tracks = await loadCatalog(media, { stats: loadStats })
const tLoad = performance.now()
const { app } = await buildApp(tracks, { timers: false, logger: false })
const tStartup = performance.now()
clearInterval(sampler)
const rssAfter = process.memoryUsage().rss
const peakRss = Math.max(...rssSamples, rssAfter)
say({ event: 'startup', tracks: tracks.length, loadMs: Math.round(tLoad - t0), startupMs: Math.round(tStartup - t0), parseConcurrencyCap: PARSE_CONCURRENCY, parsePeak: loadStats.peak, peakRssMB: Math.round(peakRss / 1048576), rssAfterMB: Math.round(rssAfter / 1048576) })
say({ event: 'assert', name: 'parse concurrency ≤ cap', pass: loadStats.peak <= PARSE_CONCURRENCY, detail: `peak=${loadStats.peak} cap=${PARSE_CONCURRENCY}` })
await app.close()
global.gc?.() // --expose-gc 时清堆，让后续缓存口径更干净；不带该 flag 则按原样继续

// ---- 搜索基准：固定查询集（空/精确/部分/无命中/中文/英文），预热 100 后测 1000 次 ----
const index = new CatalogIndex(tracks)
const queries = ['', '测试歌曲', 'Song', '测试歌曲100号', 'Song 100 Demo', '歌手甲', 'Artist Five', '不存在的查询词XYZQ']
try { index.search('', 0, 999); say({ event: 'assert', name: 'first-page limit cap', pass: false, detail: 'limit>50 未被拒绝' }) }
catch { say({ event: 'assert', name: 'first-page limit cap', pass: true, detail: 'limit 1–50（首屏仅请求第一页，1000→2000 首请求页数不变）' }) }
for (let i = 0; i < 100; i++) index.search(queries[i % queries.length], 0, 30)
const latencies = []
let errors = 0
const tSearch0 = performance.now()
for (let i = 0; i < 1000; i++) {
  const q = queries[i % queries.length]
  const s = performance.now()
  try { index.search(q, 0, 30) } catch { errors++ }
  latencies.push(performance.now() - s)
}
const tSearch1 = performance.now()
latencies.sort((a, b) => a - b)
const pct = p => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] * 1000) / 1000
say({
  event: 'search', iterations: 1000, errorRate: errors / 1000, totalMs: Math.round(tSearch1 - tSearch0),
  p50Ms: pct(0.5), p95Ms: pct(0.95), p99Ms: pct(0.99), maxMs: Math.round(latencies.at(-1) * 1000) / 1000,
  revision: index.revision.slice(0, 8)
})
say({ event: 'assert', name: 'search p95 ≤ 100ms', pass: pct(0.95) <= 100, detail: `p95=${pct(0.95)}ms errors=${errors}/1000` })

// ---- 封面缓存：默认 32MiB 上限全量请求，报告峰值与清退后稳定值 ----
const cache = new CoverCache()
const withCover = tracks.filter(t => t.cover)
const tCover0 = performance.now()
let served = 0, miss = 0
for (const track of withCover) { (await cache.get(track)) ? served++ : miss++ }
const tCover1 = performance.now()
const stats = cache.stats()
say({ event: 'coverCache', covers: withCover.length, served, miss, readMs: Math.round(tCover1 - tCover0), ioConcurrencyCap: COVER_IO_CONCURRENCY, ioPeak: stats.peak, entries: stats.entries, bytesMB: Math.round(stats.bytes / 1048576 * 100) / 100, peakBytesMB: Math.round(stats.peakBytes / 1048576 * 100) / 100 })
say({ event: 'assert', name: `cache bytes ≤ ${COVER_CACHE_LIMIT_BYTES / 1048576}MiB`, pass: stats.bytes <= COVER_CACHE_LIMIT_BYTES, detail: `bytes=${stats.bytes} limit=${COVER_CACHE_LIMIT_BYTES}` })
say({ event: 'assert', name: 'cover io concurrency ≤ cap', pass: stats.peak <= COVER_IO_CONCURRENCY, detail: `peak=${stats.peak} cap=${COVER_IO_CONCURRENCY}` })
say({ event: 'done' })
