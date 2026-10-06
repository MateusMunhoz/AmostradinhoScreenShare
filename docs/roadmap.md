# Roadmap: o que falta para competir com Discord e TeamSpeak

*Criado em 28/09/2026, a partir da análise de concorrência da mesma data. Revisar todo mês; a concorrência muda rápido
(TeamSpeak 6 ainda em beta, Discord mudando preço e verificação de idade).*

## Premissas

- **Equipe:** 3 pessoas em meio período (Mateus, Cristian e Andrick) + agente de código. As estimativas foram feitas
  quando a equipe tinha 2 pessoas; estão em **semanas de uma pessoa** e são aproximadas; o que está em "Depois" é direção, não compromisso.
- **Cadência:** versões pequenas e frequentes (o app se atualiza pela sala), cada item atrás de testes de ponta a ponta.
- **Divisão do tempo:** ~70% roadmap, ~20% saúde do código e testes, ~10% bugs e pedidos dos amigos.
- **O que não muda:** sem servidor central obrigatório, sem conta, sem coleta de dados. Toda peça nova precisa caber
  nisso (servidor só como opção de reserva).

## Estado em 05/10/2026 (versão 1.17.2)

Última release: **1.17.2** (GitHub › Releases). O texto abaixo é de 28/09 a 03/10 e ainda não foi revisado; onde ele
diz "sem conta" ou fala em Hyperswarm, vale o que está aqui.

**Já saiu (1.15 a 1.17):**
- Clipes dos últimos 30 s, com som e duração escolhida (P4).
- Voz e microfone; temas Renascença e Top Gun (cabine do F-14, radar na voz, chamadas de rádio).
- Primeira entrada em 3 telas e Início com amigos online, Ligar e **Abrir minha sala** em 1 clique.
- **Conta na RazzeAPI** (servidor próprio na VPS): amigos por link ou código curto, trocar senha e "Esqueci a senha"
  por código do administrador, frase no perfil, foto e fundo com editor de recorte, atividade (jogo e Spotify) e **Entrar com Google**.
- A VPS foi atualizada para esse servidor em 05/10/2026 (passo a passo em [razze-api.md](razze-api.md)).

**Mudou de rumo:**
- O protótipo Hyperswarm foi abandonado; amigos e salas passam pela RazzeAPI (veja P1).
- A premissa "sem conta" não vale mais para amigos: a conta na RazzeAPI existe e é o caminho dos links de amigo.

**Em andamento:** blueprints de aviões clássicos para o tema Top Gun (só desenhos reais com licença livre, em
`assets/temas/OBRAS.md`) e ícone do `.exe` do Top Gun.

**Teste manual pendente:** roteiro "Conta, amigos e perfil" em 2 PCs ([roteiro-de-teste.md](roteiro-de-teste.md)).

## Visão geral

| Tema | Por quê |
|---|---|
| **Confiança e prova** | A privacidade é o maior diferencial contra o Discord; hoje o chat e a senha passam sem criptografia, o que contradiz essa mensagem. E "menos atraso que o Discord" ainda não tem número. |
| **Entrar sem VPN** | É onde o Discord mais ganha: "manda o link e entra". A dependência da Radmin é a barreira nº 1. |
| **Mais gente assistindo** | Hoje cada espectador puxa vídeo do PC de quem transmite; com 5+ pessoas o upload vira o limite (Discord: 50). |
| **Jogar junto** | Nenhum dos dois tem: quem assiste controlar o jogo de quem transmite (hoje só Parsec/Steam Remote Play). É o diferencial para um app com foco em tela. |
| **Alcance** | Celular e Linux: o Discord está em tudo; o Tela P2P só no Windows. |

### Prioridade (ICE: impacto × confiança × facilidade, de 1 a 10)

