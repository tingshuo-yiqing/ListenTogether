# 合成测试曲库

三段低音量正弦波测试音，由 ffmpeg 合成，用于首次真机联调；不是歌曲，也不含第三方录音。
A 为 30 秒 440Hz，B 为 45 秒 660Hz，均有淡入淡出，MP3 128kbps。
C（demo-long）为 40 分钟 220Hz 单声道 32kbps，用于 30 分钟长时息屏/锁屏稳定性测试；低码率保证体积可控且不会被 ExoPlayer 一次性缓冲完成。
D（demo-hour）为 70 分钟 330Hz 单声道 24kbps，用于 M3-LONG 60 分钟连续播放（含至少 30 分钟息屏）——40 分钟的 demo-long 覆盖不了全程，70 分钟留出 10 分钟余量；完整解码校验时长恰为 01:10:00（2026-09-22）。
通过 scripts/start-demo.ps1 使用独立目录，不覆盖 media 下的自有音乐。
播放前把手机音量调低。可验证暂停、拖动、切歌和播完推进。

重新生成 demo-long / demo-hour（避免提交大文件时可自行生成；ffmpeg 是 Windows 程序，Git Bash 下用 Windows 风格路径）：

```powershell
ffmpeg -f lavfi -i "sine=frequency=220:sample_rate=44100" -af "volume=0.05,afade=t=in:d=3,afade=t=out:st=2397:d=3" -t 2400 -ac 1 -b:a 24k -y demo-long.mp3
ffmpeg -f lavfi -i "sine=frequency=330:sample_rate=44100" -af "volume=0.05,afade=t=in:d=3,afade=t=out:st=4197:d=3" -t 4200 -ac 1 -b:a 24k -y demo-hour.mp3
```
