// Cálculos do antigo PAINEL. Segue o bloco mais recente da planilha (Julho em diante) — os
// comentários apontam a célula equivalente do bloco de Julho (colunas P–S) — com dois ajustes
// pedidos depois da migração:
//  - o que é Fixo (tipo do lançamento / "Fixo?" do split) não entra no Gasto, porque já está
//    descontado em Fixos. Fatura e Split total continuam mostrando tudo, para conferir com o
//    cartão e com o Splitwise;
//  - salário e fixos têm vigência por mês, então mudar um valor não altera meses anteriores.
// Todos os valores em centavos.
import type { Dados, Fixo, Lancamento, Pagamento, SplitItem, Vigencia } from './tipos.ts'

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

export const doMes = <T extends { data: string }>(itens: T[], ano: number, mes: number) => {
  const prefixo = chaveMes(ano, mes)
  return itens.filter((i) => i.data.startsWith(prefixo))
}

const soma = <T>(itens: T[], f: (i: T) => number) => itens.reduce((s, i) => s + f(i), 0)

/** Fixo = já previsto nos fixos. Sem tipo conta como gasto, igual a Variável. */
export function ehFixo(item: Lancamento | SplitItem) {
  return ('modalidade' in item ? item.tipo : item.fixo) === 'Fixo'
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
  splitTotal: number // Q7 — confere com o Splitwise
  splitSemFixos: number // Q8 (antes: só "Variável")
  fatura: number // Q9 — confere com a fatura do cartão
  creditoSemFixos: number // Q10 (antes calculado mas fora do Gasto)
  debito: number // Q6 (sem os marcados como Fixo)
  gasto: number // Q11 = split sem fixos + crédito sem fixos + débito
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

  const lancs = doMes(dados.lancamentos, ano, mes)
  const splits = doMes(dados.split, ano, mes)
  const credito = lancs.filter((l) => l.modalidade === 'Crédito')

  const semFixos = <T extends Lancamento | SplitItem>(itens: T[]) => itens.filter((i) => !ehFixo(i))
  const debito = soma(semFixos(lancs.filter((l) => l.modalidade === 'Débito')), (l) => l.valor_centavos)
  const splitTotal = soma(splits, (s) => s.valor_centavos)
  const splitSemFixos = soma(semFixos(splits), (s) => s.valor_centavos)
  const fatura = soma(credito, (l) => l.valor_centavos)
  const creditoSemFixos = soma(semFixos(credito), (l) => l.valor_centavos)

  const gasto = splitSemFixos + creditoSemFixos + debito
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
    splitTotal, splitSemFixos, fatura, creditoSemFixos, debito, gasto, excedenteMes,
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
  for (const item of [...doMes(dados.lancamentos, r.ano, r.mes), ...doMes(dados.split, r.ano, r.mes)]) {
    if (!ehFixo(item)) porDia[Number(item.data.slice(8, 10))] += item.valor_centavos
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
  const meses = [...dados.lancamentos, ...dados.split]
    .filter((i) => i.data.startsWith(`${ano}-`))
    .map((i) => Number(i.data.slice(5, 7)))
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
