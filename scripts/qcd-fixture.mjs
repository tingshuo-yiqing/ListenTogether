#!/usr/bin/env node
/**
 * QC-D 规模夹具：生成 1000/2000 首合成曲库（纯合成 MP3/PNG/LRC，不含任何真实版权音频），
 * 用于启动耗时 / 内存 / 搜索与封面缓存基准。目录默认落在 .workbuddy（gitignore 覆盖），
 * 绝不读写真实 media/。设计口径：独立图 / 内嵌图 / 无图 / 近 1MiB 图片与大歌词混合。
 *
 * 用法：node scripts/qcd-fixture.mjs --tracks 1000 [--out 目录]
 * 混合比例（每 10 首）：1 近 1MiB 独立 PNG + 2 小独立 PNG + 2 内嵌 APIC + 5 无封面；
 * 每 5 首有 4 首带 LRC，其中每 100 首一首近 256KB 大歌词。
 * 输出：逐行 JSON 进度 + 末尾 {"event":"done",...}；catalog.json 相对路径一律正斜杠。
 */
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { argv, exit } from 'node:process'

function argOf(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const total = Number(argOf('--tracks', '1000'))
if (!Number.isInteger(total) || total < 1 || total > 2000) { console.error('--tracks 需为 1–2000（规模验收口径为 1000/2000，小值仅用于脚本冒烟）'); exit(1) }
const root = argOf('--out', `.workbuddy/qcd-fixture-${total}`)

// ---- PNG（带 CRC32；像素用 LCG 伪随机，deflate 无法压缩，稳定产生近 1MiB 大图）----
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c } return t })()
function crc32(buf) { let c = -1; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function makePng(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6 // 8bit RGBA
  const rowBytes = 1 + width * 4
  const raw = Buffer.alloc(height * rowBytes)
  let seed = (width * 1000003 + height * 7 + 1) >>> 0
  for (let i = 0; i < raw.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; raw[i] = i % rowBytes === 0 ? 0 : seed >>> 24 } // 行首 filter=0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0))])
}
// 大图 500×500 RGBA 噪声：raw ≈1,000,500B，PNG 总量必须落在服务端 1MiB 上限内。
const BIG_COVER = makePng(500, 500)
if (BIG_COVER.length > 1024 * 1024) { console.error(`大图超限：${BIG_COVER.length}`); exit(1) }
const SMALL_COVER = makePng(8, 8)

// ---- MP3：40 帧 CBR 128kbps/44.1kHz/mono（≈16.7KB，时长 ≈1.04s），music-metadata 可解析 ----
function makeMp3() {
  const frame = Buffer.alloc(417)
  frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0xc0
  for (let i = 32; i < 417; i += 97) frame[i] = (i * 31) & 0xff
  return Buffer.concat(Array.from({ length: 40 }, () => frame))
}
// 最小 ID3v2.3 + APIC：内嵌封面回退路径的夹具形态（与 server/test/cover-cache.test.ts 同构）。
function withEmbeddedCover(mp3, image, mime = 'image/png') {
  const body = Buffer.concat([Buffer.from([0x00]), Buffer.from(mime + '\0', 'latin1'), Buffer.from([0x03]), Buffer.from([0x00]), image])
  const frame = Buffer.concat([
    Buffer.from('APIC', 'latin1'),
    Buffer.from([(body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff]),
    Buffer.from([0, 0]), body
  ])
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'), Buffer.from([0x03, 0x00, 0x00]),
    Buffer.from([(frame.length >>> 21) & 0x7f, (frame.length >>> 14) & 0x7f, (frame.length >>> 7) & 0x7f, frame.length & 0x7f])
  ])
  return Buffer.concat([header, frame, mp3])
}

const mp3 = makeMp3()
const mp3Embedded = withEmbeddedCover(mp3, SMALL_COVER)
const ARTISTS = ['歌手甲', '歌手乙', '歌手丙', '邓测试', 'Artist Five', '林夕友', 'Zhou Jielun']

await mkdir(join(root, 'audio'), { recursive: true })
await mkdir(join(root, 'covers'), { recursive: true })
await mkdir(join(root, 'lyrics'), { recursive: true })

function lrcOf(i) {
  if (i % 100 === 0) { // 近 256KB 大歌词（服务端上限 256KB，须留余量）
    return Array.from({ length: 52 }, (_, k) => `[0${k}:10.00]${'歌词填充'.repeat(400)}`).join('\n')
  }
  return Array.from({ length: 8 }, (_, k) => `[00:0${k}.50] 这是第 ${i} 首测试歌曲的第 ${k + 1} 行歌词`).join('\n') + '\n'
}

const entries = []
let bigCovers = 0, smallCovers = 0, embedded = 0, noCover = 0, withLyrics = 0, bigLyrics = 0
for (let i = 0; i < total; i++) {
  const id = `t${String(i).padStart(4, '0')}`
  const zh = i % 2 === 0
  const title = zh ? `测试歌曲${i}号` : `Song ${i} Demo`
  const artist = ARTISTS[i % ARTISTS.length]
  const slot = i % 10
  let coverField = null, coverBytes = null
  if (slot === 0) { coverField = `covers/${id}.png`; coverBytes = BIG_COVER; bigCovers++ }
  else if (slot === 1 || slot === 2) { coverField = `covers/${id}.png`; coverBytes = SMALL_COVER; smallCovers++ }
  else if (slot === 3 || slot === 4) { embedded++; await writeFile(join(root, 'audio', `${id}.mp3`), mp3Embedded) }
  if (coverBytes) {
    await writeFile(join(root, 'audio', `${id}.mp3`), mp3)
    await writeFile(join(root, 'covers', `${id}.png`), coverBytes)
  } else if (slot > 4) { noCover++; await writeFile(join(root, 'audio', `${id}.mp3`), mp3) }
  const hasLrc = i % 5 !== 4
  let lyricsField = null
  if (hasLrc) { lyricsField = `lyrics/${id}.lrc`; if (i % 100 === 0) bigLyrics++; withLyrics++; await writeFile(join(root, 'lyrics', `${id}.lrc`), lrcOf(i)) }
  entries.push({ id, title, file: `audio/${id}.mp3`, artist, ...(coverField ? { cover: coverField } : {}), ...(lyricsField ? { lyrics: lyricsField } : {}) })
  if ((i + 1) % 200 === 0) console.log(JSON.stringify({ event: 'progress', written: i + 1, total }))
}
await writeFile(join(root, 'catalog.json'), JSON.stringify(entries, null, 1))
console.log(JSON.stringify({
  event: 'done', root, tracks: total, bigCovers, smallCovers, embedded, noCover, withLyrics, bigLyrics,
  note: 'catalog 相对路径均为正斜杠；目录在 .workbuddy 下，属一次性夹具，可整目录删除'
}))
