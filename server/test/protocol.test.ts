import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { validate } from './mini-schema.js';
import type { Track } from '../src/library/catalog.js';

const track = (id = 'one', durationMs = 10000): Track => ({ id, title: id, durationMs, path: '', size: 10 });

/** 从 docs/protocol.md 的「## JSON Schema」小节提取第一个 ```json 代码块；文档即契约，测试不另存一份 schema。 */
async function loadProtocolSchema() {
  const markdown = await readFile(fileURLToPath(new URL('../../docs/protocol.md', import.meta.url)), 'utf8');
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex(line => /^##\s+JSON Schema/.test(line));
  assert.ok(heading >= 0, 'docs/protocol.md 缺少「## JSON Schema」小节');
  const start = lines.findIndex((line, index) => index > heading && line.trim() === '```json');
  assert.ok(start > heading, '「## JSON Schema」小节里没有 ```json 代码块');
  const end = lines.findIndex((line, index) => index > start && line.trim() === '```');
  assert.ok(end > start, 'JSON Schema 代码块未闭合');
  return JSON.parse(lines.slice(start + 1, end).join('\n')) as Record<string, any>;
}

async function until(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > end) throw new Error('WebSocket timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('protocol.md 的 schema 声明了五类消息，且能校验 buildApp 产出的真实消息', async t => {
  const schema = await loadProtocolSchema();
  // 先钉住 schema 本身：删分支、改 $ref 名都会让"文档与实现不漂移"的保证失效，这里直接拦住。
  assert.deepEqual(schema.oneOf.map((branch: { $ref: string }) => branch.$ref).sort(),
    ['#/$defs/clock', '#/$defs/command', '#/$defs/error', '#/$defs/state', '#/$defs/sync'].sort());
  for (const name of ['state', 'clock', 'error', 'sync', 'command']) {
    assert.equal(schema.$defs[name].properties.type.const, name, `${name} 分支的 type 常量须与定义名一致`);
  }

  const { app, rooms } = await buildApp([track()], { timers: false });
  const sockets: WebSocket[] = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await app.close(); });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const host = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { nickname: 'protocol' } })).json();
  const received: Array<Record<string, unknown>> = [];
  const ws = new WebSocket(address.replace('http', 'ws') + '/ws/' + host.code, { headers: { authorization: 'Bearer ' + host.token } });
  sockets.push(ws);
  ws.on('message', data => received.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

  // 客户端 → 服务端：sync 与 command（含可选字段的最小/完整两种形态）也必须在契约内。
  for (const outbound of [{ type: 'sync', clientTimeMs: 1234 }, { type: 'command', action: 'pause' }, { type: 'command', action: 'seek', positionMs: 1234 }]) {
    assert.deepEqual(validate(schema, outbound), [], `${JSON.stringify(outbound)} 不在 schema 约定内`);
  }
  ws.send(JSON.stringify({ type: 'sync', clientTimeMs: 1234 }));
  await until(() => received.some(m => m.type === 'clock') && received.some(m => m.type === 'state'));
  ws.send(JSON.stringify({ type: 'command', action: 'pause' }));
  await until(() => received.filter(m => m.type === 'state').length >= 2);
  ws.send('{');
  await until(() => received.some(m => m.type === 'error'));
  ws.send(JSON.stringify({ type: 'command', action: 'seek', positionMs: 1234 }));
  await until(() => received.filter(m => m.type === 'state').length >= 3);

  // 快照直接取样：覆盖 trackId 非空、hostId 非空、成员 online 为 true/false 的形态。
  const room = rooms.get(host.code);
  const guest = rooms.add(room, 'guest');
  const withGuest = rooms.snapshot(room);
  rooms.leave(room.code, guest.token);
  const afterLeave = rooms.snapshot(room);

  for (const message of received) assert.deepEqual(validate(schema, message), [], `真实消息未通过 schema：${JSON.stringify(message)}`);
  for (const snapshot of [withGuest, afterLeave]) assert.deepEqual(validate(schema, snapshot), [], `真实快照未通过 schema：${JSON.stringify(snapshot)}`);
  for (const snapshot of [withGuest, afterLeave]) {
    for (const member of snapshot.members) assert.deepEqual(validate(schema.$defs.member, member), [], `成员未通过 schema：${JSON.stringify(member)}`);
  }
  assert.ok(withGuest.members.some((member: { online: boolean }) => member.online), '样例应覆盖 online=true');
});

// 正向用例只有在"校验器真的会拦"的前提下才有意义：这里用 4 类构造性漂移验证它有牙。
test('schema 有牙：字段漂移、缺字段、类型错误与未知 action 都会被拦下', async () => {
  const schema = await loadProtocolSchema();
  const state = { type: 'state', code: 'AB12CD34', hostId: 'host', members: [{ id: 'm1', name: 'nick', online: true }], trackId: null, playing: false, positionMs: 0, timestampMs: 1, serverNowMs: 2, version: 0 };
  assert.deepEqual(validate(schema, state), []);

  const missingVersion = { ...state } as Record<string, unknown>;
  delete missingVersion.version;
  assert.ok(validate(schema, missingVersion).length > 0, '缺必需字段必须报错');
  assert.ok(validate(schema, { ...state, extra: 1 }).length > 0, '实现多出文档未定义字段必须报错');
  assert.ok(validate(schema, { ...state, playing: 'yes' }).length > 0, '类型不符必须报错');
  assert.ok(validate(schema, { ...state, version: 1.5 }).length > 0, 'version 必须是整数');
  assert.ok(validate(schema, { ...state, code: 'ab12cd34' }).length > 0, '邀请码必须 8 位大写十六进制');
  assert.ok(validate(schema, { ...state, positionMs: -1 }).length > 0, '进度不得为负');
  assert.ok(validate(schema, { ...state, members: [{ id: 'm1', name: 'nick' }] }).length > 0, '成员缺字段必须报错');
  assert.ok(validate(schema, { type: 'command', action: 'rewind' }).length > 0, '未知 action 必须报错');
  assert.ok(validate(schema, { type: 'error', status: 99, message: 'x' }).length > 0, 'error.status 越界必须报错');
  assert.deepEqual(validate(schema, { type: 'error', status: 429, message: '操作过于频繁' }), []);
});
