/**
 * 外部元数据源共享实现的离线单测。
 *
 * 分层约定（docs/modules/10-testing-observability.md）：纯单测一律不出网。
 * 这里把 request / sleep / now 全部注入假实现，因此 MusicBrainz 的真实响应格式、
 * 限速等待、阈值分支都在本地可判定；网络可用性本身由界面端到端实测覆盖，不混进单测。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_MIN_SCORE,
  DEFAULT_SOURCE,
  METADATA_SOURCES,
  createMetadataSource,
  normalize,
  safeYear,
  artistCredit,
  cacheKey,
  mergeLocalFields,
  readId3Tags,
  queryFor,
  scoreCandidate,
  mapSearchCandidate,
  mapQQCandidate,
  mapNeteaseCandidate,
  rankScore,
  epochYear,
  buildChanges,
  coverCandidate,
  createMusicBrainz,
  createQQMusic,
  createNetEase,
} from './metadata-sources.mjs'

/**
 * 造一个假客户端：按 URL 匹配（子串或正则）路由到固定响应，记录调用顺序与等待时长。
 * URL 里是 percent-encoded 的中文，所以按艺术家条件区分请求要用正则而非中文字面量。
 */
function fakeBrainz(routes, { minScore = DEFAULT_MIN_SCORE, nowStart = 1000 } = {}) {
  const calls = []
  const waits = []
  let clock = nowStart
  const client = createMusicBrainz({
    minScore,
    request: async (url) => {
      calls.push(url)
      for (const [needle, reply] of routes) {
        const hit = needle instanceof RegExp ? needle.test(url) : url.includes(needle)
        if (hit) {
          if (reply instanceof Error) throw reply
          return reply
        }
      }
      throw new Error('未预期的请求：' + url)
    },
    sleep: async (ms) => { waits.push(ms); clock += ms },
    now: () => clock,
  })
  return { client, calls, waits }
}

const recordings = (...items) => ({ recordings: items })
const mbRecording = (id, title, artistCreditParts, length, score, releases) => ({
  id, title, 'artist-credit': artistCreditParts, length, score, releases,
})

test('归一化：剥版本括注、统一连接符、只留字母数字', () => {
  assert.equal(normalize('  稻子（2020 重制版） '), normalize('稻子'))
  assert.equal(normalize('A & B'), normalize('A and B'))
  assert.equal(normalize('What a Difference a Day Made'), normalize('what a difference a day made'))
})

test('年份解析：只认四位公历开头，其余一律 null', () => {
  assert.equal(safeYear('1997-06-01'), 1997)
  assert.equal(safeYear('2020'), 2020)
  assert.equal(safeYear(''), null)
  assert.equal(safeYear(null), null)
  assert.equal(safeYear('97'), null, '两位数字不能被当成合法年份')
  assert.equal(safeYear('待发行'), null)
})

test('artist-credit 分段数组拼成单串，非数组安全退化', () => {
  const credit = [{ name: '周杰伦' }, { name: ' ' }, { artist: { name: '费玉清' } }]
  assert.equal(artistCredit(credit), '周杰伦 & 费玉清')
  assert.equal(artistCredit(undefined), '')
  assert.equal(artistCredit('不是数组'), '')
})

test('缓存键随标题/艺术家变化，改条目不会命中旧候选', () => {
  const base = { id: 'a', file: 'a.mp3', title: '旧名', artist: 'X' }
  assert.equal(cacheKey(base), 'a:a.mp3:旧名:X')
  assert.notEqual(cacheKey(base), cacheKey({ ...base, title: '新名' }))
  assert.notEqual(cacheKey(base), cacheKey({ ...base, artist: '' }))
  assert.equal(cacheKey({ id: 'a', file: 'a.mp3', title: '旧名' }), 'a:a.mp3:旧名:', '缺 artist 不应出现 undefined')
})

test('生效值画像：catalog 手填优先、ID3 兜底，与后端 artist 同源', () => {
  const entry = { title: '稻子', artist: '手填歌手', year: 1997 }
  const id3 = { artist: 'ID3 歌手', album: 'ID3 专辑', year: 2000, genre: 'Pop', durationMs: 250400 }
  const merged = mergeLocalFields(entry, id3)
  assert.equal(merged.artist, '手填歌手')
  assert.equal(merged.year, 1997)
  assert.equal(merged.album, 'ID3 专辑', '未手填的字段才由 ID3 兜底')
  assert.equal(merged.durationMs, 250400)
  assert.equal(mergeLocalFields({ title: 'x' }, undefined).artist, '', '无 ID3 时不得抛')
  assert.equal(mergeLocalFields({ title: 'x' }, { durationMs: '坏值' }).durationMs, 0)
})

