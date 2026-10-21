# Nebula no iPhone (sideload)

Issue: a abrir · Roadmap: vizinho do D2 ([assistir pelo navegador](assistir-no-navegador.md)) · **Plano para implementar
em fases.** Escrito para o agente que vai implementar (Sonnet, no Claude Code) seguir sem redescobrir o código. As
"Decisões" no fim precisam de resposta de um humano antes da fase indicada.

## Objetivo
Quem está no iPhone (ou iPad) entra nas salas dos amigos pelo modo Internet: assiste às telas, conversa por voz e no
chat, e entra pelo QR do convite. O app não vai para a App Store: é um `.ipa` instalado por sideload (SideStore,
AltStore ou Sideloadly). O PC continua sendo quem cria a sala e quem transmite.

## Escopo
- **Entra (v1):** entrar numa sala do modo Internet (código e senha, link `telap2p://sala?d=…` do QR do palco, convite
  de amigo); assistir às transmissões; voz (com o app aberto); chat de texto e imagens; música junto (se o YouTube
  tocar na WebView, ver Riscos); perfil (nome, foto, frase); conta Razze com e-mail e senha, amigos, convites e
  mensagens diretas criptografadas; layout de celular em pé.
- **Fica de fora (v1):** criar/hospedar sala (o iPhone não roda servidor); **transmitir a tela** (precisa de ReplayKit e
  WebRTC nativo: fase futura); modos Radmin, rede local e Razze/WireGuard (Radmin não existe no iOS; túnel exige
  NetworkExtension, que conta gratuita de sideload não tem); comando de voz; clipes; janela flutuante e chat por cima
  do jogo; atalhos globais; atividade de jogos e Steam; estatísticas de processo; atualização pela sala; login com
  Google (precisa de mudança na RazzeAPI, ver Decisões).

## Como o app é montado (decisão de arquitetura)
**Capacitor** (WKWebView + ponte nativa), reaproveitando a interface que já existe (`index.html`, `renderer/`,
`styles*.css`, `voice.js`, `encode-once.js`) quase sem mudança. O que o Electron faz no processo principal
(`main.js`, `main/`) e expõe por `window.api` (`preload.js`) é refeito numa **ponte iOS** em JavaScript, com 3 plugins
Swift pequenos onde o JS não basta (cofre, criptografia, áudio).

Por quê: a interface tem ~30 mil linhas que já funcionam e conversam com a sala; reescrever em Swift seria outro app.
A WKWebView tem WebRTC, `getUserMedia` (iOS 14.5+), AudioWorklet e WebAssembly.

```
mobile/                      pacote próprio (não mexe no package.json do desktop)
  package.json               @capacitor/core, cli, ios, app, clipboard, browser, share; devDeps: esbuild, playwright
  capacitor.config.json      appId, appName "Nebula", webDir "www", CapacitorHttp ligado
  scripts/montar-www.mjs     monta mobile/www a partir da raiz (ver Fase 0)
  ponte/                     o window.api do iOS (JS, empacotado com esbuild)
    index.js                 monta window.api = { platform: 'ios', ... }
    stubs.js                 tudo que não existe no iOS (resposta segura, sem lançar)
    razze.js                 usa main/razze-api-client.js (JS puro) com o fetch nativo do Capacitor
    mensagens.js             histórico das DMs (Filesystem) + plugin NebulaCripto
    youtube.js               usa main/youtube-previa.js com o fetch nativo
    links.js                 telap2p:// (appUrlOpen) → onRazzeInvite / onFriendLink / convite de sala
  ios/App/                   projeto Xcode gerado por `npx cap add ios` (vai no Git)
    App/Plugins/NebulaCofre.swift   Keychain: token da conta e chave privada das DMs
    App/Plugins/NebulaCripto.swift  CryptoKit: X25519 + HKDF-SHA256 + AES-256-GCM (igual a main/mensagens-cripto.js)
    App/Plugins/NebulaAudio.swift   AVAudioSession .playAndRecord (alto-falante, Bluetooth)
  testes/                    testes do mobile (Node e Playwright WebKit)
  altstore/source.json       fonte do AltStore/SideStore (lista de versões do .ipa)
.github/workflows/ios.yml    macOS: monta, compila sem assinar, gera o .ipa como artefato
```

