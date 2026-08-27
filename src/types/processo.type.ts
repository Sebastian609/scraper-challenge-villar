export interface Processo {
  numeroProcesso: string;
  numero: string;
  classe: string;
  descricao: string;
  partes: string;
  ultimaMovimentacao: string;
  detalheUrl: string;
  detalhe?: ProcessoDetalhe;
}

export interface Parte {
  nome: string;
  tipo: string;
  situacao: string;
  polo: "Ativo" | "Passivo";
}

export interface Movimentacao {
  data: string;
  descricao: string;
}

export interface Documento {
  descricao: string;
}

export interface ProcessoDetalhe {
  partes: Parte[];
  movimentacoes: Movimentacao[];
  documentos: Documento[];
}
