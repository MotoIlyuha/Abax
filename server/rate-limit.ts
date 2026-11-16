/** Скользящее окно по ключу (адрес и т. п.): в памяти, для защиты от массового создания анонимов. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number) {}

  /** true — запрос допустим и засчитан; false — лимит исчерпан. */
  take(key: string, max: number, windowMs: number): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter(x => t - x < windowMs);
    if (list.length >= max) { this.hits.set(key, list); return false; }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 10000) this.sweep(windowMs, t);
    return true;
  }

  private sweep(windowMs: number, t: number): void {
    for (const [k, list] of this.hits) if (list.every(x => t - x >= windowMs)) this.hits.delete(k);
  }
}
