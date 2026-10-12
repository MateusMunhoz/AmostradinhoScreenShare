# Identificador da conta: nome#0000

Status: Implementada em 12/10/2026 (branch `conta-identificador-2fa`), com as recomendações das decisões em aberto. Falta o deploy da RazzeAPI na VPS e o teste manual em dois PCs.

## Objetivo
Toda conta ganha um identificador único no formato `nome#1234`. É por ele que alguém adiciona um amigo, que o app mostra
"quem é essa conta" ao entrar ou ligar o Google, e que futuras formas de login (Discord, Steam, Apple...) apontam para a
mesma conta. Resolve dois problemas de hoje:
- O pedido de amizade procura pelo `display_name`, que **não é único**: dois "Lucas" dão o erro `nickname_ambiguous`
  (`razze-api/server.js`, `POST /v1/friends/requests`) e não há como trocar o nome (`PATCH /v1/me` só aceita a bio).
- Quando o Google encontra um e-mail que já tem conta (`account_exists`), a mensagem não diz **qual** conta é.

## Escopo
- Entra: identificador `nome#tag` em toda conta (inclusive as antigas, por migração), trocar o nome, adicionar amigo pelo
  identificador, mostrar o identificador no app e no painel, e uma tabela de formas de login preparada para provedores
  novos (o Google migra para ela).
- Fica de fora: implementar provedores novos (só a estrutura), escolher a tag, e o nome dentro da sala (continua o nome
  local de cada um, como hoje).

## Comportamento esperado

### O identificador
- **Nome:** 2 a 32 caracteres, **só letras sem acento e números** (`A-Z`, `a-z`, `0-9`). Sem espaço, acento, `_`, `.`,
  `#`, emoji ou letras de outros alfabetos (evita nomes que parecem iguais, como `lucas` com "а" cirílico).
  Maiúsculas e minúsculas contam como iguais para unicidade (`Lucas#0420` = `lucas#0420`), mas o app mostra como a pessoa
  escreveu. O campo avisa enquanto a pessoa digita: "Use só letras sem acento e números."
- **Tag:** 4 dígitos, `0001` a `9999`, **sorteada** entre as livres para aquele nome. `0000` fica reservada (sistema).
  Se as 9999 de um nome acabarem: "Esse nome está muito usado; escolha outro."
- **Nomes reservados:** `admin`, `nebula`, `razze`, `suporte`, `sistema`, `moderador` (e os que começam com eles, como
  `admin2` ou `suportenebula`), para ninguém se passar pela equipe.
- **Nome de exibição continua existindo** (`display_name`, livre, com espaço e até 60 caracteres): é o que aparece no
  Início, nas mensagens e no cartão do perfil. O identificador é o "endereço" da conta, como o `@` de outras redes.

### Contas novas
- **A pessoa escolhe o nome do identificador ao criar a conta**, seja por senha ou pelo Google. O campo vem preenchido
  com uma sugestão (do nome de exibição ou do nome do Google, sem acento, espaço e símbolos; vazio → `usuario`) e mostra
  na hora se o nome é válido. A tag é sorteada e aparece no fim: "Sua conta é **lucas#0420**".
- Pelo Google, a conta só é criada depois de escolher o nome: o app entra com o Google, mostra o campo e envia nome e
  identidade juntos (`/v1/auth/google` com `handleName`). Fechar o app no meio não cria conta.
- App antigo (sem o campo) criando conta pelo Google: o servidor usa a sugestão e a pessoa troca depois.

### Contas antigas (migração)
- Na subida do servidor, cada conta sem identificador ganha um, gerado do `display_name` como a sugestão acima (acentos
  viram a letra sem acento, o resto sai; menos de 2 caracteres ou nome reservado → `usuario`), com tag sorteada.
- Ao abrir o app atualizado, quem tem o identificador gerado sozinho (contas antigas e as criadas por app antigo,
  `handleChosen: false`) vê a janela **Escolha seu identificador**, com o nome sugerido, **Salvar** e **Manter
  lucas#0420**. Cancelar adia: ela volta na próxima vez que o app abrir, até a pessoa escolher. Essa primeira escolha não
  espera o intervalo de 7 dias. App antigo não mostra a janela: a pessoa vê quando atualizar.

### Trocar o nome
- Em Conta → "Identificador": troca o nome; a tag **se mantém** se `novo-nome#tag` estiver livre, senão sorteia outra
  (o app avisa antes de confirmar).
- No máximo **uma troca a cada 7 dias** (evita alguém se passar por outro trocando e voltando). O admin pode trocar a
  qualquer momento pelo painel.
- Amizades, mensagens e salas não mudam: tudo continua ligado ao `id` da conta, não ao identificador.

