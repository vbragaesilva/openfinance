import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lerNotificacao } from './splitwise.ts'

test('notificação real do Splitwise: nome vem do título, sem o "(BRL ...)"', () => {
  assert.deepEqual(
    lerNotificacao({
      titulo: 'Ah crlh… (BRL 0,01)',
      subtitulo: 'Adicionado por José M. em “Maiu”',
      mensagem: 'Você deve BRL 0,01. Veja seu saldo total →',
    }),
    { tipo: 'split', valor_centavos: 1, nome: 'Ah crlh…' },
  )
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
  const r = lerNotificacao({ titulo: 'pizza (BRL 18,00)', subtitulo: 'Zé atualizou em “Apê”', mensagem: 'Você deve BRL 18,00' })
  assert.equal(r.tipo, 'revisar')
  assert.equal(r.valor_centavos, 1800)
})