## O que o agente precisa saber do código (levantado em 2026-10-21)

**`window.api` tem 155 entradas** (`preload.js`). No iOS ficam assim:

| Grupo | Entradas | No iOS |
|---|---|---|
| Base | `platform`, `copyText`, `openLink`, `getVersion`, `noiseWasm`, `youtubePrevia` | Implementar (`platform: 'ios'`; clipboard e browser do Capacitor; `noiseWasm` lê `vendor/noise/*.wasm` do `www`) |
| Conta Razze | `razze*` (login, cadastro, 2FA, amigos, convites, links de amigo, presença, feedback, bio, atividade, admin) | Implementar sobre `main/razze-api-client.js`. Google: stub com mensagem (Decisão 4) |
| Mensagens diretas | `razzeSendMessage`, `razzeMessages`, `dm*` | Implementar: histórico em arquivo cifrado, cripto no plugin nativo |
| Links do app | `razzePendingInvite`, `onRazzeInvite`, `razzePendingFriendLink`, `onFriendLink` | Implementar com `App.addListener('appUrlOpen')` |
| Rede | `getIps` | `[]` (sem LAN no v1) |
| Hospedar sala | `startServer`, `stopServer`, `sessoesObservar`, `onSessoes` | Stub: `{ ok: false, error: 'No iPhone dá para entrar nas salas, não criar.' }` |
| Transmitir | `getSources`, `selectSource`, `listAudioApps`, `startAppAudio`, `stopAppAudio`, `onPcm`, `offPcm`, `videoCap*`, `onVideoCap`, `offVideoCap`, `captureExclude` | Stub (e a UI some, ver Fase 1) |
| Janelas e PC | `pip*`, `onPip`, `chatCompose`, `roomKeys`, `fecharNaBandeja`, `getShortcuts`, `setShortcut`, `ptt`, `windowMaterial`, `setTitleBar`, `setWindowIcon`, `captureRegion`, `setPriority`, `stats*`, `onStats`, `offStats` | Stub sem efeito |
| Atualizar | `getOwnPack`, `installUpdate`, `restartApp`, `githubCheck`, `githubInstall`, `openGithub` | `getOwnPack` → `null` (assim o iPhone responde "indisponível" se um PC pedir pacote pela sala); o resto stub. Atualização é pelo AltStore |
| Extras | `vozCmd*`, `vozIa*`, `onVozCmd`, `clipSave`, `clipShow`, `atividadeLer`, `atividadeSteamJogos`, `aoMudarMusica`, `celular*`, `onCelular` | Stub |
| WireGuard | `razzeWireGuard*` | Stub: `{ connected: false, error: 'Indisponível no iPhone' }` |

Regra: **todo stub devolve o mesmo formato que o Electron devolve** (Promise com `ok:false`, lista vazia, `null`), nunca
lança. O renderer já trata esses retornos no Linux, onde várias coisas também não existem.

**Criptografia das DMs** (`main/mensagens-cripto.js`): par X25519; segredo = ECDH; chave = HKDF-SHA256(segredo, sal de 16
bytes, info `telap2p-dm-v1|<de>|<para>` ou `telap2p-dm-sinal-v1|…`, 32 bytes); AES-256-GCM com IV de 12 bytes; texto
começa com `e2e1:`; cabeçalho de `1 + 32 + 32 + 16 + 12` bytes; públicas trocadas em 32 bytes crus (o DER SPKI tem o
prefixo `302a300506032b656e032100`). A chave privada **nunca** vai para a WebView (regra do projeto): ela mora no
Keychain e só o plugin Swift a usa. O CryptoKit tem tudo isso (`Curve25519.KeyAgreement`, `HKDF<SHA256>`, `AES.GCM`).

