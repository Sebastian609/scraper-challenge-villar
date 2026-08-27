import { ScrapeProcessosUseCase } from "./use-cases/scrape-processos.use-case.ts";
import { HttpClient } from "./services/http-client.ts";
import { ProcessoParser } from "./services/processo-parser.ts";
import { JsonFileWriter } from "./services/json-file-writer.ts";
import { loadConfig } from "./utils/config.util.ts";
import { log } from "./utils/logger.util.ts";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Connection": "keep-alive",
};

const config = loadConfig();
const logFile = `output/logs/scraper-${new Date().toISOString().slice(0, 10)}.log`;
log.init(logFile);

log.info("main", `Config: delayMs=${config.delayMs} concurrency=${config.concurrency} timeoutMs=${config.timeoutMs} jitterMs=${config.jitterMs}`);
log.info("main", `Logs en: ${logFile}`);

const useCase = new ScrapeProcessosUseCase(
  new HttpClient(headers, config),
  new ProcessoParser(),
  new JsonFileWriter(),
  headers,
);

useCase.execute().catch((e) => log.error("main", `ERROR: ${e.message}`));
