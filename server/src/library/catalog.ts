import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parseFile } from 'music-metadata';

export type Track = { id: string; title: string; durationMs: number; path: string; size: number };
export async function loadCatalog(directory: string): Promise<Track[]> {
  const root = await realpath(directory);
  const entries: unknown = JSON.parse(await readFile(resolve(root, 'catalog.json'), 'utf8'));
  if (!Array.isArray(entries)) throw new Error('catalog.json 必须是数组');
  const ids = new Set<string>();
  return Promise.all(entries.map(async entry => {
    if (!entry || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id) || ids.has(entry.id)
      || typeof entry.title !== 'string' || !entry.title.trim() || typeof entry.file !== 'string') {
      throw new Error('曲库条目无效或 ID 重复');
    }
    ids.add(entry.id);
    const path = await realpath(resolve(root, entry.file));
    // realpath 同时阻止 ../ 和指向曲库外部的符号链接，文件路径不来自 HTTP 参数。
    if (!path.startsWith(root + sep) || !path.toLowerCase().endsWith('.mp3')) throw new Error('只允许曲库内的 MP3');
    const info = await stat(path);
    const metadata = await parseFile(path, { duration: true });
    const durationMs = Math.round((metadata.format.duration ?? 0) * 1000);
    if (!info.isFile() || durationMs <= 0) throw new Error(`无法读取歌曲时长：${entry.id}`);
    return { id: entry.id, title: entry.title, path, size: info.size, durationMs };
  }));
}
