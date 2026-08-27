import type { Processo, ProcessoDetalhe } from "./processo.type.ts";

export interface DateRange {
  start: string;
  end: string;
}

export interface FormContext {
  viewState: string;
  currentDate: string;
}

export interface IHttpClient {
  get(url: string, headers?: Record<string, string>): Promise<{ html: string; cookie: string }>;
  post(url: string, body: string, headers?: Record<string, string>): Promise<string>;
}

export interface IProcessoParser {
  extractFormContext(html: string): FormContext;
  buildSearchFields(html: string, range: DateRange, context: FormContext): Record<string, string>;
  parseResults(html: string): Processo[];
  parseDetail(html: string): ProcessoDetalhe;
}

export interface IFileWriter {
  writeJson(filePath: string, data: unknown): void;
}

export interface IScrapeProcessosUseCase {
  execute(): Promise<void>;
}
