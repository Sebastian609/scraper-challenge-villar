import * as cheerio from "cheerio";
import type { IProcessoParser, FormContext, DateRange } from "../types/scraper.interface.ts";
import type { Processo, ProcessoDetalhe, Parte, Movimentacao, Documento } from "../types/processo.type.ts";

export class ProcessoParser implements IProcessoParser {
  extractFormContext(html: string): FormContext {
    const $ = cheerio.load(html);
    const viewState = $(`form#fPP input[name="javax.faces.ViewState"]`).val() as string;
    const currentDate = $(`#fPP\\:dataAutuacaoDecoration\\:dataAutuacaoInicioInputCurrentDate`).val() as string;
    return { viewState, currentDate };
  }

  buildSearchFields(html: string, range: DateRange, context: FormContext): Record<string, string> {
    const $ = cheerio.load(html);
    const fields: Record<string, string> = {};

    $(`form#fPP`).find("input, select, textarea").each((_, el) => {
      const name = $(el).attr("name");
      if (!name) return;
      const value = $(el).is("select")
        ? (($(el).find("option:selected").val() as string) ?? "")
        : (($(el).val() as string) ?? "");
      fields[name] = value;
    });

    fields["fPP"] = "fPP";
    fields["fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputDate"] = range.start;
    fields["fPP:dataAutuacaoDecoration:dataAutuacaoFimInputDate"] = range.end;
    fields["fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputCurrentDate"] = context.currentDate;
    fields["fPP:dataAutuacaoDecoration:dataAutuacaoFimInputCurrentDate"] = context.currentDate;
    fields["javax.faces.ViewState"] = context.viewState;
    fields["fPP:searchProcessos"] = "fPP:searchProcessos";

    return fields;
  }

  parseResults(html: string): Processo[] {
    const $ = cheerio.load(html);
    const processos: Processo[] = [];

    $(`#fPP\\:processosTable tbody tr`).each((_, tr) => {
      const tds = $(tr).find("td");

      const actionTd = tds.eq(0);
      const movimentacao = tds.eq(2).text().replace(/\s+/g, " ").trim();

      const onclick = actionTd.find("a").attr("onclick") ?? "";
      const caMatch = onclick.match(/ca=([a-f0-9]+)/);
      const detalheUrl = caMatch
        ? `/pjeconsulta/ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam?ca=${caMatch[1]}`
        : "";

      let classe = "";
      let partes = "";
      let afterAnchor = false;
      tds.eq(1).contents().each((_, node) => {
        if (node.type === "text") {
          const txt = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
          if (!txt) return;
          if (!afterAnchor) classe += (classe ? " " : "") + txt;
          else partes += (partes ? " " : "") + txt;
        } else if ((node as { name: string }).name === "a") {
          afterAnchor = true;
        }
      });

      const bold = tds.eq(1).find("b").text().replace(/\s+/g, " ").trim();
      const [numeroProcesso = "", descricao = ""] = bold.split(/\s-\s/);
      const numeroMatch = numeroProcesso.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);

      processos.push({
        numeroProcesso: numeroProcesso.trim(),
        numero: numeroMatch ? numeroMatch[0] : "",
        classe: classe.trim(),
        descricao: descricao.trim(),
        partes: partes.trim(),
        ultimaMovimentacao: movimentacao,
        detalheUrl,
      });
    });

    return processos;
  }

  parseDetail(html: string): ProcessoDetalhe {
    const $ = cheerio.load(html);

    const partes: Parte[] = [];
    $("*")
      .filter((_, e) => {
        const id = $(e).attr("id") ?? "";
        return /processoPartesPolo(Ativo|Passivo)ResumidoList$/.test(id);
      })
      .each((_, table) => {
        const polo: "Ativo" | "Passivo" = /PoloAtivo/.test($(table).attr("id") ?? "") ? "Ativo" : "Passivo";
        $(table)
          .find("tbody tr")
          .each((_, tr) => {
            const cells = $(tr).find("td").map((__, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
            if (cells.length < 2) return;
            const raw = cells[0];
            const nome = raw.split(/\s-\s(?:CNPJ|CPF)/)[0].trim();
            const tipoMatch = raw.match(/\(([^)]+)\)/);
            partes.push({
              nome,
              tipo: tipoMatch ? tipoMatch[1].trim() : "",
              situacao: cells[1],
              polo,
            });
          });
      });

    const movimentacoes: Movimentacao[] = [];
    $("*")
      .filter((_, e) => {
        const id = $(e).attr("id") ?? "";
        return id === "j_id146:processoEvento" || /processoEvento.*tb$/.test(id);
      })
      .first()
      .find("tbody tr")
      .each((_, tr) => {
        const text = $(tr).find("td").first().text().replace(/\s+/g, " ").trim();
        if (!text) return;
        const idx = text.indexOf(" - ");
        if (idx === -1) return;
        movimentacoes.push({
          data: text.slice(0, idx).trim(),
          descricao: text.slice(idx + 3).trim(),
        });
      });

    const documentos: Documento[] = [];
    $("a")
      .filter((_, e) => ($(e).text() ?? "").trim().startsWith("Visualizar documentos"))
      .each((_, a) => {
        const raw = ($(a).text() ?? "").replace(/Visualizar documentos/, "").trim();
        const descricao = raw.replace(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\s*-\s*/, "").trim();
        documentos.push({ descricao: descricao || "Documento" });
      });

    return { partes, movimentacoes, documentos };
  }
}
