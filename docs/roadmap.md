# Roadmap

*Reorganizado em 07/10/2026 (versão 1.18.3). Revisar todo mês; a concorrência muda rápido (TeamSpeak 6 ainda em beta,
Discord mudando preço e verificação de idade). Os códigos dos itens (A, P, D) vêm da análise de concorrência de 28/09:
**A**gora, **P**róximo e **D**epois; o B0 é a meta que puxa tudo. Os números não indicam ordem: a ordem está em
"Ordem de trabalho".*

## Premissas
- **Equipe:** 3 pessoas em meio período (Mateus, Cristian e Andrick) + agente de código. Estimativas em semanas de uma
  pessoa, aproximadas; o que está em "Depois" é direção, não compromisso.
- **Cadência:** versões pequenas e frequentes (o app se atualiza pela sala), cada item atrás de testes de ponta a ponta.
- **Divisão do tempo:** ~70% roadmap, ~20% saúde do código e testes, ~10% bugs e pedidos dos amigos.
- **O que vale hoje:** código e senha da sala seguem funcionando sem conta; a **conta é opcional e só pelo Google**, para
  amigos, mensagens e salas deles; a VPS (RazzeAPI + sala por Internet + TURN) é o caminho padrão para quem instala.
  Nada de coleta de dados.

## Estado em 07/10/2026

**Já saiu (1.14 a 1.18.3):**
- **P1 Entrar sem VPN:** modo Internet por VPS com TURN é o padrão desde 03/10/2026. O protótipo Hyperswarm foi abandonado
  (está no histórico do Git).
- **P4 Clipes** dos últimos 30 s, com som, duração escolhida e uma por pessoa.
- **A3 Peso no PC e modo jogo** (`renderer/modo-gamer.js`).
- **Mensagens diretas criptografadas** de ponta a ponta (1.14.0).
- **Conta só pelo Google**, lista de convidados, grupos e **painel de administração** dentro do app (1.18.0). O login por
  senha segue aceito para contas antigas (`legacyPasswordLogin`).
- Amigos por link ou código, perfil com foto e fundo, atividade (jogo e Spotify), salas dos amigos, Ligar e **Abrir minha
  sala** em 1 clique, temas (Renascença, Top Gun, E.V.A, Estelar), app renomeado para **Nebula**, HUB removido.
- VPS atualizada em 05 e 06/10/2026 (passo a passo em [razze-api.md](razze-api.md)); release **1.18.3** publicada.

## Ordem de trabalho

| # | Item | Por quê | Estado |
|---|---|---|---|
| 1 | **Limpeza do Git e do PC** (branches mergeadas, stashes, backups) | Ninguém mais trabalha nelas | Comandos entregues; o humano roda |
| 2 | **Subir o que só existe no PC** (PR de `docs/roteiro-administracao`, a spec nova e este roadmap) | A equipe não vê o que está só local | Pronto para PR |
| 3 | **Conta: excluir pelo painel e mensagem de conta desativada** | Hoje uma conta desativada prende a pessoa: o Google responde "já existe conta", a senha responde "desativada" e não existe excluir | Não começado (mexe em `razze-api/`) |
| 4 | **HTTPS (wss) na VPS**, Caddy na frente da porta 8765 | Destrava o A1 e o D2 | Não começado (precisa de quem tem SSH) |
| 5 | **A1 revisado:** o app passa a usar `wss://` no modo Internet | Chat e senha da sala hoje vão em `ws://` puro | Depende do 4 |
| 6 | **D2 Assistir pelo navegador** (celular, só assistir) | Convidar sem pedir download; porta de entrada do B0 | Spec em [spec/assistir-no-navegador.md](spec/assistir-no-navegador.md) |
| 7 | **A2 Atraso medido** | Dá o número para comparar com o Discord e serve de régua para o B0 e o D1 | Não começado |
| 8 | **P2 Histórico** | O chat não some quando a sala fecha | Não começado |
| 9 | **B0 Briefing 50+** (com P3, espectadores repassando) | Meta maior; ainda vai ser testado | Spec pronta; testes pendentes |
| 10 | **Manutenção:** e2e antigos (9 falhas de 03/10), docs, CI | Saúde do código | Em aberto |

