// Service worker do PWA. Guarda só a "casca" do app (HTML, JS, CSS, ícones) para abrir rápido
// e funcionar com internet ruim. Dados (/api) nunca passam pelo cache.
const CACHE = 'openfinance-casca-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return

  // Páginas: rede primeiro (pega versão nova), cache se estiver offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copia))
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // Arquivos do build têm hash no nome, então nunca mudam: cache primeiro.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icones/')) {
    e.respondWith(
      caches.match(req).then(
        (achado) =>
          achado ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copia = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copia))
            }
            return res
          }),
      ),
    )
  }
})
