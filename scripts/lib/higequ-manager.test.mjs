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
    assert.equal((await api('/api/sources')).serviceVersion,'20260929-lyrics-preview');
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
