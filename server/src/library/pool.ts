/** 并发受限执行器（QC-D）：loadCatalog 音频解析与封面按需读取共用同一上限口径。 */
export class Limiter {
  private queue: (() => void)[] = [];
  private active = 0;
  private peak = 0;

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('并发上限必须为正整数');
  }

  /** 在途/峰值/排队计数：规模验收「解析峰值并发」的读数来源。 */
  stats() { return { active: this.active, peak: this.peak, queued: this.queue.length }; }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active++;
        if (this.active > this.peak) this.peak = this.active;
        fn().then(resolve, reject).finally(() => {
          this.active--;
          this.queue.shift()?.();
        });
      };
      if (this.active < this.limit) start();
      else this.queue.push(start);
    });
  }
}

/** 有序并发映射：结果与输入同序，同时至多 limit 个任务在途。 */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const limiter = new Limiter(limit);
  return Promise.all(items.map((item, index) => limiter.run(() => fn(item, index))));
}