test('查询串：标题里的引号与反斜杠先剥掉，不能打断查询语法', () => {
  assert.equal(queryFor({ title: '正常' }), 'recording:"正常"')
  assert.equal(queryFor({ title: 'a"b', artist: 'c\\d' }), 'recording:"ab" AND artist:"cd"')
  assert.equal(queryFor({ title: ' x ', artist: '  ' }), 'recording:"x"', '空白艺术家退化为只按歌名')
})

test('打分：标题艺术家全等 + 时长接近给高分，跨语言标题给低分', () => {
  const local = { title: '稻子', artist: '周杰伦', durationMs: 250000 }
  const same = { title: '稻子', artist: '周杰伦', durationMs: 251000, score: 100 }
  assert.ok(scoreCandidate(local, same) >= 0.9, '完全一致应达默认阈值')
  const otherLang = { title: 'Rice Field', artist: 'Jay Chou', durationMs: 250000, score: 100 }
  assert.ok(scoreCandidate(local, otherLang) < 0.8, '中文原名 vs 罗马字转写不得自动落库，交人工')
  const farTime = { title: '稻子', artist: '周杰伦', durationMs: 400000, score: 100 }
  assert.ok(scoreCandidate(local, farTime) < scoreCandidate(local, same), '时长差 150 秒应扣分')
  assert.ok(scoreCandidate(local, { title: '稻子', artist: '周杰伦' }) <= 1, '总分封顶 1')
})

test('打分：本地没有艺术家时，艺术家维度完全不参与（既不加分也不扣分）', () => {
  const local = { title: '稻子', artist: '' }
  const s1 = scoreCandidate(local, { title: '稻子', artist: '甲', score: 100 })
  const s2 = scoreCandidate(local, { title: '稻子', artist: '乙', score: 100 })
  assert.equal(s1, s2, '空艺术家不应让某些候选莫名占优')
  // 单靠"官方相关度 + 歌名全等"= 0.35 + 0.4 = 0.75，够不到默认阈值 0.8：
  // 这是有意的——只凭歌名一致就自动写库，同名翻唱/重制必然误伤，留给人工勾。
  assert.equal(s1, 0.75)
  assert.ok(s1 < DEFAULT_MIN_SCORE)
})

test('mapSearchCandidate：搜索态取首个发行版，缺字段安全退化', () => {
  const mapped = mapSearchCandidate(mbRecording(
    'mbid-1', '稻子', [{ name: '周杰伦' }], 250000, 88,
    [{ id: 'rel-1', title: '幻想啊？', date: '2010-05-18', 'release-group': { id: 'rg-1' } }],
  ))
  assert.equal(mapped.mbid, 'mbid-1')
  assert.equal(mapped.album, '幻想啊？')
  assert.equal(mapped.year, 2010)
  assert.equal(mapped.releaseId, 'rel-1')
  assert.equal(mapped.durationMs, 250000)
  const bare = mapSearchCandidate({ title: 'x' })
  assert.equal(bare.mbid, null)
  assert.equal(bare.year, null)
  assert.equal(bare.durationMs, null)
})

test('写入映射：默认只补缺失，force 才覆盖，候选空值绝不抹掉好数据', () => {
  const entry = { artist: '手填', album: '', year: null }
  const candidate = { artist: '候选歌手', album: '候选专辑', year: 1997, genre: 'Pop' }
  assert.deepEqual(buildChanges(entry, candidate, false), { album: 1997 ? '候选专辑' : '', year: 1997, genre: 'Pop' } &&
    { album: '候选专辑', year: 1997, genre: 'Pop' }, '已有的 artist 不得被覆盖')
  assert.deepEqual(buildChanges(entry, candidate, true), candidate)
  assert.deepEqual(buildChanges({ artist: '保留' }, { artist: '' }, true), {}, '候选空串即便 force 也不写')
  assert.deepEqual(buildChanges(entry, null, true), {})
  assert.deepEqual(buildChanges(entry, undefined, false), {})
})

test('封面候选：无 releaseId 不给地址，有则只给地址不下载', () => {
  assert.equal(coverCandidate(null), null)
  assert.equal(coverCandidate({ releaseId: 'rel-1' }), 'https://coverartarchive.org/release/rel-1/front-250')
})

