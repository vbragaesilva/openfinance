import type { InStatement, Row } from '@libsql/client/web'
import { db } from './db.ts'
import { cookieLogout, iguais, login, modoAuth, sessaoValida, tokenApiValido } from './auth.ts'
import { sincronizarPluggy } from './pluggy.ts'
import { brl, lerValor } from '../src/lib/formato.ts'
import { lerNotificacao } from '../src/lib/splitwise.ts'
import { lerNotificacaoNubank } from '../src/lib/nubank.ts'
import type { Dados, Plataforma } from '../src/lib/tipos.ts'

type Campo =
  | { t: 'texto'; opcional?: boolean }
  | { t: 'data'; opcional?: boolean }
  | { t: 'mes'; opcional?: boolean }
  | { t: 'datahora' }
  | { t: 'inteiro'; min?: number; max?: number }
  | { t: 'bool' }
  | { t: 'enum'; valores: string[]; opcional?: boolean }

const TIPO: Campo = { t: 'enum', valores: ['Variável', 'Fixo'], opcional: true }

const CAMPOS_LANCAMENTO: Record<string, Campo> = {
  criado_em: { t: 'datahora' },
  data: { t: 'data' },
  produto: { t: 'texto' },
  local: { t: 'texto' },
  valor_centavos: { t: 'inteiro' },
  categoria: { t: 'texto', opcional: true },
  plataforma_id: { t: 'inteiro' },
  tipo: TIPO,
}

// Campos editáveis de uma plataforma (`integracao` só muda pelo banco).
const CAMPOS_PLATAFORMA: Record<string, Campo> = {
  nome: { t: 'texto' },
  fechamento: { t: 'inteiro', min: 1, max: 28 },
  no_painel: { t: 'bool' },
  nas_analises: { t: 'bool' },
  ativa: { t: 'bool' },
  ordem: { t: 'inteiro' },
}

// Campos de um fixo que valem para todos os meses (o valor tem vigência própria).
const CAMPOS_FIXO: Record<string, Campo> = {
  nome: { t: 'texto' },
  investimento: { t: 'bool' },
  ordem: { t: 'inteiro' },
  fim: { t: 'mes', opcional: true },
}

class ErroHttp extends Error {
  status: number
  constructor(status: number, msg: string) {
    super(msg)
    this.status = status
  }
}

/** Data de hoje em São Paulo (AAAA-MM-DD). */
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

/**
 * Plataforma pelo nome, sem diferenciar maiúsculas/acentos: nome exato ou, se só uma ativa
 * começar assim, o começo do nome ("credito" acha "Crédito Nubank" enquanto for o único crédito).
 */
function plataformaPeloNome(texto: string, plataformas: Plataforma[]): Plataforma {
  const t = semAcento(texto)
  const exata = plataformas.find((p) => semAcento(p.nome) === t)
  if (exata) return exata
  const comeco = plataformas.filter((p) => p.ativa && semAcento(p.nome).startsWith(t))
  if (t && comeco.length === 1) return comeco[0]
  const opcoes = plataformas.filter((p) => p.ativa).map((p) => p.nome).join(', ')
  throw new ErroHttp(
    400,
    comeco.length > 1
      ? `Plataforma "${texto}" é ambígua (${comeco.map((p) => p.nome).join(', ')}). Use o nome inteiro.`
      : `Plataforma "${texto}" não existe. Use uma de: ${opcoes}`,
  )
}

/**
 * Deixa um lançamento vindo dos Atalhos do iPhone no formato da API. O app já manda tudo
 * certinho; isto só completa o que o atalho não tem como mandar fácil:
 *  - `valor` como no iPhone ("R$ 16,50", "16.5", -5.9) em vez de `valor_centavos`;
 *  - `data` ausente = hoje;
 *  - `plataforma` pelo nome em vez de `plataforma_id` (`modalidade`, do atalho antigo, vale igual:
 *    "credito" acha "Crédito Nubank");
 *  - "fixo"/"variavel" sem acento ou em minúsculas;
 *  - tipo ausente = Variável (ausente, não `null`: o app usa `null` para "sem tipo").
 */
function normalizarEntrada(item: unknown, plataformas: Plataforma[]): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  const o = { ...(item as Record<string, unknown>) }
  if (o.valor_centavos === undefined && o.valor !== undefined) {
    const v = o.valor
    const c = typeof v === 'number' ? Math.round(v * 100) : typeof v === 'string' ? lerValor(v.replace(/[^\d,.-]/g, '')) : null
    if (c == null) throw new ErroHttp(400, `Valor inválido: ${JSON.stringify(v)}`)
    o.valor_centavos = c
  }
  delete o.valor
  if (o.data === undefined || o.data === '') o.data = hojeSP()
  if (o.tipo === undefined) o.tipo = 'Variável'
  else if (typeof o.tipo === 'string') {
    const t = semAcento(o.tipo)
    if (t === 'fixo') o.tipo = 'Fixo'
    else if (t === 'variavel') o.tipo = 'Variável'
  }
  const nome = o.plataforma ?? o.modalidade
  if (o.plataforma_id === undefined && typeof nome === 'string') o.plataforma_id = plataformaPeloNome(nome, plataformas).id
  delete o.plataforma
  delete o.modalidade
  return o
}

