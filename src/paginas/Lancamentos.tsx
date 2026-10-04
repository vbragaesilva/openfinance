import { useMemo, useState } from 'react'
import { api } from '../api.ts'
import { FormLancamento } from '../componentes/FormLancamento.tsx'
import { Dinheiro, Folha, Segmentado, SeletorMes } from '../componentes/ui.tsx'
import { useEstado } from '../estado.tsx'
import { dataComSemana, dataCurta, normalizar } from '../lib/formato.ts'
import { ehFixo, lancamentosDoMes, periodoDaPlataforma } from '../lib/painel.ts'
import { lerNotificacao } from '../lib/splitwise.ts'
import type { Lancamento, NotificacaoPendente } from '../lib/tipos.ts'

type Ordem = 'data' | 'valor'

function ItemLancamento({ l, plataforma, onAbrir }: { l: Lancamento; plataforma?: string; onAbrir: () => void }) {
  const detalhes = [l.local, l.categoria].filter(Boolean).join(' · ')
  return (
    <li>
      <button type="button" className="item" onClick={onAbrir}>
        <span className="item-principal">
          <span className="item-titulo">{l.produto || <span className="mudo">(sem produto)</span>}</span>
          <span className="item-sub">
            {detalhes}
            {plataforma && <span className="tag neutro">{plataforma}</span>}
            {l.tipo === 'Fixo' && <span className="tag neutro">Fixo</span>}
            {l.tipo === null && <span className="tag neutro">sem tipo</span>}
          </span>
        </span>
        <Dinheiro centavos={l.valor_centavos} />
      </button>
    </li>
  )
}

