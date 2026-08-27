export interface ScraperConfig {
  delayMs: number;
  concurrency: number;
  timeoutMs: number;
  jitterMs: number;
  maxRetries: number;
  backoffMs: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(): ScraperConfig {
  return {
    delayMs: num(process.env.DELAY_MS, 1000),
    concurrency: num(process.env.CONCURRENCY, 3),
    timeoutMs: num(process.env.TIMEOUT_MS, 30000),
    jitterMs: num(process.env.JITTER_MS, 200),
    maxRetries: num(process.env.MAX_RETRIES, 3),
    backoffMs: num(process.env.BACKOFF_MS, 1000),
  };
}