### Adicionar amigo
- O campo aceita `nome#1234` (exato, sem diferenciar maiúsculas), link ou código de convite (como hoje).
- Digitou só o nome, sem `#`: "Falta a tag: peça o identificador completo (ex.: lucas#0420)." Sem procurar por nome solto.
- **Adicionar por e-mail sai:** hoje dá para descobrir se um e-mail tem conta digitando-o no campo de amigos. Com o
  identificador não é mais necessário.
- Pedido para quem não existe: "Não existe conta com o identificador lucas#0420."

### Onde o identificador aparece
- Conta e perfil (com **Copiar meu identificador**), lista de amigos e pedidos (em cinza, ao lado do nome), cartão
  "quer ser seu amigo" do convite por link, painel de administração (busca por identificador) e `/a/<token>`.
- No cartão de quem está na sala, só se a pessoa estiver logada (vem pela RazzeAPI, não pela sala).

### Formas de login e "linkar" contas
- Tabela nova `user_identities(provider, subject, user_id, email, created_at)`, com `UNIQUE(provider, subject)`.
  O `google_sub` atual migra para `provider = 'google'`; a senha continua nas colunas de hoje. Provedor novo = linhas
  novas nessa tabela, sem mudar `users`.
- Conta → "Formas de entrar": lista Senha, Google e futuros, com **Vincular** e **Desvincular** (não deixa remover a
  última forma, como já acontece com o Google sem senha).
- **Vincular exige estar logado na conta.** O identificador **nunca** serve como prova: digitar `lucas#0420` não liga
  nada a essa conta, só mostra a quem pertence. Quem perdeu o acesso usa o código de senha do administrador (já existe).
- `account_exists` (Google ou provedor novo com e-mail de uma conta existente) passa a dizer: "Esse e-mail já é da conta
  **lucas#0420**. Entre nela com a senha e vincule o Google em Conta → Formas de entrar."

### Conta de senha e Google com e-mails diferentes
Hoje, se a conta de senha usa um e-mail e o Google é de outro, o cadastro pelo Google cria uma **segunda conta**; depois,
vincular esse Google na conta de senha dá `google_taken`, e a conta nova não pode desvincular o Google (é a única forma de
entrar). A pessoa fica presa com duas contas.

1. **Evitar a duplicada:** antes de criar uma conta por um provedor (Google ou futuros) cujo e-mail não tem conta, o app
   pergunta: "Você já tem conta no Nebula? **Entrar e vincular** / Criar conta nova". "Entrar e vincular" leva ao login
   por senha e, logo depois, vincula esse provedor (o app guarda a identidade recém-confirmada só em memória, por até
   10 min, e o servidor confere de novo).
2. **Mover a forma de login de uma conta para outra:** logada na conta A, ao vincular um Google que já pertence à conta B,
   o app oferece "Esse Google é da conta **lucas#7781**. Mover para esta conta?".
   - É seguro porque a pessoa prova as duas: está logada em A e acabou de entrar com o Google de B.
   - Antes de confirmar, o app mostra o que a conta B tem (amigos, mensagens, salas) e avisa que **ela será excluída**.
     Se B tiver outra forma de entrar (ex.: senha), o app oferece só **tirar o Google de B**, sem excluí-la.
   - **Não junta as contas:** as mensagens diretas são criptografadas com a chave de cada conta e não migram; amizades de B
     também não passam para A (cada amigo teria que aceitar de novo).
   - Admin de B não move automaticamente: se B for admin, recusa com "Peça a outro administrador".
   - Fica registrado no log de auditoria do painel (`identity.move`).

### Trocar uma forma de login por outra
- **Com mais de uma forma de entrar** (ex.: senha e Google): Desvincular o antigo e Vincular o novo, como já funciona
  hoje com o Google (`DELETE` e `POST /v1/me/google`).
- **Com uma forma só** (conta só pelo Google): não dá para desvincular (a conta ficaria sem entrada). A pessoa primeiro
  usa **"Entrar também com senha"** (define senha e, se quiser, um e-mail novo confirmado por código; ver
  [email-e-dois-fatores.md](email-e-dois-fatores.md)) e depois desvincula o Google antigo e vincula outro. Se o novo já
  for de outra conta, cai no fluxo de **mover** acima.
- Depois de desvincular ou trocar, o Google antigo fica livre e pode criar uma conta nova normalmente.
- Registrado no log de auditoria (`identity.link`, `identity.unlink`, `identity.replace`).

### E-mail da conta ao trocar
- O e-mail da conta é o do cadastro e é ele que vale para a lista de convidados e para `account_exists`. Hoje vincular um
  Google de outro e-mail não muda nada.
