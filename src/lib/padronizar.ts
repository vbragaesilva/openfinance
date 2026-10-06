// Padronização dos nomes digitados em "local" e "produto" ("vila", "Vila", "VILA" → "Vila").
//
// Dois níveis:
//  - mesma chave (sem maiúsculas, acentos, espaços e pontuação): é o mesmo nome, junta sem perguntar;
//  - nomes parecidos (erro de digitação: "Villa" × "Vila", "Mosca" × "Moska"): só sugere. Às vezes são
//    lugares diferentes ("CASD" × "casa", "Vila" × "Vilarreal"), então quem decide é o usuário.

export type Campo = 'local' | 'produto'

/** Chave de comparação: "Center Vale", "center vale" e "CenterVale" → "centervale". */
export const chave = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

const temAcento = (s: string) => s.normalize('NFD') !== s
const temMaiuscula = (s: string) => s !== s.toLowerCase()
const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'em', 'a', 'o'])

/** Primeira letra de cada palavra em maiúscula (menos conectivos no meio): "center vale" → "Center Vale". */
const tituloPalavras = (s: string) =>
  s.replace(/\S+/g, (p, i: number) => (i > 0 && CONECTIVOS.has(p) ? p : p[0].toUpperCase() + p.slice(1)))
const primeiraMaiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Forma que representa um grupo de variações do mesmo nome.
 * - a mais usada (empate: a com acento, depois a que tem maiúscula — quem escreveu "AAAITA" quis assim);
 * - preferência por quem tem acento ("café" ganha de "cafe" mesmo sendo menos usada);
 * - se a escolhida está toda em minúscula: local vira "Título De Lugar", produto só a primeira letra.
 */
export function formaCanonica(variantes: [texto: string, vezes: number][], campo: Campo): string {
  const limpas = variantes.map(([t, n]) => [t.trim().replace(/\s+/g, ' '), n] as const).filter(([t]) => t)
  const comAcento = limpas.filter(([t]) => temAcento(t))
  const candidatas = comAcento.length ? comAcento : limpas
  const [escolhida] = [...candidatas].sort(
    (a, b) =>
      b[1] - a[1] ||
      Number(temAcento(b[0])) - Number(temAcento(a[0])) ||
      Number(temMaiuscula(b[0])) - Number(temMaiuscula(a[0])),
  )[0]
  if (temMaiuscula(escolhida)) return escolhida
  return campo === 'local' ? tituloPalavras(escolhida) : primeiraMaiuscula(escolhida)
}

/** Distância de edição (Levenshtein). */
export function distancia(a: string, b: string): number {
  const ant = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = ant[0]
    ant[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = ant[j]
      ant[j] = Math.min(ant[j] + 1, ant[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return ant[b.length]
}

/** Parecidos o bastante para sugerir "você quis dizer…?" (nunca para juntar sozinho). */
export function parecidos(a: string, b: string): boolean {
  const ka = chave(a)
  const kb = chave(b)
  if (ka === kb || Math.min(ka.length, kb.length) < 4) return false
  return distancia(ka, kb) <= (Math.max(ka.length, kb.length) <= 6 ? 1 : 2)
}

export interface Grupo {
  chave: string
  canonica: string
  variantes: [texto: string, vezes: number][]
  total: number
}

/** Agrupa os nomes usados (texto → vezes) pela chave e escolhe a forma canônica de cada grupo. */
export function agrupar(usos: Map<string, number>, campo: Campo): Grupo[] {
  const porChave = new Map<string, [string, number][]>()
  for (const [texto, n] of usos) {
    const k = chave(texto)
    if (!k) continue
    if (!porChave.has(k)) porChave.set(k, [])
    porChave.get(k)!.push([texto, n])
  }
  return [...porChave.entries()].map(([k, variantes]) => ({
    chave: k,
    canonica: formaCanonica(variantes, campo),
    variantes: variantes.sort((a, b) => b[1] - a[1]),
    total: variantes.reduce((s, [, n]) => s + n, 0),
  }))
}

/**
 * O que fazer com o que o usuário digitou, dado o que já existe:
 * - mesma chave de um nome existente → troca pela forma canônica;
 * - parecido com um existente → sugere (sem trocar);
 * - nome novo → fica como está.
 */
export function padronizarDigitado(
  texto: string,
  grupos: Grupo[],
): { valor: string; sugestao: string | null } {
  const t = texto.trim().replace(/\s+/g, ' ')
  const k = chave(t)
  if (!k) return { valor: t, sugestao: null }
  const igual = grupos.find((g) => g.chave === k)
  if (igual) return { valor: igual.canonica, sugestao: null }
  // Sugere o parecido mais usado.
  const parecido = grupos.filter((g) => parecidos(t, g.canonica)).sort((a, b) => b.total - a.total)[0]
  return { valor: t, sugestao: parecido?.canonica ?? null }
}
