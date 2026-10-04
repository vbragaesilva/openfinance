// Compra parcelada, no mesmo padrão que a planilha usava: uma linha por parcela,
// a 1ª na data da compra e as seguintes no dia de fechamento da plataforma de cada mês seguinte
// (dia 1º quando a plataforma segue o mês do calendário), para cada parcela cair num mês.
// O centavo que sobra da divisão vai na 1ª parcela (ex.: 199,00 em 3x = 66,34 + 66,33 + 66,33).
import { mesDaCompra } from './painel.ts'

export interface Parcela {
  data: string
  valor_centavos: number
}

export function gerarParcelas(dataCompra: string, totalCentavos: number, n: number, fechamento = 1): Parcela[] {
  const base = Math.trunc(totalCentavos / n)
  const resto = totalCentavos - base * n
  const mesCompra = mesDaCompra(dataCompra, fechamento)
  const ano = Number(mesCompra.slice(0, 4))
  const mes = Number(mesCompra.slice(5, 7)) - 1
  const dia = String(fechamento).padStart(2, '0')
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return { data: dataCompra, valor_centavos: base + resto }
    const idx = ano * 12 + mes + i
    const data = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-${dia}`
    return { data, valor_centavos: base }
  })
}
