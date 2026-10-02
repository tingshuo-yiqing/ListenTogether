/* 离线 UI 原型：所有队列、聊天与连接状态仅在本页内存中模拟，不调用产品接口。 */
'use strict';

const paths = {
  headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
  'arrow-right': '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  play: '<path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  next: '<path d="m5 5 10 7-10 7z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
  restart: '<path d="M3 11a9 9 0 1 1 2 7M3 5v6h6"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4m-6 8 6 4"/>',
  qr: '<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM12 3v3M3 12h3m6 0h3m6 0v3m-9 6v-3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shuffle: '<path d="M3 5h3c5 0 7 14 12 14h3M3 19h3c2 0 4-3 6-7m3-5c1-1 2-2 3-2h3m-3-3 3 3-3 3m0 8 3 3-3 3"/>',
  send: '<path d="m3 3 19 9-19 9 4-9zM7 12h15"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  signal: '<path d="M4 19v-3m5 3v-6m5 6V9m5 10V5"/>',
  wifi: '<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0m-9 4a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r=".5"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 10v4"/><rect x="5" y="10" width="11" height="4" rx=".5" fill="currentColor" stroke="none"/>',
  music: '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m2 4a6 6 0 0 1 2 4v2"/>',
  logout: '<path d="M9 4H4v16h5m5-12 4 4-4 4m-6-4h14"/>',
  alert: '<path d="m12 3 10 18H2zM12 9v5"/><circle cx="12" cy="18" r=".5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.music}</svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const tracks = [
  {id:'cheng-quan', title:'成全', artist:'林宥嘉', duration:309, cover:'cheng-quan.jpg'},
  {id:'dan-che', title:'单车', artist:'陈奕迅', duration:211, cover:'dan-che.jpg'},
  {id:'wan-feng', title:'晚风', artist:'伍佰 & China Blue', duration:225, cover:'wan-feng.jpg'},
  {id:'hong-dou', title:'红豆', artist:'王菲', duration:257, cover:'hong-dou.jpg'},
  {id:'fu-shi-shan-xia', title:'富士山下', artist:'陈奕迅', duration:259, cover:'fu-shi-shan-xia.png'},
  {id:'hong-se-gao-gen-xie', title:'红色高跟鞋', artist:'蔡健雅', duration:206, cover:'hong-se-gao-gen-xie.jpg'},
  {id:'ju-hao', title:'句号', artist:'G.E.M.邓紫棋', duration:235, cover:'ju-hao.jpg'},
  {id:'da-mian', title:'大眠', artist:'王心凌', duration:239, cover:'da-mian.jpg'},
  {id:'he-bu-ke', title:'有何不可', artist:'许嵩', duration:241, cover:'he-bu-ke.jpg'}
];
const screens = {
  home:{index:'01', title:'创建 / 加入', caption:'选择创建或加入；昵称与邀请码会在切换时保留。', notes:['进入即见表单，主操作只有一个。','服务器地址放进高级设置，邀请信息确认后再入房。','扫码沿用相机 / 相册两条路径。']},
  queue:{index:'02', title:'一起听 · 队列', caption:'点击待播歌曲的更多菜单，试试排序与撤回。', notes:['当前曲用浅杏色建立视觉重心。','待播歌曲按封面、歌名、点歌人展开。','排序与撤回收进更多菜单，保留 48dp 触达。']},
  search:{index:'03', title:'点一首歌', caption:'搜“陈奕迅”，或随机加一首，看看队列如何变化。', notes:['搜索歌名或歌手，标签一直可见。','已点歌曲不重复加入；成员最多待播 5 首。','随机 1 / 5 首是次要动作，不抢搜索。']},
  chat:{index:'04', title:'边听边聊', caption:'发送一句话；右侧可模拟失败，体验保留原文与重试。', notes:['消息轻量呈现，不打断播放。','失败保留文本，使用原消息 ID 重试。','翻阅历史时新消息不抢滚动。']},
  player:{index:'05', title:'沉浸播放器', caption:'点击封面切换歌词；播放键、进度条和下一首仍在手边。', notes:['封面与歌词共享空间，让内容更舒展。','房主控制共享播放；成员仅暂停本机。','保留回到开头 / 下一首，不新增跨曲上一首。']}
};
const makeEntry = (track, who='小夏', random=false) => ({entryId:crypto.randomUUID(), track, who, mine:who==='我', random});
function initialState() {
  return {screen:'queue', room:true, role:'host', scenario:'ready', current:tracks[0], currentWho:'我', currentRandom:false, queue:[makeEntry(tracks[1],'我'),makeEntry(tracks[2],'小夏',true),makeEntry(tracks[3],'阿宁'),makeEntry(tracks[4],'我')], playing:true, localPaused:false, position:138, query:'', pageLimit:5, name:'小听', code:'', address:'http://127.0.0.1:3000', joining:false, advanced:false, invite:false, formError:'', draft:'', unread:2, failNext:false, messages:[{id:'m1',who:'小夏',text:'这首歌好适合晚上听。',time:'21:06',mine:false,status:'sent'},{id:'m2',who:'阿宁',text:'那我点一首《红豆》，接着听。',time:'21:07',mine:false,status:'sent'},{id:'m3',who:'我',text:'好呀，今晚慢慢听。',time:'21:08',mine:true,status:'sent'}], playerLyrics:false, modal:null, overview:false};
}
let state = initialState();
let toastTimer;
let scrollToChatEnd = false;
let modalReturnFocus = null;
const app = document.querySelector('#app');
const connected = () => state.scenario==='ready' || state.scenario==='empty';
const effectivePlaying = () => state.playing && !state.localPaused;
const time = seconds => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const art = (track, className='track-art') => `<img class="${className}" src="assets/${track.cover}" width="56" height="56" alt="" loading="lazy">`;
const button = (action, label, name, extra='') => `<button class="icon-button" data-action="${action}" aria-label="${escapeHtml(label)}" ${extra}>${icon(name)}</button>`;
const avatars = () => '<span class="avatar-stack"><span class="avatar sage">听</span><span class="avatar sand">夏</span><span class="avatar rose">宁</span></span>';
function header(home=false) {
  return `<header class="app-header"><div class="app-title"><span class="brand-mark">${icon('headphones')}</span><h2>一起听歌</h2></div><div class="app-actions">${home?(state.joining?button('scan','扫码加入','qr'):''):`${button('invite','显示邀请二维码','qr')}${button('share','分享房间邀请','share')}${button('menu','房间选项','more')}`}</div></header>`;
}
function notice() {
  if(state.scenario==='reconnecting') return `<div class="notice warning" role="status">${icon('wifi')}<div><strong>连接中断，正在重连…</strong><p>播放已暂停，连接恢复后再跟听。</p></div><button class="text-button" data-action="reconnect">重试</button></div>`;
  if(state.role==='member'&&state.localPaused) return '<div class="notice" role="status">你已暂停本机。点播放，继续跟听。</div>';
  return '';
}
function tabs() {
  return `<div class="tabs" role="tablist" aria-label="房间内容">${['queue','search','chat'].map((screen,i)=>`<button class="${state.screen===screen?'active':''}" role="tab" id="tab-${screen}" aria-selected="${state.screen===screen}" aria-controls="room-panel" tabindex="${state.screen===screen?0:-1}" data-screen="${screen}">${['队列','点歌','聊天'][i]}${screen==='chat'&&state.unread?`<span class="badge" aria-label="${state.unread} 条未读">${state.unread>99?'99+':state.unread}</span>`:''}</button>`).join('')}</div>`;
}
function roomTop() {
  return `${header()}<button class="members-button" data-action="members" aria-label="查看 3 位成员，${connected()?'已连接':'正在重连'}">${avatars()}<span class="member-meta"><strong>3 人一起听</strong><span><i class="status-dot"></i>${connected()?'已连接':'正在重连'}<span class="role-label"> · ${state.role==='host'?'你是房主':'你是成员'}</span></span></span>${icon('chevron-down')}</button>${notice()}${tabs()}`;
}
function emptyView() {
  return `<div class="empty-state"><div class="empty-art">${icon('music')}</div><h3>下一首，听你的。</h3><p>${state.current?'待播队列是空的，点一首接着听。':'队列还是空的，点一首歌开始吧。'}</p><button class="primary-button" data-screen="search">去点歌 ${icon('arrow-right')}</button></div>`;
}
function queueView() {
  const now = state.current;
  return `<div class="view-inner">${now?`<div class="section-heading"><span class="eyebrow">${effectivePlaying()&&connected()?'正在播放':'当前歌曲'}</span><span class="playing-bars ${effectivePlaying()&&connected()?'':'paused'}" aria-hidden="true"><i></i><i></i><i></i></span></div><button class="current-card" data-action="player" aria-label="展开 ${now.title} 播放器">${art(now,'current-art')}<span class="current-meta"><strong class="track-title">${now.title}</strong><span class="track-artist">${now.artist}</span><span class="source-label">${state.currentRandom?'随机 · ':''}${escapeHtml(state.currentWho||'我')}点的 · ${time(now.duration)}</span><span class="current-link">打开播放器 ${icon('arrow-right')}</span></span></button>`:''}<div class="section-heading queue-heading"><h3>接下来 <span class="count">${state.queue.length}</span></h3><button class="text-button" data-screen="search">去点歌 ${icon('plus')}</button></div>${state.queue.length?`<div class="track-list">${state.queue.map((entry,index)=>`<div class="track-row" data-entry="${entry.entryId}"><span class="row-index">${String(index+1).padStart(2,'0')}</span>${art(entry.track)}<div class="track-copy"><strong class="track-title">${entry.track.title}</strong><span class="track-artist">${entry.track.artist}</span><span class="track-meta">${entry.random?'随机 · ':''}${entry.who}点的</span></div><div class="row-actions">${state.role==='host'||entry.mine?button('track-menu',`管理 ${entry.track.title}`,'more',`data-id="${entry.entryId}" ${connected()?'':'disabled'}`):`<span class="track-duration">${time(entry.track.duration)}</span>`}</div></div>`).join('')}</div>`:emptyView()}</div>`;
}
function searchRows() {
  const query = state.query.trim().toLocaleLowerCase();
  const matches = tracks.filter(t=>`${t.title} ${t.artist}`.toLocaleLowerCase().includes(query));
  const mine = state.queue.filter(e=>e.mine).length;
  return `<div class="catalog-heading"><span>${query?`找到 ${matches.length} 首歌曲`:'浏览曲库'}</span><span>${state.role==='member'?`我的待播 ${mine} / 5`:matches.length+' 首样本'}</span></div>${matches.length?`<div class="track-list">${matches.slice(0,state.pageLimit).map(t=>{const queued=state.current?.id===t.id||state.queue.some(e=>e.track.id===t.id);const full=state.role==='member'&&mine>=5;return `<div class="track-row">${art(t)}<div class="track-copy"><strong class="track-title">${t.title}</strong><span class="track-artist">${t.artist}</span><span class="track-meta">${time(t.duration)}</span></div><button class="add-button ${queued?'added':''}" data-action="add" data-id="${t.id}" aria-label="${queued?'已点':full?'配额已满，无法加入':'加入'} ${t.title}" ${queued||full||!connected()?'disabled':''}>${icon(queued?'check':'plus')}<span>${queued?'已点':'加入'}</span></button></div>`;}).join('')}</div>${matches.length>state.pageLimit?'<button class="secondary-button load-more" data-action="more-results">加载更多</button>':''}`:`<div class="search-empty">${icon('search')}<h3>没有找到这首歌</h3><p>换个歌名或歌手试试。</p><button class="text-button" data-action="clear-search">清空搜索</button></div>`}`;
}
function searchView() {
  return `<div class="search-wrap"><label class="search-label" for="song-search">搜索歌名或歌手</label><div class="search-field">${icon('search')}<input type="search" id="song-search" placeholder="找一首现在想听的歌" value="${escapeHtml(state.query)}" autocomplete="off">${button('clear-search','清空搜索','close')}</div><div class="random-actions"><button class="secondary-button" data-action="random" data-count="1" ${connected()?'':'disabled'}>${icon('shuffle')} 随机加 1 首</button><button class="secondary-button" data-action="random" data-count="5" ${connected()?'':'disabled'}>${icon('shuffle')} 随机加 5 首</button></div></div><div id="search-results" class="view-inner">${searchRows()}</div>`;
}
function chatView() {
  return `<div class="chat-history" id="chat-history" tabindex="0" aria-label="聊天记录"><div class="chat-date">今天 · 21:06</div>${state.messages.map(m=>`<div class="chat-row ${m.mine?'mine':''}">${m.mine?'':`<span class="chat-avatar avatar ${m.who==='小夏'?'sand':'rose'}">${m.who==='小夏'?'夏':'宁'}</span>`}<div class="chat-content">${m.mine?'':`<span class="chat-name">${escapeHtml(m.who)}</span>`}<div class="chat-bubble ${m.status==='failed'?'failed':''}">${escapeHtml(m.text)}</div><div class="chat-time">${m.status==='pending'?`${icon('clock')} 发送中…`:m.status==='failed'?`<span class="chat-state">${icon('alert')} 发送失败</span><button class="chat-retry" data-action="retry-message" data-id="${m.id}" ${connected()?'':'disabled'}>重试</button>`:m.time}</div></div></div>`).join('')}</div><form class="chat-compose" id="chat-form"><label class="sr-only" for="chat-draft">聊天消息</label><textarea id="chat-draft" rows="1" placeholder="说点什么，一起听…" maxlength="1000">${escapeHtml(state.draft)}</textarea><button class="send-button" type="submit" aria-label="发送消息" ${!state.draft.trim()||!connected()?'disabled':''}>${icon('send')}</button></form>`;
}
function miniPlayer() {
  const t=state.current;
  if(!t) return '';
  return `<div class="mini-player"><div class="mini-progress" style="--progress:${state.position/t.duration*100}%"></div><button class="mini-open" data-action="player" aria-label="展开 ${t.title} 播放器">${art(t,'mini-art')}<span class="mini-copy"><strong>${t.title}</strong><span>${t.artist}</span></span></button><div class="mini-controls">${button('play',effectivePlaying()?'暂停'+(state.role==='member'?'本机':'播放'):'播放',effectivePlaying()?'pause':'play',connected()?'':'disabled')}${state.role==='host'?button('skip','下一首','next',!connected()?'disabled':''):''}</div></div>`;
}
function homeView() {
  return `${header(true)}<div class="view home-view"><div class="home-heading"><span class="eyebrow">${state.joining?'JOIN A ROOM':'START A ROOM'}</span><h3>${state.joining?'加入房间':'创建房间'}</h3></div><form id="join-form" class="join-card"><div class="mode-switch" role="tablist" aria-label="入房方式"><button type="button" role="tab" aria-selected="${!state.joining}" data-action="create-mode" class="${state.joining?'':'active'}">创建房间</button><button type="button" role="tab" aria-selected="${state.joining}" data-action="join-mode" class="${state.joining?'active':''}">加入房间</button></div><div class="field"><label for="nickname">怎么称呼你</label><input id="nickname" name="nickname" value="${escapeHtml(state.name)}" maxlength="24" autocomplete="nickname" required></div>${state.joining?(state.invite?`<div class="invite-confirm"><p class="eyebrow">已识别邀请</p><strong>${escapeHtml(state.code)}</strong><p>加入前，请确认房间与服务器地址。</p><span class="invite-address">${escapeHtml(state.address)}</span><button type="button" class="text-button" data-action="reset-invite">重新输入</button></div>`:`<div class="field"><label for="invite-code">8 位邀请码</label><input id="invite-code" name="code" value="${escapeHtml(state.code)}" maxlength="8" pattern="[0-9A-Fa-f]{8}" autocapitalize="characters" autocomplete="off" placeholder="例如 A84AFF71" required><span class="helper">向房主获取邀请码，或点击右上角扫码。</span></div>`):''}<details class="advanced" ${state.advanced||!state.address?'open':''}><summary>高级设置 ${icon('chevron-down')}</summary><div class="field"><label for="server-address">服务器地址</label><input id="server-address" name="address" type="url" value="${escapeHtml(state.address)}" placeholder="https://music.example.com" required><span class="helper">与好友使用同一个服务器地址</span></div></details>${state.formError?`<p class="field-error" role="alert">${escapeHtml(state.formError)}</p>`:''}<button type="submit" class="primary-button">${state.joining?'加入，一起听':'创建房间'} ${icon('arrow-right')}</button></form></div>`;
}
function incompatibleView() {
  return `<header class="app-header"><div class="app-title"><span class="brand-mark">${icon('headphones')}</span><h2>一起听歌</h2></div></header><div class="view"><div class="empty-state incompatible-state"><div class="empty-art">${icon('alert')}</div><h3>服务器需要更新</h3><p>当前服务器不支持点歌队列与聊天。<br>请联系房主更新服务器后再加入。</p><button class="primary-button" data-action="go-home">返回首页</button></div></div>`;
}
function appMarkup(screen) {
  if(screen==='home') return homeView();
  if(state.scenario==='incompatible') return incompatibleView();
  return `${roomTop()}<section class="view ${screen==='chat'?'chat-view':''}" id="room-panel" role="tabpanel" aria-labelledby="tab-${screen}">${screen==='queue'?queueView():screen==='search'?searchView():chatView()}</section>${miniPlayer()}`;
}
function render() {
  const oldHistory=document.querySelector('#chat-history');
  const chatPosition=oldHistory?.scrollTop||0;
  const atBottom=!oldHistory||oldHistory.scrollHeight-oldHistory.scrollTop-oldHistory.clientHeight<60;
  const underlying=state.screen==='player'?'queue':state.screen;
  const detail=screens[state.screen];
  document.querySelector('#stage-index').textContent=`${detail.index} / 05`;
  document.querySelector('#stage-title').textContent=detail.title;
  document.querySelector('#stage-caption').textContent=detail.caption;
  document.querySelector('#screen-notes').innerHTML=detail.notes.map((n,i)=>`<p class="note-item"><span>0${i+1}</span>${n}</p>`).join('');
  document.querySelectorAll('.screen-nav [data-screen]').forEach(b=>{b.classList.toggle('active',b.dataset.screen===state.screen);b.setAttribute('aria-current',b.dataset.screen===state.screen?'page':'false');});
  app.innerHTML=appMarkup(underlying);
  if(state.screen==='chat') {const history=document.querySelector('#chat-history'); history.scrollTop=scrollToChatEnd||atBottom?history.scrollHeight:chatPosition;scrollToChatEnd=false;}
  if(state.scenario==='incompatible') state.modal=null;
  else if(state.screen==='player') state.modal='player';
  document.querySelector('#overview').classList.toggle('hidden',!state.overview);
  document.querySelector('#prototype-phone').classList.toggle('hidden',state.overview);
  document.querySelector('#stage-caption').classList.toggle('hidden',state.overview);
  document.body.classList.toggle('overview-mode',state.overview);
  document.querySelector('#overview-toggle').textContent=state.overview?'返回交互':'多屏总览';
  if(state.modal) renderModal();
  if(state.overview) renderOverview();
}
function go(screen) {
  if(!screens[screen]) return;
  if(screen!=='home'&&!state.room) state.room=true;
  state.modal=null;
  state.screen=screen;
  if(screen==='chat'){state.unread=0;scrollToChatEnd=true;}
  history.replaceState(null,'',`#${screen}`);
  render();
}
function toast(message) {
  document.querySelector('.toast')?.remove();clearTimeout(toastTimer);
  const element=document.createElement('div');element.className='toast';element.textContent=message;
  app.append(element);document.querySelector('#announcer').textContent=message;
  toastTimer=setTimeout(()=>element.remove(),3500);
}
function openModal(name,id) {modalReturnFocus=document.activeElement;state.modal=name;state.modalId=id;renderModal();}
function closeModal() {
  if(state.screen==='player') {state.screen='queue';state.modal=null;history.replaceState(null,'','#queue');render();}
  else {state.modal=null;document.querySelector('.overlay')?.remove();}
  if(modalReturnFocus?.isConnected) modalReturnFocus.focus();
}
function renderModal() {
  document.querySelector('.overlay')?.remove();
  const modal=state.modal;
  let title='', content='';
  if(modal==='player') {
    const t=state.current;
    title='正在一起听';
    content=t?`<div class="player-visual"><div class="player-members">${avatars()}<span>3 人一起听这首歌</span></div><button class="art-toggle" data-action="lyrics" aria-label="${state.playerLyrics?'切换到专辑封面':'切换到歌词'}">${state.playerLyrics?`<div class="lyrics"><span class="lyric">一起听歌</span><span class="lyric active">让同一段旋律，连接此刻。</span><span class="lyric">今晚的下一首，听你的。</span><span class="lyrics-note">歌词布局示意 · 非歌曲原词</span></div>`:art(t,'player-art')}</button><div class="art-hint">${state.playerLyrics?'点击回到封面':'点击封面查看歌词'}</div></div><div class="player-footer"><div class="player-track"><h3>${t.title}</h3><p>${t.artist}</p></div><label class="sr-only" for="player-seek">播放进度</label><input type="range" id="player-seek" min="0" max="${t.duration}" value="${state.position}" ${state.role==='host'&&connected()?'':'disabled'}><div class="player-time"><span id="elapsed">${time(state.position)}</span><span>${time(t.duration)}</span></div><div class="player-controls">${state.role==='host'?button('restart','回到歌曲开头','restart',connected()?'':'disabled'):'<span class="control-spacer"></span>'}<button class="main-play" data-action="play" aria-label="${effectivePlaying()?'暂停'+(state.role==='member'?'本机':'播放'):'播放'}" ${connected()?'':'disabled'}>${icon(effectivePlaying()?'pause':'play')}</button>${state.role==='host'?button('skip','下一首','next',connected()?'':'disabled'):'<span class="control-spacer"></span>'}</div><p class="player-permission">${state.role==='host'?'房主控制播放，大家一起听。':'播放键只控制本机；再次播放恢复跟听。'}</p></div>`:`<div class="empty-state"><div class="empty-art">${icon('music')}</div><h3>还没有当前歌曲</h3><p>先点一首，再一起听。</p><button class="primary-button" data-screen="search">去点歌</button></div>`;
  } else if(modal==='members') {
    title='一起听的朋友';
    content=`<div class="members-list">${[['听',state.name||'小听','你 · '+(state.role==='host'?'房主':'成员'),'sage'],['夏','小夏',state.role==='host'?'成员':'房主','sand'],['宁','阿宁','成员','rose']].map(m=>`<div class="member-row"><span class="avatar ${m[3]}">${m[0]}</span><span><strong>${escapeHtml(m[1])}</strong><small>${m[2]} · 在线</small></span><span class="status-dot"></span></div>`).join('')}</div><button class="primary-button" data-action="invite">邀请朋友一起听 ${icon('share')}</button>`;
  } else if(modal==='invite'||modal==='share') {
    title=modal==='share'?'分享房间邀请':'邀请朋友';
    content=`<div class="invite-sheet"><div class="qr-placeholder">${icon('qr')}</div><p>原型二维码示意</p><strong class="invite-code">A84AFF71</strong><p>发给朋友，一起听下一首。</p><button class="primary-button" data-action="copy-invite">${icon('copy')} 复制示例邀请</button><p class="helper">原型仅复制示例；Android 使用系统分享面板。</p></div>`;
  } else if(modal==='scan') {
    title='扫码加入';
    content='<p class="sheet-description">选择二维码来源</p><button class="secondary-button" data-action="scan-example">使用相机 · 示例扫描</button><button class="secondary-button" data-action="scan-example">从相册选择 · 示例扫描</button><p class="helper">离线原型仅演示识别后的邀请确认，不访问相机与相册。</p>';
  } else if(modal==='track') {
    const entry=state.queue.find(e=>e.entryId===state.modalId);
    if(!entry) {state.modal=null;return;}
    const index=state.queue.indexOf(entry);
    title=entry.track.title;
    content=`<p class="sheet-description">${entry.track.artist} · ${entry.who}点的</p>${state.role==='host'?`<button class="secondary-button" data-action="move-up" ${index===0?'disabled':''}>${icon('chevron-up')} 上移一位</button><button class="secondary-button" data-action="move-down" ${index===state.queue.length-1?'disabled':''}>${icon('chevron-down')} 下移一位</button>`:''}<button class="secondary-button danger-button" data-action="remove">${icon('close')} ${entry.mine&&state.role==='member'?'撤回我的点歌':'移出待播队列'}</button>`;
  } else if(modal==='menu') {
    title='房间选项';content=`<button class="secondary-button" data-action="members">${icon('users')} 查看成员</button><button class="secondary-button" data-action="invite">${icon('share')} 邀请朋友</button><button class="secondary-button danger-button" data-action="leave-confirm">${icon('logout')} 退出房间</button>`;
  } else if(modal==='leave') {
    title='退出这个房间？';content='<p class="sheet-description">退出后本机将停止播放。房主退出时，控制权会交给在线成员。</p><div class="sheet-actions"><button class="secondary-button" data-action="close-modal">继续听</button><button class="primary-button" data-action="leave">退出房间</button></div>';
  }
  const overlay=document.createElement('div');overlay.className='overlay';
  overlay.innerHTML=`<div class="sheet-backdrop" data-action="close-modal" aria-hidden="true"></div><section class="sheet ${modal==='player'?'player-sheet':''}" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"><div class="sheet-handle" aria-hidden="true"></div><header class="sheet-header"><h3 id="sheet-title">${title}</h3>${button('close-modal','关闭','chevron-down')}</header><div class="sheet-body">${content}</div></section>`;
  app.append(overlay);overlay.querySelector('.sheet').focus({preventScroll:true});
}
function addTrack(id,random=false) {
  if(!connected()) return false;
  const track=tracks.find(t=>t.id===id);
  if(!track||state.current?.id===id||state.queue.some(e=>e.track.id===id)) return false;
  if(state.role==='member'&&state.queue.filter(e=>e.mine).length>=5) return false;
  if(!state.current) {state.current=track;state.currentWho='我';state.currentRandom=random;state.position=0;state.playing=false;state.localPaused=false;}
  else state.queue.push(makeEntry(track,'我',random));
  return true;
}
function settleMessage(message) {
  const fail=state.failNext;state.failNext=false;
  const epoch=state;
  setTimeout(()=>{if(state!==epoch||!state.messages.includes(message))return;message.status=fail?'failed':'sent';render();if(state.screen==='chat')document.querySelector('#chat-draft')?.focus({preventScroll:true});if(fail)document.querySelector('#announcer').textContent='消息发送失败，原文已保留，可重试。';},600);
}
function renderOverview() {
  const root=document.querySelector('#overview');
  const saved={...state};
  root.innerHTML=['home','queue','search','chat','player'].map(screen=>{
    state.screen=screen==='player'?'queue':screen;
    let panel=appMarkup(state.screen);
    if(screen==='player'&&state.current){const t=state.current;panel=`<div class="sheet player-sheet overview-player"><header class="sheet-header"><h3>正在一起听</h3>${button('close-modal','关闭','chevron-down')}</header><div class="sheet-body"><div class="player-visual"><div class="player-members">${avatars()}<span>3 人一起听这首歌</span></div>${art(t,'player-art')}<div class="art-hint">点击封面查看歌词</div></div><div class="player-footer"><div class="player-track"><h3>${t.title}</h3><p>${t.artist}</p></div><input type="range" value="${state.position}" min="0" max="${t.duration}" aria-label="播放进度"><div class="player-time"><span>${time(state.position)}</span><span>${time(t.duration)}</span></div><div class="player-controls">${button('restart','回到歌曲开头','restart')}<button class="main-play" aria-label="暂停">${icon('pause')}</button>${button('skip','下一首','next')}</div><p class="player-permission">房主控制播放，大家一起听。</p></div></div></div>`;}
    return `<div class="overview-item"><div class="overview-label">${screens[screen].index} / ${screens[screen].title}</div><div class="overview-phone-wrap"><div class="phone"><div class="phone-status"><span>9:41</span><span>${icon('wifi')}${icon('battery')}</span></div><div class="app">${panel}</div><div class="phone-bottom"><span></span></div></div></div><button class="text-button" data-screen="${screen}">进入交互预览 ${icon('arrow-right')}</button></div>`;
  }).join('');
  Object.assign(state,saved);
  // 总览为视觉快照，避免重复输入 ID、页签语义与交互进入键盘顺序。
  root.querySelectorAll('.overview-phone-wrap').forEach(wrapper=>{wrapper.inert=true;wrapper.setAttribute('aria-hidden','true');});
  root.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));
}
function refreshThemeButtons() {document.querySelector('#theme-toggle').innerHTML=icon(document.body.dataset.theme==='light'?'moon':'sun');}
document.querySelectorAll('[data-icon]').forEach(element=>element.innerHTML=icon(element.dataset.icon));
document.addEventListener('click',async event=>{
  const control=event.target.closest('button,[data-action]');if(!control||control.disabled)return;
  if(control.dataset.screen) {if(state.overview){state.overview=false;document.querySelector('#overview').classList.add('hidden');document.querySelector('#prototype-phone').classList.remove('hidden');document.querySelector('#stage-caption').classList.remove('hidden');document.querySelector('#overview-toggle').textContent='多屏总览';}go(control.dataset.screen);return;}
  const action=control.dataset.action;
  if(!action)return;
  if(action==='player') {state.screen='player';history.replaceState(null,'','#player');render();}
  else if(['members','invite','share','menu','scan'].includes(action))openModal(action);
  else if(action==='close-modal')closeModal();
  else if(action==='play') {if(!connected()||!state.current)return;if(state.role==='member')state.localPaused=!state.localPaused;else state.playing=!state.playing;render();}
  else if(action==='skip') {if(state.role!=='host'||!connected()||!state.current)return;const next=state.queue.shift();state.current=next?.track||null;state.currentWho=next?.who||'我';state.currentRandom=next?.random||false;state.position=0;if(!state.current)state.playing=false;render();toast(state.current?`下一首 · ${state.current.title}`:'队列已播完，点一首接着听。');}
  else if(action==='restart') {if(state.role!=='host'||!connected())return;state.position=0;render();}
  else if(action==='lyrics') {state.playerLyrics=!state.playerLyrics;renderModal();}
  else if(action==='track-menu')openModal('track',control.dataset.id);
  else if(action==='remove'||action==='move-up'||action==='move-down') {const index=state.queue.findIndex(e=>e.entryId===state.modalId);if(index<0||!connected())return;const entry=state.queue[index];if(action==='remove'&&(state.role==='host'||entry.mine)){state.queue.splice(index,1);state.modal=null;render();toast('已移出待播队列');}else if(state.role==='host'){const dest=index+(action==='move-up'?-1:1);if(dest<0||dest>=state.queue.length)return;state.queue.splice(index,1);state.queue.splice(dest,0,entry);state.modal=null;render();toast('队列顺序已更新');}}
  else if(action==='add') {if(addTrack(control.dataset.id)){render();toast(state.position===0&&!state.playing?'首曲已就位，点播放开始听。':'已加入队列');}}
  else if(action==='random') {const count=Number(control.dataset.count);let added=0;const candidates=tracks.filter(t=>state.current?.id!==t.id&&!state.queue.some(e=>e.track.id===t.id));for(let i=candidates.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}for(const t of candidates){if(added>=count)break;if(addTrack(t.id,true))added++;}render();toast(added?`已随机加入 ${added} 首${added<count?'，剩余受配额或可选歌曲限制。':''}`:'没有可加入的歌曲，或待播配额已满。');}
  else if(action==='clear-search') {state.query='';state.pageLimit=5;render();document.querySelector('#song-search')?.focus();}
  else if(action==='more-results') {state.pageLimit+=5;document.querySelector('#search-results').innerHTML=searchRows();}
  else if(action==='reconnect') {state.scenario='ready';document.querySelector('#state-select').value='ready';state.playing=false;render();toast('连接已恢复，点播放继续。');}
  else if(action==='retry-message') {const m=state.messages.find(m=>m.id===control.dataset.id);if(!m||m.status!=='failed'||!connected())return;m.status='pending';render();settleMessage(m);}
  else if(action==='create-mode'||action==='join-mode') {state.joining=action==='join-mode';state.formError='';render();}
  else if(action==='scan-example') {state.joining=true;state.code='A84AFF71';state.invite=true;state.modal=null;state.screen='home';render();}
  else if(action==='reset-invite') {state.invite=false;render();}
  else if(action==='copy-invite') {try{await navigator.clipboard.writeText('一起听歌 · 示例邀请码 A84AFF71（离线原型）');toast('示例邀请已复制');}catch{toast('请手动复制示例邀请码 A84AFF71');}}
  else if(action==='leave-confirm')openModal('leave');
  else if(action==='leave'||action==='go-home') {state.room=false;state.current=null;state.queue=[];state.playing=false;state.messages=[];state.draft='';state.unread=0;state.localPaused=false;state.scenario='ready';document.querySelector('#state-select').value='ready';go('home');}
});
document.addEventListener('input',event=>{
  const input=event.target;
  if(input.id==='song-search') {state.query=input.value;state.pageLimit=5;document.querySelector('#search-results').innerHTML=searchRows();}
  else if(input.id==='chat-draft') {state.draft=input.value;document.querySelector('.send-button').disabled=!input.value.trim()||!connected();}
  else if(input.id==='nickname') state.name=input.value;
  else if(input.id==='invite-code') {state.code=input.value.toUpperCase().replace(/\s/g,'').slice(0,8);input.value=state.code;}
  else if(input.id==='server-address')state.address=input.value;
  else if(input.id==='player-seek'&&state.role==='host'&&connected()) {state.position=Number(input.value);document.querySelector('#elapsed').textContent=time(state.position);const progress=document.querySelector('#app .mini-progress');if(progress)progress.style.setProperty('--progress',state.position/state.current.duration*100+'%');}
});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.advanced'))state.advanced=event.target.open;},true);
document.addEventListener('submit',event=>{
  if(event.target.id==='join-form') {event.preventDefault();state.formError='';if(!state.name.trim()||!/^https?:\/\//.test(state.address.trim())||(state.joining&&!/^[A-F0-9]{8}$/.test(state.code))){state.formError='请填写昵称、有效服务器地址和 8 位邀请码。';render();return;}state.room=true;state.scenario='ready';state.role=state.joining?'member':'host';state.localPaused=false;state.messages=initialState().messages;state.unread=0;document.querySelector('#state-select').value='ready';document.querySelector('#role-select').value=state.role;if(state.joining){state.current=tracks[0];state.queue=initialState().queue;state.playing=true;state.position=138;}else{state.current=null;state.queue=[];state.playing=false;state.position=0;}go('queue');}
  else if(event.target.id==='chat-form') {event.preventDefault();if(!state.draft.trim()||!connected())return;const text=state.draft.trim();if([...text].length>500||new TextEncoder().encode(text).length>2048){toast('消息最多 500 字，且不超过 2048 字节。');return;}const id=crypto.randomUUID();const message={id,requestId:id,clientMessageId:id,issuedAtMs:Date.now(),who:'我',text,time:'21:09',mine:true,status:'pending'};state.messages.push(message);state.messages=state.messages.slice(-100);state.draft='';scrollToChatEnd=true;render();document.querySelector('#chat-draft').focus({preventScroll:true});settleMessage(message);}
});
document.addEventListener('keydown',event=>{
  const dialog=document.querySelector('#app .sheet');
  if(event.key==='Escape'&&dialog){event.preventDefault();closeModal();return;}
  if(event.key==='Tab'&&dialog){const focusable=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"]')];if(!focusable.length){event.preventDefault();return;}const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog)){event.preventDefault();first.focus();}}
  if(event.target.matches('.tabs [role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const sequence=['queue','search','chat'];const index=sequence.indexOf(state.screen);go(event.key==='Home'?'queue':event.key==='End'?'chat':sequence[(index+(event.key==='ArrowRight'?1:2))%3]);document.querySelector(`#tab-${state.screen}`).focus();}
});
document.querySelector('#theme-toggle').addEventListener('click',()=>{document.body.dataset.theme=document.body.dataset.theme==='light'?'dark':'light';refreshThemeButtons();});
document.querySelector('#text-toggle').addEventListener('click',()=>{document.body.dataset.text=document.body.dataset.text==='normal'?'large':'normal';document.querySelector('#text-toggle').setAttribute('aria-pressed',document.body.dataset.text==='large');});
document.querySelector('#overview-toggle').addEventListener('click',()=>{state.overview=!state.overview;document.querySelector('#overview').classList.toggle('hidden',!state.overview);document.querySelector('#prototype-phone').classList.toggle('hidden',state.overview);document.querySelector('#stage-caption').classList.toggle('hidden',state.overview);document.querySelector('#overview-toggle').textContent=state.overview?'返回交互':'多屏总览';document.body.classList.toggle('overview-mode',state.overview);if(state.overview)renderOverview();});
document.querySelector('#role-select').addEventListener('change',event=>{state.role=event.target.value;state.localPaused=false;render();});
document.querySelector('#state-select').addEventListener('change',event=>{state.scenario=event.target.value;if(state.scenario==='empty'){state.current=null;state.queue=[];state.playing=false;state.position=0;}render();});
document.querySelector('#fail-message').addEventListener('click',()=>{state.failNext=true;go('chat');toast('下一条消息将模拟失败，原文会留在气泡中。');});
document.querySelector('#incoming-message').addEventListener('click',()=>{state.messages.push({id:crypto.randomUUID(),who:'小夏',text:'我又找到一首好听的，你们听听看。',time:'21:10',mine:false,status:'sent'});state.messages=state.messages.slice(-100);if(state.screen!=='chat')state.unread++;render();});
document.querySelector('#reset-demo').addEventListener('click',()=>{state=initialState();document.querySelector('#role-select').value='host';document.querySelector('#state-select').value='ready';go('queue');toast('原型已重置');});
window.addEventListener('hashchange',()=>go(location.hash.slice(1)));
refreshThemeButtons();
go(screens[location.hash.slice(1)]?location.hash.slice(1):'queue');
