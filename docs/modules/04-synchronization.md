# 04 校时与播放同步

## 当前算法
SyncMath.kt 接收发送/接收的手机 elapsedRealtime 与服务器时间，计算 offset：
offset = serverTime - (sent + received) / 2。
播放目标为 positionMs + max(0, serverNow - timestampMs)，暂停不累加，结果限制在歌曲范围。
播放服务每秒自检一次漂移（不等 5 秒校时）；差值超过 500ms 即需纠正，纠正手段分级（2026-09-23）：
- |漂移| ≤ 300ms：保持 1.0 倍速；
- 500ms < |漂移| ≤ 2.5s：启动连续变速追赶（catchupSpeed，追赶系数=漂移/25 秒、限制在 ±4%~±12%，Sonic 变速不变调）——不丢缓冲、不出声音缺口；
- |漂移| > 2.5s：seek 硬纠正（会丢缓冲并重新起流，本身是一次可闻中断）。
300ms < |漂移| ≤ 500ms 为滞回区，保留实际倍速，避免阈值附近反复启停。
RoomClient保留最高版本，等版本可用于再校准。
PlaybackPolicy只在校时就绪、房间播放且本地未暂停时允许播放。

## ClockEstimator（2026-09-21 实现）
已提取独立 ClockEstimator（sync/ClockEstimator.kt），参数集中在 Config：maxSamples=8、sampleTtlMs=45秒、maxRttMs=1500。
add() 丢弃负 RTT 与非法时间样本；offsetMs() 先剔除过期样本，再在 RTT 达标样本中选往返最短者。
没有合格样本时保持“校时中”并暂停，不用手机日期猜位置；重连/退出/断线时 clear() 清空全部样本。
6 项单元测试覆盖最短 RTT 选择、非法样本、RTT 上限、样本过期、窗口裁剪与会话清理。
服务端可注入单调时基仍未实现。

## 分级纠正的由来（2026-09-23，推翻"不引入变速播放"的首版决策）
真机诊断（PHQ110，diag-20260923-113108 等 3 个会话）发现"渲染欠载型漂移"：省电降频/后台负载使音频渲染线程
周期性 underrun（audio_flinger 大量 empty 计数），播放位置以约 0.86x 落后于服务端，期间无 BUFFERING、
无本地暂停。原">500ms 即 seek"策略每 5 秒 seek 一次、贯穿全程（实测 24 分钟内 272 次恢复超 1.5s 的纠正），
seek 丢缓冲+重新起流本身就是可闻断裂，且换曲时初始 3 秒缓冲 + 连环 seek 表现为用户报告的
"自动切歌后无声卡住/进度条在动没有声音"。因此改为分级纠正：小漂移变速追赶（连续出声），
大漂移才 seek。诊断 correction 字段新增 "speed"。变速仅在追赶期间临时生效，追上即恢复原速，
不改变"服务端为播放唯一来源"的行为约定；暂停/load/大漂移 seek 时倍速复位。

## 数据与不变量
positionMs、durationMs为媒体时间；timestampMs和serverTimeMs必须来自同一服务端时基；手机elapsedRealtime仅可经offset换算。
状态version只用于排序，不能当时间戳。换会话时清理版本，不能把新房间的低版本误认为过期。
本地暂停和音频中断优先；收到playing=true不意味着解除本地暂停。
末尾进度不超过duration；未来基准不生成负进度；seek不能回发全房间控制。

## 诊断输出（2026-09-21 已实现）
Debug客户端本地JSONL（diagnostics/DiagnosticsLog.kt）记录：deviceLabel、roomCode、trackId、version、monotonicMs、estimatedServerMs、playerPositionMs、targetPositionMs、driftMs、rttMs、buffering、localPause、correction。
不含令牌，不默认上传；每次测试单独采集，限定最长60分钟/20MB，结束导出到测试结果目录并删除临时文件。
这不是新业务API，release默认关闭。真实两机对齐和音频测量见测试模块。

## 验收与边界
单测覆盖暂停、未来基准、曲终截断、时钟大偏差、极端RTT、样本过期、乱序与会话切换。
双机稳定播放至少10分钟；有效进度采样95%≤500ms，同时记录不可比样本。
实际音频通过共同录制的测试脉冲测量，不能用两份UI位置截图或单机服务器差值替代。
只有一台手机时，算法测试通过也不能宣布双机同步达标。

## 核心注释与记录
每个算法函数写单位/时钟域、公式、截断原因和样本失效规则；校正判断解释为什么缓冲时延后。
2026-09-21：单样本算法已升级为 ClockEstimator 多样本最短RTT估计；诊断字段已落地；服务端可注入时基与新集成测试待开发。
