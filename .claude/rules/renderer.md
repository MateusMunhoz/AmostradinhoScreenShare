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
- Preferência nova: validar em `normalize()` (`renderer/preferencias-modelo.js`) e cobrir em `tests/preferencias.test.js`.
- A página só fala com o processo principal por `window.api` (`preload.js`). Precisa de algo novo do main? Veja a regra
  de `main.js`/`preload.js` e apresente o plano antes.
- Textos da interface em pt-BR, curtos e no tom do resto do app.
