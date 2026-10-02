/**
 * UI 设计原型浏览器检查：只使用 Node 24 内置 WebSocket 与独立 Chrome CDP。
 * 不连接真实房间或设备；Chrome 属于本脚本，成功/失败均在 finally 收尾。
 * 运行：node docs/test-results/2026-09-30-ui-concept/browser-check.mjs --preset all
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const options = Object.fromEntries(process.argv.slice(2).map((argument, index, list) => {
  if (!argument.startsWith('--')) return [];
  const [name, inline] = argument.slice(2).split('=');
  return [name, inline ?? (list[index + 1]?.startsWith('--') ? true : list[index + 1] ?? true)];
}).filter(entry => entry.length));
const presets = {
  desktop: { width: 1440, height: 1080, mobile: false },
  mobile: { width: 375, height: 812, mobile: true },
  landscape: { width: 812, height: 375, mobile: true },
  dark: { width: 1440, height: 1080, mobile: false, theme: 'dark' },
  large: { width: 375, height: 812, mobile: true, large: true },
  overview: { width: 1440, height: 1080, mobile: false, overview: true },
};

/** 每条 CDP 命令独立超时；事件监听不吞掉运行时异常。 */
export class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener('message', event => {
      const packet = JSON.parse(String(event.data));
      if (packet.id) {
        const request = this.pending.get(packet.id);
        if (!request) return;
        this.pending.delete(packet.id);
        clearTimeout(request.timer);
        if (packet.error) request.reject(new Error(`${request.method}: ${JSON.stringify(packet.error)}`));
        else request.resolve(packet.result ?? {});
      } else this.events.push(packet);
    });
    socket.addEventListener('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error(`CDP 已关闭：${request.method}`));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket 握手超时')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', event => { clearTimeout(timer); reject(new Error(event.message ?? 'CDP WebSocket 握手失败')); }, { once: true });
    });
    return new CdpSession(socket);
  }

  command(method, params = {}, timeoutMs = 10000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 命令超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  }

  async waitFor(expression, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    do {
      if (await this.evaluate(expression)) return;
      await delay(50);
    } while (Date.now() < deadline);
    throw new Error(`页面等待超时：${expression}`);
  }

  /** 从当前 DOM 查命中区，再由 CDP 发送真实鼠标事件，避免旧坐标证据。 */
  async click(selector) {
    const rectangle = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('找不到控件：' + ${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const r = element.getBoundingClientRect();
      if (!r.width || !r.height) throw new Error('控件不可见：' + ${JSON.stringify(selector)});
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await this.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...rectangle, button: 'left', clickCount: 1 });
    await this.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rectangle, button: 'left', clickCount: 1 });
    await delay(100);
  }

  async setValue(selector, value) {
    await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('找不到输入控件：' + ${JSON.stringify(selector)});
      element.focus(); element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await delay(100);
  }

  async screenshot(destination, fullPage = false) {
    const parameters = { format: 'png', captureBeyondViewport: fullPage };
    if (fullPage) {
      const metrics = await this.command('Page.getLayoutMetrics');
      const content = metrics.cssContentSize;
      parameters.clip = { x: 0, y: 0, width: content.width, height: Math.min(content.height, 12000), scale: 1 };
    }
    const response = await this.command('Page.captureScreenshot', parameters, 20000);
    await writeFile(destination, Buffer.from(response.data, 'base64'));
  }

  close() { this.socket.close(); }
}

async function waitForChrome(endpoint, process) {
  const deadline = Date.now() + 15000;
  do {
    if (process.exitCode !== null) throw new Error(`独立 Chrome 提前退出：${process.exitCode}`);
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(750) });
      if (response.ok) return await response.json();
    } catch { /* 启动阶段连接被拒，短轮询后重试。 */ }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error('独立 Chrome 未在 15 秒内就绪');
}

async function sourceHashes() {
  const entries=await Promise.all(['index.html','app.js','styles.css'].map(async file=>[file,createHash('sha256').update(await readFile(path.join(root,'docs/ui-prototype',file))).digest('hex')]));
  return Object.fromEntries(entries);
}

