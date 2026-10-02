// Lê uma notificação do Splitwise (repassada pelo atalho do iPhone) e decide o split.
// Formatos combinados com o usuário:
//   "Você deve BRL 16,25"              -> split positivo (gasto)
//   "Você recebeu de volta BRL 20,00"  -> split negativo (vou receber)
import { lerValor } from './formato.ts'
import type { Tipo } from './tipos.ts'

export interface Notificacao {
  titulo?: string
  subtitulo?: string
  mensagem?: string
}

export type Leitura =
  | { tipo: 'split'; valor_centavos: number; nome: string; fixo: Tipo }
  | { tipo: 'ignorada' | 'revisar'; motivo: string; valor_centavos?: number; nome?: string; fixo?: Tipo }

/**
 * Despesas do Splitwise que já estão nos fixos (combinado com o usuário): todo mês a internet
 * entra como "Net" e a faxineira como "Sol". Compara o nome inteiro, então "Netflix" não casa.
 */
const NOMES_FIXOS = ['net', 'sol']
export const fixoPeloNome = (nome: string): Tipo => (NOMES_FIXOS.includes(nome.trim().toLowerCase()) ? 'Fixo' : 'Variável')

const VALOR = String.raw`(?:BRL|R\$)\s*([\d.]+(?:,\d{1,2})?)`
const DEVE = new RegExp(String.raw`voc[eê]\s+deve\s*:?\s*${VALOR}`, 'i')
const RECEBE = new RegExp(String.raw`voc[eê]\s+(?:recebeu|recebe|vai\s+receber)\s+de\s+volta\s*:?\s*${VALOR}`, 'i')
const EDICAO = /\b(atualizou|editou|alterou|excluiu|apagou|removeu|deletou|restaurou)\b/i

/**
 * Nome da despesa. Formato real visto em 2026-10-01:
 *   título "Ah crlh… (BRL 0,01)" · subtítulo "Adicionado por José M. em “Maiu”" (Maiu = grupo)
 * Então: o título sem o "(BRL ...)" do final; se não houver título útil, o texto sem a frase do valor.
 */
function nomeDaDespesa(n: Notificacao) {
  const titulo = (n.titulo ?? '').replace(/\s*\((?:BRL|R\$)\s*-?[\d.,]+\)\s*$/i, '').trim()
  if (titulo && !/^splitwise$/i.test(titulo)) return titulo
  const semTitulo = [n.subtitulo, n.mensagem].filter(Boolean).join('\n')
  const resto = semTitulo.replace(DEVE, '').replace(RECEBE, '').replace(/\s+/g, ' ').replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, '')
  return resto || 'Splitwise'
}

export function lerNotificacao(n: Notificacao): Leitura {
  const texto = [n.titulo, n.subtitulo, n.mensagem].filter(Boolean).join('\n')
  const deve = texto.match(DEVE)
  const recebe = texto.match(RECEBE)
  const m = deve ?? recebe
  if (!m) return { tipo: 'ignorada', motivo: 'sem "Você deve" nem "recebeu de volta"' }
  const centavos = lerValor(m[1])
  if (centavos == null) return { tipo: 'revisar', motivo: `valor ilegível: ${m[1]}` }
  const valor_centavos = deve ? centavos : -centavos
  const nome = nomeDaDespesa(n)
  const fixo = fixoPeloNome(nome)
  if (EDICAO.test(texto)) return { tipo: 'revisar', motivo: 'parece edição/exclusão de despesa', valor_centavos, nome, fixo }
  return { tipo: 'split', valor_centavos, nome, fixo }
}
