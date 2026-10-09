// Regras da sincronização com a Pluggy (Open Finance pelo Meu Pluggy). Funções puras, sem rede nem banco.
//
// Por enquanto só o cartão de crédito vira lançamento: compras, IOF (separado) e estornos (negativos).
// Pagamento de fatura, conta corrente, Pix etc. ficam guardados sem lançar até ganharem regra.
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
  amount: number // na moeda da compra (USD numa compra internacional)
  amountInAccountCurrency?: number | null // em reais, quando a compra foi em outra moeda
  currencyCode?: string
  type: 'DEBIT' | 'CREDIT' | string
  status?: string
  category?: string | null
  merchant?: { name?: string | null } | null
  creditCardMetadata?: {
    purchaseDate?: string | null
    transactionDateTime?: string | null
    installmentNumber?: number | null
    totalInstallments?: number | null
    feeTypeAdditionalInfo?: string | null
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

/** Valor em reais: compra internacional vem com `amount` em dólar e o valor em reais à parte. */
export const valorReais = (t: PluggyTransacao) =>
  t.currencyCode && t.currencyCode !== 'BRL' && t.amountInAccountCurrency != null ? t.amountInAccountCurrency : t.amount

/** "Amazonmktplc*Mtechcome 6/6" → "Amazonmktplc*Mtechcome". */
const semParcela = (s: string) => s.replace(/\s+\d{1,2}\/\d{1,2}\s*$/, '').trim()

/**
 * O que fazer com uma transação de uma conta que tem plataforma no app.
 * `fechamento` é o dia de fechamento da plataforma (1 = mês do calendário), usado nas parcelas.
 */
export function classificar(conta: PluggyConta, t: PluggyTransacao, fechamento: number): Classificacao {
  if (conta.type !== 'CREDIT') return { acao: 'ignorar', motivo: 'conta corrente: sem regra de lançamento ainda' }
  const centavos = Math.round(Math.abs(valorReais(t)) * 100)
  if (t.type === 'CREDIT' || valorReais(t) < 0) {
    if (/pagamento recebido/i.test(t.description) || /credit card payment/i.test(t.category ?? ''))
      return { acao: 'ignorar', motivo: 'pagamento de fatura' }
    // Estorno entra negativo, como já era lançado à mão. A Pluggy não diz de qual compra ele é.
    if (/estorno/i.test(t.description) && centavos > 0) {
      const local = semParcela(t.merchant?.name?.trim() || t.description)
      return { acao: 'lancar', data: dataSP(t.date), local, valor_centavos: -centavos, tipo: 'Variável', parcela: null }
    }
    return { acao: 'revisar', motivo: 'crédito no cartão que não é estorno nem pagamento' }
  }
  if (centavos === 0) return { acao: 'ignorar', motivo: 'valor zero' }
  // IOF de compra internacional vem como transação separada, sem dizer de qual compra: entra como
  // lançamento próprio, com local "IOF" (decisão do usuário, 2026-10-09).
  if (/^iof\b/i.test(t.description) || /^IOF/.test(t.creditCardMetadata?.feeTypeAdditionalInfo ?? '')) {
    return { acao: 'lancar', data: dataSP(t.date), local: 'IOF', valor_centavos: centavos, tipo: 'Variável', parcela: null }
  }

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

const diaAnterior = (data: string) => new Date(Date.parse(data) - 86_400_000).toISOString().slice(0, 10)

/**
 * Liga cada compra a um lançamento que já existia (lançado à mão ou pela antiga notificação), cada
 * lançamento a no máximo uma compra. Precisa do mesmo valor e:
 *  - parcela seguinte: o mesmo mês;
 *  - compra à vista ou 1ª parcela: o mesmo dia ou, se não houver, o lançamento do dia anterior
 *    (compra logo depois da meia-noite lançada com a data da noite).
 * Primeiro todos os pares do mesmo dia, depois os do dia anterior: um café de hoje nunca pega o
 * lançamento do café de ontem. Devolve, para cada compra, o lançamento ligado ou null.
 */
export function parear<L extends { id: number; data: string; valor_centavos: number }>(
  compras: Extract<Classificacao, { acao: 'lancar' }>[],
  candidatos: L[],
): (L | null)[] {
  const livres = new Set(candidatos)
  const pares: (L | null)[] = compras.map(() => null)
  const regras = [
    (c: (typeof compras)[number], l: L) =>
      c.parcela && c.parcela.n > 1 ? l.data.slice(0, 7) === c.data.slice(0, 7) : l.data === c.data,
    (c: (typeof compras)[number], l: L) => !(c.parcela && c.parcela.n > 1) && l.data === diaAnterior(c.data),
  ]
  for (const regra of regras) {
    compras.forEach((c, i) => {
      if (pares[i]) return
      const l = candidatos.find((l) => livres.has(l) && l.valor_centavos === c.valor_centavos && regra(c, l))
      if (l) {
        pares[i] = l
        livres.delete(l)
      }
    })
  }
  return pares
}

/**
 * Chave de "mesma compra" para quando a Pluggy troca o id (pendente → lançada na fatura): conta, valor,
 * horário exato da compra (com segundos, para dois cafés iguais no mesmo dia serem compras diferentes)
 * e número da parcela.
 */
export const chaveCompra = (t: PluggyTransacao) =>
  `${t.accountId}|${Math.round(Math.abs(valorReais(t)) * 100)}|${t.creditCardMetadata?.purchaseDate || t.creditCardMetadata?.transactionDateTime || t.date}|${t.creditCardMetadata?.installmentNumber ?? ''}`
