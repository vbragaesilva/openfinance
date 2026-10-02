import { useMemo, useState } from 'react'
import { FormLancamento } from '../componentes/FormLancamento.tsx'
import { Dinheiro, Folha, Segmentado, SeletorMes } from '../componentes/ui.tsx'
import { useEstado } from '../estado.tsx'
import { dataComSemana, normalizar } from '../lib/formato.ts'
import { doMes } from '../lib/painel.ts'
import type { Lancamento } from '../lib/tipos.ts'

type FiltroModalidade = 'todos' | 'Crédito' | 'Débito'
type Ordem = 'data' | 'valor'

function ItemLancamento({ l, onAbrir }: { l: Lancamento; onAbrir: () => void }) {
  const detalhes = [l.local, l.categoria].filter(Boolean).join(' · ')
  return (
    <li>
      <button type="button" className="item" onClick={onAbrir}>
        <span className="item-principal">
          <span className="item-titulo">{l.produto || <span className="mudo">(sem produto)</span>}</span>
          <span className="item-sub">
            {detalhes}
            {l.modalidade === 'Débito' && <span className="tag neutro">Débito</span>}
            {l.tipo === 'Fixo' && <span className="tag neutro">Fixo</span>}
            {l.tipo === null && <span className="tag neutro">sem tipo</span>}
          </span>
        </span>
        <Dinheiro centavos={l.valor_centavos} />
      </button>
    </li>
  )
}

export function Lancamentos() {
  const { dados, hoje, mesSel, setMesSel } = useEstado()
  const [todosMeses, setTodosMeses] = useState(false)
  const [modalidade, setModalidade] = useState<FiltroModalidade>('todos')
  const [ordem, setOrdem] = useState<Ordem>('data')
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<Lancamento | null>(null)

  const lista = useMemo(() => {
    let l = todosMeses ? dados.lancamentos : doMes(dados.lancamentos, mesSel.ano, mesSel.mes)
    if (modalidade !== 'todos') l = l.filter((x) => x.modalidade === modalidade)
    const b = normalizar(busca.trim())
    if (b) l = l.filter((x) => normalizar(`${x.produto} ${x.local} ${x.categoria ?? ''}`).includes(b))
    return [...l].sort((a, b) =>
      ordem === 'valor'
        ? b.valor_centavos - a.valor_centavos
        : b.data.localeCompare(a.data) || b.criado_em.localeCompare(a.criado_em),
    )
  }, [dados.lancamentos, todosMeses, mesSel, modalidade, busca, ordem])

  const total = lista.reduce((s, l) => s + l.valor_centavos, 0)

  const grupos = useMemo(() => {
    if (ordem !== 'data') return null
    const g: { data: string; itens: Lancamento[]; total: number }[] = []
    for (const l of lista) {
      const ultimo = g[g.length - 1]
      if (ultimo?.data === l.data) {
        ultimo.itens.push(l)
        ultimo.total += l.valor_centavos
      } else g.push({ data: l.data, itens: [l], total: l.valor_centavos })
    }
    return g
  }, [lista, ordem])

  return (
    <div className="pagina">
      <div className="barra-filtros">
        {!todosMeses && <SeletorMes valor={mesSel} onChange={setMesSel} hoje={{ ano: hoje.ano, mes: hoje.mes }} />}
        <label className="checkbox">
          <input type="checkbox" checked={todosMeses} onChange={(e) => setTodosMeses(e.target.checked)} />
          todos os meses
        </label>
      </div>
      <div className="barra-filtros">
        <Segmentado
          rotulo="Modalidade"
          valor={modalidade}
          onChange={setModalidade}
          opcoes={[
            { valor: 'todos', texto: 'Todos' },
            { valor: 'Crédito', texto: 'Crédito' },
            { valor: 'Débito', texto: 'Débito' },
          ]}
        />
        <Segmentado
          rotulo="Ordenar por"
          valor={ordem}
          onChange={setOrdem}
          opcoes={[
            { valor: 'data', texto: 'Data' },
            { valor: 'valor', texto: 'Maiores' },
          ]}
        />
        <input
          type="search"
          className="busca"
          placeholder="Buscar produto, local, categoria"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      <p className="resumo-lista">
        {lista.length} {lista.length === 1 ? 'lançamento' : 'lançamentos'} · total <Dinheiro centavos={total} />
      </p>

      <section className="cartao lista-cartao">
        {lista.length === 0 && <p className="vazio">Nada por aqui.</p>}
        {grupos
          ? grupos.map((g) => (
              <div key={g.data} className="grupo">
                <h4 className="grupo-titulo">
                  <span>{dataComSemana(g.data)}</span>
                  <Dinheiro centavos={g.total} />
                </h4>
                <ul className="lista">
                  {g.itens.map((l) => <ItemLancamento key={l.id} l={l} onAbrir={() => setEditando(l)} />)}
                </ul>
              </div>
            ))
          : (
              <ul className="lista">
                {lista.map((l) => <ItemLancamento key={l.id} l={l} onAbrir={() => setEditando(l)} />)}
              </ul>
            )}
      </section>

      <Folha titulo="Editar lançamento" aberta={editando != null} onFechar={() => setEditando(null)}>
        {editando && <FormLancamento key={editando.id} lancamento={editando} onPronto={() => setEditando(null)} />}
      </Folha>
    </div>
  )
}
