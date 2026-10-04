// Importa os dados da planilha GASTOS.xlsx para o banco.
//
//   npm run db:import                      -> lê ./GASTOS.xlsx
//   npm run db:import -- caminho.xlsx
//   npm run db:import -- --substituir      -> apaga o que já existe no banco antes de importar
//
// Só lê as abas de entrada (Respostas, Split, FIXOS e o Caixa Atual do PAINEL). CRÉDITO, DÉBITO e o
// resto do PAINEL eram fórmulas sobre essas abas e são recalculados pelo app. Consumo moto, Invest e
// Cashback ainda não foram migradas.
import ExcelJS from 'exceljs'
import type { InStatement } from '@libsql/client'
import { cliente, migrar } from './cliente.ts'

const args = process.argv.slice(2)
const substituir = args.includes('--substituir')
const arquivo = args.find((a) => !a.startsWith('--')) ?? 'GASTOS.xlsx'
const ANO_PLANILHA = 2026 // a planilha fixava 2026 em todas as fórmulas DATE(2026, ...)

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(arquivo)

function aba(nome: string) {
  const ws = wb.getWorksheet(nome)
  if (!ws) throw new Error(`Aba "${nome}" não encontrada em ${arquivo}`)
  return ws
}

/** Valor "calculado" da célula: resolve fórmulas para o resultado salvo e rich text para texto. */
function val(ws: ExcelJS.Worksheet, ref: string): unknown {
  const v = ws.getCell(ref).value as unknown
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return (v as { result: unknown }).result
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('')
    if ('text' in v) return (v as { text: unknown }).text
  }
  return v
}

const pad = (n: number) => String(n).padStart(2, '0')
// O Excel guarda datas sem fuso; o exceljs as entrega como se fossem UTC.
const dataISO = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const dataHora = (d: Date) => `${dataISO(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`

function data(v: unknown): Date | null {
  return v instanceof Date ? v : null
}
function texto(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}
function textoOuNull(v: unknown): string | null {
  const t = texto(v)
  return t === '' ? null : t
}
function centavos(v: unknown, onde: string): number {
  if (typeof v !== 'number') throw new Error(`Valor não numérico em ${onde}: ${JSON.stringify(v)}`)
  return Math.round(v * 100)
}

