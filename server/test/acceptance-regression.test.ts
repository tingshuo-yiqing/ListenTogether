import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { Rooms, Fault } from '../src/rooms/store.js';
import { DedupeStore, REQUEST_TTL_MS, ROOM_BYTE_LIMIT } from '../src/rooms/dedupe.js';
import { createSender, snapshotFrames, MAX_GLOBAL_PENDING_BYTES } from '../src/realtime/outbox.js';
import { validClientMessage } from '../src/realtime/protocol.js';
import type { Track } from '../src/library/catalog.js';

const tracks = (n: number): Track[] => Array.from({length:n},(_,i)=>({ id:`t${i}`, title:'合成标题'.repeat(45), durationMs:10000, path:'', size:10, artist:null, cover:null, coverVer:null, lyricsPath:null, lyricsVer:null }));
async function until(predicate:()=>boolean) { const end=Date.now()+5000; while(!predicate()) { if(Date.now()>end) throw Error('timeout'); await new Promise(r=>setTimeout(r,10)); } }

test('认证 WS：null/数组/额外字段/错误 UUID 安全拒绝；command 去重、限频关联、队列实际帧分块', async t=>{
  const {app,rooms}=await buildApp(tracks(102),{timers:false});
  const address=await app.listen({host:'127.0.0.1',port:0});
  const credentials=rooms.create('回归'); const {room,member}=rooms.auth(credentials.code,credentials.token);
  const ws=new WebSocket(address.replace('http:','ws:')+'/ws/'+room.code,{headers:{authorization:'Bearer '+credentials.token,'x-listentogether-protocol':'2'}});
  const received:any[]=[]; const sizes=new Map<any,number>();
  ws.on('message',data=>{const m=JSON.parse(data.toString());received.push(m);sizes.set(m,Buffer.byteLength(data.toString()));});
  t.after(async()=>{ws.terminate();await app.close();});
  await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  for(const value of [null,[],false,{type:'queue.add',requestId:'wrong',issuedAtMs:Date.now(),trackId:'t0'}, {type:'queue.add',requestId:randomUUID(),issuedAtMs:Date.now(),trackId:'t0',extra:1}]) ws.send(JSON.stringify(value));
  await until(()=>received.filter(m=>m.type==='error'&&m.status===400).length===5);
  assert.equal(room.currentEntry,null); assert.equal(rooms.dedupe.stats().records,0);
  rooms.queueAdd(room,member,'t0');
  for(const action of ['play','pause','seek']) {
    const requestId=randomUUID(), before=room.version;
    const command={type:'command',requestId,issuedAtMs:Date.now(),action,...(action==='seek'?{positionMs:2000}:{})};
    ws.send(JSON.stringify(command));ws.send(JSON.stringify(command));
    await until(()=>received.filter(m=>m.type==='ack'&&m.requestId===requestId).length===2);
    const acks=received.filter(m=>m.type==='ack'&&m.requestId===requestId);
    assert.deepEqual(acks[0],acks[1]);assert.equal(room.version,before+1);
    ws.send(JSON.stringify({...command,action:action==='play'?'pause':'play'}));
    await until(()=>received.some(m=>m.requestId===requestId&&m.code==='IDEMPOTENCY_CONFLICT'));
    assert.equal(room.version,before+1);
  }
  const chatIds=Array.from({length:6},()=>randomUUID());
  for(const clientMessageId of chatIds) ws.send(JSON.stringify({type:'chat.send',clientMessageId,issuedAtMs:Date.now(),text:'🙂'.repeat(500)}));
  await until(()=>received.some(m=>m.type==='error'&&m.status===429));
  const rate=received.find(m=>m.type==='error'&&m.status===429);
  assert.equal(rate.clientMessageId,chatIds[5]);assert.ok(rate.retryAfterMs>0);
  assert.equal(rooms.dedupe.stats().records,8, '三次命令和五次聊天；冲突与限频不占槽位');
  assert.equal(room.chat[0].clientMessageId,chatIds[0]);
  for(let i=1;i<=100;i++)rooms.queueAdd(room,member,`t${i}`);
  await until(()=>received.some(m=>m.type==='queue.state'&&m.queueVersion===room.queueVersion&&m.chunkIndex===m.chunkCount-1));
  const chunks=received.filter(m=>m.type==='queue.state'&&m.queueVersion===room.queueVersion);
  assert.ok(chunks.length>1);assert.equal(chunks.length,chunks[0].chunkCount);
  assert.equal(chunks.flatMap(m=>m.entries).length,100);
  assert.ok(chunks.every(m=>sizes.get(m)!<=32*1024));
  assert.equal(new Set(chunks.map(m=>m.snapshotId)).size,1);
  assert.equal(rooms.snapshot(room).entryId,room.currentEntry!.entryId);
});

test('入站角色、数值和 Unicode 边界由真实 schema 校验',()=>{
  const base={type:'chat.send',clientMessageId:randomUUID(),issuedAtMs:1000};
  assert.ok(validClientMessage({...base,text:'🙂'.repeat(500)}));
  for(const value of [{...base,text:'🙂'.repeat(501)},{...base,text:'x',issuedAtMs:1.5},{...base,text:'x',issuedAtMs:Number.MAX_SAFE_INTEGER+1},{type:'state'},{type:'queue.sync',extra:true},{type:'command',action:'play'}]) assert.equal(validClientMessage(value),false);
});

