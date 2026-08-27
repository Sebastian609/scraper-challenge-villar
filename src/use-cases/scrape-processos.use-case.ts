import qs from "querystring";
import { existsSync, readFileSync } from "node:fs";
import type { IScrapeProcessosUseCase } from "../types/scraper.interface.ts";
import type { Processo, ProcessoDetalhe, Documento } from "../types/processo.type.ts";
import { augustRange } from "../utils/date.util.ts";
import { mapWithLimit } from "../utils/concurrency.util.ts";
import { loadConfig } from "../utils/config.util.ts";
import { log } from "../utils/logger.util.ts";
import { HttpClient } from "../services/http-client.ts";
import { ProcessoParser } from "../services/processo-parser.ts";
import { JsonFileWriter } from "../services/json-file-writer.ts";

interface FailedDetail {
  numero: string;
  motivo: string;
}

interface FailedDoc {
  numero: string;
  idProcessoDoc: string;
  docUrl: string;
  motivo: string;
}

export class ScrapeProcessosUseCase implements IScrapeProcessosUseCase {
  private readonly source = "https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam";
  private readonly baseUrl = "https://pjett.trf5.jus.br";
  private readonly outputPath = "output/processos.json";
  private readonly failedPath = "output/failed.json";
  private readonly documentsDir = "output/documents";
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
    if (process.env.RETRY_FAILED === "1") {
      await this.retryFailed();
      return;
    }

    const config = loadConfig();
    log.info("scrape", `Iniciando scrape (delay=${config.delayMs}ms, concurrencia=${config.concurrency}, timeout=${config.timeoutMs}ms)`);

    const { html, cookie } = await this.http.get(this.source, this.headers);
    const context = this.parser.extractFormContext(html);
    const range = augustRange();
    log.info("scrape", `Rango de fechas: ${range.start} - ${range.end}`);

    const fields = this.parser.buildSearchFields(html, range, context);
    const postHtml = await this.http.post(this.source, qs.stringify(fields), {
      ...this.headers,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      Referer: this.source,
    });

    const processos = this.parser.parseResults(postHtml);
    log.info("scrape", `Procesos encontrados: ${processos.length}`);

    const failedDetails: FailedDetail[] = [];
    let detailDone = 0;
    for (const processo of processos) {
      detailDone++;
      const ok = await this.fetchDetail(processo, cookie, detailDone, processos.length);
      if (!ok) failedDetails.push({ numero: processo.numeroProcesso, motivo: "fallo al consultar detalle" });
    }
    const conDetalle = processos.filter((p) => p.detalhe).length;
    log.info("scrape", `Detalles consultados: ${conDetalle}/${processos.length}`);

    const failedDocs = await this.downloadDocuments(processos, cookie);

    this.writer.writeJson(this.outputPath, processos);
    const totalDocs = processos.reduce((n, p) => n + (p.detalhe?.documentos.length ?? 0), 0);
    log.info("scrape", `Guardado ${this.outputPath} (${processos.length} procesos, ${totalDocs} documentos)`);

