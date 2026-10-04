import { Fragment, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api.ts'
import { BarrasCategoria } from '../componentes/Categorias.tsx'
import { GraficoRitmo } from '../componentes/GraficoRitmo.tsx'
import { Dinheiro, SeletorMes } from '../componentes/ui.tsx'
import { useEstado } from '../estado.tsx'
import { brl, lerValor, mesCurto, nomeMes, valorParaCampo } from '../lib/formato.ts'
import { lancamentosDoPeriodo, ordemCategorias, porCategoria, rotuloAnalises } from '../lib/analises.ts'
import { mesesDoAno, resumoMes, ritmoDoMes, type ResumoMes } from '../lib/painel.ts'

function Status({ r }: { r: ResumoMes }) {
  if (r.diasParaLiberar === 'PARE!') {
    return (
      <div className="status critico">
        <span className="status-pill"><span aria-hidden>✋</span> PARE!</span>
        <p>O gasto do mês ({brl(r.gasto)}) já chegou no Restante ({brl(r.restante)}).</p>
      </div>
    )
  }
  if (typeof r.diasParaLiberar === 'number') {
    return (
      <div className="status alerta">
        <span className="status-pill"><span aria-hidden>⏳</span> Segura {r.diasParaLiberar} {r.diasParaLiberar === 1 ? 'dia' : 'dias'}</span>
        <p>
          Volta a gastar no dia <strong>{r.diaLiberado}</strong>, com folga de <strong>{brl(r.taDeBoa)}</strong>.
        </p>
      </div>
    )
  }
  return (
    <div className="status bom">
      <span className="status-pill"><span aria-hidden>✓</span> Tá de boa</span>
      <p>Folga de <strong>{brl(r.taDeBoa)}</strong> em relação ao ideal até ontem.</p>
    </div>
  )
}

function EditorCaixa({ r }: { r: ResumoMes }) {
  const { salvar } = useEstado()
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const t = texto.trim()
    const v = t === '' ? null : lerValor(t)
    if (t !== '' && v == null) return
    setSalvando(true)
    try {
      await salvar(() => api.caixa(r.ano, r.mes, v))
      setEditando(false)
    } finally {
      setSalvando(false)
    }
  }

  if (!editando) {
    return (
      <button
        type="button"
        className="valor-editavel"
        onClick={() => {
          setTexto(r.caixaAtual == null ? '' : (r.caixaAtual < 0 ? '-' : '') + valorParaCampo(r.caixaAtual))
          setEditando(true)
        }}
      >
        {r.caixaAtual == null ? <span className="mudo">definir</span> : <Dinheiro centavos={r.caixaAtual} />}
        <span className="lapis" aria-hidden>✎</span>
      </button>
    )
  }
  return (
    <form className="editor-inline" onSubmit={enviar}>
      <input
        inputMode="decimal"
        autoFocus
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Caixa atual"
        placeholder="0,00"
      />
      <button className="btn primario pequeno" disabled={salvando}>OK</button>
      <button type="button" className="btn fantasma pequeno" onClick={() => setEditando(false)}>
        Cancelar
      </button>
    </form>
  )
}

function Linha(props: { rotulo: string; valor: ReactNode; dica?: string; forte?: boolean }) {
  return (
    <div className={`linha-tabela ${props.forte ? 'forte' : ''}`}>
      <dt>
        {props.rotulo}
        {props.dica && <small>{props.dica}</small>}
      </dt>
      <dd>{props.valor}</dd>
    </div>
  )
}

