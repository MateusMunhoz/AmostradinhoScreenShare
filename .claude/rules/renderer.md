---
paths:
  - "index.html"
  - "renderer/**"
  - "styles*.css"
  - "voice.js"
  - "encode-once.js"
  - "pcm-worklet.js"
---

# Renderer (a página do app)

- Scripts clássicos, sem módulos, num escopo global único. A ordem real é a dos `<script>` no fim do `index.html`:
  dependência nova entra **antes** de quem a usa. Só `renderer/inicio.js` roda código na carga (listeners, `onclick`,
  preferências); os outros só declaram funções e variáveis.
- Arquivo novo: `<script>` no `index.html` na posição certa + `PACK_FILES` (`publicar.js`) + `build.files` (`package.json`).
  Depois: `npx electron tests/e2e/carga.cjs`.
- CSP (`index.html`): `style-src 'self'` → nada de `style=""` no HTML. Sem CDN, só fontes locais.
  O `'wasm-unsafe-eval'` existe para o RNNoise; não acrescente outras exceções.
- Cores só por `var(--...)`: tokens em `styles.css` (`:root`) e `palette()` em `renderer/preferencias-modelo.js`.
  Semântica: amarelo = você/ao vivo, verde = falando, laranja = cuidado. Sem vermelho.
- Sem animação contínua: o app roda junto com jogos. Só transições curtas em resposta a uma ação.
  Exceção aprovada: o vinil e as barrinhas do "Ouvindo agora" no perfil (`atvVinil`, `ceu-voz.js`), só com o perfil
  aberto, só `transform`, parados no modo gamer e com "reduzir movimento". Não abra outras sem pedir.
- Preferência nova: validar em `normalize()` (`renderer/preferencias-modelo.js`) e cobrir em `tests/preferencias.test.js`.
- A página só fala com o processo principal por `window.api` (`preload.js`). Precisa de algo novo do main? Veja a regra
  de `main.js`/`preload.js` e apresente o plano antes.
- Textos da interface em pt-BR, curtos e no tom do resto do app.

## Layout (não há mais barra de cima)
- `#workspaceNav` é a **barrinha da direita** (em pé, `--rail-w`), só com ícones. De cima
  para baixo: perfil · linha · `peopleBtn` (pessoas), Chat, Voz, Transmissão, `navMusicWrap` (música que você ouve) ·
  espaço · `dockHome` (Início) ou `navBackToRoom` (no menu), `leaveBtn` (Sair) · linha · `navGamer` (modo gamer) · engrenagem. Início e Sair
  **não** estão mais na barra de baixo (`.dock`) nem em `DOCK_OVERFLOW`. Chat e voz abrem à esquerda dela
  (`#workspacePanes`, `right: 16px + --rail-w`), com a animação `pane-expand` só ao abrir.
- `syncWorkspace()` (`navegacao.js`) separa `inCall` (`state.myId`, mesmo no menu inicial) de `inRoom` (a tela da sala
  à vista). No menu, com a sala aberta, a barrinha e os painéis de chat e voz continuam; só as telas ficam na sala
  (Transmissão volta para ela). A classe `workspace-in-room` do body segue `inCall`.
- Não há mais HUB (a barra da esquerda). A rede mora em **Configurações › Rede** (`#settingsPanel-network`, grupo `rede`),
  com o Mapa de conexões (`#connectionMap`), que atualiza a cada 5 s só com o grupo à vista (`syncConnectionMap`, chamado
  por `settingsGroupChanged` e `closeGeneralSettings`). A conta Razze (`#profileAccount`) fica no fim do Perfil; os
  amigos, na aba **Amigos** do envelope (`#dmFriends`, ao lado de `#dmConvs`; `setDmPanel(open, 'convs'|'friends')`).

- **Modo gamer** (`renderer/modo-gamer.js`, `:root[data-gamer="on"]`): prioridade normal, vidro opaco (`glassMode()` em
  `configuracoes.js`; nunca grave isso em `appPreferences`), sem animação/transição/`backdrop-filter`, sem o céu do fundo,
  o céu da voz e a luz ambiente; GIF do fundo do perfil parado. Recurso novo que pesa no PC (animação, desfoque, timer
  de desenho)? Desligue também com `gamerOn()`.
- O perfil da voz (`renderSkyProfile`, `ceu-voz.js`) serve ao mapa e à lista: na lista vira a caixinha `.sky-pop`, solta no
  `body` e com a foto em cima da foto da linha (`placeSkyProfile`). O fundo do perfil (`renderer/fundo-perfil.js`) chega
  por `{ side: 'fundo' }` em pedaços; valide tudo que chega como em `onPhotoSignal`.

## Temas (aba Tema)
- Cada tema é um `styles-<tema>.css` sob `:root[data-skin="<id>"]` (Arasaka, E.V.A, Du'Sol, Cloud) + a entrada em `skins`
  (`renderer/preferencias-modelo.js`) + `<link>` no `index.html` + `PACK_FILES` e `build.files`. A prévia do cartão é
  `.skin-preview[data-preview=<id>]`, com cores fixas.
- O Du'Sol (`styles-dusol.css`) usa uma imagem: `assets/temas/dusol-sol.webp`, gerada por `assets/temas/gerar-sol.py`
  (numpy + OpenCV). Mudou o Sol? Rode o script de novo; a imagem entra no pacote por `PACK_FILES` e `assets/temas/*.webp`.
- O Di'Luna (`styles-diluna.css`, `assets/temas/diluna-lua.webp` por `gerar-lua.py`) é o irmão dele, com a Lua. Os dois
  usam a mesma geometria (borda do astro a 20,5% da imagem 2560x1440), e o CSS acha a borda com max(20.5vw, 36.44vh):
  mudou o tamanho ou o lugar do astro num script? Mude essa conta no CSS do tema.
- Inspiração em obra de terceiros (jogo, filme) fica só no clima: nada de nome, símbolo, brasão ou imagem dela.

## Logo e céu (tema Padrão)
- A logo (três estrelas ligadas por pontilhados, cores fixas `--logo-1/2/3`) existe em três lugares que andam
  juntos: o SVG `.app-logo` no `index.html` (barra de título e Início), `LOGO_STARS`/`LOGO_DOTS` em
  `renderer/icone-app.js` (ícone da janela e o `.ico` via `npm run icone`) e `--st-logo` em `styles-estelar.css`
  (palco vazio). Mudou o desenho? Mude os três e rode `npm run icone` (o `.icns` do Mac não é gerado por ele).
- O fundo do tema Padrão é um céu parado: estrelas em `--st-sky` (máscara SVG na cor do texto) e nebulosas nas cores
  da logo, em `styles-estelar.css`. O antigo céu de exemplo da tela inicial (`renderHomeSky`) saiu.
