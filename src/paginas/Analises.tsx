import { useMemo, useState, type CSSProperties } from 'react'
import { BarrasCategoria, ColunasMensais, corCategoria } from '../componentes/Categorias.tsx'
import { Dinheiro, Segmentado, SeletorMes } from '../componentes/ui.tsx'
import { useEstado } from '../estado.tsx'
import {
  creditoDoPeriodo, evolucaoMensal, maioresCompras, ordemCategorias, porCategoria, topLocais, type Periodo,
} from '../lib/analises.ts'
import { brl, dataCurta, mesCurto, nomeMes } from '../lib/formato.ts'

type TipoPeriodo = Periodo['tipo']

export function Analises() {
  const { dados, hoje, mesSel, setMesSel } = useEstado()
  const [tipo, setTipo] = useState<TipoPeriodo>('mes')
  const [semFixos, setSemFixos] = useState(false)

  const periodo = useMemo<Periodo>(
    () => (tipo === 'mes' ? { tipo, ano: mesSel.ano, mes: mesSel.mes } : tipo === 'ano' ? { tipo, ano: mesSel.ano } : { tipo }),
    [tipo, mesSel.ano, mesSel.mes],
  )

  const ordem = useMemo(() => ordemCategorias(dados), [dados])
  const lancs = useMemo(() => creditoDoPeriodo(dados, periodo, semFixos), [dados, periodo, semFixos])
  const cats = useMemo(() => porCategoria(lancs), [lancs])
  // No filtro "Mês", o gráfico mostra o ano inteiro com o mês escolhido em destaque.
  const meses = useMemo(
    () => evolucaoMensal(creditoDoPeriodo(dados, tipo === 'tudo' ? { tipo: 'tudo' } : { tipo: 'ano', ano: mesSel.ano }, semFixos)),
    [dados, tipo, mesSel.ano, semFixos],
  )
  const locais = useMemo(() => topLocais(lancs), [lancs])
  const maiores = useMemo(() => maioresCompras(lancs), [lancs])

  const total = lancs.reduce((s, l) => s + l.valor_centavos, 0)
  const mesesComGasto = meses.filter((m) => m.total > 0).length
  const categoriasTabela = ordem.filter((c) => meses.some((m) => m.porCategoria.has(c)))
  const maxCelula = Math.max(1, ...meses.flatMap((m) => [...m.porCategoria.values()]))
  const destaque = tipo === 'mes' ? `${mesSel.ano}-${String(mesSel.mes).padStart(2, '0')}` : undefined
  const titulo = tipo === 'mes' ? `${nomeMes(mesSel.mes)} ${mesSel.ano}` : tipo === 'ano' ? String(mesSel.ano) : 'Tudo'

  return (
    <div className="pagina">
      <div className="barra-filtros">
        <Segmentado
          rotulo="Período"
          valor={tipo}
          onChange={setTipo}
          opcoes={[
            { valor: 'mes', texto: 'Mês' },
            { valor: 'ano', texto: 'Ano' },
            { valor: 'tudo', texto: 'Tudo' },
          ]}
        />
        {tipo === 'mes' && <SeletorMes valor={mesSel} onChange={setMesSel} hoje={{ ano: hoje.ano, mes: hoje.mes }} />}
        {tipo === 'ano' && (
          <div className="seletor-mes">
            <button type="button" className="btn-icone" onClick={() => setMesSel({ ...mesSel, ano: mesSel.ano - 1 })} aria-label="Ano anterior">‹</button>
            <span className="seletor-mes-rotulo">{mesSel.ano}</span>
            <button type="button" className="btn-icone" onClick={() => setMesSel({ ...mesSel, ano: mesSel.ano + 1 })} aria-label="Próximo ano">›</button>
          </div>
        )}
        <Segmentado
          rotulo="Crédito"
          valor={semFixos ? 'sem' : 'tudo'}
          onChange={(v) => setSemFixos(v === 'sem')}
          opcoes={[
            { valor: 'tudo', texto: 'Fatura inteira' },
            { valor: 'sem', texto: 'Sem fixos' },
          ]}
        />
      </div>

      <div className="grade-tiles">
        <section className="cartao tile">
          <span className="rotulo">Crédito · {titulo}</span>
          <Dinheiro centavos={total} className="numero-tile" />
          <span className="mudo">{lancs.length} {lancs.length === 1 ? 'compra' : 'compras'}</span>
        </section>
        <section className="cartao tile">
          <span className="rotulo">Média por compra</span>
          <Dinheiro centavos={lancs.length ? total / lancs.length : 0} className="numero-tile" />
        </section>
        {tipo !== 'mes' && (
          <section className="cartao tile">
            <span className="rotulo">Média por mês</span>
            <Dinheiro centavos={mesesComGasto ? total / mesesComGasto : 0} className="numero-tile" />
            <span className="mudo">em {mesesComGasto} {mesesComGasto === 1 ? 'mês' : 'meses'}</span>
          </section>
        )}
      </div>

      <section className="cartao">
        <h3>Por categoria</h3>
        {cats.fatias.length === 0 ? (
          <p className="mudo">Nenhuma compra no crédito neste período.</p>
        ) : (
          <BarrasCategoria fatias={cats.fatias} ordem={ordem} total={cats.total} />
        )}
        {cats.semCategoria !== 0 && (
          <p className="nota">
            Fora das porcentagens: {brl(cats.semCategoria)} sem categoria (ex.: parcelas do seu pai que voltam no débito).
          </p>
        )}
      </section>

      {meses.length > 0 && (
        <section className="cartao">
          <h3>Mês a mês</h3>
          <ColunasMensais
            meses={meses}
            ordem={ordem}
            destaque={destaque}
            onEscolher={(m) => {
              setMesSel({ ano: m.ano, mes: m.mes })
              setTipo('mes')
            }}
          />
          <div className="tabela-rolavel">
            <table className="tabela pivo">
              <thead>
                <tr>
                  <th>Categoria</th>
                  {meses.map((m) => (
                    <th key={m.chave} className={`num ${m.chave === destaque ? 'destaque' : ''}`}>
                      {mesCurto(m.mes)}
                    </th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {categoriasTabela.map((c) => {
                  const totalCat = meses.reduce((s, m) => s + (m.porCategoria.get(c) ?? 0), 0)
                  return (
                    <tr key={c}>
                      <td>
                        <i className="chave-quadrado" style={{ background: corCategoria(ordem, c) }} /> {c}
                      </td>
                      {meses.map((m) => {
                        const v = m.porCategoria.get(c) ?? 0
                        return (
                          <td
                            key={m.chave}
                            className={`num celula-calor ${m.chave === destaque ? 'destaque' : ''}`}
                            style={{ '--calor': Math.max(0, v) / maxCelula } as CSSProperties}
                          >
                            {v ? Math.round(v / 100).toLocaleString('pt-BR') : <span className="mudo">·</span>}
                          </td>
                        )
                      })}
                      <td className="num forte">{Math.round(totalCat / 100).toLocaleString('pt-BR')}</td>
                    </tr>
                  )
                })}
                <tr className="linha-total">
                  <td>Total</td>
                  {meses.map((m) => (
                    <td key={m.chave} className={`num ${m.chave === destaque ? 'destaque' : ''}`}>
                      {Math.round(m.total / 100).toLocaleString('pt-BR')}
                    </td>
                  ))}
                  <td className="num">{Math.round(meses.reduce((s, m) => s + m.total, 0) / 100).toLocaleString('pt-BR')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="nota">Valores em reais, sem centavos. Toque num mês do gráfico para ver só ele.</p>
        </section>
      )}

      <div className="grade-2">
        <section className="cartao">
          <h3>Onde mais gastou</h3>
          <table className="tabela">
            <tbody>
              {locais.map((l) => (
                <tr key={l.nome} className="sem-clique">
                  <td>
                    {l.nome} <span className="mudo">· {l.vezes}×</span>
                  </td>
                  <td className="num"><Dinheiro centavos={l.valor} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="cartao">
          <h3>Maiores compras</h3>
          <table className="tabela">
            <tbody>
              {maiores.map((l) => (
                <tr key={l.id} className="sem-clique">
                  <td>
                    {l.produto || l.local}
                    <span className="mudo"> · {dataCurta(l.data)}{tipo !== 'mes' ? `/${l.data.slice(2, 4)}` : ''}</span>
                  </td>
                  <td className="num"><Dinheiro centavos={l.valor_centavos} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