| Item | Impacto | Confiança | Facilidade | ICE |
|---|---|---|---|---|
| A1. Chat e senha criptografados | 6 | 9 | 8 | 432 |
| A2. Atraso da tela medido e à vista | 5 | 8 | 8 | 320 |
| P2. Histórico e "desde a sua última visita" | 6 | 8 | 6 | 288 |
| P4. Clipe dos últimos 30 s | 6 | 7 | 6 | 252 |
| P1. Entrar pela internet sem VPN | 10 | 7 | 3 | 210 |
| A3. Peso no PC à vista + modo jogo | 4 | 6 | 7 | 168 |
| P3. Espectadores repassando o vídeo | 7 | 6 | 3 | 126 |
| D2. Assistir pelo celular | 6 | 6 | 3 | 108 |
| D1. Jogar junto (controle remoto) | 9 | 5 | 2 | 90 |
| D3. Linux | 5 | 5 | 2 | 50 |

A ordem abaixo não segue só o ICE: **P1 vem antes dos outros "Próximos"** porque destrava quase tudo (celular fora de casa,
espectadores de fora, convidar amigo novo), e **A1 tem que vir antes de P1** (abrir a sala para a internet sem criptografia
seria um passo atrás).

## B0. Briefing para 50+ pessoas

**Prioridade máxima. É a meta que puxa todo o resto.** Uma pessoa passa o briefing de missão do DCS (mapa, kneeboard,
slides) e fala; 50+ assistem, sem Radmin e sem servidor obrigatório (a VPS só como último recurso). Plano, camadas,
números e teste de carga (primeiro forjado com robôs, depois com gente) em [spec/briefing-50.md](spec/briefing-50.md).

## Ordem combinada em 01/10/2026 (rumo ao B0)

Entrar de forma fluida, sem Hamachi/Radmin: adicionar amigo, ver no lobby a sala dele, entrar com um clique.

| # | Item | Depende de | Observação |
|---|---|---|---|
| 0 | **Protótipo Hyperswarm no Electron (2 dias)** + medir o bitrate de um briefing real | nada | Tira o maior risco cedo; a medição já orienta o B0 |
| 1 | **A1. Cripto da sala** | nada | Pré-requisito para abrir a sala para a internet |
| 2 | **Identidade e amigos sem servidor** | 0 | Cada PC gera um par de chaves (sem conta); "Adicionar amigo" por código curto; presença pela DHT (tópico = hash da chave). Conta Razze vira opcional |
| 3 | **Lobby: salas dos amigos** | 2 | Na tela inicial, a sala aberta de um amigo adicionado aparece com "Entrar"; amigo entra sem código e senha (a chave já prova quem é) |
| 4 | **Túnel invisível (P1 fase 2)** | 0, 1 | Deixado de lado em 03/10/2026 (ver P1). A ponte Hyperswarm faria o papel do Hamachi sem instalar nada |
| 5 | **Constelação de amigos + estrela cadente** | 2 (constelação); nada (estrela) | A estrela cadente pode sair já. Ver "Tela inicial" abaixo |
| 6 | **Enquete de próximos temas** | 2 | Só votar nas opções da lista, sem sugerir tema |
| 7 | **Razze: decidir o destino** | 2, 3, 4 provados | **Não remover antes.** Ver "Razze e WireGuard" abaixo |
| 8 | **B0: Modo Briefing, voz palco, corrente (P3), teste forjado → teste real** | 1–4 | Ver a spec |

### Tela inicial
- **Constelação = amigos online.** Hoje o fundo é só o céu estrelado (`--st-sky` em `styles-estelar.css`); o antigo exemplo de sala saiu.
  Passa a mostrar só os amigos adicionados que estão online: cada um é uma estrela com a foto/nome no balão; quem está
  numa sala aparece ligado ao "sol" da sala, que se clica para entrar. Sem amigos online, o céu fica vazio e calmo, com
  um convite discreto para "Adicionar amigo".
- **Estrela cadente:** uma de vez em quando, em intervalo aleatório (ex.: 20–90 s), traço curto e fino nas cores do
  tema atual. Respeitar "reduzir movimento" do sistema e a opção de esconder o céu. Sem animação contínua: só CSS ou um
  frame por vez enquanto a estrela cai.
- **Enquete:** cartão abaixo de "Criar sala"/"Entrar com código", no mesmo estilo do cartão de Novidades. As opções vêm
  junto com a versão do app (lista fixa); 1 voto por pessoa (assinado pela chave do item 2), que pode trocar enquanto
  a enquete estiver aberta; os votos se espalham entre os PCs pela DHT e cada um soma localmente. Sem campo de texto.
