import { createClient, type Client } from '@libsql/client/web'

// Em produção (Netlify) usamos o cliente HTTP do libSQL, que não depende de binário nativo.
// No dev local o plugin do Vite injeta um cliente Node via setClient() para poder usar file:local.db.
let client: Client | null = null

export function setClient(c: Client) {
  client = c
}

export function hasClient() {
  return client !== null
}

export function db(): Client {
  if (client) return client
  const url = process.env.TURSO_DATABASE_URL
  if (!url) throw new Error('TURSO_DATABASE_URL não configurada')
  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  return client
}
