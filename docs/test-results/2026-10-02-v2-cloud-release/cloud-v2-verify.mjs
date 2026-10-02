// v2 发布后的真实 HTTP/WS/媒体/点歌/聊天验收；临时成员收尾退出，令牌仅驻内存。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const require = createRequire(process.env.LT_SERVER_PACKAGE ?? resolve('server/package.json'));
const WebSocket = require('ws');
const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const output = process.argv[3];
const checks = [], identities = [], sockets = [];
let failure;
const protocol = { 'x-listentogether-protocol': '2' };
const until = async predicate => {
  const end=Date.now()+8000;
  while(!predicate()){assert.ok(Date.now()<end,'8秒内未取得预期消息');await new Promise(r=>setTimeout(r,15));}
};
const http = (path,options={}) => fetch(base+path,{...options,signal:AbortSignal.timeout(8000)});
const auth = who => ({...protocol,authorization:'Bearer '+who.token});
const json = async(path,options={})=>{const r=await http(path,options);assert.equal(r.status,200,path);return r.json();};
const check = async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const connect = async who => {
 const messages=[];
 const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws/'+who.code,{headers:auth(who)});
 sockets.push(ws);ws.on('error',()=>{});ws.on('message',b=>messages.push(JSON.parse(String(b))));
 await new Promise((ok,no)=>{const timer=setTimeout(()=>no(new Error('WS握手超时')),8000);ws.once('open',()=>{clearTimeout(timer);ok();});ws.once('error',e=>{clearTimeout(timer);no(e);});});
 await until(()=>messages.some(m=>m.type==='state'));
 return {ws,messages};
};
const latest = (client,type)=>client.messages.filter(m=>m.type===type).at(-1);
const command = async(client,payload)=>{
 const id=randomUUID(); const request={...payload,issuedAtMs:Date.now(),...(payload.type==='chat.send'?{clientMessageId:id}:{requestId:id})};
 client.ws.send(JSON.stringify(request));
 await until(()=>client.messages.some(m=>(m.type==='ack'||m.type==='error')&&(m.requestId===id||m.clientMessageId===id)));
 const response=client.messages.find(m=>(m.type==='ack'||m.type==='error')&&(m.requestId===id||m.clientMessageId===id));
 return {request,response};
};
try {
 await check('health',async()=>assert.equal((await json('/health')).ok,true));
 await check('v2 capabilities',async()=>{const c=await json('/api/capabilities');assert.equal(c.protocol,2);assert.deepEqual(c.features,{queue:true,catalogSearch:true,chat:true});});
 await check('old HTTP client 426',async()=>assert.equal((await http('/api/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nickname:'旧协议探测'})})).status,426));
 const host=await json('/api/rooms',{method:'POST',headers:{...protocol,'content-type':'application/json'},body:JSON.stringify({nickname:'发布房主'})});identities.push(host);
 const member={...await json('/api/rooms/'+host.code+'/join',{method:'POST',headers:{...protocol,'content-type':'application/json'},body:JSON.stringify({nickname:'发布成员'})}),code:host.code};identities.push(member);
 const path='/api/rooms/'+host.code;
 await check('old WS client 426',async()=>{
  const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws/'+host.code,{headers:{authorization:'Bearer '+host.token}});sockets.push(ws);ws.on('error',()=>{});
  const status=await new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error('旧WS握手超时')),5000);ws.once('unexpected-response',(_,r)=>{clearTimeout(t);r.resume();ok(r.statusCode);});ws.once('open',()=>{clearTimeout(t);no(new Error('旧协议不应连接成功'));});});assert.equal(status,426);
 });
 const a=await connect(host), b=await connect(member);
 await check('real WS and unique animal avatars',async()=>{await until(()=>latest(a,'state').members.length===2);const s=latest(a,'state');assert.equal(new Set(s.members.map(m=>m.avatarId)).size,2);assert.ok(s.members.every(m=>typeof m.avatarId==='string'));assert.equal(s.track,null);assert.equal(s.playing,false);});
 const catalog=await json(path+'/catalog',{headers:auth(host)});
 await check('45 tracks and public album metadata',async()=>{assert.equal(catalog.length,45);for(const t of catalog){assert.equal(Object.keys(t).length,9);assert.equal('path'in t,false);assert.equal('size'in t,false);assert.equal(typeof t.album,'string');}});
 const search=await json(path+'/catalog/search?limit=10',{headers:auth(host)});
 await check('search pagination and album projection',async()=>{assert.equal(search.total,45);assert.equal(search.items.length,10);assert.equal(search.items[0].album,catalog.find(t=>t.id===search.items[0].id).album);});
 await check('stale revision 409',async()=>assert.equal((await http(path+'/catalog/search?revision=stale',{headers:auth(host)})).status,409));
 await check('unauthorized catalog 401',async()=>assert.equal((await http(path+'/catalog',{headers:protocol})).status,401));
 const track=catalog[0];
 await check('audio Range 206/1024 bytes',async()=>{const r=await http(path+'/audio/'+encodeURIComponent(track.id),{headers:{...auth(host),range:'bytes=0-1023'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,1024);assert.match(r.headers.get('content-range'),/^bytes 0-1023\//);});
 await check('audio without member 401',async()=>assert.equal((await http(path+'/audio/'+encodeURIComponent(track.id),{headers:protocol})).status,401));
 await check('cover and lyrics readable',async()=>{const c=catalog.find(t=>t.hasCover&&t.hasLyrics);assert.ok(c);assert.equal((await http(path+'/cover/'+encodeURIComponent(c.id),{headers:auth(host)})).status,200);assert.equal((await http(path+'/lyrics/'+encodeURIComponent(c.id),{headers:auth(host)})).status,200);});
 a.ws.send(JSON.stringify({type:'sync',clientTimeMs:Date.now()}));
 await check('WS clock domain response',async()=>{await until(()=>a.messages.some(m=>m.type==='clock'));assert.ok(Number.isFinite(latest(a,'clock').serverTimeMs));});
 const first=await command(a,{type:'queue.add',trackId:catalog[0].id});
 await check('first request promotes paused current track',async()=>{assert.equal(first.response.type,'ack');await until(()=>latest(a,'state').track?.id===catalog[0].id);assert.equal(latest(a,'state').playing,false);assert.equal(latest(a,'state').track.album,catalog[0].album);});
 const second=await command(b,{type:'queue.add',trackId:catalog[1].id});
 await check('member add broadcasts pending queue',async()=>{assert.equal(second.response.type,'ack');await until(()=>latest(a,'queue.state')?.entries.some(e=>e.trackId===catalog[1].id));});
 await check('replayed request keeps one queue entry',async()=>{b.ws.send(JSON.stringify(second.request));await until(()=>b.messages.filter(m=>m.type==='ack'&&m.requestId===second.request.requestId).length===2);assert.equal(latest(a,'queue.state').entries.filter(e=>e.trackId===catalog[1].id).length,1);});
 await check('member shared playback command rejected',async()=>{const result=await command(b,{type:'command',action:'play'});assert.equal(result.response.type,'ack');assert.equal(result.response.ok,false);assert.equal(result.response.error.status,403);assert.equal(latest(a,'state').playing,false);});
 const sent=await command(b,{type:'chat.send',text:'云端 v2 发布检查 🎵'});
 await check('chat ack and both clients receive same message',async()=>{assert.equal(sent.response.type,'ack');await until(()=>a.messages.some(m=>m.type==='chat.message'&&m.message.clientMessageId===sent.request.clientMessageId));const x=a.messages.find(m=>m.type==='chat.message'&&m.message.clientMessageId===sent.request.clientMessageId);assert.equal(x.message.text,sent.request.text);assert.ok(x.message.senderAvatarId);});
 await check('chat retry deduplicates seq',async()=>{b.ws.send(JSON.stringify(sent.request));await until(()=>b.messages.filter(m=>m.type==='ack'&&m.clientMessageId===sent.request.clientMessageId).length===2);assert.equal(a.messages.filter(m=>m.type==='chat.message'&&m.message.clientMessageId===sent.request.clientMessageId).length,1);});
 await check('host play and skip follow authoritative state',async()=>{assert.equal((await command(a,{type:'command',action:'play'})).response.type,'ack');assert.equal((await command(a,{type:'skip-next'})).response.type,'ack');await until(()=>latest(a,'state').track?.id===catalog[1].id);assert.equal(latest(a,'state').playing,true);});
 await check('exhausted queue clears current track',async()=>{assert.equal((await command(a,{type:'skip-next'})).response.type,'ack');await until(()=>latest(a,'state').track===null);assert.equal(latest(a,'state').playing,false);});
} catch(e) {failure={name:e.name,message:e.message};console.error('FAIL '+e.message);}
finally {
 for(const who of identities.reverse()){try{const r=await http('/api/rooms/'+who.code+'/membership',{method:'DELETE',headers:auth(who)});assert.ok([200,401,404].includes(r.status));}catch(e){failure??={name:e.name,message:'收尾退出失败：'+e.message};}}
 for(const ws of sockets)ws.terminate();
 const result={base,passed:checks.length,checks,failure:failure??null,temporaryMembersExited:!failure?.message.startsWith('收尾'),scope:'real HTTP/WS; no device or audible-sync claim'};
 if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({passed:checks.length,failure:result.failure}));
 if(failure)process.exitCode=1;
}
