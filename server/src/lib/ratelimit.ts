import { tooMany } from './errors';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Small in-memory sliding window limiter. Good enough for a single-process
 * deployment; swap for a Redis-backed limiter when scaling horizontally.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true when allowed, false when limit exceeded. */
  hit(key: string, weight = 1): boolean {
    const now = Date.now();
    if (now - this.lastSweep > this.windowMs) this.sweep(now);
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.set(key, { count: weight, resetAt: now + this.windowMs });
      return weight <= this.max;
    }
    b.count += weight;
    return b.count <= this.max;
  }

  /** Throws a 429 AppError when exceeded. */
  check(key: string, weight = 1): void {
    if (!this.hit(key, weight)) throw tooMany();
  }

  /** True when the key is currently over its limit (does not count a hit). */
  isBlocked(key: string): boolean {
    const b = this.buckets.get(key);
    return !!b && b.resetAt > Date.now() && b.count >= this.max;
  }

  /** Throws a 429 when the key is already over its limit, without counting. */
  assertNotBlocked(key: string): void {
    if (this.isBlocked(key)) throw tooMany();
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Gives back a previously counted hit (e.g. an attempt that turned out legitimate). */
  release(key: string, weight = 1): void {
    const b = this.buckets.get(key);
    if (!b) return;
    b.count = Math.max(0, b.count - weight);
  }

  private sweep(now: number): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    this.lastSweep = now;
  }
}
