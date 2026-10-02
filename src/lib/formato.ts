const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export const nomeMes = (mes: number) => MESES[mes - 1]
export const mesCurto = (mes: number) => MESES[mes - 1].slice(0, 3).toLowerCase()

/** Centavos -> "R$ 1.234,56". Normaliza -0 para 0. */
export function brl(centavos: number, opts: { sinal?: boolean } = {}) {
  const v = Math.round(centavos) / 100 || 0
  const s = fmtBRL.format(v)
  return opts.sinal && v > 0 ? `+${s}` : s
}

/** "16,50", "16.5", "1.234,56", "R$ 20" -> centavos. null se inválido. */
export function lerValor(texto: string): number | null {
  let t = texto.replace(/R\$|\s/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (!/^-?\d*(\.\d{0,2})?$/.test(t) || t === '-' || t === '.') return null
  return Math.round(Number(t) * 100)
}

/** Centavos -> texto editável "16,50" (sem sinal). */
export const valorParaCampo = (centavos: number) => (Math.abs(centavos) / 100).toFixed(2).replace('.', ',')

export function hojeISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export function dataComSemana(iso: string) {
  const [a, m, d] = iso.split('-').map(Number)
  const dt = new Date(a, m - 1, d)
  const s = `${DIAS_SEMANA[dt.getDay()]}, ${d} de ${mesCurto(m)}`
  return s[0].toUpperCase() + s.slice(1)
}

/** Normaliza para busca: minúsculas e sem acento. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
