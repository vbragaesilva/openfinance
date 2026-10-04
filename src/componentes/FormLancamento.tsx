import { useMemo, useState, type FormEvent } from 'react'
import { useEstado } from '../estado.tsx'
import { brl, hojeISO } from '../lib/formato.ts'
import { gerarParcelas } from '../lib/parcelas.ts'
import type { Lancamento, Tipo } from '../lib/tipos.ts'
import { AcoesForm, Campo, CampoValor, Erro, Segmentado } from './ui.tsx'

/** Valores distintos de um campo, do mais usado para o menos usado. */
function maisUsados(valores: (string | null)[]) {
  const n = new Map<string, number>()
  for (const v of valores) if (v) n.set(v, (n.get(v) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v)
}

export function FormLancamento(props: {
  lancamento?: Lancamento
  /** Valores iniciais de um lançamento novo (ex.: vindos de uma notificação do Splitwise). */
  inicial?: { data?: string; produto?: string; valor_centavos?: number; tipo?: Tipo; plataforma_id?: number }
  /** Chamado depois de criar um lançamento novo. */
  onCriado?: () => Promise<void>
  onPronto: () => void
}) {
  const { dados, criar, atualizar, apagar } = useEstado()
  const l = props.lancamento
  const ini = props.inicial
  const [data, setData] = useState(l?.data ?? ini?.data ?? hojeISO())
  const [produto, setProduto] = useState(l?.produto ?? ini?.produto ?? '')
  const [local, setLocal] = useState(l?.local ?? '')
  const [valor, setValor] = useState<number | null>(l?.valor_centavos ?? ini?.valor_centavos ?? null)
  const [categoria, setCategoria] = useState<string | null>(l?.categoria ?? null)
  const [novaCategoria, setNovaCategoria] = useState('')
  // Ativas, mais a do lançamento sendo editado (mesmo se já desativada).
  const plataformas = dados.plataformas.filter((p) => p.ativa || p.id === l?.plataforma_id)
  const [plataformaId, setPlataformaId] = useState<number | undefined>(
    l?.plataforma_id ?? ini?.plataforma_id ?? plataformas[0]?.id,
  )
  const plataforma = dados.plataformas.find((p) => p.id === plataformaId)
  const [tipo, setTipo] = useState<Tipo | ''>(l ? l.tipo ?? '' : ini?.tipo ?? 'Variável')
  const [parcelas, setParcelas] = useState(1)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const sugestoes = useMemo(
    () => ({
      produtos: maisUsados(dados.lancamentos.map((x) => x.produto)).slice(0, 200),
      locais: maisUsados(dados.lancamentos.map((x) => x.local)).slice(0, 200),
      categorias: maisUsados(dados.lancamentos.map((x) => x.categoria)),
    }),
    [dados.lancamentos],
  )

  const nParcelas = !l ? parcelas : 1
  const fechamento = plataforma?.fechamento ?? 1
  const previa = valor != null && nParcelas > 1 ? gerarParcelas(data, valor, nParcelas, fechamento) : null

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (valor == null) return setErro('Informe o valor.')
    if (plataformaId == null) return setErro('Escolha a plataforma.')
    const cat = novaCategoria.trim() || categoria
    const base = { produto, local, categoria: cat, plataforma_id: plataformaId, tipo: tipo || null }
    setSalvando(true)
    setErro(null)
    try {
      if (l) await atualizar(l.id, { ...base, data, valor_centavos: valor })
      else {
        await criar(gerarParcelas(data, valor, nParcelas, fechamento).map((p) => ({ ...base, ...p })))
        await props.onCriado?.()
      }
      props.onPronto()
    } catch (err) {
      setErro((err as Error).message)
      setSalvando(false)
    }
  }

  async function remover() {
    if (!l) return
    setSalvando(true)
    try {
      await apagar(l.id)
      props.onPronto()
    } catch (err) {
      setErro((err as Error).message)
      setSalvando(false)
    }
  }

  return (
    <form className="form" onSubmit={enviar}>
      <Campo rotulo="Valor" htmlFor="l-valor" dica={valor != null && valor < 0 ? 'Negativo: abate do gasto do mês (reembolso, pix recebido…)' : undefined}>
        <CampoValor id="l-valor" centavos={valor} onChange={setValor} autoFocus={!l} />
      </Campo>

      <fieldset className="campo">
        <legend>Plataforma</legend>
        <div className="chips">
          {plataformas.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`chip ${plataformaId === p.id ? 'ativo' : ''}`}
              aria-pressed={plataformaId === p.id}
              onClick={() => setPlataformaId(p.id)}
            >
              {p.nome}
            </button>
          ))}
          {plataformas.length === 0 && (
            <span className="mudo">Nenhuma plataforma ativa. <a href="#/config">Criar em Configurações</a></span>
          )}
        </div>
      </fieldset>

      <div className="linha-2">
        <Campo rotulo="Produto" htmlFor="l-produto">
          <input id="l-produto" list="l-produtos" value={produto} onChange={(e) => setProduto(e.target.value)} autoComplete="off" />
          <datalist id="l-produtos">
            {sugestoes.produtos.map((p) => <option key={p} value={p} />)}
          </datalist>
        </Campo>
        <Campo rotulo="Local" htmlFor="l-local">
          <input id="l-local" list="l-locais" value={local} onChange={(e) => setLocal(e.target.value)} autoComplete="off" />
          <datalist id="l-locais">
            {sugestoes.locais.map((p) => <option key={p} value={p} />)}
          </datalist>
        </Campo>
      </div>

      <div className="linha-2">
        <Campo rotulo="Data" htmlFor="l-data">
          <input id="l-data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </Campo>
        {!l && (
          <Campo rotulo="Parcelas" htmlFor="l-parcelas">
            <input
              id="l-parcelas"
              type="number"
              min={1}
              max={24}
              value={parcelas}
              onChange={(e) => setParcelas(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
            />
          </Campo>
        )}
      </div>
      {previa && (
        <p className="campo-dica">
          {previa.length}× de {brl(previa[1].valor_centavos)}
          {previa[0].valor_centavos !== previa[1].valor_centavos && ` (1ª ${brl(previa[0].valor_centavos)})`} — a 1ª em{' '}
          {previa[0].data.split('-').reverse().join('/')}, as outras no dia {fechamento === 1 ? '1º' : fechamento} dos meses seguintes. O valor acima é o total.
        </p>
      )}

      <fieldset className="campo">
        <legend>Categoria</legend>
        <div className="chips">
          {[null, ...sugestoes.categorias].map((c) => (
            <button
              type="button"
              key={c ?? '—'}
              className={`chip ${!novaCategoria && categoria === c ? 'ativo' : ''}`}
              aria-pressed={!novaCategoria && categoria === c}
              onClick={() => {
                setCategoria(c)
                setNovaCategoria('')
              }}
            >
              {c ?? 'Nenhuma'}
            </button>
          ))}
          <input
            className="chip-input"
            placeholder="outra…"
            aria-label="Nova categoria"
            value={novaCategoria}
            onChange={(e) => setNovaCategoria(e.target.value)}
          />
        </div>
      </fieldset>

      <Segmentado
        rotulo="Tipo"
        visivel
        valor={tipo}
        onChange={setTipo}
        opcoes={[
          { valor: 'Variável', texto: 'Variável' },
          { valor: 'Fixo', texto: 'Fixo' },
          { valor: '', texto: 'Sem tipo' },
        ]}
      />

      <Erro erro={erro} />
      <AcoesForm salvando={salvando} onApagar={l ? remover : undefined} textoSalvar={l ? 'Salvar' : nParcelas > 1 ? `Lançar ${nParcelas} parcelas` : 'Lançar'} />
    </form>
  )
}
