import { useMemo, useState } from 'react'
import { FormSplit } from '../componentes/FormSplit.tsx'
import { Dinheiro, Folha, SeletorMes } from '../componentes/ui.tsx'
import { useEstado } from '../estado.tsx'
import { dataComSemana } from '../lib/formato.ts'
import { doMes } from '../lib/painel.ts'
import type { SplitItem } from '../lib/tipos.ts'

export function Split() {
  const { dados, hoje, mesSel, setMesSel } = useEstado()
  const [editando, setEditando] = useState<SplitItem | null>(null)
  const [novo, setNovo] = useState(false)

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
    </div>
  )
}
