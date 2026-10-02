import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parseFile } from 'music-metadata';
import { Limiter } from './pool.js';

const COVER_MAX_BYTES = 1024 * 1024;
const LYRICS_MAX_BYTES = 256 * 1024;
/** 启动解析（music-metadata + 封面/歌词读取）默认并发上限（QC-D）：千首规模不发起千路并发 IO。 */
export const PARSE_CONCURRENCY = 4;
/** 启动解析峰值并发的读数出口（规模验收记录「解析峰值并发」）。 */
export type LoadStats = { peak: number };

/** 管理器与服务端共用的图片边界：只接受 Android BitmapFactory 能稳定解码的三种格式。 */
export function coverMime(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** 内容哈希加少量文件时间，替换同一路径的图片/歌词时客户端缓存键必然有机会变化。 */
function contentVersion(data: Buffer, mtimeMs: number): number {
  const digest = Number.parseInt(createHash('sha256').update(data).digest('hex').slice(0, 10), 16);
  return digest * 4096 + (Math.round(mtimeMs) % 4096);
}

/** 独立封面优先、ID3 内嵌封面回退；启动只保留来源/类型/版本元数据，图片字节由 CoverCache 按需读取（QC-D）。 */
export type CoverArt = { mime: string; data: Buffer };
/** 封面引用：file 指向库内独立图片（已 realpath 校验），embedded = 回退 MP3 内嵌 APIC。 */
export type CoverRef = { mime: string; file: string | null; embedded: boolean };
export type Track = {
  id: string; title: string; durationMs: number; path: string; size: number;
  artist: string | null;
  album: string | null;
  cover: CoverRef | null;
  coverVer: number | null;
  lyricsPath: string | null;   // 库内 .lrc 绝对路径（仅服务端使用，绝不下发）
  lyricsVer: number | null;    // 歌词内容版本：客户端歌词缓存键 = id + lyricsVer，换词必失效
};

export async function loadCatalog(directory: string, options: { concurrency?: number; stats?: LoadStats } = {}): Promise<Track[]> {
  const root = await realpath(directory);
  const entries: unknown = JSON.parse(await readFile(resolve(root, 'catalog.json'), 'utf8'));
  if (!Array.isArray(entries)) throw new Error('catalog.json 必须是数组');
  const ids = new Set<string>();
  const limiter = new Limiter(options.concurrency ?? PARSE_CONCURRENCY);
  const tracks = await Promise.all(entries.map((entry: any) => limiter.run(async () => {
    if (!entry || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id) || ids.has(entry.id)
      || typeof entry.title !== 'string' || !entry.title.trim() || typeof entry.file !== 'string') {
      throw new Error('曲库条目无效或 ID 重复');
    }
    ids.add(entry.id);
    const path = await realpath(resolve(root, entry.file));
    // realpath 同时阻止 ../ 和指向曲库外部的符号链接，文件路径不来自 HTTP 参数。
    if (!path.startsWith(root + sep) || !path.toLowerCase().endsWith('.mp3')) throw new Error('只允许曲库内的 MP3');
    const info = await stat(path);
    const metadata = await parseFile(path, { duration: true });
    const durationMs = Math.round((metadata.format.duration ?? 0) * 1000);
    if (!info.isFile() || durationMs <= 0) throw new Error(`无法读取歌曲时长：${entry.id}`);
    // 歌手：手填 > ID3 common.artist（music-metadata 处理常见编码，仍乱码时手填覆盖即可）。
    const manualArtist = typeof (entry as Record<string, unknown>).artist === 'string'
      ? ((entry as Record<string, unknown>).artist as string).trim() || null : null;
    const artist = manualArtist ?? (typeof metadata.common.artist === 'string' && metadata.common.artist.trim()
      ? metadata.common.artist.trim() : null);
    // 专辑与歌手采用同一优先级：非空手填覆盖 ID3；未知/无效值回退，最终缺失为 null。
    const manualAlbum = typeof entry.album === 'string' ? entry.album.trim() || null : null;
    const album = manualAlbum ?? (typeof metadata.common.album === 'string' ? metadata.common.album.trim() || null : null);
    // 封面：catalog 的独立文件优先，便于管理器替换图片而不重写 MP3；没有独立文件时
    // 回退到 ID3 APIC。两种来源都限制在 1MB 内；启动时读一次只为算版本哈希，**字节随即
    // 丢弃不常驻**——运行期由 CoverCache 按需读取并做全服 32MiB LRU（QC-D）。
    const manifestCover = (entry as Record<string, unknown>).cover;
    let cover: CoverRef | null = null;
    let coverVer: number | null = null;
    if (typeof manifestCover === 'string' && manifestCover.trim()) {
      const coverPath = await realpath(resolve(root, manifestCover.trim()));
      if (!coverPath.startsWith(root + sep)) throw new Error('只允许曲库内的封面图片');
      const lower = coverPath.toLowerCase();
      if (!lower.endsWith('.jpg') && !lower.endsWith('.jpeg') && !lower.endsWith('.png') && !lower.endsWith('.webp')) {
        throw new Error('只允许 JPG、PNG 或 WebP 封面');
      }
      const coverInfo = await stat(coverPath);
      if (!coverInfo.isFile() || coverInfo.size > COVER_MAX_BYTES) throw new Error(`封面文件无效或超过 1MB：${entry.id}`);
      const data = await readFile(coverPath);
      const mime = coverMime(data);
      if (!mime) throw new Error(`封面不是有效的 JPG、PNG 或 WebP：${entry.id}`);
      cover = { mime, file: coverPath, embedded: false };
      coverVer = contentVersion(data, coverInfo.mtimeMs);
    } else {
      const picture = metadata.common.picture?.[0];
      if (picture && picture.data.length <= COVER_MAX_BYTES) {
        const data = Buffer.from(picture.data);
        const mime = coverMime(data);
        if (mime) {
          cover = { mime, file: null, embedded: true };
          coverVer = contentVersion(data, info.mtimeMs);
        }
      }
    }
    // 歌词：catalog.json 可选 lyrics（库内相对路径）。与 mp3 同一套 realpath 防逃逸；
    // 只接受 .lrc、≤256KB，写坏路径让服务启动失败，而不是运行期 500。
    let lyricsPath: string | null = null;
    let lyricsVer: number | null = null;
    const lyricsField = (entry as Record<string, unknown>).lyrics;
    if (typeof lyricsField === 'string' && lyricsField.trim()) {
      const lp = await realpath(resolve(root, lyricsField.trim()));
      if (!lp.startsWith(root + sep) || !lp.toLowerCase().endsWith('.lrc')) throw new Error('只允许曲库内的 LRC');
      const linfo = await stat(lp);
      if (!linfo.isFile() || linfo.size > LYRICS_MAX_BYTES) throw new Error(`歌词文件无效或超过 256KB：${entry.id}`);
      lyricsPath = lp;
      // 文件启动时已校验 ≤256KB，读入算版本代价可忽略；换词（指针换新文件或原地改写）都会变。
      lyricsVer = contentVersion(await readFile(lp), linfo.mtimeMs);
    }
    return { id: entry.id, title: entry.title, path, size: info.size, durationMs, artist, album, cover, coverVer, lyricsPath, lyricsVer };
    })));
  if (options.stats) options.stats.peak = limiter.stats().peak;
  return tracks;
}
