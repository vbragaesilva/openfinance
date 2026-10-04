// Notificações do Nubank capturadas pelo atalho do iPhone.
//   npm run db:nubank                     -> mostra as últimas 20
//   npm run db:nubank -- 100              -> mostra as últimas 100
//   npm run db:nubank -- --lancar         -> lança as compras guardadas antes do leitor existir
//                                            (status 'capturada' que hoje o leitor reconhece)
import { cliente } from './cliente.ts'
import { lerNotificacaoNubank } from '../src/lib/nubank.ts'

const args = process.argv.slice(2)
const db = cliente()

if (args.includes('--lancar')) {
  const plataformas = (await db.execute('SELECT id, nome, integracao FROM plataformas')).rows
  const cartao =
    plataformas.find((p) => p.integracao === 'nubank-credito') ??
    plataformas.find((p) => String(p.nome).toLowerCase() === 'crédito nubank')
  if (!cartao) throw new Error('Plataforma "Crédito Nubank" não encontrada.')
  const pendentes = (await db.execute("SELECT * FROM notificacoes_nubank WHERE status = 'capturada' ORDER BY id")).rows
  let lancadas = 0
  for (const r of pendentes) {
    const l = lerNotificacaoNubank({ titulo: String(r.titulo ?? ''), subtitulo: String(r.subtitulo ?? ''), mensagem: String(r.mensagem ?? '') })
    if (l.tipo !== 'credito') continue
    // Mesma data que teria se o leitor já existisse: o dia em que a notificação chegou.
    await db.batch(
      [
        {
          sql: `INSERT INTO lancamentos (criado_em, data, produto, local, valor_centavos, categoria, plataforma_id, tipo)
                VALUES (?, ?, '', ?, ?, NULL, ?, ?)`,
          args: [r.recebida_em, String(r.recebida_em).slice(0, 10), l.local, l.valor_centavos, cartao.id, l.fixo],
        },
        { sql: "UPDATE notificacoes_nubank SET status = 'lancada', lancamento_id = last_insert_rowid() WHERE id = ?", args: [r.id] },
      ],
      'write',
    )
    lancadas++
    console.log(`#${r.id} ${r.recebida_em}: lançado ${l.valor_centavos / 100} em ${l.local} (${l.fixo})`)
  }
  console.log(`${lancadas} compra(s) lançada(s) de ${pendentes.length} notificação(ões) pendente(s).`)
  db.close()
  process.exit(0)
}

const n = Number(args[0]) || 20
const rs = await db.execute({ sql: 'SELECT * FROM notificacoes_nubank ORDER BY id DESC LIMIT ?', args: [n] })
for (const r of [...rs.rows].reverse()) {
  console.log(`\n#${r.id} ${r.recebida_em} [${r.status}${r.lancamento_id ? ` → lançamento ${r.lancamento_id}` : ''}]`)
  console.log(`  título:    ${r.titulo}`)
  console.log(`  subtítulo: ${r.subtitulo}`)
  console.log(`  mensagem:  ${r.mensagem}`)
  console.log(`  corpo:     ${r.corpo}`)
}
if (rs.rows.length === 0) console.log('Nenhuma notificação do Nubank capturada ainda.')
db.close()
