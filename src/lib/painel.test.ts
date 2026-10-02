import assert from 'node:assert/strict'
import { test } from 'node:test'
import { creditoDoPeriodo, evolucaoMensal, ordemCategorias, porCategoria } from './analises.ts'
import { lerValor } from './formato.ts'
import { fixosDoMes, resumoMes, statusFixos } from './painel.ts'
import { gerarParcelas } from './parcelas.ts'
import type { Dados, Fixo, Lancamento, SplitItem } from './tipos.ts'

let id = 0
const lanc = (
  data: string,
  valor: number,
  modalidade: 'Crédito' | 'Débito' = 'Crédito',
  tipo: 'Variável' | 'Fixo' | null = 'Variável',
  categoria: string | null = null,
): Lancamento => ({
  id: ++id, criado_em: `${data} 12:00:00`, data, produto: 'x', local: 'y', valor_centavos: valor, categoria, modalidade, tipo,
})
const split = (data: string, valor: number, fixo: 'Variável' | 'Fixo' = 'Variável'): SplitItem => ({
  id: ++id, criado_em: `${data} 12:00:00`, data, nome: 'z', valor_centavos: valor, fixo,
})
const fixo = (nome: string, valor: number, extra: Partial<Fixo> = {}): Fixo => ({
  id: ++id, nome, investimento: false, ordem: id, inicio: '2026-04', fim: null,
  valores: [{ desde: '2026-04', valor_centavos: valor }], pagamentos: [{ id: ++id, data: '2026-09-04' }], ...extra,
})

function dados(parcial: Partial<Dados>): Dados {
  return {
    lancamentos: [], split: [], caixa: [], notificacoes: [],
    salarios: [{ desde: '2026-04', valor_centavos: 400000 }],
    // Restante = 4000 - 3100 = 900; em setembro (30 dias) o ideal diário é 30,00.
    fixos: [fixo('Aluguel', 110000), fixo('Invest', 200000, { investimento: true })],
    ...parcial,
  }
}

test('Gasto não conta o que é Fixo; Fatura e Split total continuam com tudo', () => {
  const d = dados({
    lancamentos: [
      lanc('2026-09-02', 10000),
      lanc('2026-09-03', 590, 'Crédito', 'Fixo'), // iCloud: já está nos fixos
      lanc('2026-09-04', 250, 'Crédito', null), // sem tipo conta como gasto
      lanc('2026-09-05', -2000, 'Débito'),
    ],
    split: [split('2026-09-02', 1500), split('2026-09-03', 2400, 'Fixo')],
  })
  const r = resumoMes(d, 2026, 9, { ano: 2026, mes: 9, dia: 10 })
  assert.equal(r.fatura, 10840)
  assert.equal(r.creditoSemFixos, 10250)
  assert.equal(r.splitTotal, 3900)
  assert.equal(r.splitSemFixos, 1500)
  assert.equal(r.debito, -2000)
  assert.equal(r.gasto, 10250 + 1500 - 2000)
  assert.equal(r.restante, 90000)
  assert.equal(r.excedenteMes, 90000 - r.gasto)
})

test('ritmo: abaixo do ideal até ontem = tá de boa', () => {
  const d = dados({ lancamentos: [lanc('2026-09-01', 20000)] })
  const r = resumoMes(d, 2026, 9, { ano: 2026, mes: 9, dia: 11 })
  assert.equal(r.atualIdeal, 30000) // 10 dias × 30,00
  assert.equal(r.excedenteHoje, 10000)
  assert.equal(r.diasParaLiberar, null)
  assert.equal(r.taDeBoa, 10000) // "" * x = 0 no Sheets, então sobra só o S9
})

test('ritmo: acima do ideal = dias para liberar (CEILING)', () => {
  const d = dados({ lancamentos: [lanc('2026-09-01', 36100)] })
  const r = resumoMes(d, 2026, 9, { ano: 2026, mes: 9, dia: 11 })
  assert.equal(r.excedenteHoje, -6100)
  assert.equal(r.diasParaLiberar, 3) // 61 / 30 = 2,03 -> 3
  assert.equal(r.diaLiberado, 14)
  assert.equal(r.taDeBoa, 3 * 3000 - 6100)
})

test('PARE! quando o gasto alcança o Restante', () => {
  const d = dados({ lancamentos: [lanc('2026-09-01', 90000)] })
  const r = resumoMes(d, 2026, 9, { ano: 2026, mes: 9, dia: 11 })
  assert.equal(r.diasParaLiberar, 'PARE!')
  assert.equal(r.diaLiberado, null)
  assert.equal(r.taDeBoa, 0)
})

test('dia atual: mês passado usa o mês inteiro, futuro usa 0', () => {
  const d = dados({})
  assert.equal(resumoMes(d, 2026, 8, { ano: 2026, mes: 9, dia: 5 }).diaAtual, 31)
  assert.equal(resumoMes(d, 2026, 10, { ano: 2026, mes: 9, dia: 5 }).diaAtual, 0)
  assert.equal(resumoMes(d, 2025, 12, { ano: 2026, mes: 1, dia: 5 }).diaAtual, 31)
})

