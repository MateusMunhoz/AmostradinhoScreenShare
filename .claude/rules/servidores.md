---
paths:
  - "razze-api/**"
  - "servidor-internet/**"
  - "main/razze-*"
  - "sala-protocolo.js"
---

# Servidores (RazzeAPI e modo Internet)

- RazzeAPI: Node ≥ 24 (`node:sqlite`). Detalhes e rotas: `docs/razze-api.md`. Modo Internet: `servidor-internet/README.md`.
- Segredos (`RAZZE_ADMIN_TOKEN`, `TURN_SECRET`, `.env`) nunca no código, nos testes nem no cliente Electron.
  Não leia `razze-api/.env` nem `razze-api/data/`. Exemplo de configuração só em `.env.example`.
- Todo dado que chega de cliente é não confiável: valide tipo, tamanho e formato antes de usar, como
  `sala-protocolo.js` e `razze-api/server.js` já fazem. Mantenha os limites de tentativa e de tamanho existentes.
- `sala-protocolo.js` é a língua comum de `signaling.js` (PC do host) e `servidor-internet/server.js` (VPS):
  mudar uma mensagem muda os dois lados e quem ainda está numa versão antiga.
- Rota nova ou mudada na RazzeAPI: atualize a tabela de `docs/razze-api.md` e os testes `tests/razze-*.test.js`.
- Testes: `npm test` (inclui `razze-*` e `servidor-internet`) ou só `npm run test:razze-api`.
