package com.listentogether.app.sync

/**
 * 校时样本估计器：保留最近若干个有效样本，并始终采用“往返最短”的样本估计服务器时钟偏移。
 *
 * 为什么选最短 RTT：网络排队或丢包重传会单向拉长延迟，使中点估计失真；
 * 往返时间最短的样本受排队影响最小，偏移最可信。
 *
 * 时钟域与单位（均为毫秒）：
 * - sentMs/receivedMs：手机单调时钟（elapsedRealtime）。
 * - serverTimeMs：服务器时钟；offsetMs = serverTimeMs - 收发中点，见 [SyncMath.offset]。
 * - nowMs：注入的单调时钟，仅用于样本有效期判断，不参与偏移计算。
 *
 * 样本失效规则：
 * - 非法样本直接丢弃：receivedMs < sentMs（负 RTT）或时间非正。
 * - 样本有效期 [Config.sampleTtlMs]（默认 45 秒），过期样本不再参与估计。
 * - 只有 RTT ≤ [Config.maxRttMs] 的样本参与估计；极端 RTT 说明路径拥塞，偏移不可信。
 * - 最多保留最近 [Config.maxSamples] 个样本。
 * 会话切换或重连时必须调用 [clear]：旧会话样本绝不能用于新房间。
 */
class ClockEstimator(private val nowMs: () -> Long, private val config: Config = Config()) {

    /** 集中管理的校时参数，避免魔法数字散落各处。 */
    data class Config(val maxSamples: Int = 8, val sampleTtlMs: Long = 45_000, val maxRttMs: Long = 1_500)

    /** 一次有效校时样本；recordedAtMs 为采集时刻（注入时钟），rttMs = receivedMs - sentMs。 */
    data class Sample(val sentMs: Long, val receivedMs: Long, val serverTimeMs: Long, val offsetMs: Long, val rttMs: Long, val recordedAtMs: Long)

    private val samples = ArrayDeque<Sample>()

    /** 记录一个校时样本；非法样本被丢弃并返回 null，有效样本入库并原样返回。 */
    fun add(sentMs: Long, receivedMs: Long, serverTimeMs: Long): Sample? {
        if (sentMs <= 0 || receivedMs < sentMs || serverTimeMs <= 0) return null
        val sample = Sample(sentMs, receivedMs, serverTimeMs, SyncMath.offset(sentMs, receivedMs, serverTimeMs), receivedMs - sentMs, nowMs())
        samples.addLast(sample)
        while (samples.size > config.maxSamples) samples.removeFirst()
        return sample
    }

    /**
     * 当前偏移估计：先剔除过期样本，再在 RTT 达标的样本中选往返最短者。
     * 没有合格样本时返回 null，调用方应保持“校时中”并暂停，不得用手机日期猜位置。
     */
    fun offsetMs(): Long? {
        val now = nowMs()
        while (samples.isNotEmpty() && now - samples.first().recordedAtMs > config.sampleTtlMs) samples.removeFirst()
        return samples.filter { it.rttMs <= config.maxRttMs }.minByOrNull { it.rttMs }?.offsetMs
    }

    /** 会话切换/重连时清空全部样本。 */
    fun clear() { samples.clear() }
}
