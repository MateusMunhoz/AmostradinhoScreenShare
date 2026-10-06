# Em que sala o amigo está

Status: Feito (plano aprovado em 05/10/2026: ligado por padrão e com o nome do host)

## Objetivo
Hoje só aparecem para os amigos as salas pela internet que a própria pessoa criou. Quem está numa sala da Radmin (ou
da rede local, ou da Razze), mesmo sem ser o host, fica invisível para os amigos que usam outro modo. A ideia é mostrar
**onde** o amigo está ("Na sala de Ciclano · Radmin · 4 pessoas"), sem endereço e sem Entrar.

## Escopo
- Entra: o app de quem está numa sala manda à RazzeAPI, junto da presença que já vai a cada 20 s, um resumo da sala; a
  API devolve esse resumo só aos amigos aceitos; o app mostra na aba **Amigos** do envelope e nos **Amigos online** do
  Início; um interruptor no Perfil para desligar.
- Fica de fora: endereço, porta, código, senha ou id da sala (ninguém entra por aqui); salas escondidas (as das
  chamadas); a opção 2 (sala listada com Entrar e a permissão do host), que pode vir depois sem refazer isto.

## Comportamento esperado
- **Quem está na sala** (logado na conta Razze, com o interruptor ligado): ao entrar numa sala, o app passa a anunciar
  `{ modo, host, pessoas, voz }`:
  - `modo`: `radmin` (Radmin ou rede local), `razze` ou `internet`;
  - `host`: o nome do host como aparece na sala (até 32 caracteres); se o host for você, o seu nome;
  - `pessoas`: quantos estão na sala;
  - `voz`: se você está na voz.

  Ao sair da sala, o anúncio some na hora, sem esperar a próxima batida. Se o app fechar ou cair, o resumo some
  quando a presença expira, como o "online" de hoje.
- **Os amigos** veem embaixo do nome, no lugar de "Online":
  - "Na sala de Ciclano · Radmin · 4 pessoas";
  - "Na sala de Ciclano · Radmin · na voz";
  - "Na sua sala", se é a mesma em que você está (mesmo host, mesmo modo e o número de pessoas bate).

  Sem resumo, continua "Online". "Na sua sala" vale mesmo com o seu interruptor desligado. O texto não tem botão: é só informação. Para entrar, continua o convite pelas
  mensagens ou o endereço.
- **Sala da chamada** (escondida): não anuncia nada; o amigo aparece só "Online".
- **Servidor antigo** (RazzeAPI sem o campo): o app manda e nada aparece, sem erro. **App antigo**: não manda, e o amigo
  aparece só "Online".

## Decisões (aprovadas: ligado por padrão, com o nome do host)
- **Ligado ou desligado por padrão?** O interruptor fica em Perfil › Atividade: "Mostrar aos amigos em que sala estou".
  - Desligado por padrão segue o Jogo e a Música, que são desligados para não expor nada sem a pessoa pedir.
  - Ligado faz a ideia funcionar sem ninguém precisar mexer, e o resumo não tem endereço.
  - Sugestão: **ligado**, com o texto do Perfil dizendo o que vai: "só o nome do host, o modo e quantas pessoas".
- **Nome do host:** é o nome de uma terceira pessoa (o host pode não ser amigo de quem vê). Alternativa mais discreta:
  "Numa sala da Radmin · 4 pessoas", sem o nome. Sugestão: com o nome, porque é o que diz "onde"; dá para tirar depois.

## Mudanças
**RazzeAPI** (`razze-api/control.js`, `razze-api/server.js`):
1. Coluna nova `live_presence.sala_atual` (TEXT), criada com o mesmo `ALTER TABLE` condicional da `internet_room`.
2. `heartbeat`: campo opcional `salaAtual`, conferido. `modo` deve estar na lista; `host` é texto de 1 a 32 caracteres,
   sem controle; `pessoas` é inteiro de 1 a 1000; `voz` é booleano. Qualquer coisa a mais é recusada com
   "Anúncio de sala inválido". Gravado junto da presença.
3. `GET /v1/friends`: cada amigo online ganha `sala` (o resumo mais recente entre as sessões dele, ou `null`).
   `enrichUsers` já monta o online a partir da presença e passa a montar isto também.
   Só amigos aceitos recebem: a rota já lista só amigos, e nenhuma outra rota devolve o campo.
4. Testes em `tests/razze-control.test.js`:
   - anúncio válido e inválido;
   - só o amigo vê, e quem não é amigo não vê;
   - some quando a presença expira;
   - some com `salaAtual: null`.

**Processo principal** (`main.js`, `preload.js`, `main/razze-presence.js`):
5. `cleanSalaAtual(v)` em `razze-presence.js`, que confere como o `cleanInternetRoom`. Em `createPresence`, um
   `getSalaAtual` que vai no `heartbeat`.
6. IPC `razze-sala-atual` (renderer manda o resumo ou `null`; abriu ou fechou: `tick()` na hora, como o
   `razze-internet-room`). Em `preload.js`: `razzeSalaAtual(sala)`.

**Renderer:**
7. `renderer/salas-amigos.js`: `publicarSalaAtual()`, chamado onde a sala muda (entrar, sair, members, voz) e que só
   manda se o resumo mudou (como `publicarSalaInternet`). Não manda com a sala escondida, sem conta ou com o
   interruptor desligado.
8. `renderer/hub.js` (aba Amigos) e `renderer/primeira-entrada.js` (Amigos online): o texto embaixo do nome. A
   presença (`updateFriendsPresence`) passa a copiar `sala` junto do `online`.
9. Perfil › Atividade: o interruptor `atvSala` (`renderer/conta.js`), guardado como o Jogo e a Música
   (`atividadeSala`, `'1'` por padrão). O anúncio sai de `renderMembers` (`membros.js`), que roda a cada mudança de
   pessoas, host e voz, e só manda quando o resumo muda.

**Docs:** guia (Amigos), `docs/razze-api.md` (campo do heartbeat e de `/v1/friends`), desenvolvimento.

## Restrições
- Nada muda no protocolo da sala nem no servidor do modo Internet.
- Nenhum endereço sai do PC.
- Funciona com servidor e app antigos dos dois lados (só não aparece).
- Atualizar a RazzeAPI no servidor depois do merge.

## Critérios de aceitação
- [ ] Amigo numa sala da Radmin (sem ser host) aparece "Na sala de [host] · Radmin · N pessoas" para quem está pela
      internet, em até ~20 s.
- [ ] Saiu da sala: volta a "Online" na próxima atualização de quem vê (a de quem saiu é na hora).
- [ ] Quem não é amigo não recebe o campo; sala escondida não aparece; interruptor desligado não manda nada.
- [ ] Servidor sem o campo: nada quebra.

## Testes
- Automáticos: `razze-control.test.js` (API: só amigos, sem vazar para membros da rede e admin, inválidos, some),
  `razze-presence.test.js` (`cleanSalaAtual` e a batida), e2e `chat.js` (a convidada anuncia a sala da host, sem
  endereço; o interruptor tira na hora; fora da sala não anuncia; os textos) e `mensagens-barra.js` (texto na aba Amigos).
- Manual: dois PCs com contas amigas, um numa sala da Radmin (como convidado), o outro no modo Internet, olhando a aba
  Amigos e o Início.
