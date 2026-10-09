import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acharExistente, chaveCompra, classificar, type PluggyConta, type PluggyTransacao } from './pluggy.ts'

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

test('acharExistente: mesmo valor, até 3 dias, o mais próximo; parcela pelo mês', () => {
  const lancs = [
    { id: 1, data: '2026-10-05', valor_centavos: 300 },
    { id: 2, data: '2026-10-06', valor_centavos: 300 },
    { id: 3, data: '2026-11-01', valor_centavos: 4650 },
  ]
  const avista = (data: string, v: number) => ({ acao: 'lancar' as const, data, local: '', valor_centavos: v, tipo: 'Variável' as const, parcela: null })
  assert.equal(acharExistente(avista('2026-10-06', 300), lancs)?.id, 2)
  assert.equal(acharExistente(avista('2026-10-10', 300), lancs), null)
  assert.equal(acharExistente(avista('2026-10-06', 301), lancs), null)
  assert.equal(acharExistente({ ...avista('2026-11-01', 4650), parcela: { n: 5, total: 6 } }, lancs)?.id, 3)
})

test('chaveCompra é a mesma quando só o id e o status mudam', () => {
  const a = t({ id: 'a', status: 'PENDING' })
  const b = t({ id: 'b', status: 'POSTED' })
  assert.equal(chaveCompra(a), chaveCompra(b))
  assert.notEqual(chaveCompra(a), chaveCompra(t({ amount: 4 })))
})