async function pageSnapshot(session) {
  return session.evaluate(`(() => {
    const app = document.querySelector('#app');
    const appBounds = app.getBoundingClientRect();
    const controls = [...document.querySelectorAll('#app button, #app input, #app textarea, #app select')].filter(element => {
      const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !element.closest('[inert]');
    }).map(element => {
      const r = element.getBoundingClientRect();
      return { text: element.textContent.trim().slice(0, 60), label: element.getAttribute('aria-label'), tag: element.tagName, width: Math.round(r.width), height: Math.round(r.height), disabled: element.disabled,
        visibleInApp: r.bottom>appBounds.top && r.top<appBounds.bottom && r.right>appBounds.left && r.left<appBounds.right };
    });
    const targetBounds = [...document.querySelectorAll('#app .main-play, #app .player-controls button, #app .mini-controls button')].map(element=>{
      const r=element.getBoundingClientRect();
      return {label:element.getAttribute('aria-label'), width:r.width,height:r.height,
        fullyVisible: r.left>=appBounds.left-.5&&r.right<=appBounds.right+.5&&r.top>=appBounds.top-.5&&r.bottom<=appBounds.bottom+.5&&r.top>=0&&r.bottom<=innerHeight};
    });
    const playerArt=document.querySelector('#app .player-art');
    const artRect=playerArt?.getBoundingClientRect();
    const artBounds=artRect?{width:artRect.width,height:artRect.height}:null;
    return { title: document.title, stage: document.querySelector('#stage-title')?.textContent, theme: document.body.dataset.theme,
      textSize: document.body.dataset.text, viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      tabFontPx: parseFloat(getComputedStyle(document.querySelector('#app .tabs [role="tab"]')??app).fontSize),
      appBounds:{left:appBounds.left,top:appBounds.top,right:appBounds.right,bottom:appBounds.bottom},
      appText: app?.innerText, controls, targetBounds,artBounds };
  })()`);
}

