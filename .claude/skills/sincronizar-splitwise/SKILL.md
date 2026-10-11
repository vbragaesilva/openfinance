---
name: sincronizar-splitwise
description: Sincroniza os gastos do Splitwise com o banco do openfinance. Lê as despesas no Splitwise web pelo api-anything, mostra o que falta lançar e confere o saldo, e só grava depois do ok do usuário. Use quando o usuário pedir para sincronizar, puxar, conferir ou preencher o Splitwise ou os splits, perguntar se o saldo do Splitwise bate, ou disser que um split não entrou (o que ele mesmo adiciona no Splitwise não gera notificação).
---

# Sincronizar o Splitwise

O script `scripts/splitwise-sincronizar.ts` faz tudo. As regras estão em `src/lib/splitwise-despesas.ts`, e o
banco é o do `.env`, que hoje é o **Turso de produção**.

O que está combinado com o usuário (não mudar sem perguntar):
- **Valor:** é o mesmo da notificação. "Você deve X" vira +X e "recebeu de volta X" vira −X, ou seja, o
  `net_balance` dele com o sinal trocado. `data` = data da despesa e `criado_em` = quando ela foi criada no
  Splitwise. O tipo vem do nome: Net, Claro e Sol (nome inteiro) são Fixo.
- **Janela:** o banco está certo até 11/10/2026. Só entram despesas **criadas** no Splitwise a partir daí
  e, do lado do banco, só lançamentos com `criado_em` a partir daí.
- **O que não entra:** pagamentos (acertos de contas), despesas sem o usuário e com parte zero são ignorados.
  Outra moeda fica para revisar.
- **Despesa editada ou apagada depois de ligada:** só aparece como aviso. Nunca alterar nem apagar o
  lançamento sozinho.
- **Gravação:** nada é gravado sem o ok do usuário.

## Passos

1. **Relatório**, que não grava nada:
   ```bash
   npm run splitwise:sincronizar
   ```
   Se der `auth`, peça ao usuário para rodar no terminal dele `api-anything login splitwise.com` (clicar em
   "Permitir" no Keychain, não em "Sempre permitir"). Você não consegue fazer esse login por ele. Para
   outros erros do api-anything, siga a skill `api-anything` (o laço de falha dela).

2. **Mostre ao usuário**, de forma curta:
   - **Faltam no banco:** data, valor, nome e tipo de cada uma. É o que vai ser lançado.
   - **Ligadas por valor e data:** liste só as que parecerem estranhas, como nomes muito diferentes.
   - **No banco sem despesa no Splitwise:** pode ser um split lançado à mão com valor diferente, ou duas
     despesas somadas num lançamento só. Se um lançamento claramente corresponde a uma ou mais despesas que
     faltam (mesmo valor ou mesma soma, data próxima), proponha ligar em vez de lançar.
   - **Mudaram no Splitwise:** só avisar.
   - **Saldo:** se bate, e se vai bater depois de lançar.

   Depois pergunte o que lançar, o que ligar, o que ignorar e se algum tipo (Fixo/Variável) muda.

3. **Grave só o que o usuário aprovou**, com os ids do relatório:
   ```bash
   npm run splitwise:sincronizar -- --gravar --lancar <ids> [--ligar <despesa>=<lançamento>,...] [--ignorar <ids>] [--tipo <id>=Fixo]
   ```
   Os pares automáticos e as ignoradas são guardados junto, em `splitwise_despesas`, e não aparecem mais.
   Despesa que o usuário não decidiu fica de fora e aparece de novo na próxima vez.

4. Rode o relatório de novo e confirme que não falta nada e que o saldo bate.

## Se o api-anything não tiver as operações

As operações `despesas`, `amigos` e `eu` estão em `integracoes/splitwise.api-anything.json`, sem cookies. Para
reinstalar numa máquina nova: instale o api-anything (README dele), copie esse arquivo para
`~/.api-anything/sites/splitwise.json` e peça ao usuário para rodar `api-anything login splitwise.com`.
Confira com `api-anything ops splitwise`.
