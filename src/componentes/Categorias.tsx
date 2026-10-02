import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Fatia, MesCategorias } from '../lib/analises.ts'
import { brl, mesCurto } from '../lib/formato.ts'

const MAX_CORES = 8

/** Cor fixa da categoria pela ordem global (nunca pela posição no filtro atual). */
export function corCategoria(ordem: string[], categoria: string) {
  const i = ordem.indexOf(categoria)
  return i >= 0 && i < MAX_CORES ? `var(--cat-${i + 1})` : 'var(--cat-outras)'
}

const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0)

/** Barras horizontais por categoria, com valor e % na ponta. */
export function BarrasCategoria(props: { fatias: Fatia[]; ordem: string[]; total: number }) {
  const max = Math.max(1, ...props.fatias.map((f) => f.valor))
  return (
    <ul className="barras">
      {props.fatias.map((f) => (
        <li key={f.categoria} title={`${f.categoria}: ${brl(f.valor)} (${pct(f.valor, props.total)}%)`}>
          <span className="barras-rotulo">{f.categoria}</span>
          <span className="barras-trilho">
            <span
              className="barras-barra"
              style={{ '--r': f.valor / max, background: corCategoria(props.ordem, f.categoria) } as CSSProperties}
            />
            <span className="barras-valor">
              {brl(f.valor)} <span className="mudo">{pct(f.valor, props.total)}%</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Legenda(props: { categorias: string[]; ordem: string[] }) {
  return (
    <div className="legenda">
      {props.categorias.map((c) => (
        <span key={c}>
          <i className="chave-quadrado" style={{ background: corCategoria(props.ordem, c) }} /> {c}
        </span>
      ))}
    </div>
  )
}

const ALTURA = 220
const M = { top: 18, right: 8, bottom: 24, left: 48 }
const LARGURA_COLUNA = 24
const GAP = 2

function ticksLimpos(max: number, alvo = 5) {
  if (max <= 0) return [0]
  const bruto = max / alvo
  const pot = 10 ** Math.floor(Math.log10(bruto))
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto) ?? bruto
  const ticks = [0]
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + passo)
  return ticks
}

const compacto = (centavos: number) => {
  const r = centavos / 100
  return r >= 1000 ? `${(r / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : r.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

/** Colunas empilhadas por mês, uma cor por categoria (na ordem fixa). */
export function ColunasMensais(props: {
  meses: MesCategorias[]
  ordem: string[]
  destaque?: string // AAAA-MM
  onEscolher?: (m: MesCategorias) => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = caixa.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setLargura(Math.max(260, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { meses, ordem } = props
  const ticks = ticksLimpos(Math.max(1, ...meses.map((m) => m.total)))
  const maxY = ticks[ticks.length - 1]
  const w = largura - M.left - M.right
  const h = ALTURA - M.top - M.bottom
  const banda = w / Math.max(meses.length, 1)
  const col = Math.min(LARGURA_COLUNA, banda * 0.6)
  const y = (v: number) => M.top + h - (v / maxY) * h
  const mostrarTotais = banda >= 44
  const mostrarAno = new Set(meses.map((m) => m.ano)).size > 1
  const categoriasPresentes = ordem.filter((c) => meses.some((m) => (m.porCategoria.get(c) ?? 0) > 0))
  const extras = [...new Set(meses.flatMap((m) => [...m.porCategoria.keys()]))].filter((c) => !ordem.includes(c))
  const empilhar = [...categoriasPresentes, ...extras]
  const m = hover != null ? meses[hover] : null

  return (
    <div className="grafico" ref={caixa}>
      <Legenda categorias={empilhar} ordem={ordem} />
      <div className="grafico-area">
        <svg width={largura} height={ALTURA} role="img" aria-label="Crédito por categoria, mês a mês" onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grade" x1={M.left} x2={largura - M.right} y1={y(t)} y2={y(t)} />
              <text className="eixo" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {compacto(t)}
              </text>
            </g>
          ))}
          {meses.map((mes, i) => {
            const cx = M.left + banda * i + banda / 2
            const segmentos: { cat: string; y0: number; y1: number }[] = []
            let acc = 0
            for (const cat of empilhar) {
              const v = mes.porCategoria.get(cat) ?? 0
              if (v <= 0) continue
              segmentos.push({ cat, y0: acc, y1: acc + v })
              acc += v
            }
            const apagado = (hover != null && hover !== i) || (props.destaque != null && hover == null && props.destaque !== mes.chave)
            return (
              <g key={mes.chave} className={apagado ? 'coluna apagada' : 'coluna'}>
                {props.destaque === mes.chave && (
                  <rect className="faixa-destaque" x={M.left + banda * i} y={M.top} width={banda} height={h} rx={6} />
                )}
                {segmentos.map((s, j) => {
                  const topo = j === segmentos.length - 1
                  const yTop = y(s.y1)
                  // 2px de respiro entre segmentos; o de baixo fica colado na base.
                  const altura = Math.max(0, y(s.y0) - yTop - (j > 0 ? GAP : 0))
                  if (altura <= 0) return null
                  return topo ? (
                    <path
                      key={s.cat}
                      d={colunaArredondada(cx - col / 2, yTop, col, altura, Math.min(4, altura))}
                      fill={corCategoria(ordem, s.cat)}
                    />
                  ) : (
                    <rect key={s.cat} x={cx - col / 2} y={yTop} width={col} height={altura} fill={corCategoria(ordem, s.cat)} />
                  )
                })}
                {mostrarTotais && mes.total > 0 && (
                  <text className="valor-topo" x={cx} y={y(mes.total) - 6} textAnchor="middle">
                    {compacto(mes.total)}
                  </text>
                )}
                <text className={`eixo ${props.destaque === mes.chave ? 'eixo-forte' : ''}`} x={cx} y={ALTURA - 6} textAnchor="middle">
                  {mesCurto(mes.mes)}
                  {mostrarAno && mes.mes === 1 ? ` ${String(mes.ano).slice(2)}` : ''}
                </text>
                <rect
                  className="alvo"
                  x={M.left + banda * i}
                  y={M.top}
                  width={banda}
                  height={h + M.bottom}
                  tabIndex={0}
                  aria-label={`${mesCurto(mes.mes)} ${mes.ano}: ${brl(mes.total)}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => props.onEscolher?.(mes)}
                  style={{ cursor: props.onEscolher ? 'pointer' : undefined }}
                />
              </g>
            )
          })}
        </svg>
        {m && hover != null && (
          <div
            className="tooltip"
            style={{ left: Math.min(Math.max(M.left + banda * hover + banda / 2, 100), largura - 100), top: 0 }}
          >
            <div className="tooltip-titulo">
              {mesCurto(m.mes)} {m.ano} · {brl(m.total)}
            </div>
            {empilhar
              .filter((c) => (m.porCategoria.get(c) ?? 0) > 0)
              .reverse()
              .map((c) => (
                <div key={c}>
                  <i className="chave-linha" style={{ background: corCategoria(ordem, c) }} />{' '}
                  <strong>{brl(m.porCategoria.get(c)!)}</strong> {c}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Retângulo com só os cantos de cima arredondados (ponta de dados), base reta. */
function colunaArredondada(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}
