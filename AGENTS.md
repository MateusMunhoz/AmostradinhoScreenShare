# AGENTS.md — Tela P2P (AmostradinhoScreenShare)

Instruções para agentes de código (Claude Code e outros). Detalhes ficam nos docs; aqui só o que evita erro.
Idioma do projeto: português do Brasil (código, comentários, docs, commits e textos da interface).

## O projeto
App Electron (Windows; Linux em AppImage/X11) para transmitir a tela e conversar por voz, de PC para PC.
Produto: `README.md` e `docs/guia.md`. Futuro: `docs/roadmap.md`. Arquitetura e testes: `docs/desenvolvimento.md`.

| Parte | Onde |
|---|---|
| Boot e verificação de assinatura das atualizações | `boot.js` |
| Processo principal e IPC | `main.js`, `main/` |
| Ponte segura (`window.api`) | `preload.js` |
| Interface (scripts clássicos, escopo global único) | `index.html`, `renderer/`, `voice.js`, `encode-once.js`, `styles*.css` |
| Sala: sinalização e protocolo | `signaling.js` (no PC do host), `sala-protocolo.js` (compartilhado com `servidor-internet/`) |
| Ajudantes nativos (só Windows) | `native/*.cpp` → `bin/*.exe` (binários versionados) |
| Serviços de servidor (Node ≥ 24 na RazzeAPI) | `razze-api/`, `servidor-internet/` |
| Publicação | `publicar.js`, `github.js`, `icone-exe.js`, `linux/` |

Regras específicas de cada parte carregam sozinhas de `.claude/rules/` quando você mexe nos arquivos dela.

## Comandos
- `npm ci` — instalar (Node 24 ou mais novo).
- `npm run dev` — abrir o app com o código desta pasta (`npm start` pode abrir uma atualização baixada).
- `npm test` — testes unitários (node:test, ~3 s, sem janelas). Rodar sempre antes de terminar.
- `npx electron tests/e2e/carga.cjs` — o app abre sem erro (~5 s, janela invisível).
- `npm run test:settings`, `npm run test:rtc` — Electron com janelas invisíveis.
- `npm run test:e2e` — ponta a ponta, só Windows, abre janelas, ~10 min. Peça ao humano.
- Qual teste rodar para cada mudança: skill `testar`.

## Proibido para agentes
- Publicar: `npm run publicar`, `node publicar.js` (inclui `--gerar-chave`). Só um humano publica.
- `git push`, `git tag`, `gh release`. Commit só quando pedirem.
- Ler ou copiar a chave de assinatura (`~/.tela-p2p/`), `razze-api/.env`, `razze-api/data/`.
- Mudar a chave pública do `boot.js`: os apps de todos passariam a recusar as atualizações.

## Invariantes (quebrar isso quebra o app de quem atualiza)
1. Arquivo novo que o app usa em tempo de execução entra em `PACK_FILES` (`publicar.js`) **e** em `build.files`
   (`package.json`). Sem isso ele não vai no `.exe` nem na atualização. O CI confere o que o `index.html` carrega.
2. `boot.js` e a versão do Electron só chegam aos amigos com um `.exe` novo; o resto chega pela atualização assinada.
   Mudança neles precisa ser dita no PR.
3. Renderer: só `renderer/inicio.js` roda código na carga; os outros só declaram. Ordem dos `<script>` no `index.html` importa.
4. Segurança do Electron: `contextIsolation: true`, `nodeIntegration: false`, a página só fala com o processo principal
   por `window.api` (`preload.js`). CSP do `index.html` sem `unsafe-*` novo, sem CDN.
5. Mensagens da sala e da RazzeAPI vêm de outros PCs: valide e limite tudo que chega (padrão de `sala-protocolo.js`).

## Como trabalhar
- Fluxo da equipe (issue → spec → PR): `docs/fluxo-com-ia.md`. Spec de feature: `docs/spec/`.
- Faça só o que a tarefa pede. Sem refactor, renomeação ou limpeza fora do escopo.
- Leia só o necessário: busque antes de abrir arquivos grandes (`index.html`, `styles.css`, `main.js`).
- Antes de mexer em `boot.js`, IPC (`main.js`/`preload.js`), `main/razze-*`, `publicar.js` ou protocolo da sala:
  apresente o plano e espere aprovação.
- Comportamento visível mudou? Atualize `docs/guia.md`. Comando, arquivo ou arquitetura mudou? `docs/desenvolvimento.md`.
- Terminou: `npm test` passando e, no fim, diga o que foi testado e o que ficou para teste manual (Windows, call real).

## Skills
- `testar` — escolher e rodar os testes certos; escrever teste novo.
- `sala-webrtc` — sala, sinalização, troca de host, voz, subsalas, conexões WebRTC.
- `revisar-ui` — revisão de UI/UX de uma tela.
