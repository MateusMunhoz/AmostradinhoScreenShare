# Entrar na sala de qualquer amigo, com um clique

Status: Implementada em 09/10/2026 (branch `entrar-pelos-amigos`); falta o teste manual em dois ou três PCs e
atualizar a VPS do modo Internet e a RazzeAPI. Mexe em `servidor-internet/server.js`, `main/razze-presence.js` e
`razze-api/`.
Base: [salas-dos-amigos.md](salas-dos-amigos.md) (1.13.0) e [sala-do-amigo.md](sala-do-amigo.md) (opção 2 que ficou de fora)

## Objetivo
Hoje o clique para entrar na sala de um amigo só funciona enquanto **quem criou a sala** estiver nela, e só para os
amigos **dela**. Se o criador sai, a sala some da lista ou volta a pedir senha; se o amigo está lá como convidado,
aparece só "Na sala de X", sem Entrar. A ideia é: logou, viu o amigo numa sala do modo Internet, clicou, entrou.

## Problemas que resolve
1. O criador sai (outra pessoa vira host): o passe dele cai (`removeMember` → `room.passes.remove(id)`), a sala some
   da lista e quem tenta entrar recebe "O convite não vale mais. Peça a senha da sala."
2. O amigo está na sala como convidado: só o criador anuncia (`publicarSalaInternet` exige `criador`), então o amigo
   aparece "Na sala de X · Internet · 4 pessoas" sem botão.
3. Quem entrou por passe não consegue convidar com passe (o servidor recusa `passe` de `viaPasse`): o convite pelas
   mensagens vai sem passe e o amigo digita a senha.

## Escopo
- Entra: um **passe da sala** guardado pelo servidor do modo Internet, que não depende de quem o criou; todo membro
  logado anuncia a sala aos próprios amigos; botão **Entrar** ao lado de "Na sala de X" (aba Amigos e Amigos online
  do Início); uma opção do host para fechar a sala só aos amigos dele; o convite pelas mensagens passa a levar o
  passe da sala.
- Fica de fora: salas da Radmin e da Razze (continuam só com "Na sala de X"; trocar de modo sozinho é a Fase 2);
  aviso na bandeja quando um amigo abre sala (Fase 2); bilhete assinado pela RazzeAPI (Fase 3); expulsar alguém.

## Comportamento esperado
1. **Criar sala (modo Internet):** a tela Criar sala ganha, embaixo de "Mostrar esta sala para meus amigos",
   **Amigos de quem estiver na sala também podem entrar** (marcada por padrão, preferência `salaAmigosMembros`).
   A chamada (`chamada.js`) cria sempre com ela desmarcada.
2. **Dentro da sala:** com a opção ligada, todo membro logado na conta e com os dois interruptores de Perfil ›
   Atividade ligados ("Mostrar aos amigos em que sala estou" e "Deixar meus amigos entrarem na sala em que estou",
   decisão 2) anuncia a sala. Os amigos dele veem:
   - na lista **Salas dos seus amigos** do Início e no HUB › Salas: "Sala de [host] · 4 pessoas · com Fulano, Beltrano"
     (os amigos de quem vê que estão lá) e **Entrar**;
   - na aba Amigos e nos Amigos online: "Na sala de [host] · Internet · 4 pessoas" com **Entrar** do lado.
3. **Entrar:** um clique, sem código e sem senha, pelo passe da sala. Se você já está numa sala, pergunta "Sair desta
   sala e entrar na sala de X?" (como o cartão do convite faz hoje).
4. **Host saiu:** a sala continua na lista e o Entrar continua valendo, enquanto houver alguém dentro anunciando.
5. **Host desliga a opção** (painel da sala, ao lado de Mudar senha; só o host vê): o passe da sala cai na hora; as
   pessoas que já estão dentro ficam. Volta a valer só o passe pessoal de quem entrou com a senha, como hoje
   (só os amigos do criador entram com um clique). Religar gera um passe novo.
6. **Host muda a senha:** o passe da sala troca (os anúncios seguintes já levam o novo). Quem já estava continua.
7. **Passe não vale mais** (opção desligada, sala fechou, servidor reiniciou): o mesmo de hoje, abre o Entrar com
   código, com o código preenchido, e pede a senha.
