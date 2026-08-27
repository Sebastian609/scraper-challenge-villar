import { ScrapeProcessosUseCase } from "./use-cases/scrape-processos.use-case.ts";
import { HttpClient } from "./services/http-client.ts";
import { ProcessoParser } from "./services/processo-parser.ts";
import { JsonFileWriter } from "./services/json-file-writer.ts";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Connection": "keep-alive",
};

const useCase = new ScrapeProcessosUseCase(
  new HttpClient(headers),
  new ProcessoParser(),
  new JsonFileWriter(),
  headers,
);

useCase.execute().catch((e) => console.error("ERROR:", e.message));
