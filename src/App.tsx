import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, NaoAutenticado } from './api.ts'
import { FormLancamento } from './componentes/FormLancamento.tsx'
import { PuxarParaAtualizar } from './componentes/PuxarParaAtualizar.tsx'
import { Erro, Folha } from './componentes/ui.tsx'
import { ProvedorEstado } from './estado.tsx'
import type { Dados } from './lib/tipos.ts'
import { Analises } from './paginas/Analises.tsx'
import { Configuracoes } from './paginas/Configuracoes.tsx'
import { Fixos } from './paginas/Fixos.tsx'
import { Lancamentos } from './paginas/Lancamentos.tsx'
import { Painel } from './paginas/Painel.tsx'

// `curto` é o nome na barra de baixo do celular, onde "Configurações" não cabe.
const ROTAS = [
  { hash: '#/', nome: 'Painel', icone: '◔', Pagina: Painel },
  { hash: '#/lancamentos', nome: 'Lançamentos', icone: '≡', Pagina: Lancamentos },
  { hash: '#/fixos', nome: 'Fixos', icone: '▤', Pagina: Fixos },
  { hash: '#/analises', nome: 'Análises', icone: '▦', Pagina: Analises },
  { hash: '#/config', nome: 'Configurações', curto: 'Ajustes', icone: '⚙\uFE0E', Pagina: Configuracoes },
]

function useHash() {
  const [hash, setHash] = useState(() => location.hash || '#/')
  useEffect(() => {
    const f = () => setHash(location.hash || '#/')
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return hash
}

function Login(props: { onEntrar: () => void }) {
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  async function enviar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    try {
      await api.login(senha)
      props.onEntrar()
    } catch (err) {
      setErro((err as Error).message)
      setEnviando(false)
    }
  }
  return (
    <main className="login">
      <form className="cartao form" onSubmit={enviar}>
        <h1 className="marca">openfinance</h1>
        <label htmlFor="senha">Senha</label>
        <input id="senha" type="password" autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
        <Erro erro={erro} />
        <button className="btn primario" disabled={enviando}>
          Entrar
        </button>
      </form>
    </main>
  )
}

type Fase = { tipo: 'carregando' } | { tipo: 'login' } | { tipo: 'erro'; msg: string } | { tipo: 'ok'; dados: Dados; aberto: boolean }

export function App() {
  const [fase, setFase] = useState<Fase>({ tipo: 'carregando' })
  const [novo, setNovo] = useState(false)
  const hash = useHash()

  const carregar = useCallback(async () => {
    try {
      const s = await api.sessao()
      if (!s.autenticado) return setFase({ tipo: 'login' })
      setFase({ tipo: 'ok', dados: await api.dados(), aberto: s.aberto })
    } catch (e) {
      if (e instanceof NaoAutenticado) setFase({ tipo: 'login' })
      else setFase({ tipo: 'erro', msg: (e as Error).message })
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const setDados = useCallback((dados: Dados) => setFase((f) => (f.tipo === 'ok' ? { ...f, dados } : f)), [])
  const naoAutenticado = useCallback(() => setFase({ tipo: 'login' }), [])
  const sair = useCallback(async () => {
    await api.logout()
    setFase({ tipo: 'login' })
  }, [])

  if (fase.tipo === 'carregando') return <p className="carregando">Carregando…</p>
  if (fase.tipo === 'login') return <Login onEntrar={carregar} />
  if (fase.tipo === 'erro') {
    return (
      <main className="login">
        <div className="cartao">
          <h1 className="marca">openfinance</h1>
          <Erro erro={fase.msg} />
          <button className="btn" onClick={carregar}>Tentar de novo</button>
        </div>
      </main>
    )
  }

  const rota = ROTAS.find((r) => r.hash === hash) ?? ROTAS[0]
  const { Pagina } = rota

  return (
    <ProvedorEstado dados={fase.dados} setDados={setDados} onNaoAutenticado={naoAutenticado}>
      <PuxarParaAtualizar />
      <header className="topo">
        <a href="#/" className="marca">openfinance</a>
        <nav className="nav-topo" aria-label="Seções">
          {ROTAS.map((r) => (
            <a key={r.hash} href={r.hash} aria-current={r === rota ? 'page' : undefined}>
              {r.nome}
            </a>
          ))}
        </nav>
        <div className="topo-acoes">
          <button type="button" className="btn primario so-desktop" onClick={() => setNovo(true)}>
            + Lançamento
          </button>
          {!fase.aberto && (
            <button type="button" className="btn fantasma pequeno" onClick={sair}>
              Sair
            </button>
          )}
        </div>
      </header>

      <main>
        <h1 className="titulo-pagina">{rota.nome}</h1>
        <Pagina />
      </main>

      <button type="button" className="fab so-celular" onClick={() => setNovo(true)} aria-label="Novo lançamento">
        +
      </button>
      <nav className="nav-baixo" aria-label="Seções">
        {ROTAS.map((r) => (
          <a key={r.hash} href={r.hash} aria-current={r === rota ? 'page' : undefined}>
            <span aria-hidden className="nav-icone">{r.icone}</span>
            {r.curto ?? r.nome}
          </a>
        ))}
      </nav>

      <Folha titulo="Novo lançamento" aberta={novo} onFechar={() => setNovo(false)}>
        {novo && <FormLancamento onPronto={() => setNovo(false)} />}
      </Folha>
    </ProvedorEstado>
  )
}