export function Painel() {
  const { dados, hoje, mesSel, setMesSel } = useEstado()
  const r = useMemo(() => resumoMes(dados, mesSel.ano, mesSel.mes, hoje), [dados, mesSel, hoje])
  const ritmo = useMemo(() => ritmoDoMes(dados, r), [dados, r])
  const ordem = useMemo(() => ordemCategorias(dados), [dados])
  const categorias = useMemo(
    () => porCategoria(lancamentosDoPeriodo(dados, { tipo: 'mes', ano: mesSel.ano, mes: mesSel.mes }, false)),
    [dados, mesSel],
  )
  const ano = useMemo(
    () => mesesDoAno(dados, mesSel.ano, hoje).map((m) => resumoMes(dados, mesSel.ano, m, hoje)),
    [dados, mesSel.ano, hoje],
  )
  const [abrirNumeros] = useState(() => matchMedia('(min-width: 760px)').matches)
  // As marcadas "no painel" aparecem uma a uma; as outras contam no Gasto numa linha só.
  const conferidas = r.plataformas.filter((p) => p.plataforma.no_painel)
  const outras = r.plataformas.filter((p) => !p.plataforma.no_painel).reduce((s, p) => s + p.semFixos, 0)
  const analisadas = rotuloAnalises(dados)

  const mesPassado = hoje.ano * 12 + hoje.mes > r.ano * 12 + r.mes
  // Mês passado aparece como "dia 31 de 31" riscado.
  const quando =
    r.diaAtual === 0 ? 'mês futuro' : mesPassado ? <s>dia {r.dias} de {r.dias}</s> : `dia ${r.diaAtual} de ${r.dias}`

  return (
    <div className="pagina">
      <div className="barra-filtros">
        <SeletorMes valor={mesSel} onChange={setMesSel} hoje={{ ano: hoje.ano, mes: hoje.mes }} />
        <span className="mudo">{quando}</span>
      </div>

      <section className="cartao heroi">
        <div className="heroi-numero">
          <span className="rotulo">Excedente até hoje</span>
          <Dinheiro
            centavos={r.excedenteHoje}
            // Sinal pelo valor arredondado, para "R$ 0,00" não sair colorido.
            className={`numero-heroi ${Math.round(r.excedenteHoje) < 0 ? 'valor-neg' : Math.round(r.excedenteHoje) > 0 ? 'valor-pos' : ''}`}
          />
          <span className="mudo">
            Ideal até ontem {brl(r.atualIdeal)} − gasto {brl(r.gasto)}
          </span>
        </div>
        <Status r={r} />
      </section>

      <div className="grade-tiles">
        <section className="cartao tile">
          <span className="rotulo">Gasto do mês</span>
          <Dinheiro centavos={r.gasto} className="numero-tile" />
          <ul className="composicao">
            {conferidas.map((p) => (
              <li key={p.plataforma.id}>
                <span>
                  {p.plataforma.nome}
                  {p.total !== p.semFixos && <small>sem fixos; total {brl(p.total)}</small>}
                </span>
                <Dinheiro centavos={p.semFixos} />
              </li>
            ))}
            {outras !== 0 && <li><span>Outras plataformas</span><Dinheiro centavos={outras} /></li>}
          </ul>
        </section>
        <section className="cartao tile">
          <span className="rotulo">Excedente do mês</span>
          <Dinheiro centavos={r.excedenteMes} className="numero-tile" />
          <ul className="composicao">
            <li><span>Restante</span><Dinheiro centavos={r.restante} /></li>
            <li><span>− Gasto</span><Dinheiro centavos={r.gasto} /></li>
          </ul>
        </section>
        <section className="cartao tile">
          <span className="rotulo">Caixa (saldo da conta)</span>
          <EditorCaixa r={r} />
          <ul className="composicao">
            <li><span>Caixa proj.</span><Dinheiro centavos={r.caixaProj} /></li>
            <li><span>Invest. proj.</span><Dinheiro centavos={r.investProj} /></li>
          </ul>
        </section>
      </div>

      <section className="cartao">
        <h3>Ritmo do mês</h3>
        <GraficoRitmo pontos={ritmo} diaAtual={r.diaAtual} />
      </section>

      <div className="grade-2">
        <section className="cartao">
          <h3>{analisadas ? `${analisadas} por categoria` : 'Por categoria'}</h3>
          {!analisadas ? (
            <p className="mudo">Nenhuma plataforma nas análises. <a href="#/config">Escolher em Configurações</a></p>
          ) : categorias.fatias.length === 0 ? (
            <p className="mudo">Nenhuma compra neste mês.</p>
          ) : (
            <BarrasCategoria fatias={categorias.fatias} ordem={ordem} total={categorias.total} />
          )}
          <p className="nota">
            Total do mês, com fixos{categorias.semCategoria !== 0 && `; ${brl(categorias.semCategoria)} sem categoria ficam fora`}.{' '}
            <a href="#/analises">Mais análises →</a>
          </p>
        </section>

        <details className="cartao" open={abrirNumeros}>
          <summary><h3>Todos os números</h3></summary>
          <dl className="tabela-numeros">
            <Linha rotulo="Salário" valor={<Dinheiro centavos={r.salario} />} />
            <Linha rotulo="Fixos" valor={<Dinheiro centavos={r.fixos} />} />
            <Linha rotulo="Restante" dica="Salário − Fixos" valor={<Dinheiro centavos={r.restante} />} forte />
            <Linha rotulo="Ideal diário" dica={`Restante ÷ ${r.dias} dias`} valor={<Dinheiro centavos={r.idealDiario} />} />
            {conferidas.map((p) => (
              <Fragment key={p.plataforma.id}>
                <Linha rotulo={`${p.plataforma.nome} total`} dica="tudo; confere com a plataforma" valor={<Dinheiro centavos={p.total} />} />
                <Linha rotulo={`${p.plataforma.nome} sem fixos`} dica="o que entra no Gasto" valor={<Dinheiro centavos={p.semFixos} />} />
              </Fragment>
            ))}
            {outras !== 0 && (
              <Linha rotulo="Outras plataformas" dica="sem fixos; fora da conferência" valor={<Dinheiro centavos={outras} />} />
            )}
            <Linha rotulo="Gasto" dica="todas as plataformas, sem fixos" valor={<Dinheiro centavos={r.gasto} />} forte />
            <Linha rotulo="Excedente do mês" dica="Restante − Gasto" valor={<Dinheiro centavos={r.excedenteMes} />} />
            <Linha rotulo="Atual ideal" dica="(dia − 1) ÷ dias × Restante" valor={<Dinheiro centavos={r.atualIdeal} />} />
            <Linha rotulo="Excedente até hoje" dica="Atual ideal − Gasto" valor={<Dinheiro centavos={r.excedenteHoje} />} forte />
            <Linha
              rotulo="Dias p/ liberar"
              valor={r.diasParaLiberar ?? '—'}
            />
            <Linha rotulo="Dia liberado" valor={r.diaLiberado ?? '—'} />
            <Linha rotulo="Tá de boa" valor={<Dinheiro centavos={r.taDeBoa} />} />
            <Linha rotulo="Caixa atual" valor={r.caixaAtual == null ? '—' : <Dinheiro centavos={r.caixaAtual} />} />
            <Linha rotulo="Caixa proj." valor={<Dinheiro centavos={r.caixaProj} />} />
            <Linha rotulo="Invest. proj." valor={<Dinheiro centavos={r.investProj} />} />
          </dl>
        </details>
      </div>

      <section className="cartao">
        <h3>{mesSel.ano}</h3>
        <div className="tabela-rolavel">
          <table className="tabela">
            <thead>
              <tr>
                <th>Mês</th>
                <th className="num">Gasto</th>
                <th className="num">Excedente mês</th>
                <th className="num so-desktop">Até hoje</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ano.map((m) => (
                <tr
                  key={m.mes}
                  className={m.mes === mesSel.mes ? 'selecionada' : ''}
                  onClick={() => setMesSel({ ano: m.ano, mes: m.mes })}
                >
                  <td>
                    <button type="button" className="link-linha" onClick={() => setMesSel({ ano: m.ano, mes: m.mes })}>
                      <span className="so-desktop">{nomeMes(m.mes)}</span>
                      <span className="so-celular">{mesCurto(m.mes)}</span>
                    </button>
                  </td>
                  <td className="num"><Dinheiro centavos={m.gasto} /></td>
                  <td className="num"><Dinheiro centavos={m.excedenteMes} /></td>
                  <td className="num so-desktop"><Dinheiro centavos={m.excedenteHoje} /></td>
                  <td>
                    {m.diasParaLiberar === 'PARE!' ? (
                      <span className="tag critico">✋ PARE!</span>
                    ) : typeof m.diasParaLiberar === 'number' ? (
                      <span className="tag alerta">⏳ {m.diasParaLiberar}d</span>
                    ) : (
                      <span className="tag bom">✓ ok</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
