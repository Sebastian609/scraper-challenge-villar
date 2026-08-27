import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { IFileWriter } from "../types/scraper.interface.ts";

export class JsonFileWriter implements IFileWriter {
  writeJson(filePath: string, data: unknown): void {
    const full = resolve(filePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify(data, null, 2), "utf-8");
  }
}