8. **Convidar pelas mensagens:** quem entrou por passe agora convida com o passe da sala (resolve o problema 3).
9. **Sala oculta** (chamada) ou "Mostrar" desligado: não anuncia nada, como hoje.
10. **"Deixar entrar" desligado no meio da sala:** o anúncio com o passe sai na hora (`razzeInternetRoom(null)`); o
    "Na sala de X" continua. Religar anuncia de novo na hora.

## Decisões (aprovadas em 09/10/2026)
1. **"Amigos dos membros" ligado por padrão**, com o host podendo desligar a qualquer momento. O custo aceito: um
   amigo de um convidado, que o host não conhece, pode entrar.
2. **Interruptor próprio para deixar entrar.** Em Perfil › Atividade, embaixo de "Mostrar aos amigos em que sala
   estou", um segundo interruptor: **"Deixar meus amigos entrarem na sala em que estou"** (`atividadeSalaEntrar`,
   `'1'` por padrão). Ele fecha a sala para os seus amigos sem parar de mostrar onde você está:

   | Mostrar | Deixar entrar | O que os seus amigos veem |
   |---|---|---|
   | ligado | ligado | "Na sala de X · Internet · 4 pessoas" com **Entrar** |
   | ligado | desligado | "Na sala de X · Internet · 4 pessoas", sem Entrar (como hoje para convidados) |
   | desligado | qualquer | "Online" (o segundo fica desligado e apagado, porque não dá para entrar sem ver) |

   Vale para o anúncio que **você** faz. Se um amigo seu também é amigo de outra pessoa da sala que deixa entrar, ele
   ainda vê o Entrar pela outra pessoa (o "com Fulano" mostra por quem). Fechar a sala para todos é o interruptor do
   host (item 5 do comportamento). Para quem criou a sala, a caixinha "Mostrar esta sala para meus amigos" da tela
   Criar sala continua valendo como hoje; este interruptor só pesa quando ela está marcada.
3. **Nome na lista:** "Sala de [host]" (pode ser alguém que você não conhece) + "com [seus amigos que estão lá]".

## Mudanças
**Servidor do modo Internet** (`servidor-internet/server.js`; não muda `sala-protocolo.js`):
1. `createPasses` ganha o passe da sala (`trocarSala(on)`, `sala()`), e a sala ganha `amigosMembros` (booleano).
   `hello { create: true, amigosMembros }`: `amigosMembros !== false` (cliente antigo não manda: ligado).
   Com ligado, o servidor gera 32 bytes aleatórios (base64url, 43 caracteres, o mesmo formato do `PASSE_RE`). Diferente
   dos passes pessoais, fica também em texto, só na memória, porque é entregue a quem entra; confere pelo HMAC.
2. `welcome` ganha `passeSala` (o passe em texto, ou `null`) e `amigosMembros` para **todos** os membros, inclusive
   quem entrou por passe, e a feature `passe-sala`. Quando o passe muda ou cai, uma mensagem só:
   `broadcast { type: 'passe-sala', passe, amigosMembros }`.
3. `hello { room, passe }`: entra se `passes.check(passe)` **ou** o passe for o da sala. Mesma demora e mesmo limite
   de tentativas por IP, mesma mensagem de erro, a comparação leva sempre o mesmo tempo (confere os dois sempre).
   `resume` com `passeDigest` continua igual.
4. `removeMember` não mexe no passe da sala (ele é da sala, não da pessoa); a sala vazia some com ele.
5. `senha` (host): além de `passes.clear()`, troca o passe da sala (se ligado) e avisa todos.
6. Mensagem nova `{ type: 'amigos-membros', on }`: só o host; `false` apaga o passe da sala, `true` gera um novo;
   avisa todos com `passe-sala`. Quem não é host recebe `senha-erro` com "Só o host da sala muda isso."
7. Tudo que chega é conferido: `on` booleano, nada mais; mensagem de quem não está na sala é ignorada.

**RazzeAPI** (`razze-api/control.js`, `razze-api/server.js`):
8. `heartbeat.internetRoom` aceita `host` opcional (1 a 32 caracteres, sem controle, o mesmo `clean` do `salaAtual`).
   Fora disso, igual: `servidor`, `codigo`, `pessoas`, `passe`.
