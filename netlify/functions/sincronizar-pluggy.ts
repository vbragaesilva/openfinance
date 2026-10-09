import type { Config } from '@netlify/functions'
import { sincronizarPluggy } from '../../server/pluggy.ts'

// Rede de segurança do webhook da Pluggy: sincroniza a cada 4 horas mesmo se algum aviso se perder.
// (O Meu Pluggy só atualiza os dados do banco cerca de uma vez por dia; isto não acelera essa atualização.)
export default async () => {
  const resumo = await sincronizarPluggy()
  console.log(`Pluggy (agendada): ${JSON.stringify(resumo)}`)
}

export const config: Config = {
  schedule: '0 */4 * * *',
}
