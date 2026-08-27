import axios from "axios";
import type { IHttpClient } from "../types/scraper.interface.ts";

export class HttpClient implements IHttpClient {
  private readonly defaultHeaders: Record<string, string>;

  constructor(defaultHeaders: Record<string, string> = {}) {
    this.defaultHeaders = defaultHeaders;
  }

  async get(url: string, headers?: Record<string, string>): Promise<{ html: string; cookie: string }> {
    const res = await axios.get(url, { headers: { ...this.defaultHeaders, ...headers } });
    const cookie = (res.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    return { html: res.data as string, cookie };
  }

  async post(url: string, body: string, headers?: Record<string, string>): Promise<string> {
    const res = await axios.post(url, body, { headers: { ...this.defaultHeaders, ...headers } });
    return res.data as string;
  }
}
