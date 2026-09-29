/** 真管理器离线闭环：Hi优先、逐源回退、歌词票据应用、回收恢复。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
test('真管理器：Hi优先与失败回退、只读匹配、歌词落库及回收恢复/冲突保护', {timeout:45000}, async()=>{
  const root=resolve(import.meta.dirname,'../..'), temp=await mkdtemp(join(tmpdir(),'lt-hi-'));
  const media=join(temp,'media'), trash=join(temp,'trash');let child;
  try {
    await mkdir(media); await cp(join(root,'demo-media/demo-soft.mp3'),join(media,'demo-soft.mp3'));
    const entries=[{id:'a',title:'Test Song',artist:'Artist',file:'demo-soft.mp3'}];
    const cat=join(media,'catalog.json'),mode=join(temp,'mode'),calls=join(temp,'calls');
    await writeFile(cat,JSON.stringify(entries)); await writeFile(mode,'ok'); await writeFile(calls,'');
    const preload=join(temp,'preload.mjs');
    const mockFetch = async(value)=>{
      const {readFileSync,appendFileSync}=await import('node:fs');
      const u=new URL(value), state=readFileSync(process.env.HI_MODE,'utf8');
      appendFileSync(process.env.HI_CALLS,u.hostname+u.pathname+'\n');
      if(u.hostname==='higequ.com') {
        if(state==='down'||state==='all-down')throw new Error('hi offline');
        if(u.pathname.startsWith('/s/'))return new Response('<div class="result-item" data-rid="1"><div class="result-info"><div class="result-title">Test Song</div><div class="result-artist">Artist</div><div class="result-album">专辑: Hi Album</div></div></div>');
        if(u.pathname==='/player/1/')return new Response('<span id="music-title">Test Song</span><span id="music-artist">Artist</span><meta property="og:image" content="https://img1.kuwo.cn/a.jpg"><div id="lyrics-container"><div class="lyric-line" data-time="0">fixture lyrics</div></div>');
      }
      if(u.hostname==='c.y.qq.com' && state!=='all-down')return Response.json({data:{song:{list:[{songmid:'qq1',songname:'Test Song',singer:[{name:'Artist'}],albumname:'QQ Album',interval:30}]}}});
      throw new Error('offline fixture refuses '+u.hostname);
    };
    await writeFile(preload,'globalThis.fetch = '+mockFetch.toString()+';');
    child=spawn(process.execPath,['--import',pathToFileURL(preload).href,join(root,'scripts/metadata-manager.mjs'),'--dir',media,'--trash',trash,'--cache',join(temp,'cache.json'),'--port','0'],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,HI_MODE:mode,HI_CALLS:calls}});
    let log='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);
    for(let i=0;i<120&&!/http:\/\/127.0.0.1:(\d+)/.test(log);i++)await new Promise(r=>setTimeout(r,50));
    const port=log.match(/http:\/\/127.0.0.1:(\d+)/)?.[1];assert.ok(port,log);
    const api=async(path,body,method=body?'POST':'GET')=>{const r=await fetch('http://127.0.0.1:'+port+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {httpStatus:r.status,...await r.json()};};
    assert.equal((await api('/api/sources')).serviceVersion,'20260929-hi-audio');
    assert.equal((await api('/api/tracks/a/lyrics')).httpStatus,404);
    assert.equal((await api('/api/tracks/missing/lyrics')).httpStatus,404);
    const sync=()=>api('/api/tracks/a/sync',{includeLyrics:true,refresh:true});
    let r=await sync();assert.equal(r.source,'higequ');assert.equal(r.lyrics.source,'Hi歌曲');assert.equal(r.lyrics.text,'[00:00.00]fixture lyrics\n');assert.equal(r.candidate.album,'Hi Album');
    assert.equal(await readFile(cat,'utf8'),JSON.stringify(entries));
    assert.ok(!(await readFile(calls,'utf8')).includes('lrclib'));assert.equal(r.attempts.length,1);
    const saved=await api('/api/tracks/a/apply',{fields:{album:r.changes.album,lyrics:r.assetToken}});assert.equal(saved.httpStatus,200);
    const stored=JSON.parse(await readFile(cat,'utf8'))[0];assert.equal(stored.album,'Hi Album');assert.equal(await readFile(join(media,stored.lyrics),'utf8'),r.lyrics.text);
    const preview = await api('/api/tracks/a/lyrics');
    assert.equal(preview.httpStatus,200);assert.equal(preview.text,r.lyrics.text);assert.equal(preview.path,stored.lyrics);
    const savedBytes=await readFile(cat);
    const lyricFile=join(media,stored.lyrics),lyricBytes=await readFile(lyricFile);
    await writeFile(lyricFile,'\uFEFF[00:00.00]中文 <img src=x onerror=alert(1)>');
    assert.equal((await api('/api/tracks/a/lyrics')).text,'[00:00.00]中文 <img src=x onerror=alert(1)>');
    await writeFile(lyricFile,Buffer.alloc(256*1024+1));assert.equal((await api('/api/tracks/a/lyrics')).httpStatus,422);
    await rm(lyricFile);assert.equal((await api('/api/tracks/a/lyrics')).httpStatus,404);
    await writeFile(lyricFile,lyricBytes);
    await writeFile(join(temp,'outside.lrc'),'outside');
    await writeFile(cat,JSON.stringify([{...stored,lyrics:'../outside.lrc'}]));
    assert.equal((await api('/api/tracks/a/lyrics')).httpStatus,422);
    await writeFile(cat,savedBytes);
    assert.deepEqual(await readFile(lyricFile),lyricBytes);
    assert.equal((await api('/api/tracks/a/sync',{includeLyrics:true,onlyIfEmpty:true})).changes.lyrics,undefined);
    await writeFile(mode,'down');r=await sync();assert.equal(r.source,'qq');assert.equal(r.attempts[0].status,'unavailable');assert.equal(r.lyrics.status,'unavailable');
    await writeFile(mode,'all-down');r=await sync();assert.equal(r.status,'needs-review');assert.equal(r.metadataAccepted,false);assert.equal(r.attempts.length,4);
    assert.equal((await api('/api/tracks')).tracks.length,1);
    const deleted=await api('/api/tracks/a?run=fixture&files=audio,lyrics',null,'DELETE');assert.equal(deleted.httpStatus,200);assert.equal(deleted.moved.length,2);
    const listing=await api('/api/trash');assert.equal(listing.items.length,1);const item=listing.items[0];
    const original=await readFile(deleted.moved.find(m=>m.kind==='audio').to);
    await writeFile(join(media,stored.file),'collision');
    const conflict=await api('/api/trash/restore',{run:item.run,key:item.key});assert.equal(conflict.httpStatus,409);assert.equal(await readFile(join(media,stored.file),'utf8'),'collision');assert.deepEqual(JSON.parse(await readFile(cat,'utf8')),[]);
    await rm(join(media,stored.file));
    assert.equal((await api('/api/trash/restore',{run:'../escape',key:item.key})).httpStatus,409);
    const restored=await api('/api/trash/restore',{run:item.run,key:item.key});assert.equal(restored.httpStatus,200);
    assert.deepEqual(JSON.parse(await readFile(cat,'utf8')),[stored]);assert.deepEqual(await readFile(join(media,stored.file)),original);
    await access(deleted.moved[0].to);assert.equal((await api('/api/trash')).items.length,0);
    assert.equal((await api('/api/trash/restore',{run:item.run,key:item.key})).httpStatus,409);
  } finally {
    if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    await rm(temp,{recursive:true,force:true});
  }
});

test('真管理器：Hi音频下载（Base64 直链→白名单→魔数校验→指针换新，旧文件原地保留）', {timeout:45000}, async()=>{
  const root=resolve(import.meta.dirname,'../..'), temp=await mkdtemp(join(tmpdir(),'lt-hi-audio-'));
  const media=join(temp,'media'), trash=join(temp,'trash');let child;
  try {
    await mkdir(media); await cp(join(root,'demo-media/demo-soft.mp3'),join(media,'demo-soft.mp3'));
    const entries=[
      {id:'a-ok',title:'Test Song',artist:'Artist',file:'demo-soft.mp3'},
      {id:'a-id',title:'Other Song',artist:'Artist',file:'demo-soft.mp3'}, // 同名不同曲：Hi 搜索只会返回 Test Song，身份必须判否
      {id:'a-no',title:'Test Song',artist:'Artist',file:'demo-soft.mp3'},
      {id:'a-evil',title:'Test Song',artist:'Artist',file:'demo-soft.mp3'},
      {id:'a-magic',title:'Test Song',artist:'Artist',file:'demo-soft.mp3'},
    ];
    const cat=join(media,'catalog.json'),mode=join(temp,'mode');
    await writeFile(cat,JSON.stringify(entries)); await writeFile(mode,'audio-ok');
    const preload=join(temp,'preload.mjs');
    // mockFetch 会被 toString() 序列化进 --import 预加载文件：**不能引用外层任何变量**（player/b64
    // 都必须内联，否则子进程 ReferenceError 且被端点包成 500，表象与网络失败难以区分）。
    const mockFetch = async(value)=>{
      const {readFileSync}=await import('node:fs');
      const u=new URL(value), state=readFileSync(process.env.HI_MODE,'utf8');
      const b64=s=>Buffer.from(s,'utf8').toString('base64');
      const player=(audioCode,artist='Artist')=>'<span id="music-title">Test Song</span><span id="music-artist">'+artist+'</span><meta property="og:image" content="https://img1.kuwo.cn/a.jpg"><div id="lyrics-container"><div class="lyric-line" data-time="0">fixture lyrics</div></div>'+(audioCode?'<script>let code = "'+audioCode+'";</script>':'');
      if(u.hostname==='higequ.com') {
        if(u.pathname.startsWith('/s/'))return new Response('<div class="result-item" data-rid="1"><div class="result-info"><div class="result-title">Test Song</div><div class="result-artist">Artist</div></div></div>');
        if(u.pathname==='/player/1/'){
          if(state==='audio-identity')return new Response(player(null,'翻唱歌手'));
          if(state==='audio-noaudio')return new Response(player(null));
          if(state==='audio-evil')return new Response(player(b64('https://cdn.evil.test/x/M500016.mp3')));
          return new Response(player(b64('https://kw-lv.kuwo.cn/c7d9/r/1/trackmedia/M500016.mp3')));
        }
      }
      if(u.hostname.endsWith('.kuwo.cn') && u.pathname.endsWith('.mp3')){
        if(state==='audio-magic')return new Response('<html>not audio</html>');
        return new Response(readFileSync(process.env.HI_AUDIO));
      }
      if(u.hostname.endsWith('.kuwo.cn'))return new Response(new Uint8Array([255,216,255,224,0,0,0,0])); // 最小 JPEG（魔数即可过 imageExtension）
      throw new Error('offline fixture refuses '+u.hostname);
    };
    await writeFile(preload,'globalThis.fetch = '+mockFetch.toString()+';');
    child=spawn(process.execPath,['--import',pathToFileURL(preload).href,join(root,'scripts/metadata-manager.mjs'),'--dir',media,'--trash',trash,'--cache',join(temp,'cache.json'),'--port','0'],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,HI_MODE:mode,HI_AUDIO:join(root,'demo-media/demo-soft.mp3')}});
    let log='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);
    for(let i=0;i<120&&!/http:\/\/127.0.0.1:(\d+)/.test(log);i++)await new Promise(r=>setTimeout(r,50));
    const port=log.match(/http:\/\/127.0.0.1:(\d+)/)?.[1];assert.ok(port,log);
    const api=async(path,method='POST')=>{const r=await fetch('http://127.0.0.1:'+port+path,{method});return {httpStatus:r.status,...await r.json()};};
    const catalog=async()=>JSON.parse(await readFile(cat,'utf8'));
    // 整首替换成功路径：音频指针换新 + 名字/歌手按 Hi 候选覆盖 + 歌词/封面新文件入链，旧文件原地保留。
    const ok=await api('/api/tracks/a-ok/higequ-replace');assert.equal(ok.httpStatus,200,JSON.stringify(ok));assert.ok(ok.ok);
    const after=(await catalog()).find(e=>e.id==='a-ok');assert.match(after.file,/^audio\/a-ok-[0-9a-f-]{36}\.mp3$/);
    assert.equal(after.title,'Test Song');assert.equal(after.artist,'Artist');
    assert.match(after.lyrics,/^lyrics\/a-ok-[0-9a-f-]{36}\.lrc$/);
    assert.match(after.cover,/^covers\/a-ok-[0-9a-f-]{36}\.jpg$/);
    const head=await readFile(join(media,after.file));assert.equal(head.subarray(0,3).toString(),'ID3');assert.ok(head.length>1024);
    assert.equal((await readFile(join(media,after.lyrics),'utf8')),'[00:00.00]fixture lyrics\n');
    await access(join(media,'demo-soft.mp3')); // 旧音频原地保留
    // 身份不符拒绝：catalog 与文件零变化。
    const before=(await catalog()).find(e=>e.id==='a-id');
    await writeFile(mode,'audio-identity');
    assert.equal((await api('/api/tracks/a-id/higequ-replace')).httpStatus,422);
    assert.deepEqual((await catalog()).find(e=>e.id==='a-id'),before);
    // 无直链 / 白名单外域名 / 非 MP3 魔数：分别 404 / 404 / 422，均不动库。
    await writeFile(mode,'audio-noaudio');
    assert.equal((await api('/api/tracks/a-no/higequ-replace')).httpStatus,404);
    await writeFile(mode,'audio-evil');
    assert.equal((await api('/api/tracks/a-evil/higequ-replace')).httpStatus,404);
    await writeFile(mode,'audio-magic');
    assert.equal((await api('/api/tracks/a-magic/higequ-replace')).httpStatus,422);
    await writeFile(mode,'audio-ok');
    assert.equal(JSON.stringify((await catalog()).map(e=>e.id)),JSON.stringify(entries.map(e=>e.id)));
    await access(join(media,'demo-soft.mp3'));
  } finally {
    if (child) child.kill();
    await rm(temp,{recursive:true,force:true});
  }
});

test('真管理器：从 Hi 搜索并导入整首新歌（音频+信息+歌词+封面；重复 ID 409、坏 rid 400）', {timeout:45000}, async()=>{
  const root=resolve(import.meta.dirname,'../..'), temp=await mkdtemp(join(tmpdir(),'lt-hi-import-'));
  const media=join(temp,'media'), trash=join(temp,'trash');let child;
  try {
    await mkdir(media);
    await writeFile(join(media,'catalog.json'),'[]');
    const mode=join(temp,'mode'); await writeFile(mode,'audio-ok');
    const preload=join(temp,'preload.mjs');
    const mockFetch = async(value)=>{
      const {readFileSync}=await import('node:fs');
      const u=new URL(value), state=readFileSync(process.env.HI_MODE,'utf8');
      const b64=s=>Buffer.from(s,'utf8').toString('base64');
      const player=(code)=>'<span id="music-title">Import Song</span><span id="music-artist">Import Artist</span><meta property="og:image" content="https://img1.kuwo.cn/import.jpg"><div id="lyrics-container"><div class="lyric-line" data-time="0">import line</div></div>'+(code?'<script>let code = "'+code+'";</script>':'');
      if(u.hostname==='higequ.com'){
        if(u.pathname.startsWith('/s/'))return new Response('<div class="result-item" data-rid="42"><div class="result-info"><div class="result-title">Import Song</div><div class="result-artist">Import Artist</div><div class="result-album">专辑: Import Album</div></div></div>');
        if(u.pathname==='/player/42/')return new Response(state==='audio-ok'?player(b64('https://kw-lv.kuwo.cn/c7d9/r/42/trackmedia/M500042.mp3')):player(null));
      }
      if(u.hostname.endsWith('.kuwo.cn') && u.pathname.endsWith('.mp3'))return new Response(readFileSync(process.env.HI_AUDIO));
      if(u.hostname.endsWith('.kuwo.cn'))return new Response(new Uint8Array([255,216,255,224,0,0,0,0]));
      throw new Error('offline fixture refuses '+u.hostname);
    };
    await writeFile(preload,'globalThis.fetch = '+mockFetch.toString()+';');
    child=spawn(process.execPath,['--import',pathToFileURL(preload).href,join(root,'scripts/metadata-manager.mjs'),'--dir',media,'--trash',trash,'--cache',join(temp,'cache.json'),'--port','0'],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,HI_MODE:mode,HI_AUDIO:join(root,'demo-media/demo-soft.mp3')}});
    let log='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);
    for(let i=0;i<120&&!/http:\/\/127.0.0.1:(\d+)/.test(log);i++)await new Promise(r=>setTimeout(r,50));
    const port=log.match(/http:\/\/127.0.0.1:(\d+)/)?.[1];assert.ok(port,log);
    const api=async(path,body,method=body?'POST':'GET')=>{const r=await fetch('http://127.0.0.1:'+port+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {httpStatus:r.status,...await r.json()};};
    const search=await api('/api/higequ/search',{query:'随便'});assert.equal(search.httpStatus,200);assert.equal(search.results[0].rid,'42');assert.equal(search.results[0].album,'Import Album');
    const imp=await api('/api/higequ/import',{rid:'42',album:search.results[0].album});assert.equal(imp.httpStatus,200,JSON.stringify(imp));
    const cat=JSON.parse(await readFile(join(media,'catalog.json'),'utf8'));assert.equal(cat.length,1);
    const e=cat[0];assert.equal(e.id,'hi-42');assert.equal(e.title,'Import Song');assert.equal(e.artist,'Import Artist');assert.equal(e.album,'Import Album');
    assert.equal(e.file,'audio/hi-42.mp3');assert.match(e.lyrics,/^lyrics\/hi-42-[0-9a-f-]{36}\.lrc$/);assert.match(e.cover,/^covers\/hi-42-[0-9a-f-]{36}\.jpg$/);
    const audio=await readFile(join(media,e.file));assert.equal(audio.subarray(0,3).toString(),'ID3');
    assert.equal(await readFile(join(media,e.lyrics),'utf8'),'[00:00.00]import line\n');
    // 重复导入同 rid → 409（默认 ID hi-42 已存在）；坏 rid → 400；无直链（mode 切换）→ 404。
    assert.equal((await api('/api/higequ/import',{rid:'42'})).httpStatus,409);
    assert.equal((await api('/api/higequ/import',{rid:'abc'})).httpStatus,400);
    await writeFile(mode,'audio-noaudio');
    assert.equal((await api('/api/higequ/import',{rid:'42',id:'hi-2'})).httpStatus,404);
    assert.equal(JSON.stringify(JSON.parse(await readFile(join(media,'catalog.json'),'utf8')).map(x=>x.id)),JSON.stringify(['hi-42']));
  } finally {
    if (child) child.kill();
    await rm(temp,{recursive:true,force:true});
  }
});
