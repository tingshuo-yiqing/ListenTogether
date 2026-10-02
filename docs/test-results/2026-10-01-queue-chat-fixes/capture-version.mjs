import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// 以实际工作区文件固定复验版本；Git HEAD 不包含当前未提交交付。
const root = new URL('../../../', import.meta.url);
const hashes = {};
async function scan(relative, extension) {
  for (const entry of await readdir(new URL(relative + '/', root), { withFileTypes: true })) {
    const path = relative + '/' + entry.name;
    if (entry.isDirectory()) await scan(path, extension);
    else if (entry.name.endsWith(extension)) {
      hashes[path] = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
    }
  }
}
await scan('android/app/src/main/java', '.kt');
await scan('server/src', '.ts');
await scan('server/dist', '.js');
const apkPath = 'android/app/build/outputs/apk/debug/app-debug.apk';
const apkBytes = await readFile(new URL(apkPath, root));
const baseline = { suites: 0, tests: 0, failures: 0, errors: 0, skipped: 0 };
for (const name of await readdir(new URL('./baseline-android/', import.meta.url))) {
  if (!name.endsWith('.xml')) continue;
  const xml = await readFile(new URL('./baseline-android/' + name, import.meta.url), 'utf8');
  const attrs = /<testsuite\b([^>]+)>/.exec(xml)?.[1];
  if (!attrs) throw new Error('Invalid JUnit evidence: ' + name);
  baseline.suites++;
  for (const field of ['tests', 'failures', 'errors', 'skipped']) {
    const match = new RegExp(`\\b${field}="(\\d+)"`).exec(attrs);
    baseline[field] += Number(match?.[1] ?? 0);
  }
}
const lint = await readFile(new URL('./lint-results-debug.xml', import.meta.url), 'utf8');
const output = {
  capturedAt: new Date().toISOString(),
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'local-uncommitted-workspace', baseline,
  lintIssues: [...lint.matchAll(/<issue\b/g)].length,
  apk: { path: apkPath, bytes: (await stat(new URL(apkPath, root))).size, sha256: createHash('sha256').update(apkBytes).digest('hex') },
  hashes
};
const destination = process.argv[2] || 'version-before.json';
if (!/^version-(before|after)\.json$/.test(destination)) throw new Error('Unexpected output name');
await writeFile(new URL('./' + destination, import.meta.url), JSON.stringify(output, null, 2) + '\n');
if (destination === 'version-after.json') {
  const before = JSON.parse(await readFile(new URL('./version-before.json', import.meta.url), 'utf8'));
  const changed = Object.keys({ ...before.hashes, ...hashes }).filter(path => before.hashes[path] !== hashes[path]);
  console.log(JSON.stringify({ baseline, lintIssues: output.lintIssues, apk: output.apk, changedProductFiles: changed }));
} else console.log(JSON.stringify({ baseline, lintIssues: output.lintIssues, apk: output.apk, hashedFiles: Object.keys(hashes).length }));
