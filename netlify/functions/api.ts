import type { Config, Context } from '@netlify/functions'
import { handle } from '../../server/rotas.ts'

export default (req: Request, context: Context) => handle(req, { waitUntil: (p) => context.waitUntil(p) })

export const config: Config = {
  path: '/api/*',
}