    this.writeFailed(failedDetails, failedDocs);
  }

  private async fetchDetail(processo: Processo, cookie: string, seq?: number, total?: number): Promise<boolean> {
    if (!processo.detalheUrl) {
      log.warn("scrape", `Detalle ${seq ?? ""}/${total ?? ""} ${processo.numeroProcesso} -> sin URL, omitido`.trim());
      return false;
    }
    try {
      const detailUrl = `${this.baseUrl}${processo.detalheUrl}`;
      const detail = await this.http.get(detailUrl, { ...this.headers, Cookie: cookie });
      processo.detalhe = this.parser.parseDetail(detail.html);
      log.info("scrape", `Detalle ${seq ?? ""}/${total ?? ""} ${processo.numeroProcesso} -> OK`.trim());
      return true;
    } catch (err) {
      log.error("scrape", `Detalle ${seq ?? ""}/${total ?? ""} ${processo.numeroProcesso} -> ${(err as Error).message}`.trim());
      return false;
    }
  }

  private async downloadDocuments(processos: Processo[], cookie: string): Promise<FailedDoc[]> {
    const pending = processos
      .filter((p) => p.detalhe)
      .flatMap((p) => p.detalhe!.documentos.map((doc) => ({ processo: p, documento: doc })))
      .filter((item) => item.documento.docUrl);

    const config = loadConfig();
    const total = pending.length;
    let done = 0;
    log.info("scrape", `Documentos a descargar: ${total}`);

    const failed: FailedDoc[] = [];
    await mapWithLimit(pending, config.concurrency, async ({ processo, documento }) => {
      const seq = ++done;
      const ok = await this.downloadOne(processo, documento, cookie, seq, total);
      if (!ok) {
        failed.push({
          numero: processo.numeroProcesso,
          idProcessoDoc: documento.idProcessoDoc,
          docUrl: documento.docUrl,
          motivo: "fallo al descargar PDF",
        });
      }
    });
    return failed;
  }

  private async downloadOne(
    processo: Processo,
    documento: Documento,
    cookie: string,
    seq?: number,
    total?: number,
  ): Promise<boolean> {
    try {
      const docPage = await this.http.get(documento.docUrl, { ...this.headers, Cookie: cookie });
      const download = this.parser.parseDocumentDownload(docPage.html);

      const body = qs.stringify({
        "j_id42": "j_id42",
        "javax.faces.ViewState": download.viewState,
        "j_id42:downloadPDF": "j_id42:downloadPDF",
        "ca": download.ca,
        "idProcDocBin": download.idProcDocBin,
      });

      const pdf = await this.http.postBuffer(`${this.baseUrl}${download.action}`, body, {
        ...this.headers,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Referer: documento.docUrl,
      });

      if (!pdf || pdf.subarray(0, 4).toString("latin1") !== "%PDF") {
        log.error(
          "scrape",
          `Documento ${seq ?? ""}/${total ?? ""} ${processo.numero} #${documento.idProcessoDoc} -> respuesta no es PDF, omitido`.trim(),
        );
        return false;
      }

      const numero = processo.numero || "desconocido";
      const fileName = `${numero}__${documento.idProcessoDoc}.pdf`;
      this.writer.writeBinary(`${this.documentsDir}/${fileName}`, pdf);
      documento.arquivo = `documents/${fileName}`;
      log.info(
        "scrape",
        `Documento ${seq ?? ""}/${total ?? ""} ${numero} #${documento.idProcessoDoc} -> PDF ${fileName} (${pdf.length} bytes)`.trim(),
      );
      return true;
    } catch (err) {
      log.error(
        "scrape",
        `Documento ${seq ?? ""}/${total ?? ""} ${processo.numero} #${documento.idProcessoDoc} -> ${(err as Error).message}`.trim(),
      );
      return false;
    }
  }

  private writeFailed(details: FailedDetail[], docs: FailedDoc[]): void {
    if (details.length === 0 && docs.length === 0) {
      log.info("scrape", "Sin fallos: no se genera registro de reintentos");
      return;
    }
    const registro = {
      generado: new Date().toISOString(),
      detalles: details,
      documentos: docs,
    };
    this.writer.writeJson(this.failedPath, registro);
    log.warn("scrape", `Fallos registrados en ${this.failedPath}: ${details.length} detalles, ${docs.length} documentos. Reintentar con RETRY_FAILED=1`);
  }

  private async retryFailed(): Promise<void> {
    if (!existsSync(this.failedPath)) {
      log.info("retry", `No existe ${this.failedPath}, nada que reintentar`);
      return;
    }
    if (!existsSync(this.outputPath)) {
      log.error("retry", `No existe ${this.outputPath}; ejecute primero el scrape normal`);
      return;
    }

    const registro = JSON.parse(readFileSync(this.failedPath, "utf-8")) as {
      detalles: FailedDetail[];
      documentos: FailedDoc[];
    };
    const processos = JSON.parse(readFileSync(this.outputPath, "utf-8")) as Processo[];
    const { cookie } = await this.http.get(this.source, this.headers);

    const stillDetails: FailedDetail[] = [];
    for (const f of registro.detalles) {
      const p = processos.find((x) => x.numeroProcesso === f.numero);
      if (!p || !p.detalheUrl) {
        stillDetails.push(f);
        continue;
      }
      const ok = await this.fetchDetail(p, cookie);
      if (!ok) {
        stillDetails.push({ ...f, motivo: "reintento falló" });
        continue;
      }
      if (p.detalhe) {
        const fallidos = await this.downloadDocuments([p], cookie);
        for (const fd of fallidos) registro.documentos.push(fd);
      }
    }

    const stillDocs: FailedDoc[] = [];
    const detalleCache = new Map<string, ProcessoDetalhe | null>();
    for (const f of registro.documentos) {
      const p = processos.find((x) => x.numeroProcesso === f.numero);
      if (!p || !p.detalheUrl) {
        stillDocs.push(f);
        continue;
      }
      if (p.detalhe?.documentos.some((d) => d.idProcessoDoc === f.idProcessoDoc && d.arquivo)) {
        log.info("retry", `Documento ${f.numero} #${f.idProcessoDoc} -> ya descargado, omitido`);
        continue;
      }
      // El token "ca" del docUrl es de sesión: reconsultamos el detalle para obtener
      // una URL fresca del documento antes de reintentar la descarga.
      let fresh = detalleCache.get(f.numero);
      if (fresh === undefined) {
        try {
          const detail = await this.http.get(`${this.baseUrl}${p.detalheUrl}`, { ...this.headers, Cookie: cookie });
          fresh = this.parser.parseDetail(detail.html);
        } catch {
          fresh = null;
        }
        detalleCache.set(f.numero, fresh);
      }
      const freshDoc = fresh?.documentos.find((d) => d.idProcessoDoc === f.idProcessoDoc);
      if (!fresh || !freshDoc) {
        stillDocs.push({ ...f, motivo: "no se encontró el documento en el detalle" });
        continue;
      }
      const ok = await this.downloadOne(p, freshDoc, cookie);
      if (ok) {
        const orig = p.detalhe?.documentos.find((d) => d.idProcessoDoc === f.idProcessoDoc);
        if (orig) orig.arquivo = freshDoc.arquivo;
      } else {
        stillDocs.push({ ...f, motivo: "reintento falló" });
      }
    }

    this.writer.writeJson(this.outputPath, processos);
    this.writer.writeJson(this.failedPath, {
      generado: new Date().toISOString(),
      detalles: stillDetails,
      documentos: stillDocs,
    });
    log.info("retry", `Reintento finalizado: detalles pendientes=${stillDetails.length}, documentos pendientes=${stillDocs.length}`);
  }
}
