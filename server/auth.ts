// Login por senha única (APP_PASSWORD). A sessão é um cookie HttpOnly assinado com HMAC.

const COOKIE = 'of_sessao'
const DURACAO_S = 60 * 60 * 24 * 90

const enc = new TextEncoder()

function b64url(buf: ArrayBuffer) {
  return Buffer.from(buf).toString('base64url')
}

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}

function iguais(a: string, b: string) {
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  let diff = ba.length ^ bb.length
  for (let i = 0; i < Math.max(ba.length, bb.length); i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

type Modo = { tipo: 'aberto' } | { tipo: 'senha'; senha: string; segredo: string } | { tipo: 'mal-configurado' }

export function modoAuth(): Modo {
  const senha = process.env.APP_PASSWORD
  const segredo = process.env.SESSION_SECRET
  if (senha && segredo) return { tipo: 'senha', senha, segredo }
  // Sem senha só é permitido no dev local (o plugin do Vite define OPENFINANCE_DEV).
  if (!senha && process.env.OPENFINANCE_DEV === '1') return { tipo: 'aberto' }
  return { tipo: 'mal-configurado' }
}

function lerCookie(req: Request, nome: string) {
  const header = req.headers.get('cookie') ?? ''
  for (const parte of header.split(';')) {
    const [k, ...v] = parte.trim().split('=')
    if (k === nome) return v.join('=')
  }
  return null
}

/** `Authorization: Bearer <API_TOKEN>` — usado pelos Atalhos do iPhone, que não guardam o cookie de login. */
export function tokenApiValido(req: Request) {
  const esperado = process.env.API_TOKEN
  const header = req.headers.get('authorization') ?? ''
  if (!esperado || !header.startsWith('Bearer ')) return false
  return iguais(header.slice('Bearer '.length).trim(), esperado)
}

export async function sessaoValida(req: Request): Promise<boolean> {
  const modo = modoAuth()
  if (modo.tipo === 'aberto') return true
  if (modo.tipo !== 'senha') return false
  if (tokenApiValido(req)) return true
  const token = lerCookie(req, COOKIE)
  if (!token) return false
  const [exp, assinatura] = token.split('.')
  if (!exp || !assinatura || Number(exp) < Date.now() / 1000) return false
  return iguais(assinatura, await hmac(modo.segredo, exp))
}

export async function login(senhaDigitada: string, seguro: boolean): Promise<string | null> {
  const modo = modoAuth()
  if (modo.tipo !== 'senha' || !iguais(senhaDigitada, modo.senha)) return null
  const exp = String(Math.floor(Date.now() / 1000) + DURACAO_S)
  const token = `${exp}.${await hmac(modo.segredo, exp)}`
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACAO_S}${seguro ? '; Secure' : ''}`
}

export function cookieLogout(seguro: boolean) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro ? '; Secure' : ''}`
}
