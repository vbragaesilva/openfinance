// Compara as despesas do Splitwise (lidas do Splitwise web pelo api-anything, com a sessão do Chrome) com os
// lançamentos da plataforma Splitwise e mostra o que falta. Usado pela skill sincronizar-splitwise.
// Regras em src/lib/splitwise-despesas.ts. Sem --gravar não grava nada.
//
//   npm run splitwise:sincronizar                         -> relatório (o que falta, pares, saldo)
//   npm run splitwise:sincronizar -- --gravar --lancar 1,2 -> lança as despesas 1 e 2, guarda os pares automáticos
//   ... --ligar 3=380,4=380   liga a despesa 3 (e a 4) ao lançamento 380, sem lançar
//   ... --ignorar 5           marca a despesa 5 como ignorada (não aparece mais)
//   ... --tipo 1=Fixo         muda o tipo de uma despesa lançada (o padrão vem do nome: Net/Claro/Sol = Fixo)
//   ... --desde 2026-10-11    início da janela (padrão: INICIO)
//
// A janela vale pela criação: só despesas criadas no Splitwise a partir do início, e do lado do banco só
// lançamentos com criado_em a partir dele. Combinado com o usuário: o banco está certo até 11/10/2026.
//
// Precisa do api-anything instalado e logado (api-anything login splitwise.com) com as operações de
// integracoes/splitwise.api-anything.json. Usa o banco do .env (hoje, o Turso de produção).
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import type { InStatement } from '@libsql/client'
import { cliente } from './cliente.ts'
import { conferirSaldo, criadaAntes, lerDespesa, parearDespesas, type DespesaSplitwise, type LeituraDespesa } from '../src/lib/splitwise-despesas.ts'
import type { Tipo } from '../src/lib/tipos.ts'

const INICIO = '2026-10-11'

const { values: op } = parseArgs({
  options: {
    gravar: { type: 'boolean', default: false },
    lancar: { type: 'string', default: '' },
    ligar: { type: 'string', default: '' },
    ignorar: { type: 'string', default: '' },
    tipo: { type: 'string', default: '' },
    desde: { type: 'string', default: INICIO },
  },
})
const lista = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const pares = (s: string) => new Map(lista(s).map((x) => x.split('=').map((y) => y.trim()) as [string, string]))
const paraLancar = new Set(lista(op.lancar))
const paraLigar = pares(op.ligar)
const paraIgnorar = new Set(lista(op.ignorar))
const tipos = pares(op.tipo)
for (const t of tipos.values()) if (t !== 'Fixo' && t !== 'Variável') throw new Error(`--tipo aceita Fixo ou Variável, não "${t}"`)

function splitwise(operacao: string, ...args: string[]): any {
  let saida: string
  try {
    saida = execFileSync('api-anything', ['call', 'splitwise', operacao, ...args], { encoding: 'utf8', maxBuffer: 1e8 })
  } catch (e) {
    saida = String((e as { stdout?: string }).stdout ?? '') || String((e as Error).message)
  }
  const r = JSON.parse(saida.split('\n')[0] || '{}')
  if (!r.ok) {
    const dica = r.class === 'auth' ? ' Rode no terminal: api-anything login splitwise.com' : ''
    throw new Error(`Splitwise (${operacao}): ${r.class ?? 'erro'} — ${r.reason ?? saida.slice(0, 300)}.${dica}`)
  }
  if (r.truncated) throw new Error(`Splitwise (${operacao}): resposta cortada (${r.truncated})`)
  return r.data
}

// 1. Splitwise: quem sou eu, todas as despesas (de 40 em 40) e o saldo com cada amigo.
const eu = Number(splitwise('eu').id)
const despesas: DespesaSplitwise[] = []
for (let offset = 0; ; offset += 40) {
  const pagina: DespesaSplitwise[] = splitwise('despesas', 'desde=2000-01-01', 'limite=40', `offset=${offset}`)
  despesas.push(...pagina)
  if (pagina.length < 40) break
}
const amigos: { nome: string; saldo: { currency_code: string; amount: string }[] }[] = splitwise('amigos')
const saldoSplitwise = amigos.reduce((s, a) => s + a.saldo.filter((b) => b.currency_code === 'BRL').reduce((t, b) => t + Math.round(Number(b.amount) * 100), 0), 0)

