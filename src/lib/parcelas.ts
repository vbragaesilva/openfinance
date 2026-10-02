// Compra parcelada, no mesmo padrão que a planilha usava: uma linha por parcela,
// a 1ª na data da compra e as seguintes no dia 1º de cada mês seguinte.
// O centavo que sobra da divisão vai na 1ª parcela (ex.: 199,00 em 3x = 66,34 + 66,33 + 66,33).

export interface Parcela {
  data: string
  valor_centavos: number
}

export function gerarParcelas(dataCompra: string, totalCentavos: number, n: number): Parcela[] {
  const base = Math.trunc(totalCentavos / n)
  const resto = totalCentavos - base * n
  const ano = Number(dataCompra.slice(0, 4))
  const mes = Number(dataCompra.slice(5, 7)) - 1
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return { data: dataCompra, valor_centavos: base + resto }
    const idx = ano * 12 + mes + i
    const data = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
    return { data, valor_centavos: base }
  })
}