- **Ordem visual sugerida:** Criar sala → Salas dos amigos (quando houver) → Entrar com código (vira secundário,
  recolhido) → Enquete → Novidades.

### Razze e WireGuard
- Hoje a Razze faz **contas, amigos, presença, salas dos amigos, mensagens diretas e a VPN WireGuard**
  (`main/razze-*.js`, `razze-api/`). Tirar a Razze sem substituto apaga amigos e mensagens.
- **WireGuard como está não compensa** (Radmin/Hamachi já resolvem e ele pede administrador e um adaptador de rede).
  Só vale se ficar **invisível**: túnel no próprio app, sem adaptador e sem elevação. É o que a ponte Hyperswarm (item
  4) faz, então o mais provável é o túnel substituir o WireGuard.
- Caminho sugerido: (1) amigos e presença sem servidor funcionando lado a lado com a Razze; (2) "Importar meus amigos
  da Razze" (pareia as chaves novas por quem já é amigo lá), para ninguém refazer a lista; (3) quando o túnel provar
  casa↔4G, desligar o WireGuard; (4) decidir se a RazzeAPI some ou fica como reserva opcional (mensagens para quem
  está offline, por exemplo).

## Agora (próximas 4 semanas): Confiança e prova

| Item | Status | Esforço | Depende de |
|---|---|---|---|
| A1. Chat e senha criptografados | Não começado | 1–1,5 sem | nada |
| A2. Atraso da tela medido e à vista | Não começado | 1 sem | nada |
| A3. Peso no PC à vista + modo jogo | Não começado | 1 sem | nada |

## Próximo (1 a 3 meses): Entrar sem VPN e mais gente assistindo

| Item | Status | Esforço | Depende de |
|---|---|---|---|
| P1. Entrar pela internet sem VPN (3 fases) | Em andamento: o modo Internet por VPS ([servidor-internet](../servidor-internet/README.md)) é o padrão para quem instala desde 03/10/2026. A fase 2 (Hyperswarm) foi deixada de lado | 4–6 sem | A1 |
| P2. Histórico e "desde a sua última visita" | Não começado | 2 sem | nada |
| P3. Espectadores repassando o vídeo | Não começado | 3–4 sem | melhor depois de P1 |
| P4. Clipe dos últimos 30 s | Não começado | 1–2 sem | nada |

## Depois (3 a 6+ meses): Jogar junto e alcance