**WebKit vs Chromium** (o que o renderer usa e o iOS não tem):
- `MediaStreamTrackGenerator`/`VideoDecoder` (modo "uma vez só"): `onceSupportedForViewer()` em `encode-once.js` já
  devolve `false` sem eles, e quem transmite manda o vídeo normal pelo WebRTC. **Nada a fazer**, só confirmar.
- `getDisplayMedia`, `MediaStreamTrackProcessor`, `VideoEncoder` (`transmitir.js`, `clipes.js`, `encode-once.js`):
  só para transmitir e clipes, que ficam escondidos no iOS.
- `window.open` (`pip.js`, `overlay.js`): janela flutuante e chat por cima do jogo; esconder no iOS.
- `new Notification` (`chat.js`): já está em `try`; no iOS não há notificação (v1).
- `speechSynthesis` (`comando-voz.js`): comando de voz fica de fora.
- `OffscreenCanvas` 2D (fotos, fundo, recorte, chat): só iOS 16.4+. **Versão mínima: iOS 16.4.**

**Interface:** a janela do Electron tem no mínimo 820×560 (`main.js`). O iPhone em pé tem ~390×844: precisa de um layout
de celular (Fase 1). Só `renderer/inicio.js` roda código na carga; os outros só declaram (AGENTS.md, invariante 3).

**Sala:** o protocolo não muda. O iPhone é só mais um cliente do `servidor-internet/` (mesmo `hello`, mesma
`sala-protocolo.js`). Ele manda `addrs: []` e nunca vira host (no modo Internet não há troca de host). TURN vem do
servidor no `welcome`, e no 4G ele é necessário.

## Fases

Cada fase é **um PR**. O agente não roda `git push`, `git tag` nem publica (AGENTS.md): no fim de cada fase ele pede ao
humano para subir o ramo, e o CI do macOS compila. No Windows dá para fazer tudo menos compilar para iOS.

### Fase 0: o app abre no iPhone (esqueleto)
1. `mobile/package.json` com o Capacitor estável da época (fixe as versões); `npx cap init` e `npx cap add ios`.
   iOS 16.4 como mínimo (`IPHONEOS_DEPLOYMENT_TARGET`).
2. `mobile/scripts/montar-www.mjs`:
   - copia para `mobile/www` exatamente o que o `index.html` carrega (use a mesma lista que
     `.github/scripts/conferir-pacote.js` confere), mais `assets/`, `vendor/`, `pcm-worklet.js` e os `.wasm`;
   - insere `<script src="ponte.js"></script>` **antes** do primeiro `<script>` do `index.html` copiado (o `window.api`
     tem de existir antes de `renderer/util.js`);
   - põe `data-plataforma="ios"` no `<html>`;
   - ajusta a CSP só na cópia: mantém `default-src 'self'`; `connect-src` passa a `ws: wss: https:` (o servidor da
     sala e a RazzeAPI); `frame-src` continua só o YouTube. **O `index.html` do desktop não muda.**
   - empacota `mobile/ponte/index.js` com esbuild (formato IIFE) em `www/ponte.js`.
3. Ponte com todos os stubs e `platform: 'ios'`.
4. `.github/workflows/ios.yml` (só `workflow_dispatch` e PRs que mexem em `mobile/**`; o `mac.yml` já usa `macos-14`):
   `npm ci` (raiz e mobile) → `node mobile/scripts/montar-www.mjs` → `npx cap sync ios` → `xcodebuild archive
   -configuration Release -sdk iphoneos CODE_SIGNING_ALLOWED=NO` → `Payload/App.app` zipado como `Nebula-<versão>.ipa` →
   artefato do workflow. Sem assinar: quem instala assina (SideStore/AltStore/Sideloadly).
