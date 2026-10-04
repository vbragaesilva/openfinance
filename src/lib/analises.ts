// Análises (o que a pizza do PAINEL e a CreditoDinamica mostravam para o crédito), por mês, ano ou
// tudo. Entram as plataformas marcadas "nas análises" em Configurações.
import { chaveMes, ehFixo, mesDoLancamento } from './painel.ts'
import type { Dados, Lancamento } from './tipos.ts'

export type Periodo = { tipo: 'mes'; ano: number; mes: number } | { tipo: 'ano'; ano: number } | { tipo: 'tudo' }

export const SEM_CATEGORIA = 'Sem categoria'

const idsNasAnalises = (dados: Dados) => new Set(dados.plataformas.filter((p) => p.nas_analises).map((p) => p.id))

/** Nome do conjunto analisado, para títulos: "Crédito Nubank", "Crédito Nubank + Débito", "3 plataformas". */
export function rotuloAnalises(dados: Dados): string {
  const nomes = dados.plataformas.filter((p) => p.nas_analises).map((p) => p.nome)
  return nomes.length <= 2 ? nomes.join(' + ') : `${nomes.length} plataformas`
}

/** Lançamentos analisados do período. `semFixos` tira o que já está nos fixos. */
export function lancamentosDoPeriodo(dados: Dados, periodo: Periodo, semFixos: boolean): Lancamento[] {
  const prefixo =
    periodo.tipo === 'mes' ? chaveMes(periodo.ano, periodo.mes) : periodo.tipo === 'ano' ? `${periodo.ano}-` : ''
  const ids = idsNasAnalises(dados)
  const mesDe = mesDoLancamento(dados)
  return dados.lancamentos.filter(
    (l) => ids.has(l.plataforma_id) && mesDe(l).startsWith(prefixo) && !(semFixos && ehFixo(l)),
  )
}

/**
 * Ordem fixa das categorias (maior total analisado de todos os tempos primeiro). Define as cores,
 * então a cor de uma categoria não muda quando o filtro muda.
 */
export function ordemCategorias(dados: Dados): string[] {
  const total = new Map<string, number>()
  const ids = idsNasAnalises(dados)
  for (const l of dados.lancamentos) {
    if (!ids.has(l.plataforma_id) || l.categoria == null) continue
    total.set(l.categoria, (total.get(l.categoria) ?? 0) + l.valor_centavos)
  }
  return [...total.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
}

export interface Fatia {
  categoria: string
  valor: number
}

/**
 * Total por categoria. Lançamentos sem categoria (ex.: a parcela do seu pai, que depois volta
 * no débito) ficam fora das fatias e vêm à parte, para não distorcer as porcentagens.
 */
export function porCategoria(lancs: Lancamento[]): { fatias: Fatia[]; semCategoria: number; total: number } {
  const mapa = new Map<string, number>()
  let semCategoria = 0
  for (const l of lancs) {
    if (l.categoria == null) semCategoria += l.valor_centavos
    else mapa.set(l.categoria, (mapa.get(l.categoria) ?? 0) + l.valor_centavos)
  }
  const fatias = [...mapa.entries()]
    .map(([categoria, valor]) => ({ categoria, valor }))
    .filter((f) => f.valor > 0)
    .sort((a, b) => b.valor - a.valor)
  return { fatias, semCategoria, total: fatias.reduce((s, f) => s + f.valor, 0) }
}

export interface MesCategorias {
  chave: string // AAAA-MM
  ano: number
  mes: number
  porCategoria: Map<string, number>
  total: number // só categorias com soma positiva
}

/**
 * Total por categoria em cada mês, do primeiro ao último mês com lançamento (sem buracos).
 * `mesDe` diz o mês de cada lançamento (ver mesDoLancamento).
 */
export function evolucaoMensal(lancs: Lancamento[], mesDe: (l: Lancamento) => string): MesCategorias[] {
  if (lancs.length === 0) return []
  const chaves = lancs.map(mesDe).sort()
  const [a0, m0] = chaves[0].split('-').map(Number)
  const [a1, m1] = chaves[chaves.length - 1].split('-').map(Number)
  const meses: MesCategorias[] = []
  for (let idx = a0 * 12 + m0 - 1; idx <= a1 * 12 + m1 - 1; idx++) {
    const ano = Math.floor(idx / 12)
    const mes = (idx % 12) + 1
    meses.push({ chave: chaveMes(ano, mes), ano, mes, porCategoria: new Map(), total: 0 })
  }
  const porChave = new Map(meses.map((m) => [m.chave, m]))
  for (const l of lancs) {
    if (l.categoria == null) continue
    const m = porChave.get(mesDe(l))!
    m.porCategoria.set(l.categoria, (m.porCategoria.get(l.categoria) ?? 0) + l.valor_centavos)
  }
  for (const m of meses) m.total = [...m.porCategoria.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0)
  return meses
}

export interface LinhaRanking {
  nome: string
  valor: number
  vezes: number
}

/** Onde mais foi gasto: soma por local (sem diferenciar maiúsculas/acentos de digitação). */
export function topLocais(lancs: Lancamento[], n = 10): LinhaRanking[] {
  const mapa = new Map<string, LinhaRanking>()
  for (const l of lancs) {
    const nome = l.local.trim()
    if (!nome) continue
    const chave = nome.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    const atual = mapa.get(chave) ?? { nome, valor: 0, vezes: 0 }
    atual.valor += l.valor_centavos
    atual.vezes++
    mapa.set(chave, atual)
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor).slice(0, n)
}

/** Maiores compras do período (a antiga visão "por mês, maior valor primeiro" da aba CRÉDITO). */
export function maioresCompras(lancs: Lancamento[], n = 10): Lancamento[] {
  return [...lancs].sort((a, b) => b.valor_centavos - a.valor_centavos).slice(0, n)
}
