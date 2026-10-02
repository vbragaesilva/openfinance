// Mostra as últimas chamadas feitas pelos atalhos do iPhone, com o corpo exato recebido.
//   npm run db:log-atalhos          -> últimas 10
//   npm run db:log-atalhos -- 30    -> últimas 30
import { cliente } from './cliente.ts'

const n = Number(process.argv[2]) || 10
const db = cliente()
const rs = await db.execute({ sql: 'SELECT * FROM log_atalhos ORDER BY id DESC LIMIT ?', args: [n] })
for (const r of [...rs.rows].reverse()) {
  console.log(`\n#${r.id} ${r.recebida_em}  ${r.metodo} ${r.caminho} -> ${r.status}`)
  console.log(`  cabeçalhos: ${r.cabecalhos}`)
  console.log(`  corpo:      ${r.corpo}`)
  console.log(`  resposta:   ${r.resposta}`)
}
if (rs.rows.length === 0) console.log('Nenhuma chamada de atalho registrada ainda.')
db.close()
