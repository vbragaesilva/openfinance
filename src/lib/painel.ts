// Cálculos do antigo PAINEL. Segue o bloco mais recente da planilha (Julho em diante) — os
// comentários apontam a célula equivalente do bloco de Julho (colunas P–S) — com os ajustes
// pedidos depois da migração:
//  - o que é Fixo (tipo do lançamento) não entra no Gasto, porque já está descontado em Fixos.
//    O total de cada plataforma continua mostrando tudo, para conferir com a fatura do cartão,
//    com o Splitwise etc.;
//  - salário e fixos têm vigência por mês, então mudar um valor não altera meses anteriores;
//  - crédito, débito e split viraram plataformas configuráveis: o Gasto é a soma de todas, sem
//    os fixos (o antigo Q11 = crédito sem fixos + débito + split sem fixos), e cada uma tem um dia
//    de fechamento: compra antes dele conta no mês anterior.
// Todos os valores em centavos.
import type { Dados, Fixo, Lancamento, Pagamento, Plataforma, Vigencia } from './tipos.ts'

export interface Hoje {
  ano: number
  mes: number // 1-12
  dia: number
}

export function hojeLocal(d = new Date()): Hoje {
  return { ano: d.getFullYear(), mes: d.getMonth() + 1, dia: d.getDate() }
}

export const diasNoMes = (ano: number, mes: number) => new Date(ano, mes, 0).getDate()