/** Notificações do Splitwise que não viraram lançamento sozinhas: lançar à mão ou descartar. */
function Revisar(props: { onLancar: (n: NotificacaoPendente) => void }) {
  const { dados, salvar } = useEstado()
  const [ocupado, setOcupado] = useState<number | null>(null)
  if (dados.notificacoes.length === 0) return null
  async function descartar(id: number) {
    setOcupado(id)
    try {
      await salvar(() => api.resolverNotificacao(id, 'descartada'))
    } finally {
      setOcupado(null)
    }
  }
  return (
    <section className="cartao revisar">
      <h3>Do Splitwise, para revisar ({dados.notificacoes.length})</h3>
      <ul className="lista">
        {dados.notificacoes.map((n) => (
          <li key={n.id} className="item-com-acao">
            <div className="item-principal">
              <span className="item-titulo">{n.titulo || n.subtitulo || 'Splitwise'}</span>
              <span className="item-sub">
                {[n.subtitulo, n.mensagem].filter(Boolean).join(' · ')}
              </span>
              <span className="item-sub">
                {dataComSemana(n.recebida_em.slice(0, 10))} {n.recebida_em.slice(11, 16)} · {n.motivo}
              </span>
            </div>
            <button type="button" className="btn pequeno" onClick={() => props.onLancar(n)}>
              Lançar
            </button>
            <button
              type="button"
              className="btn fantasma pequeno perigo-texto"
              disabled={ocupado === n.id}
              onClick={() => descartar(n.id)}
            >
              Descartar
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const SEM_CATEGORIA = '__sem__'

export function Lancamentos() {
  const { dados, hoje, mesSel, setMesSel, salvar } = useEstado()
  const [todosMeses, setTodosMeses] = useState(false)
  const [plataformaId, setPlataformaId] = useState<number | null>(null)
  const [ordem, setOrdem] = useState<Ordem>('data')
  const [busca, setBusca] = useState('')
  // '' = todas; SEM_CATEGORIA = lançamentos sem categoria
  const [categoria, setCategoria] = useState('')
  const [editando, setEditando] = useState<Lancamento | null>(null)
  const [daNotificacao, setDaNotificacao] = useState<NotificacaoPendente | null>(null)

  const nomes = useMemo(() => new Map(dados.plataformas.map((p) => [p.id, p.nome])), [dados.plataformas])
  const plataforma = dados.plataformas.find((p) => p.id === plataformaId)
  // Filtro só com as que têm lançamento ou estão ativas (uma desativada e vazia não interessa).
  const filtraveis = dados.plataformas.filter((p) => p.ativa || dados.lancamentos.some((l) => l.plataforma_id === p.id))

  // Categorias que existem nos lançamentos, da mais usada para a menos usada.
  const categorias = useMemo(() => {
    const n = new Map<string, number>()
    for (const l of dados.lancamentos) if (l.categoria) n.set(l.categoria, (n.get(l.categoria) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [dados.lancamentos])

  const lista = useMemo(() => {
    let l = todosMeses ? dados.lancamentos : lancamentosDoMes(dados, mesSel.ano, mesSel.mes)
    if (plataformaId != null) l = l.filter((x) => x.plataforma_id === plataformaId)
    if (categoria === SEM_CATEGORIA) l = l.filter((x) => !x.categoria)
    else if (categoria) l = l.filter((x) => x.categoria === categoria)
    const b = normalizar(busca.trim())
    if (b) l = l.filter((x) => normalizar(`${x.produto} ${x.local} ${x.categoria ?? ''}`).includes(b))
    return [...l].sort((a, b) =>
      ordem === 'valor'
        ? b.valor_centavos - a.valor_centavos
        : b.data.localeCompare(a.data) || b.criado_em.localeCompare(a.criado_em),
    )
  }, [dados, todosMeses, mesSel, plataformaId, categoria, busca, ordem])

  const total = lista.reduce((s, l) => s + l.valor_centavos, 0)
  const semFixos = lista.filter((l) => !ehFixo(l)).reduce((s, l) => s + l.valor_centavos, 0)
  const periodo = plataforma && !todosMeses && plataforma.fechamento > 1 ? periodoDaPlataforma(plataforma, mesSel.ano, mesSel.mes) : null

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

  // Com uma plataforma escolhida no filtro, a tag dela seria repetida em todo item.
  const item = (l: Lancamento) => (
    <ItemLancamento key={l.id} l={l} plataforma={plataformaId == null ? nomes.get(l.plataforma_id) : undefined} onAbrir={() => setEditando(l)} />
  )

  const inicialDaNotificacao = (n: NotificacaoPendente) => {
    // Aproveita o que o leitor conseguiu tirar do texto, mesmo quando ficou para revisão.
    const l = lerNotificacao({ titulo: n.titulo ?? '', subtitulo: n.subtitulo ?? '', mensagem: n.mensagem ?? '' })
    const splitwise = dados.plataformas.find((p) => p.integracao === 'splitwise')
    return { data: n.recebida_em.slice(0, 10), produto: l.nome, valor_centavos: l.valor_centavos, tipo: l.fixo, plataforma_id: splitwise?.id }
  }

  return (
    <div className="pagina">
      <div className="barra-filtros">
        {!todosMeses && <SeletorMes valor={mesSel} onChange={setMesSel} hoje={{ ano: hoje.ano, mes: hoje.mes }} />}
        <label className="checkbox">
          <input type="checkbox" checked={todosMeses} onChange={(e) => setTodosMeses(e.target.checked)} />
          todos os meses
        </label>
      </div>
      <div className="chips" role="group" aria-label="Plataforma">
        {[null, ...filtraveis.map((p) => p.id)].map((id) => (
          <button
            type="button"
            key={id ?? 'todas'}
            className={`chip ${plataformaId === id ? 'ativo' : ''}`}
            aria-pressed={plataformaId === id}
            onClick={() => setPlataformaId(id)}
          >
            {id == null ? 'Todas' : nomes.get(id)}
          </button>
        ))}
      </div>
      <div className="barra-filtros">
        <Segmentado
          rotulo="Ordenar por"
          valor={ordem}
          onChange={setOrdem}
          opcoes={[
            { valor: 'data', texto: 'Data' },
            { valor: 'valor', texto: 'Maiores' },
          ]}
        />
        <select
          className="filtro-select"
          aria-label="Categoria"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        >
          <option value="">Todas as categorias</option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={SEM_CATEGORIA}>Sem categoria</option>
        </select>
        <input
          type="search"
          className="busca"
          placeholder="Buscar produto, local, categoria"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      <Revisar onLancar={setDaNotificacao} />

      <p className="resumo-lista">
        {lista.length} {lista.length === 1 ? 'lançamento' : 'lançamentos'} · total <Dinheiro centavos={total} />
        {semFixos !== total && <> · sem fixos <Dinheiro centavos={semFixos} /></>}
        {periodo && <> · compras de {dataCurta(periodo.de)} a {dataCurta(periodo.ate)}</>}
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
                <ul className="lista">{g.itens.map(item)}</ul>
              </div>
            ))
          : <ul className="lista">{lista.map(item)}</ul>}
      </section>

      <Folha titulo="Editar lançamento" aberta={editando != null} onFechar={() => setEditando(null)}>
        {editando && <FormLancamento key={editando.id} lancamento={editando} onPronto={() => setEditando(null)} />}
      </Folha>
      <Folha titulo="Lançamento a partir da notificação" aberta={daNotificacao != null} onFechar={() => setDaNotificacao(null)}>
        {daNotificacao && (
          <FormLancamento
            key={daNotificacao.id}
            inicial={inicialDaNotificacao(daNotificacao)}
            onCriado={() => salvar(() => api.resolverNotificacao(daNotificacao.id, 'resolvida'))}
            onPronto={() => setDaNotificacao(null)}
          />
        )}
      </Folha>
    </div>
  )
}
