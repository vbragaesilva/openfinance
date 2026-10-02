import { useState, type FormEvent } from 'react'
import { api } from '../api.ts'
import { Campo, CampoValor, Dinheiro, Erro, Folha, SeletorMes } from '../componentes/ui.tsx'
import { useEstado, type MesSel } from '../estado.tsx'
import { dataCurta, hojeISO, lerValor, mesCurto, nomeMes, valorParaCampo } from '../lib/formato.ts'
import {
  chaveMes, fixosDoMes, pagamentoNoMes, proximoVencimento, salarioDoMes, statusFixos, type FixoNoMes,
} from '../lib/painel.ts'

const rotuloMes = (chave: string) => `${mesCurto(Number(chave.slice(5, 7)))}/${chave.slice(2, 4)}`
const mesAnterior = ({ ano, mes }: MesSel) => (mes === 1 ? chaveMes(ano - 1, 12) : chaveMes(ano, mes - 1))

/** Executa uma ação de escrita com estado de envio e mensagem de erro. */
function useAcao() {
  const { salvar } = useEstado()
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  async function executar(f: () => Promise<unknown>, depois?: () => void) {
    setSalvando(true)
    setErro(null)
    try {
      await salvar(f)
      depois?.()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }
  return { salvando, erro, setErro, executar }
}

function FormNovoFixo(props: { mes: MesSel; onPronto: () => void }) {
  const { salvando, erro, setErro, executar } = useAcao()
  const [nome, setNome] = useState('')
  const [valor, setValor] = useState<number | null>(null)
  const [investimento, setInvestimento] = useState(false)

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return setErro('Informe o nome.')
    if (valor == null) return setErro('Informe o valor.')
    const inicio = chaveMes(props.mes.ano, props.mes.mes)
    executar(() => api.criarFixo({ nome, valor_centavos: valor, investimento, inicio }), props.onPronto)
  }

  return (
    <form className="form" onSubmit={enviar}>
      <Campo rotulo="Nome" htmlFor="nf-nome">
        <input id="nf-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      </Campo>
      <Campo rotulo="Valor" htmlFor="nf-valor">
        <CampoValor id="nf-valor" centavos={valor} onChange={setValor} />
      </Campo>
      <label className="checkbox">
        <input type="checkbox" checked={investimento} onChange={(e) => setInvestimento(e.target.checked)} />
        É o investimento do mês (usado no “Invest. proj.” do painel)
      </label>
      <p className="campo-dica">Começa a contar em {nomeMes(props.mes.mes)} {props.mes.ano}; meses anteriores não mudam.</p>
      <Erro erro={erro} />
      <div className="acoes-form">
        <button className="btn primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Adicionar'}</button>
      </div>
    </form>
  )
}

