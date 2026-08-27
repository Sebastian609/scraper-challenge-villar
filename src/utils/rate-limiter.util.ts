import { sleep } from "./sleep.util.ts";

export class RateLimiter {
  private readonly delayMs: number;
  private readonly jitterMs: number;
  private last = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(delayMs: number, jitterMs: number) {
    this.delayMs = delayMs;
    this.jitterMs = jitterMs;
  }

  async throttle(): Promise<void> {
    const run = async (): Promise<void> => {
      const elapsed = Date.now() - this.last;
      const jitter = this.jitterMs ? Math.floor(Math.random() * this.jitterMs) : 0;
      const wait = Math.max(0, this.delayMs - elapsed) + jitter;
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
    };
    const prev = this.chain;
    this.chain = prev.then(run, run);
    await this.chain;
  }
}
