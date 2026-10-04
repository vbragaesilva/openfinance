import { useEffect, useRef, useState } from 'react'

// Puxar para atualizar no app instalado (PWA) do celular: com a página no topo, arrastar o dedo
// para baixo vai acendendo os traços do círculo; soltando com o círculo completo, recarrega.
// Só no app instalado: no Safari o próprio navegador já tem esse gesto.
const LIMITE = 90 // px de arrasto para completar o círculo
const TRACOS = 12

function acesosDe(px: number) {
  return Math.round(Math.min(1, px / LIMITE) * TRACOS)
}

function ativo() {
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return standalone && matchMedia('(max-width: 759px)').matches
}

export function PuxarParaAtualizar() {
  const [puxado, setPuxado] = useState(0)
  const [atualizando, setAtualizando] = useState(false)
  const inicio = useRef<{ x: number; y: number } | null>(null)
  const puxadoRef = useRef(0)

  useEffect(() => {
    function mudar(px: number) {
      puxadoRef.current = px
      setPuxado(px)
    }
    function comecar(e: TouchEvent) {
      inicio.current = null
      if (e.touches.length !== 1 || scrollY > 0 || !ativo() || document.querySelector('dialog[open]')) return
      inicio.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
    function mover(e: TouchEvent) {
      const i = inicio.current
      if (!i) return
      const dx = e.touches[0].clientX - i.x
      const dy = e.touches[0].clientY - i.y
      // Gesto lateral (ex.: rolar uma tabela) ou para cima: não é puxar para atualizar.
      if (puxadoRef.current === 0 && (dy <= 0 || Math.abs(dx) > dy)) {
        if (Math.abs(dx) > 10 || dy < -10) inicio.current = null
        return
      }
      mudar(Math.max(0, dy))
    }
    function soltar() {
      if (!inicio.current) return
      inicio.current = null
      if (puxadoRef.current >= LIMITE) {
        setAtualizando(true)
        location.reload()
      } else {
        mudar(0)
      }
    }
    addEventListener('touchstart', comecar, { passive: true })
    addEventListener('touchmove', mover, { passive: true })
    addEventListener('touchend', soltar)
    addEventListener('touchcancel', soltar)
    return () => {
      removeEventListener('touchstart', comecar)
      removeEventListener('touchmove', mover)
      removeEventListener('touchend', soltar)
      removeEventListener('touchcancel', soltar)
    }
  }, [])

  if (!atualizando && puxado === 0) return null
  const progresso = atualizando ? 1 : Math.min(1, puxado / LIMITE)
  const acesos = acesosDe(puxado)
  const desce = atualizando ? 1 : progresso

  return (
    <div
      className={`puxar-atualizar${atualizando ? ' girando' : progresso >= 1 ? ' travado' : ''}`}
      style={{ transform: `translate(-50%, ${desce * 28}px)`, opacity: Math.min(1, progresso * 1.5) }}
      role="status"
      aria-label={atualizando ? 'Atualizando' : 'Puxe para atualizar'}
    >
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
        {Array.from({ length: TRACOS }, (_, k) => (
          <line
            key={k}
            x1="12"
            y1="2.5"
            x2="12"
            y2="7"
            transform={`rotate(${k * (360 / TRACOS)} 12 12)`}
            opacity={atualizando ? 1 - (k / TRACOS) * 0.75 : k < acesos ? 1 : 0}
          />
        ))}
      </svg>
    </div>
  )
}