test('caixa cobre o estouro antes do invest', () => {
  const caixa = [{ ano: 2026, mes: 9, valor_centavos: 50000 }]
  const hoje = { ano: 2026, mes: 9, dia: 5 }
  let r = resumoMes(dados({ caixa, lancamentos: [lanc('2026-09-01', 10000)] }), 2026, 9, hoje)
  assert.equal(r.caixaProj, 50000)
  assert.equal(r.investProj, 200000)
  r = resumoMes(dados({ caixa, lancamentos: [lanc('2026-09-01', 120000)] }), 2026, 9, hoje) // estourou 300
  assert.equal(r.caixaProj, 20000)
  assert.equal(r.investProj, 200000)
  r = resumoMes(dados({ caixa, lancamentos: [lanc('2026-09-01', 160000)] }), 2026, 9, hoje) // estourou 700
  assert.equal(r.caixaProj, 0)
  assert.equal(r.investProj, 200000 - 20000)
})

test('salário e fixos com vigência: mudar a partir de um mês não mexe no passado', () => {
  const d = dados({
    salarios: [
      { desde: '2026-04', valor_centavos: 400000 },
      { desde: '2026-10', valor_centavos: 450000 },
    ],
    fixos: [
      fixo('Aluguel', 110000, { valores: [{ desde: '2026-04', valor_centavos: 110000 }, { desde: '2026-10', valor_centavos: 120000 }] }),
      fixo('Academia', 10000, { inicio: '2026-06', fim: '2026-08', valores: [{ desde: '2026-06', valor_centavos: 10000 }] }),
    ],
  })
  const hoje = { ano: 2026, mes: 10, dia: 1 }
  assert.equal(resumoMes(d, 2026, 5, hoje).restante, 400000 - 110000)
  assert.equal(resumoMes(d, 2026, 7, hoje).restante, 400000 - 110000 - 10000)
  assert.equal(resumoMes(d, 2026, 9, hoje).restante, 400000 - 110000)
  assert.equal(resumoMes(d, 2026, 10, hoje).restante, 450000 - 120000)
  assert.equal(resumoMes(d, 2027, 3, hoje).restante, 450000 - 120000) // vale até a próxima mudança
  assert.equal(resumoMes(d, 2026, 3, hoje).salario, 0) // antes do primeiro registro
  assert.deepEqual(fixosDoMes(d, 2026, 8).map((f) => f.fixo.nome), ['Aluguel', 'Academia'])
})

test('QUITADO só com todos os fixos do mês pagos dentro dele', () => {
  const d = dados({})
  assert.equal(statusFixos(d, 2026, 9), 'QUITADO')
  assert.equal(statusFixos(d, 2026, 10), 'Pendente')
})

test('análises: crédito por categoria, sem categoria à parte e evolução sem buracos', () => {
  const d = dados({
    lancamentos: [
      lanc('2026-07-02', 1000, 'Crédito', 'Variável', 'Comida'),
      lanc('2026-07-03', 590, 'Crédito', 'Fixo', 'Lazer'),
      lanc('2026-09-03', 3000, 'Crédito', 'Variável', 'Lazer'),
      lanc('2026-09-04', 44992, 'Crédito', 'Variável', null),
      lanc('2026-09-05', 500, 'Débito', 'Variável', 'Comida'),
    ],
  })
  assert.deepEqual(ordemCategorias(d), ['Lazer', 'Comida'])
  const set = porCategoria(creditoDoPeriodo(d, { tipo: 'mes', ano: 2026, mes: 9 }, false))
  assert.deepEqual(set.fatias, [{ categoria: 'Lazer', valor: 3000 }])
  assert.equal(set.semCategoria, 44992)
  const jul = porCategoria(creditoDoPeriodo(d, { tipo: 'mes', ano: 2026, mes: 7 }, true))
  assert.deepEqual(jul.fatias, [{ categoria: 'Comida', valor: 1000 }])
  const evo = evolucaoMensal(creditoDoPeriodo(d, { tipo: 'tudo' }, false))
  assert.deepEqual(evo.map((m) => [m.chave, m.total]), [['2026-07', 1590], ['2026-08', 0], ['2026-09', 3000]])
})

test('parcelas: centavo que sobra vai na 1ª; demais no dia 1º', () => {
  assert.deepEqual(gerarParcelas('2026-11-30', 19900, 3), [
    { data: '2026-11-30', valor_centavos: 6634 },
    { data: '2026-12-01', valor_centavos: 6633 },
    { data: '2027-01-01', valor_centavos: 6633 },
  ])
  assert.deepEqual(gerarParcelas('2026-05-10', 1000, 1), [{ data: '2026-05-10', valor_centavos: 1000 }])
})

test('lerValor aceita formatos brasileiros e americanos', () => {
  assert.equal(lerValor('16,50'), 1650)
  assert.equal(lerValor('16.5'), 1650)
  assert.equal(lerValor('1.234,56'), 123456)
  assert.equal(lerValor('R$ 20'), 2000)
  assert.equal(lerValor('-5,9'), -590)
  assert.equal(lerValor('abc'), null)
  assert.equal(lerValor(''), null)
})
