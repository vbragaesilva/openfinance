import { useState, type FormEvent } from 'react'
import { useEstado } from '../estado.tsx'
import { hojeISO } from '../lib/formato.ts'
import type { SplitItem, Tipo } from '../lib/tipos.ts'
import { AcoesForm, Campo, CampoValor, Erro, Segmentado } from './ui.tsx'

export function FormSplit(props: {
  item?: SplitItem
  /** Valores iniciais de um split novo (ex.: vindos de uma notificação do Splitwise). */
  inicial?: { data?: string; nome?: string; valor_centavos?: number }
  /** Chamado depois de criar um split novo. */
  onCriado?: () => Promise<void>
  onPronto: () => void
}) {
  const { criar, atualizar, apagar } = useEstado()
  const s = props.item
  const [data, setData] = useState(s?.data ?? props.inicial?.data ?? hojeISO())
  const [nome, setNome] = useState(s?.nome ?? props.inicial?.nome ?? '')
  const [valor, setValor] = useState<number | null>(s?.valor_centavos ?? props.inicial?.valor_centavos ?? null)
  const [fixo, setFixo] = useState<Tipo>(s?.fixo ?? 'Variável')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function executar(f: () => Promise<void>) {
    setSalvando(true)
    setErro(null)
    try {
      await f()
      props.onPronto()
    } catch (err) {
      setErro((err as Error).message)
      setSalvando(false)
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (valor == null) return setErro('Informe o valor.')
    const corpo = { data, nome, valor_centavos: valor, fixo }
    executar(async () => {
      if (s) return atualizar('split', s.id, corpo)
      await criar('split', corpo)
      await props.onCriado?.()
    })
  }

  return (
    <form className="form" onSubmit={enviar}>
      <Campo
        rotulo="Valor"
        htmlFor="s-valor"
        dica="Positivo soma no gasto do mês; negativo abate (como na coluna Valor da aba Split)."
      >
        <CampoValor id="s-valor" centavos={valor} onChange={setValor} autoFocus={!s} />
      </Campo>
      <div className="linha-2">
        <Campo rotulo="Nome" htmlFor="s-nome">
          <input id="s-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
        </Campo>
        <Campo rotulo="Data" htmlFor="s-data">
          <input id="s-data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </Campo>
      </div>
      <Segmentado
        rotulo="Fixo?"
        valor={fixo}
        onChange={setFixo}
        opcoes={[
          { valor: 'Variável', texto: 'Variável' },
          { valor: 'Fixo', texto: 'Fixo' },
        ]}
      />
      <Erro erro={erro} />
      <AcoesForm
        salvando={salvando}
        onApagar={s ? () => executar(() => apagar('split', s.id)) : undefined}
        textoSalvar={s ? 'Salvar' : 'Lançar split'}
      />
    </form>
  )
}
