// Tipos compartilhados entre o front e a API.

export type Tipo = 'Variável' | 'Fixo'

/**
 * Onde o gasto acontece (um cartão, a conta do débito, o Splitwise…). Todas contam no Gasto do mês;
 * as flags só decidem o que aparece no Painel e nas Análises.
 */
export interface Plataforma {
  id: number
  nome: string
  /** Dia (1–28) em que a fatura fecha: compra antes dele conta no mês anterior. 1 = mês do calendário. */
  fechamento: number
  /** Mostra o total da plataforma no Painel, para conferir (ex.: com a fatura ou o Splitwise). */
  no_painel: boolean
  /** Entra nas Análises e no "por categoria" do Painel. */
  nas_analises: boolean
  /** Inativa some do formulário de lançamento, mas o histórico continua contando. */
  ativa: boolean
  ordem: number
  /** 'splitwise' = recebe os splits criados pelas notificações do Splitwise. */
  integracao: 'splitwise' | null
}

export interface Lancamento {
  id: number
  criado_em: string
  data: string // YYYY-MM-DD
  produto: string
  local: string
  valor_centavos: number
  categoria: string | null
  plataforma_id: number
  tipo: Tipo | null
}

/** Valor com vigência: vale do mês `desde` (AAAA-MM) até a próxima mudança. */
export interface Vigencia {
  desde: string
  valor_centavos: number
}

export interface Pagamento {
  id: number
  data: string // YYYY-MM-DD
}

export interface Fixo {
  id: number
  nome: string
  investimento: boolean
  ordem: number
  inicio: string // AAAA-MM
  fim: string | null // AAAA-MM, inclusive
  valores: Vigencia[] // ordenado por `desde`
  pagamentos: Pagamento[] // ordenado por data
}

export interface CaixaMensal {
  ano: number
  mes: number
  valor_centavos: number
}

/** Notificação do Splitwise que não virou lançamento sozinha (status 'ignorada' ou 'revisar'). */
export interface NotificacaoPendente {
  id: number
  recebida_em: string
  titulo: string | null
  subtitulo: string | null
  mensagem: string | null
  status: 'ignorada' | 'revisar'
  motivo: string | null
}

export interface Dados {
  plataformas: Plataforma[] // ordenado por `ordem`
  lancamentos: Lancamento[]
  fixos: Fixo[]
  salarios: Vigencia[] // ordenado por `desde`
  caixa: CaixaMensal[]
  notificacoes: NotificacaoPendente[]
}
