// Mostra as notificações do Nubank capturadas pelo atalho do iPhone.
//   npm run db:nubank          -> últimas 20
//   npm run db:nubank -- 100   -> últimas 100
import { cliente } from './cliente.ts'

const n = Number(process.argv[2]) || 20
const db = cliente()
const rs = await db.execute({ sql: 'SELECT * FROM notificacoes_nubank ORDER BY id DESC LIMIT ?', args: [n] })
for (const r of [...rs.rows].reverse()) {
  console.log(`\n#${r.id} ${r.recebida_em} [${r.status}]`)
  console.log(`  título:    ${r.titulo}`)
  console.log(`  subtítulo: ${r.subtitulo}`)
  console.log(`  mensagem:  ${r.mensagem}`)
  console.log(`  corpo:     ${r.corpo}`)
}
if (rs.rows.length === 0) console.log('Nenhuma notificação do Nubank capturada ainda.')
db.close()
