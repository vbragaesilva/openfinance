import { useMemo, useState } from 'react'
import { api } from '../api.ts'
import { FormSplit } from '../componentes/FormSplit.tsx'
import { Dinheiro, Folha, SeletorMes } from '../componentes/ui.tsx'
import { useEstado } from '../estado.tsx'
import { dataComSemana } from '../lib/formato.ts'
import { doMes } from '../lib/painel.ts'
import { lerNotificacao } from '../lib/splitwise.ts'
import type { NotificacaoPendente, SplitItem } from '../lib/tipos.ts'

/** Notificações do Splitwise que não viraram split sozinhas: lançar à mão ou descartar. */
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
              Lançar split
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

export function Split() {
  const { dados, hoje, mesSel, setMesSel, salvar } = useEstado()
  const [editando, setEditando] = useState<SplitItem | null>(null)
  const [novo, setNovo] = useState(false)
  const [daNotificacao, setDaNotificacao] = useState<NotificacaoPendente | null>(null)

  const lista = useMemo(
    () =>
      [...doMes(dados.split, mesSel.ano, mesSel.mes)].sort(
        (a, b) => b.data.localeCompare(a.data) || b.criado_em.localeCompare(a.criado_em),
      ),
    [dados.split, mesSel],
  )
  const total = lista.reduce((s, i) => s + i.valor_centavos, 0)
  const variavel = lista.filter((i) => i.fixo === 'Variável').reduce((s, i) => s + i.valor_centavos, 0)

  return (
    <div className="pagina">
      <div className="barra-filtros">
        <SeletorMes valor={mesSel} onChange={setMesSel} hoje={{ ano: hoje.ano, mes: hoje.mes }} />
        <button type="button" className="btn primario so-desktop" onClick={() => setNovo(true)}>
          + Split
        </button>
      </div>

      <Revisar onLancar={setDaNotificacao} />

      <div className="grade-tiles dois">
        <section className="cartao tile">
          <span className="rotulo">Split total</span>
          <Dinheiro centavos={total} className="numero-tile" />
        </section>
        <section className="cartao tile">
          <span className="rotulo">Split variável</span>
          <Dinheiro centavos={variavel} className="numero-tile" />
          <span className="mudo">é o que entra no Gasto do mês</span>
        </section>
      </div>

      <section className="cartao lista-cartao">
        {lista.length === 0 && <p className="vazio">Nenhum split neste mês.</p>}
        <ul className="lista">
          {lista.map((s) => (
            <li key={s.id}>
              <button type="button" className="item" onClick={() => setEditando(s)}>
                <span className="item-principal">
                  <span className="item-titulo">{s.nome || <span className="mudo">(sem nome)</span>}</span>
                  <span className="item-sub">
                    {dataComSemana(s.data)}
                    {s.fixo === 'Fixo' && <span className="tag neutro">Fixo</span>}
                  </span>
                </span>
                <Dinheiro centavos={s.valor_centavos} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Folha titulo="Novo split" aberta={novo} onFechar={() => setNovo(false)}>
        {novo && <FormSplit onPronto={() => setNovo(false)} />}
      </Folha>
      <Folha titulo="Editar split" aberta={editando != null} onFechar={() => setEditando(null)}>
        {editando && <FormSplit key={editando.id} item={editando} onPronto={() => setEditando(null)} />}
      </Folha>
      <Folha titulo="Split a partir da notificação" aberta={daNotificacao != null} onFechar={() => setDaNotificacao(null)}>
        {daNotificacao && (
          <FormSplit
            key={daNotificacao.id}
            inicial={{
              data: daNotificacao.recebida_em.slice(0, 10),
              // Aproveita o que o leitor conseguiu tirar do texto, mesmo quando ficou para revisão.
              ...(() => {
                const l = lerNotificacao({
                  titulo: daNotificacao.titulo ?? '', subtitulo: daNotificacao.subtitulo ?? '', mensagem: daNotificacao.mensagem ?? '',
                })
                return { nome: l.nome, valor_centavos: l.valor_centavos, fixo: l.fixo }
              })(),
            }}
            onCriado={() => salvar(() => api.resolverNotificacao(daNotificacao.id, 'resolvida'))}
            onPronto={() => setDaNotificacao(null)}
          />
        )}
      </Folha>
    </div>
  )
}
