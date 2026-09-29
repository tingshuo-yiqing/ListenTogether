/** 匹配附属资源：歌词失败可跳过；封面只从受信图床下载，限制重定向、时间与字节数。 */
const UA = 'ListenTogetherMetadata/0.2 (personal library manager)';
export const LYRICS_LIMIT = 256 * 1024;
export const COVER_LIMIT = 1024 * 1024;

export function allowedCoverUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
      && (u.hostname === 'y.gtimg.cn' || /^img[0-9]+\.kuwo\.cn$/.test(u.hostname) || /^p[0-9]+\.music\.126\.net$/.test(u.hostname)
        || u.hostname === 'coverartarchive.org' || u.hostname === 'archive.org'
        || /^(?:[a-z0-9-]+\.)+archive\.org$/.test(u.hostname));
  } catch { return false; }
}

/** 超时覆盖整个响应流；每一跳都验域名，不允许平台重定向到本机或任意地址。 */
export async function fetchLimited(url, limit, allow, request = globalThis.fetch) {
  const signal = AbortSignal.timeout(12000);
  for (let hop = 0; hop < 5; hop++) {
    if (!allow(url)) throw new Error('资源地址不在允许的来源内');
    const res = await request(url, { redirect: 'manual', signal, headers: { 'User-Agent': UA } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (!location) throw new Error('资源重定向缺少地址');
      url = new URL(location, url).href;
      continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`资源请求失败 HTTP ${res.status}`); }
    if (Number(res.headers.get('content-length')) > limit) {
      await res.body?.cancel(); throw new Error('资源超过大小上限');
    }
    const chunks = [];
    let size = 0;
    if (!res.body) throw new Error('资源响应为空');
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > limit) throw new Error('资源超过大小上限');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('资源重定向次数过多');
}

export function imageExtension(data) {
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('封面不是 JPG、PNG 或 WebP 图片');
}

const normalized = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
/** 不降级取搜索榜首：歌名、歌手一致且时长差不超过10秒才采用，优先有时间轴。 */
export function pickLyrics(rows, local) {
  if (!Array.isArray(rows)) throw new Error('歌词来源响应结构异常');
  if (!normalized(local.title) || !normalized(local.artist) || !(local.durationMs > 0)) return null;
  const hits = rows.filter(r => normalized(r.trackName) === normalized(local.title)
    && normalized(r.artistName) === normalized(local.artist)
    && Number.isFinite(r.duration) && Math.abs(r.duration * 1000 - local.durationMs) <= 10000)
    .map(r => {
      const synced = typeof r.syncedLyrics === 'string' && /\[\d{1,3}:\d{2}(?:[.:]\d+)?\]/.test(r.syncedLyrics);
      const text = synced ? r.syncedLyrics : r.plainLyrics;
      if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > LYRICS_LIMIT) return null;
      return { text: text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim() + '\n',
        kind: synced ? 'synced' : 'plain', source: 'LRCLIB', artist: r.artistName,
        title: r.trackName, duration: r.duration, id: r.id };
    }).filter(Boolean);
  hits.sort((a,b) => (a.kind === 'synced' ? 0 : 1) - (b.kind === 'synced' ? 0 : 1)
    || Math.abs(a.duration * 1000 - local.durationMs) - Math.abs(b.duration * 1000 - local.durationMs));
  return hits[0] || null;
}

/** 只抓公开歌词，不登录、不取音源；调用方隔离失败，不让歌词失败挡住文字/封面。 */
export async function findLyrics(local, request = globalThis.fetch) {
  if (!normalized(local.artist)) return { status: 'missing', message: '缺少可信歌手信息，跳过歌词匹配' };
  const url = new URL('https://lrclib.net/api/search');
  url.searchParams.set('track_name', local.title);
  url.searchParams.set('artist_name', local.artist);
  const data = await fetchLimited(url.href, 2 * 1024 * 1024,
    value => new URL(value).origin === 'https://lrclib.net', request);
  const candidate = pickLyrics(JSON.parse(data.toString('utf8')), local);
  return candidate ? { status: 'matched', ...candidate }
    : { status: 'missing', message: '没有匹配到歌词，已跳过' };
}
