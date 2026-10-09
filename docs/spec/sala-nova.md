# Sala nova: cada coisa no seu lugar

Status: Proposta (09/10/2026, branch `sala-nova`, a partir de `inicio-novo`). Só interface: não mexe em servidor, IPC,
protocolo da sala nem `boot.js`.
Desenho: a quarta proposta da conversa ("console estelar"): cabeçalho da sala, palco, painel com abas e o cartão "Seu
sinal" fixo embaixo do painel.

## Objetivo
Na sala, quem usa não sabe onde mexer em **voz**, **transmissão**, **chat** e **configurações da sala**. Hoje:
- a barrinha da direita mistura coisas da sala (Pessoas, Chat, Voz, Transmissão, Sair) com coisas do app (Início,
  Modo gamer, Feedback, Configurações), tudo só ícone;
- as configurações da sala (endereço, senha, "Amigos de quem está na sala podem entrar") ficam escondidas no fim do
  painel de pessoas;
- os controles da voz ficam na barra de baixo do palco e somem da vista quando o painel de voz está aberto ao lado;
- o palco vazio diz "Clique em Assistir ao lado de quem está transmitindo" e manda procurar no painel.

A regra nova: **cada coisa mora numa zona, e a engrenagem de cada zona configura só aquela coisa.**

| Zona | O que tem |
|---|---|
| Cabeçalho da sala (em cima do palco) | Nome da sala (abre o menu da sala), rede, quantas pessoas, Convidar, Sair |
| Palco | As telas; vazio, quem está transmitindo com "Assistir" |
| Painel, com abas **Voz · Chat · Pessoas** | O conteúdo |
| Cartão **Seu sinal** (fixo no pé do painel) | Sua voz e sua transmissão; sempre visível |
| Barrinha da direita | Só o app: Perfil, Início, Nova versão, Modo gamer, overlay, Feedback, Configurações |

## Escopo
- Entra: o cabeçalho e o menu da sala, as abas do painel, o cartão "Seu sinal" (e a versão recolhida dele na
  barrinha), o palco vazio com quem transmite, a barrinha só com coisas do app, e o acabamento estelar no tema Estelar.
- Fica de fora:
  - **o mapa estelar da voz** (`renderer/ceu-voz.js`, `#voiceSkyBox` e a visão Mapa): fica exatamente como está, com o
    céu pequeno em cima da lista, a visão Mapa grande, zoom, foco na pessoa e a gaveta do canal. Só muda de lugar o
    botão Lista/Mapa (ver "Painel");
  - a constelação do palco vazio (o "N" de estrelas) e o fundo do palco: continuam; o que entra é a lista de quem
    transmite embaixo dela;
  - o palco com telas (grade, destaque, pausadas, divisória, rolagem), a escolha do que transmitir e do som do PC, o
    chat por dentro, o cartão da pessoa, a barra de mensagens de baixo (`dmBar`), atalhos e overlay no jogo;
  - o Início (spec [inicio-novo.md](inicio-novo.md)) e o nome embaixo dos ícones da barrinha (decisão 4 de lá).

## Comportamento esperado

### Cabeçalho da sala
- Uma linha fina em cima do palco: **nome da sala ▾** · rede (bolinha de estado) · "5 pessoas" · espaço · **Convidar**
  · **Sair**.
- O nome abre o **menu da sala** (popover, fecha com Esc e clique fora):
  - Endereço da sala (copiar) e senha, como hoje no `pp-addr`;
  - "Amigos de quem está na sala podem entrar" (só o host, como hoje; "Mostrar esta sala para quem está na rede"
    continua só em Criar sala: mudar com a sala aberta precisaria de mensagem nova no protocolo);
  - Desempenho (abre as estatísticas, hoje `openStatsRoom`);
  - aviso da Radmin (`noRadmin`), quando houver;
  - Sair da sala.
- Convidar faz o que o `dockAddr` faz hoje (copia o convite).
- Sair abre o mesmo fluxo de hoje (`leaveBtn`, com o diálogo do host).

