# 04 校时与播放同步

## 当前算法
SyncMath.kt 接收发送/接收的手机 elapsedRealtime 与服务器时间，计算 offset：
offset = serverTime - (sent + received) / 2。
播放目标为 positionMs + max(0, serverNow - timestampMs)，暂停不累加，结果限制在歌曲范围。
差值大于500ms时seek；每5秒校准。RoomClient保留最高版本，等版本可用于再校准。
PlaybackPolicy只在校时就绪、房间播放且本地未暂停时允许播放。

## ClockEstimator（2026-09-21 实现）
已提取独立 ClockEstimator（sync/ClockEstimator.kt），参数集中在 Config：maxSamples=8、sampleTtlMs=45秒、maxRttMs=1500。
add() 丢弃负 RTT 与非法时间样本；offsetMs() 先剔除过期样本，再在 RTT 达标样本中选往返最短者。
没有合格样本时保持“校时中”并暂停，不用手机日期猜位置；重连/退出/断线时 clear() 清空全部样本。
首版仍每 5 秒请求一次、保持 500ms seek 阈值，不引入变速播放；缓冲期间不 seek（见播放服务模块）。
6 项单元测试覆盖最短 RTT 选择、非法样本、RTT 上限、样本过期、窗口裁剪与会话清理。
服务端可注入单调时基仍未实现；速度微调仍不在本轮范围。

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
