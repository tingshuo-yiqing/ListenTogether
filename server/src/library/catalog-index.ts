import { createHash } from 'node:crypto';
import type { Track } from './catalog.js';

// 队列/检索扩展（QC-A）：CatalogIndex 是服务端内存的公开编目索引。
// 只持有公开元数据投影，绝不持有 path/封面字节——字段与 /api/rooms/:code/catalog 下发口径一致。
export type TrackSummary = {
  id: string; title: string; durationMs: number;
  artist: string | null; hasCover: boolean; coverVer: number | null;
  hasLyrics: boolean; lyricsVer: number | null;
  album: string | null;
};

export function toSummary(t: Track): TrackSummary {
  return { id: t.id, title: t.title, durationMs: t.durationMs, artist: t.artist, hasCover: t.cover !== null, coverVer: t.coverVer, hasLyrics: t.lyricsPath !== null, lyricsVer: t.lyricsVer, album: t.album ?? null };
}

/** 查询与排序统一 NFKC、转小写、合并空白后做子串匹配（设计默认值，不做拼音检索）。 */
export function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** 检索参数非法统一抛 400，由 HTTP 层转 {"message":...}；不触碰曲库状态，无副作用。 */
export class SearchError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

export const SEARCH_MAX_Q_CODEPOINTS = 100;
export const SEARCH_LIMIT_DEFAULT = 30, SEARCH_LIMIT_MAX = 50;

export type SearchResult = {
  catalogRevision: string;
  total: number;
  offset: number;
  items: TrackSummary[];
};

export class CatalogIndex {
  readonly revision: string;
  readonly tracksById: Map<string, Track>;
  // 按规范化歌名、歌手、id 依次排序的稳定顺序；构建一次，分页 O(1) 切片、过滤 O(N)。
  private readonly sorted: TrackSummary[];
  private readonly normalized: { title: string; artist: string }[];

  constructor(tracks: Track[]) {
    this.tracksById = new Map(tracks.map(t => [t.id, t]));
    this.sorted = tracks.map(toSummary).sort((a, b) => {
      const ka = `${normalizeText(a.title)}\u0000${normalizeText(a.artist ?? '')}\u0000${a.id}`;
      const kb = `${normalizeText(b.title)}\u0000${normalizeText(b.artist ?? '')}\u0000${b.id}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    this.normalized = this.sorted.map(s => ({ title: normalizeText(s.title), artist: normalizeText(s.artist ?? '') }));
    // revision 由公开编目内容生成（含封面/歌词版本），同一内容恒定，不含时间戳。
    this.revision = createHash('sha256')
      .update(this.sorted.map(s => JSON.stringify(s)).join('\n'))
      .digest('hex').slice(0, 16);
  }

  get size() { return this.sorted.length; }

  /** 按 ID 查找：O(1)，取代播放路径里反复线性 find（千首曲库的必要边界）。 */
  track(id: string): Track | undefined { return this.tracksById.get(id); }

  /** 纯检索：不触碰房间/播放状态。q 为空串时按稳定排序浏览。 */
  search(q: string, offset: number, limit: number): SearchResult {
    if (typeof q !== 'string') throw new SearchError(400, '查询词无效');
    if ([...q].length > SEARCH_MAX_Q_CODEPOINTS) throw new SearchError(400, `查询词最多 ${SEARCH_MAX_Q_CODEPOINTS} 个字符`);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new SearchError(400, 'offset 无效');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_LIMIT_MAX) throw new SearchError(400, `limit 应为 1–${SEARCH_LIMIT_MAX}`);
    const query = normalizeText(q);
    let total = 0, start = -1;
    const items: TrackSummary[] = [];
    if (!query) {
      total = this.sorted.length;
      start = Math.min(offset, total);
      for (let i = start; i < Math.min(start + limit, total); i++) items.push(this.sorted[i]);
    } else {
      for (let i = 0; i < this.sorted.length; i++) {
        const n = this.normalized[i];
        if (!n.title.includes(query) && !n.artist.includes(query)) continue;
        if (total === offset) start = total;
        if (total >= offset && items.length < limit) items.push(this.sorted[i]);
        total++;
      }
      if (start < 0) start = total;
    }
    return { catalogRevision: this.revision, total, offset: start, items };
  }
}
