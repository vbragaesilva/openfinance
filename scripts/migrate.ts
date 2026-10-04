// Cria as tabelas que ainda não existem e converte um banco de antes das plataformas.
// Uso: npm run db:migrate
import { cliente, migrar } from './cliente.ts'

const db = cliente()
const resultado = await migrar(db)
console.log(
  resultado === 'convertido'
    ? 'Banco convertido para plataformas (backup em lancamentos_antigo e split_antigo).'
    : resultado === 'criado'
      ? 'Schema criado, com as plataformas iniciais.'
      : 'Schema em dia.',
)
db.close()
