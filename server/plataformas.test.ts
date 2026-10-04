// Migração para plataformas e rotas da API, num banco SQLite temporário.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { createClient } from '@libsql/client'
import { resumoMes } from '../src/lib/painel.ts'
import type { Dados } from '../src/lib/tipos.ts'
import { setClient } from './db.ts'
import { handle } from './rotas.ts'
import { migrar } from './schema.ts'

const pasta = mkdtempSync(join(tmpdir(), 'openfinance-'))
after(() => rmSync(pasta, { recursive: true, force: true }))
let n = 0
const bancoNovo = () => createClient({ url: `file:${join(pasta, `t${++n}.db`)}` })

// Como o banco era antes das plataformas (só as tabelas que mudaram).
const LEGADO = [
  `CREATE TABLE lancamentos (
    id INTEGER PRIMARY KEY, criado_em TEXT NOT NULL, data TEXT NOT NULL, produto TEXT NOT NULL DEFAULT '',
    local TEXT NOT NULL DEFAULT '', valor_centavos INTEGER NOT NULL, categoria TEXT,
    modalidade TEXT NOT NULL CHECK (modalidade IN ('Crédito', 'Débito')), tipo TEXT CHECK (tipo IN ('Variável', 'Fixo'))
  )`,
  'CREATE INDEX lancamentos_data ON lancamentos (data)',
  `CREATE TABLE split (
    id INTEGER PRIMARY KEY, criado_em TEXT NOT NULL, data TEXT NOT NULL, nome TEXT NOT NULL DEFAULT '',
    valor_centavos INTEGER NOT NULL, fixo TEXT CHECK (fixo IN ('Variável', 'Fixo'))
  )`,
  'CREATE INDEX split_data ON split (data)',
  `CREATE TABLE notificacoes (
    id INTEGER PRIMARY KEY, recebida_em TEXT NOT NULL, titulo TEXT, subtitulo TEXT, mensagem TEXT,
    status TEXT NOT NULL, motivo TEXT, split_id INTEGER
  )`,
]

async function dadosDaApi(): Promise<Dados> {
  const res = await handle(new Request('http://x/api/dados'))
  assert.equal(res.status, 200, await res.clone().text())
  return res.json()
}

