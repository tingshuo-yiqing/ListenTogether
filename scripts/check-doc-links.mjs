import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set([
  '.git',
  '.gradle',
  'build',
  'node_modules',
  'server',
  'android',
]);

function collectMarkdownFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      collectMarkdownFiles(path.join(directory, entry.name), files);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function isExternalLink(target) {
  return target.startsWith('#')
    || target.startsWith('/')
    || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function localTarget(link) {
  const withoutTitle = link.trim().split(/\s+['"]/u, 1)[0];
  const withoutFragment = withoutTitle.split('#', 1)[0].split('?', 1)[0];
  return decodeURIComponent(withoutFragment);
}

const failures = [];
for (const file of collectMarkdownFiles(projectRoot)) {
  const content = fs.readFileSync(file, 'utf8');
  const directory = path.dirname(file);
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/gu;
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim();
    if (!rawTarget || isExternalLink(rawTarget)) continue;

    const target = localTarget(rawTarget);
    if (!target) continue;
    const resolved = path.resolve(directory, target);
    if (!fs.existsSync(resolved)) {
      failures.push(`${path.relative(projectRoot, file)} -> ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  console.error('发现不存在的 Markdown 本地链接：');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Markdown 本地链接检查通过。');
}