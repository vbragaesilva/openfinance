import type { InStatement, Row } from '@libsql/client/web'
import { db } from './db.ts'
import { cookieLogout, login, modoAuth, sessaoValida, tokenApiValido } from './auth.ts'
import { brl, lerValor } from '../src/lib/formato.ts'
import { lerNotificacao } from '../src/lib/splitwise.ts'
import type { Dados, Recurso } from '../src/lib/tipos.ts'

type Campo =
  | { t: 'texto'; opcional?: boolean }
  | { t: 'data'; opcional?: boolean }
  | { t: 'mes'; opcional?: boolean }
  | { t: 'datahora' }
  | { t: 'inteiro' }
  | { t: 'bool' }
  | { t: 'enum'; valores: string[]; opcional?: boolean }

const TIPO: Campo = { t: 'enum', valores: ['Variável', 'Fixo'], opcional: true }

const RECURSOS: Record<Recurso, { ordem: string; campos: Record<string, Campo> }> = {
  lancamentos: {
    ordem: 'data, criado_em, id',
    campos: {
      criado_em: { t: 'datahora' },
      data: { t: 'data' },
      produto: { t: 'texto' },
      local: { t: 'texto' },
      valor_centavos: { t: 'inteiro' },
      categoria: { t: 'texto', opcional: true },
      modalidade: { t: 'enum', valores: ['Crédito', 'Débito'] },
      tipo: TIPO,
    },
  },
  split: {
    ordem: 'data, criado_em, id',
    campos: {
      criado_em: { t: 'datahora' },
      data: { t: 'data' },
      nome: { t: 'texto' },
      valor_centavos: { t: 'inteiro' },
      fixo: TIPO,
    },
  },
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
 * Deixa um lançamento/split vindo dos Atalhos do iPhone no formato da API. O app já manda tudo
 * certinho; isto só completa o que o atalho não tem como mandar fácil:
 *  - `valor` como no iPhone ("R$ 16,50", "16.5", -5.9) em vez de `valor_centavos`;
 *  - `data` ausente = hoje;
 *  - "credito"/"debito"/"fixo"/"variavel" sem acento ou em minúsculas;
 *  - tipo/fixo ausente = Variável (ausente, não `null`: o app usa `null` para "sem tipo").
 */
function normalizarEntrada(recurso: Recurso, item: unknown): unknown {
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
  const campoTipo = recurso === 'lancamentos' ? 'tipo' : 'fixo'
  if (o[campoTipo] === undefined) o[campoTipo] = 'Variável'
  else if (typeof o[campoTipo] === 'string') {
    const t = semAcento(o[campoTipo] as string)
    if (t === 'fixo') o[campoTipo] = 'Fixo'
    else if (t === 'variavel') o[campoTipo] = 'Variável'
  }
  if (recurso === 'lancamentos' && typeof o.modalidade === 'string') {
    const m = semAcento(o.modalidade)
    if (m === 'credito') o.modalidade = 'Crédito'
    else if (m === 'debito') o.modalidade = 'Débito'
  }
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

function linhaParaInsert(recurso: Recurso, corpo: unknown): InStatement {
  if (!corpo || typeof corpo !== 'object') throw new ErroHttp(400, 'Corpo inválido')
  const campos = RECURSOS[recurso].campos
  const obj = corpo as Record<string, unknown>
  const nomes = Object.keys(campos)
  const args = nomes.map((n) => validar(n, campos[n], obj[n]))
  return {
    sql: `INSERT INTO ${recurso} (${nomes.join(', ')}) VALUES (${nomes.map(() => '?').join(', ')})`,
    args,
  }
}

function linhaParaUpdate(recurso: Recurso, id: number, corpo: unknown): InStatement {
  if (!corpo || typeof corpo !== 'object') throw new ErroHttp(400, 'Corpo inválido')
  const campos = RECURSOS[recurso].campos
  const obj = corpo as Record<string, unknown>
  const nomes = Object.keys(obj).filter((n) => n in campos)
  if (nomes.length === 0) throw new ErroHttp(400, 'Nada para atualizar')
  const args = nomes.map((n) => validar(n, campos[n], obj[n]))
  return { sql: `UPDATE ${recurso} SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`, args: [...args, id] }
}

function paraObjeto(row: Row): Record<string, unknown> {
  const o: Record<string, unknown> = { ...row }
  for (const k of Object.keys(o)) if (typeof o[k] === 'bigint') o[k] = Number(o[k])
  return o
}

async function carregarDados(): Promise<Dados> {
  const [lancamentos, split, fixos, valores, pagamentos, salarios, caixa, notificacoes] = await db().batch(
    [
      `SELECT * FROM lancamentos ORDER BY ${RECURSOS.lancamentos.ordem}`,
      `SELECT * FROM split ORDER BY ${RECURSOS.split.ordem}`,
      'SELECT * FROM fixos ORDER BY ordem, id',
      'SELECT * FROM fixos_valores ORDER BY fixo_id, desde',
      'SELECT * FROM fixos_pagamentos ORDER BY fixo_id, data, id',
      'SELECT * FROM salarios ORDER BY desde',
      'SELECT * FROM caixa_mensal ORDER BY ano, mes',
      `SELECT id, recebida_em, titulo, subtitulo, mensagem, status, motivo FROM notificacoes
       WHERE status IN ('ignorada', 'revisar') ORDER BY id DESC LIMIT 50`,
    ],
    'read',
  )
  const linhas = <T,>(rs: { rows: Row[] }) => rs.rows.map(paraObjeto) as T[]
  const vals = linhas<{ fixo_id: number; desde: string; valor_centavos: number }>(valores)
  const pags = linhas<{ fixo_id: number; id: number; data: string }>(pagamentos)
  return {
    lancamentos: linhas(lancamentos),
    split: linhas(split),
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

export async function handle(req: Request): Promise<Response> {
  const caminho = new URL(req.url).pathname
  const via = req.headers.get('authorization') ? 'token' : req.headers.get('cookie') ? 'cookie' : 'sem auth'
  // Corpo exato de tudo que não vem da tela do app (atalhos, com ou sem chave), para depurar.
  const deFora = via !== 'cookie' && req.method !== 'GET'
  const corpoAtalho = deFora ? await req.clone().text().catch(() => null) : null

  let resposta: Response
  try {
    resposta = await rotear(req)
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

async function rotear(req: Request): Promise<Response> {
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

  if (!(await sessaoValida(req))) return json({ erro: 'Não autenticado' }, 401)

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

  // Notificação do Splitwise vinda do atalho do iPhone: guarda crua e, se entender, cria o split.
  if (partes[0] === 'split' && partes[1] === 'notificacao' && metodo === 'POST') {
    const c = (await corpoJson(req)) as Record<string, unknown>
    const texto = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : c[k] == null ? '' : String(c[k]))
    const n = { titulo: texto('titulo'), subtitulo: texto('subtitulo'), mensagem: texto('mensagem') }
    const leitura = lerNotificacao(n)
    const agora = agoraSP()
    const registro = (status: string, motivo: string | null, comSplit: boolean): InStatement => ({
      sql: `INSERT INTO notificacoes (recebida_em, titulo, subtitulo, mensagem, status, motivo, split_id)
            VALUES (?, ?, ?, ?, ?, ?, ${comSplit ? 'last_insert_rowid()' : 'NULL'})`,
      args: [agora, n.titulo, n.subtitulo, n.mensagem, status, motivo],
    })
    if (leitura.tipo === 'split') {
      const data = agora.slice(0, 10)
      await db().batch(
        [
          {
            sql: `INSERT INTO split (criado_em, data, nome, valor_centavos, fixo) VALUES (?, ?, ?, ?, 'Variável')`,
            args: [agora, data, leitura.nome, leitura.valor_centavos],
          },
          registro('split', null, true),
        ],
        'write',
      )
      return json(
        { mensagem: `Split lançado: ${brl(leitura.valor_centavos)} · ${leitura.nome} · ${data.split('-').reverse().join('/')}` },
        201,
      )
    }
    await db().execute(registro(leitura.tipo, leitura.motivo, false))
    return json({ mensagem: `Notificação do Splitwise guardada, sem virar split (${leitura.motivo}).` }, 202)
  }

  // Notificação revisada na tela Split: 'resolvida' (virou split à mão) ou 'descartada'.
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

  const recurso = partes[0] as Recurso
  if (recurso in RECURSOS) {
    if (partes.length === 1 && metodo === 'POST') {
      const corpo = await corpoJson(req)
      const itens = (Array.isArray(corpo) ? corpo : [corpo]).map((i) => normalizarEntrada(recurso, i))
      if (itens.length === 0 || itens.length > 60) throw new ErroHttp(400, 'Envie de 1 a 60 itens')
      const rs = await db().batch(
        itens.map((i) => linhaParaInsert(recurso, i)),
        'write',
      )
      // `mensagem` é para o atalho mostrar no iPhone.
      const primeiro = itens[0] as Record<string, unknown>
      const descricao = recurso === 'lancamentos' ? `${primeiro.produto || primeiro.local || ''} (${primeiro.modalidade})` : String(primeiro.nome ?? '')
      return json(
        {
          ids: rs.map((r) => Number(r.lastInsertRowid)),
          mensagem: `${recurso === 'split' ? 'Split lançado' : 'Lançado'}: ${brl(Number(primeiro.valor_centavos))} · ${descricao.trim()} · ${String(primeiro.data).split('-').reverse().join('/')}`,
        },
        201,
      )
    }
    const id = Number(partes[1])
    if (partes.length === 2 && Number.isInteger(id)) {
      if (metodo === 'PUT') {
        const rs = await db().execute(linhaParaUpdate(recurso, id, await corpoJson(req)))
        if (rs.rowsAffected === 0) throw new ErroHttp(404, 'Não encontrado')
        return json({ ok: true })
      }
      if (metodo === 'DELETE') {
        const rs = await db().execute({ sql: `DELETE FROM ${recurso} WHERE id = ?`, args: [id] })
        if (rs.rowsAffected === 0) throw new ErroHttp(404, 'Não encontrado')
        return json({ ok: true })
      }
    }
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