test('匹配：命中阈值才追详情请求，专辑/年份/流派以详情为权威', async () => {
  const { client, calls } = fakeBrainz([
    ['recording/?query', recordings(mbRecording(
      'mbid-1', '稻子', [{ name: '周杰伦' }], 250000, 95,
      [{ id: 'rel-old', title: '搜索态专辑', date: '2020-01-01' }],
    ))],
    ['/recording/mbid-1?', {
      title: '稻香',
      'artist-credit': [{ name: '周杰伦' }],
      releases: [
        { id: 'rel-new', title: '最新再版', date: '2020-05-01' },
        { id: 'rel-old', title: '魔杰座', date: '2008-10-15' },
        { id: 'rel-noDate', title: '无日期版' },
      ],
      genres: [{ name: 'Mandopop' }],
    }],
  ])
  const result = await client.findMetadata({ title: '稻子', artist: '周杰伦', durationMs: 250000 })
  assert.equal(result.lookedUp, true)
  assert.equal(result.candidate.album, '魔杰座', '多个发行版取日期最早的（最初发行，不是最新再版）')
  assert.equal(result.candidate.year, 2008)
  assert.equal(result.candidate.genre, 'Mandopop')
  assert.equal(result.candidate.releaseId, 'rel-old')
  assert.equal(calls.length, 2)
})

test('匹配：低于阈值不花第二次请求（省限速配额），候选原样回给人工复核', async () => {
  const { client, calls } = fakeBrainz([
    ['recording/?query', recordings(mbRecording(
      'mbid-x', '完全不同的歌', [{ name: '别人' }], 999000, 90, [{ id: 'rel-x', title: '某专辑' }],
    ))],
  ])
  const result = await client.findMetadata({ title: '稻子', artist: '周杰伦', durationMs: 250000 })
  assert.equal(calls.length, 1, '不达阈值就发详情请求会白耗配额')
  assert.equal(result.lookedUp, false)
  assert.ok(result.score < DEFAULT_MIN_SCORE)
  assert.equal(result.candidate.mbid, 'mbid-x', '候选仍要回显，界面据此让人比对')
})

test('匹配：带艺术家的查询查空时退回只按歌名再查一次', async () => {
  const found = recordings(mbRecording(
    'mbid-cn', '稻子', [{ name: '周傑倫' }], 250000, 60, [{ id: 'rel-cn', title: '魔杰座', date: '2008-10-15' }],
  ))
  const { client, calls } = fakeBrainz([
    [/artist%3A/, recordings()],
    [/recording\/\?query/, found],
  ])
  const result = await client.findMetadata({ title: '稻子', artist: '周杰伦', durationMs: 250000 })
  assert.equal(calls.length, 2, '中文录音 artist-credit 常不规范，必须兜底重查')
  assert.ok(!calls[1].includes('artist%3A'), '兜底查询不应再带艺术家条件')
  assert.equal(result.candidate.mbid, 'mbid-cn')
})

test('匹配：无候选返回 null 而不是零分假候选', async () => {
  const { client } = fakeBrainz([['recording/?query', { recordings: [] }]])
  const result = await client.findMetadata({ title: '查无此曲', artist: '' })
  assert.equal(result.candidate, null)
  assert.equal(result.score, 0)
  assert.equal(result.lookedUp, false)
})

test('匹配：网络错误必须抛给调用方，不得静默降级成"没匹配到"', async () => {
  const { client } = fakeBrainz([['recording/?query', new Error('socket hang up')]])
  await assert.rejects(
    () => client.findMetadata({ title: '稻子', artist: '周杰伦' }),
    /socket hang up/,
    '吞掉异常会让界面把网络故障显示成"该曲无候选"，用户会误填',
  )
})

test('限速：相邻请求之间至少间隔一个 delayMs，串行成单队列', async () => {
  const { client, calls, waits } = fakeBrainz([
    ['recording/?query', recordings(mbRecording('mbid-q', ' unrelated', [{ name: 'someone' }], 1000, 10, []))],
  ], { nowStart: 0 })
  await client.findMetadata({ title: '甲', artist: 'A' })
  await client.findMetadata({ title: '乙', artist: 'B' })
  assert.equal(calls.length, 2)
  assert.ok(waits.length >= 1, '第二次请求前必须等待')
  assert.ok(waits[0] > 0 && waits[0] <= 1100, `等待时长应落在 0–1100ms，实际 ${waits[0]}`)
})

