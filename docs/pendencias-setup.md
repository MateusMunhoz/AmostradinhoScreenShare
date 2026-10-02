# Pendências do setup com IA

O que falta para fechar a fundação descrita em [Fluxo com IA](fluxo-com-ia.md). Riscar (ou apagar a linha) quando feito.

## Agora
- [ ] Acompanhar o **Windows smoke**, automático em PR e na `main` desde 01/10/2026. Na estreia achou um bug real
      (`renderer/lista.js`, PR #13). Se falhar sem motivo, anotar aqui qual teste e quando.
- [ ] Primeiro PR usando o template e as regras novas, para ver o fluxo de ponta a ponta.

## Depois
- [ ] CI no Linux (`npm test`): 1ª execução falhou porque o CI pulava o download do Electron e
      `main/razze-service.js` faz `require('electron')`. Corrigido; conferir a próxima execução.
- [ ] `docs/desenvolvimento.md`: a tabela do processo principal (`main/`) não lista `fontes.js`, `linux.js` e os `razze-*`.
- [ ] Roadmap P1: reescrever com a ideia atual da equipe, mantendo a fase 2 (Hyperswarm) como prioridade.
- [ ] RazzeAPI: **não remover ainda** (decisão de 01/10/2026). Destino no [roadmap](roadmap.md#razze-e-wireguard): só
      sai depois que amigos, lobby e túnel sem servidor estiverem provados, com importação dos amigos. Até lá, não
      mexer nos testes `razze-*` nem em `razze-api/`.
- [ ] CODEOWNERS: quando a equipe dividir áreas (hoje todos mexem em tudo).
- [ ] Proteção da `main` (PR obrigatório, CI obrigatório): só depois do CI estável e combinando com o `publicar.js`,
      que faz push direto na `main`.