export const chaveMes = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, '0')}`

/** Mês (AAAA-MM) em que uma compra conta: antes do dia de fechamento, conta no mês anterior. */
export function mesDaCompra(data: string, fechamento: number): string {
  if (Number(data.slice(8, 10)) >= fechamento) return data.slice(0, 7)
  const ano = Number(data.slice(0, 4))
  const mes = Number(data.slice(5, 7))
  return mes === 1 ? chaveMes(ano - 1, 12) : chaveMes(ano, mes - 1)
}

/** Função que diz o mês (AAAA-MM) de cada lançamento, pelo fechamento da plataforma dele. */
export function mesDoLancamento(dados: Pick<Dados, 'plataformas'>): (l: Lancamento) => string {
  const fechamento = new Map(dados.plataformas.map((p) => [p.id, p.fechamento]))
  return (l) => mesDaCompra(l.data, fechamento.get(l.plataforma_id) ?? 1)
}

/** Lançamentos que contam no mês (pelo fechamento de cada plataforma). */
export function lancamentosDoMes(dados: Pick<Dados, 'plataformas' | 'lancamentos'>, ano: number, mes: number) {
  const chave = chaveMes(ano, mes)
  const mesDe = mesDoLancamento(dados)
  return dados.lancamentos.filter((l) => mesDe(l) === chave)
}

/**
 * Primeiro e último dia de compra que contam no mês para uma plataforma (AAAA-MM-DD).
 * Com fechamento 5, outubro vai de 05/10 a 04/11.
 */
export function periodoDaPlataforma(p: Plataforma, ano: number, mes: number): { de: string; ate: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  if (p.fechamento <= 1) return { de: `${chaveMes(ano, mes)}-01`, ate: `${chaveMes(ano, mes)}-${pad(diasNoMes(ano, mes))}` }
  const [aSeg, mSeg] = mes === 12 ? [ano + 1, 1] : [ano, mes + 1]
  return { de: `${chaveMes(ano, mes)}-${pad(p.fechamento)}`, ate: `${chaveMes(aSeg, mSeg)}-${pad(p.fechamento - 1)}` }
}

const soma = <T>(itens: T[], f: (i: T) => number) => itens.reduce((s, i) => s + f(i), 0)

/** Fixo = já previsto nos fixos. Sem tipo conta como gasto, igual a Variável. */
export function ehFixo(item: Lancamento) {
  return item.tipo === 'Fixo'
}

/** Valor que vale no mês `chave` (AAAA-MM): a última vigência que começou até ele. */
export function vigente(vigencias: Vigencia[], chave: string): Vigencia | null {
  let atual: Vigencia | null = null
  for (const v of vigencias) if (v.desde <= chave && (!atual || v.desde > atual.desde)) atual = v
  return atual
}

export interface FixoNoMes {
  fixo: Fixo
  valor: number
  /** Mês a partir do qual esse valor vale. */
  desde: string
}

/** Fixos que existem no mês, com o valor vigente naquele mês. */
export function fixosDoMes(dados: Dados, ano: number, mes: number): FixoNoMes[] {
  const chave = chaveMes(ano, mes)
  const lista: FixoNoMes[] = []
  for (const fixo of dados.fixos) {
    if (fixo.inicio > chave || (fixo.fim != null && fixo.fim < chave)) continue
    const v = vigente(fixo.valores, chave)
    if (v) lista.push({ fixo, valor: v.valor_centavos, desde: v.desde })
  }
  return lista
}

export const salarioDoMes = (dados: Dados, ano: number, mes: number) => vigente(dados.salarios, chaveMes(ano, mes))

export type DiasParaLiberar = number | 'PARE!' | null

export interface TotalPlataforma {
  plataforma: Plataforma
  total: number // tudo, para conferir (antigos Q9 Fatura e Q7 Split total)
  semFixos: number // o que entra no Gasto (antigos Q10, Q8 e Q6)
}

export interface ResumoMes {
  ano: number
  mes: number
  dias: number // R2
  diaAtual: number // R3
  salario: number // Q3
  fixos: number // Q4
  restante: number // Q5
  idealDiario: number // S5
  caixaAtual: number | null // R5
  /** Todas as plataformas, na ordem configurada. */
  plataformas: TotalPlataforma[]
  gasto: number // Q11 = soma das plataformas sem fixos
  excedenteMes: number // Q12
  atualIdeal: number // R9
  excedenteHoje: number // S9
  diasParaLiberar: DiasParaLiberar // S10
  diaLiberado: number | null // R10
  taDeBoa: number // S11
  caixaProj: number // R7
  investProj: number // S7
}

export function resumoMes(dados: Dados, ano: number, mes: number, hoje: Hoje): ResumoMes {
  const dias = diasNoMes(ano, mes)
  const idxMes = ano * 12 + mes
  const idxHoje = hoje.ano * 12 + hoje.mes
  // =IF(MONTH(TODAY())=R1, DAY(TODAY()), IF(MONTH(TODAY())>R1, R2, 0))
  const diaAtual = idxMes === idxHoje ? hoje.dia : idxHoje > idxMes ? dias : 0

  const fixosMes = fixosDoMes(dados, ano, mes)
  const salario = salarioDoMes(dados, ano, mes)?.valor_centavos ?? 0 // =FIXOS!$F$2
  const fixos = soma(fixosMes, (f) => f.valor) // =FIXOS!$F$3 = SUM(Fixos[Valor])
  const restante = salario - fixos // =Q3-Q4
  const idealDiario = restante / dias // =Q5/R2

  const lancs = lancamentosDoMes(dados, ano, mes)
  const plataformas = dados.plataformas.map((plataforma) => {
    const daPlataforma = lancs.filter((l) => l.plataforma_id === plataforma.id)
    return {
      plataforma,
      total: soma(daPlataforma, (l) => l.valor_centavos),
      semFixos: soma(daPlataforma.filter((l) => !ehFixo(l)), (l) => l.valor_centavos),
    }
  })

  const gasto = soma(lancs.filter((l) => !ehFixo(l)), (l) => l.valor_centavos)
  const excedenteMes = restante - gasto // =Q5-Q11

  const atualIdeal = (Math.max(diaAtual - 1, 0) / dias) * restante // =(MAX(R3-1,0)/R2)*Q5
  const excedenteHoje = atualIdeal - gasto // =R9-Q11

  // =IF(S9<0, IF(Q11>=Q5, "PARE!", CEILING(-S9/S5, 1)), "")
  let diasParaLiberar: DiasParaLiberar = null
  if (excedenteHoje < 0) {
    if (gasto >= restante || idealDiario <= 0) diasParaLiberar = 'PARE!'
    else diasParaLiberar = Math.ceil(-excedenteHoje / idealDiario - 1e-9)
  }
  // =IFERROR(IF(S10, R3+S10, ""), 0)
  const diaLiberado = typeof diasParaLiberar === 'number' ? diaAtual + diasParaLiberar : null
  // =IFERROR(S10*S5+S9, 0)  ("" vira 0 na multiplicação; "PARE!" dá erro -> 0)
  const taDeBoa =
    diasParaLiberar === 'PARE!' ? 0 : (diasParaLiberar ?? 0) * idealDiario + excedenteHoje

  const caixaAtual = dados.caixa.find((c) => c.ano === ano && c.mes === mes)?.valor_centavos ?? null
  const caixa = caixaAtual ?? 0
  // O caixa (saldo da conta) cobre o estouro antes de mexer no invest.
  // =IF(Q5-Q11>=0, R5, IF(Q5-Q11+R5>=0, Q5-Q11+R5, 0))
  const caixaProj = excedenteMes >= 0 ? caixa : excedenteMes + caixa >= 0 ? excedenteMes + caixa : 0
  // =IF(Q5-Q11+R5>=0, FIXOS!$D$10, Q5-Q11+R5+FIXOS!$D$10)
  const invest = soma(fixosMes.filter((f) => f.fixo.investimento), (f) => f.valor)
  const investProj = excedenteMes + caixa >= 0 ? invest : excedenteMes + caixa + invest

  return {
    ano, mes, dias, diaAtual, salario, fixos, restante, idealDiario, caixaAtual,
    plataformas, gasto, excedenteMes,
    atualIdeal, excedenteHoje, diasParaLiberar, diaLiberado, taDeBoa, caixaProj, investProj,
  }
}

export interface PontoRitmo {
  dia: number
  gastoAcumulado: number | null
  idealAcumulado: number
}

/** Gasto acumulado dia a dia contra a linha ideal (Restante / dias por dia). */
export function ritmoDoMes(dados: Dados, r: ResumoMes): PontoRitmo[] {
  const porDia = new Array<number>(r.dias + 1).fill(0)
  const chave = chaveMes(r.ano, r.mes)
  for (const l of lancamentosDoMes(dados, r.ano, r.mes)) {
    // Compra do mês seguinte que ainda conta neste (antes do fechamento) entra no último dia.
    if (!ehFixo(l)) porDia[l.data.startsWith(chave) ? Number(l.data.slice(8, 10)) : r.dias] += l.valor_centavos
  }
  // Mês corrente: a linha de gasto vai até hoje. Passado e futuro: mês inteiro.
  const ultimoDia = r.diaAtual > 0 && r.diaAtual < r.dias ? r.diaAtual : r.dias
  const pontos: PontoRitmo[] = []
  let acc = 0
  for (let d = 1; d <= r.dias; d++) {
    acc += porDia[d]
    pontos.push({ dia: d, gastoAcumulado: d <= ultimoDia ? acc : null, idealAcumulado: d * r.idealDiario })
  }
  return pontos
}

/** Meses a mostrar na visão do ano: do primeiro mês com lançamento até dezembro. */
export function mesesDoAno(dados: Dados, ano: number, hoje: Hoje): number[] {
  const mesDe = mesDoLancamento(dados)
  const meses = dados.lancamentos
    .map(mesDe)
    .filter((m) => m.startsWith(`${ano}-`))
    .map((m) => Number(m.slice(5, 7)))
  if (ano === hoje.ano) meses.push(hoje.mes)
  const primeiro = meses.length ? Math.min(...meses) : 1
  return Array.from({ length: 13 - primeiro }, (_, i) => primeiro + i)
}

// ---- FIXOS

export function pagamentoNoMes(fixo: Fixo, ano: number, mes: number): Pagamento | undefined {
  const chave = chaveMes(ano, mes)
  return fixo.pagamentos.findLast((p) => p.data.startsWith(chave))
}

/** "Próximo" da aba FIXOS: mês seguinte ao do último pagamento. */
export function proximoVencimento(fixo: Fixo): { ano: number; mes: number } | null {
  const ultimo = fixo.pagamentos.at(-1)
  if (!ultimo) return null
  const ano = Number(ultimo.data.slice(0, 4))
  const mes = Number(ultimo.data.slice(5, 7))
  return mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 }
}

/** QUITADO = todos os fixos do mês têm pagamento dentro dele (regra da célula FIXOS!B11). */
export function statusFixos(dados: Dados, ano: number, mes: number): 'QUITADO' | 'Pendente' {
  const lista = fixosDoMes(dados, ano, mes)
  return lista.length > 0 && lista.every((f) => pagamentoNoMes(f.fixo, ano, mes)) ? 'QUITADO' : 'Pendente'
}
