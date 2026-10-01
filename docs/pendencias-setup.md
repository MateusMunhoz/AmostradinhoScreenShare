# Pendências do setup com IA

O que falta para fechar a fundação descrita em [Fluxo com IA](fluxo-com-ia.md). Riscar (ou apagar a linha) quando feito.

## Agora
- [ ] Estabilizar o **Windows smoke** (Actions → CI → *Run workflow*). 1ª execução (01/10/2026): carga ✅, áudio
      WebRTC ✅, configurações ❌ em "Lista de fontes no tema, com vidro e cada fonte na própria letra"
      (`tests/settings-smoke.cjs`). Passa no PC de casa; no Windows do GitHub, não. Investigar antes de mexer no teste.
      Quando passar de forma estável, decidir se vira automático nos PRs.
- [ ] Primeiro PR usando o template e as regras novas, para ver o fluxo de ponta a ponta.

## Depois
- [ ] CI no Linux (`npm test`): 1ª execução falhou porque o CI pulava o download do Electron e
      `main/razze-service.js` faz `require('electron')`. Corrigido; conferir a próxima execução.
- [ ] `docs/desenvolvimento.md`: a tabela do processo principal (`main/`) não lista `fontes.js`, `linux.js` e os `razze-*`.
- [ ] Roadmap P1: reescrever com a ideia atual da equipe, mantendo a fase 2 (Hyperswarm) como prioridade.
- [ ] RazzeAPI: provavelmente será descartada. Até a decisão, não mexer nos testes `razze-*` nem em `razze-api/`.
- [ ] CODEOWNERS: quando a equipe dividir áreas (hoje todos mexem em tudo).
- [ ] Proteção da `main` (PR obrigatório, CI obrigatório): só depois do CI estável e combinando com o `publicar.js`,
      que faz push direto na `main`.
