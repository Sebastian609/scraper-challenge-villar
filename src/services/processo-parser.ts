import * as cheerio from "cheerio";
import type { IProcessoParser, FormContext, DateRange } from "../types/scraper.interface.ts";
import type { Processo } from "../types/processo.type.ts";

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
}
