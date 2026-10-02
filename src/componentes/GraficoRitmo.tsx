import { useLayoutEffect, useRef, useState } from 'react'
import { brl } from '../lib/formato.ts'
import type { PontoRitmo } from '../lib/painel.ts'

const ALTURA = 200
const M = { top: 12, right: 12, bottom: 24, left: 52 }

function ticksLimpos(max: number, alvo = 4) {
  if (max <= 0) return [0]
  const bruto = max / alvo
  const pot = 10 ** Math.floor(Math.log10(bruto))
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto) ?? bruto
  const ticks = []
  for (let v = 0; v <= max + passo * 0.001; v += passo) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + passo)
  return ticks
}

const compacto = (centavos: number) => {
  const r = centavos / 100
  return Math.abs(r) >= 1000 ? `${(r / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : r.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

/** Gasto acumulado no mês contra a linha ideal (Restante distribuído por dia). */
export function GraficoRitmo(props: { pontos: PontoRitmo[]; diaAtual: number }) {
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

  const { pontos } = props
  const n = pontos.length
  const valores = pontos.flatMap((p) => [p.idealAcumulado, p.gastoAcumulado ?? 0])
  const ticks = ticksLimpos(Math.max(...valores, 1))
  const minY = Math.min(0, ...valores)
  const maxY = ticks[ticks.length - 1]
  const w = largura - M.left - M.right
  const h = ALTURA - M.top - M.bottom
  const x = (dia: number) => M.left + ((dia - 1) / Math.max(n - 1, 1)) * w
  const y = (v: number) => M.top + h - ((v - minY) / (maxY - minY || 1)) * h

  const linha = (sel: (p: PontoRitmo) => number | null) =>
    pontos
      .filter((p) => sel(p) != null)
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.dia).toFixed(1)},${y(sel(p)!).toFixed(1)}`)
      .join('')

  const ultimoGasto = [...pontos].reverse().find((p) => p.gastoAcumulado != null)
  const p = hover != null ? pontos[hover - 1] : null
  const diasEixo = [1, 5, 10, 15, 20, 25, n].filter((d, i, a) => d <= n && a.indexOf(d) === i && !(d !== n && n - d < 3))

  function mover(clientX: number) {
    const r = caixa.current!.getBoundingClientRect()
    const rel = (clientX - r.left - M.left) / w
    setHover(Math.min(n, Math.max(1, Math.round(rel * (n - 1)) + 1)))
  }

  return (
    <div className="grafico" ref={caixa}>
      <div className="legenda">
        <span><i className="chave-linha serie-1" /> Gasto acumulado</span>
        <span><i className="chave-linha ideal" /> Ideal (Restante ÷ dias)</span>
      </div>
      <div className="grafico-area">
        <svg
          width={largura}
          height={ALTURA}
          role="img"
          aria-label="Gasto acumulado do mês contra o ideal"
          onPointerMove={(e) => mover(e.clientX)}
          onPointerDown={(e) => mover(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grade" x1={M.left} x2={largura - M.right} y1={y(t)} y2={y(t)} />
              <text className="eixo" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {compacto(t)}
              </text>
            </g>
          ))}
          {diasEixo.map((d) => (
            <text key={d} className="eixo" x={x(d)} y={ALTURA - 6} textAnchor="middle">
              {d}
            </text>
          ))}
          <path className="linha-ideal" d={linha((q) => q.idealAcumulado)} />
          <path className="linha-serie" d={linha((q) => q.gastoAcumulado)} />
          {ultimoGasto && (
            <circle className="ponto" cx={x(ultimoGasto.dia)} cy={y(ultimoGasto.gastoAcumulado!)} r={4} />
          )}
          {p && (
            <g>
              <line className="mira" x1={x(p.dia)} x2={x(p.dia)} y1={M.top} y2={M.top + h} />
              {p.gastoAcumulado != null && <circle className="ponto" cx={x(p.dia)} cy={y(p.gastoAcumulado)} r={4} />}
            </g>
          )}
        </svg>
        {p && (
          <div
            className="tooltip"
            style={{ left: Math.min(Math.max(x(p.dia), 90), largura - 90), top: 4 }}
          >
            <div className="tooltip-titulo">Dia {p.dia}</div>
            {p.gastoAcumulado != null && (
              <div><i className="chave-linha serie-1" /> <strong>{brl(p.gastoAcumulado)}</strong> gasto</div>
            )}
            <div><i className="chave-linha ideal" /> <strong>{brl(p.idealAcumulado)}</strong> ideal</div>
          </div>
        )}
      </div>
    </div>
  )
}
