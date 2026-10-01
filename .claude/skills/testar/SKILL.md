---
name: testar
description: Escolher e rodar os testes certos do Tela P2P para uma mudança, dizer o que fica para teste manual no Windows ou numa call, e escrever teste novo (unitário em tests/*.test.js ou ponta a ponta em tests/e2e/). Use ao terminar uma mudança, ao investigar teste quebrado ou quando pedirem teste novo.
---

# Testar

## 1. Escolha pelo que mudou

| Mudou | Rode | Peça ao humano (Windows) |
|---|---|---|
| Qualquer coisa | `npm test` | — |
| `renderer/`, `index.html`, `styles*.css`, `voice.js`, `encode-once.js` | + `npx electron tests/e2e/carga.cjs` | `npm run test:e2e -- <nome>` do que foi afetado |
| Configurações, preferências, temas, sons, barra/painéis | + `npm run test:settings` | — |
| Voz, áudio, `rtc.js`, `voice.js`, microfone | + `npm run test:rtc` | `roteiro-de-teste.md` (Voz) numa call |
| Sala, `signaling.js`, `sala-protocolo.js`, troca de host | `npm test` já cobre signaling/subsalas | `npm run test:e2e -- troca-de-host` e roteiro item 11 |
| `servidor-internet/` | `npm test` (servidor-internet.test.js) | `npm run test:e2e -- internet` |
| `razze-api/`, `main/razze-*` | `npm run test:razze-api` | `npm run test:e2e -- razze`; painel: `npm run test:razze-admin` |
| Janelas flutuantes, chat por cima do jogo, atalhos | `npm test` | `npm run test:e2e -- janela-flutuante`, `node tests/e2e/ctrl-enter.js`, roteiro 9–10 |
| `main/nativos.js`, `native/`, NVENC, captura | — | `npm run test:e2e -- trocar-tela` / `quatro-k` / `som`, manual |
| `publicar.js`, `boot.js` | `npm test` | só o humano valida; agente nunca publica |

Nomes válidos para `npm run test:e2e -- <nome>`: lista `TESTS` em `tests/e2e/rodar.js` (`chat`, `voz`, `subsalas`,
`troca-de-host`, `sessoes`, `internet`, `razze`, `barra`, ...).

## 2. Onde cada um roda
- **Sem janela, qualquer SO (CI Linux):** `npm test`, `npm run test:razze-api`.
- **Electron com janelas invisíveis:** `carga.cjs`, `test:settings`, `test:rtc`. No CI, no job Windows smoke (todo PR).
- **Só Windows, abre janelas e tira o foco (~10 min):** `npm run test:e2e`. Não comece com jogo em tela cheia
  (`TELA_E2E_FORCE=1` pula a trava). `ctrl-enter.js` digita de verdade: só com o humano olhando.
- **Gente de verdade:** eco, ruído, apertar para falar com tecla real, troca de host entre PCs → `docs/roteiro-de-teste.md`.

## 3. Teste novo
- Unitário: `tests/<assunto>.test.js` com `node:test` e `node:assert/strict`, importando o módulo com `require`.
  Entra sozinho no `npm test` (glob `tests/*.test.js`). Use portas livres e pastas em `os.tmpdir()`; nada de rede externa.
- Ponta a ponta: `tests/e2e/<nome>.js` usando `tests/e2e/ajuda.js` (`openApp`, `createRoom`, `joinRoom`, `share`,
  `check`, `winStyle`, `run`) e acrescente o arquivo em `TESTS` (`tests/e2e/rodar.js`).
- Perfis de teste ficam em `%TEMP%\tela-p2p-e2e`, nunca no perfil real.

## 4. Ao terminar
Diga o que rodou (com resultado) e o que ficou para o humano: e2e no Windows e/ou itens do roteiro.
