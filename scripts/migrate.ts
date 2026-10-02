// Cria as tabelas que ainda não existem. Uso: npm run db:migrate
import { cliente, migrar } from './cliente.ts'

const db = cliente()
await migrar(db)
console.log('Schema aplicado.')
db.close()
