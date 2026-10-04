// Schema do banco (SQLite/libSQL). Cada CREATE é idempotente: rodar de novo não apaga nada.
// Valores em dinheiro ficam em centavos (INTEGER) para não acumular erro de ponto flutuante.
// Meses são guardados como texto 'AAAA-MM'.

import type { Client } from '@libsql/client'

// Antiga aba "Respostas" (Google Form) mais a antiga aba "Split": todo gasto, em qualquer plataforma.
// tipo 'Fixo' = já está previsto nos fixos, então não deduz do Restante.
const LANCAMENTOS = `CREATE TABLE IF NOT EXISTS lancamentos (
    id INTEGER PRIMARY KEY,
    criado_em TEXT NOT NULL,
    data TEXT NOT NULL,
    produto TEXT NOT NULL DEFAULT '',
    local TEXT NOT NULL DEFAULT '',
    valor_centavos INTEGER NOT NULL,
    categoria TEXT,
    plataforma_id INTEGER NOT NULL,
    tipo TEXT CHECK (tipo IN ('Variável', 'Fixo'))
  )`

export const SCHEMA: string[] = [
  // Onde o gasto acontece (cartão, débito, Splitwise…). Ver o tipo Plataforma em src/lib/tipos.ts.
  `CREATE TABLE IF NOT EXISTS plataformas (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
    fechamento INTEGER NOT NULL DEFAULT 1 CHECK (fechamento BETWEEN 1 AND 28),
    no_painel INTEGER NOT NULL DEFAULT 1,
    nas_analises INTEGER NOT NULL DEFAULT 0,
    ativa INTEGER NOT NULL DEFAULT 1,
    ordem INTEGER NOT NULL DEFAULT 0,
    integracao TEXT
  )`,
  LANCAMENTOS,
  `CREATE INDEX IF NOT EXISTS lancamentos_data ON lancamentos (data)`,

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

  // Notificações do Splitwise repassadas pelo atalho do iPhone, guardadas cruas.
  // status: 'split' (virou o lançamento `lancamento_id`), 'ignorada', 'revisar', 'resolvida' ou 'descartada'.
  `CREATE TABLE IF NOT EXISTS notificacoes (
    id INTEGER PRIMARY KEY,
    recebida_em TEXT NOT NULL,
    titulo TEXT,
    subtitulo TEXT,
    mensagem TEXT,
    status TEXT NOT NULL,
    motivo TEXT,
    lancamento_id INTEGER
  )`,

  // Notificações do Nubank repassadas pelo atalho do iPhone. Por enquanto só capturadas (sem
  // virar lançamento): servem para conhecer o formato antes de escrever o leitor.
  // `corpo` é o JSON exato recebido, caso o atalho mande mais campos que título/subtítulo/mensagem.
  `CREATE TABLE IF NOT EXISTS notificacoes_nubank (
    id INTEGER PRIMARY KEY,
    recebida_em TEXT NOT NULL,
    titulo TEXT,
    subtitulo TEXT,
    mensagem TEXT,
    corpo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'capturada',
    lancamento_id INTEGER
  )`,

  // Toda chamada feita com a chave dos atalhos do iPhone, com o corpo exato recebido e a resposta.
  // Serve para depurar os atalhos. O cabeçalho Authorization nunca é gravado.
  `CREATE TABLE IF NOT EXISTS log_atalhos (
    id INTEGER PRIMARY KEY,
    recebida_em TEXT NOT NULL,
    metodo TEXT NOT NULL,
    caminho TEXT NOT NULL,
    status INTEGER NOT NULL,
    cabecalhos TEXT,
    corpo TEXT,
    resposta TEXT
  )`,

  // "Caixa Atual" (saldo da conta) que era digitado à mão em cada bloco de mês do PAINEL.
  `CREATE TABLE IF NOT EXISTS caixa_mensal (
    ano INTEGER NOT NULL,
    mes INTEGER NOT NULL,
    valor_centavos INTEGER NOT NULL,
    PRIMARY KEY (ano, mes)
  )`,
]

// As três plataformas que existiam fixas no código antes de virarem configuráveis. Fechamento 1
// (mês do calendário) para os números não mudarem; o dia real se ajusta em Configurações.
const PLATAFORMAS_INICIAIS = `INSERT INTO plataformas (id, nome, fechamento, no_painel, nas_analises, ativa, ordem, integracao) VALUES
    (1, 'Crédito Nubank', 1, 1, 1, 1, 1, NULL),
    (2, 'Débito', 1, 1, 0, 1, 2, NULL),
    (3, 'Splitwise', 1, 1, 0, 1, 3, 'splitwise')`

// Banco de antes das plataformas: `lancamentos.modalidade` ('Crédito'/'Débito') e a tabela `split`.
// Tudo numa transação. As tabelas antigas ficam como lancamentos_antigo e split_antigo, de backup.
// Os splits ganham id depois do maior lançamento (id do split + esse maior id), e as notificações
// que apontavam para um split passam a apontar para o lançamento correspondente.
const DESLOCAMENTO = '(SELECT COALESCE(MAX(id), 0) FROM lancamentos_antigo)'
const MIGRAR_PARA_PLATAFORMAS: string[] = [
  PLATAFORMAS_INICIAIS,
  'DROP INDEX IF EXISTS lancamentos_data',
  'ALTER TABLE lancamentos RENAME TO lancamentos_antigo',
  LANCAMENTOS,
  `INSERT INTO lancamentos (id, criado_em, data, produto, local, valor_centavos, categoria, plataforma_id, tipo)
   SELECT id, criado_em, data, produto, local, valor_centavos, categoria,
          CASE modalidade WHEN 'Crédito' THEN 1 ELSE 2 END, tipo
   FROM lancamentos_antigo`,
  `INSERT INTO lancamentos (id, criado_em, data, produto, local, valor_centavos, categoria, plataforma_id, tipo)
   SELECT id + ${DESLOCAMENTO}, criado_em, data, nome, '', valor_centavos, NULL, 3, fixo FROM split`,
  'CREATE INDEX lancamentos_data ON lancamentos (data)',
  'DROP INDEX IF EXISTS split_data',
  'ALTER TABLE split RENAME TO split_antigo',
  'ALTER TABLE notificacoes RENAME COLUMN split_id TO lancamento_id',
  `UPDATE notificacoes SET lancamento_id = lancamento_id + ${DESLOCAMENTO} WHERE lancamento_id IS NOT NULL`,
]

/** Cria o que falta e converte um banco de antes das plataformas. Pode rodar quantas vezes quiser. */
export async function migrar(db: Client): Promise<'criado' | 'convertido' | 'em dia'> {
  await db.batch(SCHEMA, 'write')
  const colunas = await db.execute('PRAGMA table_info(lancamentos)')
  if (colunas.rows.some((c) => c.name === 'modalidade')) {
    await db.batch(MIGRAR_PARA_PLATAFORMAS, 'write')
    return 'convertido'
  }
  const rs = await db.execute('SELECT COUNT(*) AS n FROM plataformas')
  if (Number(rs.rows[0].n) > 0) return 'em dia'
  await db.execute(PLATAFORMAS_INICIAIS)
  return 'criado'
}
