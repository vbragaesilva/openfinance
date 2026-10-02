// Tipos compartilhados entre o front e a API.

export type Modalidade = 'Crédito' | 'Débito'
export type Tipo = 'Variável' | 'Fixo'

export interface Lancamento {
  id: number
  criado_em: string
  data: string // YYYY-MM-DD
  produto: string
  local: string
  valor_centavos: number
  categoria: string | null
  modalidade: Modalidade
  tipo: Tipo | null
}

export interface SplitItem {
  id: number
  criado_em: string
  data: string
  nome: string
  valor_centavos: number
  fixo: Tipo | null
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

/** Notificação do Splitwise que não virou split sozinha (status 'ignorada' ou 'revisar'). */
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
  lancamentos: Lancamento[]
  split: SplitItem[]
  fixos: Fixo[]
  salarios: Vigencia[] // ordenado por `desde`
  caixa: CaixaMensal[]
  notificacoes: NotificacaoPendente[]
}

export type Recurso = 'lancamentos' | 'split'
