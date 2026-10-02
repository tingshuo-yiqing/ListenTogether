import { readFile, writeFile } from 'node:fs/promises';

// 文档是唯一可编辑契约；构建生成模块进入 dist，运行时不依赖仓库外 docs 目录。
const markdown = await readFile(new URL('../../docs/protocol.md', import.meta.url), 'utf8');
const block = markdown.split('## JSON Schema')[1]?.split('```json')[1]?.split('```')[0];
if (!block) throw new Error('protocol.md 缺少 JSON Schema');
const schema = JSON.parse(block);
const output = '// 自动生成：只编辑 docs/protocol.md，再执行 npm run build 或 npm test。\nexport const protocolSchema = ' + JSON.stringify(schema) + ';\n';
const target = new URL('../src/realtime/protocol-schema.generated.ts', import.meta.url);
if (await readFile(target, 'utf8').catch(() => '') !== output) await writeFile(target, output);