9. `friendRooms(viewerId)`: continua juntando por `servidor#codigo`, agora com:
   - `amigos: [{ userId, displayName }]`: todos os amigos de quem vê que anunciaram aquela sala (até 10);
   - `host`: o `host` anunciado, se houver; senão, o nome de quem anunciou (como hoje, app antigo vê igual);
   - `passe`: prefere o anúncio que tem passe; `pessoas`: o maior número; `userId`: o primeiro amigo (app antigo).
   Continua só para amigos aceitos; o admin continua sem ver `internet_room`.
10. `docs/razze-api.md`: campo `host` no heartbeat e `amigos` em `GET /v1/rooms` → `internet`.

**Processo principal** (`main/razze-presence.js`): sem IPC novo (o `razze-internet-room` já existe).
11. `cleanInternetRoom` aceita `host` (mesmo corte do `cleanSalaAtual`: sem controle, `trim`, até 32).

**Renderer:**
12. `index.html` + `renderer/inicio.js`: a caixinha "Amigos de quem estiver na sala também podem entrar" (só no modo
    Internet; `salaAmigosMembros`, `'1'` por padrão). `renderer/sala.js` manda `amigosMembros` no `hello` de criar;
    `renderer/chamada.js` manda `false`.
13. `renderer/sala.js`: guarda `state.cloud.passeSala` do `welcome` (só com a feature `passe-sala`) e trata as
    mensagens `passe-sala` e `amigos-membros` (atualiza e chama `publicarSalaInternet`).
14. `renderer/salas-amigos.js`:
    - `salaEntrarLigada()`: `load('atividadeSalaEntrar', '1') === '1'`.
    - `publicarSalaInternet`: anuncia se `salaEntrarLigada()` e (`criador` e `amigos`, como hoje) **ou**
      (`passeSala` e `salaAtualLigada()` e a sala não é oculta). Senão, retira o que tinha anunciado. O passe
      anunciado é `passeSala || salasAmigos.passe || null`. Vai junto o `host` (`nameOf(state.hostId)` ou o meu
      nome). Já é chamado em `members`/host/entrar; passa a ser chamado também a cada troca do passe da sala e ao
      mudar qualquer um dos dois interruptores de Atividade.
    - `garantirPasse`: devolve `passeSala` quando existe (convite pelas mensagens de quem entrou por passe).
    - `receberSalasAmigos`: lê `amigos` (conferido: até 10, `userId` e `displayName` texto curto) e `host`.
    - `salaDoAmigo(f)`: a sala da lista em que `f.id` está entre os `amigos` (RazzeAPI antiga: `userId`), sem ser a
      minha, e só com o app no modo Internet (para o botão do item 15).
15. `renderer/hub.js` (aba Amigos) e `renderer/primeira-entrada.js` (Amigos online): botão **Entrar** ao lado de
    "Na sala de X" quando `salaDoAmigo(f)` existe; chama `entrarPeloAmigo` (pergunta antes de sair da sala em que
    estou, como o `aceitarConvite`, e depois `entrarSalaAmigo`).
16. `renderer/sessoes.js`: o cartão da sala mostra "com Fulano, Beltrano" (os `amigos`).
17. Painel da sala (onde fica o Mudar senha, `renderer/chamada.js`): o interruptor do host
    "Amigos de quem está na sala podem entrar", só com a feature `passe-sala`.
18. `index.html` + `renderer/conta.js`: o interruptor novo `atvSalaEntrar` em Perfil › Atividade, embaixo do
    `atvSala`, guardado como os outros (`atividadeSalaEntrar`, `'1'` por padrão), desligado e apagado quando o
    `atvSala` está desligado (decisão 2). Texto de ajuda: "Os amigos veem um Entrar e entram sem senha nas salas
    pela internet."

**Docs:** `docs/guia.md` (Amigos e Criar sala), `docs/razze-api.md`, `servidor-internet/README.md` (mensagens novas),
`docs/desenvolvimento.md` se algo de arquitetura mudar, e um parágrafo em [salas-dos-amigos.md](salas-dos-amigos.md)
apontando para esta spec.