**Futuro (mantido, sem data):**
- Desligar o `legacyPasswordLogin` quando todas as contas tiverem vinculado o Google (`withGoogle` igual às contas ativas
  no painel). Até lá, quem tem conta antiga entra por senha.
- Instalador do Windows e licença do projeto ([spec/licenca.md](spec/licenca.md)).
- D1 Jogar junto e D3 Linux (abaixo): ficam no plano, fora da fila.
- Red Room, constelação de amigos, estrela cadente e enquete (abaixo).

## B0. Briefing para 50+ pessoas

**Prioridade máxima. É a meta que puxa todo o resto.** Uma pessoa passa o briefing de missão do DCS (mapa, kneeboard,
slides) e fala; 50+ assistem, sem Radmin e sem servidor obrigatório (a VPS só como último recurso). Plano, camadas,
números e teste de carga (primeiro forjado com robôs, depois com gente) em [spec/briefing-50.md](spec/briefing-50.md).
Ainda será testado; segue como meta.

## Ideias de tela inicial
- **Constelação = amigos online.** O fundo é o céu estrelado (`--st-sky` em `styles-estelar.css`). Passa a mostrar só os
  amigos adicionados que estão online: cada um é uma estrela com foto e nome; quem está numa sala aparece ligado ao "sol"
  da sala, que se clica para entrar. Sem amigos online, o céu fica vazio, com um convite discreto para "Adicionar amigo".
  A presença vem da RazzeAPI.
- **Estrela cadente:** uma de vez em quando (20–90 s), traço curto e fino nas cores do tema. Respeitar "reduzir movimento"
  e a opção de esconder o céu. Sem animação contínua. A branch `ui/estrela-cadente` já tem uma versão.
- **Enquete de próximos temas:** cartão abaixo de "Criar sala"/"Entrar com código", com opções fixas da versão e 1 voto
  por conta Razze. Sem campo de texto.
- **Ordem visual sugerida:** Criar sala → Salas dos amigos → Entrar com código (secundário) → Enquete → Novidades.

## Razze e WireGuard
- A RazzeAPI faz **contas, amigos, presença, salas dos amigos, mensagens diretas, painel de administração e a VPN
  WireGuard** (`main/razze-*.js`, `razze-api/`). Hoje é a base de conta e amigos: **não remover**.
- O caminho de entrada para quem instala passou a ser o modo Internet (VPS + TURN). O WireGuard só se justifica se ficar
  invisível (sem adaptador e sem administrador); decidir o destino dele depois de uma temporada de uso do modo Internet.

## Fora do plano (de propósito)

Cargos, moderação e permissões de comunidades grandes, bots, loja, anúncios, canais de texto em servidores. É o jogo do
Discord; o público do Tela P2P é o grupo de amigos. Reavaliar só se aparecer pedido real.

---

# Plano detalhado

## A1. Chat e senha da sala sem texto puro (revisado em 07/10/2026)

**Objetivo:** ninguém na mesma rede consegue ler o chat, a senha da sala ou a sinalização. O vídeo e a voz já vão
criptografados pelo WebRTC (DTLS-SRTP) e as mensagens diretas já são de ponta a ponta. O que falta é a conexão com o
servidor da sala: no modo Internet o app fala `ws://2.25.253.140:8765` (texto puro). Nos modos Radmin e rede local
também, mas ali o túnel já é cifrado.

**Mudança de plano:** o desenho original (troca de chaves ECDH dentro do protocolo, em `signaling.js` e
`renderer/sala.js`) é grande e mexe no protocolo da sala. Com o Caddy na VPS, o **TLS resolve o caso da internet**:
`wss://` cifra tudo entre o app e a VPS, sem mexer em `sala-protocolo.js`.

