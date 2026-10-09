// Sincronização com a Pluggy (Meu Pluggy / Open Finance): busca as transações recentes das conexões em
// PLUGGY_ITEM_IDS, guarda cada uma em pluggy_transacoes e lança as compras do cartão de crédito do Nubank
// (regras em src/lib/pluggy.ts). Roda pelo webhook da Pluggy, pela função agendada e sob demanda.
// Idempotente: transação já vista (pelo id) é pulada; a mesma compra com id novo é reconhecida pela chave.
import type { InStatement } from '@libsql/client/web'
import { db } from './db.ts'
import { chaveCompra, classificar, parear, valorReais, dataSP, type Classificacao, type PluggyConta, type PluggyTransacao } from '../src/lib/pluggy.ts'

const BASE = 'https://api.pluggy.ai'

export interface ResumoSincronizacao {
  lancadas: { data: string; local: string; valor_centavos: number; tipo: string }[]
  ligadas: number // compra que já estava lançada (à mão ou pela antiga notificação)
  mesmaCompra: number // mesma compra com id novo na Pluggy (ex.: pendente → na fatura)
  ignoradas: number
  revisar: number
  semPlataforma: number
  jaVistas: number
  simulacao: boolean
}

const agoraSP = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' })

async function pluggy(caminho: string, apiKey?: string, corpo?: unknown): Promise<any> {
  const res = await fetch(BASE + caminho, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(apiKey ? { 'X-API-KEY': apiKey } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await res.text()
  if (!res.ok) throw new Error(`Pluggy ${caminho.split('?')[0]} -> ${res.status}: ${texto.slice(0, 200)}`)
  return JSON.parse(texto)
}

async function transacoesDaConta(apiKey: string, contaId: string, dateFrom: string): Promise<PluggyTransacao[]> {
  const todas: PluggyTransacao[] = []
  let after: string | null = null
  do {
    const q = new URLSearchParams({ accountId: contaId, dateFrom, ...(after ? { after } : {}) })
    const r = await pluggy(`/v2/transactions?${q}`, apiKey)
    todas.push(...(r.results ?? []))
    const next: string | null = r.next ?? null
    after = next ? new URLSearchParams(next.includes('?') ? next.slice(next.indexOf('?') + 1) : next).get('after') : null
  } while (after)
  return todas
}

export async function sincronizarPluggy(opcoes: { dias?: number; simular?: boolean } = {}): Promise<ResumoSincronizacao> {
  const { PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEM_IDS } = process.env
  if (!PLUGGY_CLIENT_ID || !PLUGGY_CLIENT_SECRET || !PLUGGY_ITEM_IDS) throw new Error('Variáveis PLUGGY_* não configuradas')
  const dias = opcoes.dias ?? 10
  const simular = !!opcoes.simular
  const dateFrom = dataSP(new Date(Date.now() - dias * 86_400_000).toISOString())

  const { apiKey } = await pluggy('/auth', undefined, { clientId: PLUGGY_CLIENT_ID, clientSecret: PLUGGY_CLIENT_SECRET })

  // Cartão do Nubank: integração 'nubank-credito' ou, sem marca, a plataforma "Crédito Nubank".
  const plataformas = (await db().execute('SELECT id, nome, fechamento, integracao FROM plataformas')).rows
  const cartaoNubank =
    plataformas.find((p) => p.integracao === 'nubank-credito') ??
    plataformas.find((p) => String(p.nome).toLowerCase() === 'crédito nubank')

  // Coleta: cada transação com a conta e a plataforma a que pertence.
  type Coletada = { itemId: string; conta: PluggyConta; t: PluggyTransacao; plataforma: typeof cartaoNubank | null }
  const coletadas: Coletada[] = []
  for (const itemId of PLUGGY_ITEM_IDS.split(',').map((s) => s.trim()).filter(Boolean)) {
    const contas: PluggyConta[] = (await pluggy(`/accounts?itemId=${itemId}`, apiKey)).results ?? []
    // A conexão do Nubank é a que tem a conta "Nu Pagamentos"; o cartão de crédito dela é o Crédito Nubank.
    const ehNubank = contas.some((c) => c.type === 'BANK' && /nu pagamentos/i.test(c.name ?? ''))
    for (const conta of contas) {
      const plataforma = conta.type === 'CREDIT' && ehNubank ? (cartaoNubank ?? null) : null
      for (const t of await transacoesDaConta(apiKey, conta.id, dateFrom)) coletadas.push({ itemId, conta, t, plataforma })
    }
  }
  coletadas.sort((a, b) => a.t.date.localeCompare(b.t.date))

  // O que já foi visto: por id e pela chave da compra.
  const vistas = (await db().execute('SELECT id, chave, lancamento_id FROM pluggy_transacoes')).rows
  const idsVistos = new Set(vistas.map((v) => String(v.id)))
  const lancamentoPorChave = new Map(vistas.filter((v) => v.lancamento_id != null).map((v) => [String(v.chave), Number(v.lancamento_id)]))

  // Lançamentos do cartão que ainda não estão ligados a nenhuma transação da Pluggy (candidatos a "já existia").
  // Começa 40 dias antes da janela por causa das parcelas.
  const de = dataSP(new Date(Date.now() - (dias + 40) * 86_400_000).toISOString())
  const candidatos = cartaoNubank
    ? (
        await db().execute({
          sql: `SELECT id, data, valor_centavos FROM lancamentos
                WHERE plataforma_id = ? AND data >= ?
                  AND id NOT IN (SELECT lancamento_id FROM pluggy_transacoes WHERE lancamento_id IS NOT NULL)`,
          args: [Number(cartaoNubank.id), de],
        })
      ).rows.map((r) => ({ id: Number(r.id), data: String(r.data), valor_centavos: Number(r.valor_centavos) }))
    : []

  const resumo: ResumoSincronizacao = { lancadas: [], ligadas: 0, mesmaCompra: 0, ignoradas: 0, revisar: 0, semPlataforma: 0, jaVistas: 0, simulacao: simular }
  const agora = agoraSP()

  // Primeiro decide o que cada transação nova é; os pares com lançamentos existentes saem todos de uma
  // vez (ver parear), para a ordem das transações não mudar qual lançamento cada uma pega.
  const novas = coletadas.filter(({ t }) => !idsVistos.has(t.id))
  resumo.jaVistas = coletadas.length - novas.length
  const planos = novas.map((x) => ({
    ...x,
    chave: chaveCompra(x.t),
    c: x.conta.type === 'CREDIT' && !x.plataforma ? null : classificar(x.conta, x.t, Number(x.plataforma?.fechamento ?? 1)),
  }))
  const compras = planos.filter((p) => p.c?.acao === 'lancar' && !lancamentoPorChave.has(p.chave))
  const pares = parear(compras.map((p) => p.c as Extract<Classificacao, { acao: 'lancar' }>), candidatos)
  const existentes = new Map(compras.map((p, i) => [p, pares[i]]))

  for (const p of planos) {
    const { itemId, conta, t, plataforma, chave, c } = p
    const registro = (status: string, motivo: string | null, lancamento: number | 'novo' | null): InStatement => ({
      sql: `INSERT INTO pluggy_transacoes (id, item_id, conta_id, chave, data, descricao, valor_centavos, status, motivo, lancamento_id, bruto, importada_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${lancamento === 'novo' ? 'last_insert_rowid()' : '?'}, ?, ?)`,
      args: [
        t.id, itemId, conta.id, chave, dataSP(t.date), t.description ?? '', Math.round(valorReais(t) * 100), status, motivo,
        ...(lancamento === 'novo' ? [] : [lancamento]), JSON.stringify(t), agora,
      ],
    })
    let stmts: InStatement[]

    if (!c) {
      resumo.semPlataforma++
      stmts = [registro('sem_plataforma', 'cartão sem plataforma no app', null)]
    } else if (lancamentoPorChave.has(chave)) {
      resumo.mesmaCompra++
      stmts = [registro('mesma_compra', 'mesma compra com outro id na Pluggy', lancamentoPorChave.get(chave)!)]
    } else if (c.acao !== 'lancar') {
      if (c.acao === 'ignorar') resumo.ignoradas++
      else resumo.revisar++
      stmts = [registro(c.acao === 'ignorar' ? 'ignorada' : 'revisar', c.motivo, null)]
    } else {
      const existente = existentes.get(p)
      if (existente) {
        resumo.ligadas++
        lancamentoPorChave.set(chave, existente.id)
        stmts = [registro('ja_existia', 'já estava lançada', existente.id)]
      } else {
        resumo.lancadas.push({ data: c.data, local: c.local, valor_centavos: c.valor_centavos, tipo: c.tipo })
        stmts = [
          {
            sql: `INSERT INTO lancamentos (criado_em, data, produto, local, valor_centavos, categoria, plataforma_id, tipo)
                  VALUES (?, ?, '', ?, ?, NULL, ?, ?)`,
            args: [agora, c.data, c.local, c.valor_centavos, Number(plataforma!.id), c.tipo],
          },
          registro('lancada', null, 'novo'),
        ]
      }
    }

    if (simular) continue
    try {
      await db().batch(stmts, 'write')
      if (stmts.length === 2) {
        const id = Number((await db().execute({ sql: 'SELECT lancamento_id FROM pluggy_transacoes WHERE id = ?', args: [t.id] })).rows[0]?.lancamento_id)
        if (id) lancamentoPorChave.set(chave, id)
      }
    } catch (e) {
      // Outra rodada (webhook × agendada) gravou a mesma transação ao mesmo tempo: a transação inteira
      // é desfeita, então nada duplica.
      if (!/UNIQUE|PRIMARY KEY|constraint/i.test(String((e as Error).message))) throw e
    }
  }
  return resumo
}
