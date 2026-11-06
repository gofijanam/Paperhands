/** Token-bucket rate limiter with optional await. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number = Math.max(1, ratePerSec),
  ) {
    this.tokens = burst;
    this.last = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec);
    this.last = now;
  }

  tryTake(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  async take(n = 1): Promise<void> {
    for (;;) {
      if (this.tryTake(n)) return;
      const need = n - this.tokens;
      const waitMs = Math.ceil((need / this.ratePerSec) * 1000);
      await new Promise((r) => setTimeout(r, Math.max(20, waitMs)));
    }
  }
}

export class RateLimitError extends Error {
  code = "rate_limited" as const;
  retryAfterSec: number;
  constructor(retryAfterSec = 1) {
    super("rate limited");
    this.retryAfterSec = retryAfterSec;
  }
}
