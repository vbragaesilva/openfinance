import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agrupar, chave, formaCanonica, padronizarDigitado, parecidos } from './padronizar.ts'

test('chave ignora maiúsculas, acentos, espaços e pontuação', () => {
  assert.equal(chave('Center Vale'), chave('CenterVale'))
  assert.equal(chave('Café'), chave('cafe'))
  assert.equal(chave(' VILA '), 'vila')
  assert.equal(chave('MC donalds'), chave('McDonalds'))
})

test('forma canônica: mais usada, com acento quando houver, capitalizada', () => {
  assert.equal(formaCanonica([['cantina', 20], ['Cantina', 9]], 'local'), 'Cantina')
  assert.equal(formaCanonica([['center vale', 8], ['Center Vale', 2], ['CenterVale', 1]], 'local'), 'Center Vale')
  assert.equal(formaCanonica([['casa de bolo', 3]], 'local'), 'Casa de Bolo')
  assert.equal(formaCanonica([['AAAITA', 3], ['aaaita', 3]], 'local'), 'AAAITA')
  assert.equal(formaCanonica([['cafe', 10], ['Café', 2]], 'produto'), 'Café')
  assert.equal(formaCanonica([['cafe com leite', 4]], 'produto'), 'Cafe com leite')
})

test('parecidos sugere erro de digitação, nunca nomes curtos ou contidos', () => {
  assert.equal(parecidos('Villa', 'Vila'), true)
  assert.equal(parecidos('Mosca', 'Moska'), true)
  assert.equal(parecidos('Vila', 'Vilarreal'), false)
  assert.equal(parecidos('99', '98'), false)
})

test('digitado: mesma chave troca pela canônica; parecido só sugere', () => {
  const grupos = agrupar(new Map([['vila', 7], ['Vila', 3], ['Moska', 5]]), 'local')
  assert.deepEqual(padronizarDigitado('VILA', grupos), { valor: 'Vila', sugestao: null })
  assert.deepEqual(padronizarDigitado('Villa', grupos), { valor: 'Villa', sugestao: 'Vila' })
  assert.deepEqual(padronizarDigitado('Mosca', grupos), { valor: 'Mosca', sugestao: 'Moska' })
  assert.deepEqual(padronizarDigitado('Padaria Nova', grupos), { valor: 'Padaria Nova', sugestao: null })
})
