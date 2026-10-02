import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');
const [code, readyPath] = process.argv.slice(2);
const base = 'http://127.0.0.1:3000';
const headers = { 'content-type': 'application/json', 'x-listentogether-protocol': '2' };
const members = [], sockets = [];

// 真机配两个脚本身份，只验证头像及聊天界面，不作双真机或声音同步证据。
async function leave() {
  for (const socket of sockets) socket.close();
  for (const member of members) await fetch(`${base}/api/rooms/${code}/membership`,
    { method: 'DELETE', headers: { ...headers, authorization: 'Bearer ' + member.token } });
  process.exit(0);
}
try {
  for (const [name, text] of [['小王', '头像像一起听歌的朋友 🐾'], ['小李', '今天听什么？']]) {
    const response = await fetch(`${base}/api/rooms/${code}/join`,
      { method: 'POST', headers, body: JSON.stringify({ nickname: name }) });
    if (!response.ok) throw new Error(`入房失败 ${response.status}`);
    const member = await response.json(); members.push(member);
    const socket = new WebSocket(base.replace('http', 'ws') + '/ws/' + code,
      { headers: { ...headers, authorization: 'Bearer ' + member.token } });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({ type: 'chat.send', clientMessageId: randomUUID(), issuedAtMs: Date.now(), text }));
  }
  await writeFile(readyPath, JSON.stringify({ code, memberIds: members.map(m => m.memberId) }));
  console.log('两名脚本成员已连接，聊天已发送。');
  process.stdin.on('data', data => { if (data.toString().includes('leave')) void leave(); });
  setTimeout(() => { void leave(); }, 180_000).unref();
} catch (error) { console.error(error.message); await leave(); }