test('详情：录音没有 mbid 时不追请求，直接沿用搜索态候选', async () => {
  // id 缺失 → 没有可查的详情端点，此时不得凭空发请求（原 CLI 的 mbid 守卫）。
  const { client, calls } = fakeBrainz([
    ['recording/?query', recordings(mbRecording(null, '稻子', [{ name: '周杰伦' }], 250000, 95, []))],
  ])
  const result = await client.findMetadata({ title: '稻子', artist: '周杰伦', durationMs: 250000 })
  assert.equal(calls.length, 1)
  assert.equal(result.candidate.mbid, null)
  assert.equal(result.candidate.album, '')
  assert.equal((await client.lookupRecording({ title: 'x' })).title, 'x')
})

// ============================ QQ 音乐 / 网易云音乐 ============================
// 下面的 fixture 是 2026-09-27 从两平台搜索接口真实响应里摘下来的形状（含各自短键/长键），
// 不是照文档想象的结构；平台改字段时应先在这里红一条，而不是等界面 502。

const QQ_SEARCH_RE = /search_for_qq_cp/
const NETEASE_SEARCH_RE = /cloudsearch/

/** QQ/网易云的注入签名带 method/body/Referer，与 MB 的 GET-only 不同，故另建假客户端。 */
function fakeSource(factory, routes, opts = {}) {
  const calls = []
  const waits = []
  let clock = opts.nowStart ?? 1000
  const client = factory({
    minScore: opts.minScore ?? DEFAULT_MIN_SCORE,
    request: async (url, options = {}) => {
      calls.push({ url, ...options })
      for (const [needle, reply] of routes) {
        const hit = needle instanceof RegExp ? needle.test(url) : url.includes(needle)
        if (hit) {
          if (reply instanceof Error) throw reply
          return reply
        }
      }
      throw new Error('未预期的请求：' + url)
    },
    sleep: async (ms) => { waits.push(ms); clock += ms },
    now: () => clock,
  })
  return { client, calls, waits }
}

const LOCAL_QINGTIAN = { title: '晴天', artist: '周杰伦', durationMs: 269000 }

const QQ_QINGTIAN = {
  data: { song: { list: [
    {
      songmid: '0039MnYb0qxYhV', songname: '晴天', singer: [{ name: '周杰伦' }],
      albumname: '叶惠美', albummid: '000MkMni19ClKG', interval: 269, pubtime: 1059580800,
      songname_hilight: '<span class="c_tx_highlight">晴天</span>',
      albumname_hilight: '<span class="c_tx_highlight">叶惠美</span>',
    },
    {
      songmid: '002uT1F1R1hEe', songname: '晴天 (Live)', singer: [{ name: '周杰伦' }],
      albumname: '地表最强演唱会', albummid: '', interval: 249, pubtime: 1572537600,
    },
  ] } },
}

const NE_QINGTIAN = {
  result: { songs: [
    // 榜首是平台排序给的翻唱版：真实响应里就是这样，靠打分把它压下去。
    {
      id: 255723258, name: '晴天(深情版)', ar: [{ name: 'Lucky小爱' }], fee: 8,
      al: { name: '晴天(深情版)', id: 255723258, picUrl: 'https://p1.music.126.net/a/1.jpg?param=32y32' },
      dt: 278961, publishTime: 1733068800000,
    },
    {
      id: 186016, name: '晴天', ar: [{ name: '周杰伦' }], fee: 1,
      al: { name: '叶惠美', id: 1234, picUrl: 'https://p1.music.126.net/b/2.jpg' },
      dt: 269000, publishTime: 1059580800000,
    },
  ] },
}

test('名次→相关度：榜首满分、榜尾低分，空列表不给分', () => {
  assert.equal(rankScore(0, 5), 100)
  assert.equal(rankScore(4, 5), 20)
  assert.equal(rankScore(0, 0), 0)
  assert.equal(rankScore(0, undefined), 0)
})

test('纪元时间→年份：QQ 用秒、网易云用毫秒，0 与非法值不得变成 1970', () => {
  assert.equal(epochYear(1059580800), 2003, 'QQ pubtime 秒')
  assert.equal(epochYear(1059580800000), 2003, '网易云 publishTime 毫秒')
  assert.equal(epochYear(0), null, '平台缺年份时给 0，写成 1970 就是假数据')
  assert.equal(epochYear(null), null)
  assert.equal(epochYear('abc'), null)
  assert.equal(epochYear(-1), null)
})

