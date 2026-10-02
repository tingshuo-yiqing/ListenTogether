/**
 * 分类滑动窗口限流（协议见 docs/protocol.md「分类限流」）：键由调用方拼接
 * （`${房间}|${成员ID}|${类别}`），成员重连不换 memberId，配额不清零。
 * 每键保留时间戳队列（裁剪窗口外样本，最多 64 个防滥用堆积），无定时器，命中时惰性清理。
 * 键总量超限时淘汰最旧的四分之一——极端伪造键下限流精度降级，换进程内存有界。
 */
export class MemberQuotas {
  private readonly hits = new Map<string, number[]>();
  private static readonly MAX_KEYS = 8192;
  private static readonly MAX_SAMPLES = 64;

  /** 记一次访问；返回是否被限流与建议重试等待。 */
  hit(key: string, max: number, windowMs: number, now: () => number = Date.now): { limited: boolean; retryAfterMs: number } {
    const at = now();
    this.sweep();
    const samples = this.hits.get(key);
    if (!samples) {
      this.hits.set(key, [at]);
      return { limited: false, retryAfterMs: 0 };
    }
    while (samples.length && at - samples[0] >= windowMs) samples.shift();
    if (samples.length >= max) {
      if (samples.length < MemberQuotas.MAX_SAMPLES) samples.push(at); // 被限流的请求同样计入，防打点刷窗
      return { limited: true, retryAfterMs: Math.max(1, windowMs - (at - samples[0])) };
    }
    samples.push(at);
    return { limited: false, retryAfterMs: 0 };
  }

  private sweep(): void {
    if (this.hits.size < MemberQuotas.MAX_KEYS) return;
    const oldest = [...this.hits.keys()].slice(0, Math.ceil(MemberQuotas.MAX_KEYS / 4));
    for (const key of oldest) this.hits.delete(key);
  }
}