/** Data/hora local de São Paulo no mesmo formato do "Carimbo de data/hora" do Forms. */
export function agoraSP() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

function validar(nome: string, campo: Campo, v: unknown): string | number | null {
  const opcional = 'opcional' in campo && campo.opcional
  if (v === null || v === undefined || v === '') {
    if (opcional) return null
    if (campo.t === 'texto') return ''
    if (campo.t === 'bool') return 0
    if (campo.t === 'datahora') return agoraSP()
    if (campo.t === 'inteiro' && nome === 'ordem') return 0
    throw new ErroHttp(400, `Campo obrigatório: ${nome}`)
  }
  switch (campo.t) {
    case 'texto':
    case 'datahora':
      if (typeof v !== 'string') throw new ErroHttp(400, `${nome} deve ser texto`)
      return v.trim()
    case 'data':
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ErroHttp(400, `${nome} deve ser AAAA-MM-DD`)
      return v
    case 'mes':
      if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new ErroHttp(400, `${nome} deve ser AAAA-MM`)
      return v
    case 'inteiro':
      if (typeof v !== 'number' || !Number.isInteger(v)) throw new ErroHttp(400, `${nome} deve ser inteiro`)
      if ((campo.min != null && v < campo.min) || (campo.max != null && v > campo.max)) {
        throw new ErroHttp(400, `${nome} deve ficar entre ${campo.min} e ${campo.max}`)
      }
      return v
    case 'bool':
      return v ? 1 : 0
    case 'enum':
      if (typeof v !== 'string' || !campo.valores.includes(v)) {
        throw new ErroHttp(400, `${nome} deve ser um de: ${campo.valores.join(', ')}`)
      }
      return v
  }
}

function linhaParaInsert(tabela: string, campos: Record<string, Campo>, corpo: unknown): InStatement {
  if (!corpo || typeof corpo !== 'object') throw new ErroHttp(400, 'Corpo inválido')
  const obj = corpo as Record<string, unknown>
  const nomes = Object.keys(campos)
  const args = nomes.map((n) => validar(n, campos[n], obj[n]))
  return {
    sql: `INSERT INTO ${tabela} (${nomes.join(', ')}) VALUES (${nomes.map(() => '?').join(', ')})`,
    args,
  }
}

function linhaParaUpdate(tabela: string, campos: Record<string, Campo>, id: number, corpo: unknown): InStatement {
  if (!corpo || typeof corpo !== 'object') throw new ErroHttp(400, 'Corpo inválido')
  const obj = corpo as Record<string, unknown>
  const nomes = Object.keys(obj).filter((n) => n in campos)
  if (nomes.length === 0) throw new ErroHttp(400, 'Nada para atualizar')
  const args = nomes.map((n) => validar(n, campos[n], obj[n]))
  return { sql: `UPDATE ${tabela} SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`, args: [...args, id] }
}

/** Recusa lançamento numa plataforma que não existe. */
function conferirPlataforma(corpo: unknown, plataformas: Plataforma[]) {
  const id = (corpo as Record<string, unknown> | null)?.plataforma_id
  if (id !== undefined && !plataformas.some((p) => p.id === id)) throw new ErroHttp(400, `Plataforma ${JSON.stringify(id)} não existe`)
}

function paraObjeto(row: Row): Record<string, unknown> {
  const o: Record<string, unknown> = { ...row }
  for (const k of Object.keys(o)) if (typeof o[k] === 'bigint') o[k] = Number(o[k])
  return o
}

const plataformaDaLinha = (o: Record<string, unknown>): Plataforma => ({
  ...(o as unknown as Plataforma),
  no_painel: o.no_painel === 1,
  nas_analises: o.nas_analises === 1,
  ativa: o.ativa === 1,
})

const SQL_PLATAFORMAS = 'SELECT * FROM plataformas ORDER BY ordem, id'

async function carregarPlataformas(): Promise<Plataforma[]> {
  const rs = await db().execute(SQL_PLATAFORMAS)
  return rs.rows.map(paraObjeto).map(plataformaDaLinha)
}

/** Banco de antes das plataformas: avisa em vez de dar "Erro interno". */
function bancoDesatualizado(e: unknown): never {
  if (/no such (table|column).*(plataforma|lancamento_id)/i.test(String((e as Error)?.message))) {
    throw new ErroHttp(500, 'O banco ainda não tem plataformas: rode npm run db:migrate.')
  }
  throw e
}