5. **Pronto quando:** o `.ipa` instala por sideload e abre no Início sem erro no console da WebView (Safari › Desenvolver).

### Fase 1: entrar, assistir, falar e escrever
1. **O renderer conhece o iOS**, sempre por `window.api.platform === 'ios'` ou CSS `:root[data-plataforma="ios"]`,
   seguindo o padrão de `platform === 'linux'`:
   - esconder: Criar sala, as opções de rede que não são Internet (Configurações › Rede e o menu do Início), Transmitir
     (barra, cartão Seu sinal, barra da chamada), janela flutuante, chat por cima do jogo, clipes, atalhos, modo gamer,
     comando de voz, estatísticas de processo, Steam/atividade, Backup no celular, aviso de atualização;
   - modo de rede fixo em Internet (`networkPreferences` devolve `internet`);
   - `atualizacao.js`: não pedir nem oferecer pacote pela sala;
   - colar ou abrir `telap2p://sala?d=…` (o QR do palco) entra na sala: o `input` do campo Entrar já faz isso
     (`renderer/inicio.js`); falta ligar o `appUrlOpen` da ponte a `aceitarConvite()`.
2. **Layout de celular** em `styles-ios.css` (carregado só pelo `montar-www`, não pelo desktop): uma coluna; o palco em
   cima (16:9, uma tela por vez com troca por toque; no máximo 2 telas abertas no iPhone, ver Riscos); as abas
   Voz/Chat/Pessoas embaixo, em tela cheia; a barrinha da direita vira uma barra de baixo com Início, Pessoas e Sair; o
   cartão Seu sinal fica fixo no pé. Área de toque de 44 px. `env(safe-area-inset-*)` no topo e no pé. iPad deitado
   usa o layout do desktop.
3. **Áudio:** `NebulaAudio` põe a sessão em `.playAndRecord` com `.defaultToSpeaker` e `.allowBluetooth` ao entrar na
   voz e volta ao normal ao sair; `Info.plist` com `NSMicrophoneUsageDescription`. Na WebView:
   `allowsInlineMediaPlayback = true` e `mediaTypesRequiringUserActionForPlayback = []`. O `AudioContext` só começa
   depois de um toque (regra do WebKit): o botão Entrar na voz já é o toque.
4. **App em segundo plano:** a WebView para. O servidor guarda o lugar (graceMs) e o renderer já volta sozinho
   (`reconnectCloud` em `renderer/sala.js`). Ao voltar para a frente, conferir que a voz e as telas se refazem. Voz com
   o app fechado fica para depois (`UIBackgroundModes: audio`, Decisão 5).
5. **Pronto quando:** com o PC (Windows) criando a sala no modo Internet, o iPhone entra pelo código e pelo QR, vê a
   tela em até 10 s, os dois se ouvem sem eco, o chat vai e volta, e sair/voltar do app em até 15 s mantém o lugar.

### Fase 2: conta, amigos e mensagens
1. `ponte/razze.js`: `main/razze-api-client.js` com o `fetch` do Capacitor (CapacitorHttp, sem CORS); o token fica no
   `NebulaCofre`. A RazzeAPI exige HTTPS fora de localhost (regra do projeto): manter.
2. `NebulaCripto`: gerar e guardar o par X25519 no Keychain; cifrar e decifrar no formato `e2e1:` (acima). A ponte
   passa só texto e públicas; a privada não sai do Swift.
3. Histórico das DMs como em `main/mensagens.js` (mesmas regras de id, retenção e limites), em
   `Filesystem.Directory.Library`, cifrado com uma chave do Keychain.
4. Links: `telap2p://amigo/<token>` e `telap2p://invite/<token>` (o `Info.plist` registra o esquema `telap2p`).
5. **Pronto quando:** login por e-mail no iPhone; o amigo do PC aparece e manda DM; o iPhone lê, responde e o PC lê; o
   convite de sala por DM abre a sala no iPhone.

