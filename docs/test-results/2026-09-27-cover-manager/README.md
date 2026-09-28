# 2026-09-27 · 独立封面管理器

本轮完成本地封面上传闭环：管理器页面选择图片，服务端保存到 `media/covers/`，catalog 写入 `cover`，
后端启动时优先读取独立图片并按图片版本下发；没有独立图片时回退 MP3 内嵌 ID3。

## 验证

- `cd server && npm run build`：通过。
- `cd server && npm test`：**30/30** 通过，新增独立封面加载、版本、路径越界和格式边界测试。
- 临时曲库 smoke：上传 PNG → `/api/tracks` 显示 `hasCover=true` → `/api/cover/:id` 返回原始字节和正确 MIME → DELETE 移除，catalog 恢复且旧图片清理。
- 当前真实本地曲库管理器启动：23 首列表读取成功，页面 HTTP 200；当前 catalog 没有封面引用，未写入用户曲库图片。
- `build-local-catalog.mjs` 重装配 smoke：保留已有 `cover` 引用；`build-cloud-catalog.mjs --cover-catalog` smoke：按歌曲 ID 带入封面并检查文件存在。

## 使用边界

本轮没有上传云端或重启云端服务，也没有做手机真实封面目视。云端发布需要将 `media/covers/` 与带 `cover`
字段的 catalog 作为同一批次上传，并在无人使用时重启服务；重启会清空内存房间。
