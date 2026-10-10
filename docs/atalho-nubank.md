# Atalho: notificação do Nubank → openmoney

Cole o texto abaixo na Siri (ou no app Atalhos, em "Criar com a Siri") para ela montar a automação. Antes, troque `COLE_AQUI_O_API_TOKEN` pela chave dos atalhos (a variável `API_TOKEN` do `.env` e da Netlify). No Mac, este comando copia a chave sem mostrá-la:

```bash
grep -m1 '^API_TOKEN=' .env | cut -d= -f2- | pbcopy
```

Depois de colar a chave no texto, não salve o texto em lugar nenhum: a chave dá acesso à API do app.

---

Crie uma automação pessoal no app Atalhos com estas configurações exatas:

**Gatilho:** "Ao receber uma notificação" do app **Nubank**, de qualquer remetente, com qualquer texto. Execute **imediatamente**, sem pedir confirmação e sem me avisar que a automação rodou.

**Ações, nesta ordem:**

1. **Obter conteúdo de URL**
   - URL: `https://openmoney.netlify.app/api/lancamentos/notificacao`
   - Método: **POST**
   - Cabeçalhos:
     - `Authorization`: `Bearer COLE_AQUI_O_API_TOKEN`
     - `Content-Type`: `application/json`
   - Corpo da solicitação: **JSON**, com três campos de texto:
     - `titulo`: o **Título** da notificação recebida
     - `subtitulo`: o **Subtítulo** da notificação recebida
     - `mensagem`: o **Corpo** (texto) da notificação recebida

2. **Obter valor do dicionário**: a chave `mensagem` do resultado da ação 1.

3. **Se** o valor da ação 2 **começa com** `Lançado`:
   - **Mostrar notificação** com o título `openmoney` e o texto igual ao valor da ação 2.
   - (Fora do "Se" não faça nada: notificações do Nubank que não são compra no crédito ficam só guardadas no app, sem me avisar.)

Nomeie a automação "Nubank → openmoney". Não adicione nenhuma outra ação, não peça confirmação antes de enviar e não altere os nomes dos campos (`titulo`, `subtitulo`, `mensagem`), porque o servidor lê exatamente esses nomes.

---

## Como conferir

1. Faça uma compra no crédito (ou espere a próxima).
2. Deve aparecer a notificação do openmoney: "Lançado: R$ X · LOJA (Crédito Nubank) · dd/mm/aaaa".
3. Se não aparecer, a chamada fica registrada no app: `npm run db:log-atalhos` mostra o que chegou e o que o servidor respondeu, e `npm run db:nubank` mostra as notificações guardadas.