test('QQ 条目归一：只取纯字段，忽略平台拼好的高亮 HTML', () => {
  const c = mapQQCandidate(QQ_QINGTIAN.data.song.list[0], 0, 2)
  assert.equal(c.source, 'qq')
  assert.equal(c.title, '晴天')
  assert.equal(c.artist, '周杰伦')
  assert.equal(c.album, '叶惠美')
  assert.equal(c.year, 2003)
  assert.equal(c.durationMs, 269000, 'interval 是秒，必须换算成毫秒与本地时长同量纲')
  assert.equal(c.genre, '', 'QQ 的 genre 是数字枚举，不能当可读流派落库')
  assert.equal(c.coverUrl, 'https://y.gtimg.cn/music/photo_new/T002R800x800M000000MkMni19ClKG.jpg')
  assert.ok(!JSON.stringify(c).includes('span'), '高亮 HTML 不得混进候选值')
  assert.equal(mapQQCandidate({ songname: '无 mid' }, 0, 1), null, '没有 songmid 的条目无法回访，整条丢弃')
  assert.equal(mapQQCandidate(null, 0, 1), null)
})

test('网易云条目归一：cloudsearch 短键与旧接口长键都认', () => {
  const short = mapNeteaseCandidate(NE_QINGTIAN.result.songs[1], 1, 2)
  assert.equal(short.title, '晴天')
  assert.equal(short.artist, '周杰伦')
  assert.equal(short.album, '叶惠美')
  assert.equal(short.year, 2003)
  assert.equal(short.durationMs, 269000, 'dt 原生毫秒')
  assert.equal(short.coverUrl, 'https://p1.music.126.net/b/2.jpg', '剥掉尺寸后缀')
  const legacy = mapNeteaseCandidate({
    id: 999, name: '晴天', artists: [{ name: '周杰伦' }], duration: 269000,
    album: { name: '叶惠美', publishTime: 1059580800000 },
  }, 0, 1)
  assert.equal(legacy.artist, '周杰伦')
  assert.equal(legacy.album, '叶惠美')
  assert.equal(legacy.year, 2003, '短键缺失时用旧接口字段')
  assert.equal(mapNeteaseCandidate({ name: '无 id' }, 0, 1), null)
  assert.equal(mapNeteaseCandidate({ id: 5, name: 'x', publishTime: 0 }, 0, 1).year, null)
})

test('QQ 匹配：一次搜索请求拿全字段，且带 Referer（否则平台返回非 JSON）', async () => {
  const { client, calls } = fakeSource(createQQMusic, [[QQ_SEARCH_RE, QQ_QINGTIAN]])
  const r = await client.findMetadata(LOCAL_QINGTIAN)
  assert.equal(calls.length, 1, 'QQ 不需要二次详情请求，多发一次就是白耗频率')
  assert.equal(calls[0].referer, 'https://y.qq.com/')
  assert.equal(r.source, 'qq')
  assert.equal(r.candidate.album, '叶惠美')
  assert.equal(r.candidate.year, 2003)
  assert.ok(r.score >= DEFAULT_MIN_SCORE)
  assert.equal(r.coverUrl, r.candidate.coverUrl, '达阈值才给封面地址')
  assert.equal(r.query, '晴天 周杰伦', '关键词检索直接拼"歌名 歌手"')
})

test('QQ 匹配：响应结构变化必须抛错，不能静默判成"这首歌没收录"', async () => {
  const { client } = fakeSource(createQQMusic, [[QQ_SEARCH_RE, { code: 8 }]])
  await assert.rejects(() => client.findMetadata(LOCAL_QINGTIAN), /data\.song\.list/)
})

test('网易云匹配：平台榜首是翻唱时，按分数选中原唱而非榜首', async () => {
  const { client, calls } = fakeSource(createNetEase, [[NETEASE_SEARCH_RE, NE_QINGTIAN]])
  const r = await client.findMetadata(LOCAL_QINGTIAN)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.ok(String(calls[0].body).includes('s=%E6%99%B4%E5%A4%A9'), '表单里应带上检索词')
  assert.equal(r.candidate.id, '186016', '选中的必须是原唱条目')
  assert.equal(r.candidate.album, '叶惠美')
  assert.ok(r.score >= DEFAULT_MIN_SCORE)
})

