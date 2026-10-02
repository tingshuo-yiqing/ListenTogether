# 点歌队列/聊天扩展 · QC-0 + QC-A 核心证据（2026-09-30，20 分钟限时轮）

## 任务与环境
- 任务号：QC-0（完成）、QC-A（核心本地通过，HTTP 接线未做）。
- 基线：HEAD `495d335`；曲库 45 首；后端在产 release `20260928-1815` 未动；安卓锚 `F79DFE09…`。
- 环境：Windows 10 / Node 24 / TypeScript 5.9；测试全程离线（无公网）。

## QC-0 勘察记录
- `git status --short`：仅 `AGENTS.md`、`docs/next-development-plan.md`、`docs/verification.md`（M）与 `docs/ListenTogether-queue-chat-design.md`（??）——均为上轮文档轮既有改动，本轮未覆盖。
- 运行进程：node PID 18032（2026-09-30 11:34 起，3100 管理器），未触碰。
- Git stash 为空；分支 main。

## 实际命令与退出码
| 命令 | 结果 |
|---|---|
| `cd server && npm run build` | 退出码 0 |
| `cd server && npm test` | 退出码 0，**tests 37 / pass 37 / fail 0**（既有 31 回归全绿 + 新增 6） |

## 本轮改动文件
- 新增 `server/src/library/catalog-index.ts`：CatalogIndex（tracksById O(1)、稳定排序、内容 revision、search 分页纯函数）、normalizeText（NFKC+小写+合并空白）、SearchError(400)、toSummary 公开投影。
- 新增 `server/test/catalog-index.test.ts`：6 项单测（见下）。
- 既有源码零改动 → v1 行为、协议、序列化不变。

## 测试用例（6/6 通过）
1. normalizeText：NFKC + 小写 + 合并空白（全角/全空格中文样本）。
2. revision：同内容两次构建恒定；coverVer/lyricsVer 任一变化 revision 必变。
3. 稳定排序：规范化歌名 → 歌手 → id（含全角曲名 NFKC 归一排序）。
4. 参数校验：q>100 码点、offset 非法（负/小数）、limit 越界（0/51/小数）均 SearchError 400。
5. 千首分页：total=1000、30/页切片连续不重叠、offset 末尾/越界返回空页不抛错。
6. 千首中文子串检索跨页连续、歌手命中（334）、无命中 total=0；toSummary 不含任何路径。

## 结论
QC-A 纯逻辑与数据模型达标（参数/排序/revision/千首夹具），旧查询与协议回归通过。「未搜索歌曲播放」端到端验收按设计随 B 阶段 v2 state 一起完成，本轮不宣称。

## 未覆盖项
- HTTP `GET /api/rooms/:code/catalog/search` 接线与 409 CATALOG_CHANGED（QC-A 收尾）。
- 模块文档 05/06/08 更新（QC-A 收尾）。
- QC-B1/B2/C/D/E 全部未开始；双真机相关验收按既有口径挂起。

## 清理
无临时文件、无夹具落盘（千首夹具为内存合成 Track，不触碰真实 media/）。
