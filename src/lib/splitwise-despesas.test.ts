import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conferirSaldo, lerDespesa, parearDespesas, type DespesaSplitwise } from './splitwise-despesas.ts'

const EU = 1
const ZE = 2
const despesa = (o: Partial<DespesaSplitwise>): DespesaSplitwise => ({
  id: 10,
  descricao: 'Piza',
  pagamento: false,
  custo: '65.0',
  moeda: 'BRL',
  data: '2026-10-09T22:00:00Z',
  criada: '2026-10-09T22:05:51Z',
  atualizada: '2026-10-09T22:05:51Z',
  apagada: null,
  usuarios: [EU, ZE],
  saldos: ['-16.25', '16.25'],
  ...o,
})

test('"você deve" vira split positivo, com data da despesa e criado_em de quando foi criada (horário de SP)', () => {
  assert.deepEqual(lerDespesa(despesa({}), EU), {
    acao: 'lancar', data: '2026-10-09', criado_em: '2026-10-09 19:05:51', nome: 'Piza', valor_centavos: 1625, tipo: 'Variável',
  })
})

test('despesa que eu paguei ("recebeu de volta") vira split negativo', () => {
  const r = lerDespesa(despesa({ descricao: 'pizza', saldos: ['42.0', '-42.0'] }), EU)
  assert.equal(r.acao, 'lancar')
  assert.equal(r.valor_centavos, -4200)
})

test('data em UTC de madrugada cai no dia anterior em São Paulo', () => {
  assert.equal(lerDespesa(despesa({ data: '2026-10-01T01:30:00Z' }), EU).data, '2026-09-30')
})

test('Net/Claro/Sol entram como Fixo, pelo nome inteiro (mesma regra da notificação)', () => {
  assert.equal((lerDespesa(despesa({ descricao: 'Sol ' }), EU) as { tipo: string }).tipo, 'Fixo')
  assert.equal((lerDespesa(despesa({ descricao: 'Sol dnv' }), EU) as { tipo: string }).tipo, 'Variável')
})

test('pagamento, despesa sem mim, parte zero e apagada são ignorados; outra moeda vai para revisar', () => {
  assert.equal(lerDespesa(despesa({ pagamento: true }), EU).acao, 'ignorar')
  assert.equal(lerDespesa(despesa({ usuarios: [ZE, 3] }), EU).acao, 'ignorar')
  assert.equal(lerDespesa(despesa({ saldos: ['0.0', '0.0'] }), EU).acao, 'ignorar')
  assert.equal(lerDespesa(despesa({ apagada: '2026-10-10T00:00:00Z' }), EU).acao, 'ignorar')
  assert.equal(lerDespesa(despesa({ moeda: 'USD' }), EU).acao, 'revisar')
})

test('pareamento: mesmo valor, mesmo dia antes de dias vizinhos, cada lançamento uma vez só', () => {
  const lancs = [
    { id: 1, data: '2026-10-10', valor_centavos: 300 },
    { id: 2, data: '2026-10-09', valor_centavos: 300 },
    { id: 3, data: '2026-10-01', valor_centavos: 500 },
  ]
  const pares = parearDespesas(
    [
      { data: '2026-10-10', valor_centavos: 300 },
      { data: '2026-10-10', valor_centavos: 300 },
      { data: '2026-10-10', valor_centavos: 300 },
      { data: '2026-10-05', valor_centavos: 500 },
    ],
    lancs,
  )
  assert.deepEqual(pares.map((p) => p?.id ?? null), [1, 2, null, null]) // o de 500 está a 4 dias: não liga
})

test('saldo: bate quando antes + pagamentos − splits do banco = saldo do Splitwise', () => {
  const despesas = [
    despesa({ id: 1, criada: '2026-03-20T12:00:00Z', saldos: ['-10.0', '10.0'] }), // antes: devo 10
    // criada depois do início com data de antes: conta como nova (o que vale é a criação)
    despesa({ id: 2, data: '2026-03-30T12:00:00Z', criada: '2026-04-05T12:00:00Z', saldos: ['-30.0', '30.0'] }),
    despesa({ id: 3, criada: '2026-04-06T12:00:00Z', pagamento: true, saldos: ['40.0', '-40.0'] }), // paguei 40
  ]
  const c = conferirSaldo({ despesas, eu: EU, inicio: '2026-04-01', saldoSplitwise: 0, splitsNoBanco: 3000 })
  assert.deepEqual(c, { saldoSplitwise: 0, saldoAntes: -1000, pagamentos: 4000, splitsNoBanco: 3000, esperado: 0, diferenca: 0 })
  assert.equal(conferirSaldo({ despesas, eu: EU, inicio: '2026-04-01', saldoSplitwise: 0, splitsNoBanco: 0 }).diferenca, -3000)
})