| Item | Status | Esforço | Depende de |
|---|---|---|---|
| D1. Jogar junto (teclado, mouse e controle) | Não começado | 4–6 sem | A2 (medir atraso), P1 ajuda |
| D2. Assistir pelo celular (navegador) | Não começado | 3–4 sem | P1 para fora de casa |
| D3. Linux | Em andamento: AppImage para X11 já sai nas Releases ([README](../README.md#linux)) | 6+ sem | nada, mas é grande |

## Fora do plano (de propósito)

Cargos, moderação e permissões de comunidades grandes, bots, loja, anúncios, canais de texto em servidores. É o jogo do
Discord; o público do Tela P2P é o grupo de amigos. Reavaliar só se aparecer pedido real.

---

# Plano detalhado

Cada item: o objetivo, como fazer (com os arquivos do projeto), como testar, riscos e quando está pronto.

## A1. Chat e senha criptografados

**Objetivo:** ninguém na mesma rede (Radmin, Wi-Fi, e no futuro a internet) consegue ler o chat, a senha ou a sinalização.
O vídeo e a voz já vão criptografados pelo WebRTC; o que falta é a conexão com o servidor da sala (`ws://`, texto puro).

**Como hoje:** `renderer/sala.js` manda o `hello` com `password` em texto; `signaling.js` compara `msg.password !== password`.

**Como fazer:**
1. **Troca de chaves ao conectar.** O servidor (`signaling.js`, Node `crypto`) manda `{ type: 'key', pub }` (X25519 ou
   ECDH P-256) assim que o socket abre. O app (`renderer/sala.js`, WebCrypto) responde com a própria chave pública. Os
   dois derivam uma chave AES-256-GCM com HKDF.
2. **A senha entra na derivação.** `HKDF(segredo_ECDH, sal = id da sessão, info = PBKDF2(senha))`. Quem não sabe a senha
   não consegue ficar "no meio" da conexão; sem senha, a proteção é contra quem só escuta a rede (o que já resolve o caso
   comum).
3. **Senha vira prova, não texto.** Com a chave derivada, o `hello` vai criptografado; se a senha estiver errada, a
   mensagem nem abre, e o servidor responde "senha errada". A senha nunca sai do PC.
4. **Todo o resto vai dentro de envelopes** `{ iv, data }` (AES-GCM com contador no IV). Um só lugar para cifrar e decifrar:
   `send()` em `renderer/util.js` e `send()`/`broadcast()` em `signaling.js`.
5. **Compatibilidade:** o servidor anuncia `features: ['cripto']`. App novo em sala de host antigo: mostra "Conexão sem
   criptografia (o host está numa versão antiga)" e segue. App antigo em host novo: o host aceita por uma versão, depois
   recusa com "atualize".
6. **Troca de host:** o novo host gera a própria chave; quem volta refaz a troca (o `rejoin` já passa por `connectRoom`).

**Como testar:** e2e novo `tests/e2e/cripto.js`: pelo DevTools (`Network.webSocketFrameReceived/Sent`), nenhum quadro
contém o texto de uma mensagem de chat nem a senha; senha errada recusa; troca de host continua funcionando; host antigo
(simulado sem `cripto`) mostra o aviso. Teste de unidade da derivação no Node.

**Riscos:** mensagens grandes (pedaços de arquivo, 48 KB) custam CPU para cifrar; medir no teste do chat (5 MB hoje leva
0,2 s). **Pronto quando:** nenhum texto legível no tráfego da sala e todos os testes antigos passam.

## A2. Atraso da tela medido e à vista

**Objetivo:** mostrar "Atraso da tela: ~X ms" nas Estatísticas (aba Transmissão) e ter o número para comparar com os
2–3 s do Discord.

**Como fazer:**
1. **Modo por pessoa (WebRTC):** somar o que o `getStats()` já dá: codificação no PC de quem transmite
   (`totalEncodeTime / framesEncoded`, mandado pela sala), rede (`currentRoundTripTime / 2`), espera no buffer
   (`jitterBufferDelay / jitterBufferEmittedCount`) e decodificação (`totalDecodeTime / framesDecoded`), mais 1 quadro de
   exibição.
2. **Modo "uma vez só" (`encode-once.js`):** cada pedaço de vídeo já passa pelo DataChannel; acrescentar o horário da
   captura. Sincronizar relógios com 5 "pings" pelo mesmo canal (estilo NTP: menor ida e volta ganha). Atraso =
   hora em que o quadro aparece (`requestVideoFrameCallback`) − hora da captura + diferença de relógio.
3. Mostrar em `renderer/estatisticas.js` (aba Transmissão, por pessoa) com a média dos últimos 5 s.

**Como testar:** e2e que transmite um relógio desenhado no canvas e compara, do outro lado, o horário desenhado com o
horário local (mesmo PC, então sem diferença de relógio): o número mostrado tem que ficar a ±30 ms do medido.

**Pronto quando:** o número aparece nos dois modos e bate com a medição do teste.

## A3. Peso no PC à vista + modo jogo

**Objetivo:** mostrar quanto o Tela P2P gasta (processador e memória) e gastar menos durante o jogo, antes que o
"Game Mode" do Discord vire argumento.

**Como fazer:**
1. `app.getAppMetrics()` no processo principal (`main/`) → nova linha nas Estatísticas: "Tela P2P: X% do processador,
   Y MB".
2. **Modo jogo automático:** quando um app em tela cheia está na frente (a mesma checagem do `tests/e2e/ajuda.js`,
   `fullscreenApps`, movida para `main/`), o app tira animações, para o medidor da voz no painel e reduz o intervalo dos
   timers de interface. As telas escondidas já não baixam vídeo.
3. Medir antes e depois num roteiro fixo (sala com 3 pessoas, 1 transmitindo, 10 min) e anotar em `docs/`.

**Pronto quando:** existe uma medição publicada e o modo jogo reduz o uso medido.

## P1. Entrar pela internet sem VPN

**Objetivo:** "Convidar" gera um código ou link; o amigo cola e entra, sem Radmin, sem abrir porta no roteador.

**Por que é difícil:** duas coisas precisam atravessar a internet. (a) A **sinalização**: o amigo precisa chegar ao
servidor da sala, que roda no PC do host, atrás do roteador. (b) A **mídia**: o WebRTC precisa de um caminho entre os
PCs. Hoje o `RTC_CONFIG` (`renderer/estado.js`) e o `voice.js` usam `iceServers: []`, então só funcionam endereços da
VPN ou da rede local.

**Fase 1 (1 semana): STUN e UPnP.**
- Acrescentar STUN público (`stun:stun.l.google.com:19302` e um segundo de reserva) em `RTC_CONFIG` e no `makePeer` do
  `voice.js`. Com isso a mídia atravessa a maioria dos roteadores de casa.
- No host, pedir ao roteador para abrir a porta da sala por UPnP/NAT-PMP (módulo pequeno em `main/`, sem dependência
  pesada) e descobrir o IP público. "Convidar" passa a copiar o endereço público quando der certo.
- Resolve casas com roteador comum; **não resolve CGNAT** (comum em fibra e 4G no Brasil). Por isso a fase 2.

**Fase 2 (2–3 semanas): código de convite sem servidor nosso.** *Deixada de lado em 03/10/2026: o caminho é o modo Internet
(VPS + TURN) com as salas dos amigos da Razze. O protótipo (PR #17) entrou casa ↔ 4G em 7,7 s e foi removido; está no histórico do Git.*
- Usar o **Hyperswarm** (DHT pública da Holepunch, com furo de NAT por UDP e canal criptografado Noise). O host entra num
  "tópico" = hash do código de convite; o convidado entra no mesmo tópico e os dois se acham, sem servidor do projeto.
- **Túnel da sinalização:** no PC do convidado, `main/` abre uma porta local (`127.0.0.1:porta`) e liga cada conexão
  nela ao canal do Hyperswarm, que no host termina no servidor da sala. O renderer continua conectando em
  `ws://127.0.0.1:...` e **quase nada muda no app**; a criptografia do A1 continua valendo por cima.
- **Código de convite:** 16 caracteres fáceis de ditar (≥ 80 bits), válido enquanto a sala existir; o botão "Convidar"
  copia um link `telap2p://entrar/<código>` (registrar o protocolo no Windows) e o código puro.
- A mídia continua pelo WebRTC com STUN; quando o Hyperswarm consegue furar o NAT, o STUN quase sempre também consegue.

**Fase 3 (1–2 semanas): reserva para os casos impossíveis.**
- Campo opcional "servidor de retransmissão (TURN)" nas Configurações gerais, ao lado do NetBird: quem quiser aponta para
  um `coturn` (o Cristian já tem um VPS). Sem configurar, o app avisa "não deu para conectar direto com Fulano" com a
  sugestão.
- Nas Estatísticas, mostrar o caminho de cada conexão: "direto", "pela VPN" ou "retransmitido".

**Como testar:** unidade do túnel (dois processos Node, um fingindo host); e2e com dois apps usando o túnel em
`127.0.0.1`; teste manual em matriz: casa↔casa, casa↔4G (CGNAT), 4G↔4G, com e sem TURN. Registrar em
`docs/roteiro-de-teste.md`.

**Riscos:** o Hyperswarm é dependência nativa (UDP) no Electron: validar empacotamento no `.exe` e na atualização pela
sala antes de construir em cima. A DHT pública é de terceiros (Holepunch): ter o TURN como plano B. **Pronto quando:** dois
amigos em redes diferentes, sem Radmin, entram pelo código e assistem a uma transmissão.

## P2. Histórico e "desde a sua última visita"

**Objetivo:** o chat não some quando a sala fecha, e quem volta vê o que perdeu. O Discord ganha fácil aqui hoje.

**Como fazer:**
1. **No host:** `signaling.js` salva o `chatLog` por id de sessão em `userData/salas/<id>.json` (últimas 500), carrega
   quando a mesma sessão reabre. O id de sessão já sobrevive à troca de host (vai no `seed`).
2. **Em cada um:** `renderer/chat.js` guarda uma cópia local por sessão (IndexedDB, não `localStorage`: tamanho) e manda
   `lastSeen` no `hello`; o `welcome` traz só o que falta, e o divisor vira "N mensagens desde a sua última visita".
3. **Arquivos continuam disponíveis** mesmo com quem mandou fora: quem baixou guarda (até um limite, ex.: 500 MB) e
   oferece pelo hash SHA-256, o mesmo esquema das fotos de perfil (`renderer/fotos.js`). Quem pede aceita de qualquer
   um que tenha o arquivo e confere o hash.
4. Configuração "Guardar o histórico no PC" (ligada por padrão) e "Apagar histórico desta sala".

**Como testar:** e2e: sala fecha e reabre com o mesmo id → histórico volta; Bia sai, Ana manda 3 mensagens, Bia volta →
divisor "3 mensagens desde a sua última visita"; arquivo baixado pela Carla continua baixável com a Ana fora.

**Pronto quando:** fechar e abrir o app não apaga a conversa, e arquivo não depende só de quem mandou.

## P3. Espectadores repassando o vídeo

**Objetivo:** 50+ pessoas assistindo sem estourar o upload de quem transmite (hoje o limite da sala é 50,
`MAX_MEMBERS` em `sala-protocolo.js`). É uma das camadas do [B0](spec/briefing-50.md).

**Por que o "uma vez só" ajuda:** nesse modo (`encode-once.js`) o vídeo já vai **codificado** pelo DataChannel. Quem
recebe pode repassar os mesmos pedaços para outros **sem codificar de novo**: o custo é só upload.

**Como fazer:**
1. Cada app mede o próprio upload (já existe o medidor de rede nas Estatísticas) e anuncia pela sala: "posso repassar
   para até N".
2. Quem transmite monta uma árvore: atende direto até 3–4 espectadores e manda os outros se pendurarem em quem tem folga
   (mensagem `{ side: 'viewer', relay: <id> }`). Cada repassador abre um DataChannel com os filhos, igual ao que o
   transmissor já faz.
3. **Quadro-chave ao entrar:** o filho novo pede um quadro-chave; o repassador encaminha o pedido para cima (o
   `encode-once.js` já sabe pedir).
4. **Queda:** se um repassador sai, os filhos voltam para o transmissor na hora e são redistribuídos.
5. Subir `MAX_MEMBERS` para 25 depois que os testes passarem.
6. No modo por pessoa (WebRTC comum) não há repasse: o app sugere "uma vez só" quando a sala passa de 5 espectadores.

**Como testar:** e2e com 6 apps e o upload do transmissor limitado (dá para limitar pelo DevTools,
`Network.emulateNetworkConditions`): todos recebem vídeo, o transmissor manda para no máximo 4; derrubar um repassador e
ver os filhos voltarem em < 2 s.

**Riscos:** cada salto soma atraso de rede (medir com o A2). **Pronto quando:** 10 espectadores com o upload de quem
transmite em ~4× a taxa do vídeo, não 10×.

## P4. Clipe dos últimos 30 s

**Objetivo:** "Salvar clipe" (botão na tela e atalho Ctrl+Shift+C) grava os últimos 30 s de quem você está assistindo.

**Como fazer:**
1. **Modo "uma vez só":** guardar num buffer circular os pedaços H.264 que chegam (a partir do último quadro-chave com
   pelo menos 30 s) e, ao salvar, montar um MP4 com um muxer pequeno (ex.: `mp4-muxer`, sem dependência nativa). Sem
   recodificar: rápido e sem perda.
2. **Modo por pessoa:** dois `MediaRecorder` se revezando a cada 15 s sobre a faixa recebida; ao salvar, junta o anterior e
   o atual (WebM).
3. Som: incluir a faixa de áudio da transmissão; a voz da sala fica de fora (opção futura).
4. Ao salvar, oferecer "Mandar no chat" (passa pela limpeza de metadados do `renderer/metadados.js`).

**Como testar:** e2e: assistir 40 s de um contador desenhado, salvar, abrir o arquivo num `<video>` e conferir duração
≈ 30 s e o último número.

**Pronto quando:** o clipe abre em qualquer player e tem os últimos 30 s.

## D1. Jogar junto (quem assiste controla o jogo)

**Objetivo:** transformar "assistir" em "jogar junto" em jogos cooperativos locais: quem assiste usa teclado, mouse ou
controle no jogo de quem transmite. Nem Discord nem TeamSpeak têm.

**Como fazer:**
1. **Permissão explícita:** quem assiste clica em "Pedir controle"; quem transmite vê "Bia quer controlar: Permitir só o
   controle / teclado e mouse / Negar". Enquanto durar: faixa bem visível "Bia está controlando" e **atalho de pânico**
   (Ctrl+Shift+Esc não serve; ex.: Ctrl+Alt+Q) que corta na hora. Nunca liga sozinho.
2. **Do lado de quem assiste** (`renderer/assistir.js`): no quadro da transmissão, capturar teclado, mouse (com pointer lock)
   e a Gamepad API (a 120 Hz) e mandar por um DataChannel próprio (`input`, ordenado para teclas).
3. **Do lado de quem transmite:** novo ajudante nativo `native/entrada.cpp` → `bin/entrada.exe`, no mesmo esquema do
   `teclas.exe` (conversa por stdin/stdout com `main/nativos.js`). Teclado e mouse com `SendInput`, com as coordenadas
   convertidas para o retângulo da janela transmitida.
4. **Controle virtual (fase 2):** um controle Xbox virtual precisa de driver (ViGEmBus, projeto arquivado, ou outro); deixar
   para depois de validar teclado e mouse, e só com instalação opcional.
5. Só funciona transmitindo uma **janela** (não a tela inteira) na primeira versão: limita o que o outro alcança.

**Como testar:** e2e com uma janela de teste que registra teclas e cliques: a Bia manda, a Ana recebe na janela certa;
sem permissão nada chega; o atalho de pânico corta; ao parar de transmitir, corta. Medir o atraso do comando com o A2.

**Riscos:** **antitrapaça** (jogos com anticheat de kernel podem ignorar ou punir entrada injetada; avisar na tela e
listar jogos testados); segurança (a permissão e o pânico têm que ser à prova de erro); atraso de ida e volta.
**Pronto quando:** dois amigos jogam um cooperativo local (ex.: jogos de sofá no PC) um na tela do outro.

## D2. Assistir pelo celular

**Objetivo:** abrir um link no navegador do celular e assistir, sem instalar nada.

**Como fazer:**
1. O host serve uma página de espectador (HTML e JS estáticos, porta da sala + 1) só com o necessário: lista de quem
   transmite, vídeo e volume.
2. O celular entra como um membro "só assiste" (sem voz na primeira versão) e recebe pelo modo por pessoa (WebRTC comum,
   H.264, que todo celular decodifica).
3. Fora de casa, usa o caminho do P1 (código de convite → túnel; no celular, a fase 1 com IP público/UPnP ou o TURN).
4. Mostrar um QR code no "Convidar" para abrir no celular.

**Riscos:** o túnel do Hyperswarm não roda no navegador do celular; fora de casa, o celular depende de UPnP ou TURN.

## D3. Linux

**Objetivo:** amigos no Linux (ou Steam Deck) usam o app.

**O que é só Windows hoje:** `bin/audiocap.exe` (som do PC por processo), `bin/videocap.exe` (captura + NVENC),
`bin/teclas.exe` (apertar para falar), a exclusão da janela da captura e o empacotamento.

**Como fazer (em ordem):** empacotar para Linux (AppImage) com as partes nativas desligadas; som do PC pelo PipeWire;
apertar para falar pelo portal de atalhos globais; "uma vez só" pelo WebCodecs (já existe no `encode-once.js`) em vez do
`videocap.exe`. O macOS fica fora (captura de som do sistema é bem mais restrita).

---

## Ideia: Red Room (sala de briefing do tema Top Gun)

**Anotação, ainda não priorizada (04/10/2026).** Para quem joga simulador (DCS e parecidos) junto: uma sala vira a
"Red Room" na hora de planejar e voar uma missão. O tema Top Gun troca o fósforo verde pelo vermelho (a luz de cabine
à noite, que não cega a visão noturna) e o app ganha ferramentas de briefing.

**Features a pensar:**
- **Modo missão:** o líder liga "Briefing" na sala; para todos, o tema fica vermelho e a barra de título mostra a
  missão, o horário Zulu e o tempo até o "push" (decolagem combinada), com contagem regressiva.
- **Quadro de briefing:** objetivo, waypoints, frequências de rádio, bingo de combustível e regras, num cartão fixo
  que todos veem e o líder edita (fica no histórico da sala).
- **Callsigns e flights:** cada pessoa ganha um indicativo ("Viper 1-1", "Viper 1-2") e as subsalas viram as flights;
  o radar da voz mostra os contatos com o indicativo.
- **Check de prontidão:** cada um marca "pronto" ("ready to copy"); o líder vê quem falta e o app toca a chamada de
  rádio quando todos estão prontos.
- **Silêncio de rádio:** durante a missão, só o líder (ou a flight) fala na voz geral; os outros ficam na subsala da
  flight, com "Fence in" e "Fence out" ao entrar e sair da área.
- **Tela do líder fixada:** o mapa ou o kneeboard do líder fixo no palco de todos durante o briefing.
- **Debriefing:** os clipes salvos durante a missão (P4) agrupados por pessoa, com a hora Zulu, para rever depois.
- **Sons:** chamadas de rádio próprias da missão ("Fence in", "Bingo", "Winchester", "Mission complete, R T B").

**Por que esperar:** depende de sinalização nova na sala (estado de missão, quadro e prontidão vêm de outros PCs:
validar como em `sala-protocolo.js`) e de ver se o tema Top Gun pega com o grupo.

---

## Riscos e dependências

| Risco | Onde | Plano |
|---|---|---|
| Hyperswarm (UDP nativo) não empacota bem no Electron ou na atualização pela sala | P1 | Validar com um protótipo de 2 dias antes de começar a fase 2; plano B: TURN + UPnP |
| DHT pública de terceiros cai ou muda | P1 | TURN opcional (fase 3); o código de convite pode, no futuro, apontar para um ponto de encontro próprio |
| Antitrapaça bloquear ou punir entrada injetada | D1 | Lista de jogos testados, aviso claro, só janela, desligado por padrão |
| Uma pessoa só conhece cada parte do código | todos | Cada item termina com teste de ponta a ponta e uma linha em `docs/desenvolvimento.md` |
| O Discord liberar 1080p60 de graça | posicionamento | Ter A1, P1 e D1 prontos: a diferença passa a ser privacidade, sem servidor e jogar junto |

## Como saber se deu certo (sem coletar dados de ninguém)

- **Entrar sem VPN:** % de convites que viram entrada, contado só no PC de quem convidou e mostrado a ele; e o roteiro de
  teste com amigos em redes diferentes.
- **Atraso:** número do A2 nas transmissões do grupo (meta: < 300 ms na mesma cidade).
- **Espectadores:** maior sala que funcionou sem travar.
- **Baixadas:** downloads das Releases no GitHub, versão a versão.

## Próximos passos

1. Começar pelo **A1** (1–1,5 semana), que é pré-requisito do P1.
2. Em paralelo, um **protótipo de 2 dias do Hyperswarm dentro do Electron** para tirar o maior risco do P1 cedo.
3. Revisar este documento no fim de outubro.

## Em planejamento

- **Fluxo, conta e perfil** (auditoria feita; primeira entrada enxuta, convite por link, esqueci a senha, bio, foto e fundo do perfil, atividade opcional, Google): `docs/auditoria-fluxo.md` e `docs/spec/primeira-entrada-e-perfil.md`.
- **Convite de amigo por link** (plano aguardando aprovação): `docs/spec/convite-por-link.md`.
