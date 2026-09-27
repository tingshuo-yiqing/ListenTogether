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
let applied = []; let delayed = false; const requests = [];
const server = createServer(async (req,res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const path = req.url.split('?')[0];
  if (path === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(await readFile(join(root,'scripts/metadata-manager.html'))); }
  if (path.startsWith('/api/cover/')) { res.setHeader('Content-Type','image/png'); return res.end(png); }
  let value = {};
  if (path === '/api/tracks') value = {dir:'临时测试曲库',tracks};
  if (path === '/api/sources') value = {sources:[{name:'qq',label:'QQ'}],default:'qq',minScore:0.8};
  if (path === '/api/lyrics-files') value = {files:[]};
  if (path.endsWith('/sync')) {
    const id = path.split('/')[3]; const t = tracks.find(t=>t.id===id); requests.push(JSON.parse(body));
    if (delayed) await new Promise(r=>setTimeout(r,500));
    value = {id,source:'qq',metadataAccepted:true,status:'matched-change',score:1,minScore:0.8,local:t,
      candidate:{artist:t.artist,album:t.album,genre:t.genre,year:t.year},assetToken:'ticket-'+id,
      changes:{...(!t.hasCover?{cover:'ticket-'+id}:{}),...(!t.lyrics?{lyrics:'ticket-'+id}:{})},
      coverUrl:'data:image/png;base64,'+png.toString('base64'),hasCover:t.hasCover,hasLyrics:Boolean(t.lyrics),
      lyrics:{status:'matched',kind:'synced',text:'[00:00.00]测试歌词预览'}};
  }
  if (path.endsWith('/apply')) {
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
  await evaluate("select('a'); document.getElementById('btn-sync').click()");
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
  assert.equal(applied[1].onlyIfEmpty,true);assert.equal(applied[1].id,'b');
  assert.ok(requests.every(r=>r.includeLyrics===true));
  delayed=true;
  await evaluate("select('a'); document.getElementById('btn-sync').click(); select('b')");
  await new Promise(r=>setTimeout(r,800));
  assert.equal(await evaluate("document.getElementById('sync-result').textContent"),'');
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log('Chrome UI PASS: resource selection, single apply, batch onlyIfEmpty, stale response isolation, no JS exceptions');
} finally {
  ws?.close();if(browser && browser.exitCode===null){const exited=once(browser,'exit');browser.kill();await exited;}
  server.closeAllConnections();server.close();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
