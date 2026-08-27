import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Level = "info" | "warn" | "error";

class Logger {
  private streamPath: string | null = null;

  init(logFile: string): void {
    this.streamPath = resolve(logFile);
    mkdirSync(dirname(this.streamPath), { recursive: true });
  }

  private write(level: Level, scope: string, msg: string): void {
    const line = `[${new Date().toISOString()}] [${scope}] ${msg}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    if (this.streamPath) {
      try {
        appendFileSync(this.streamPath, line + "\n");
      } catch {
        // no debe interrumpir el scrape si falla la escritura del log
      }
    }
  }

  info(scope: string, msg: string): void {
    this.write("info", scope, msg);
  }

  warn(scope: string, msg: string): void {
    this.write("warn", scope, msg);
  }

  error(scope: string, msg: string): void {
    this.write("error", scope, msg);
  }
}

export const log = new Logger();
