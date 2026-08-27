import qs from "querystring";
import type { IScrapeProcessosUseCase } from "../types/scraper.interface.ts";
import { currentMonthRange } from "../utils/date.util.ts";
import { HttpClient } from "../services/http-client.ts";
import { ProcessoParser } from "../services/processo-parser.ts";
import { JsonFileWriter } from "../services/json-file-writer.ts";

export class ScrapeProcessosUseCase implements IScrapeProcessosUseCase {
  private readonly source = "https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam";
  private readonly outputPath = "output/processos.json";
  private readonly http: HttpClient;
  private readonly parser: ProcessoParser;
  private readonly writer: JsonFileWriter;
  private readonly headers: Record<string, string>;

  constructor(
    http: HttpClient,
    parser: ProcessoParser,
    writer: JsonFileWriter,
    headers: Record<string, string>,
  ) {
    this.http = http;
    this.parser = parser;
    this.writer = writer;
    this.headers = headers;
  }

  async execute(): Promise<void> {
    const { html, cookie } = await this.http.get(this.source, this.headers);
    const context = this.parser.extractFormContext(html);
    const range = currentMonthRange();

    console.log(`Rango de fechas: ${range.start} - ${range.end}`);

    const fields = this.parser.buildSearchFields(html, range, context);
    const postHtml = await this.http.post(this.source, qs.stringify(fields), {
      ...this.headers,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      Referer: this.source,
    });

    const processos = this.parser.parseResults(postHtml);
    console.log(`Filas encontradas: ${processos.length}`);

    this.writer.writeJson(this.outputPath, processos);
    console.log(`Guardado ${this.outputPath} con ${processos.length} registros`);
  }
}
