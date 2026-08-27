import type { Processo, ProcessoDetalhe, DocumentoDownload } from "./processo.type.ts";

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
  postBuffer(url: string, body: string, headers?: Record<string, string>): Promise<Buffer>;
}

export interface IProcessoParser {
  extractFormContext(html: string): FormContext;
  buildSearchFields(html: string, range: DateRange, context: FormContext): Record<string, string>;
  parseResults(html: string): Processo[];
  parseDetail(html: string): ProcessoDetalhe;
  parseDocumentDownload(html: string): DocumentoDownload;
}

export interface IFileWriter {
  writeJson(filePath: string, data: unknown): void;
  writeBinary(filePath: string, data: Buffer): void;
}

export interface IScrapeProcessosUseCase {
  execute(): Promise<void>;
}
