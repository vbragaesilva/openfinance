import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage } from 'node:http'

// No dev, serve /api/* com o mesmo handler da Netlify Function, usando file:local.db
// (ou o Turso, se TURSO_DATABASE_URL estiver no .env). Assim `npm run dev` basta.
function apiDev(): Plugin {
  let server: ViteDevServer
  return {
    name: 'openfinance-api-dev',
    configureServer(s) {
      server = s
      process.env.OPENFINANCE_DEV = '1'
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const dbMod = await server.ssrLoadModule('/server/db.ts')
          if (!dbMod.hasClient()) {
            const { createClient } = await import('@libsql/client')
            dbMod.setClient(
              createClient({
                url: process.env.TURSO_DATABASE_URL || 'file:local.db',
                authToken: process.env.TURSO_AUTH_TOKEN,
              }),
            )
          }
          const { handle } = await server.ssrLoadModule('/server/rotas.ts')
          const resposta: Response = await handle(await paraRequest(req))
          res.statusCode = resposta.status
          resposta.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await resposta.arrayBuffer()))
        } catch (e) {
          next(e)
        }
      })
    },
  }
}

async function paraRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const temCorpo = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers,
    body: temCorpo ? Buffer.concat(chunks) : undefined,
  })
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), apiDev()],
  }
})