/** 功能结论仅针对离线原型；从 DOM 操作，消息身份额外读取原型内存模型。 */
async function functionalChecks(session, results, out) {
  const check = async (name, task) => {
    try { await task(); results.checks.push({ name, passed: true }); }
    catch (error) { results.checks.push({ name, passed: false, error: error.message }); }
  };
  const assert = async (expression, message) => {
    if (!await session.evaluate(expression)) throw new Error(message);
  };
  const reset = async () => { await session.click('#reset-demo'); };
  const screen = async name => { await session.click(`.screen-nav [data-screen="${name}"]`); };
  await session.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await session.command('Emulation.setTouchEmulationEnabled', { enabled: false });
  await session.evaluate("document.body.dataset.theme='light'; document.body.dataset.text='normal'");
  await session.click('#overview-toggle');
  if (await session.evaluate("!document.querySelector('#overview').classList.contains('hidden')")) await session.click('#overview-toggle');
  await reset();

  await check('首页：昵称与邀请码切换保留，扫码确认后入房', async () => {
    await screen('home');
    await session.setValue('#nickname', '设计测试');
    await session.click('#app [data-action="join-mode"]');
    await session.setValue('#invite-code', 'a84aff71');
    await session.click('#app [data-action="create-mode"]');
    await session.click('#app [data-action="join-mode"]');
    await assert("document.querySelector('#nickname').value==='设计测试' && document.querySelector('#invite-code').value==='A84AFF71'", '首页切换丢失了输入');
    await session.click('#app [data-action="scan"]');
    await session.click('#app [data-action="scan-example"]');
    await assert("!!document.querySelector('#app .invite-confirm') && !document.querySelector('#app .mini-player')", '扫码后没有停在确认页');
    await session.screenshot(path.join(out, 'desktop-home.png'));
    await session.click('#join-form button[type="submit"]');
    await assert("!!document.querySelector('#app .tabs')", '确认加入未进入房间');
  });
  await reset();

  await check('首页创建：进入空队列，不残留当前曲或媒体控制', async () => {
    await screen('home');
    await session.click('#app [data-action="create-mode"]');
    await session.click('#join-form button[type="submit"]');
    await assert("!!document.querySelector('#app .empty-state') && !document.querySelector('#app .mini-player') && state.current===null && state.queue.length===0", '创建房间没有进入空队列');
    await session.screenshot(path.join(out, 'desktop-empty.png'));
  });
  await reset();

  await check('队列：房主更多菜单重排和移除', async () => {
    const ids = await session.evaluate("[...document.querySelectorAll('#app [data-entry]')].map(e=>e.dataset.entry)");
    await session.click('#app [data-action="track-menu"]');
    await session.click('#app [data-action="move-down"]');
    await assert(`document.querySelectorAll('#app [data-entry]')[1]?.dataset.entry===${JSON.stringify(ids[0])}`, '上移/下移没有改变条目顺序');
    await session.click('#app [data-action="track-menu"]');
    await session.click('#app [data-action="remove"]');
    await assert(`document.querySelectorAll('#app [data-entry]').length===${ids.length - 1}`, '移除没有改变队列');
  });
  await reset();

  await check('成员配额：只计算待播，当前曲不占五首配额', async () => {
    await session.setValue('#state-select', 'empty');
    await session.setValue('#role-select', 'member');
    await screen('search');
    await session.click('#app [data-action="add"]');
    await assert("state.current!==null && state.queue.length===0 && document.querySelector('#app .catalog-heading').textContent.includes('0 / 5')", '当前曲被错误计入成员待播配额');
    await session.click('#app [data-action="random"][data-count="5"]');
    await assert("state.queue.filter(e=>e.mine).length===5 && document.querySelector('#app .catalog-heading').textContent.includes('5 / 5')", '成员随机加入没有正确收敛到待播五首');
    await assert("[...document.querySelectorAll('#app [data-action=\"add\"]')].every(e=>e.disabled)", '配额满后仍可继续加入');
  });
  await reset();

  await check('点歌：歌手检索、加入、已点禁用、加载更多保留旧结果', async () => {
    await screen('search');
    await session.setValue('#song-search', '陈奕迅');
    await assert("document.querySelectorAll('#search-results .track-row').length===2 && [...document.querySelectorAll('#search-results .track-artist')].every(e=>e.textContent==='陈奕迅')", '歌手检索结果不正确');
    await session.setValue('#song-search', '许嵩');
    await session.click('#app [data-action="add"]');
    await assert("document.querySelector('#app [data-action=\"add\"]').disabled", '已点歌曲仍能重复加入');
    await session.click('#app [data-action="clear-search"]');
    await session.click('#app [data-action="more-results"]');
    await assert("document.querySelectorAll('#search-results .track-row').length===9", '加载更多覆盖或丢失了旧结果');
    await session.screenshot(path.join(out, 'desktop-search.png'));
  });
  await reset();

  await check('聊天：离页未读进入清零，新消息不抢历史滚动', async () => {
    await session.click('#incoming-message');
    await assert("!!document.querySelector('#tab-chat .badge')", '聊天离页收到好友消息没有未读提示');
    await screen('chat');
    await assert("!document.querySelector('#tab-chat .badge')", '进入聊天页后未读没有清零');
    for (let index = 0; index < 18; index++) await session.click('#incoming-message');
    await assert("document.querySelector('#chat-history').scrollHeight > document.querySelector('#chat-history').clientHeight", '历史滚动测试夹具未形成滚动区域');
    await session.evaluate("document.querySelector('#chat-history').scrollTop=0");
    await session.click('#incoming-message');
    await assert("document.querySelector('#chat-history').scrollTop<2", '翻历史时新消息抢走了滚动位置');
  });
  await reset();

  await check('空队列：首曲入队保持暂停，播放要明确点击', async () => {
    await session.setValue('#state-select', 'empty');
    await session.click('#app .empty-state [data-screen="search"]');
    await session.click('#app [data-action="add"]');
    await assert("!!document.querySelector('#app .mini-player [data-action=\"play\"][aria-label=\"播放\"]') && !document.querySelector('#app [data-action=\"add\"]:not(:disabled)[data-id=\"cheng-quan\"]')", '首曲入队未保持暂停或没有禁用重复加入');
  });
  await reset();

  await check('聊天：草稿跨页保留，失败原文与原消息身份重试', async () => {
    await screen('chat');
    await session.setValue('#chat-draft', '切换页面仍保留');
    await screen('queue');
    await screen('chat');
    await assert("document.querySelector('#chat-draft').value==='切换页面仍保留'", '聊天草稿跨页丢失');
    await session.click('#fail-message');
    await session.setValue('#chat-draft', '原文保留，点击重试');
    await session.click('#app .send-button');
    await session.waitFor("!!document.querySelector('#app .chat-retry')", 3000);
    const identity = await session.evaluate("(() => { const m=state.messages.at(-1); return {id:m.id, clientMessageId:m.clientMessageId, issuedAtMs:m.issuedAtMs, text:m.text}; })()");
    await session.screenshot(path.join(out, 'desktop-chat-failed.png'));
    await session.setValue('#state-select','reconnecting');
    await assert("document.querySelector('#app .chat-retry').disabled",'重连中失败消息重试缺少 disabled 语义');
    await session.setValue('#state-select','ready');
    await session.click('#app .chat-retry');
    await session.waitFor("!document.querySelector('#app .chat-retry') && !document.querySelector('#app .chat-time svg')", 3000);
    await assert(`JSON.stringify((()=>{const m=state.messages.at(-1);return {id:m.id,clientMessageId:m.clientMessageId,issuedAtMs:m.issuedAtMs,text:m.text};})())===${JSON.stringify(JSON.stringify(identity))}`, '消息重试改变了原 ID/issuedAtMs/文本');
    await session.screenshot(path.join(out, 'desktop-chat.png'));
  });
  await reset();

  await check('成员：只暂停本机，隐藏下一首与别人的管理入口', async () => {
    await session.setValue('#role-select', 'member');
    await assert("!document.querySelector('#app [data-action=\"skip\"]') && document.querySelectorAll('#app [data-action=\"track-menu\"]').length===2", '成员权限显示不正确');
    await session.click('#app .mini-player [data-action="play"]');
    await assert("document.querySelector('#app .notice')?.textContent.includes('暂停本机') && state.playing===true", '成员暂停改变了共享播放');
    await session.click('#app .mini-player [data-action="play"]');
    await assert("!document.querySelector('#app .notice') && state.localPaused===false", '成员播放没有恢复跟听');
  });
  await reset();

  await check('播放器：歌词切换、进度预览、回开头、下一首保留播放意图', async () => {
    await session.click('#app .mini-open');
    await session.click('#app [data-action="lyrics"]');
    await assert("!!document.querySelector('#app .lyrics')", '歌词切换未显示歌词区');
    await session.setValue('#player-seek', '42');
    await assert("document.querySelector('#elapsed').textContent==='0:42'", '进度预览显示错误');
    await session.click('#app [data-action="restart"]');
    await assert("document.querySelector('#elapsed').textContent==='0:00'", '回开头没有重置当前曲进度');
    const old = await session.evaluate("document.querySelector('#app .player-track h3').textContent");
    await session.click('#app .player-controls [data-action="skip"]');
    await assert(`document.querySelector('#app .player-track h3').textContent!==${JSON.stringify(old)} && !!document.querySelector('#app .main-play[aria-label="暂停播放"]')`, '下一首没有消费队列或改变了播放意图');
    await session.screenshot(path.join(out, 'desktop-player.png'));
    await session.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await session.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await assert("!document.querySelector('#app [role=\"dialog\"]')", 'Escape 未关闭播放器');
  });
  await reset();

  await check('连接异常：重连禁用副作用操作，不兼容只给返回出路', async () => {
    await session.setValue('#state-select', 'reconnecting');
    await assert("!!document.querySelector('#app .notice.warning') && [...document.querySelectorAll('#app .mini-controls button')].every(e=>e.disabled)", '重连未显示说明或仍允许播放操作');
    await session.screenshot(path.join(out, 'desktop-reconnecting.png'));
    await session.setValue('#state-select', 'incompatible');
    await assert("!!document.querySelector('#app .incompatible-state') && !document.querySelector('#app .mini-player') && !document.querySelector('#app [data-action=\"reconnect\"]')", '不兼容页残留重试/媒体控制');
    await session.screenshot(path.join(out, 'desktop-incompatible.png'));
  });
  await reset();
  await session.command('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await session.command('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const name of ['home', 'queue', 'search', 'chat', 'player']) {
    await session.evaluate(`location.hash=${JSON.stringify(name)}`);
    await session.waitFor(`document.querySelector('#stage-title').textContent===${JSON.stringify({ home:'创建 / 加入', queue:'一起听 · 队列', search:'点一首歌', chat:'边听边聊', player:'沉浸播放器' }[name])}`);
    await delay(100);
    const screenshot = `mobile-${name}.png`;
    await session.screenshot(path.join(out, screenshot));
    results.scenarios.push({ name: `mobile-${name}`, screenshot, ...await pageSnapshot(session) });
  }
  await session.click('#text-toggle');
  await delay(100);
  await session.screenshot(path.join(out, 'large-player.png'));
  results.scenarios.push({ name:'large-player',screenshot:'large-player.png',...await pageSnapshot(session) });
  await session.click('#text-toggle');
  await session.command('Emulation.setDeviceMetricsOverride', { width:812,height:375,deviceScaleFactor:1,mobile:true });
  await delay(100);
  await session.screenshot(path.join(out, 'landscape-player.png'));
  results.scenarios.push({ name:'landscape-player',screenshot:'landscape-player.png',...await pageSnapshot(session) });
}

