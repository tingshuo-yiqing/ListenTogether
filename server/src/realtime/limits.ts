/**
 * 固定窗口计数器：单进程内存实现，用于"每个键每个窗口最多 N 次"的连接类限流。
 * 键由调用方拼接（本项目用 `${来源 IP}|${成员令牌}`）。窗口起点在键首次命中时确定，
 * 到期后该键的下一次命中直接开新窗口，不需要定时器。
 * 内存有界：至多每窗口清扫一次过期键，超过 MAX_KEYS 时再淘汰最旧的四分之一；
 * 极端流量下限流精度会因此降级（键可能提前失效），换取进程内存不被大量伪造键拖垮。
 */
export class WindowLimiter {
  private readonly hits = new Map<string, { count: number; windowAt: number }>();
  private lastSweepAt = 0;
  private static readonly MAX_KEYS = 4096;

  constructor(private readonly max: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}

  /** 记一次访问并返回是否已超限；超限的那一次同样计入当前窗口。 */
  hit(key: string): boolean {
    const at = this.now();
    this.sweep(at);
    const entry = this.hits.get(key);
    if (!entry || at - entry.windowAt >= this.windowMs) {
      this.hits.set(key, { count: 1, windowAt: at });
      return false;
    }
    entry.count += 1;
    return entry.count > this.max;
  }

  private sweep(at: number): void {
    if (at - this.lastSweepAt < this.windowMs && this.hits.size < WindowLimiter.MAX_KEYS) return;
    this.lastSweepAt = at;
    for (const [key, entry] of this.hits) if (at - entry.windowAt >= this.windowMs) this.hits.delete(key);
    if (this.hits.size < WindowLimiter.MAX_KEYS) return;
    const oldest = [...this.hits.entries()].sort((a, b) => a[1].windowAt - b[1].windowAt);
    for (const [key] of oldest.slice(0, Math.ceil(WindowLimiter.MAX_KEYS / 4))) this.hits.delete(key);
  }
}