**Como fazer:**
1. Caddy na VPS faz `reverse_proxy` da porta 8765 para um caminho do domínio que a RazzeAPI já usa; no env do servidor,
   `TRUST_PROXY=1`. Documentar em `servidor-internet/README.md` e em `docs/razze-api.md`.
2. O app passa a usar `wss://` como endereço padrão do modo Internet (`INTERNET_URL_PADRAO`, `renderer/conectividade.js`).
   A porta 8765 aberta continua valendo para apps antigos até o fim da transição.
3. Aviso no app quando a conexão for `ws://` fora de VPN: "Conexão sem criptografia".
4. Criptografia por cima do TLS (para nem a VPS ler o chat da sala) fica como evolução, só se a equipe quiser. O desenho
   antigo (ECDH + AES-GCM) está no histórico do Git deste arquivo.

**Como testar:** teste do servidor atrás de proxy (`TRUST_PROXY=1`), e2e do app em `wss://` e conferência pelo DevTools
de que nenhum quadro contém texto legível. **Pronto quando:** o modo Internet padrão só usa `wss://`.

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

## D2. Assistir pelo navegador (celular, só assistir)

Spec completa em [spec/assistir-no-navegador.md](spec/assistir-no-navegador.md). Resumo: página estática na VPS, por
HTTPS, onde o celular entra por código e senha (ou link com passe) e assiste a uma transmissão em WebRTC comum (H.264).
Sem voz, sem chat e sem login na primeira versão. Depende do item 4 (HTTPS na VPS).

## D3. Linux

**Objetivo:** amigos no Linux (ou Steam Deck) usam o app.

**O que é só Windows hoje:** `bin/audiocap.exe` (som do PC por processo), `bin/videocap.exe` (captura + NVENC),
`bin/teclas.exe` (apertar para falar), a exclusão da janela da captura e o empacotamento.

**Como fazer (em ordem):** empacotar para Linux (AppImage) com as partes nativas desligadas; som do PC pelo PipeWire;
apertar para falar pelo portal de atalhos globais; "uma vez só" pelo WebCodecs (já existe no `encode-once.js`) em vez do
`videocap.exe`. O macOS fica fora (captura de som do sistema é bem mais restrita).


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
| Só uma pessoa tem SSH na VPS | A1, D2, painel | Documentar o passo a passo (já está em `razze-api.md`) e dividir o acesso |
| Antitrapaça bloquear ou punir entrada injetada | D1 | Lista de jogos testados, aviso claro, só janela, desligado por padrão |
| O upload de quem transmite limita os espectadores (o navegador não repassa) | D2, B0 | P3 entre apps; no navegador, limite de espectadores por sala |
| Uma pessoa só conhece cada parte do código | todos | Cada item termina com teste de ponta a ponta e uma linha em `docs/desenvolvimento.md` |
| O Discord liberar 1080p60 de graça | posicionamento | A diferença passa a ser privacidade, poucos servidores e jogar junto |

## Como saber se deu certo (sem coletar dados de ninguém)

- **Entrar sem VPN:** % de convites que viram entrada, contado só no PC de quem convidou e mostrado a ele; e o roteiro de
  teste com amigos em redes diferentes.
- **Atraso:** número do A2 nas transmissões do grupo (meta: < 300 ms na mesma cidade).
- **Espectadores:** maior sala que funcionou sem travar.
- **Baixadas:** downloads das Releases no GitHub, versão a versão.


## Em planejamento

- **Fluxo, conta e perfil:** `docs/auditoria-fluxo.md` e `docs/spec/primeira-entrada-e-perfil.md`.
- **Conta só pelo Google e painel de administração:** `docs/spec/conta-so-google-e-admin.md`.
- **Convite de amigo por link:** `docs/spec/convite-por-link.md`.
- **Assistir pelo navegador:** `docs/spec/assistir-no-navegador.md`.
- **Licença do projeto** (tarefa futura; rascunho pronto, falta o ok dos três titulares e preencher nomes e foro): `docs/spec/licenca.md`.
