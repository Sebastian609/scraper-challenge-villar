import axios from "axios";
import type { IHttpClient } from "../types/scraper.interface.ts";
import type { ScraperConfig } from "../utils/config.util.ts";
import { RateLimiter } from "../utils/rate-limiter.util.ts";
import { sleep } from "../utils/sleep.util.ts";
import { log } from "../utils/logger.util.ts";

export class HttpClient implements IHttpClient {
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly limiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly backoffMs: number;

  constructor(defaultHeaders: Record<string, string> = {}, config?: ScraperConfig) {
    this.defaultHeaders = defaultHeaders;
    this.timeoutMs = config?.timeoutMs ?? 30000;
    this.limiter = new RateLimiter(config?.delayMs ?? 1000, config?.jitterMs ?? 0);
    this.maxRetries = config?.maxRetries ?? 0;
    this.backoffMs = config?.backoffMs ?? 1000;
  }

  private pathOf(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  private async request<T>(label: string, path: string, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      await this.limiter.throttle();
      try {
        return await fn();
      } catch (err) {
        const status = (err as { response?: { status?: number; headers?: Record<string, unknown> } })?.response?.status;
        const retryable = status === 429 || status === 503;
        if (!retryable || attempt >= this.maxRetries) {
          log.error("http", `${label} ${path} -> agotado (${status ?? (err as Error).message})`);
          throw err;
        }
        attempt++;
        const headers = (err as { response?: { headers?: Record<string, unknown> } })?.response?.headers ?? {};
        const retryAfter = Number(headers["retry-after"]);
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : this.backoffMs * 2 ** (attempt - 1);
        log.warn(
          "http",
          `${label} ${path} -> ${status} (reintento ${attempt}/${this.maxRetries} en ${wait}ms)`,
        );
        await sleep(wait);
      }
    }
  }

  async get(url: string, headers?: Record<string, string>): Promise<{ html: string; cookie: string }> {
    const path = this.pathOf(url);
    return this.request("GET", path, async () => {
      log.info("http", `GET ${path}`);
      const res = await axios.get(url, {
        headers: { ...this.defaultHeaders, ...headers },
        timeout: this.timeoutMs,
      });
      const cookie = (res.headers["set-cookie"] ?? [])
        .map((c) => c.split(";")[0])
        .join("; ");
      const html = res.data as string;
      log.info("http", `GET ${path} -> ${res.status} (${html.length} bytes)`);
      return { html, cookie };
    });
  }

  async post(url: string, body: string, headers?: Record<string, string>): Promise<string> {
    const path = this.pathOf(url);
    return this.request("POST", path, async () => {
      log.info("http", `POST ${path}`);
      const res = await axios.post(url, body, {
        headers: { ...this.defaultHeaders, ...headers },
        timeout: this.timeoutMs,
      });
      const data = res.data as string;
      log.info("http", `POST ${path} -> ${res.status} (${data.length} bytes)`);
      return data;
    });
  }

  async postBuffer(url: string, body: string, headers?: Record<string, string>): Promise<Buffer> {
    const path = this.pathOf(url);
    return this.request("POST", path, async () => {
      log.info("http", `POST ${path} (buffer)`);
      const res = await axios.post(url, body, {
        headers: { ...this.defaultHeaders, ...headers },
        responseType: "arraybuffer",
        timeout: this.timeoutMs,
      });
      const buf = Buffer.from(res.data as ArrayBuffer);
      log.info("http", `POST ${path} (buffer) -> ${res.status} (${buf.length} bytes)`);
      return buf;
    });
  }
}
