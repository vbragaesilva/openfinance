// Regras da sincronização com a Pluggy (Open Finance pelo Meu Pluggy). Funções puras, sem rede nem banco.
//
// Por enquanto só compras no cartão de crédito viram lançamento (o que a antiga automação do Nubank fazia).
// Pagamento de fatura, estornos, conta corrente, Pix etc. ficam guardados sem lançar até ganharem regra.
import { fixoPelaCompra } from './nubank.ts'
import type { Tipo } from './tipos.ts'

/** Os campos da Pluggy que usamos (o JSON completo fica guardado em `bruto`). */
export interface PluggyConta {
  id: string
  type: 'BANK' | 'CREDIT' | string
  subtype?: string
  name?: string
}

export interface PluggyTransacao {
  id: string
  accountId: string
  date: string // ISO
  description: string
  amount: number
  type: 'DEBIT' | 'CREDIT' | string
  status?: string
  category?: string | null
  merchant?: { name?: string | null } | null
  creditCardMetadata?: {
    purchaseDate?: string | null
    transactionDateTime?: string | null
    installmentNumber?: number | null
    totalInstallments?: number | null
  } | null
}

export type Classificacao =
  | {
      acao: 'lancar'
      data: string // YYYY-MM-DD
      local: string
      valor_centavos: number
      tipo: Tipo
      parcela: { n: number; total: number } | null
    }
  | { acao: 'ignorar' | 'revisar'; motivo: string }

/** Data no fuso de São Paulo (a Pluggy manda ISO em UTC). */
export const dataSP = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

/** "Amazonmktplc*Mtechcome 6/6" → "Amazonmktplc*Mtechcome". */
const semParcela = (s: string) => s.replace(/\s+\d{1,2}\/\d{1,2}\s*$/, '').trim()

/**
 * O que fazer com uma transação de uma conta que tem plataforma no app.
 * `fechamento` é o dia de fechamento da plataforma (1 = mês do calendário), usado nas parcelas.
 */
export function classificar(conta: PluggyConta, t: PluggyTransacao, fechamento: number): Classificacao {
  if (conta.type !== 'CREDIT') return { acao: 'ignorar', motivo: 'conta corrente: sem regra de lançamento ainda' }
  const centavos = Math.round(Math.abs(t.amount) * 100)
  if (t.type === 'CREDIT' || t.amount < 0) {
    if (/pagamento recebido/i.test(t.description) || /credit card payment/i.test(t.category ?? ''))
      return { acao: 'ignorar', motivo: 'pagamento de fatura' }
    return { acao: 'revisar', motivo: 'crédito no cartão (estorno?)' }
  }
  if (centavos === 0) return { acao: 'ignorar', motivo: 'valor zero' }
  // IOF de compra internacional vem como transação separada; até hoje não foi lançado à parte.
  if (/^iof\b/i.test(t.description)) return { acao: 'revisar', motivo: 'IOF (sem regra ainda)' }

  const local = semParcela(t.merchant?.name?.trim() || t.description)
  const md = t.creditCardMetadata
  const n = Number(md?.installmentNumber)
  const total = Number(md?.totalInstallments)
  const parcela = Number.isInteger(n) && Number.isInteger(total) && total > 1 ? { n, total } : null

  // Padrão do app: 1ª parcela (e compra à vista) na data da compra; as seguintes no dia de fechamento
  // do mês em que caem.
  const data =
    parcela && parcela.n > 1
      ? `${dataSP(t.date).slice(0, 7)}-${String(fechamento).padStart(2, '0')}`
      : dataSP(md?.purchaseDate || t.date)

  return { acao: 'lancar', data, local, valor_centavos: centavos, tipo: fixoPelaCompra(local, centavos), parcela }
}

const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000

/**
 * Lançamento já existente que corresponde à compra (lançado à mão ou pela antiga notificação):
 * mesmo valor, na mesma plataforma, ainda não ligado a outra transação da Pluggy, e
 *  - parcela seguinte: no mesmo mês;
 *  - compra à vista ou 1ª parcela: até 3 dias de diferença (o mais próximo).
 */
export function acharExistente<L extends { id: number; data: string; valor_centavos: number }>(
  c: Extract<Classificacao, { acao: 'lancar' }>,
  candidatos: L[],
): L | null {
  const mesmos = candidatos.filter((l) => l.valor_centavos === c.valor_centavos)
  if (c.parcela && c.parcela.n > 1) return mesmos.find((l) => l.data.slice(0, 7) === c.data.slice(0, 7)) ?? null
  const perto = mesmos.filter((l) => dias(l.data, c.data) <= 3).sort((a, b) => dias(a.data, c.data) - dias(b.data, c.data))
  return perto[0] ?? null
}

/** Chave de "mesma compra" para quando a Pluggy troca o id (pendente → lançada na fatura). */
export const chaveCompra = (t: PluggyTransacao) =>
  `${t.accountId}|${Math.round(Math.abs(t.amount) * 100)}|${dataSP(t.creditCardMetadata?.purchaseDate || t.creditCardMetadata?.transactionDateTime || t.date)}|${t.creditCardMetadata?.installmentNumber ?? ''}`
