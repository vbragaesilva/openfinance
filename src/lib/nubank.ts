// Lê uma notificação do Nubank (repassada pelo atalho do iPhone) e decide se vira lançamento.
// Por enquanto só "Compra no crédito aprovada" vira lançamento; o resto (fatura fechada,
// promoções, Pix, débito...) continua só guardado até termos exemplos para escrever as regras.
//
// Formato real (2026-10-03):
//   título   "Compra no crédito aprovada"
//   mensagem "Compra de R$ 6,89 APROVADA em APPLE.COM/BILL para o cartão com final 9589."
import { lerValor } from './formato.ts'
import type { Tipo } from './tipos.ts'
import type { Notificacao } from './splitwise.ts'

export type LeituraNubank =
  | { tipo: 'credito'; valor_centavos: number; local: string; cartao: string | null; fixo: Tipo }
  | { tipo: 'capturada' } // ainda sem regra: só guarda
  | { tipo: 'revisar'; motivo: string }

const TITULO_CREDITO = /^\s*compra no cr[eé]dito aprovada\s*$/i
const COMPRA = /compra de (?:R\$|BRL)\s*([\d.]+(?:,\d{1,2})?)\s+aprovada em\s+(.+?)(?:\s+para o cart[aã]o com final\s+(\d{3,4}))?\.?\s*$/i

/**
 * Assinatura da Apple que já está nos fixos (iCloud): só quando for exatamente R$ 5,90 na
 * apple.com. Outras compras na Apple (jogos, apps) aparecem com o mesmo estabelecimento.
 */
export const fixoPelaCompra = (local: string, centavos: number): Tipo =>
  /apple\.com/i.test(local) && centavos === 590 ? 'Fixo' : 'Variável'

export function lerNotificacaoNubank(n: Notificacao): LeituraNubank {
  if (!TITULO_CREDITO.test(n.titulo ?? '')) return { tipo: 'capturada' }
  const m = (n.mensagem ?? '').trim().match(COMPRA)
  if (!m) return { tipo: 'revisar', motivo: 'título de compra no crédito, mas a mensagem veio em outro formato' }
  const valor = lerValor(m[1])
  if (valor == null || valor <= 0) return { tipo: 'revisar', motivo: `valor ilegível: ${m[1]}` }
  const local = m[2].trim()
  return { tipo: 'credito', valor_centavos: valor, local, cartao: m[3] ?? null, fixo: fixoPelaCompra(local, valor) }
}