async function carregarDados(): Promise<Dados> {
  const [plataformas, lancamentos, fixos, valores, pagamentos, salarios, caixa, notificacoes] = await db().batch(
    [
      SQL_PLATAFORMAS,
      'SELECT id, criado_em, data, produto, local, valor_centavos, categoria, plataforma_id, tipo FROM lancamentos ORDER BY data, criado_em, id',
      'SELECT * FROM fixos ORDER BY ordem, id',
      'SELECT * FROM fixos_valores ORDER BY fixo_id, desde',
      'SELECT * FROM fixos_pagamentos ORDER BY fixo_id, data, id',
      'SELECT * FROM salarios ORDER BY desde',
      'SELECT * FROM caixa_mensal ORDER BY ano, mes',
      `SELECT id, recebida_em, titulo, subtitulo, mensagem, status, motivo FROM notificacoes
       WHERE status IN ('ignorada', 'revisar') ORDER BY id DESC LIMIT 50`,
    ],
    'read',
  ).catch(bancoDesatualizado)
  const linhas = <T,>(rs: { rows: Row[] }) => rs.rows.map(paraObjeto) as T[]
  const vals = linhas<{ fixo_id: number; desde: string; valor_centavos: number }>(valores)
  const pags = linhas<{ fixo_id: number; id: number; data: string }>(pagamentos)
  return {
    plataformas: linhas<Record<string, unknown>>(plataformas).map(plataformaDaLinha),
    lancamentos: linhas(lancamentos),
    fixos: linhas<Record<string, unknown> & { id: number }>(fixos).map((f) => ({
      ...(f as unknown as Dados['fixos'][number]),
      investimento: f.investimento === 1,
      valores: vals.filter((v) => v.fixo_id === f.id).map(({ desde, valor_centavos }) => ({ desde, valor_centavos })),
      pagamentos: pags.filter((p) => p.fixo_id === f.id).map(({ id, data }) => ({ id, data })),
    })),
    salarios: linhas(salarios),
    caixa: linhas(caixa),
    notificacoes: linhas(notificacoes),
  }
}

function json(dados: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

async function corpoJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw new ErroHttp(400, 'JSON inválido')
  }
}

const LIMITE_LOG = 20_000