### Palco
- Com telas: igual a hoje. **Grade / Destaque** vai para o canto de cima do palco, só quando há tela aberta.
- Vazio: a constelação de hoje continua; embaixo, em vez de "Clique em Assistir ao lado de quem está transmitindo",
  a linha "TRANSMITINDO AGORA" e um botão por pessoa ("▶ Assistir Dawg"). Sem ninguém transmitindo: "Ninguém está
  transmitindo. Use Transmitir tela, embaixo do painel."

### Painel
- Abas no topo: **Voz**, **Chat** (com o número de não lidas), **Pessoas** (com o número de pessoas). A aba aberta fica
  guardada (`save`).
- **Voz**: o painel "Chat de voz" de hoje inteiro (céu, canais, pessoas, volume de cada um, Assistir, Pôr música,
  Subsala). O par de botões Lista/Mapa vira um seletor com nome ("Lista ▾ / Mapa ▾") no lugar do título "Chat de voz".
- **Chat**: o chat de hoje (`#chatTab`), sem mudança por dentro.
- **Pessoas**: a lista do `peoplePop` de hoje (quem está na sala, download, "Na sala · 5"). O cartão da pessoa abre
  igual.
- **Ver Voz e Chat juntos** (decisão 1): um ícone "abrir ao lado" na aba Chat divide o painel: Voz em cima, Chat
  embaixo, com uma divisória arrastável. Clicar de novo junta.
- Recolher: um ícone ao lado das abas esconde o painel; o palco ocupa o espaço.

