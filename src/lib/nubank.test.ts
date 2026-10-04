import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lerNotificacaoNubank } from './nubank.ts'

const credito = (mensagem: string) => lerNotificacaoNubank({ titulo: 'Compra no crédito aprovada', subtitulo: '', mensagem })

test('compra no crédito aprovada (formato real) vira lançamento', () => {
  assert.deepEqual(credito('Compra de R$ 6,89 APROVADA em APPLE.COM/BILL para o cartão com final 9589.'), {
    tipo: 'credito', valor_centavos: 689, local: 'APPLE.COM/BILL', cartao: '9589', fixo: 'Variável',
  })
})

test('valores com milhar e estabelecimento com espaços', () => {
  const r = credito('Compra de R$ 1.234,56 APROVADA em MERCADO LIVRE*LOJA para o cartão com final 9589.')
  assert.equal(r.tipo, 'credito')
  if (r.tipo === 'credito') {
    assert.equal(r.valor_centavos, 123456)
    assert.equal(r.local, 'MERCADO LIVRE*LOJA')
  }
})

test('Apple só é Fixo quando for exatamente R$ 5,90', () => {
  const icloud = credito('Compra de R$ 5,90 APROVADA em APPLE.COM/BILL para o cartão com final 9589.')
  const jogo = credito('Compra de R$ 5,91 APROVADA em APPLE.COM/BILL para o cartão com final 9589.')
  const outro = credito('Compra de R$ 5,90 APROVADA em IFOOD para o cartão com final 9589.')
  assert.equal(icloud.tipo === 'credito' && icloud.fixo, 'Fixo')
  assert.equal(jogo.tipo === 'credito' && jogo.fixo, 'Variável')
  assert.equal(outro.tipo === 'credito' && outro.fixo, 'Variável')
})

test('fatura fechada e promoção não viram lançamento', () => {
  assert.deepEqual(
    lerNotificacaoNubank({ titulo: 'Nubank', mensagem: 'Sua fatura com vencimento em 09/10 fechou. Faça o pagamento...' }),
    { tipo: 'capturada' },
  )
  assert.deepEqual(
    lerNotificacaoNubank({ titulo: 'O Nu te dá R$20 OFF no 10.10 Shopee', mensagem: 'Resgate agora no app do Nu...' }),
    { tipo: 'capturada' },
  )
})

test('título de crédito com mensagem estranha fica para revisar', () => {
  assert.equal(credito('Algo totalmente diferente').tipo, 'revisar')
})
