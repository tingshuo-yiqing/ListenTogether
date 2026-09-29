/** 回收站只从现有清单恢复；原回收文件保留，目标冲突拒绝，写库失败撤销本次副本。 */
import { readFile, readdir, realpath, mkdir, copyFile, unlink, appendFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const runRule = /^[A-Za-z0-9._-]{1,64}$/;
const inside = (root, target) => { const rel = relative(root, target); return !!rel && !rel.startsWith('..') && !isAbsolute(rel); };

/** 检查所有已存在祖先的真实路径；阻止回收清单或库内目录符号链接逃逸。 */
async function safePath(root, target) {
  const base = await realpath(root);
  if (!inside(resolve(root), resolve(target))) throw new Error('恢复路径越出允许目录');
  let current = resolve(target);
  while (true) {
    try {
      const actual = await realpath(current);
      if (actual !== base && !inside(base, actual)) throw new Error('恢复路径经符号链接越界');
      return;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      if (current === resolve(root)) throw err;
      current = dirname(current);
    }
  }
}
async function rowsFor(root, run) {
  if (!runRule.test(run) || run === '.' || run === '..') throw new Error('回收批次名无效');
  const file = join(root, run, 'manifest.jsonl');
  await safePath(root, file);
  const text = await readFile(file, 'utf8');
  const restored = new Set(), rows = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.action === 'restored') { restored.add(row.key); continue; }
    if (!row.catalogEntry || !Array.isArray(row.moved)) throw new Error('回收记录不完整');
    rows.push({ ...row, key: createHash('sha256').update(run + '\n' + line).digest('hex'), run });
  }
  return rows.filter(r => !restored.has(r.key));
}
export async function listTrash(root) {
  let dirs;
  try { dirs = await readdir(root, { withFileTypes: true }); } catch (err) { if (err.code === 'ENOENT') return { items: [], errors: [] }; throw err; }
  const items = [], errors = [];
  for (const dir of dirs.filter(d => d.isDirectory()).sort((a,b) => b.name.localeCompare(a.name))) {
    try {
      for (const row of await rowsFor(root, dir.name)) items.push({ key: row.key, run: row.run, id: row.id,
        title: row.title, artist: row.catalogEntry.artist || '', at: row.at, files: row.moved.map(m => m.kind) });
    } catch (err) { errors.push({ run: dir.name, message: err.message }); }
  }
  return { items, errors };
}

/** 调用方必须串行持有写库锁；validate先验整库，commit负责逐字节回滚。 */
export async function restoreTrash({ trashDir, mediaDir, run, key, entries, validate, commit }) {
  const row = (await rowsFor(trashDir, run)).find(r => r.key === key);
  if (!row) throw new Error('回收记录不存在或已经恢复');
  const entry = row.catalogEntry;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id) || entries.some(e => e.id === entry.id)) throw new Error('歌曲 ID 已存在或无效，未覆盖现有歌曲');
  await validate();
  const plan = [];
  for (const moved of row.moved) {
    const field = {audio:'file',cover:'cover',lyrics:'lyrics'}[moved.kind];
    if (!field || typeof entry[field] !== 'string') throw new Error('回收记录文件类型无效');
    const target = resolve(mediaDir, entry[field]);
    if (resolve(moved.from) !== target) throw new Error('回收记录与原曲库路径不一致');
    await safePath(mediaDir, target);
    const source = resolve(moved.to);
    const batch = join(trashDir, run);
    await safePath(trashDir, source);
    if (!inside(resolve(batch), source)) throw new Error('回收文件不在当前批次');
    plan.push({ source, target });
  }
  const created = [];
  try {
    for (const item of plan) {
      await mkdir(dirname(item.target), { recursive: true });
      await safePath(mediaDir, item.target);
      await copyFile(item.source, item.target, constants.COPYFILE_EXCL);
      created.push(item.target);
    }
    await commit([...entries, entry]);
  } catch (err) {
    // commit若连回滚也失败，保留副本以免进一步损坏仍可能引用它们的编目。
    if (!err.message.includes('回滚失败')) for (const path of created) await unlink(path);
    throw err;
  }
  let warning;
  try { await appendFile(join(trashDir, run, 'manifest.jsonl'), JSON.stringify({action:'restored',key,at:new Date().toISOString()}) + '\n'); }
  catch (err) { warning = '歌曲已恢复，但回收记录状态未更新：' + err.message; }
  return { ok: true, id: entry.id, warning, message: warning || '已恢复「' + entry.title + '」，原回收副本保留' };
}
