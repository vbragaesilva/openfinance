# openfinance

App de gastos que substitui a planilha GASTOS.xlsx. Vite + React no front (`src/`), API numa Netlify Function (`server/`, exposta por `netlify/functions/api.ts`), banco Turso/libSQL. Detalhes de setup e deploy no README.

- `npm run dev` usa o banco do `.env`, que hoje aponta para o **Turso de produção**: o que for gravado no dev aparece no app real.
- `npm test`, `npm run typecheck`, `npm run build` antes de commitar.
- Push na `main` publica sozinho na Netlify (projeto **openmoney**).

## Regras de negócio

- Não inventar nem "corrigir" regra de cálculo financeiro: replicar o que existe e perguntar o que for ambíguo. As regras confirmadas estão comentadas em `src/lib/painel.ts`.
- Sempre há duas medidas: a "conferível" (Fatura = todo o crédito; Split total = Splitwise) e a que deduz do Restante (sem o que é Fixo).

## Layout: desktop × celular

O mesmo código serve o site no PC e o app instalado (PWA) no iPhone. O que muda é a largura da tela:

- **Desktop é o layout de referência.** Não alterar o desktop sem pedido explícito.
- Mudança pedida "para o celular/app" vai **só** dentro de `@media (max-width: 759px)` em `src/estilo.css`, ou em componentes/elementos com as classes `so-celular`/`so-desktop`. Para afetar só o app instalado (não o Safari), usar `@media (display-mode: standalone)`.
- Antes de entregar qualquer mudança visual, conferir no navegador **as duas larguras** (preset mobile e desktop) e garantir que a que não foi pedida ficou igual.
