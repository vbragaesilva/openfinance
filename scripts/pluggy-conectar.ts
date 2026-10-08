// Cria conexões do Meu Pluggy na aplicação do openmoney e grava os Item IDs no .env, sem passar
// pelo dashboard da Pluggy. Abre uma página em localhost com o widget oficial (Pluggy Connect)
// restrito ao conector MeuPluggy (id 200); o Client Secret nunca sai deste processo.
//
//   npm run pluggy:conectar      -> abre http://localhost:4848 no navegador; conecte um banco por vez
//
// Precisa no .env: PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET (aba "Credenciais" da aplicação no dashboard).
import fs from 'node:fs'
import http from 'node:http'
import { execFile } from 'node:child_process'

const BASE = 'https://api.pluggy.ai'
const MEU_PLUGGY = 200
const PORTA = 4848
const { PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET } = process.env
if (!PLUGGY_CLIENT_ID || !PLUGGY_CLIENT_SECRET) {
  console.error('Defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no .env (aba "Credenciais" da aplicação openmoney).')
  process.exit(1)
}

async function pluggy(caminho: string, corpo: unknown, apiKey?: string) {
  const res = await fetch(BASE + caminho, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { 'X-API-KEY': apiKey } : {}) },
    body: JSON.stringify(corpo),
  })
  const texto = await res.text()
  if (!res.ok) throw new Error(`POST ${caminho} -> ${res.status}: ${texto.slice(0, 300)}`)
  return JSON.parse(texto)
}

/** Acrescenta o Item ID em PLUGGY_ITEM_IDS no .env (sem repetir). */
function gravarItem(id: string) {
  const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : ''
  const linha = env.match(/^PLUGGY_ITEM_IDS=(.*)$/m)
  const ids = new Set((linha?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  ids.add(id)
  const nova = `PLUGGY_ITEM_IDS=${[...ids].join(',')}`
  fs.writeFileSync('.env', linha ? env.replace(/^PLUGGY_ITEM_IDS=.*$/m, nova) : `${env.replace(/\n?$/, '\n')}${nova}\n`)
  return [...ids]
}

const PAGINA = `<!doctype html><meta charset="utf-8"><title>Conectar Meu Pluggy</title>
<style>body{font:16px system-ui;max-width:560px;margin:60px auto;padding:0 16px}button{font:inherit;padding:10px 16px;border-radius:10px;border:0;background:#2a78d6;color:#fff;cursor:pointer}pre{background:#f2f1ed;padding:12px;border-radius:8px;white-space:pre-wrap}</style>
<h1>Conectar Meu Pluggy</h1>
<p>Clique, entre com a sua conta do Meu Pluggy e escolha um banco. Repita para cada banco.</p>
<button id="b">Conectar um banco</button>
<pre id="s">Pronto.</pre>
<script src="https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js"></script>
<script>
const s = document.getElementById('s')
document.getElementById('b').onclick = async () => {
  s.textContent = 'Gerando token...'
  const { accessToken, erro } = await fetch('/token').then((r) => r.json())
  if (!accessToken) { s.textContent = 'Erro: ' + erro; return }
  new PluggyConnect({
    connectToken: accessToken,
    includeSandbox: false,
    connectorIds: [${MEU_PLUGGY}],
    onSuccess: async (dados) => {
      const r = await fetch('/item', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) }).then((r) => r.json())
      s.textContent = r.erro ? 'Erro: ' + r.erro : 'Conectado! Item ' + r.id + '\\nIDs no .env: ' + r.ids.join(', ')
    },
    onError: (e) => { s.textContent = 'Erro do widget: ' + JSON.stringify(e) },
  }).init()
}
</script>`

http
  .createServer(async (req, res) => {
    const json = (o: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(o))
    }
    try {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end(PAGINA)
      }
      if (req.url === '/token') {
        const { apiKey } = await pluggy('/auth', { clientId: PLUGGY_CLIENT_ID, clientSecret: PLUGGY_CLIENT_SECRET })
        const { accessToken } = await pluggy('/connect_token', {}, apiKey)
        return json({ accessToken })
      }
      if (req.url === '/item' && req.method === 'POST') {
        let corpo = ''
        for await (const parte of req) corpo += parte
        const dados = JSON.parse(corpo)
        console.log('onSuccess recebeu:', JSON.stringify(dados).slice(0, 500))
        const id: string | undefined = dados?.item?.id ?? dados?.id
        if (!id) return json({ erro: 'não achei o id do item na resposta do widget (veja o terminal)' }, 400)
        const ids = gravarItem(id)
        console.log(`Item ${id} gravado no .env. PLUGGY_ITEM_IDS=${ids.join(',')}`)
        return json({ id, ids })
      }
      json({ erro: 'não encontrado' }, 404)
    } catch (e) {
      console.error(e)
      json({ erro: String(e) }, 500)
    }
  })
  .listen(PORTA, '127.0.0.1', () => {
    const url = `http://localhost:${PORTA}`
    console.log(`Abra ${url} (Ctrl+C para encerrar quando terminar).`)
    execFile('open', [url])
  })
