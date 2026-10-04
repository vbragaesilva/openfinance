import { useState, type FormEvent } from 'react'
import { api } from '../api.ts'
import { AcoesForm, Campo, Erro, Folha } from '../componentes/ui.tsx'
import { useEstado } from '../estado.tsx'
import type { Plataforma } from '../lib/tipos.ts'

const textoFechamento = (dia: number) =>
  dia <= 1 ? 'Mês do calendário' : `Fecha no dia ${dia}: compras antes dele contam no mês anterior`

/** Criar (sem `plataforma`) ou editar uma plataforma. */
function FormPlataforma(props: { plataforma?: Plataforma; onPronto: () => void }) {
  const { salvar } = useEstado()
  const p = props.plataforma
  const [nome, setNome] = useState(p?.nome ?? '')
  const [fechamento, setFechamento] = useState(String(p?.fechamento ?? 1))
  const [noPainel, setNoPainel] = useState(p?.no_painel ?? true)
  const [nasAnalises, setNasAnalises] = useState(p?.nas_analises ?? false)
  const [ativa, setAtiva] = useState(p?.ativa ?? true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function executar(f: () => Promise<unknown>) {
    setSalvando(true)
    setErro(null)
    try {
      await salvar(f)
      props.onPronto()
    } catch (e) {
      setErro((e as Error).message)
      setSalvando(false)
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    const dia = Number(fechamento)
    if (!nome.trim()) return setErro('Informe o nome.')
    if (!Number.isInteger(dia) || dia < 1 || dia > 28) return setErro('O dia de fechamento vai de 1 a 28.')
    const campos = { nome: nome.trim(), fechamento: dia, no_painel: noPainel, nas_analises: nasAnalises }
    executar(() => (p ? api.atualizarPlataforma(p.id, { ...campos, ativa }) : api.criarPlataforma(campos)))
  }

  const dia = Number(fechamento)
  return (
    <form className="form" onSubmit={enviar}>
      <Campo rotulo="Nome" htmlFor="pl-nome" dica={p?.integracao === 'splitwise' ? 'Recebe os splits das notificações do Splitwise.' : undefined}>
        <input id="pl-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus={!p} placeholder="Crédito Inter" autoComplete="off" />
      </Campo>
      <Campo
        rotulo="Dia de fechamento"
        htmlFor="pl-fechamento"
        dica={Number.isInteger(dia) && dia >= 1 && dia <= 28 ? `${textoFechamento(dia)}.` : 'De 1 a 28.'}
      >
        <input id="pl-fechamento" type="number" inputMode="numeric" min={1} max={28} value={fechamento} onChange={(e) => setFechamento(e.target.value)} />
      </Campo>
      <label className="checkbox">
        <input type="checkbox" checked={noPainel} onChange={(e) => setNoPainel(e.target.checked)} />
        Conferir no painel (mostra o total dela no Painel)
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={nasAnalises} onChange={(e) => setNasAnalises(e.target.checked)} />
        Entrar nas análises (e no gráfico por categoria do Painel)
      </label>
      {p && (
        <label className="checkbox">
          <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
          Ativa (desativada some do formulário de lançamento, mas o histórico continua contando)
        </label>
      )}
      <Erro erro={erro} />
      <AcoesForm
        salvando={salvando}
        onApagar={p ? () => executar(() => api.apagarPlataforma(p.id)) : undefined}
        textoSalvar={p ? 'Salvar' : 'Criar plataforma'}
      />
    </form>
  )
}

export function Configuracoes() {
  const { dados, salvar } = useEstado()
  const [editando, setEditando] = useState<Plataforma | null>(null)
  const [nova, setNova] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const plataformas = dados.plataformas

  async function executar(f: () => Promise<unknown>) {
    setOcupado(true)
    setErro(null)
    try {
      await salvar(f)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  function mover(i: number, delta: number) {
    const ids = plataformas.map((p) => p.id)
    ;[ids[i], ids[i + delta]] = [ids[i + delta], ids[i]]
    executar(() => api.ordenarPlataformas(ids))
  }

  return (
    <div className="pagina">
      <section className="cartao">
        <div className="cartao-topo">
          <h3>Plataformas</h3>
          <button type="button" className="btn pequeno" onClick={() => setNova(true)}>+ Plataforma</button>
        </div>
        <p className="nota sem-margem">
          Todas contam no Gasto do mês (sem os fixos). “Painel” mostra o total da plataforma para conferir com a
          fatura ou o app dela; “Análises” escolhe o que entra nas Análises. A ordem vale para o Painel e o formulário.
        </p>
        <Erro erro={erro} />
        <ul className="lista">
          {plataformas.map((p, i) => (
            <li key={p.id} className="plataforma-linha">
              <div className="item-principal">
                <span className="item-titulo">
                  {p.nome}
                  {!p.ativa && <span className="tag neutro">desativada</span>}
                </span>
                <span className="item-sub">{textoFechamento(p.fechamento)}</span>
                {p.integracao === 'splitwise' && <span className="item-sub">Recebe as notificações do Splitwise</span>}
                <div className="plataforma-opcoes">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={p.no_painel}
                      disabled={ocupado}
                      onChange={(e) => executar(() => api.atualizarPlataforma(p.id, { no_painel: e.target.checked }))}
                    />
                    Painel
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={p.nas_analises}
                      disabled={ocupado}
                      onChange={(e) => executar(() => api.atualizarPlataforma(p.id, { nas_analises: e.target.checked }))}
                    />
                    Análises
                  </label>
                </div>
              </div>
              <div className="plataforma-acoes">
                <button type="button" className="btn-icone" disabled={ocupado || i === 0} onClick={() => mover(i, -1)} aria-label={`Subir ${p.nome}`}>↑</button>
                <button
                  type="button"
                  className="btn-icone"
                  disabled={ocupado || i === plataformas.length - 1}
                  onClick={() => mover(i, 1)}
                  aria-label={`Descer ${p.nome}`}
                >
                  ↓
                </button>
                <button type="button" className="btn fantasma pequeno" onClick={() => setEditando(p)}>Editar</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Folha titulo="Nova plataforma" aberta={nova} onFechar={() => setNova(false)}>
        {nova && <FormPlataforma onPronto={() => setNova(false)} />}
      </Folha>
      <Folha titulo="Editar plataforma" aberta={editando != null} onFechar={() => setEditando(null)}>
        {editando && <FormPlataforma key={editando.id} plataforma={editando} onPronto={() => setEditando(null)} />}
      </Folha>
    </div>
  )
}