### Fase 3: distribuição por sideload
1. Ícone (o `assets/icone/` do desktop em 1024×1024), nome "Nebula", versão igual à do `package.json` (`CFBundleShortVersionString`).
2. `mobile/altstore/source.json` no formato de fonte do AltStore/SideStore (nome, bundle id, versões com
   `downloadURL` do `.ipa` na Release, `minOSVersion: 16.4`). **Conferir o formato atual na documentação do
   AltStore na hora de fazer**: ele muda.
3. Página no `docs/guia.md` "Nebula no iPhone": como instalar pelo SideStore com Apple ID gratuito, o que não existe
   no iPhone, e que a assinatura gratuita vence em 7 dias (o SideStore renova sozinho com o app aberto de vez em quando).
4. **Publicar continua sendo de um humano**: anexar o `.ipa` na Release e atualizar o `source.json`. Sugestão para o
   `publicar.js` fica para outra issue (não mexer nele nesta, AGENTS.md).

### Fase futura (não implementar sem nova spec)
- Transmitir do iPhone: extensão Broadcast Upload (ReplayKit) + WebRTC nativo (o renderer não consegue).
- Voz com o app fechado (CallKit), Picture in Picture do vídeo, notificações das DMs.
- Login com Google (ASWebAuthenticationSession com redirect `telap2p://`).

## Restrições
- **Desktop intacto:** nada de `mobile/` em `PACK_FILES` nem em `build.files`; o `index.html`, o `preload.js` e o
  `main.js` do desktop não mudam por causa do iOS. Mudança no renderer só atrás de `platform === 'ios'` / `data-plataforma`.
- **Protocolo da sala igual:** o iPhone conversa com PCs em versões antigas. Se precisar mudar protocolo, para e pede
  plano (AGENTS.md).
- **Segurança:** a chave privada das DMs e o token da conta só no Keychain; a ponte valida o que chega da página como
  o `main.js` faz (`String(x || '')`, limites de tamanho); `contextIsolation` não existe na WKWebView, então a ponte não
  expõe nada além do `window.api` (nada de caminho de arquivo livre, nada de comando).
- **CSP sem CDN:** dependências JS vão empacotadas no `ponte.js`.
- Sem animação contínua nova (regra do renderer). Textos em português, curtos.

## Dependências
- `servidor-internet/` com TURN (já existe); RazzeAPI por HTTPS (já existe).
- Um Mac só no CI (GitHub `macos-14`). Ninguém precisa de Mac em casa para o v1.
- Conta Apple: gratuita basta para o v1. Paga só se a Decisão 3 pedir.

## Riscos (testar cedo, já na Fase 1)
| Risco | Como saber | Plano B |
|---|---|---|
| YouTube embutido na WKWebView recusar o player (o Electron precisa forjar o `Referer`, `main.js`) | Pôr música numa sala e ouvir no iPhone | Esconder "Pôr música/Ouvir" no iOS e mostrar só o que toca |
| Memória: o iOS mata a WebView com muitas telas em vídeo | 3 telas abertas por 10 min num iPhone de 4 GB | Limite de 2 telas no iPhone |
| WKWebView pausa a voz ao bloquear a tela | Bloquear o iPhone na voz | Decisão 5 |
| Eco ou volume baixo (alto-falante de ouvido) | Call real sem fone | Ajustar a `AVAudioSession` |
| Regras do sideload mudarem (limites da conta gratuita, AltStore) | Ler a documentação na Fase 3 | Atualizar o guia |

## Decisões (humano, antes da fase indicada)
1. **Nome e bundle id** (Fase 0): sugestão `Nebula`, `com.telap2p.nebula`.
2. **iPad** (Fase 1): sugestão: sim, usando o layout do desktop deitado.
3. **Conta Apple paga** (Fase 3): não precisa no v1; vira necessária para transmitir do iPhone (a extensão do ReplayKit
   ocupa outro App ID e precisa de App Group) e para assinar por 1 ano.
