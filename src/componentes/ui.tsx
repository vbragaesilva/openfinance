import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { brl, nomeMes, valorParaCampo, lerValor } from '../lib/formato.ts'
import type { MesSel } from '../estado.tsx'

/** Modal: bottom sheet no celular, caixa centralizada no desktop. */
export function Folha(props: { titulo: string; aberta: boolean; onFechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (props.aberta && !d.open) d.showModal()
    if (!props.aberta && d.open) d.close()
  }, [props.aberta])
  return (
    <dialog
      ref={ref}
      className="folha"
      onClose={props.onFechar}
      onClick={(e) => {
        if (e.target === ref.current) props.onFechar()
      }}
    >
      {props.aberta && (
        <div className="folha-corpo">
          <header className="folha-topo">
            <h2>{props.titulo}</h2>
            <button type="button" className="btn-icone" onClick={props.onFechar} aria-label="Fechar">
              ✕
            </button>
          </header>
          {props.children}
        </div>
      )}
    </dialog>
  )
}

export function SeletorMes(props: { valor: MesSel; onChange: (m: MesSel) => void; hoje?: MesSel }) {
  const { ano, mes } = props.valor
  const mover = (delta: number) => {
    const idx = ano * 12 + (mes - 1) + delta
    props.onChange({ ano: Math.floor(idx / 12), mes: (idx % 12) + 1 })
  }
  const ehHoje = props.hoje && props.hoje.ano === ano && props.hoje.mes === mes
  return (
    <div className="seletor-mes">
      <button type="button" className="btn-icone" onClick={() => mover(-1)} aria-label="Mês anterior">
        ‹
      </button>
      <span className="seletor-mes-rotulo">
        {nomeMes(mes)} <span className="mudo">{ano}</span>
      </span>
      <button type="button" className="btn-icone" onClick={() => mover(1)} aria-label="Próximo mês">
        ›
      </button>
      {props.hoje && !ehHoje && (
        <button type="button" className="btn-texto" onClick={() => props.onChange(props.hoje!)}>
          hoje
        </button>
      )}
    </div>
  )
}

export function Segmentado<T extends string>(props: {
  rotulo: string
  /** Mostra o rótulo acima do controle (por padrão só vai para leitores de tela). */
  visivel?: boolean
  opcoes: { valor: T; texto: string }[]
  valor: T
  onChange: (v: T) => void
}) {
  const nome = useId()
  const controle = (
    <div className="segmentado" role="radiogroup" aria-label={props.rotulo}>
      {props.opcoes.map((o) => (
        <label key={o.valor} className={o.valor === props.valor ? 'ativo' : ''}>
          <input
            type="radio"
            name={nome}
            value={o.valor}
            checked={o.valor === props.valor}
            onChange={() => props.onChange(o.valor)}
          />
          {o.texto}
        </label>
      ))}
    </div>
  )
  if (!props.visivel) return controle
  return (
    <div className="campo">
      <span className="campo-rotulo" aria-hidden>{props.rotulo}</span>
      {controle}
    </div>
  )
}

/**
 * Campo de dinheiro com botão de sinal (o teclado decimal do iPhone não tem "-").
 * Negativo = entra dinheiro / abate do gasto.
 */
export function CampoValor(props: {
  id?: string
  centavos: number | null
  onChange: (c: number | null) => void
  autoFocus?: boolean
}) {
  const [texto, setTexto] = useState(props.centavos == null ? '' : valorParaCampo(props.centavos))
  const [negativo, setNegativo] = useState((props.centavos ?? 0) < 0)

  const emitir = (t: string, neg: boolean) => {
    const v = lerValor(t.replace('-', ''))
    props.onChange(v == null ? null : neg ? -v : v)
  }

  return (
    <div className={`campo-valor ${negativo ? 'negativo' : ''}`}>
      <button
        type="button"
        className="campo-valor-sinal"
        onClick={() => {
          setNegativo(!negativo)
          emitir(texto, !negativo)
        }}
        aria-label={negativo ? 'Valor negativo (entrada). Tocar para tornar positivo' : 'Valor positivo (gasto). Tocar para tornar negativo'}
        title="Trocar sinal"
      >
        {negativo ? '−' : '+'}
      </button>
      <span className="campo-valor-moeda">R$</span>
      <input
        id={props.id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={texto}
        autoFocus={props.autoFocus}
        onChange={(e) => {
          let t = e.target.value
          let neg = negativo
          if (t.includes('-')) {
            neg = !neg
            t = t.replace(/-/g, '')
            setNegativo(neg)
          }
          setTexto(t)
          emitir(t, neg)
        }}
      />
    </div>
  )
}

export function Dinheiro(props: { centavos: number; sinal?: boolean; className?: string }) {
  const classe = props.centavos < 0 ? 'neg' : ''
  return <span className={`dinheiro ${classe} ${props.className ?? ''}`}>{brl(props.centavos, { sinal: props.sinal })}</span>
}

export function Campo(props: { rotulo: string; htmlFor?: string; dica?: ReactNode; children: ReactNode }) {
  return (
    <div className="campo">
      <label htmlFor={props.htmlFor}>{props.rotulo}</label>
      {props.children}
      {props.dica && <p className="campo-dica">{props.dica}</p>}
    </div>
  )
}

/** Botões do rodapé de um formulário de edição, com confirmação para apagar. */
export function AcoesForm(props: { salvando: boolean; onApagar?: () => void; textoSalvar?: string }) {
  const [confirmando, setConfirmando] = useState(false)
  return (
    <div className="acoes-form">
      {props.onApagar &&
        (confirmando ? (
          <button type="button" className="btn perigo" onClick={props.onApagar} disabled={props.salvando}>
            Confirmar exclusão
          </button>
        ) : (
          <button type="button" className="btn fantasma perigo-texto" onClick={() => setConfirmando(true)}>
            Apagar
          </button>
        ))}
      <button type="submit" className="btn primario" disabled={props.salvando}>
        {props.salvando ? 'Salvando…' : props.textoSalvar ?? 'Salvar'}
      </button>
    </div>
  )
}

export function Erro(props: { erro: string | null }) {
  return props.erro ? (
    <p className="erro" role="alert">
      {props.erro}
    </p>
  ) : null
}