### Cartão "Seu sinal"
Fixo no pé do painel, visível em qualquer aba:
- **Fora da voz**: "Fora da voz" + **Entrar na voz ▾** (o mesmo menu de hoje, `voiceJoinMore`).
- **Na voz**: linha "Voz conectada · Voz geral · 32 ms" com **Sair da voz**; embaixo, você (foto e nome, "Microfone
  ligado/desligado"), **microfone**, **fone** e a engrenagem **Voz e áudio** (o `voiceSettingsBtn` de hoje).
- **Transmitir tela**: o `shareBtn`. Ao vivo, o botão vira o chip de hoje (`liveChip`: miniatura que é o "Me ver", o
  que transmite, abrir, trocar, parar). Passar o mouse no chip mostra o que o "Sua transmissão" do `peoplePop` mostra
  hoje (quem assiste, codificador, ausente, sem áudio).
- Janela flutuante ligada: o chip de hoje (`pipChip`) aparece embaixo do Transmitir.
- Música tocando no seu canal: uma linha "♪ título" com o menu de hoje (`navMusic`).
- **Painel recolhido**: o cartão vira uma coluninha no pé da barrinha (estado da voz, microfone, fone, transmitir, sair
  da voz). Os controles da voz nunca somem da tela enquanto você está na sala.
- **No Início sem sair da sala**: a faixa da chamada (`homeCall`) já mostra a sala; ganha microfone e fone.

### Barrinha da direita
Fica: Perfil, Início / Voltar para a sala, Nova versão, Modo gamer, overlay do chat no jogo, Feedback, Configurações.
Saem: Pessoas, Chat, Voz, Transmissão (viram abas e palco), Música (vai para o cartão e a aba Voz), Voz e atalhos (vai
para o cartão) e Sair (vai para o cabeçalho). A barrinha fica igual dentro e fora da sala.

### Acabamento do tema Estelar
Só em `styles-estelar.css` e no Padrão (Estelar); os outros temas usam o layout novo com o acabamento deles.
- Rótulos pequenos em mono espaçada e caixa alta ("VOZ GERAL", "TRANSMITINDO AGORA", "SEU SINAL"), como o
  "NEBULA ✦ REDE ESTELAR" de hoje.
- Cantos em colchete ciano no palco e no cartão "Seu sinal"; estrelinha marcando a aba aberta.
- No cartão, a ondinha que o `voiceMe` já mostra quando você fala, parada com o microfone desligado.
- Os botões continuam com nome claro (Voz, Chat, Pessoas, Transmitir tela, Nova subsala). O tema fica na decoração,
  não no que o botão faz (decisão 2).

### Tamanhos
- Janela estreita: o cabeçalho junta Convidar e Sair no "…" (o `fitDock` de hoje passa a cuidar do cabeçalho); o
  painel pode ser recolhido e o cartão vira a coluninha.
- Modo gamer e overlay: sem mudança.

## Onde cada coisa de hoje vai parar
Checklist: tudo isto continua funcionando depois da mudança.

| Hoje | Na sala nova |
|---|---|
| `shareBtn` Transmitir | Cartão "Seu sinal" |
| `liveChip` (Me ver, fonte, quem assiste, abrir, trocar, parar) | Cartão, no lugar do Transmitir quando ao vivo |
| `pipChip` (janela flutuante) | Cartão, embaixo do Transmitir |
| `voiceDock`: bolinhas, "Na voz", `voiceMute`, `voiceDeafen`, `voiceJoin`, `voiceJoinMore` | Cartão (as bolinhas saem: a aba Voz e a coluninha mostram quem está) |
| `stageLayout` Grade / Destaque | Canto do palco, com tela aberta |
| `dockAddr` Convidar | Cabeçalho |
| `openGeneralSettingsRoom` | Barrinha (Configurações) |
| `openStatsRoom` | Menu da sala › Desempenho |
| `chatToggle` | Aba Chat |
| `dockMore` (janela estreita) | "…" do cabeçalho |
| `peopleBtn` / `peoplePop` (lista, download) | Aba Pessoas |
| `myShare` "Sua transmissão" | Dica do chip ao vivo |
| `pp-addr`: `roomAddress`, `roomSenha`, `roomAmigosAberta`, `noRadmin` | Menu da sala |
| `navChat`, `navVoice`, `navStreams` | Abas (Transmissão = palco, sempre visível) |
| `navMusic` | Cartão (tocando) e aba Voz (Pôr música) |
| `voiceSettingsBtn` / `paneVoiceSettings` | Engrenagem do cartão |
| `paneVoiceJoin` | Entrar na voz do cartão |
| `leaveBtn` | Cabeçalho (Sair) e menu da sala |
| `voiceViewList` / mapa | Seletor "Lista ▾ / Mapa ▾" na aba Voz; o mapa em si não muda |
| `workspaceEmpty` ("Escolha os painéis...") | Sai: o palco está sempre lá e o painel tem sempre uma aba |
| `navProfile`, `dockHome`, `navBackToRoom`, `navUpdate`, `navGamer`, `overlayToggle`, `navFeedback`, `navSettings` | Barrinha, sem mudança |

## Decisões (preciso de você)
1. **Ver Voz e Chat ao mesmo tempo** (hoje dá, ligando os dois na barrinha).
   - Sugestão: abas + "abrir ao lado" na aba Chat (Voz em cima, Chat embaixo).
   - Alternativa: sem divisão; uma aba por vez.
2. **Palavras temáticas** ("5 a bordo", "Capitão", "Nova órbita", "fora da órbita").
   - Sugestão: só em rótulo que não é botão ("a bordo", "Capitão"); botões e abas com texto claro.
   - Alternativa: nenhuma palavra temática.
3. **Sair da sala**.
   - Sugestão: "Sair" no cabeçalho e também no fim do menu da sala.
   - Alternativa: só no menu da sala (mais discreto, um clique a mais).
4. **Ordem de entrega**.
   - Sugestão: um PR com tudo, mantendo os ids de hoje nos botões novos (ver Restrições), para não ficar meio a meio.
   - Alternativa: dois PRs (1: cabeçalho, menu da sala e barrinha só do app; 2: abas e cartão "Seu sinal").

## Mudanças
- `index.html`: cabeçalho da sala (`roomHead`, `roomMenu`) em cima do palco; o `pp-addr` se muda para o menu; abas no
  `workspacePanes` (`paneTabs`) com Voz, Chat e Pessoas; o cartão `seuSinal` no pé do painel, recebendo os elementos
  do `voiceDock`, `shareBtn`, `liveChip` e `pipChip` (movidos, com os mesmos ids); a coluninha recolhida
  (`seuSinalMini`) na barrinha; sai da barrinha `peopleBtn`, `navChat`, `navVoice`, `navStreams`, `navMusicWrap`,
  `voiceSettingsBtn` e `leaveBtn` (os ids vão para os botões novos que fazem a mesma coisa). Sem script novo: nada
  muda em `PACK_FILES` nem em `build.files`.
- `renderer/navegacao.js`: as abas no lugar dos botões que ligam e desligam painéis; a divisão Voz/Chat; o recolher;
  `fitDock` passa a cuidar do cabeçalho; `renderHomeCall` com microfone e fone.
- `renderer/membros.js` e `renderer/chat.js`: a lista de pessoas na aba (no lugar do `peoplePop`); contadores nas abas.
- `renderer/salas-amigos.js` (`renderAmigosMembros`) e `renderer/sala.js`: o menu da sala.
- `renderer/voz.js`: o cartão (fora da voz, na voz, ping, nível do microfone); `renderer/transmitir.js` e
  `renderer/pip.js`: o chip ao vivo e o da janela flutuante dentro do cartão; `renderer/musica.js`: a linha da música.
- `renderer/palco.js`: o palco vazio com quem transmite e o Grade/Destaque no canto.
- `renderer/ceu-voz.js`: **sem mudança.**
- `styles.css` e os sete temas: os seletores da barrinha (`workspace-tab`, `rail-*`), do `.dock`, do `peoplePop` e do
  painel de voz (skill `revisar-ui`); acabamento estelar em `styles-estelar.css`.
- Docs: `docs/guia.md` (a sala), `docs/roteiro-de-teste.md`.

## Restrições
- Os ids que os testes usam continuam valendo, no botão novo que faz a mesma coisa: `voiceJoin`, `voiceMute`,
  `voiceDeafen`, `shareBtn`, `stopShareBtn`, `peopleBtn` (abre a aba Pessoas), `navChat`/`navVoice` (abrem as abas),
  `navStreams`, `leaveBtn`, `dockAddr`, `dockMore`, `openStatsRoom`, `stageLayout`, `voiceSettingsBtn`, `paneVoiceJoin`.
- O mapa estelar (`ceu-voz.js`, `voiceSkyBox`, visão Mapa) não muda.
- Sem animação contínua (regra do renderer); a ondinha do cartão é a do `voiceMe` de hoje.
- Contraste 4.5:1, alvos de 44 px nos botões do cartão, tudo pelo teclado (abas com setas, Esc fecha o menu da sala).
- Funciona nos três modos de rede, sem conta e no celular (`celular.js`, que tem layout próprio: conferir).

## Critérios de aceitação
- [ ] Na sala, microfone, fone e Sair da voz estão visíveis em qualquer aba e com o painel recolhido.
- [ ] Endereço, senha e "Amigos de quem está na sala podem entrar" ficam só no menu da sala.
- [ ] A barrinha é a mesma dentro e fora da sala.
- [ ] O palco vazio mostra quem transmite com Assistir; a constelação continua.
- [ ] O mapa estelar da voz funciona como hoje (céu, Mapa, zoom, foco, gaveta do canal).
- [ ] Dá para ver Voz e Chat juntos (se a decisão 1 for a sugestão).
- [ ] Tudo da tabela "Onde cada coisa de hoje vai parar" funciona.

## Testes
- Automáticos:
  - `npm test`, `npx electron tests/e2e/carga.cjs`, `npm run test:settings`;
  - e2e afetados (usam os ids da barrinha e do dock): `barra`, `voz-painel`, `voz`, `subsalas`, `som`,
    `varias-telas`, `troca-de-host`, `microfone`, `musica`, `religar`, `voz-assistir`, `internet`, `filtros`;
  - e2e novo `sala-nova.js`: abas (troca, contador do chat, aba guardada), cartão em cada aba e recolhido, menu da
    sala (host e não host), palco vazio com Assistir, divisão Voz/Chat.
- Manuais: os sete temas em janela larga e estreita (skill `revisar-ui`); uma call de verdade com o
  [roteiro de teste](../roteiro-de-teste.md) (voz, transmitir, janela flutuante, overlay no jogo).
