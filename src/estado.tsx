import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, NaoAutenticado } from './api.ts'
import { hojeLocal, type Hoje } from './lib/painel.ts'
import type { Dados } from './lib/tipos.ts'

export interface MesSel {
  ano: number
  mes: number
}

interface Estado {
  dados: Dados
  hoje: Hoje
  mesSel: MesSel
  setMesSel: (m: MesSel) => void
  /** Executa uma escrita na API e recarrega os dados. */
  salvar: (f: () => Promise<unknown>) => Promise<void>
  /** Lançamentos. */
  criar: (itens: object | object[]) => Promise<void>
  atualizar: (id: number, campos: object) => Promise<void>
  apagar: (id: number) => Promise<void>
}

const Ctx = createContext<Estado | null>(null)

export function useEstado() {
  const e = useContext(Ctx)
  if (!e) throw new Error('useEstado fora do Provider')
  return e
}

export function ProvedorEstado(props: {
  dados: Dados
  setDados: (d: Dados) => void
  onNaoAutenticado: () => void
  children: ReactNode
}) {
  const { setDados, onNaoAutenticado } = props
  const [hoje, setHoje] = useState(hojeLocal)
  const [mesSel, setMesSel] = useState<MesSel>(() => ({ ano: hoje.ano, mes: hoje.mes }))

  // Vira o dia se o app ficar aberto (ex.: aba esquecida no celular).
  useEffect(() => {
    const atualizar = () => setHoje((h) => {
      const n = hojeLocal()
      return n.dia === h.dia && n.mes === h.mes && n.ano === h.ano ? h : n
    })
    document.addEventListener('visibilitychange', atualizar)
    const t = setInterval(atualizar, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', atualizar)
      clearInterval(t)
    }
  }, [])

  const salvar = useCallback(
    async (f: () => Promise<unknown>) => {
      try {
        await f()
        setDados(await api.dados())
      } catch (e) {
        if (e instanceof NaoAutenticado) onNaoAutenticado()
        throw e
      }
    },
    [setDados, onNaoAutenticado],
  )

  const valor = useMemo<Estado>(
    () => ({
      dados: props.dados,
      hoje,
      mesSel,
      setMesSel,
      salvar,
      criar: (itens) => salvar(() => api.criar(itens)),
      atualizar: (id, campos) => salvar(() => api.atualizar(id, campos)),
      apagar: (id) => salvar(() => api.apagar(id)),
    }),
    [props.dados, hoje, mesSel, salvar],
  )

  return <Ctx.Provider value={valor}>{props.children}</Ctx.Provider>
}