4. **Login com Google** (Fase 2): precisa aceitar um redirect `telap2p://` na RazzeAPI; sugestão: fica para depois.
5. **Voz com o app em segundo plano** (Fase 1): sugestão: v1 só com o app aberto, avisando na tela.
6. **Onde fica a fonte do AltStore** (Fase 3): GitHub Pages do repositório ou rota estática na RazzeAPI.

## Critérios de aceitação (v1)
- [ ] O `.ipa` sem assinatura sai do CI e instala pelo SideStore com Apple ID gratuito num iPhone com iOS 16.4+.
- [ ] Entrar por código e senha, por link `telap2p://sala?d=…` (inclusive lendo o QR do palco com a câmera) e por convite de amigo.
- [ ] Assistir à tela de um PC Windows no 4G (TURN) em até 10 s; trocar entre duas telas.
- [ ] Voz nos dois sentidos, sem eco, com fone Bluetooth e sem fone; microfone e fone (silenciar) funcionam.
- [ ] Chat com texto e imagem nos dois sentidos.
- [ ] Login por e-mail; DM criptografada lida e respondida entre iPhone e PC; a privada nunca aparece na WebView.
- [ ] Nada do que não existe no iPhone aparece na tela (transmitir, criar sala, Radmin, clipes, janela flutuante...).
- [ ] Layout de celular sem rolagem lateral em 375×667 e 430×932; toques de pelo menos 44 px.
- [ ] O desktop não muda: `npm test`, `carga.cjs` e o conferidor de pacote passam iguais.

## Testes
- **Automáticos (no Windows, sem Mac):**
  - `mobile/testes/ponte.test.mjs`: lê as chaves do `preload.js` e falha se a ponte não tiver alguma (o desktop ganhou
    uma função nova e o iOS esqueceu); confere que todo stub devolve Promise e nunca lança.
  - `mobile/testes/montar-www.test.mjs`: o `www` tem tudo que o `index.html` carrega, o `ponte.js` vem antes do primeiro
    script, a CSP mudou só no `connect-src`.
  - `mobile/testes/webkit.mjs` (Playwright WebKit, que roda no Windows): abre o `www` em 390×844 com a ponte de
    teste; nenhum erro no console na carga; sem rolagem lateral; os elementos escondidos no iOS não aparecem; entra
    numa sala de um `servidor-internet` local e recebe a lista de pessoas.
  - **Vetores de cripto:** um script Node gera, com `main/mensagens-cripto.js`, mensagens cifradas e públicas em
    `mobile/testes/vetores-cripto.json`; o XCTest do `NebulaCripto` (roda no CI macOS, no simulador) decifra todas e cifra
    uma que o Node decifra. É isso que garante que iPhone e PC se entendem.
  - Rodar sempre também o `npm test` da raiz (o desktop não pode mudar).
- **No CI macOS (`ios.yml`):** `xcodebuild test` (XCTest dos plugins) e `xcodebuild archive` sem assinar.
- **Manuais (humano, iPhone real):** os critérios de aceitação acima numa call com um PC Windows, no Wi-Fi e no 4G.

## Como o agente deve trabalhar
- Uma fase por PR, nesta ordem. Antes de começar a Fase 1 e a Fase 2, confirmar as Decisões da fase com o humano.
- Ler `AGENTS.md`, `.claude/rules/renderer.md` e `.claude/rules/electron-main.md` antes de mexer.
- Não rodar `npm run publicar`, `git push`, `git tag`, `gh release`; pedir ao humano para subir o ramo e rodar o `ios.yml`.
- Sem acesso a um iPhone: dizer no fim de cada fase o que foi testado (Windows, WebKit, CI) e o que fica para o teste manual.