// 2. Banco: plataforma, o que já foi visto e os lançamentos do Splitwise na janela.
const db = cliente()
const plataforma = (await db.execute("SELECT id FROM plataformas WHERE integracao = 'splitwise'")).rows[0]
if (!plataforma) throw new Error('Nenhuma plataforma com integracao = splitwise')
// Sem a tabela (banco ainda não migrado) o relatório sai como se nada tivesse sido visto; gravar exige a tabela.
const semTabela = (e: unknown) => {
  if (!/no such table/i.test(String((e as Error).message))) throw e
  if (op.gravar) throw new Error('O banco ainda não tem a tabela splitwise_despesas: rode npm run db:migrate.')
  return { rows: [] }
}
const vistas = new Map(
  (await db.execute('SELECT id, valor_centavos, status, lancamento_id, atualizada_em FROM splitwise_despesas').catch(semTabela)).rows.map((r) => [String(r.id), r]),
)
const lancamentos = (
  await db.execute({
    sql: 'SELECT id, data, produto, valor_centavos FROM lancamentos WHERE plataforma_id = ? AND criado_em >= ? ORDER BY data, id',
    args: [Number(plataforma.id), op.desde],
  })
).rows.map((r) => ({ id: Number(r.id), data: String(r.data), produto: String(r.produto), valor_centavos: Number(r.valor_centavos) }))
const ligados = new Set([...vistas.values()].map((v) => Number(v.lancamento_id)).filter(Boolean))
const candidatos = lancamentos.filter((l) => !ligados.has(l.id) && ![...paraLigar.values()].includes(String(l.id)))

// 3. Decide cada despesa nova da janela.
type Plano = { d: DespesaSplitwise; leitura: LeituraDespesa }
const naJanela = despesas.map((d) => ({ d, leitura: lerDespesa(d, eu) })).filter((p) => !criadaAntes(p.d, op.desde))
const novas = naJanela.filter((p) => !vistas.has(String(p.d.id)))
const aLancar = novas.filter((p): p is Plano & { leitura: Extract<LeituraDespesa, { acao: 'lancar' }> } =>
  p.leitura.acao === 'lancar' && !paraLigar.has(String(p.d.id)) && !paraIgnorar.has(String(p.d.id)))
const parAuto = parearDespesas(aLancar.map((p) => p.leitura), candidatos)
const ligadasAuto = aLancar.map((p, i) => ({ ...p, l: parAuto[i] })).filter((p) => p.l)
const faltam = aLancar.filter((_, i) => !parAuto[i])
const revisar = novas.filter((p) => p.leitura.acao === 'revisar' && !paraIgnorar.has(String(p.d.id)))
const ignoradas = novas.filter((p) => p.leitura.acao === 'ignorar' || paraIgnorar.has(String(p.d.id)))
const usados = new Set([...ligadasAuto.map((p) => p.l!.id), ...[...paraLigar.values()].map(Number)])
const semPar = candidatos.filter((l) => !usados.has(l.id))

// Já vistas que mudaram no Splitwise (valor editado) ou sumiram (apagadas).
const porId = new Map(despesas.map((d) => [String(d.id), d]))
const mudaram = [...vistas.entries()].flatMap(([id, v]) => {
  if (v.status === 'ignorada') return []
  const d = porId.get(id)
  if (!d) return [`${id}: não aparece mais no Splitwise (apagada?) — lançamento ${v.lancamento_id}`]
  const agora = -Math.round(Number(d.saldos[d.usuarios.indexOf(eu)] ?? 0) * 100)
  return agora !== Number(v.valor_centavos) ? [`${id} "${d.descricao}": era ${brl(Number(v.valor_centavos))}, agora ${brl(agora)} — lançamento ${v.lancamento_id}`] : []
})

