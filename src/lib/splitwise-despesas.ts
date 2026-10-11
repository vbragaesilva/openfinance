// Regras da sincronização com o Splitwise web (skill sincronizar-splitwise). Funções puras, sem rede nem banco.
//
// O valor do split é o mesmo da notificação: "Você deve BRL X" vira +X e "Você recebeu de volta BRL X" vira −X.
// Na despesa do Splitwise isso é o `net_balance` do usuário com o sinal trocado (net_balance = pago − devido).
// Combinado com o usuário: `data` do lançamento = data da despesa; `criado_em` = quando ela foi criada.
import { fixoPeloNome } from './splitwise.ts'
import { dataSP } from './pluggy.ts'
import type { Tipo } from './tipos.ts'

/** Despesa como a operação `despesas` do api-anything devolve (ver integracoes/splitwise.api-anything.json). */
export interface DespesaSplitwise {
  id: number | string
  grupo?: number | null
  descricao: string
  pagamento: boolean
  custo: string
  moeda: string
  data: string // ISO, UTC
  criada: string // ISO, UTC
  atualizada: string // ISO, UTC
  apagada: string | null
  usuarios: number[]
  saldos: string[] // net_balance de cada usuário, na mesma ordem
}

export type LeituraDespesa =
  | { acao: 'lancar'; data: string; criado_em: string; nome: string; valor_centavos: number; tipo: Tipo }
  | { acao: 'ignorar' | 'revisar'; motivo: string; data: string; valor_centavos: number }

/** "2026-10-09T23:07:11Z" → "2026-10-09 20:07:11" (horário de São Paulo, como o resto do banco). */
export const horaSP = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' })

/** net_balance do usuário em centavos (0 se ele não está na despesa). */
export function meuSaldo(d: DespesaSplitwise, eu: number): number {
  const i = d.usuarios.indexOf(eu)
  return i < 0 ? 0 : Math.round(Number(d.saldos[i]) * 100)
}

export function lerDespesa(d: DespesaSplitwise, eu: number): LeituraDespesa {
  const data = dataSP(d.data)
  const valor_centavos = -meuSaldo(d, eu)
  const nao = (acao: 'ignorar' | 'revisar', motivo: string) => ({ acao, motivo, data, valor_centavos })
  if (d.apagada) return nao('ignorar', 'apagada no Splitwise')
  if (d.pagamento) return nao('ignorar', 'pagamento (acerto de contas)')
  if (!d.usuarios.includes(eu)) return nao('ignorar', 'não participo da despesa')
  if (valor_centavos === 0) return nao('ignorar', 'minha parte é zero')
  if (d.moeda !== 'BRL') return nao('revisar', `em ${d.moeda}: sem regra de conversão`)
  const nome = d.descricao.trim() || 'Splitwise'
  return { acao: 'lancar', data, criado_em: horaSP(d.criada), nome, valor_centavos, tipo: fixoPeloNome(nome) }
}

/** A despesa foi criada antes de `inicio` ('AAAA-MM-DD' ou 'AAAA-MM-DD HH:MM:SS', horário de SP)? */
export const criadaAntes = (d: DespesaSplitwise, inicio: string) => horaSP(d.criada) < inicio

const distanciaDias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000

/**
 * Liga cada despesa a um lançamento do Splitwise que ainda não tem dono: mesmo valor, primeiro no mesmo dia,
 * depois a 1, 2 e 3 dias (a notificação usa o dia em que chegou, e lançamentos à mão às vezes levam a data
 * do dia seguinte). Cada lançamento é usado uma vez só.
 */
export function parearDespesas<L extends { id: number; data: string; valor_centavos: number }>(
  despesas: { data: string; valor_centavos: number }[],
  candidatos: L[],
): (L | null)[] {
  const livres = new Set(candidatos)
  const pares: (L | null)[] = despesas.map(() => null)
  for (const tolerancia of [0, 1, 2, 3]) {
    despesas.forEach((d, i) => {
      if (pares[i]) return
      const l = candidatos.find(
        (l) => livres.has(l) && l.valor_centavos === d.valor_centavos && distanciaDias(l.data, d.data) <= tolerancia,
      )
      if (l) {
        pares[i] = l
        livres.delete(l)
      }
    })
  }
  return pares
}

export interface ConferenciaSaldo {
  saldoSplitwise: number // soma dos saldos com os amigos (positivo = me devem)
  saldoAntes: number // saldo vindo de antes de `inicio`
  pagamentos: number // acertos de contas desde `inicio` (positivo = eu paguei)
  splitsNoBanco: number // soma dos lançamentos do Splitwise desde `inicio`
  esperado: number // o saldo que o banco explica
  diferenca: number // saldoSplitwise − esperado; 0 = bate
}

/**
 * Confere o saldo do Splitwise com o banco. O saldo é a soma dos net_balance de todas as despesas, inclusive
 * pagamentos; os splits do banco são esse net_balance com o sinal trocado, sem os pagamentos. Então:
 * saldo = saldo de antes de `inicio` + pagamentos desde `inicio` − splits do banco desde `inicio`.
 * `inicio` compara com a criação da despesa (o banco foi dado como certo até ali, combinado com o usuário).
 */
export function conferirSaldo(o: {
  despesas: DespesaSplitwise[]
  eu: number
  inicio: string
  saldoSplitwise: number
  splitsNoBanco: number
}): ConferenciaSaldo {
  let saldoAntes = 0
  let pagamentos = 0
  for (const d of o.despesas) {
    if (d.apagada) continue
    if (criadaAntes(d, o.inicio)) saldoAntes += meuSaldo(d, o.eu)
    else if (d.pagamento) pagamentos += meuSaldo(d, o.eu)
  }
  const esperado = saldoAntes + pagamentos - o.splitsNoBanco
  return { saldoSplitwise: o.saldoSplitwise, saldoAntes, pagamentos, splitsNoBanco: o.splitsNoBanco, esperado, diferenca: o.saldoSplitwise - esperado }
}
