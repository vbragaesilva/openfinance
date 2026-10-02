// Schema do banco (SQLite/libSQL). Cada CREATE é idempotente: rodar de novo não apaga nada.
// Valores em dinheiro ficam em centavos (INTEGER) para não acumular erro de ponto flutuante.
// Meses são guardados como texto 'AAAA-MM'.

export const SCHEMA: string[] = [
  // Antiga aba "Respostas" (Google Form). CRÉDITO e DÉBITO eram só filtros dela.
  // tipo 'Fixo' = já está previsto nos fixos, então não deduz do Restante.
  `CREATE TABLE IF NOT EXISTS lancamentos (
    id INTEGER PRIMARY KEY,
    criado_em TEXT NOT NULL,
    data TEXT NOT NULL,
    produto TEXT NOT NULL DEFAULT '',
    local TEXT NOT NULL DEFAULT '',
    valor_centavos INTEGER NOT NULL,
    categoria TEXT,
    modalidade TEXT NOT NULL CHECK (modalidade IN ('Crédito', 'Débito')),
    tipo TEXT CHECK (tipo IN ('Variável', 'Fixo'))
  )`,
  `CREATE INDEX IF NOT EXISTS lancamentos_data ON lancamentos (data)`,

  // Antiga aba "Split" (segundo Google Form). Mesma regra do tipo 'Fixo'.
  `CREATE TABLE IF NOT EXISTS split (
    id INTEGER PRIMARY KEY,
    criado_em TEXT NOT NULL,
    data TEXT NOT NULL,
    nome TEXT NOT NULL DEFAULT '',
    valor_centavos INTEGER NOT NULL,
    fixo TEXT CHECK (fixo IN ('Variável', 'Fixo'))
  )`,
  `CREATE INDEX IF NOT EXISTS split_data ON split (data)`,

  // Salário com vigência: vale do mês `desde` até a próxima mudança.
  `CREATE TABLE IF NOT EXISTS salarios (
    desde TEXT PRIMARY KEY,
    valor_centavos INTEGER NOT NULL
  )`,

  // Fixos (antiga aba FIXOS). Existem de `inicio` até `fim` (inclusive; NULL = sem fim).
  // `investimento` marca o fixo que o PAINEL lia por posição (FIXOS!$D$10) no "Invest. Proj.".
  `CREATE TABLE IF NOT EXISTS fixos (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    investimento INTEGER NOT NULL DEFAULT 0,
    ordem INTEGER NOT NULL DEFAULT 0,
    inicio TEXT NOT NULL,
    fim TEXT
  )`,
  // Valor de cada fixo com vigência, igual ao salário.
  `CREATE TABLE IF NOT EXISTS fixos_valores (
    fixo_id INTEGER NOT NULL,
    desde TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL,
    PRIMARY KEY (fixo_id, desde)
  )`,
  // Cada "paguei" de um fixo (antiga coluna "Pago" da aba FIXOS, agora com histórico).
  `CREATE TABLE IF NOT EXISTS fixos_pagamentos (
    id INTEGER PRIMARY KEY,
    fixo_id INTEGER NOT NULL,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS fixos_pagamentos_fixo ON fixos_pagamentos (fixo_id, data)`,

  // "Caixa Atual" (saldo da conta) que era digitado à mão em cada bloco de mês do PAINEL.
  `CREATE TABLE IF NOT EXISTS caixa_mensal (
    ano INTEGER NOT NULL,
    mes INTEGER NOT NULL,
    valor_centavos INTEGER NOT NULL,
    PRIMARY KEY (ano, mes)
  )`,
]