**Bug achado no caminho:** o servidor do modo Internet marca toda sala como `oculta` (ela não entra na lista da rede
local), e o `salaAtualResumo` tratava isso como sala escondida: o "Na sala de X · Internet" nunca saía. Agora, no modo
Internet, só a sala da chamada é escondida (`cloud.chamada`, marcado por quem liga e por quem atende, `chamada.js`).

## Restrições
- **Compatibilidade:**
  - Servidor antigo (sem `passe-sala`): tudo como hoje; a caixinha nova some.
  - RazzeAPI antiga: ignora `host`, não manda `amigos`; o app cai no comportamento de hoje (Entrar só no cartão
    da sala, sem o "com Fulano").
  - App antigo na sala: não recebe nem anuncia o passe da sala, mas entra pelo passe normalmente, e enxerga as salas
    anunciadas pelos outros como hoje.
- A senha da sala continua sem sair do PC de quem a digitou. O passe da sala só serve para aquela sala e cai com a
  sala, com a troca da senha ou com o host desligando.
- Nada muda no `sala-protocolo.js` nem no `signaling.js` (Radmin/Razze).
- Todo dado que chega (do servidor, da API, da janela) é conferido e limitado, no padrão de `sala-protocolo.js`.
- Depois do merge: **atualizar a VPS do modo Internet e a RazzeAPI** antes de anunciar a novidade.

## Critérios de aceitação
- [ ] A cria uma sala Internet; B (amigo de A) entra com um clique; A sai; C (amigo de A e de B) ainda vê a sala e
      entra com um clique.
- [ ] D (amigo só de B, convidado) vê "Sala de A · com B" e entra com um clique; com a opção desligada pelo host,
      D não vê mais a sala e, com o Entrar antigo na tela, recebe o pedido de senha.
- [ ] Mudar a senha troca o passe: o passe antigo deixa de entrar, os anúncios seguintes levam o novo.
- [ ] B (que entrou por passe) convida E pelas mensagens e E entra sem senha.
- [ ] Na aba Amigos, "Na sala de X" tem Entrar quando a sala é do modo Internet e anunciada; Radmin/Razze, não.
- [ ] Chamada, sala oculta ou "Mostrar" desligado: não anuncia nada.
- [ ] "Deixar entrar" desligado: os amigos continuam vendo "Na sala de X", sem Entrar e sem a sala na lista (a não
      ser por outro amigo na sala que deixa entrar); religar volta o Entrar sem esperar a próxima batida.
- [ ] Quem não é amigo não recebe nada; o admin não vê `internet_room`.
- [ ] Servidor antigo, RazzeAPI antiga e app antigo: nada quebra (cada caso da seção Compatibilidade).

## Testes
- Automáticos:
  - `tests/servidor-internet.test.js`: o passe da sala vem no `welcome` para quem entrou por senha e por passe; entra
    com ele; continua valendo depois de o criador sair; `senha` troca; `amigos-membros` só do host, `false` apaga e
    `true` gera outro; `amigosMembros: false` no criar não gera; passe errado conta no limite por IP; mesma mensagem
    de erro.
  - `tests/razze-control.test.js`: `internetRoom.host` válido e inválido; `amigos` junta os anunciantes amigos de quem
    vê, sem quem não é amigo; prefere o anúncio com passe; admin não vê.
  - `tests/razze-presence.test.js`: `cleanInternetRoom` com `host`.
  - e2e `tests/e2e/entrar-pelos-amigos.js` (`npm run test:e2e -- entrar-pelos-amigos`, servidor local, sem RazzeAPI:
    o anúncio é conferido no app e entregue ao terceiro como a API entregaria): a convidada anuncia a sala com o passe
    da sala; o cartão mostra "com Bia" e a aba Amigos, o Entrar (só no modo Internet); quem criou sai e o terceiro
    entra pelo Entrar, sem senha; "Deixar entrar" desligado retira o anúncio e mantém o "Na sala de X"; com "Mostrar"
    desligado o segundo interruptor fica apagado; o host desliga (o passe antigo não entra, ninguém sai) e religa
    (passe novo).
- Manuais (dois ou três PCs, contas amigas, VPS e RazzeAPI atualizadas): os quatro primeiros critérios, numa call real.