/** Guarda no banco uma chamada feita com a chave dos atalhos (nunca o cabeçalho Authorization). */
async function registrarAtalho(req: Request, caminho: string, corpo: string | null, status: number, resposta: string) {
  const cabecalhos = Object.fromEntries(
    ['content-type', 'user-agent', 'content-length'].flatMap((h) => {
      const v = req.headers.get(h)
      return v == null ? [] : [[h, v]]
    }),
  )
  await db().execute({
    sql: `INSERT INTO log_atalhos (recebida_em, metodo, caminho, status, cabecalhos, corpo, resposta)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [agoraSP(), req.method, caminho, status, JSON.stringify(cabecalhos), corpo?.slice(0, LIMITE_LOG) ?? null, resposta.slice(0, LIMITE_LOG)],
  })
}

/** `waitUntil` vem do contexto da Netlify: deixa trabalho rodando depois de responder (webhook da Pluggy). */
export interface Contexto {
  waitUntil?: (p: Promise<unknown>) => void
}

export async function handle(req: Request, contexto: Contexto = {}): Promise<Response> {
  const caminho = new URL(req.url).pathname
  const via = req.headers.get('authorization') ? 'token' : req.headers.get('cookie') ? 'cookie' : 'sem auth'
  // Corpo exato de tudo que não vem da tela do app (atalhos, com ou sem chave), para depurar.
  const deFora = via !== 'cookie' && req.method !== 'GET'
  const corpoAtalho = deFora ? await req.clone().text().catch(() => null) : null

  let resposta: Response
  try {
    resposta = await rotear(req, contexto)
  } catch (e) {
    if (e instanceof ErroHttp) resposta = json({ erro: e.message }, e.status)
    else {
      console.error(`${req.method} ${caminho} -> 500 (${via})`, e)
      resposta = json({ erro: 'Erro interno' }, 500)
    }
  }

  // Uma linha por requisição nos logs da Netlify (nunca com cabeçalhos, para não vazar a chave).
  const textoResposta = resposta.status >= 400 || via === 'token' ? await resposta.clone().text() : ''
  const erro = resposta.status >= 400 ? `: ${textoResposta.slice(0, 300)}` : ''
  console.log(`${req.method} ${caminho} -> ${resposta.status} (${via})${erro}`)
  if (deFora) console.log(`  corpo recebido: ${corpoAtalho?.slice(0, 2000) ?? '(ilegível)'}`)
  if (via === 'token') {
    // Só grava no banco com a chave certa, para ninguém conseguir encher a tabela de lixo.
    if (tokenApiValido(req)) {
      await registrarAtalho(req, caminho, corpoAtalho, resposta.status, textoResposta).catch((e) =>
        console.error('Falha ao gravar log_atalhos', e),
      )
    }
  }
  return resposta
}

async function rotear(req: Request, contexto: Contexto): Promise<Response> {
  const url = new URL(req.url)
  const partes = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  const metodo = req.method
  const seguro = url.protocol === 'https:'

  if (partes[0] === 'sessao' && metodo === 'GET') {
    const modo = modoAuth()
    if (modo.tipo === 'mal-configurado') {
      return json({ erro: 'Configure APP_PASSWORD e SESSION_SECRET nas variáveis de ambiente.' }, 500)
    }
    return json({ autenticado: await sessaoValida(req), aberto: modo.tipo === 'aberto' })
  }
  if (partes[0] === 'login' && metodo === 'POST') {
    const corpo = (await corpoJson(req)) as { senha?: unknown }
    const cookie = await login(typeof corpo.senha === 'string' ? corpo.senha : '', seguro)
    if (!cookie) return json({ erro: 'Senha incorreta' }, 401)
    return json({ ok: true }, 200, { 'set-cookie': cookie })
  }
  if (partes[0] === 'logout' && metodo === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': cookieLogout(seguro) })
  }

  // Webhook da Pluggy (registrado com ?chave=PLUGGY_WEBHOOK_SECRET na URL, porque a Pluggy não assina
  // as chamadas). Responde na hora (ela exige resposta em até 5 s) e sincroniza em seguida.
  if (partes[0] === 'pluggy' && partes[1] === 'webhook' && metodo === 'POST') {
    const segredo = process.env.PLUGGY_WEBHOOK_SECRET
    if (!segredo || !iguais(url.searchParams.get('chave') ?? '', segredo)) return json({ erro: 'Não autenticado' }, 401)
    const evento = (await corpoJson(req)) as { event?: unknown; itemId?: unknown }
    const ids = (process.env.PLUGGY_ITEM_IDS ?? '').split(',').map((s) => s.trim())
    if (!ids.includes(String(evento.itemId)) || !/^(item\/updated|transactions\/)/.test(String(evento.event))) {
      return json({ ok: true, ignorado: true })
    }
    const tarefa = sincronizarPluggy()
      .then((r) => console.log(`Pluggy (${evento.event}): ${JSON.stringify(r)}`))
      .catch((e) => console.error('Falha na sincronização da Pluggy (webhook)', e))
    if (contexto.waitUntil) contexto.waitUntil(tarefa)
    else await tarefa
    return json({ ok: true }, 202)
  }

  if (!(await sessaoValida(req))) return json({ erro: 'Não autenticado' }, 401)

  // Sincronização sob demanda com a Pluggy. ?simular=1 só mostra o que faria; ?dias=N muda a janela (padrão 10).
  if (partes[0] === 'pluggy' && partes[1] === 'sincronizar' && metodo === 'POST') {
    const dias = url.searchParams.has('dias') ? (validar('dias', { t: 'inteiro', min: 1, max: 90 }, Number(url.searchParams.get('dias'))) as number) : undefined
    return json(await sincronizarPluggy({ dias, simular: url.searchParams.get('simular') === '1' }))
  }

  if (partes[0] === 'dados' && metodo === 'GET') return json(await carregarDados())

  // Salário com vigência: PUT/DELETE /api/salarios/AAAA-MM
  if (partes[0] === 'salarios' && partes.length === 2) {
    const desde = validar('desde', { t: 'mes' }, partes[1])
    if (metodo === 'PUT') {
      const corpo = (await corpoJson(req)) as { valor_centavos?: unknown }
      await db().execute({
        sql: `INSERT INTO salarios (desde, valor_centavos) VALUES (?, ?)
              ON CONFLICT (desde) DO UPDATE SET valor_centavos = excluded.valor_centavos`,
        args: [desde, validar('valor_centavos', { t: 'inteiro' }, corpo.valor_centavos)],
      })
      return json({ ok: true })
    }
    if (metodo === 'DELETE') {
      await db().execute({ sql: 'DELETE FROM salarios WHERE desde = ?', args: [desde] })
      return json({ ok: true })
    }
  }

  if (partes[0] === 'fixos') return rotasFixos(req, partes.slice(1))
  if (partes[0] === 'plataformas') return rotasPlataformas(req, partes.slice(1))

  // Notificação do Nubank vinda do atalho do iPhone. Sempre guarda crua; "Compra no crédito
  // aprovada" também vira lançamento na plataforma do cartão (ver src/lib/nubank.ts).
  if (partes[0] === 'lancamentos' && partes[1] === 'notificacao' && metodo === 'POST') {
    const bruto = await req.text()
    let c: Record<string, unknown> = {}
    try {
      const v = JSON.parse(bruto)
      if (v && typeof v === 'object' && !Array.isArray(v)) c = v as Record<string, unknown>
    } catch {
      // Guarda mesmo se não for JSON válido: o corpo cru é o que interessa nesta fase.
    }
    const campo = (k: string) => (c[k] == null ? null : String(c[k]))
    const n = { titulo: campo('titulo') ?? '', subtitulo: campo('subtitulo') ?? '', mensagem: campo('mensagem') ?? '' }
    const agora = agoraSP()
    const registro = (status: string, comLancamento: boolean): InStatement => ({
      sql: `INSERT INTO notificacoes_nubank (recebida_em, titulo, subtitulo, mensagem, corpo, status, lancamento_id)
            VALUES (?, ?, ?, ?, ?, ?, ${comLancamento ? 'last_insert_rowid()' : 'NULL'})`,
      args: [agora, campo('titulo'), campo('subtitulo'), campo('mensagem'), bruto.slice(0, 20_000), status],
    })
    const leitura = lerNotificacaoNubank(n)
    if (leitura.tipo === 'credito') {
      // Plataforma do cartão: marcada com integracao = 'nubank-credito' ou, sem marca, pelo nome.
      const plataformas = await carregarPlataformas().catch(bancoDesatualizado)
      const cartao =
        plataformas.find((p) => p.integracao === 'nubank-credito') ??
        plataformas.find((p) => p.nome.toLowerCase() === 'crédito nubank')
      if (cartao) {
        const data = agora.slice(0, 10)
        await db().batch(
          [
            {
              sql: `INSERT INTO lancamentos (criado_em, data, produto, local, valor_centavos, categoria, plataforma_id, tipo)
                    VALUES (?, ?, '', ?, ?, NULL, ?, ?)`,
              args: [agora, data, leitura.local, leitura.valor_centavos, cartao.id, leitura.fixo],
            },
            registro('lancada', true),
          ],
          'write',
        )
        return json(
          {
            mensagem: `Lançado: ${brl(leitura.valor_centavos)} · ${leitura.local} (${cartao.nome}${leitura.fixo === 'Fixo' ? ', Fixo' : ''}) · ${data.split('-').reverse().join('/')}`,
          },
          201,
        )
      }
      await db().execute(registro('revisar', false))
      return json({ mensagem: 'Compra do Nubank guardada, sem lançar: não achei a plataforma "Crédito Nubank".' }, 202)
    }
    await db().execute(registro(leitura.tipo, false))
    return json({ mensagem: `Notificação do Nubank guardada (${leitura.tipo === 'revisar' ? leitura.motivo : 'sem regra de lançamento'}).` }, 202)
  }

  // Notificação do Splitwise vinda do atalho do iPhone: guarda crua e, se entender, lança na
  // plataforma do Splitwise (a que tem integracao = 'splitwise').
  if (partes[0] === 'split' && partes[1] === 'notificacao' && metodo === 'POST') {
    const c = (await corpoJson(req)) as Record<string, unknown>
    const texto = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : c[k] == null ? '' : String(c[k]))
    const n = { titulo: texto('titulo'), subtitulo: texto('subtitulo'), mensagem: texto('mensagem') }
    const leitura = lerNotificacao(n)
    const agora = agoraSP()
    const registro = (status: string, motivo: string | null, comLancamento: boolean): InStatement => ({
      sql: `INSERT INTO notificacoes (recebida_em, titulo, subtitulo, mensagem, status, motivo, lancamento_id)
            VALUES (?, ?, ?, ?, ?, ?, ${comLancamento ? 'last_insert_rowid()' : 'NULL'})`,
      args: [agora, n.titulo, n.subtitulo, n.mensagem, status, motivo],
    })
    const splitwise = (await carregarPlataformas().catch(bancoDesatualizado)).find((p) => p.integracao === 'splitwise')
    if (leitura.tipo === 'split' && splitwise) {
      const data = agora.slice(0, 10)
      await db().batch(
        [
          {
            sql: `INSERT INTO lancamentos (criado_em, data, produto, local, valor_centavos, categoria, plataforma_id, tipo)
                  VALUES (?, ?, ?, '', ?, NULL, ?, ?)`,
            args: [agora, data, leitura.nome, leitura.valor_centavos, splitwise.id, leitura.fixo],
          },
          registro('split', null, true),
        ],
        'write',
      )
      return json(
        {
          mensagem: `Split lançado: ${brl(leitura.valor_centavos)} · ${leitura.nome}${leitura.fixo === 'Fixo' ? ' (Fixo)' : ''} · ${data.split('-').reverse().join('/')}`,
        },
        201,
      )
    }
    // Sem plataforma do Splitwise, mesmo o que foi entendido fica para revisar.
    const [status, motivo] = leitura.tipo === 'split' ? ['revisar', 'nenhuma plataforma do Splitwise'] : [leitura.tipo, leitura.motivo]
    await db().execute(registro(status, motivo, false))
    return json({ mensagem: `Notificação do Splitwise guardada, sem virar split (${motivo}).` }, 202)
  }

  // Notificação revisada na tela Lançamentos: 'resolvida' (virou lançamento à mão) ou 'descartada'.
  if (partes[0] === 'notificacoes' && partes.length === 2 && metodo === 'PUT') {
    const c = (await corpoJson(req)) as Record<string, unknown>
    const status = validar('status', { t: 'enum', valores: ['resolvida', 'descartada'] }, c.status)
    const rs = await db().execute({ sql: 'UPDATE notificacoes SET status = ? WHERE id = ?', args: [status, Number(partes[1])] })
    if (rs.rowsAffected === 0) throw new ErroHttp(404, 'Não encontrado')
    return json({ ok: true })
  }

  if (partes[0] === 'pagamentos' && partes.length === 2 && metodo === 'DELETE') {
    const rs = await db().execute({ sql: 'DELETE FROM fixos_pagamentos WHERE id = ?', args: [Number(partes[1])] })
    if (rs.rowsAffected === 0) throw new ErroHttp(404, 'Não encontrado')
    return json({ ok: true })
  }

  if (partes[0] === 'caixa' && partes.length === 3 && metodo === 'PUT') {
    const ano = Number(partes[1])
    const mes = Number(partes[2])
    if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new ErroHttp(400, 'Mês inválido')
    const corpo = (await corpoJson(req)) as { valor_centavos?: unknown }
    if (corpo.valor_centavos === null) {
      await db().execute({ sql: 'DELETE FROM caixa_mensal WHERE ano = ? AND mes = ?', args: [ano, mes] })
    } else {
      const v = validar('valor_centavos', { t: 'inteiro' }, corpo.valor_centavos)
      await db().execute({
        sql: `INSERT INTO caixa_mensal (ano, mes, valor_centavos) VALUES (?, ?, ?)
              ON CONFLICT (ano, mes) DO UPDATE SET valor_centavos = excluded.valor_centavos`,
        args: [ano, mes, v],
      })
    }
    return json({ ok: true })
  }

  // POST /api/split é o atalho antigo do split ({valor, nome, fixo}): vira lançamento no Splitwise.
  const ehSplit = partes[0] === 'split' && partes.length === 1 && metodo === 'POST'
  if (partes[0] === 'lancamentos' || ehSplit) {
    if (partes.length === 1 && metodo === 'POST') {
      const plataformas = await carregarPlataformas().catch(bancoDesatualizado)
      const corpo = await corpoJson(req)
      let brutos = Array.isArray(corpo) ? corpo : [corpo]
      if (ehSplit) {
        const splitwise = plataformas.find((p) => p.integracao === 'splitwise')
        if (!splitwise) throw new ErroHttp(400, 'Nenhuma plataforma do Splitwise configurada')
        brutos = brutos.map((i) => {
          const { nome, fixo, ...resto } = (i ?? {}) as Record<string, unknown>
          return { ...resto, produto: nome, tipo: fixo, plataforma_id: splitwise.id }
        })
      }
      const itens = brutos.map((i) => normalizarEntrada(i, plataformas))
      if (itens.length === 0 || itens.length > 60) throw new ErroHttp(400, 'Envie de 1 a 60 itens')
      for (const i of itens) conferirPlataforma(i, plataformas)
      const rs = await db().batch(
        itens.map((i) => linhaParaInsert('lancamentos', CAMPOS_LANCAMENTO, i)),
        'write',
      )
      // `mensagem` é para o atalho mostrar no iPhone.
      const primeiro = itens[0] as Record<string, unknown>
      const plataforma = plataformas.find((p) => p.id === primeiro.plataforma_id)?.nome ?? ''
      const descricao = `${primeiro.produto || primeiro.local || ''} (${plataforma})`
      return json(
        {
          ids: rs.map((r) => Number(r.lastInsertRowid)),
          mensagem: `${ehSplit ? 'Split lançado' : 'Lançado'}: ${brl(Number(primeiro.valor_centavos))} · ${descricao.trim()} · ${String(primeiro.data).split('-').reverse().join('/')}`,
        },
        201,
      )
    }
    const id = Number(partes[1])
    if (partes.length === 2 && Number.isInteger(id)) {
      if (metodo === 'PUT') {
        const corpo = await corpoJson(req)
        conferirPlataforma(corpo, await carregarPlataformas())
        const rs = await db().execute(linhaParaUpdate('lancamentos', CAMPOS_LANCAMENTO, id, corpo))
        if (rs.rowsAffected === 0) throw new ErroHttp(404, 'Não encontrado')
        return json({ ok: true })
      }
      if (metodo === 'DELETE') {
        const rs = await db().execute({ sql: 'DELETE FROM lancamentos WHERE id = ?', args: [id] })
        if (rs.rowsAffected === 0) throw new ErroHttp(404, 'Não encontrado')
        return json({ ok: true })
      }
    }
  }

  return json({ erro: 'Rota não encontrada' }, 404)
}

/** Nome repetido (o banco compara sem diferenciar maiúsculas) vira 409 em vez de "Erro interno". */
async function semNomeRepetido<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if (/UNIQUE constraint failed: plataformas\.nome/i.test(String((e as Error)?.message))) {
      throw new ErroHttp(409, 'Já existe uma plataforma com esse nome')
    }
    throw e
  }
}

/**
 * POST   /api/plataformas          {nome, fechamento?, no_painel?, nas_analises?}
 * PUT    /api/plataformas/ordem    [id, id, …]  (nova ordem de todas)
 * PUT    /api/plataformas/:id      {nome?, fechamento?, no_painel?, nas_analises?, ativa?, ordem?}
 * DELETE /api/plataformas/:id      (só sem lançamentos; com lançamentos, desative)
 */
async function rotasPlataformas(req: Request, partes: string[]): Promise<Response> {
  const metodo = req.method
  if (partes.length === 0 && metodo === 'POST') {
    const c = (await corpoJson(req)) as Record<string, unknown>
    const nome = validar('nome', CAMPOS_PLATAFORMA.nome, c.nome)
    if (!nome) throw new ErroHttp(400, 'Dê um nome para a plataforma')
    await semNomeRepetido(() =>
      db().execute({
        sql: `INSERT INTO plataformas (nome, fechamento, no_painel, nas_analises, ativa, ordem)
              VALUES (?, ?, ?, ?, 1, (SELECT COALESCE(MAX(ordem), 0) + 1 FROM plataformas))`,
        args: [
          nome,
          c.fechamento == null ? 1 : validar('fechamento', CAMPOS_PLATAFORMA.fechamento, c.fechamento),
          c.no_painel === undefined ? 1 : validar('no_painel', CAMPOS_PLATAFORMA.no_painel, c.no_painel),
          validar('nas_analises', CAMPOS_PLATAFORMA.nas_analises, c.nas_analises),
        ],
      }),
    )
    return json({ ok: true }, 201)
  }

  if (partes[0] === 'ordem' && partes.length === 1 && metodo === 'PUT') {
    const ids = await corpoJson(req)
    if (!Array.isArray(ids) || !ids.every((i) => Number.isInteger(i))) throw new ErroHttp(400, 'Envie a lista de ids')
    await db().batch(
      ids.map((id, i) => ({ sql: 'UPDATE plataformas SET ordem = ? WHERE id = ?', args: [i + 1, id as number] })),
      'write',
    )
    return json({ ok: true })
  }

  const id = Number(partes[0])
  if (partes.length !== 1 || !Number.isInteger(id)) return json({ erro: 'Rota não encontrada' }, 404)

  if (metodo === 'PUT') {
    const corpo = (await corpoJson(req)) as Record<string, unknown>
    if (corpo?.nome !== undefined && !String(corpo.nome).trim()) throw new ErroHttp(400, 'Dê um nome para a plataforma')
    const rs = await semNomeRepetido(() => db().execute(linhaParaUpdate('plataformas', CAMPOS_PLATAFORMA, id, corpo)))
    if (rs.rowsAffected === 0) throw new ErroHttp(404, 'Plataforma não encontrada')
    return json({ ok: true })
  }
  if (metodo === 'DELETE') {
    const rs = await db().execute({ sql: 'SELECT COUNT(*) AS n FROM lancamentos WHERE plataforma_id = ?', args: [id] })
    const n = Number(rs.rows[0].n)
    if (n > 0) {
      throw new ErroHttp(409, `A plataforma tem ${n} ${n === 1 ? 'lançamento' : 'lançamentos'}. Desative em vez de apagar, para o histórico continuar contando.`)
    }
    const del = await db().execute({ sql: 'DELETE FROM plataformas WHERE id = ?', args: [id] })
    if (del.rowsAffected === 0) throw new ErroHttp(404, 'Plataforma não encontrada')
    return json({ ok: true })
  }
  return json({ erro: 'Rota não encontrada' }, 404)
}

async function existeFixo(id: number) {
  const rs = await db().execute({ sql: 'SELECT 1 FROM fixos WHERE id = ?', args: [id] })
  if (rs.rows.length === 0) throw new ErroHttp(404, 'Fixo não encontrado')
}

/**
 * POST   /api/fixos                 {nome, valor_centavos, investimento, inicio}
 * PUT    /api/fixos/:id             {nome?, investimento?, ordem?, fim?}  (vale para todos os meses)
 * PUT    /api/fixos/:id/valor       {desde, valor_centavos}               (valor a partir de um mês)
 * DELETE /api/fixos/:id/valor/:desde                                    (desfaz uma mudança de valor)
 * POST   /api/fixos/:id/pagamentos  {data}
 * DELETE /api/fixos/:id             (apaga de todo o histórico)
 */
async function rotasFixos(req: Request, partes: string[]): Promise<Response> {
  const metodo = req.method
  if (partes.length === 0 && metodo === 'POST') {
    const c = (await corpoJson(req)) as Record<string, unknown>
    const inicio = validar('inicio', { t: 'mes' }, c.inicio)
    await db().batch(
      [
        {
          sql: `INSERT INTO fixos (nome, investimento, ordem, inicio)
                VALUES (?, ?, (SELECT COALESCE(MAX(ordem), 0) + 1 FROM fixos), ?)`,
          args: [validar('nome', CAMPOS_FIXO.nome, c.nome), validar('investimento', CAMPOS_FIXO.investimento, c.investimento), inicio],
        },
        {
          sql: 'INSERT INTO fixos_valores (fixo_id, desde, valor_centavos) VALUES (last_insert_rowid(), ?, ?)',
          args: [inicio, validar('valor_centavos', { t: 'inteiro' }, c.valor_centavos)],
        },
      ],
      'write',
    )
    return json({ ok: true }, 201)
  }

  const id = Number(partes[0])
  if (!Number.isInteger(id)) return json({ erro: 'Rota não encontrada' }, 404)

  if (partes.length === 1 && metodo === 'PUT') {
    const c = (await corpoJson(req)) as Record<string, unknown>
    const nomes = Object.keys(c).filter((n) => n in CAMPOS_FIXO)
    if (nomes.length === 0) throw new ErroHttp(400, 'Nada para atualizar')
    const rs = await db().execute({
      sql: `UPDATE fixos SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`,
      args: [...nomes.map((n) => validar(n, CAMPOS_FIXO[n], c[n])), id],
    })
    if (rs.rowsAffected === 0) throw new ErroHttp(404, 'Fixo não encontrado')
    return json({ ok: true })
  }
  if (partes.length === 1 && metodo === 'DELETE') {
    await existeFixo(id)
    await db().batch(
      [
        { sql: 'DELETE FROM fixos_pagamentos WHERE fixo_id = ?', args: [id] },
        { sql: 'DELETE FROM fixos_valores WHERE fixo_id = ?', args: [id] },
        { sql: 'DELETE FROM fixos WHERE id = ?', args: [id] },
      ],
      'write',
    )
    return json({ ok: true })
  }
  if (partes[1] === 'valor' && metodo === 'PUT') {
    const c = (await corpoJson(req)) as Record<string, unknown>
    await existeFixo(id)
    await db().execute({
      sql: `INSERT INTO fixos_valores (fixo_id, desde, valor_centavos) VALUES (?, ?, ?)
            ON CONFLICT (fixo_id, desde) DO UPDATE SET valor_centavos = excluded.valor_centavos`,
      args: [id, validar('desde', { t: 'mes' }, c.desde), validar('valor_centavos', { t: 'inteiro' }, c.valor_centavos)],
    })
    return json({ ok: true })
  }
  if (partes[1] === 'valor' && partes.length === 3 && metodo === 'DELETE') {
    const desde = validar('desde', { t: 'mes' }, partes[2])
    const rs = await db().execute({ sql: 'SELECT COUNT(*) AS n FROM fixos_valores WHERE fixo_id = ?', args: [id] })
    if (Number(rs.rows[0].n) <= 1) throw new ErroHttp(400, 'O fixo precisa de pelo menos um valor; para tirá-lo, encerre ou apague o fixo.')
    await db().execute({ sql: 'DELETE FROM fixos_valores WHERE fixo_id = ? AND desde = ?', args: [id, desde] })
    return json({ ok: true })
  }
  if (partes[1] === 'pagamentos' && metodo === 'POST') {
    const c = (await corpoJson(req)) as Record<string, unknown>
    await existeFixo(id)
    await db().execute({
      sql: 'INSERT INTO fixos_pagamentos (fixo_id, data) VALUES (?, ?)',
      args: [id, validar('data', { t: 'data' }, c.data)],
    })
    return json({ ok: true }, 201)
  }
  return json({ erro: 'Rota não encontrada' }, 404)
}
