import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lerNotificacao } from './splitwise.ts'

test('"Você deve" vira split positivo', () => {
  assert.deepEqual(lerNotificacao({ titulo: 'Zé adicionou “pizza”', mensagem: 'Você deve BRL 16,25' }), {
    tipo: 'split', valor_centavos: 1625, nome: 'pizza',
  })
})

test('"Você recebeu de volta" vira split negativo', () => {
  assert.deepEqual(lerNotificacao({ titulo: 'Mercado', mensagem: 'Você recebeu de volta BRL 1.234,56' }), {
    tipo: 'split', valor_centavos: -123456, nome: 'Mercado',
  })
})

test('sem aspas e com título "Splitwise", o nome sai do texto', () => {
  const r = lerNotificacao({ titulo: 'Splitwise', mensagem: 'Zé adicionou janta. Você deve BRL 20,00' })
  assert.deepEqual(r, { tipo: 'split', valor_centavos: 2000, nome: 'Zé adicionou janta' })
})

test('acerto de contas e outras notificações não viram split', () => {
  assert.equal(lerNotificacao({ titulo: 'Splitwise', mensagem: 'Zé pagou você BRL 50,00' }).tipo, 'ignorada')
  assert.equal(lerNotificacao({}).tipo, 'ignorada')
})

test('edição/exclusão fica para revisar, sem criar split', () => {
  const r = lerNotificacao({ titulo: 'Zé atualizou “pizza”', mensagem: 'Você deve BRL 18,00' })
  assert.equal(r.tipo, 'revisar')
  assert.equal(r.valor_centavos, 1800)
})
