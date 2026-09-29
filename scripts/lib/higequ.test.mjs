import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHiSearch, parseHiDetail, htmlText } from './higequ.mjs';
import { createMetadataSource } from './metadata-sources.mjs';
import { allowedCoverUrl } from './metadata-assets.mjs';
const local = {title:'测试歌曲',artist:'测试歌手',durationMs:200000};
const search = '<div class="result-item" data-rid="123"><div class="result-info"><div class="result-title">测试歌曲</div><div class="result-artist">测试歌手</div><div class="result-album">专辑: 测试专辑</div></div></div>';
const detail = '<span id="music-title">测试歌曲</span><span id="music-artist">测试歌手</span><meta property="og:image" content="https://img1.kuwo.cn/a.jpg"><div id="lyrics-container"><div class="lyric-line" data-time="0">甲&amp;乙</div><div class="lyric-line" data-time="61.25">测试第二行</div></div><audio src="https://audio.invalid/music.mp3"></audio>';
const candidate = parseHiSearch(search)[0];
test('Hi歌曲：搜索HTML取原文、解实体，缺失年份流派不猜测，坏布局报错', () => {
  assert.equal(candidate.album,'测试专辑'); assert.equal(candidate.year,null); assert.equal(candidate.durationMs,null);
  assert.equal(htmlText('<b>A</b>&amp;&#x4e59;&#20057;&lt;script&gt;'),'A&乙乙<script>');
  assert.equal(parseHiSearch('没有找到歌曲').length,0);
  assert.throws(()=>parseHiSearch('<html>verification required</html>'),/结构变化/);
  assert.equal(parseHiSearch(search.replace('123','../abc')).length,0);
});
test('Hi歌曲：嵌套容器歌词解析到LRC，保留秒的小数，封面只认图床', () => {
  const r=parseHiDetail(detail,candidate,local);
  assert.equal(r.lyrics.text,'[00:00.00]甲&乙\n[01:01.25]测试第二行\n');
  assert.equal(r.lyrics.source,'Hi歌曲'); assert.equal(r.coverUrl,'https://img1.kuwo.cn/a.jpg');
  assert.equal(parseHiDetail(detail.replace('https://img1.kuwo.cn/a.jpg','https://127.0.0.1/secret'),candidate,local).coverUrl,null);
  assert.equal(allowedCoverUrl('https://img1.kuwo.cn.evil.test/a'),false);
});
test('Hi歌曲：身份不符、无时间点、越界或倒序歌词不能作为可应用资源', () => {
  assert.throws(()=>parseHiDetail(detail.replace('music-artist">测试歌手','music-artist">翻唱'),candidate,local),/身份不符/);
  for(const value of ['999999','-1','NaN','']) assert.equal(parseHiDetail(detail.replace('61.25',value),candidate,local).lyrics,null);
  assert.equal(parseHiDetail(detail.replace('data-time="0"','data-time="90"'),candidate,local).lyrics,null);
});
test('Hi歌曲：匹配只请求搜索/详情，不访问音频；限速串行', async () => {
  const urls=[];let clock=2000;const waits=[];
  const client=createMetadataSource('higequ',{request:async url=>{urls.push(url);return new Response(url.includes('/s/')?search:detail);},now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms;}});
  const r=await client.findMetadata(local);
  assert.equal(r.score,0.95); assert.equal(r.lyrics.kind,'synced');assert.equal(urls.length,2);
  assert.ok(urls.every(u=>u.startsWith('https://higequ.com/')));assert.ok(waits.includes(1000));
});
test('Hi歌曲：即使用户调低阈值也拒绝同名翻唱/现场版；详情失败保留文字候选且可重试', async () => {
  for (const input of [{...local,artist:'其他歌手'},{...local,title:'测试歌曲 (Live)'},{...local,artist:''}]) {
    let calls=0;
    const r=await createMetadataSource('higequ',{delayMs:0,request:async()=>{calls++;return new Response(search);}}).findMetadata(input,{minScore:0.1});
    assert.equal(r.identityAccepted,false);assert.equal(r.lyrics,null);assert.equal(calls,1);
  }
  const r=await createMetadataSource('higequ',{delayMs:0,request:async url=>{if(url.includes('/player/'))throw new Error('offline');return new Response(search);}}).findMetadata(local);
  assert.equal(r.partial,true);assert.equal(r.candidate.album,'测试专辑');assert.equal(r.lyrics,null);
});
test('Hi歌曲：网络错误和站外跳转均上抛，响应超过2MB被拒绝', async () => {
  let calls=0;
  const make=request=>createMetadataSource('higequ',{delayMs:0,request});
  await assert.rejects(make(async()=>{throw new Error('offline');}).findMetadata(local),/offline/);
  await assert.rejects(make(async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});}).findMetadata(local),/允许/);
  assert.equal(calls,1);
  await assert.rejects(make(async()=>new Response('x'.repeat(2*1024*1024+1))).findMetadata(local),/大小/);
});

