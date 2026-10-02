import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './estilo.css'

// PWA: só em produção (no dev o service worker atrapalharia o recarregamento automático).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
