/** Token bucket: `rate` tokens per second up to `burst`. Time comes from the caller (testable). */
export class TokenBucket {
  private tokens: number;
  private at: number;
  constructor(private rate: number, private burst: number, now: number) {
    this.tokens = burst;
    this.at = now;
  }
  private refill(now: number) {
    if (now > this.at) {
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
      this.at = now;
    }
  }
  /** Take `n` tokens if available. */
  take(now: number, n = 1): boolean {
    this.refill(now);
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
  /** Whole tokens available now (without taking them). */
  available(now: number): number {
    this.refill(now);
    return Math.floor(this.tokens);
  }
}

/** Per-key token buckets that forget idle keys (per-IP join and submission limits; IPs are never stored on disk). */
export class KeyedLimiter {
  private map = new Map<string, { b: TokenBucket; seen: number }>();
  constructor(private rate: number, private burst: number, private max = 50_000) {}
  take(key: string, now: number, n = 1): boolean {
    let e = this.map.get(key);
    if (!e) {
      if (this.map.size >= this.max) this.prune(now, true);
      e = { b: new TokenBucket(this.rate, this.burst, now), seen: now };
      this.map.set(key, e);
    }
    e.seen = now;
    return e.b.take(now, n);
  }
  /** Drop keys idle long enough to have refilled (or, under pressure, the oldest half). */
  prune(now: number, force = false) {
    const full = (this.burst / Math.max(1e-6, this.rate)) * 1000;
    for (const [k, e] of this.map) if (now - e.seen > full) this.map.delete(k);
    if (force && this.map.size >= this.max) {
      const keys = [...this.map.entries()].sort((a, b) => a[1].seen - b[1].seen).slice(0, this.map.size >> 1);
      for (const [k] of keys) this.map.delete(k);
    }
  }
  get size() { return this.map.size; }
}
