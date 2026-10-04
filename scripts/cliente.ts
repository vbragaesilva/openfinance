import { createClient } from '@libsql/client'
export { migrar } from '../server/schema.ts'

export function cliente() {
  const url = process.env.TURSO_DATABASE_URL || 'file:local.db'
  console.log(`Banco: ${url.startsWith('file:') ? url : url.replace(/\/\/.*@/, '//')}`)
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
}