function FormFixo(props: { item: FixoNoMes; mes: MesSel; onPronto: () => void }) {
  const { fixo } = props.item
  const chave = chaveMes(props.mes.ano, props.mes.mes)
  const { salvando, erro, setErro, executar } = useAcao()
  const [nome, setNome] = useState(fixo.nome)
  const [investimento, setInvestimento] = useState(fixo.investimento)
  const [valor, setValor] = useState<number | null>(props.item.valor)
  const [dataPagamento, setDataPagamento] = useState(hojeISO())
  const [confirmar, setConfirmar] = useState<'encerrar' | 'apagar' | null>(null)

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return setErro('Informe o nome.')
    if (valor == null) return setErro('Informe o valor.')
    executar(async () => {
      if (nome !== fixo.nome || investimento !== fixo.investimento) await api.atualizarFixo(fixo.id, { nome, investimento })
      if (valor !== props.item.valor) await api.valorFixo(fixo.id, chave, valor)
    }, props.onPronto)
  }

  const pagamentos = [...fixo.pagamentos].reverse().slice(0, 6)

  return (
    <form className="form" onSubmit={enviar}>
      <Campo rotulo="Nome" htmlFor="f-nome" dica="Nome e “investimento” valem para todos os meses.">
        <input id="f-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      </Campo>
      <Campo
        rotulo={`Valor a partir de ${nomeMes(props.mes.mes)} ${props.mes.ano}`}
        htmlFor="f-valor"
        dica="Meses anteriores continuam com o valor que tinham."
      >
        <CampoValor id="f-valor" centavos={valor} onChange={setValor} />
      </Campo>
      {fixo.valores.length > 1 && (
        <details className="historico">
          <summary>Histórico de valores</summary>
          <ul>
            {fixo.valores.map((v) => (
              <li key={v.desde}>
                <span>desde {rotuloMes(v.desde)}</span>
                <Dinheiro centavos={v.valor_centavos} />
                <button
                  type="button"
                  className="btn-texto perigo-texto"
                  disabled={salvando}
                  onClick={() => executar(() => api.apagarValorFixo(fixo.id, v.desde), props.onPronto)}
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={investimento} onChange={(e) => setInvestimento(e.target.checked)} />
        É o investimento do mês (usado no “Invest. proj.” do painel)
      </label>

      <fieldset className="campo">
        <legend>Pagamentos</legend>
        {pagamentos.length === 0 && <p className="campo-dica">Nenhum pagamento registrado.</p>}
        <ul className="pagamentos">
          {pagamentos.map((p) => (
            <li key={p.id}>
              <span>{dataCurta(p.data)}/{p.data.slice(2, 4)}</span>
              <button
                type="button"
                className="btn-texto perigo-texto"
                disabled={salvando}
                onClick={() => executar(() => api.apagarPagamento(p.id))}
              >
                remover
              </button>
            </li>
          ))}
        </ul>
        <div className="editor-inline">
          <input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} aria-label="Data do pagamento" />
          <button
            type="button"
            className="btn pequeno"
            disabled={salvando || !dataPagamento}
            onClick={() => executar(() => api.pagarFixo(fixo.id, dataPagamento))}
          >
            Registrar
          </button>
        </div>
      </fieldset>

      <Erro erro={erro} />
      <div className="acoes-form quebra">
        {confirmar === 'encerrar' ? (
          <button
            type="button"
            className="btn perigo"
            disabled={salvando}
            onClick={() => executar(() => api.atualizarFixo(fixo.id, { fim: mesAnterior(props.mes) }), props.onPronto)}
          >
            Confirmar: some a partir de {mesCurto(props.mes.mes)}/{String(props.mes.ano).slice(2)}
          </button>
        ) : confirmar === 'apagar' ? (
          <button
            type="button"
            className="btn perigo"
            disabled={salvando}
            onClick={() => executar(() => api.apagarFixo(fixo.id), props.onPronto)}
          >
            Confirmar: apagar de todos os meses
          </button>
        ) : (
          <>
            {fixo.inicio < chave && (
              <button type="button" className="btn fantasma perigo-texto" onClick={() => setConfirmar('encerrar')}>
                Encerrar
              </button>
            )}
            <button type="button" className="btn fantasma perigo-texto" onClick={() => setConfirmar('apagar')}>
              Apagar
            </button>
          </>
        )}
        <button type="submit" className="btn primario" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}

function Salario({ mes }: { mes: MesSel }) {
  const { dados } = useEstado()
  const { salvando, erro, executar } = useAcao()
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const atual = salarioDoMes(dados, mes.ano, mes.mes)
  const chave = chaveMes(mes.ano, mes.mes)

  function enviar(e: FormEvent) {
    e.preventDefault()
    const v = lerValor(texto)
    if (v == null) return
    executar(() => api.salario(chave, v), () => setEditando(false))
  }

  return (
    <section className="cartao tile">
      <span className="rotulo">Salário</span>
      {editando ? (
        <form className="editor-inline" onSubmit={enviar}>
          <input inputMode="decimal" autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Salário" />
          <button className="btn primario pequeno" disabled={salvando}>OK</button>
          <button type="button" className="btn fantasma pequeno" onClick={() => setEditando(false)}>Cancelar</button>
        </form>
      ) : (
        <button
          type="button"
          className="valor-editavel"
          onClick={() => {
            setTexto(atual ? valorParaCampo(atual.valor_centavos) : '')
            setEditando(true)
          }}
        >
          {atual ? <Dinheiro centavos={atual.valor_centavos} /> : <span className="mudo">definir</span>}
          <span className="lapis" aria-hidden>✎</span>
        </button>
      )}
      <span className="mudo">
        {editando ? `vale a partir de ${mesCurto(mes.mes)}/${String(mes.ano).slice(2)}` : atual ? `desde ${rotuloMes(atual.desde)}` : 'sem salário neste mês'}
      </span>
      <Erro erro={erro} />
      {dados.salarios.length > 1 && (
        <details className="historico">
          <summary>Histórico</summary>
          <ul>
            {dados.salarios.map((s) => (
              <li key={s.desde}>
                <span>desde {rotuloMes(s.desde)}</span>
                <Dinheiro centavos={s.valor_centavos} />
                <button type="button" className="btn-texto perigo-texto" disabled={salvando} onClick={() => executar(() => api.apagarSalario(s.desde))}>
                  remover
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

export function Fixos() {
  const { dados, hoje, mesSel, setMesSel } = useEstado()
  const { salvando, executar } = useAcao()
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [novo, setNovo] = useState(false)

  const lista = fixosDoMes(dados, mesSel.ano, mesSel.mes)
  // Derivado dos dados atuais, para o formulário ver pagamentos recém-registrados.
  const editando = lista.find((f) => f.fixo.id === editandoId) ?? null
  const status = statusFixos(dados, mesSel.ano, mesSel.mes)
  const total = lista.reduce((s, f) => s + f.valor, 0)
  const salario = salarioDoMes(dados, mesSel.ano, mesSel.mes)?.valor_centavos ?? 0
  const pendentes = lista.filter((f) => !pagamentoNoMes(f.fixo, mesSel.ano, mesSel.mes)).length
  const ehMesAtual = mesSel.ano === hoje.ano && mesSel.mes === hoje.mes

  return (
    <div className="pagina">
      <div className="barra-filtros">
        <SeletorMes valor={mesSel} onChange={setMesSel} hoje={{ ano: hoje.ano, mes: hoje.mes }} />
        <span className={`tag grande ${status === 'QUITADO' ? 'bom' : 'alerta'}`}>
          {status === 'QUITADO' ? '✓ QUITADO' : `⏳ Pendente · ${pendentes} de ${lista.length}`}
        </span>
        <button type="button" className="btn primario empurra" onClick={() => setNovo(true)}>
          + Fixo
        </button>
      </div>

      <div className="grade-tiles">
        <Salario key={`${mesSel.ano}-${mesSel.mes}`} mes={mesSel} />
        <section className="cartao tile">
          <span className="rotulo">Total fixos</span>
          <Dinheiro centavos={total} className="numero-tile" />
        </section>
        <section className="cartao tile">
          <span className="rotulo">Restante</span>
          <Dinheiro centavos={salario - total} className="numero-tile" />
          <span className="mudo">Salário − Fixos</span>
        </section>
      </div>

      <section className="cartao lista-cartao">
        {lista.length === 0 && <p className="vazio">Nenhum fixo neste mês.</p>}
        <ul className="lista">
          {lista.map((item) => {
            const { fixo } = item
            const pago = pagamentoNoMes(fixo, mesSel.ano, mesSel.mes)
            const ultimo = fixo.pagamentos.at(-1)
            const prox = proximoVencimento(fixo)
            return (
              <li key={fixo.id} className="item-com-acao">
                <button type="button" className="item" onClick={() => setEditandoId(item.fixo.id)}>
                  <span className="item-principal">
                    <span className="item-titulo">
                      {fixo.nome}
                      {fixo.investimento && <span className="tag neutro">invest</span>}
                    </span>
                    <span className="item-sub">
                      {pago
                        ? `pago ${dataCurta(pago.data)}`
                        : ultimo
                          ? `último pagamento ${dataCurta(ultimo.data)}/${ultimo.data.slice(2, 4)}`
                          : 'nunca pago'}
                      {ehMesAtual && prox && ` · próximo: ${nomeMes(prox.mes)}`}
                      {item.desde > fixo.inicio && ` · valor desde ${rotuloMes(item.desde)}`}
                    </span>
                  </span>
                  <Dinheiro centavos={item.valor} />
                </button>
                {pago ? (
                  <span className="tag bom">✓ pago</span>
                ) : ehMesAtual ? (
                  <button
                    type="button"
                    className="btn pequeno"
                    disabled={salvando}
                    onClick={() => executar(() => api.pagarFixo(fixo.id, hojeISO()))}
                  >
                    Paguei hoje
                  </button>
                ) : (
                  <span className="tag alerta">pendente</span>
                )}
              </li>
            )
          })}
        </ul>
      </section>
      <p className="nota">
        QUITADO = todos os fixos do mês com pagamento registrado dentro dele. Valores e salário valem do mês em que
        foram definidos em diante, então mudar algo aqui não altera meses anteriores.
      </p>

      <Folha titulo={`Novo fixo · ${nomeMes(mesSel.mes)} ${mesSel.ano}`} aberta={novo} onFechar={() => setNovo(false)}>
        {novo && <FormNovoFixo mes={mesSel} onPronto={() => setNovo(false)} />}
      </Folha>
      <Folha titulo="Editar fixo" aberta={editando != null} onFechar={() => setEditandoId(null)}>
        {editando && <FormFixo key={editando.fixo.id} item={editando} mes={mesSel} onPronto={() => setEditandoId(null)} />}
      </Folha>
    </div>
  )
}
