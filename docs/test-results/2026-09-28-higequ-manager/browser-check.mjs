/** 页面交互离线回归：真实Chrome + 当前HTML，HTTP夹具不访问音乐平台；后台落盘另由脚本单测覆盖。 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../../..');
const profile = await mkdtemp(join(tmpdir(), 'lt-browser-assets-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const tracks = ['a','b'].map(id => ({id,title:'测试歌曲 '+id,artist:'测试歌手',album:'测试专辑',genre:'流行',year:2020,
  lyrics:null,hasCover:false,file:'audio/'+id+'.mp3',effective:{artist:'测试歌手',hasLyrics:false,size:1024,durationMs:200000},id3:{}}));
let oldService = false; let delayLyrics = false; let applied = []; let delayed = false; let failOnce = false; let failApplyOnce = false; let restored = false; const requests = [];
const server = createServer(async (req,res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const path = req.url.split('?')[0];
  if (path === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(await readFile(join(root,'scripts/metadata-manager.html'))); }
  if (path.startsWith('/api/cover/')) { res.setHeader('Content-Type','image/png'); return res.end(png); }
  let value = {};
  if (path === '/api/tracks') value = {dir:'临时测试曲库',tracks};
  if (path === '/api/sources') value = {serviceVersion:oldService?'20260927-1240':'20260929-hi-aac',sources:[{name:'higequ',label:'Hi歌曲优先（未命中时尝试其他来源）'}],default:'higequ',minScore:0.8};
  if (path === '/api/trash') value = {items:restored?[]:[{run:'fixture',key:'key',id:'removed',title:'已删歌曲',artist:'歌手'}],errors:[]};
  if (path === '/api/trash/restore') { restored=true; value={ok:true,message:'已恢复'}; }
  if (path === '/api/lyrics-files') value = {files:[]};
  if (path.endsWith('/lyrics')) {
    const id=path.split('/')[3]; const t=tracks.find(t=>t.id===id);
    if(delayLyrics && id==='a')await new Promise(r=>setTimeout(r,500));
    if(!t.lyrics){res.statusCode=404;value={message:'当前歌曲尚未保存歌词'};}
    else value={path:t.lyrics,text:'[00:00.00]已保存歌词 '+id+' <img src=x onerror=alert(1)>'};
  }
  if (path.endsWith('/sync')) {
    const id = path.split('/')[3]; const t = tracks.find(x=>x.id===id); const reqBody = JSON.parse(body);
    requests.push(reqBody);
    if (failOnce) { failOnce=false;res.writeHead(502,{'Content-Type':'application/json'});return res.end(JSON.stringify({message:'fixture unavailable'})); }
    if (delayed) await new Promise(r=>setTimeout(r,500));
    // changes 的口径与真实管理器一致：单曲（默认）匹配到歌词就报，已有歌词也报（替换由人工点应用确认）；
    // 批量带 onlyIfEmpty 时只报空缺，避免一键把整库歌词换掉。
    const replaceLyrics = reqBody.onlyIfEmpty !== true;
    value = {id,source:'higequ',sourceUrl:'https://higequ.com/player/123/',attempts:[{source:'higequ',status:'matched'}],metadataAccepted:true,status:'matched-change',score:1,minScore:0.8,local:t,
      candidate:{artist:t.artist,album:t.album,genre:t.genre,year:t.year},assetToken:'ticket-'+id,
      changes:{...(!t.hasCover?{cover:'ticket-'+id}:{}),...(!t.lyrics||replaceLyrics?{lyrics:'ticket-'+id}:{})},
      coverUrl:'data:image/png;base64,'+png.toString('base64'),hasCover:t.hasCover,hasLyrics:Boolean(t.lyrics),
      lyrics:{status:'matched',source:'Hi歌曲',kind:'synced',text:'[00:00.00]测试歌词预览'}};
  }
  if (path.endsWith('/apply')) {
    if(failApplyOnce){failApplyOnce=false;res.writeHead(409,{'Content-Type':'application/json'});return res.end(JSON.stringify({message:'fixture stale ticket'}));}
    const id=path.split('/')[3]; const data=JSON.parse(body); applied.push({id,...data});
    const t=tracks.find(t=>t.id===id); if(data.fields.cover)t.hasCover=true;
    if(data.fields.lyrics){t.lyrics='lyrics/'+id+'.lrc';t.effective.hasLyrics=true;}
    value={ok:true,failed:[],message:'已应用封面、歌词'};
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
});
let browser; let ws;
try {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  browser=spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
     '--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
  let port;
  for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(port,'Chrome debugging ready');
  const tab=await (await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();
  ws=new WebSocket(tab.webSocketDebuggerUrl);await once(ws,'open');
  let seq=0;const pending=new Map();const errors=[];
  ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result);}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw new Error('UI timeout '+expression);};
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1050,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  await wait('tracks.length === 2');
  await wait("$('s-source').value === 'higequ'");
  assert.equal(await evaluate("$('service-warning').hidden"),true);
  oldService=true;await evaluate('loadSources()');
  assert.equal(await evaluate("$('service-warning').hidden"),false);
  oldService=false;await evaluate('loadSources()');
  await evaluate("select('a');$('current-lyrics-preview').open=true");
  await wait("$('current-lyrics-status').textContent.includes('尚未保存歌词')");
  await evaluate("document.getElementById('btn-sync').click()");
  await wait("document.querySelectorAll('#sync-result input:checked').length === 2");
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#sync-result input:checked'), x=>x.dataset.field)"),['cover','lyrics']);
  await evaluate("document.querySelector('#sync-result details').open=true");
  const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  await writeFile(join(import.meta.dirname,'candidate-ui.png'),Buffer.from(screenshot.data,'base64'));
  await evaluate("document.getElementById('btn-apply-sync').click()");
  await wait("tracks.find(t=>t.id==='a').lyrics !== null");
  assert.deepEqual(Object.keys(applied[0].fields).sort(),['cover','lyrics']);
  await evaluate("document.getElementById('btn-batch-go').click()");
  await wait("!batchRunning && batchResults.length === 1");
  await evaluate("document.getElementById('btn-batch-apply').click()");
  await wait("tracks.find(t=>t.id==='b').lyrics !== null");
  await evaluate("select('a');previewCurrentLyrics()");
  assert.ok(await evaluate("$('current-lyrics-text').textContent.includes('已保存歌词 a')"));
  delayLyrics=true;
  await evaluate("select('a');select('b')");
  await wait("$('current-lyrics-text').textContent.includes('已保存歌词 b')");
  await new Promise(r=>setTimeout(r,650));
  assert.ok(await evaluate("$('current-lyrics-text').textContent.includes('已保存歌词 b')"));
  assert.equal(await evaluate("document.querySelector('#current-lyrics-text img')"),null);
  delayLyrics=false;
  assert.equal(applied[1].onlyIfEmpty,true);assert.equal(applied[1].id,'b');
  assert.ok(requests.every(r=>r.includeLyrics===true));
  assert.ok(requests.some(r=>r.onlyIfEmpty===true),'批量匹配请求必须带 onlyIfEmpty 补缺口径');
  // 已有歌词（b 刚被批量补上）时：单曲匹配把歌词默认勾上，应用即替换；已有封面不自动勾。
  await evaluate("select('b'); document.getElementById('btn-sync').click()");
  await wait("document.querySelectorAll('#sync-result input').length === 2");
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#sync-result input:checked'), x=>x.dataset.field)"),['lyrics']);
  assert.ok(await evaluate("Array.from(document.querySelectorAll('#sync-result tr'),r=>r.textContent).some(t=>t.includes('已有歌词（已默认勾选'))"));
  assert.ok(await evaluate("document.getElementById('sync-status').textContent.includes('旧 .lrc 保留原地')"));
  delayed=true;
  await evaluate("select('a'); document.getElementById('btn-sync').click(); select('b')");
  await new Promise(r=>setTimeout(r,800));
  assert.equal(await evaluate("document.getElementById('sync-result').textContent"),'');
  delayed=false;
  // 分类筛选与专辑检索。
  await evaluate("$('f-gap').value='cover';renderList()");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"),0);
  await evaluate("$('f-gap').value='';$('f-filter').value='测试专辑';renderList()");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"),2);
  await evaluate("$('f-filter').value='not-found';renderList()");
  assert.equal(await evaluate("document.querySelectorAll('.track-item').length"),0);
  await evaluate("$('f-filter').value='';$('f-sort').value='missing';renderList()");
  // 一首失败后可单独重试，已成功候选不丢；批量仍只补缺。
  tracks.forEach(t=>t.genre=null);
  await evaluate("refresh()"); failOnce=true;
  await evaluate("$('btn-batch-go').click()");
  await wait("!batchRunning && batchFailures.length===1");
  assert.equal(await evaluate("batchResults.length"),1);
  await evaluate("$('btn-batch-retry').click()");
  await wait("!batchRunning && batchFailures.length===0");
  assert.equal(await evaluate("batchResults.length"),2);
  tracks.find(t=>t.id==='b').hasCover=false;
  await evaluate("refresh()");
  await evaluate("$('btn-batch-go').click()");await wait("!batchRunning");
  failApplyOnce=true;
  await evaluate("$('btn-batch-apply').click()");
  await wait("!batchRunning && batchFailures.length===1");
  assert.equal(await evaluate("batchFailures[0].id"),'b');
  await evaluate("$('btn-batch-retry').click()");await wait("!batchRunning && batchFailures.length===0");
  await evaluate("$('btn-batch-apply').click()");await wait("!batchRunning && tracks.find(t=>t.id==='b').hasCover");
  // 停止只影响后续请求，正在处理的一首完成后保留结果。
  delayed=true;
  await evaluate("$('btn-batch-go').click();$('btn-batch-stop').click()");
  await wait("!batchRunning");
  assert.equal(await evaluate("batchResults.length"),1);
  delayed=false;
  await evaluate("$('btn-trash').click()");
  await wait("document.querySelector('#trash-items button')!==null");
  await evaluate("document.querySelector('#trash-items button').click()");
  await wait("$('trash-items').textContent.includes('回收站为空')");assert.equal(restored,true);
  await evaluate("$('trash-close').click();select('a');$('btn-sync').click()");
  await wait("$('sync-result').textContent.includes('Hi歌曲')");
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"),true,'窄屏无页面横向溢出');
  const narrow=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  await writeFile(join(import.meta.dirname,'mobile-ui.png'),Buffer.from(narrow.data,'base64'));
  // 低分文字候选可人工勾选应用，默认不勾；批量仍不把空 changes 当作可补字段。
  await evaluate("select('a');renderSync({source:'qq',score:0.6,minScore:0.8,metadataAccepted:false,local:{artist:'kuwo'},candidate:{artist:'五月天'},changes:{}})");
  assert.equal(await evaluate("document.querySelector('#sync-result input').disabled"),false);
  assert.equal(await evaluate("document.querySelector('#sync-result input').checked"),false);
  assert.equal(await evaluate("$('btn-apply-sync').disabled"),false);
  await evaluate("document.querySelector('#sync-result input').click();$('btn-apply-sync').click()");
  await wait("$('btn-apply-sync').disabled");
  assert.equal(applied.at(-1).fields.artist,'五月天');
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log('Chrome UI PASS: filters, sort, retry, stop, trash restore, 390px layout, resource selection, single apply, batch onlyIfEmpty, stale response isolation, no JS exceptions');
} finally {
  ws?.close();if(browser && browser.exitCode===null){const exited=once(browser,'exit');browser.kill();await exited;}
  server.closeAllConnections();server.close();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