// ---- 音频直链解析（2026-09-29 用户决策新增：单曲手动触发、仅开发测试） ----
import { parseHiAudio } from './higequ.mjs';
import { allowedAudioUrl, AUDIO_LIMIT } from './metadata-assets.mjs';

const AUDIO_URL = 'https://kw-lv.kuwo.cn/c7d9/resource/130739/trackmedia/M500016.mp3';
const playerPage = url => '<script>let code = "' + Buffer.from(url,'utf8').toString('base64') + '";\nlet realUrl = atob(code);</script>';

test('Hi歌曲音频：player 页 Base64 直链解析为 https+白名单 的 .mp3，其余一律拒绝', () => {
  assert.equal(parseHiAudio(playerPage(AUDIO_URL)), AUDIO_URL);
  // 站点若把直链放进 <audio src> 而不是 Base64 脚本，本适配器仍不认——那属于结构变化。
  assert.equal(parseHiAudio('<audio src="' + AUDIO_URL + '"></audio>'), null);
  assert.equal(parseHiAudio('<script>let realUrl = atob(code);</script>'), null);
  // 非 https / 非白名单域 / 坏 Base64 全部拒绝；.mp3/.aac/.m4a 后缀都放行（aac/m4a 由管理器转码）。
  assert.equal(parseHiAudio(playerPage(AUDIO_URL.replace('https://','http://'))), null);
  assert.equal(parseHiAudio(playerPage('https://cdn.evil.test/x/M500016.mp3')), null);
  assert.equal(parseHiAudio(playerPage('https://kw-lv.kuwo.cn/x/trackmedia/M500016.m4a')), 'https://kw-lv.kuwo.cn/x/trackmedia/M500016.m4a');
  assert.equal(parseHiAudio(playerPage('https://kw-bj.kuwo.cn/55/6a/lu/resource/a2/30/51/1649598311.aac')), 'https://kw-bj.kuwo.cn/55/6a/lu/resource/a2/30/51/1649598311.aac');
  assert.equal(parseHiAudio(playerPage(AUDIO_URL) + '!!'), AUDIO_URL); // 首个匹配生效，尾部脏数据忽略
  assert.equal(parseHiAudio('let code = "###";'), null); // 非 Base64 字符集视为无直链
});

test('Hi歌曲音频：白名单覆盖酷我 CDN 族，拒绝伪装域与非 443 端口', () => {
  assert.equal(allowedAudioUrl('https://kw-lv.kuwo.cn/a/b.mp3'), true);
  assert.equal(allowedAudioUrl('https://kw-m.kuwo.cn/a/b.mp3?k=1'), true);
  assert.equal(allowedAudioUrl('https://img1.kuwo.cn/a.jpg'), true); // 同一 CDN 族
  assert.equal(allowedAudioUrl('https://kw-lv.kuwo.cn.evil.test/a.mp3'), false);
  assert.equal(allowedAudioUrl('https://kw-lv.kuwo.cn:8080/a.mp3'), false);
  assert.equal(allowedAudioUrl('http://kw-lv.kuwo.cn/a.mp3'), false);
  assert.equal(allowedAudioUrl('https://user:pass@kw-lv.kuwo.cn/a.mp3'), false);
  assert.equal(AUDIO_LIMIT, 64 * 1024 * 1024);
});
