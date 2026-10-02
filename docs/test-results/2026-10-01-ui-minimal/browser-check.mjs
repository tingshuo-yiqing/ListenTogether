/**
 * 精简版单 HTML 原型验收；仅启动独立 Chrome，不连接房间或音频。
 * 运行：node docs/test-results/2026-10-01-ui-minimal/browser-check.mjs
 * 拖动通过真实 CDP 鼠标/触摸事件；直接内存写入只用于构造角色、长队列和错误场景。
 */
import { CdpSession } from '../2026-09-30-ui-concept/browser-check.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const source=path.join(root,'docs/ui-prototype/index.html');
const chrome=process.env.UI_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port=Number(process.env.UI_CDP_PORT || 9399);
const endpoint=`http://127.0.0.1:${port}`;
const results={scope:'精简版离线原型，不代替 Android 或服务端验收',checks:[],screenshots:[],layouts:[],startedAt:new Date().toISOString()};
let browser,session;

async function waitChrome(){
  const until=Date.now()+15000;
  while(Date.now()<until){
    if(browser.exitCode!==null)throw new Error('独立 Chrome 提前退出');
    try{const r=await fetch(endpoint+'/json/version',{signal:AbortSignal.timeout(700)});if(r.ok)return await r.json();}catch{}
    await delay(100);
  }
  throw new Error('独立 Chrome 启动超时');
}
const hash=async()=>createHash('sha256').update(await readFile(source)).digest('hex');
async function assert(expression,message){if(!await session.evaluate(expression))throw new Error(message);}
async function check(name,task){
  try{await task();results.checks.push({name,passed:true});console.log('PASS '+name);}
  catch(error){
    results.checks.push({name,passed:false,error:error.message});console.log('FAIL '+name+': '+error.message);
    // 断言失败也必须释放按下状态，避免一次失败污染后续独立场景。
    try{
      await session.evaluate('cancelPress()');
      await session.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:1,y:1,button:'left',buttons:0,clickCount:1});
      await session.command('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      await reset();
    }catch{/* 页面不可用时保留原始失败，最终由浏览器收尾。 */}
  }
}
async function metrics(width=1440,height=1080,mobile=false){
  await session.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  await session.command('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:2});
  await delay(80);
}
async function reset(){
  await session.evaluate("cancelPress();state=initialState();document.body.dataset.theme='light';document.querySelector('#role-select').value='host';document.querySelector('#state-select').value='ready';go('queue');suppressClickUntil=0;");
  await delay(100);
}
async function shot(name,full=false){
  await delay(120);await session.screenshot(path.join(here,name+'.png'),full);results.screenshots.push(name+'.png');
}
async function point(selector,where='center'){
  return session.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('找不到 '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.left+${where==='left'?'Math.min(62,r.width/3)':'r.width/2'},y:r.top+r.height/2};})()`);
}
async function mouse(type,p){await session.command('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});}
async function touch(type,p,id=11){await session.command('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{...p,id}]});}
async function order(){return session.evaluate('state.queue.map(e=>e.entryId)');}
async function startMouse(selector='#app .queue-list .track-row',p){p??=await point(selector,'left');await mouse('mousePressed',p);await delay(450);await assert('!!dragSession?.active','长按未开始排序');return p;}

async function snapshot(name){
  const layout=await session.evaluate(`(()=>{
    const app=document.querySelector('#app'),a=app.getBoundingClientRect();
    const controls=[...app.querySelectorAll('.mini-controls button,.player-controls button,#player-seek')].filter(e=>!e.closest('[inert]')).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.id,width:r.width,height:r.height,visible:r.width>0&&r.height>0&&r.left>=a.left-.5&&r.right<=a.right+.5&&r.top>=0&&r.bottom<=innerHeight+.5};});
    const art=app.querySelector('.player-art')?.getBoundingClientRect();
    const small=[...app.querySelectorAll('button,input,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.closest('[inert]')&&!e.closest('.view-inner');}).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.textContent.trim(),width:r.width,height:r.height};}).filter(e=>e.width<47.5||e.height<47.5);
    return {name:${JSON.stringify(name)},viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth+1,controls,small,art:art?{width:art.width,height:art.height}:null,images:[...app.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0)};
  })()`);
  results.layouts.push(layout);
  if(layout.overflow)throw new Error(name+' 横向溢出');
  if(layout.controls.some(c=>!c.visible))throw new Error(name+' 播放控件被裁切');
  if(layout.small.length)throw new Error(name+' 控件命中区域小于 48px: '+JSON.stringify(layout.small));
  if(layout.art&&Math.abs(layout.art.width-layout.art.height)>1)throw new Error(name+' 封面非正方形');
  if(!layout.images)throw new Error(name+' 内嵌封面未加载');
  await shot(name);
}

try{
  await mkdir(here,{recursive:true});
  results.sourceHashBefore=await hash();
  try{await fetch(endpoint+'/json/version',{signal:AbortSignal.timeout(500)});throw new Error('指定 CDP 端口已占用，拒绝复用已有浏览器');}catch(error){if(error.message.includes('已占用'))throw error;}
  browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking',`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${path.join(root,'.workbuddy/ui-minimal-chrome')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  await waitChrome();
  const targets=await(await fetch(endpoint+'/json/list')).json();
  const target=targets.find(t=>t.type==='page');if(!target)throw new Error('无可用 Chrome 页面');
  session=await CdpSession.connect(target.webSocketDebuggerUrl);
  await session.command('Runtime.enable');await session.command('Page.enable');await session.command('Network.enable');
  await metrics();
  await session.command('Page.navigate',{url:pathToFileURL(source).href+'#queue'});
  await session.waitFor("typeof state==='object'&&!!document.querySelector('#app .queue-list')");

  await check('单一房间退出入口、图标导航与迷你播放器入口',async()=>{
    await assert("document.querySelectorAll('#app .app-actions button').length===1&&document.querySelector('#app .app-actions button').dataset.action==='leave-confirm'",'顶栏有重复入口');
    await assert("[...document.querySelectorAll('#app .tabs button')].every(b=>b.textContent.trim()===''&&b.getAttribute('aria-label'))&&document.querySelector('#tab-queue').getAttribute('aria-selected')==='true'",'导航不是有名称的图标');
    await assert("document.querySelectorAll('#app [data-action=player]').length===1&&!!document.querySelector('#app .mini-open')&&!document.querySelector('#app .current-card')",'当前歌曲有重复展示/入口');
    await assert("!document.querySelector('#app .row-index')&&[...document.querySelectorAll('#app .queue-list .track-copy')].every(e=>e.children.length===2)",'列表保留了辅助信息');
  });
  await check('成员面板集中二维码、复制邀请与分享',async()=>{
    await session.click('#app [data-action=members]');
    await assert("['toggle-qr','copy-invite','system-share'].every(a=>document.querySelector('#app .sheet [data-action='+a+']'))",'邀请入口没有集中在成员面板');
    await session.click('#app [data-action=toggle-qr]');
    await assert("!document.querySelector('#member-invite-qr').classList.contains('hidden')&&document.querySelector('#app [data-action=toggle-qr]').getAttribute('aria-expanded')==='true'",'二维码未展开');
    await shot('desktop-members');
    // 系统剪贴板与分享不实际执行，验证拒绝时仍可手动选择复制。
    await session.evaluate("showCopyFallback()");
    await assert("!document.querySelector('#copy-fallback').classList.contains('hidden')&&document.querySelector('#copy-fallback').textContent.includes('A84AFF71')",'复制失败没有回退');
    await session.click('#app button[data-action=close-modal]');
  });
  await check('行尾菜单只移除、成员仅撤回自己歌曲',async()=>{
    await session.click('#app .queue-list [data-action=track-menu]');
    await assert("[...document.querySelectorAll('#app .sheet-body button')].map(b=>b.dataset.action).join(',')==='remove'",'菜单有排序等重复动作');
    await session.click('#app button[data-action=close-modal]');
    await session.setValue('#role-select','member');
    await assert("!document.querySelector('#app [data-sortable]')&&document.querySelectorAll('#app [data-action=track-menu]').length===state.queue.filter(e=>e.mine).length",'成员权限错误');
    const before=await session.evaluate('state.queue.length');
    await session.click('#app .queue-list [data-action=track-menu]');
    await assert("document.querySelector('#app [data-action=remove]').textContent.includes('撤回')",'成员没有撤回提示');
    await session.click('#app [data-action=remove]');
    await assert(`state.queue.length===${before-1}`,'自己的歌曲未撤回');
    await reset();
  });
  await check('点歌加号成功变勾号、随机每次仅一首',async()=>{
    await session.click('#tab-search');
    const before=await session.evaluate('state.queue.length');
    const id=await session.evaluate("document.querySelector('#app [data-action=add]:not(:disabled)').dataset.id");
    await session.click(`#app [data-action=add][data-id="${id}"]`);
    await assert(`state.queue.length===${before+1}&&document.querySelector('#app [data-action=add][data-id="${id}"]').classList.contains('added')&&document.querySelector('#app [data-action=add][data-id="${id}"]').disabled`,'点歌未成功呈现勾号');
    await assert("document.querySelectorAll('#app [data-action=random]').length===1&&!document.querySelector('#app [data-action=random]').textContent.trim()",'随机按钮有数量选择');
    await session.click('#app [data-action=random]');
    await assert(`state.queue.length===${before+2}`,'随机没有只加一首');
    await shot('desktop-search');await reset();
  });
  await check('空房间首曲入队暂停、待播清空同步清除播放器',async()=>{
    await session.setValue('#state-select','empty');
    await session.click('#tab-search');await session.click('#app [data-action=add]:not(:disabled)');
    await assert('state.current&&state.queue.length===0&&!state.playing','首曲未以暂停状态开始');
    await session.click('#app .mini-controls [data-action=skip]');
    await assert("!state.current&&!state.playing&&!document.querySelector('#app .mini-player')",'队列耗尽后播放器未清空');await reset();
  });
  await check('展开播放器同时显示封面、歌手和歌词，无切换或回到开头',async()=>{
    await session.click('#app .mini-open');
    await assert("document.querySelector('#app .player-art')?.tagName==='IMG'&&document.querySelector('#app .player-track h3')&&document.querySelector('#app .lyrics-window')&&!document.querySelector('#app [data-action=restart]')&&!document.querySelector('#app [data-action=toggle-lyrics]')",'播放器未精简或仍需切换歌词');
    await assert("getComputedStyle(document.querySelector('#app .seek-readout')).opacity==='0'",'时间在闲置时常驻');
    await shot('desktop-player');
  });
  await check('进度时间仅在指针操作和键盘聚焦时显示',async()=>{
    await reset();await session.click('#app .mini-open');
    const p=await point('#player-seek');await mouse('mousePressed',p);
    await session.waitFor("parseFloat(getComputedStyle(document.querySelector('#app .seek-readout')).opacity)>.9");
    await mouse('mouseReleased',p);
    await session.waitFor("getComputedStyle(document.querySelector('#app .seek-readout')).opacity==='0'");
    await assert("getComputedStyle(document.querySelector('#app .seek-readout')).opacity==='0'",'指针结束时间未隐藏');
    await session.evaluate("document.querySelector('#player-seek').focus()");
    await session.command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    await session.command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    await delay(180);
    await assert("getComputedStyle(document.querySelector('#app .seek-readout')).opacity!=='0'",'键盘操作时间未显示');
    await session.evaluate("document.querySelector('#player-seek').blur()");await delay(180);
    await assert("getComputedStyle(document.querySelector('#app .seek-readout')).opacity==='0'",'失焦时间未隐藏');await reset();
  });
  await check('成员仅本机暂停、无下一首和跳进度权限',async()=>{
    await session.setValue('#role-select','member');const original=await session.evaluate('state.playing');
    await session.click('#app .mini-controls [data-action=play]');
    await assert(`state.localPaused&&state.playing===${original}`,'成员暂停改变共享播放');
    await session.click('#app .mini-open');
    await assert("document.querySelector('#player-seek').disabled&&!document.querySelector('#app .player-controls [data-action=skip]')",'成员能更改共享曲目/进度');await reset();
  });
  await check('长按鼠标拖动改变顺序并清理幽灵',async()=>{
    const original=await order();const p=await startMouse();const target=await point('#app .queue-list .track-row:last-child','left');
    await mouse('mouseMoved',{x:p.x,y:target.y});await delay(260);await mouse('mouseReleased',{x:p.x,y:target.y});
    await assert(`state.queue[0].entryId!==${JSON.stringify(original[0])}&&!dragSession&&!document.querySelector('.drag-ghost')`,'长按拖动未排序或幽灵未清理');await reset();
  });
  await check('长按前移动保留滚动、短按不排序',async()=>{
    const original=await order();const p=await point('#app .queue-list .track-row','left');
    await mouse('mousePressed',p);await mouse('mouseMoved',{x:p.x,y:p.y+18});await delay(430);await mouse('mouseReleased',{x:p.x,y:p.y+18});
    await assert(`JSON.stringify(state.queue.map(e=>e.entryId))===${JSON.stringify(JSON.stringify(original))}&&!dragSession&&!document.querySelector('.drag-ghost')`,'普通滑动误排序');await reset();
  });
  await check('Escape、角色变化和重连场景取消拖动',async()=>{
    for(const mode of ['escape','role','scenario']){
      await reset();const original=await order();await startMouse();
      if(mode==='escape')await session.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      else await session.setValue(mode==='role'?'#role-select':'#state-select',mode==='role'?'member':'reconnecting');
      await assert(`!dragSession&&!document.querySelector('.drag-ghost')&&JSON.stringify(state.queue.map(e=>e.entryId))===${JSON.stringify(JSON.stringify(original))}`,mode+' 没有取消排序');
    }await reset();
  });
  await check('无关 pointerId 不提交拖动、pointercancel 还原',async()=>{
    await startMouse();
    await session.evaluate("document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9876,pointerType:'mouse'}))");
    await assert('!!dragSession?.active','无关指针提交了排序');
    await session.evaluate("document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:dragSession.id,pointerType:'mouse'}))");
    await assert("!dragSession&&!document.querySelector('.drag-ghost')",'取消指针未清理');await mouse('mouseReleased',{x:1,y:1});await reset();
  });
  await check('Alt 加方向键排序，菜单仍只保留移除',async()=>{
    const first=await session.evaluate('state.queue[0].entryId');await session.evaluate("document.querySelector('#app [data-sortable]').focus()");
    await session.command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40,modifiers:1});
    await session.command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40,modifiers:1});
    await assert(`state.queue[1].entryId===${JSON.stringify(first)}&&document.activeElement.dataset.entry===${JSON.stringify(first)}`,'键盘排序未保留焦点');await reset();
  });

  await metrics(375,812,true);
  await check('真实触摸长按排序与底部边缘自动滚动',async()=>{
    await reset();await session.evaluate("state.queue=tracks.slice(1).map(t=>makeEntry(t,'我'));render()");
    const original=await order(),p=await point('#app [data-sortable]','left');await touch('touchStart',p);await delay(450);
    await assert('!!dragSession?.active','触摸长按未开始');
    const edge=await session.evaluate("(()=>{const r=document.querySelector('#room-panel').getBoundingClientRect();return {x:r.left+65,y:r.bottom-5}})()");
    await touch('touchMove',edge);await delay(1000);
    const scroll=await session.evaluate('document.querySelector("#room-panel").scrollTop');
    await shot('mobile-drag');await touch('touchEnd',edge);await delay(100);
    await assert(`state.queue[0].entryId!==${JSON.stringify(original[0])}&&!dragSession&&!document.querySelector('.drag-ghost')`,'触摸排序未提交');
    if(scroll<=30)throw new Error('边缘自动滚动未发生：'+scroll);await reset();
  });
  await check('触摸取消还原队列、成员触摸不开始排序',async()=>{
    await reset();const original=await order(),p=await point('#app [data-sortable]','left');await touch('touchStart',p);await delay(450);await touch('touchMove',{x:p.x,y:p.y+90});await delay(130);await touch('touchCancel',p);
    await assert(`!dragSession&&!document.querySelector('.drag-ghost')&&JSON.stringify(state.queue.map(e=>e.entryId))===${JSON.stringify(JSON.stringify(original))}`,'touchcancel未还原');
    await reset();await session.setValue('#role-select','member');const m=await point('#app .queue-list .track-row','left');await touch('touchStart',m);await delay(450);await touch('touchEnd',m);
    await assert('!dragSession','成员开启了拖动');await reset();
  });
  await check('聊天无逐条时间，失败保留文本并沿用原 ID 重试',async()=>{
    await reset();await session.evaluate("state.failNext=true;go('chat')");
    await session.setValue('#chat-draft','这个原文应在失败后保留');await session.click('#chat-form button[type=submit]');
    await assert("state.messages.at(-1).status==='pending'&&document.querySelector('#app .chat-time').textContent.includes('发送中')",'发送中状态缺失');
    const identity=await session.evaluate('(({id,requestId,clientMessageId,issuedAtMs})=>({id,requestId,clientMessageId,issuedAtMs}))(state.messages.at(-1))');
    await session.waitFor("state.messages.at(-1).status==='failed'");
    await assert("document.querySelector('#app .chat-bubble.failed').textContent==='这个原文应在失败后保留'&&!/21:0[678]/.test(document.querySelector('#chat-history').innerText)",'失败丢原文或保留逐条时间');
    await shot('mobile-chat-failed');await session.click('#app [data-action=retry-message]');await session.waitFor("state.messages.at(-1).status==='sent'");
    const after=await session.evaluate('(({id,requestId,clientMessageId,issuedAtMs})=>({id,requestId,clientMessageId,issuedAtMs}))(state.messages.at(-1))');
    if(JSON.stringify(identity)!==JSON.stringify(after))throw new Error('重试更改消息身份');
    await assert("document.querySelectorAll('#app .chat-name').length===state.messages.length",'聊天缺发送者身份');
  });
  await check('聊天草稿跨页保留、实时消息上限 100 条',async()=>{
    await session.setValue('#chat-draft','未发送的草稿');await session.click('#tab-queue');await session.click('#tab-chat');
    await assert("document.querySelector('#chat-draft').value==='未发送的草稿'",'切页丢草稿');
    await session.evaluate("for(let i=0;i<105;i++)document.querySelector('#incoming-message').click()");
    await assert('state.messages.length===100','消息窗口超出100');await reset();
  });
  await check('退出图标必须确认、取消留房、确认清除播放',async()=>{
    await session.click('#app [data-action=leave-confirm]');await assert("state.room&&state.current&&document.querySelector('#sheet-title').textContent==='退出房间？'",'点击图标直接退出');
    await session.click('#app button[data-action=close-modal]');await assert('state.room&&state.current','取消退出仍离房');
    await session.click('#app [data-action=leave-confirm]');await session.click('#app [data-action=leave]');
    await assert("state.screen==='home'&&!state.room&&!state.current&&!state.playing&&!document.querySelector('#app .mini-player')",'确认退出未清空播放');await reset();
  });

  for(const preset of [
    {name:'mobile',w:375,h:812,m:true},
    {name:'small',w:320,h:568,m:true},
    {name:'dark',w:375,h:812,m:true,dark:true},
  ])await check(preset.name+' 队列与播放器布局、触控区域和内嵌封面',async()=>{
    await metrics(preset.w,preset.h,preset.m);await reset();
    await session.evaluate(`document.body.dataset.theme=${JSON.stringify(preset.dark?'dark':'light')};`);
    await snapshot(preset.name+'-queue');
    await session.click('#app .mini-open');await snapshot(preset.name+'-player');
    await reset();
  });
  await check('桌面多屏总览完整可见，预览缩略图不响应操作',async()=>{
    await metrics();await reset();await session.click('#overview-toggle');
    await assert("document.querySelectorAll('.overview-phone-wrap').length===5&&[...document.querySelectorAll('.overview-phone-wrap')].every(e=>e.inert&&e.getAttribute('aria-hidden')==='true')&&document.documentElement.scrollWidth<=innerWidth+1",'总览不完整或能误操作');
    await shot('desktop-overview',true);await session.click('#overview-toggle');
  });
  await check('单 HTML 复制到空目录后离线打开，无外部资源请求',async()=>{
    const isolated=path.join(root,'.workbuddy/ui-minimal-isolated');await mkdir(isolated,{recursive:true});const file=path.join(isolated,'listen-together-minimal.html');await copyFile(source,file);
    const html=await readFile(file,'utf8');
    if(/<(?:script|link)[^>]+(?:src|href)\s*=\s*["'][^#]/i.test(html))throw new Error('存在外置脚本/样式');
    const before=session.events.length;
    await session.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await session.command('Page.navigate',{url:pathToFileURL(file).href+'#queue'});await delay(400);
    await session.waitFor("!!document.querySelector('#app .mini-open')&&[...document.querySelectorAll('#app img')].every(i=>i.complete&&i.naturalWidth>0)");
    await session.click('#app .mini-open');
    await assert("!!document.querySelector('#app .lyrics-window')&&!document.querySelector('audio,video')",'隔离单文件不能打开或创建媒体');
    const requests=session.events.slice(before).filter(e=>e.method==='Network.requestWillBeSent').map(e=>e.params.request.url);
    const external=requests.filter(u=>!u.startsWith('data:')&&!u.startsWith(pathToFileURL(file).href));
    results.offlineRequests=requests.map(u=>u.startsWith('data:')?'data:image embedded':u);
    if(external.length)throw new Error('离线文件还请求外部资源：'+external.join(','));
    await session.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  });
  await check('控制台无未捕获异常、交付源码在验收期间稳定',async()=>{
    results.runtimeExceptions=session.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text);
    if(results.runtimeExceptions.length)throw new Error(results.runtimeExceptions.join('\n'));
    results.sourceHashAfter=await hash();if(results.sourceHashAfter!==results.sourceHashBefore)throw new Error('验收期间源码变化，需要重跑');
  });
}catch(error){results.fatal=error.stack;console.error(error.stack);}
finally{
  if(session){try{await session.command('Browser.close',{},3000);}catch{}session.close();}
  if(browser&&browser.exitCode===null)browser.kill();
  results.finishedAt=new Date().toISOString();results.passed=results.checks.filter(c=>c.passed).length;results.total=results.checks.length;
  await writeFile(path.join(here,'browser-results.json'),JSON.stringify(results,null,2),'utf8');
  console.log(JSON.stringify({passed:results.passed,total:results.total,fatal:results.fatal??null,screenshots:results.screenshots.length}));
  if(results.fatal||results.checks.some(c=>!c.passed))process.exitCode=1;
}