async function chamar(metodo: string, caminho: string, corpo?: unknown) {
  const res = await handle(
    new Request(`http://x/api/${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? undefined : { 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
  )
  return { status: res.status, corpo: (await res.json()) as Record<string, unknown> }
}

process.env.OPENFINANCE_DEV = '1' // API aberta, sem senha
delete process.env.APP_PASSWORD

test('migração: banco antigo vira plataformas com os mesmos números do painel', async () => {
  const db = bancoNovo()
  await db.batch(LEGADO, 'write')
  const linhas: [string, number, string, string | null][] = [
    ['2026-08-30', 5000, 'Crédito', 'Variável'],
    ['2026-09-02', 10000, 'Crédito', 'Variável'],
    ['2026-09-03', 590, 'Crédito', 'Fixo'],
    ['2026-09-04', 250, 'Crédito', null],
    ['2026-09-05', -2000, 'Débito', 'Variável'],
    ['2026-09-06', 3000, 'Débito', 'Fixo'],
  ]
  for (const [data, v, m, t] of linhas) {
    await db.execute({
      sql: `INSERT INTO lancamentos (criado_em, data, produto, local, valor_centavos, categoria, modalidade, tipo) VALUES (?, ?, 'p', 'l', ?, 'Comida', ?, ?)`,
      args: [`${data} 10:00:00`, data, v, m, t],
    })
  }
  await db.batch(
    [
      `INSERT INTO split (criado_em, data, nome, valor_centavos, fixo) VALUES ('2026-09-02 10:00:00', '2026-09-02', 'Mercado', 1500, 'Variável')`,
      `INSERT INTO split (criado_em, data, nome, valor_centavos, fixo) VALUES ('2026-09-03 10:00:00', '2026-09-03', 'Net', 2400, 'Fixo')`,
      `INSERT INTO notificacoes (recebida_em, status, split_id) VALUES ('2026-09-03 10:00:00', 'split', 2)`,
      `INSERT INTO notificacoes (recebida_em, status, motivo) VALUES ('2026-09-04 10:00:00', 'revisar', 'x')`,
    ],
    'write',
  )

  assert.equal(await migrar(db), 'convertido')
  assert.equal(await migrar(db), 'em dia') // rodar de novo não faz nada

  setClient(db)
  const d = await dadosDaApi()
  assert.deepEqual(d.plataformas.map((p) => [p.nome, p.fechamento, p.no_painel, p.nas_analises, p.integracao]), [
    ['Crédito Nubank', 1, true, true, null],
    ['Débito', 1, true, false, null],
    ['Splitwise', 1, true, false, 'splitwise'],
  ])
  assert.equal(d.lancamentos.length, 8)
  const r = resumoMes(d, 2026, 9, { ano: 2026, mes: 9, dia: 10 })
  const t = (nome: string) => r.plataformas.find((p) => p.plataforma.nome === nome)!
  // Os números de antes: Fatura 10840, Crédito sem fixos 10250, Débito -2000, Split total 3900, Split sem fixos 1500.
  assert.deepEqual([t('Crédito Nubank').total, t('Crédito Nubank').semFixos], [10840, 10250])
  assert.equal(t('Débito').semFixos, -2000)
  assert.deepEqual([t('Splitwise').total, t('Splitwise').semFixos], [3900, 1500])
  assert.equal(r.gasto, 10250 - 2000 + 1500)

  // Splits ganham id depois do maior lançamento (6), e a notificação segue o seu.
  const net = d.lancamentos.find((l) => l.produto === 'Net')!
  assert.deepEqual([net.id, net.plataforma_id, net.tipo, net.local, net.categoria], [8, 3, 'Fixo', '', null])
  const notif = await db.execute('SELECT lancamento_id FROM notificacoes ORDER BY id')
  assert.deepEqual(notif.rows.map((x) => x.lancamento_id), [8, null])
  // Backup das tabelas antigas.
  const backup = await db.batch(['SELECT COUNT(*) AS n FROM lancamentos_antigo', 'SELECT COUNT(*) AS n FROM split_antigo'], 'read')
  assert.deepEqual(backup.map((b) => Number(b.rows[0].n)), [6, 2])
  db.close()
})

test('banco novo já nasce com as plataformas iniciais', async () => {
  const db = bancoNovo()
  assert.equal(await migrar(db), 'criado')
  assert.equal(await migrar(db), 'em dia')
  const rs = await db.execute('SELECT nome FROM plataformas ORDER BY ordem')
  assert.deepEqual(rs.rows.map((r) => r.nome), ['Crédito Nubank', 'Débito', 'Splitwise'])
  db.close()
})

test('API: atalhos antigos, plataformas e notificação do Splitwise', async () => {
  const db = bancoNovo()
  await migrar(db)
  setClient(db)

  // Atalho antigo com modalidade "credito" acha "Crédito Nubank".
  let r = await chamar('POST', 'lancamentos', { valor: 'R$ 16,50', produto: 'iFood', modalidade: 'credito', data: '2026-10-01' })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  assert.match(String(r.corpo.mensagem), /^Lançado: R\$\s16,50 · iFood \(Crédito Nubank\) · 01\/10\/2026$/)
  // Atalho antigo do split vira lançamento no Splitwise.
  r = await chamar('POST', 'split', { valor: '-68,44', nome: 'Jantar', data: '2026-10-01' })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  // Plataforma pelo nome, sem acento.
  r = await chamar('POST', 'lancamentos', { valor: 10, plataforma: 'debito', data: '2026-10-01' })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))

  // Nova plataforma; "credito" fica ambíguo.
  r = await chamar('POST', 'plataformas', { nome: 'Crédito Inter', fechamento: 5, nas_analises: true })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  r = await chamar('POST', 'plataformas', { nome: 'crédito inter' })
  assert.equal(r.status, 409)
  r = await chamar('POST', 'lancamentos', { valor: 1, modalidade: 'credito' })
  assert.equal(r.status, 400)
  assert.match(String(r.corpo.erro), /ambígua/)
  r = await chamar('POST', 'lancamentos', { valor: 1, plataforma: 'Banco X' })
  assert.equal(r.status, 400)
  r = await chamar('POST', 'lancamentos', { valor: 1, plataforma_id: 99 })
  assert.equal(r.status, 400)
  r = await chamar('POST', 'plataformas', { nome: 'Outro', fechamento: 29 })
  assert.equal(r.status, 400)

  let d = await dadosDaApi()
  const inter = d.plataformas.find((p) => p.nome === 'Crédito Inter')!
  assert.deepEqual([inter.fechamento, inter.nas_analises, inter.no_painel, inter.ativa, inter.ordem], [5, true, true, true, 4])
  assert.deepEqual(
    d.lancamentos.map((l) => [l.produto, l.valor_centavos, l.plataforma_id, l.tipo]),
    [['iFood', 1650, 1, 'Variável'], ['Jantar', -6844, 3, 'Variável'], ['', 1000, 2, 'Variável']],
  )

  // Ordem, edição e exclusão.
  r = await chamar('PUT', 'plataformas/ordem', [inter.id, 1, 2, 3])
  assert.equal(r.status, 200)
  r = await chamar('PUT', `plataformas/${inter.id}`, { no_painel: false, fechamento: 10 })
  assert.equal(r.status, 200)
  r = await chamar('DELETE', 'plataformas/1')
  assert.equal(r.status, 409) // tem lançamento
  d = await dadosDaApi()
  assert.deepEqual(d.plataformas.map((p) => p.nome), ['Crédito Inter', 'Crédito Nubank', 'Débito', 'Splitwise'])
  assert.deepEqual([d.plataformas[0].no_painel, d.plataformas[0].fechamento], [false, 10])
  r = await chamar('DELETE', `plataformas/${inter.id}`)
  assert.equal(r.status, 200)

  // Notificação do Splitwise vira lançamento na plataforma com integração.
  r = await chamar('POST', 'split/notificacao', { titulo: 'Pizza (BRL 40,00)', subtitulo: '', mensagem: 'Você deve BRL 20,00' })
  assert.equal(r.status, 201, JSON.stringify(r.corpo))
  d = await dadosDaApi()
  const pizza = d.lancamentos.find((l) => l.produto === 'Pizza')!
  assert.deepEqual([pizza.valor_centavos, pizza.plataforma_id], [2000, 3])
  const notif = await db.execute('SELECT status, lancamento_id FROM notificacoes')
  assert.deepEqual(notif.rows.map((x) => [x.status, x.lancamento_id]), [['split', pizza.id]])
  db.close()
})
