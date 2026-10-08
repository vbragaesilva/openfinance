// Só lê o que o Meu Pluggy tem (contas, transações, investimentos) para conhecermos o formato.
// Não grava nada no banco. Salva a resposta crua em backups/ (fora do git: são dados pessoais).
//
//   npm run pluggy:explorar            -> últimos 30 dias de transações
//   npm run pluggy:explorar -- 90      -> últimos 90 dias
//
// Precisa no .env: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_ITEM_IDS (ids separados por vírgula,
// um por conexão do conector "MeuPluggy" no dashboard.pluggy.ai).
import fs from 'node:fs'

const BASE = 'https://api.pluggy.ai'
const { PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEM_IDS } = process.env
if (!PLUGGY_CLIENT_ID || !PLUGGY_CLIENT_SECRET || !PLUGGY_ITEM_IDS) {
  console.error('Defina PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_ITEM_IDS no .env.')
  process.exit(1)
}
const dias = Number(process.argv[2]) || 30
const de = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10)

async function chamar(caminho: string, init: RequestInit = {}, apiKey?: string): Promise<any> {
  const res = await fetch(BASE + caminho, {
    ...init,
    headers: { 'content-type': 'application/json', ...(apiKey ? { 'X-API-KEY': apiKey } : {}), ...init.headers },
  })
  const texto = await res.text()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${caminho} -> ${res.status}: ${texto.slice(0, 300)}`)
  return JSON.parse(texto)
}

const { apiKey } = await chamar('/auth', { method: 'POST', body: JSON.stringify({ clientId: PLUGGY_CLIENT_ID, clientSecret: PLUGGY_CLIENT_SECRET }) })

const amostra: Record<string, unknown> = { geradoEm: new Date().toISOString(), de, itens: [] as unknown[] }
for (const itemId of PLUGGY_ITEM_IDS.split(',').map((s) => s.trim()).filter(Boolean)) {
  const item = await chamar(`/items/${itemId}`, {}, apiKey).catch((e) => ({ erro: String(e) }))
  console.log(`\n== Conexão ${itemId}: ${item.connector?.name ?? '?'} · status ${item.status ?? '?'} · atualizada ${item.lastUpdatedAt ?? '?'}`)

  const contas = (await chamar(`/accounts?itemId=${itemId}`, {}, apiKey)).results as any[]
  const porConta: unknown[] = []
  for (const c of contas) {
    const transacoes: any[] = []
    for (let page = 1; ; page++) {
      const r = await chamar(`/transactions?accountId=${c.id}&from=${de}&pageSize=500&page=${page}`, {}, apiKey)
      transacoes.push(...r.results)
      if (page >= r.totalPages) break
    }
    console.log(`  ${c.type}/${c.subtype} "${c.name}" ${c.number ?? ''} · saldo ${c.balance} · ${transacoes.length} transações desde ${de}`)
    for (const t of transacoes.slice(0, 5)) {
      console.log(`    ${t.date?.slice(0, 10)} ${t.type} ${t.amount} · ${t.description} · cat=${t.category ?? '-'}${t.merchant?.name ? ` · loja=${t.merchant.name}` : ''}${t.creditCardMetadata?.totalInstallments ? ` · parcela ${t.creditCardMetadata.installmentNumber}/${t.creditCardMetadata.totalInstallments}` : ''}`)
    }
    porConta.push({ conta: c, transacoes })
  }

  // Investimentos: se o endpoint não existir para essa conexão, segue sem eles.
  const investimentos = await chamar(`/investments?itemId=${itemId}`, {}, apiKey)
    .then((r) => r.results as any[])
    .catch((e) => {
      console.log(`  (investimentos indisponíveis: ${String(e).slice(0, 120)})`)
      return []
    })
  for (const i of investimentos) console.log(`  investimento: ${i.type}/${i.subtype ?? '-'} "${i.name}" · saldo ${i.balance ?? i.amount}`)

  ;(amostra.itens as unknown[]).push({ item, contas: porConta, investimentos })
}

fs.mkdirSync('backups', { recursive: true })
const arquivo = `backups/pluggy-amostra-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
fs.writeFileSync(arquivo, JSON.stringify(amostra, null, 1))
console.log(`\nAmostra crua salva em ${arquivo} (fora do git).`)
