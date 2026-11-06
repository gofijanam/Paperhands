export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();

  constructor(private readonly defaultTtlMs: number) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) {
      this.map.delete(key);
      return undefined;
    }
    return e.v;
  }

  set(key: string, v: V, ttlMs = this.defaultTtlMs) {
    this.map.set(key, { v, exp: Date.now() + ttlMs });
  }

  async getOrSet(key: string, fn: () => Promise<V>, ttlMs = this.defaultTtlMs): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const v = await fn();
    this.set(key, v, ttlMs);
    return v;
  }

  clear() {
    this.map.clear();
  }
}

/** In-flight promise coalescing for identical keys. */
export class Coalescer<V> {
  private inflight = new Map<string, Promise<V>>();

  async run(key: string, fn: () => Promise<V>): Promise<V> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
