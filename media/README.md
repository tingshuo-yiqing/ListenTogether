# 手动曲库（2026-09-27 起分区存放）

```
media/
  catalog.json      编目（唯一事实来源，条目的 file/lyrics/cover 都是库内相对路径）
  audio/            音频（<id>.mp3）
  lyrics/           歌词（<id>.lrc，UTF-8 无 BOM）
  covers/           独立封面（管理器上传或 fetch-covers 脚本写入）
```

把有权分享的 MP3 放进 `audio/`，编辑 catalog.json，例如：

```json
[
  { "id": "song-01", "title": "我的第一首歌", "file": "audio/song-01.mp3" },
  { "id": "song-02", "title": "我的第二首歌", "file": "audio/song-02.mp3", "lyrics": "lyrics/song-02.lrc", "cover": "covers/song-01.jpg" }
]
```

ID 为 1–64 位字母、数字、下划线或连字符且不得重复。file/lyrics/cover 必须位于本目录内（realpath 防逃逸：lyrics 仅 .lrc 且 ≤256KB，cover 仅 JPG/PNG/WebP 且 ≤1MB），不能通过符号链接引用外部文件。
服务启动时读取真实 MP3 时长，不依赖人工填写时长。添加或修改文件后重启服务（内存房间会被清空）。
文件缺失或格式无效时启动失败并给出错误；运行期间文件被删除，音频接口返回 404。
不进行转码，优先用 128/192kbps MP3 测试。不要在播放中替换文件。