- Vincular um provedor com e-mail diferente **não muda** o e-mail da conta.
- Trocar o e-mail é sempre pelo fluxo com senha e código enviado ao e-mail novo (decidido em 12/10/2026), descrito em
  [email-e-dois-fatores.md](email-e-dois-fatores.md). A entrada na lista de convidados acompanha a conta.

### Versão antiga do app
- O servidor continua aceitando `{ nickname }` no pedido de amizade: com `#` procura pelo identificador; sem `#` mantém a
  busca por `display_name` só durante a transição (mesmo erro de ambiguidade de hoje). Depois de uma versão com todos
  atualizados, a busca sem `#` sai.
- Os campos novos (`handle`) entram como **acréscimo** nas respostas (`publicUser`, lista de amigos, pedidos), então app
  antigo e o cliente Android não quebram.

## Restrições
- Sem coleta de dados nova: o identificador não é pesquisável por prefixo (nada de "lucas#..." listando contas); só busca
  exata.
- Limite de tentativas no pedido de amizade por identificador (como o login), para não varrer tags de um nome.
- Textos da interface em português; sem `style=""` (CSP); IPC com argumentos validados no `main`.

## Dependências
- `razze-api/server.js`: colunas `handle_name`, `handle_name_key` (minúsculas) e `handle_tag` em `users`, com
  `UNIQUE(handle_name_key, handle_tag)`; migração; `publicUser`; `POST /v1/auth/register`, `/v1/auth/google`;
  `PATCH /v1/me/handle` (novo, com `handle_changed_at`); `POST /v1/friends/requests`; tabela `user_identities`;
  `POST /v1/me/google` passa a responder `google_taken` com o identificador da outra conta e ganha a opção `move: true`.
- `razze-api/control.js` e `razze-api/admin/`: mostrar, buscar e trocar o identificador.
- `main/razze-api-client.js`, `main/razze-service.js`, `main.js`, `preload.js`: chamada de troca de nome.
- `renderer/conta.js`, `renderer/hub.js`, `renderer/conectividade.js`, `renderer/primeira-entrada.js`, `renderer/admin.js`.
- VPS: deploy da RazzeAPI (passo a passo em `docs/razze-api.md`).
- Cliente Android: só passa a mostrar o `handle` quando quiser (nada quebra).

## Decisões em aberto (com recomendação)
1. ~~Espaço no nome?~~ Decidido (12/10): só letras sem acento e números; a pessoa escolhe o nome ao criar a conta.
2. **Pessoa escolhe a tag?** Recomendo sorteio: escolher deixa "pegar" tags parecidas com as de outra pessoa (`#0001`).
3. **Manter adicionar por e-mail?** Recomendo tirar (privacidade). Se o grupo usa muito, deixar só durante a transição.
4. **Intervalo para trocar o nome:** 7 dias (proposta) ou 30.

## Critérios de aceitação
- [ ] Toda conta (nova e antiga) tem um `nome#tag` único, sem diferenciar maiúsculas.
- [ ] Adicionar amigo por `nome#tag` funciona; nome sem tag dá a mensagem pedindo a tag.
- [ ] Trocar o nome mantém a tag quando possível e respeita o intervalo; amizades e mensagens continuam.
- [ ] `account_exists` mostra o identificador da conta existente.
- [ ] O Google está na `user_identities` e vincular/desvincular continua funcionando.
- [ ] Cadastro por Google com e-mail sem conta pergunta antes "Já tem conta?", e "Entrar e vincular" termina com o Google
      na conta de senha, sem criar conta nova.
- [ ] Vincular um Google que já é de outra conta oferece mover: B só com Google é excluída; B com senha só perde o Google.
- [ ] Conta só pelo Google define senha e então troca de Google, sem passar por um momento sem forma de entrar.
- [ ] Vincular um Google de outro e-mail não muda o e-mail da conta.
- [ ] App antigo continua adicionando amigos e entrando sem erro.

## Testes
- Automáticos: estender `tests/razze-*.test.js` (migração gera identificador único para nomes repetidos e com acento;
  colisão de tag; nome reservado; troca de nome e intervalo; pedido por `nome#tag`, sem tag e com e-mail; `account_exists`
  com identificador; Google migrado para `user_identities`; mover identidade de B para A, com B excluída ou só sem o
  Google, recusado para admin e sem provar as duas contas; conta só-Google define senha e troca de Google; resposta compatível com cliente antigo). E2e: `tests/e2e/razze.js`
  adicionando amigo pelo identificador.
- Manuais: roteiro "Conta, amigos e perfil" em dois PCs, um com o app antigo, depois do deploy na VPS.