export async function runBrowserCheck() {
  const selected = String(options.preset ?? 'all').split(',');
  const names = selected.includes('all') ? Object.keys(presets) : selected;
  for (const name of names) if (!presets[name]) throw new Error(`未知预设：${name}`);
  const out = path.resolve(String(options.out ?? here));
  const profile = path.join(root, '.workbuddy/ui-concept-chrome');
  const chrome = String(options.chrome ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe');
  const port = Number(options.port ?? 9398);
  const endpoint = `http://127.0.0.1:${port}`;
  const pageUrl = String(options.url ?? pathToFileURL(path.join(root, 'docs/ui-prototype/index.html')).href);
  await mkdir(out, { recursive: true });
  await mkdir(profile, { recursive: true });
  const sources=await sourceHashes();
  // 已占用端口时拒绝接管，确保只控制本脚本创建的独立浏览器。
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(400) });
    if (response.ok) throw new Error(`调试端口 ${port} 已被占用，请换端口后重跑。`);
  } catch (error) {
    if (error.message.includes('已被占用')) throw error;
  }
  const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeStderr = '';
  browser.stderr.on('data', chunk => { chromeStderr = (chromeStderr + chunk.toString('utf8')).slice(-16000); });
  browser.on('error', error => { chromeStderr += `\n${error.message}`; });
  const results = { startedAt: new Date().toISOString(), pageUrl, sources,checks: [], scenarios: [], runtimeErrors: [] };
  let session;
  let browserSession;
  try {
    const version = await waitForChrome(endpoint, browser);
    results.browser = version.Browser;
    browserSession = await CdpSession.connect(version.webSocketDebuggerUrl);
    const created = await browserSession.command('Target.createTarget', { url: 'about:blank' });
    const pages = await (await fetch(`${endpoint}/json/list`)).json();
    const target = pages.find(page => page.id === created.targetId);
    if (!target) throw new Error('CDP 未找到独立原型页');
    session = await CdpSession.connect(target.webSocketDebuggerUrl);
    await session.command('Page.enable');
    await session.command('Runtime.enable');
    await session.command('Log.enable');
    for (const name of names) {
      const preset = presets[name];
      await session.command('Emulation.setDeviceMetricsOverride', { width: preset.width, height: preset.height, deviceScaleFactor: 1, mobile: preset.mobile });
      await session.command('Emulation.setTouchEmulationEnabled', { enabled: preset.mobile });
      await session.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await session.command('Page.navigate', { url: pageUrl });
      await session.waitFor(`document.readyState === 'complete' && document.querySelector('#app')?.children.length > 0`);
      await session.evaluate('document.fonts.ready');
      if (preset.theme === 'dark') await session.click('#theme-toggle');
      if (preset.large) await session.click('#text-toggle');
      if (preset.overview) await session.click('#overview-toggle');
      await delay(150);
      const screenshot = `${name}.png`;
      await session.screenshot(path.join(out, screenshot), Boolean(preset.overview));
      results.scenarios.push({ name, screenshot, ...await pageSnapshot(session) });
    }
    await functionalChecks(session, results, out);
    results.runtimeErrors = session.events.filter(event => event.method === 'Runtime.exceptionThrown' || (event.method === 'Log.entryAdded' && event.params.entry.level === 'error'));
    results.checks.push({ name: '页面没有未捕捉 JavaScript 异常', passed: !results.runtimeErrors.length });
    results.checks.push({ name: '每个预设无整页水平溢出', passed: results.scenarios.every(scenario => !scenario.horizontalOverflow) });
    const smallPlayer = results.scenarios.find(scenario=>scenario.name==='mobile-player');
    results.checks.push({name:'375px 手机播放器主播放/回开头/下一首完整可见',passed:Boolean(smallPlayer?.targetBounds.length)&&smallPlayer.targetBounds.filter(control=>['暂停播放','播放','回到歌曲开头','下一首'].includes(control.label)).every(control=>control.fullyVisible)});
    for (const name of ['large-player','landscape-player']) {
      const scenario=results.scenarios.find(entry=>entry.name===name);
      results.checks.push({name:`${name==='large-player'?'2 倍字号':'横屏'}播放器主控制完整可见`,passed:Boolean(scenario?.targetBounds.length)&&scenario.targetBounds.filter(control=>['暂停播放','播放','回到歌曲开头','下一首'].includes(control.label)).every(control=>control.fullyVisible)});
    }
    const coverShapes=results.scenarios.filter(scenario=>['mobile-player','large-player','landscape-player'].includes(scenario.name)).map(scenario=>({name:scenario.name,...scenario.artBounds}));
    results.checks.push({name:'普通/2 倍字号/横屏播放器封面保持方形',passed:coverShapes.every(cover=>cover.width>0&&Math.abs(cover.width-cover.height)<1),coverShapes});
    const landscape = results.scenarios.find(scenario=>scenario.name==='landscape');
    if(landscape)results.checks.push({name:'812×375 横屏迷你播放控制完整可见',passed:Boolean(landscape.targetBounds.length)&&landscape.targetBounds.every(control=>control.fullyVisible)});
    const mobile = results.scenarios.find(scenario=>scenario.name==='mobile');
    const large = results.scenarios.find(scenario=>scenario.name==='large');
    if(mobile&&large)results.checks.push({name:'大字号模式真实放大至 2 倍字阶',passed:Math.abs(large.tabFontPx/mobile.tabFontPx-2)<.01,normalPx:mobile.tabFontPx,largePx:large.tabFontPx});
    const undersized=results.scenarios.filter(scenario=>scenario.name!=='overview').flatMap(scenario=>scenario.controls.filter(control=>control.visibleInApp&&(control.width<48||control.height<48)).map(control=>({scenario:scenario.name,...control})));
    results.checks.push({name:'应用可见触控目标 ≥48×48px（总览 inert 快照不计）',passed:!undersized.length,undersized});
    results.sourcesAfter=await sourceHashes();
    results.checks.push({name:'检查期间原型源码保持同一版本',passed:JSON.stringify(results.sources)===JSON.stringify(results.sourcesAfter)});
    results.completedAt = new Date().toISOString();
    await writeFile(path.join(out, 'browser-results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ checks: results.checks, scenarios: results.scenarios.map(({ name, screenshot }) => ({ name, screenshot })) }, null, 2));
    if (results.checks.some(check => !check.passed)) process.exitCode = 1;
  } catch (error) {
    results.failure = { message: error.message, chromeStderr };
    await writeFile(path.join(out, 'browser-results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    session?.close();
    if (browserSession) {
      try { await browserSession.command('Browser.close', {}, 1500); } catch { /* 关闭浏览器时 WebSocket 会先断。 */ }
      browserSession.close();
    }
    browser.kill();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBrowserCheck().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