// 4. Relatório.
function brl(c: number) {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
const dm = (data: string) => data.split('-').reverse().join('/')
const linha = (p: Plano, extra = '') => `  ${p.d.id}  ${dm(p.leitura.data)}  ${brl(p.leitura.valor_centavos).padStart(11)}  ${p.d.descricao.trim()}${extra}`
const tipoDe = (p: Plano & { leitura: Extract<LeituraDespesa, { acao: 'lancar' }> }) => (tipos.get(String(p.d.id)) as Tipo | undefined) ?? p.leitura.tipo

console.log(`\nSplitwise, criadas desde ${dm(op.desde)}: ${naJanela.length} despesas, ${novas.length} ainda não vistas.\n`)
console.log(`FALTAM NO BANCO (${faltam.length}):`)
for (const p of faltam) console.log(linha(p, tipoDe(p) === 'Fixo' ? '  [Fixo]' : ''))
console.log(`\nJÁ LANÇADAS, LIGADAS POR VALOR E DATA (${ligadasAuto.length}):`)
for (const p of ligadasAuto) console.log(linha(p, `  ->  lançamento ${p.l!.id} (${dm(p.l!.data)} "${p.l!.produto}")`))
if (paraLigar.size) {
  console.log(`\nLIGADAS À MÃO (${paraLigar.size}):`)
  for (const [sw, l] of paraLigar) console.log(`  ${sw}  ->  lançamento ${l}`)
}
if (revisar.length) {
  console.log(`\nPARA REVISAR (${revisar.length}):`)
  for (const p of revisar) console.log(linha(p, `  (${(p.leitura as { motivo: string }).motivo})`))
}
console.log(`\nNO BANCO SEM DESPESA NO SPLITWISE (${semPar.length}):`)
for (const l of semPar) console.log(`  lançamento ${l.id}  ${dm(l.data)}  ${brl(l.valor_centavos).padStart(11)}  ${l.produto}`)
if (mudaram.length) {
  console.log(`\nMUDARAM NO SPLITWISE DEPOIS DE LIGADAS (${mudaram.length}) — o lançamento não foi mexido:`)
  for (const m of mudaram) console.log(`  ${m}`)
}
console.log(`\n(${ignoradas.length} ignoradas: pagamentos, despesas sem você ou com parte zero.)`)

// O saldo conta o que vai ser lançado agora, para mostrar se depois da gravação vai bater.
const splitsHoje = lancamentos.reduce((s, l) => s + l.valor_centavos, 0)
const aGravar = faltam.filter((p) => paraLancar.has(String(p.d.id))).reduce((s, p) => s + p.leitura.valor_centavos, 0)
const saldo = (splits: number) => conferirSaldo({ despesas, eu, inicio: op.desde, saldoSplitwise, splitsNoBanco: splits })
const s = saldo(splitsHoje)
console.log(`\nSALDO: Splitwise diz ${brl(s.saldoSplitwise)} (positivo = te devem).`)
console.log(`  saldo de antes de ${dm(op.desde)} ${brl(s.saldoAntes)} + pagamentos ${brl(s.pagamentos)} − splits no banco ${brl(s.splitsNoBanco)} = ${brl(s.esperado)}`)
console.log(`  ${s.diferenca === 0 ? 'Bate.' : `Diferença de ${brl(s.diferenca)}.`}${aGravar ? ` Depois de lançar as ${paraLancar.size} escolhidas: ${saldo(splitsHoje + aGravar).diferenca === 0 ? 'bate' : `diferença de ${brl(saldo(splitsHoje + aGravar).diferenca)}`}.` : ''}`)

if (!op.gravar) {
  if (faltam.length) console.log(`\nPara lançar tudo o que falta: npm run splitwise:sincronizar -- --gravar --lancar ${faltam.map((p) => p.d.id).join(',')}`)
  db.close()
  process.exit(0)
}

// 5. Gravação: uma transação por despesa, para uma falha não deixar lançamento sem registro.
const desconhecidas = [...paraLancar].filter((id) => !faltam.some((p) => String(p.d.id) === id))
if (desconhecidas.length) throw new Error(`--lancar com despesas que não estão em "faltam": ${desconhecidas.join(', ')}. Nada foi gravado.`)
const agora = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const registro = (p: Plano, status: string, motivo: string | null, lancamento: number | 'novo' | null): InStatement => ({
  sql: `INSERT INTO splitwise_despesas (id, data, descricao, valor_centavos, status, motivo, lancamento_id, atualizada_em, bruto, importada_em)
        VALUES (?, ?, ?, ?, ?, ?, ${lancamento === 'novo' ? 'last_insert_rowid()' : '?'}, ?, ?, ?)`,
  args: [String(p.d.id), p.leitura.data, p.d.descricao.trim(), p.leitura.valor_centavos, status, motivo, ...(lancamento === 'novo' ? [] : [lancamento]), p.d.atualizada, JSON.stringify(p.d), agora],
})
const lotes: InStatement[][] = [
  ...faltam.filter((p) => paraLancar.has(String(p.d.id))).map((p) => [
    {
      sql: `INSERT INTO lancamentos (criado_em, data, produto, local, valor_centavos, categoria, plataforma_id, tipo)
            VALUES (?, ?, ?, '', ?, NULL, ?, ?)`,
      args: [p.leitura.criado_em, p.leitura.data, p.leitura.nome, p.leitura.valor_centavos, Number(plataforma.id), tipoDe(p)],
    },
    registro(p, 'lancada', null, 'novo'),
  ]),
  ...ligadasAuto.map((p) => [registro(p, 'ja_existia', 'mesmo valor e data', p.l!.id)]),
  ...novas.filter((p) => paraLigar.has(String(p.d.id))).map((p) => [registro(p, 'ja_existia', 'ligada à mão', Number(paraLigar.get(String(p.d.id))))]),
  ...ignoradas.map((p) => [registro(p, 'ignorada', paraIgnorar.has(String(p.d.id)) ? 'ignorada à mão' : (p.leitura as { motivo: string }).motivo, null)]),
]
for (const lote of lotes) await db.batch(lote, 'write')
console.log(`\nGravado: ${paraLancar.size} lançadas, ${ligadasAuto.length + paraLigar.size} ligadas, ${ignoradas.length} ignoradas.`)
db.close()