test('网易云匹配：低于阈值时候选照回但不给封面地址', async () => {
  const onlyCover = { result: { songs: [{ id: 1, name: '晴天(深情版)', ar: [{ name: 'Lucky小爱' }], al: { name: 'x', picUrl: 'https://p1.music.126.net/a.jpg' }, dt: 400000 }] } }
  const { client } = fakeSource(createNetEase, [[NETEASE_SEARCH_RE, onlyCover]])
  const r = await client.findMetadata(LOCAL_QINGTIAN)
  assert.equal(r.candidate.id, '1')
  assert.ok(r.score < DEFAULT_MIN_SCORE)
  assert.equal(r.coverUrl, null, '还没确认是同一首歌，就不该递一个"点一下就存图"的链接')
})

test('网易云匹配：主接口不通退旧接口，两条都不通要把两个原因一起报出来', async () => {
  const legacy = { result: { songs: [{ id: 7, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' }, duration: 269000 }] } }
  const routes = [
    [/cloudsearch/, new Error('cloudsearch 被风控')],
    [/search\/get/, legacy],
  ]
  const { client, calls } = fakeSource(createNetEase, routes)
  const r = await client.findMetadata(LOCAL_QINGTIAN)
  assert.equal(calls.length, 2, '应发生一次回退')
  assert.equal(r.candidate.id, '7')

  const both = fakeSource(createNetEase, [
    [/cloudsearch/, new Error('主接口挂')],
    [/search\/get/, new Error('备接口挂')],
  ])
  await assert.rejects(
    () => both.client.findMetadata(LOCAL_QINGTIAN),
    /主接口挂[\s\S]*备接口挂/,
    '只报后者会把真实原因藏掉',
  )
})

test('网易云匹配：空结果返回 null 候选而不是零分假候选', async () => {
  const { client } = fakeSource(createNetEase, [[NETEASE_SEARCH_RE, { result: { songs: [] } }]])
  const r = await client.findMetadata({ title: '查无此曲', artist: '' })
  assert.equal(r.candidate, null)
  assert.equal(r.score, 0)
  assert.equal(r.coverUrl, null)
})

test('源注册表：默认源可用、名字唯一、未知源直接拒', () => {
  const names = METADATA_SOURCES.map((s) => s.name)
  assert.equal(new Set(names).size, names.length, '重名会让界面下拉出现两个同名项')
  assert.ok(names.includes(DEFAULT_SOURCE), '默认源必须在注册表里')
  assert.ok(names.includes('musicbrainz'), 'MB 仍是唯一能提供可读流派的源，不得被移除')
  for (const { name } of METADATA_SOURCES) {
    assert.equal(createMetadataSource(name).name, name, '每个注册项都要真能建出客户端')
  }
  assert.throws(() => createMetadataSource('kuwo'), /未知的元数据源/)
})

// ---- readId3Tags（2026-09-27 目录重构轮抽入 lib：管理器与 fetch-covers 共用）----
test('readId3Tags：正常标签照读、picture 转成 Buffer', async () => {
  const parseFile = async () => ({
    common: {
      artist: ' 许嵩 ', album: '自定义', genre: ['Pop'], year: 2009,
      picture: [{ format: 'image/jpeg', data: new Uint8Array([1, 2, 3]) }],
    },
    format: { duration: 241.868 },
  })
  const tags = await readId3Tags('C:/fake/a.mp3', parseFile)
  assert.equal(tags.artist, '许嵩')
  assert.equal(tags.album, '自定义')
  assert.equal(tags.genre, 'Pop')
  assert.equal(tags.year, 2009)
  assert.equal(tags.durationMs, 241868)
  assert.equal(tags.cover.mime, 'image/jpeg')
  assert.ok(Buffer.isBuffer(tags.cover.data) && tags.cover.data.equals(Buffer.from([1, 2, 3])))
})

test('readId3Tags：读失败/缺字段一律按无标签处理，绝不抛', async () => {
  const boom = async () => { throw new Error('损坏的文件') }
  const t1 = await readId3Tags('x', boom)
  assert.deepEqual(t1, { artist: null, album: null, genre: null, year: null, durationMs: 0, cover: null })
  const t2 = await readId3Tags('x', async () => ({ common: {}, format: {} }))
  assert.equal(t2.artist, null)
  assert.equal(t2.durationMs, 0)
  assert.equal(t2.cover, null)
})
