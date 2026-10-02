import { readFile } from 'node:fs/promises';
import { parseFile } from 'music-metadata';
import { coverMime, type CoverArt, type Track } from './catalog.js';
import { Limiter } from './pool.js';

/** 全服封面字节 LRU 上限（按字节计费）：封面不再随 catalog 常驻内存（QC-D 默认 32MiB）。 */
export const COVER_CACHE_LIMIT_BYTES = 32 * 1024 * 1024;
/** 封面按需读取（含 ID3 内嵌重解析）的并发上限；同资源在途读取自动合并。 */
export const COVER_IO_CONCURRENCY = 4;

/**
 * 封面按需读取与有界缓存：catalog 只保留路径/来源/版本元数据，图片字节首次请求时
 * 读盘或重解析，之后命中 LRU 直接返回；键 = id + coverVer（封面更换 → 版本变化 → 自然换键）。
 * 读取失败（文件被移除/换坏）按 null 处理且不缓存失败，由路由层转 404。
 */
export class CoverCache {
  private cache = new Map<string, CoverArt>(); // Map 迭代序即 LRU 序（头最旧）
  private inflight = new Map<string, Promise<CoverArt | null>>();
  private bytes = 0;
  private peakBytes = 0;
  private limiter = new Limiter(COVER_IO_CONCURRENCY);

  constructor(private readonly limit: number = COVER_CACHE_LIMIT_BYTES) {}

  async get(track: Track): Promise<CoverArt | null> {
    const ref = track.cover;
    if (!ref || track.coverVer === null) return null;
    const key = `${track.id}-${track.coverVer}`;
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return hit; } // 触碰刷新热度
    let task = this.inflight.get(key);
    if (!task) {
      task = this.limiter.run(() => this.read(track, ref)).finally(() => this.inflight.delete(key));
      this.inflight.set(key, task);
    }
    const art = await task; // 同资源在途合并：并发请求共享同一次读取
    if (art) this.insert(key, art);
    return art;
  }

  private async read(track: Track, ref: NonNullable<Track['cover']>): Promise<CoverArt | null> {
    if (ref.file) {
      const data = await readFile(ref.file).catch(() => null);
      const mime = data && coverMime(data);
      return mime ? { mime, data } : null;
    }
    // 内嵌 APIC：按需重解析该 MP3（路径来自启动校验，绝不接受请求参数拼接）。
    const metadata = await parseFile(track.path, { duration: false }).catch(() => null);
    const picture = metadata?.common.picture?.[0];
    const data = picture ? Buffer.from(picture.data) : null;
    const mime = data && coverMime(data);
    return mime ? { mime, data } : null;
  }

  private insert(key: string, art: CoverArt) {
    const existing = this.cache.get(key);
    if (existing) { this.bytes -= existing.data.length; this.cache.delete(key); }
    this.cache.set(key, art);
    this.bytes += art.data.length;
    if (this.bytes > this.peakBytes) this.peakBytes = this.bytes;
    while (this.bytes > this.limit) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      const evicted = this.cache.get(oldest.value)!;
      this.bytes -= evicted.data.length;
      this.cache.delete(oldest.value);
    }
  }

  /** 观测与测试：占用/峰值字节、在途读取、解析并发与缓存键（keys 仅供测试断言淘汰顺序）。 */
  stats() {
    return { entries: this.cache.size, bytes: this.bytes, peakBytes: this.peakBytes, inflight: this.inflight.size, keys: [...this.cache.keys()], ...this.limiter.stats() };
  }
}
