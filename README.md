# openfinance

Controle de gastos que substitui a planilha `GASTOS.xlsx`. Front em React (Vite), API numa Netlify Function e banco SQLite no Turso (libSQL).

```
src/              front (páginas, componentes, cálculos do painel em src/lib/painel.ts)
server/           API: rotas, login e schema do banco
netlify/functions/api.ts   expõe server/rotas.ts em /api/*
scripts/          migração do schema e importação da planilha
```

## Rodar local

```bash
npm install
npm run db:import      # cria local.db a partir de ./GASTOS.xlsx
npm run dev            # http://localhost:5173
```

Sem `.env`, o dev usa `file:local.db` e abre sem senha. Para apontar o dev para o Turso ou testar o login, copie `.env.example` para `.env`.

- `npm test`: testes das fórmulas do painel (`src/lib/painel.test.ts`) e da migração/API (`server/plataformas.test.ts`)
- `npm run db:migrate`: cria o que falta no banco e converte um banco de antes das plataformas (as tabelas antigas ficam como `lancamentos_antigo` e `split_antigo`, de backup)
- `npm run typecheck`
- `npm run db:import -- --substituir`: apaga o banco e reimporta a planilha

## Da planilha para o app

| Planilha | App |
|---|---|
| Respostas (Google Form) | tabela `lancamentos`, página Lançamentos |
| CRÉDITO / DÉBITO | plataformas "Crédito Nubank" e "Débito" (tabela `plataformas`), filtro da página Lançamentos |
| pizza do PAINEL / CreditoDinamica | página Análises (por categoria, mês a mês, locais, maiores compras) |
| Split (Google Form) | lançamentos na plataforma "Splitwise" |
| FIXOS | `salarios`, `fixos`, `fixos_valores`, `fixos_pagamentos`; página Fixos |
| PAINEL | calculado em `src/lib/painel.ts`; o "Caixa Atual" digitado vai para `caixa_mensal` |
| Consumo moto, Invest, Cashback | ainda não migradas (vão ganhar algo mais estruturado depois) |

O painel segue as fórmulas do bloco de Julho em diante (o comentário de cada campo em `painel.ts` aponta a célula equivalente), com estas regras novas:

- **Fixo não entra no Gasto.** Lançamento com tipo "Fixo" já está descontado em Fixos. O total de cada plataforma continua somando tudo, para conferir com a fatura do cartão, com o Splitwise etc. Sem tipo conta como gasto.
- **Plataformas.** Todo lançamento tem uma plataforma (cartão, débito, Splitwise…), criada e configurada na página Configurações. O Gasto é a soma de todas, sem os fixos. Cada plataforma escolhe se aparece no Painel para conferência e se entra nas Análises, e tem um **dia de fechamento**: compra antes dele conta no mês anterior (1 = mês do calendário). Parcelas seguintes caem no dia do fechamento de cada mês.
- **Salário e fixos têm vigência.** Mudar um valor vale do mês escolhido em diante; meses anteriores não mudam. A planilha só tinha os valores atuais, então eles foram importados valendo desde o primeiro mês com lançamento (abr/2026).

## Deploy (Turso + Netlify)

### 1. Banco no Turso

```bash
brew install tursodatabase/tap/turso
turso auth login
turso db create openfinance
turso db show openfinance --url          # -> TURSO_DATABASE_URL
turso db tokens create openfinance       # -> TURSO_AUTH_TOKEN
```

Copiar o `local.db` para o Turso (cria as tabelas, mantém os ids e recusa se o destino já tiver dados):

```bash
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:copiar
```

Para importar direto da planilha em vez disso, use `npm run db:import` com as mesmas variáveis.

### 2. Site na Netlify

1. Suba o repositório no GitHub. A planilha e o `local.db` estão no `.gitignore`.
2. Na Netlify: *Add new project → Import an existing project*, escolha o repositório. Build command, pasta `dist` e functions já vêm do `netlify.toml`.
3. Em *Project configuration → Environment variables*, crie:

| Variável | Valor |
|---|---|
| `TURSO_DATABASE_URL` | saída de `turso db show openfinance --url` |
| `TURSO_AUTH_TOKEN` | saída de `turso db tokens create openfinance` |
| `APP_PASSWORD` | a senha que você vai digitar para entrar no app |
| `SESSION_SECRET` | um texto aleatório longo (`openssl rand -base64 32`) |

4. Faça um novo deploy depois de criar as variáveis, porque elas só valem a partir do próximo deploy.

Todo deploy roda `npm run db:migrate` depois do build, no banco das variáveis daquele contexto: produção migra o Turso de produção; Deploy Previews migram o banco de preview (`TURSO_*` com valor próprio para o contexto Deploy Previews, apontando para uma cópia criada com `turso db create openfinance-preview --from-db openfinance`). As variáveis `TURSO_*` precisam valer também no escopo de Builds.

Sem `APP_PASSWORD`/`SESSION_SECRET` a API em produção recusa tudo, ou seja, o app não fica aberto por engano. A sessão dura 90 dias. Para derrubar todas as sessões, troque o `SESSION_SECRET`.

## Lançar pelos Atalhos do iPhone

Com a variável `API_TOKEN` na Netlify, a API aceita `Authorization: Bearer <API_TOKEN>` além do login normal.

- `POST https://openmoney.netlify.app/api/lancamentos` com JSON `{"valor": "R$ 16,50", "produto": "...", "local": "...", "plataforma": "Crédito Nubank", "categoria": "Comida"}`
- `POST https://openmoney.netlify.app/api/split` com JSON `{"valor": "-68,44", "nome": "..."}` (vira lançamento na plataforma do Splitwise)

`plataforma` é o nome, sem diferenciar maiúsculas/acentos; basta o começo do nome se só uma plataforma ativa começar assim. O campo antigo `modalidade` vale igual: `"credito"` acha "Crédito Nubank" enquanto for o único crédito; depois de criar outro cartão, mande o nome inteiro. `valor` aceita o formato do iPhone ("R$ 16,50", "1.234,56", -5.9). `data` ausente = hoje; `tipo`/`fixo` ausente = Variável; "fixo"/"variavel" podem vir sem acento. A resposta traz `mensagem` (ex.: "Lançado: R$ 16,50 · iFood (Crédito Nubank) · 01/10/2026") para o atalho mostrar.

### Splitwise por notificação (iOS 27)

Automação "Ao receber notificação do Splitwise" → `POST /api/split/notificacao` com `{"titulo", "subtitulo", "mensagem"}` da notificação. A API lê o texto (`src/lib/splitwise.ts`): "Você deve BRL X" vira lançamento positivo na plataforma do Splitwise, "Você recebeu de volta BRL X" vira negativo; o resto (acertos, edições) só fica guardado e aparece para revisar na página Lançamentos. Toda notificação é salva crua na tabela `notificacoes`, com o status e o lançamento criado.

### Nubank por notificação (em coleta)

Automação "Ao receber notificação do Nubank" → `POST /api/lancamentos/notificacao` com `{"titulo", "subtitulo", "mensagem"}`. Por enquanto só guarda na tabela `notificacoes_nubank` (JSON exato em `corpo`), sem criar lançamento. `npm run db:nubank` mostra as capturadas. O leitor será escrito com base nas notificações reais.
