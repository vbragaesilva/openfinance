// Limpeza única dos nomes em lancamentos.local e lancamentos.produto (ver src/lib/padronizar.ts).
//
//   npm run db:padronizar -- --plano saida.json                 -> só calcula e grava o plano (não mexe no banco)
//   npm run db:padronizar -- --extras extras.json --plano ...   -> inclui junções aprovadas à mão
//   npm run db:padronizar -- --extras extras.json --aplicar     -> aplica e grava backups/padronizacao-desfazer-*.json
//   npm run db:padronizar -- --desfazer backups/padronizacao-desfazer-X.json
//
// extras.json (fica fora do git, o repositório é público): junções de nomes parecidos que o usuário aprovou,
//   [{ "campo": "local", "de": ["Mosca"], "para": "Moska" }, ...]
// "para" pode ser qualquer variação do grupo de destino: o nome final é a forma canônica do grupo já juntado.
import fs from 'node:fs'
import { cliente } from './cliente.ts'
import { chave, formaCanonica, parecidos, type Campo } from '../src/lib/padronizar.ts'

const args = process.argv.slice(2)
const opcao = (nome: string) => {
  const i = args.indexOf(nome)
  return i >= 0 ? args[i + 1] : undefined
}
const db = cliente()

const desfazer = opcao('--desfazer')
if (desfazer) {
  const linhas: [id: number, campo: Campo, antigo: string][] = JSON.parse(fs.readFileSync(desfazer, 'utf8'))
  await db.batch(linhas.map(([id, campo, antigo]) => ({ sql: `UPDATE lancamentos SET ${campo} = ? WHERE id = ?`, args: [antigo, id] })), 'write')
  console.log(`${linhas.length} valores restaurados.`)
  process.exit(0)
}

type Extra = { campo: Campo; de: string[]; para: string }
const extras: Extra[] = opcao('--extras') ? JSON.parse(fs.readFileSync(opcao('--extras')!, 'utf8')) : []

const lancs = (await db.execute('SELECT id, local, produto FROM lancamentos')).rows.map((r) => ({
  id: Number(r.id),
  local: String(r.local ?? ''),
  produto: String(r.produto ?? ''),
}))

export interface Mudanca {
  campo: Campo
  de: string
  para: string
  linhas: number
  motivo: 'mesmo nome' | 'aprovado'
}
const plano: { mudancas: Mudanca[]; sugestoes: { campo: Campo; a: string; b: string }[]; ids: [number, Campo, string, string][] } = {
  mudancas: [],
  sugestoes: [],
  ids: [],
}

for (const campo of ['local', 'produto'] as const) {
  const usos = new Map<string, number>()
  for (const l of lancs) if (l[campo].trim()) usos.set(l[campo], (usos.get(l[campo]) ?? 0) + 1)
  // Junções aprovadas: tratam a chave de origem como se fosse a do destino.
  const redireciona = new Map<string, string>()
  for (const e of extras.filter((x) => x.campo === campo)) for (const de of e.de) redireciona.set(chave(de), chave(e.para))
  const chaveFinal = (t: string) => redireciona.get(chave(t)) ?? chave(t)
  const porChave = new Map<string, Map<string, number>>()
  for (const [t, n] of usos) {
    const k = chaveFinal(t)
    if (!porChave.has(k)) porChave.set(k, new Map())
    porChave.get(k)!.set(t, n)
  }
  // Canônica de cada grupo (já com as junções aprovadas).
  const canonica = new Map<string, string>()
  // Direto sobre o grupo (agrupar() separaria de novo as junções aprovadas, que têm chaves diferentes).
  for (const [k, variantes] of porChave) canonica.set(k, formaCanonica([...variantes.entries()], campo))
  for (const [k, variantes] of porChave) {
    for (const [t, n] of variantes) {
      const para = canonica.get(k)!
      if (t === para) continue
      plano.mudancas.push({ campo, de: t, para, linhas: n, motivo: redireciona.has(chave(t)) ? 'aprovado' : 'mesmo nome' })
    }
  }
  for (const l of lancs) {
    const atual = l[campo]
    if (!atual.trim()) continue
    const para = canonica.get(chaveFinal(atual))!
    if (para !== atual) plano.ids.push([l.id, campo, atual, para])
  }
  // Parecidos que continuam separados: só sugestões (decisão do usuário).
  const finais = [...new Set(canonica.values())]
  for (let i = 0; i < finais.length; i++)
    for (let j = i + 1; j < finais.length; j++) if (parecidos(finais[i], finais[j])) plano.sugestoes.push({ campo, a: finais[i], b: finais[j] })
}

const saida = opcao('--plano')
if (saida) fs.writeFileSync(saida, JSON.stringify(plano, null, 1))
const porCampo = (c: Campo) => plano.ids.filter(([, campo]) => campo === c).length
console.log(`Plano: ${plano.mudancas.length} nomes trocados em ${plano.ids.length} valores (local: ${porCampo('local')}, produto: ${porCampo('produto')}); ${plano.sugestoes.length} parecidos só sugeridos.`)

if (args.includes('--aplicar')) {
  const arquivo = `backups/padronizacao-desfazer-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  fs.mkdirSync('backups', { recursive: true })
  fs.writeFileSync(arquivo, JSON.stringify(plano.ids.map(([id, campo, antigo]) => [id, campo, antigo])))
  // Só troca se o valor ainda for o antigo (se alguém editou no meio, deixa como está).
  await db.batch(
    plano.ids.map(([id, campo, antigo, para]) => ({ sql: `UPDATE lancamentos SET ${campo} = ? WHERE id = ? AND ${campo} = ?`, args: [para, id, antigo] })),
    'write',
  )
  console.log(`Aplicado. Para desfazer: npm run db:padronizar -- --desfazer ${arquivo}`)
}
db.close()
