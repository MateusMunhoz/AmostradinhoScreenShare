# Desenvolvimento

Para quem vai mexer no código, testar ou publicar uma versão.

## Rodar pelo código

Instale o [Node.js](https://nodejs.org) 24 ou mais novo (os testes da RazzeAPI usam o `node:sqlite`) e, na pasta do projeto:

```
npm install
npm start
```

Para gerar um `.exe` portátil sem publicar: `npm run dist`. O arquivo aparece em `dist\Tela P2P.exe`, sempre com esse nome, e cada geração troca o anterior.

## Como o app funciona

- **Sala:** quem cria a sala roda um servidor pequeno de sinalização (`signaling.js`, WebSocket) dentro do próprio app. Ele só apresenta as pessoas umas às outras e guarda as últimas 100 mensagens do chat.
- **Vídeo, áudio, voz e arquivos:** vão direto de PC para PC, por WebRTC, pela rede da Radmin. Não passam por servidor.
- **Troca de host:** cada um sabe a ordem de chegada e os endereços dos outros. Se o servidor some, o mais antigo abre outro na mesma porta, e todo mundo volta com o mesmo número. Por isso as conexões diretas (quem assiste quem) não caem.
- **Rede usada pelo app:** em Configurações, escolha Internet (servidor, o padrão), Radmin/LAN ou VPN Razze; quem já usava o app sem ter escolhido continua na Radmin. A RazzeAPI independente gerencia contas, amizades, redes, convites e chaves públicas; o executável oficial `bin/selfvpn/wireguard.exe` cria um serviço de túnel por rede no Windows. Os peers são descobertos pelo API e por STUN UDP. O primeiro MVP usa conexão direta; não há relay para CGNAT restritivo. A descoberta automática de salas continua apenas em LAN/Radmin.
- **Arquivos principais:**

  | Arquivo | O que faz |
  |---------|-----------|
  | `boot.js` | Início do app. Confere a assinatura das atualizações e escolhe qual versão rodar. Só muda com um `.exe` novo. |
  | `main.js` | Processo principal: opções do Chromium, a janela do app, as janelas que a página abre e todo o IPC (inclui `capture-region`: as cores, em 32 x 18, de um pedaço da janela, para a luz ambiente da música do YouTube, que a página não consegue ler). |
  | `main/` | O resto do processo principal (veja abaixo). |
  | `preload.js` | A ponte segura entre a página e o processo principal (`window.api`). |
  | `renderer/` | A interface e a lógica da sala, em vários arquivos (veja abaixo). |
  | `encode-once.js` | O modo "uma vez só" (NVENC direto e WebCodecs). |
  | `voice.js` | A voz: conexões WebRTC de áudio entre as pessoas (feito pelo Cristian). |
  | `signaling.js` | O servidor da sala. |
  | `main/razze-service.js` | Sessão da RazzeAPI e persistência protegida do token. |
  | `main/razze-wireguard.js` | Chaves locais, STUN, configuração e serviço WireGuard no Windows. |
  | `razze-api/server.js` | API central HTTP/SQLite e serviço STUN UDP. |
  | `publicar.js` | Assina, gera o `.exe` e publica. |
  | `native/` | Código dos ajudantes nativos em C++. |
  | `bin/` | Os ajudantes compilados: `audiocap.exe` (som), `videocap.exe` (captura e NVENC), `teclas.exe` (apertar para falar). |
  | `vendor/` | Arquivos de terceiros usados pelo app: a IA de ruído (RNNoise). |

### A página (`renderer/`)

As preferências gerais ficam em `renderer/preferencias-modelo.js` (validação, paleta, catálogo e reprodutor de sons) e `renderer/configuracoes.js` (interface e armazenamento em `localStorage`, chave `appPreferences.v1`). O modelo carrega antes de `tema.js`; o controlador, logo depois. `main/google-login.js` (login com Google pelo navegador, OAuth com PKCE e retorno em `127.0.0.1`), `main/atividade.js` (lê o jogo aberto e a música do Spotify por `tasklist`, só o que a página pediu; tem a lista de jogos), `renderer/recorte.js` (editor de recorte da foto e do fundo; a original reduzida e o enquadramento ficam em `localStorage`, `fotoOrigem` e `fundoOrigem`; `inicio.js` liga com `setupRecorte`), `renderer/conta.js` (trocar senha, esqueci a senha e a frase do perfil; `inicio.js` liga com `setupConta`), `renderer/primeira-entrada.js` (primeira entrada em 3 telas e os amigos do Início; só declara, `inicio.js` liga com `setupPrimeiraEntrada`), `renderer/navegacao.js`, carregado antes de `inicio.js`, controla a barrinha da direita (`#workspaceNav`: perfil, pessoas, Chat, Voz, Transmissão, música, Início ou Voltar para a sala, Sair e a engrenagem) e os painéis simultâneos, persistindo a seleção da sala em `workspaceViews.v1`. No menu inicial, com a sala aberta, a barrinha e os painéis de chat e voz continuam à vista. Os arquivos de áudio ficam em `assets/audio/` e são incluídos tanto no executável quanto no pacote de atualização de `publicar.js`. As chamadas de rádio do tema Top Gun (`assets/audio/radio-*.wav`) são geradas por `node assets/temas/gerar-radio.js` (só Windows: vozes em inglês do SAPI e do OneCore só a voz, sem chiado; a voz masculina em inglês vem com `Add-WindowsCapability -Online -Name "Language.TextToSpeech~~~en-US~0.0.1.0"`, como administrador). Um som pode ter várias falas (`sounds[].files`): o `SoundPlayer` sorteia uma sem repetir a última, e `publicar.js` empacota todas. Os blueprints do fundo do Top Gun estão em `assets/temas/topgun-bp-*.webp` (origem em `OBRAS.md`); um tema pode trazer sons próprios em `skins[].sounds`, aplicados por `applyTheme` e devolvidos por `chooseSkin` ao sair dele.

`npm run test:settings` verifica a interface em janelas invisíveis, os oito MP3, os eventos sonoros, as cores na janela flutuante, as oito combinações dos painéis da sala, a posição da barra e a persistência entre dois processos do Electron. Usa um perfil temporário isolado. `npm test` inclui os testes de validação, volumes, reprodução e transições de participação na voz, além dos testes existentes.

São `<script>` comuns (não módulos), carregados pelo `index.html` nesta ordem. Todos dividem o mesmo
escopo global: uma função ou variável de um arquivo é vista pelos outros pelo nome. Os testes usam
isso (chamam `watch`, `state`, `speaking`... direto na página).

| Ordem | Arquivo | O que tem |
|-------|---------|-----------|
| 1 | `encode-once.js` | Modo "uma vez só" (fica na raiz) |
| 2 | `voice.js` | Classe `VoiceChat` (fica na raiz) |
| 3 | `util.js` | `$`, telas, aviso, preferências, `send`, ícones, formatação, `closeOnBackdrop` |
| 4 | `lista.js` | Listas de opções (`<select>`) desenhadas no tema do app; o `<select>` continua sendo a fonte da verdade |
| 5 | `estado.js` | `state`, `update` e as qualidades de transmissão |
| 6 | `rtc.js` | Ajustes do WebRTC: Opus, H.264 primeiro, codec, bitrate |
| 7 | `preferencias-modelo.js` | Modelo das preferências, sem interface: validação (`normalize`), paleta, catálogo de sons e fontes (usado também pelos testes) |
| 8 | `tema.js` | Cores das janelas montadas por código, cor de cada pessoa, barrinhas de quem fala |
| 9 | `fotos.js` | Foto de perfil sem servidor: a sua, pedir a dos outros pelo hash, pintar as bolinhas |
| 10 | `fundo-perfil.js` | Fundo do perfil (imagem ou GIF até 1 MB): o seu, e o dos outros por mensagens diretas em pedaços, conferido pelo hash ([spec](spec/fundo-do-perfil.md)) |
| 11 | `icone-app.js` | O ícone do app desenhado num canvas: a logo (`LOGO_STARS`, `LOGO_DOTS`), nas cores dela; os temas E.V.A e Arasaka têm o próprio (também usado pelo `gerar-icone.js`) |
| 12 | `configuracoes.js` | Configurações: a janela única (grupos à esquerda, abas em cima: `showSettingsTab`, `settingsOpenOn`), interface e preferências deste PC (`appPreferences.v1`) |
| 13 | `modo-gamer.js` | Modo gamer (o controle na barrinha): prioridade normal, vidro opaco, sem animações, sem céu e sem luz ambiente, sem mudar as escolhas salvas |
| 14 | `qr.js` | Gerador de QR code próprio (modo byte, correção M, versões 1 a 10), em SVG |
| 15 | `celular-modelo.js` | Configurações no celular, sem interface: o que vai no arquivo, a validação ao trazer e a cifra (PBKDF2 + AES-GCM) |
| 16 | `celular.js` | Configurações › Celular: guardar e trazer, com QR e senha ([spec](spec/config-no-celular.md)) |
| 17 | `conectividade.js` | Rede: Radmin ou rede local, VPN Razze (WireGuard) ou modo Internet (VPS) |
| 18 | `sala.js` | Criar, entrar e sair, mensagens do servidor, sinalização, troca de host |
| 19 | `voz.js` | Volume por pessoa, mixer, quem fala, atenuação, barra da voz, cartão da pessoa (cria o `voice`) |
| 20 | `porta-microfone.js` | Sensibilidade sem Web Audio (`MicGate`): ruído de fundo pelo percentil 10 dos últimos ~4 s, barulho constante, calibração, histerese, chance de voz (VAD) do RNNoise. Também roda em `require` nos testes |
| — | `rnnoise-vad-worklet.js` | Roda no AudioWorklet antes de `vendor/noise/rnnoiseWorklet.js`: embrulha o wasm para pegar a chance de voz e registra o processador `…/rnnoise#vad`, que a manda pelo `port` |
| 21 | `microfone.js` | Microfone escolhido, RNNoise, eco, sensibilidade, ouvir a própria voz, apertar para falar, grupo "Voz e atalhos" das Configurações |
| 22 | `subsalas.js` | Subsalas de voz: criar e apagar (Subsala_1, Subsala_2…), entrar numa subsala e a lista por canal no painel de voz |
| 23 | `membros.js` | Painel da sala: endereço e lista de pessoas |
| 24 | `clipe-mp4.js`, `clipes.js` | Clipe dos últimos segundos com som: buffer dos pedaços H.264 (do modo "uma vez só", ou recodificados no "uma por pessoa"), som em AAC/Opus, MP4 com o `mp4-muxer` de `vendor/`, duração, atalho, tesoura e aviso ([spec](spec/clipes.md)) |
| 25 | `assistir.js` | Quadros de vídeo, ver a própria transmissão, destaque, tela cheia |
| 26 | `palco.js` | Como as telas assistidas se arrumam no palco |
| 27 | `pip.js` | Janelas flutuantes |
| 28 | `overlay.js` | Chat por cima do jogo |
| 29 | `metadados.js` | Tira localização, autor, datas e outros metadados dos arquivos (fotos, vídeos, PDF, Office) antes de irem para o chat |
| 30 | `chat.js` | Mensagens, arquivos, não lidas |
| 31 | `estatisticas.js` | Desempenho, aba Transmissão, codificador em uso |
| 32 | `novidades.js`, `atualizacao.js` | `NOVIDADES` (gerada pelo `publicar.js` com os commits); atualização pela sala, pelo GitHub, o aviso e o cartão Novidades do Início |
| 33 | `sessoes.js`, `salas-amigos.js`, `chamada.js` | Sessões abertas na rede (a lista da tela inicial); no modo Internet, as salas dos amigos do Razze, com o passe de convite, e o convite para a sala pelas mensagens diretas ([spec](spec/salas-dos-amigos.md)); ligar para um amigo pela mensagem privada e a senha da sala no Painel: ver, copiar, mudar ([spec](spec/chamada.md)) |
| 34 | `transmitir.js` | Escolher a fonte, som, iniciar, trocar e parar, quem assiste, transmissão aberta ou só para o seu canal |
| 35 | `comando-voz-regras.js`, `comando-voz-acoes.js`, `comando-voz.js` | Comando de voz (recurso extra): as regras que transformam o texto num comando e a lista única de ações para os pedidos livres (os dois sem DOM, testados no `node:test`); gravar enquanto a tecla está apertada, executar e a aba Recursos extras ([spec](spec/comando-de-voz.md)) |
| 36 | `mapa-conexoes.js` | O Mapa de conexões, na aba Rede do HUB: grafo em pé, atualiza a cada 5 s só com a aba à vista |
| 37 | `hub.js` | HUB: a barra fininha da esquerda, com as abas Salas (salas abertas, a atual e o menu inicial) , Amigos (adicionar, filtrar, convidar, pedidos) e Rede (a conta primeiro, depois conexão, servidores, redes Razze e o Mapa de conexões) |
| 38 | `mensagens.js` | Mensagens diretas entre amigos: aba Mensagens do HUB, barra de conversas embaixo, busca na RazzeAPI a cada 4 s e histórico local |
| 39 | `navegacao.js` | Barrinha da direita e painéis simultâneos da sala (`workspaceViews.v1`), painel de voz com os canais |
| 40 | `inicio.js` | Tela inicial e a partida: liga os botões e listeners, carrega as preferências |

**A regra que evita erro na carga:** só o `inicio.js` roda código quando a página abre (listeners,
`onclick`, preferências). Os outros só declaram funções e variáveis. Um arquivo que rodasse algo na
carga usando uma função de um arquivo que vem depois quebraria com "não definido". A exceção é o
`voz.js`, que cria o `voice` na carga: por isso ele vem depois do `util.js` (que tem o `send`).

Arquivo novo na página: entra no `index.html` (na posição certa), em `PACK_FILES` e no `build.files`
(veja [Contribuir](#contribuir-pr-e-merge); o CI confere isso em todo PR). Para conferir rápido que nada quebrou na carga:
`npx electron tests/e2e/carga.cjs` (uns 5 segundos, sem abrir janelas).

### O processo principal (`main/`)

| Arquivo | O que tem |
|---------|-----------|
| `contexto.js` | O que as janelas dividem (`janelas.main`, `janelas.chat`, modo de ajuste, modo de escrever) e o `sendMain` |
| `nativos.js` | Prioridade, medidas das Estatísticas, NVENC direto (`videocap.exe`), som sem o próprio app (`audiocap.exe`) |
| `janela-flutuante.js` | Vagas, fila, transparência e modo de ajuste das janelas flutuantes |
| `chat-jogo.js` | A janela do chat por cima do jogo e o modo de escrever (Ctrl+Enter) |
| `atalhos.js` | Atalhos globais e o apertar para falar (`teclas.exe`) |
| `comando-voz.js` | Comando de voz: baixa o whisper.cpp e o modelo para `%APPDATA%\Tela P2P\comando-voz` só para quem liga, confere cada arquivo por SHA-256 fixo no código e transcreve o WAV que chega pela memória (stdin), com prioridade baixa. A tecla de segurar fica em `atalhos.js` (outro `teclas.exe`). Só módulos do Node ([spec](spec/comando-de-voz.md)) |
| `comando-voz-ia.js` | Pedidos livres do comando de voz: manda o texto e o estado da sala com a lista de ações para a nuvem (`@anthropic-ai/sdk`, chave cifrada com o safeStorage, nunca volta para a página) ou para um servidor local compatível com a API da OpenAI (só `localhost`). Só módulos do Node ([spec](spec/comando-de-voz.md)) |
| `clipes.js` | Grava os clipes em `Vídeos\Tela P2P\Clipes` (nome limpo, até 300 MB) e mostra na pasta só os que ele salvou. Só módulos do Node ([spec](spec/clipes.md)) |
| `bandeja.js` | Ícone na bandeja e o menu dele; o X da janela esconde nela (sair de verdade marca `setQuitting`). Mute e ensurdecer mandam as mesmas mensagens dos atalhos; "Procurar atualização" manda `tray-update` |
| `sessoes.js` | Anúncio e busca das sessões abertas (UDP na rede da Radmin) |
| `mensagens.js` | Histórico local das mensagens diretas: um arquivo por amigo em `%APPDATA%\Tela P2P\mensagens\<conta>`, cifrado com o safeStorage |
| `mensagens-cripto.js` | Mensagens diretas criptografadas de ponta a ponta (X25519 + AES-256-GCM): a chave privada só aqui; cifra no envio e decifra na busca, entre o IPC e a RazzeAPI ([spec](spec/mensagens-criptografadas.md)) |
| `celular.js` | Configurações no celular: servidor HTTP na rede local só enquanto o QR está aberto (chave de uso único, 5 min, até 4 MB); serve a página do celular. Só módulos do Node (testado sem o Electron) |

`janela-flutuante.js`, `chat-jogo.js` e `atalhos.js` usam uns aos outros. Cada um faz o
`module.exports` antes dos `require` dos outros, senão o Node entrega um objeto vazio no ciclo.

## Testes

| Comando | O que testa | Abre janelas? |
|---------|-------------|---------------|
| `npm test` | Lógica sem janelas: voz, servidor da sala, subsalas, modo Internet, RazzeAPI, preferências, metadados, mensagens e fontes (uns 3 s) | Não |
| `npm run test:settings` | Configurações em janelas invisíveis e a persistência entre dois processos | Não |
| `npm run test:razze-api` | Só os testes `razze-*` (já incluídos no `npm test`) | Não |
| `npm run test:rtc` | Áudio WebRTC de verdade entre duas janelas ocultas, sem o seu microfone | Não |
| `npm run test:clipe` | Clipe com H.264 e som de verdade (WebCodecs): monta o MP4 e abre num `<video>`; depois o modo "uma por pessoa" com uma faixa ao vivo dentro do app (uns 25 s) | Não |
| `npm run test:e2e` | Tudo de ponta a ponta (uns 10 minutos) | Sim |
| `npx electron tests/e2e/carga.cjs` | Se o app abre sem erro e os nomes globais existem (5 s) | Não |
| `npx electron tests/e2e/chamada.cjs` | Ligar e atender com dois apps (modo Internet com o servidor de verdade em 127.0.0.1 e modo Radmin), a voz dos dois e mudar a senha (~30 s). Sem internet | Não |
| `npx electron tests/e2e/comando-voz.cjs` | Comando de voz de ponta a ponta: liga, baixa o Whisper (internet na 1ª vez, ~70 MB, fica guardado na pasta temporária), grava de um microfone de mentira com a voz do Windows e confere o comando. Só Windows | Não |

Sobre o `npm run test:e2e` (`tests/e2e/`):
- **Como funciona:** abre várias cópias do app no seu PC, cada uma como uma pessoa, e confere:
  - o chat;
  - a troca de host;
  - as janelas flutuantes;
  - a arrumação das telas;
  - a voz e o volume;
  - o chat por cima do jogo;
  - o aviso de atualização;
  - trocar a tela no meio da transmissão (nos três modos);
  - o microfone com IA e os atalhos.
- **Só um teste:** `npm run test:e2e -- chat` (o nome do arquivo, sem `.js`).
- **Sem som nas caixas:** as cópias abrem com `--mute-audio` (`openApp`, em `ajuda.js`). O som segue até a saída, e os testes medem pelo WebRTC (nível e quanto tocou); só a saída fica muda.
- **Jogo aberto:** os testes não começam se houver um jogo em tela cheia na frente, porque abrem janelas que tiram o foco. `set TELA_E2E_FORCE=1` pula essa trava.
- **Perfis e fotos** ficam em `%TEMP%\tela-p2p-e2e`, nunca no seu perfil de verdade. A limpeza no fim fecha só as cópias de teste.
- **O teste do Ctrl+Enter** digita de verdade, então fica de fora: `node tests/e2e/ctrl-enter.js`. Ele só manda teclas se a janela da frente for a janela de teste ou o chat.
- **Para escrever um teste novo,** use `tests/e2e/ajuda.js`: `openApp`, `createRoom`, `joinRoom`, `share`, `check`, `winStyle` e `run`.

O que os testes automáticos não pegam (eco, ruído, apertar para falar com tecla de verdade, troca de host entre PCs diferentes) está no [roteiro de teste da call](roteiro-de-teste.md).

## Ajudantes nativos

- **Compilar:** `native\build.cmd`, com o Visual Studio Build Tools (C++ e o SDK do Windows).
- **Só um:** `native\build.cmd audiocap`, `native\build.cmd videocap` ou `native\build.cmd teclas`.
- **Licença de terceiros:** o cabeçalho do NVENC (`native/third_party/nvEncodeAPI.h`) é do nv-codec-headers, licença MIT.
- **Antivírus:** como os `.exe` não têm assinatura digital, o Windows Defender ou o SmartScreen podem desconfiar.
- **Alternativa ao Visual Studio:** o `audiocap.exe` também compila com MinGW-w64:

```
x86_64-w64-mingw32-g++ -O2 -std=c++17 -static -s -o bin/audiocap.exe native/audiocap.cpp -lole32 -luuid -lshell32
```

## Atualizações

Ninguém precisa baixar o `.exe` de novo para atualizar. A versão nova chega por dois caminhos, com o mesmo pacote assinado (cerca de 2 MB):

- **Pelo GitHub:** o app procura a última versão ao abrir e a cada 30 minutos. Se houver uma mais nova, aparece o aviso no canto da tela com **Atualizar agora**, que baixa e reinicia. Também dá para clicar em **Procurar atualização**, na tela inicial.
- **Pela sala:** quando alguém da sala tem uma versão mais nova, o app baixa dessa pessoa pela Radmin, e quem atualizou repassa para os próximos.

Detalhes:

- **Segurança:** o app só aceita pacotes assinados com a chave de quem publica. Pacote alterado, de outra pessoa ou mais velho que o atual é recusado, mesmo vindo do GitHub. Se uma versão nova não abrir, o app volta sozinho para a do `.exe`.
- **Nada se acumula:** a versão nova fica em `%APPDATA%\Tela P2P\atualizacoes`, e as pastas de versões mais velhas são apagadas quando o app abre.
- **Quando precisa do `.exe` novo:** só se mudar a versão do Electron ou o `boot.js`. O app avisa e abre a página da versão no GitHub.
- **Versões muito antigas:** quem tem a 1.0.0 precisa baixar o `.exe` uma vez.

## Publicar uma versão (só quem tem a chave)

A chave fica em `C:\Users\<você>\.tela-p2p\chave-de-atualizacao.pem`, fora do projeto.
- **Faça uma cópia offline** (pendrive ou gerenciador de senhas). Sem ela, não dá mais para mandar atualizações para quem já tem o app.
- **Nunca mande para ninguém:** quem tiver a chave publica no seu nome.

Feche o `dist\Tela P2P.exe` se estiver aberto e rode:

```
npm run publicar
```

Isso:
1. sobe a versão (ex.: 1.8.9 → 1.8.10);
2. assina o pacote e deixa a versão pronta no seu app;
3. gera o `.exe`;
4. manda para o GitHub: o commit, a tag e uma Release com o `.exe` e o pacote assinado.

Opções:

- **Escolher o número:** `npm run publicar -- 1.9.0`
- **Novidades no app:** o `publicar.js` gera `renderer/novidades.js` com as mensagens dos commits de cada versão (as 10 últimas, sem merge e sem `CI:`). O Início mostra para quem atualizar. Escreva a mensagem do commit pensando em quem usa o app; `Área: a; b` vira a etiqueta "Área" com uma linha para cada parte.
- **Texto da Release:** `npm run publicar -- --notas "o que mudou"`. Sem isso, o GitHub lista os commits.
- **Sem GitHub:** `npm run publicar -- --sem-github`

Para mandar para o GitHub, o PC precisa do Git e do [GitHub CLI](https://cli.github.com), logado (`gh auth login`) na conta dona do repositório.

A chave foi criada uma vez com `node publicar.js --gerar-chave`, que grava a parte pública no `boot.js`. **Não rode de novo:** uma chave nova faria os apps dos amigos recusarem as suas atualizações.

## Contribuir (PR e merge)

- **Faça num ramo próprio** e abra um Pull Request no GitHub. O passo a passo com o Claude Code está em [Fluxo com IA](fluxo-com-ia.md).
- **Antes de pedir o merge:**
  - rode `npm test` e `npm run test:e2e`;
  - se mexeu em voz, janelas ou atalhos, passe o [roteiro de teste](roteiro-de-teste.md) numa call.
- **Depois que um PR é aceito no GitHub,** rode `git pull` na pasta do projeto antes de mexer em mais coisa, para trazer o código novo.
- **Arquivos novos** que o app precisa em tempo de execução entram em `PACK_FILES` (`publicar.js`) e em `build.files` (`package.json`). Sem isso, eles não vão nas atualizações nem no `.exe`.
