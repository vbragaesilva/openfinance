import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chaveCompra, classificar, parear, type PluggyConta, type PluggyTransacao } from './pluggy.ts'

const cartao: PluggyConta = { id: 'c1', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'gold' }
const corrente: PluggyConta = { id: 'b1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Nu Pagamentos S.A.' }
const t = (x: Partial<PluggyTransacao>): PluggyTransacao => ({
  id: 'x', accountId: 'c1', date: '2026-10-07T12:41:45.001Z', description: 'Loja', amount: 3, type: 'DEBIT', ...x,
})

test('compra à vista no cartão vira lançamento na data de São Paulo', () => {
  // 01:40 UTC = 22:40 do dia anterior em São Paulo
  assert.deepEqual(classificar(cartao, t({ date: '2026-10-03T01:40:47.221Z', description: 'José Antônio', amount: 42.84 }), 1), {
    acao: 'lancar', data: '2026-10-02', local: 'José Antônio', valor_centavos: 4284, tipo: 'Variável', parcela: null,
  })
})

test('compra internacional entra pelo valor em reais, não em dólar', () => {
  const c = classificar(cartao, t({ description: 'Anthropic* Claude Sub', amount: 107.35, amountInAccountCurrency: 570.69, currencyCode: 'USD' }), 1)
  assert.equal(c.acao === 'lancar' && c.valor_centavos, 57069)
})

test('iCloud (R$ 5,90 na apple.com) é Fixo', () => {
  const c = classificar(cartao, t({ description: 'Apple.Com/Bill', amount: 5.9 }), 1)
  assert.equal(c.acao === 'lancar' && c.tipo, 'Fixo')
})

test('parcela seguinte cai no dia de fechamento do mês dela, sem o sufixo n/m', () => {
  const c = classificar(cartao, t({
    date: '2026-11-05T03:00:00.000Z', description: 'Amazonmktplc*Mtechcome 5/6', amount: 46.5,
    creditCardMetadata: { purchaseDate: '2026-07-05T17:31:12.001Z', installmentNumber: 5, totalInstallments: 6 },
  }), 1)
  assert.deepEqual(c, { acao: 'lancar', data: '2026-11-01', local: 'Amazonmktplc*Mtechcome', valor_centavos: 4650, tipo: 'Variável', parcela: { n: 5, total: 6 } })
})

test('1ª parcela fica na data da compra', () => {
  const c = classificar(cartao, t({
    date: '2026-08-05T03:00:00.000Z', description: 'Loja 1/3', amount: 10,
    creditCardMetadata: { purchaseDate: '2026-07-05T17:31:12.001Z', installmentNumber: 1, totalInstallments: 3 },
  }), 6)
  assert.equal(c.acao === 'lancar' && c.data, '2026-07-05')
})

test('pagamento de fatura, conta corrente e IOF não são lançados', () => {
  assert.equal(classificar(cartao, t({ description: 'Pagamento recebido', amount: -2707.27, type: 'CREDIT' }), 1).acao, 'ignorar')
  assert.equal(classificar(cartao, t({ description: 'Estorno de compra', amount: -21.5, type: 'CREDIT' }), 1).acao, 'revisar')
  assert.equal(classificar(cartao, t({ description: 'IOF gerado por compra em moeda estrangeira', amount: 19.97 }), 1).acao, 'revisar')
  assert.equal(classificar(corrente, t({ accountId: 'b1', amount: -37 }), 1).acao, 'ignorar')
})

const avista = (data: string, v = 300) => ({ acao: 'lancar' as const, data, local: '', valor_centavos: v, tipo: 'Variável' as const, parcela: null })
const ids = (r: ({ id: number } | null)[]) => r.map((l) => l?.id ?? null)

test('parear: café toda manhã, cada um com o seu dia', () => {
  const lancs = [
    { id: 1, data: '2026-10-05', valor_centavos: 300 },
    { id: 2, data: '2026-10-06', valor_centavos: 300 },
    { id: 3, data: '2026-10-07', valor_centavos: 300 },
  ]
  assert.deepEqual(ids(parear([avista('2026-10-05'), avista('2026-10-06'), avista('2026-10-07')], lancs)), [1, 2, 3])
})

test('parear: café de ontem não lançado não pega o lançamento de hoje', () => {
  // Só o de hoje (06) foi lançado à mão: o de ontem (05) fica sem par e vira lançamento novo.
  const lancs = [{ id: 2, data: '2026-10-06', valor_centavos: 300 }]
  assert.deepEqual(ids(parear([avista('2026-10-05'), avista('2026-10-06')], lancs)), [null, 2])
  // Mesmo se só o de ontem vier nesta rodada.
  assert.deepEqual(ids(parear([avista('2026-10-05')], lancs)), [null])
})

test('parear: dois cafés no mesmo dia e só um lançado', () => {
  const lancs = [{ id: 1, data: '2026-10-06', valor_centavos: 300 }]
  assert.deepEqual(ids(parear([avista('2026-10-06'), avista('2026-10-06')], lancs)), [1, null])
})

test('parear: compra depois da meia-noite lançada com a data da noite', () => {
  const lancs = [{ id: 1, data: '2026-10-02', valor_centavos: 689 }]
  assert.deepEqual(ids(parear([avista('2026-10-03', 689)], lancs)), [1])
  // ...mas não o contrário, nem 2 dias, nem outro valor.
  assert.deepEqual(ids(parear([avista('2026-10-01', 689)], lancs)), [null])
  assert.deepEqual(ids(parear([avista('2026-10-04', 689)], lancs)), [null])
  assert.deepEqual(ids(parear([avista('2026-10-02', 690)], lancs)), [null])
})

test('parear: o mesmo dia tem prioridade sobre o dia anterior', () => {
  // A compra do dia 07 poderia pegar o lançamento do 06, mas ele é do café do 06.
  const lancs = [
    { id: 1, data: '2026-10-06', valor_centavos: 300 },
    { id: 2, data: '2026-10-07', valor_centavos: 300 },
  ]
  assert.deepEqual(ids(parear([avista('2026-10-07'), avista('2026-10-06')], lancs)), [2, 1])
})

test('parear: parcela seguinte pelo mês', () => {
  const lancs = [{ id: 3, data: '2026-11-01', valor_centavos: 4650 }]
  assert.deepEqual(ids(parear([{ ...avista('2026-11-01', 4650), parcela: { n: 5, total: 6 } }], lancs)), [3])
})

test('chaveCompra é a mesma quando só o id e o status mudam', () => {
  const a = t({ id: 'a', status: 'PENDING' })
  const b = t({ id: 'b', status: 'POSTED' })
  assert.equal(chaveCompra(a), chaveCompra(b))
  assert.notEqual(chaveCompra(a), chaveCompra(t({ amount: 4 })))
  // Dois cafés de R$ 3 no mesmo dia são compras diferentes.
  assert.notEqual(chaveCompra(a), chaveCompra(t({ date: '2026-10-07T20:00:00.001Z' })))
})