test('TTL 精确边界与时间回拨不复活；预留取消、房间释放和全服容量不会漏账',()=>{
  let now=1000;const store=new DedupeStore(()=>now);const id=randomUUID();
  store.begin('r','m',id,now,'same').commit({ok:true,result:{}});
  now+=REQUEST_TTL_MS;
  assert.throws(()=>store.begin('r','m',id,1000,'same'),(e:unknown)=>e instanceof Fault&&e.code==='REQUEST_EXPIRED');
  now=1000;assert.throws(()=>store.begin('r','m',id,1000,'same'),(e:unknown)=>e instanceof Fault&&e.code==='REQUEST_EXPIRED');
  const ticket=store.begin('r','m',randomUUID(),601000,'pending');ticket.cancel();ticket.cancel();assert.equal(store.stats().bytes,0);
  assert.throws(()=>ticket.commit({ok:true,result:{}}));assert.equal(store.stats().bytes,0);
  const live=store.begin('r','m',randomUUID(),601000,'live');store.release('r');assert.throws(()=>live.commit({ok:true,result:{}}));assert.equal(store.stats().bytes,0);
  const small=new DedupeStore(()=>1000,5000);small.begin('r','m','1',1000,'1').commit({ok:true,result:{text:'x'.repeat(3000)}});
  assert.throws(()=>small.begin('other','m','2',1000,'2'),(e:unknown)=>e instanceof Fault&&e.code==='DEDUP_CAPACITY');
  assert.ok(small.begin('r','m','1',1000,'1').replay);small.release('r');assert.equal(small.stats().bytes,0);
  let later=1000;const expiry=new DedupeStore(()=>later,5000);
  expiry.begin('idle','m','1',later,'1').commit({ok:true,result:{text:'x'.repeat(3000)}});
  later+=REQUEST_TTL_MS;
  const fresh=expiry.begin('new','m','2',later,'2');fresh.cancel();assert.equal(expiry.stats().bytes,0);
});

test('去重每房间 4MiB 先预留后执行，指纹与结果均按实际存储计费',()=>{
  const store=new DedupeStore(()=>1000);let accepted=0;
  for(;accepted<10000;accepted++){
    try{store.begin('room','m',String(accepted),1000,'原文'.repeat(1000)+accepted).commit({ok:true,result:{text:'x'.repeat(3000)}});}
    catch(e){assert.ok(e instanceof Fault&&e.code==='DEDUP_CAPACITY');break;}
  }
  assert.ok(accepted>1000&&accepted<10000);assert.ok(store.stats().bytes<=ROOM_BYTE_LIMIT);
  assert.ok(store.begin('room','m','0',1000,'原文'.repeat(1000)+0).replay);
});

test('连续失效前缀和全部失效队列完整消费，播放意图与条目身份保持',()=>{
  for(const all of [false,true]){
    const rooms=new Rooms(tracks(5),()=>1000);const c=rooms.create('回归');const{room,member}=rooms.auth(c.code,c.token);
    for(let i=0;i<5;i++)rooms.queueAdd(room,member,`t${i}`);rooms.command(room.code,member.token,{action:'play'});
    const previous=room.currentEntry!.entryId;
    for(const id of all?['t1','t2','t3','t4']:['t1','t2','t3'])rooms.byId.delete(id);
    rooms.skipNext(room,member);assert.equal(room.queue.length,0);
    assert.equal(room.currentEntry?.trackId??null,all?null:'t4');assert.equal(room.playing,!all);
    assert.notEqual(rooms.snapshot(room).entryId,previous);
  }
});

test('分块完整帧 ≤32KiB；慢写逐块调度、在途快照保留、未开始快照合并',()=>{
  const g={count:0}, callbacks:Array<()=>void>=[], sent:any[]=[],closed:number[]=[];
  const socket={readyState:1,bufferedAmount:0,send(data:string,cb?:(e?:Error|null)=>void){const size=Buffer.byteLength(data);this.bufferedAmount+=size;sent.push(JSON.parse(data));callbacks.push(()=>{this.bufferedAmount-=size;cb?.();});},close(code:number){closed.push(code);}};
  const send=createSender(socket,g);
  const snap=(seq:number)=>({type:'chat.snapshot',latestSeq:seq,oldestSeq:1,gap:false,messages:Array.from({length:100},(_,i)=>({seq:i+1,text:'🙂'.repeat(500)}))});
  const packets=snapshotFrames(snap(100));assert.ok(packets.length>5);assert.ok(packets.every(p=>Buffer.byteLength(JSON.stringify(p))<=32768));
  send(snap(100));send({type:'event'});send(snap(101));send(snap(102));
  assert.equal(sent.length,1);while(callbacks.length)callbacks.shift()!();
  assert.equal(closed.length,0);assert.equal(g.count,0);
  assert.deepEqual([...new Set(sent.filter(m=>m.type==='chat.snapshot').map(m=>m.latestSeq))],[100,102]);
  assert.equal(sent.filter(m=>m.latestSeq===100).length,packets.length);
  assert.equal(sent.filter(m=>m.latestSeq===102).flatMap(m=>m.messages).length,100);
  assert.equal(sent[packets.length].type,'event');
});

test('发送同步抛错、回调错误、关闭迟到回调与全服上限只释放一次',()=>{
  for(const kind of ['throw','callback','close','global']){
    const g={count:kind==='global'?MAX_GLOBAL_PENDING_BYTES:0},closed:number[]=[];let callback:((e?:Error|null)=>void)|undefined;
    const socket={readyState:1,bufferedAmount:0,send(_data:string,cb?:(e?:Error|null)=>void){if(kind==='throw')throw Error('write');callback=cb;},close(code:number){closed.push(code);}};
    const send=createSender(socket,g);send({type:'test'});
    if(kind==='callback')callback!(Error('write'));
    if(kind==='close'){send.dispose();send.dispose();}
    callback?.();callback?.();
    assert.equal(g.count,kind==='global'?MAX_GLOBAL_PENDING_BYTES:0);
    assert.deepEqual(closed,kind==='close'?[]:[kind==='global'?1013:1011]);
  }
});
