// Copia o banco local (local.db) para o banco apontado por TURSO_DATABASE_URL.
//
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:copiar
//   ... npm run db:copiar -- outro.db           -> copia de outro arquivo
//   ... npm run db:copiar -- --substituir       -> apaga o que já existe no destino antes
import { createClient, type InStatement } from '@libsql/client'
import { cliente, migrar } from './cliente.ts'

const TABELAS = ['lancamentos', 'split', 'salarios', 'fixos', 'fixos_valores', 'fixos_pagamentos', 'caixa_mensal']

const args = process.argv.slice(2)
const substituir = args.includes('--substituir')
const arquivo = args.find((a) => !a.startsWith('--')) ?? 'local.db'

if (!process.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL === `file:${arquivo}`) {
  console.error('Defina TURSO_DATABASE_URL (e TURSO_AUTH_TOKEN) apontando para o banco de destino.')
  process.exit(1)
}

const origem = createClient({ url: `file:${arquivo}` })
const destino = cliente()
await migrar(destino)

if (!substituir) {
  const rs = await destino.batch(TABELAS.map((t) => `SELECT COUNT(*) AS n FROM ${t}`), 'read')
  const ocupadas = TABELAS.filter((_, i) => Number(rs[i].rows[0].n) > 0)
  if (ocupadas.length) {
    console.error(`O destino já tem dados em: ${ocupadas.join(', ')}.`)
    console.error('Rode com --substituir para apagar e copiar de novo.')
    process.exit(1)
  }
}

const stmts: InStatement[] = substituir ? TABELAS.map((t) => `DELETE FROM ${t}`) : []
const contagem: Record<string, number> = {}
for (const tabela of TABELAS) {
  const rs = await origem.execute(`SELECT * FROM ${tabela}`)
  const cols = rs.columns
  for (const row of rs.rows) {
    stmts.push({
      sql: `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      args: cols.map((c) => row[c]),
    })
  }
  contagem[tabela] = rs.rows.length
}

// Tudo numa transação só: ou copia tudo, ou nada.
await destino.batch(stmts, 'write')
console.log('Copiado:', contagem)
origem.close()
destino.close()
