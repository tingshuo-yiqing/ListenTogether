# 元数据同步器只读预览

> **本记录已被取代（同日）**：`scripts/fetch-metadata.mjs` 已于 2026-09-27 晚按用户指令删除，抓取/打分/缓存能力并入
> `scripts/lib/metadata-sources.mjs`（QQ 音乐 / 网易云 / MusicBrainz 三源）与可视化管理器界面，**命令行入口不复存在**。
> 以下保留当时的 MusicBrainz 单源预览结论作为历史。最新交付见 [元数据源整合记录](../2026-09-27-metadata-sources/README.md)。

日期：2026-09-27
范围：`scripts/fetch-metadata.mjs`，本地 `media/catalog.json` 23 首
状态：**部分自动匹配，未写回曲库**

## 目标

为歌曲补充 artist、album、year、genre 候选；只使用本地 ID3 与 MusicBrainz 公共 API，
不抓取网页、不下载音频。歌词继续复用 `scripts/fetch-lrc.mjs`，封面只在报告中保留
Cover Art Archive 候选地址，人工确认后仍通过本地管理器上传。

## 实际命令

```powershell
cd D:\ListenTogether
node --check scripts/fetch-metadata.mjs
node scripts/fetch-metadata.mjs --min-score 0.8 --report .workbuddy/metadata-dry-run.json
```

## 结果

- `catalog.json` 条目：23 首；本轮未修改。
- 高置信度匹配并产生补字段候选：14 首。
- 低于阈值、保持 `needs-review`：9 首（主要是简繁体歌名/歌手差异或同名版本）。
- `--apply` 未执行；没有上传封面、歌词或音频。
- 查询按 MusicBrainz 要求串行节流，User-Agent 为 `ListenTogetherMetadata/0.1`，默认缓存与报告在 `.workbuddy/`。

## 边界

报告中的候选需要人工确认后再 `--apply`；已有手填字段默认不覆盖，`--force` 才会覆盖。
MusicBrainz 的结果不保证每首中文歌曲都有正确发行版本，低置信度项目不能自动写入云端。
