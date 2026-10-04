import type { Dados } from './lib/tipos.ts'

export class NaoAutenticado extends Error {}

async function req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const res = await fetch(`/api/${caminho}`, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    credentials: 'same-origin',
  })
  const dados = await res.json().catch(() => ({}))
  if (res.status === 401 && caminho !== 'login') throw new NaoAutenticado()
  if (!res.ok) throw new Error(dados.erro ?? `Erro ${res.status}`)
  return dados as T
}

export const api = {
  sessao: () => req<{ autenticado: boolean; aberto: boolean }>('GET', 'sessao'),
  login: (senha: string) => req<{ ok: true }>('POST', 'login', { senha }),
  logout: () => req<{ ok: true }>('POST', 'logout'),
  dados: () => req<Dados>('GET', 'dados'),
  criar: (itens: object | object[]) => req<{ ids: number[] }>('POST', 'lancamentos', itens),
  atualizar: (id: number, campos: object) => req<{ ok: true }>('PUT', `lancamentos/${id}`, campos),
  apagar: (id: number) => req<{ ok: true }>('DELETE', `lancamentos/${id}`),
  criarPlataforma: (p: { nome: string; fechamento: number; no_painel: boolean; nas_analises: boolean }) =>
    req<{ ok: true }>('POST', 'plataformas', p),
  atualizarPlataforma: (
    id: number,
    campos: { nome?: string; fechamento?: number; no_painel?: boolean; nas_analises?: boolean; ativa?: boolean },
  ) => req<{ ok: true }>('PUT', `plataformas/${id}`, campos),
  ordenarPlataformas: (ids: number[]) => req<{ ok: true }>('PUT', 'plataformas/ordem', ids),
  apagarPlataforma: (id: number) => req<{ ok: true }>('DELETE', `plataformas/${id}`),
  salario: (desde: string, valor_centavos: number) => req<{ ok: true }>('PUT', `salarios/${desde}`, { valor_centavos }),
  apagarSalario: (desde: string) => req<{ ok: true }>('DELETE', `salarios/${desde}`),
  criarFixo: (f: { nome: string; valor_centavos: number; investimento: boolean; inicio: string }) =>
    req<{ ok: true }>('POST', 'fixos', f),
  atualizarFixo: (id: number, campos: { nome?: string; investimento?: boolean; ordem?: number; fim?: string | null }) =>
    req<{ ok: true }>('PUT', `fixos/${id}`, campos),
  valorFixo: (id: number, desde: string, valor_centavos: number) =>
    req<{ ok: true }>('PUT', `fixos/${id}/valor`, { desde, valor_centavos }),
  apagarValorFixo: (id: number, desde: string) => req<{ ok: true }>('DELETE', `fixos/${id}/valor/${desde}`),
  apagarFixo: (id: number) => req<{ ok: true }>('DELETE', `fixos/${id}`),
  pagarFixo: (id: number, data: string) => req<{ ok: true }>('POST', `fixos/${id}/pagamentos`, { data }),
  apagarPagamento: (id: number) => req<{ ok: true }>('DELETE', `pagamentos/${id}`),
  resolverNotificacao: (id: number, status: 'resolvida' | 'descartada') =>
    req<{ ok: true }>('PUT', `notificacoes/${id}`, { status }),
  caixa: (ano: number, mes: number, valor_centavos: number | null) =>
    req<{ ok: true }>('PUT', `caixa/${ano}/${mes}`, { valor_centavos }),
}