const stmts: InStatement[] = []
const contagem: Record<string, number> = {}
const mesesComDados = new Set<string>()
function inserir(tabela: string, linha: Record<string, unknown>) {
  if (typeof linha.data === 'string') mesesComDados.add(linha.data.slice(0, 7))
  const cols = Object.keys(linha)
  stmts.push({
    sql: `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    args: cols.map((c) => linha[c] as string | number | null),
  })
  contagem[tabela] = (contagem[tabela] ?? 0) + 1
}

// Plataformas iniciais criadas por migrar(): 1 = Crédito Nubank, 2 = Débito, 3 = Splitwise.
const PLATAFORMA_DA_MODALIDADE: Record<string, number> = { 'Crédito': 1, 'Débito': 2 }
const SPLITWISE = 3

// --- Respostas -> lancamentos
{
  const ws = aba('Respostas')
  for (let r = 2; r <= ws.rowCount; r++) {
    const carimbo = data(val(ws, `A${r}`))
    if (!carimbo) continue // linha vazia
    const d = data(val(ws, `B${r}`))
    if (!d) throw new Error(`Respostas!B${r} sem data`)
    const modalidade = texto(val(ws, `G${r}`))
    const plataforma_id = PLATAFORMA_DA_MODALIDADE[modalidade]
    if (!plataforma_id) throw new Error(`Respostas!G${r}: modalidade desconhecida "${modalidade}"`)
    inserir('lancamentos', {
      criado_em: dataHora(carimbo),
      data: dataISO(d),
      produto: texto(val(ws, `C${r}`)),
      local: texto(val(ws, `D${r}`)),
      valor_centavos: centavos(val(ws, `E${r}`), `Respostas!E${r}`),
      categoria: textoOuNull(val(ws, `F${r}`)),
      plataforma_id,
      tipo: textoOuNull(val(ws, `H${r}`)),
    })
  }
}

// --- Split -> lancamentos na plataforma Splitwise
{
  const ws = aba('Split')
  for (let r = 2; r <= ws.rowCount; r++) {
    const carimbo = data(val(ws, `A${r}`))
    if (!carimbo) continue
    const d = data(val(ws, `B${r}`))
    if (!d) throw new Error(`Split!B${r} sem data`)
    inserir('lancamentos', {
      criado_em: dataHora(carimbo),
      data: dataISO(d),
      produto: texto(val(ws, `C${r}`)),
      valor_centavos: centavos(val(ws, `D${r}`), `Split!D${r}`),
      plataforma_id: SPLITWISE,
      tipo: textoOuNull(val(ws, `E${r}`)),
    })
  }
}

// --- FIXOS (tabela "Fixos" em C3:D10 + coluna "Pago" em A; salário em F2)
// A planilha só tem os valores de hoje, usados em todos os meses. Eles entram valendo desde o
// primeiro mês com lançamento; mudanças futuras ganham vigência própria no app.
const primeiroMes = [...mesesComDados].sort()[0]

/** Meses AAAA-MM de `de` (inclusive) até `ate` (exclusive). */
function mesesEntre(de: string, ate: string): string[] {
  const meses: string[] = []
  let [a, m] = de.split('-').map(Number)
  while (`${a}-${pad(m)}` < ate) {
    meses.push(`${a}-${pad(m)}`)
    if (++m > 12) [a, m] = [a + 1, 1]
  }
  return meses
}
const salario = centavos(val(aba('FIXOS'), 'F2'), 'FIXOS!F2')
stmts.push({ sql: 'INSERT INTO salarios (desde, valor_centavos) VALUES (?, ?)', args: [primeiroMes, salario] })
{
  const ws = aba('FIXOS')
  const ultimoFixo = '(SELECT MAX(id) FROM fixos)'
  for (let r = 3; r <= 10; r++) {
    const nome = texto(val(ws, `C${r}`))
    if (!nome) continue
    stmts.push(
      {
        sql: 'INSERT INTO fixos (nome, investimento, ordem, inicio) VALUES (?, ?, ?, ?)',
        // O PAINEL usava FIXOS!$D$10 como "valor do invest" no Invest. Proj.
        args: [nome, r === 10 ? 1 : 0, r, primeiroMes],
      },
      {
        sql: `INSERT INTO fixos_valores (fixo_id, desde, valor_centavos) VALUES (${ultimoFixo}, ?, ?)`,
        args: [primeiroMes, centavos(val(ws, `D${r}`), `FIXOS!D${r}`)],
      },
    )
    const pago = data(val(ws, `A${r}`))
    if (pago) {
      // A planilha só guarda o último pagamento. Os meses anteriores a ele, desde o primeiro mês,
      // entram como pagos no dia 6 (combinado com o usuário).
      const pagamentos = mesesEntre(primeiroMes, dataISO(pago).slice(0, 7)).map((m) => `${m}-06`)
      pagamentos.push(dataISO(pago))
      for (const p of pagamentos) {
        stmts.push({ sql: `INSERT INTO fixos_pagamentos (fixo_id, data) VALUES (${ultimoFixo}, ?)`, args: [p] })
      }
    }
    contagem.fixos = (contagem.fixos ?? 0) + 1
  }
}

// --- PAINEL: "Caixa Atual" digitado à mão em cada bloco de mês
const caixas: { ano: number; mes: number; valor_centavos: number }[] = []
{
  const ws = aba('PAINEL')
  // [célula do número do mês, célula do Caixa Atual] — a posição mudou entre as versões do bloco.
  const blocos = [
    ['C1', 'D5'], ['H1', 'I5'], ['M1', 'M5'], ['R1', 'R5'], ['W1', 'W5'],
    ['AB1', 'AB5'], ['AG1', 'AG5'], ['AL1', 'AL5'], ['AQ1', 'AQ5'],
  ]
  for (const [refMes, refCaixa] of blocos) {
    const mes = val(ws, refMes)
    const caixa = val(ws, refCaixa)
    if (typeof mes !== 'number' || caixa == null || caixa === '') continue
    caixas.push({ ano: ANO_PLANILHA, mes, valor_centavos: centavos(caixa, `PAINEL!${refCaixa}`) })
  }
}

// --- grava
const db = cliente()
await migrar(db)

const tabelas = ['lancamentos', 'salarios', 'fixos', 'fixos_valores', 'fixos_pagamentos', 'caixa_mensal']
if (!substituir) {
  const rs = await db.batch(tabelas.map((t) => `SELECT COUNT(*) AS n FROM ${t}`), 'read')
  const ocupadas = tabelas.filter((_, i) => Number(rs[i].rows[0].n) > 0)
  if (ocupadas.length) {
    console.error(`O banco já tem dados em: ${ocupadas.join(', ')}.`)
    console.error('Rode com --substituir para apagar e importar de novo.')
    process.exit(1)
  }
}

await db.batch(
  [
    ...(substituir ? tabelas.map((t) => `DELETE FROM ${t}`) : []),
    ...stmts,
    ...caixas.map((c) => ({
      sql: 'INSERT INTO caixa_mensal (ano, mes, valor_centavos) VALUES (?, ?, ?)',
      args: [c.ano, c.mes, c.valor_centavos],
    })),
  ],
  'write',
)

console.log('Importado:', { ...contagem, caixa_mensal: caixas.length, salario_centavos: salario, desde: primeiroMes })
db.close()
