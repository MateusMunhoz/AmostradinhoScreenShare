# Pendências do setup com IA

O que falta para fechar a fundação descrita em [Fluxo com IA](fluxo-com-ia.md). Riscar (ou apagar a linha) quando feito.

## Agora
- [ ] Validar o **Windows smoke**: rodar o botão em Actions → CI → *Run workflow* e corrigir o que falhar.
      Quando passar de forma estável, decidir se vira automático nos PRs.
- [ ] Primeiro PR usando o template e as regras novas, para ver o fluxo de ponta a ponta.

## Depois
- [ ] CI no Linux (`npm test`): conferir o primeiro resultado no GitHub.
- [ ] `docs/desenvolvimento.md`: a tabela do processo principal (`main/`) não lista `fontes.js`, `linux.js` e os `razze-*`.
- [ ] Roadmap P1: reescrever com a ideia atual da equipe, mantendo a fase 2 (Hyperswarm) como prioridade.
- [ ] RazzeAPI: provavelmente será descartada. Até a decisão, não mexer nos testes `razze-*` nem em `razze-api/`.
- [ ] CODEOWNERS: quando a equipe dividir áreas (hoje todos mexem em tudo).
- [ ] Proteção da `main` (PR obrigatório, CI obrigatório): só depois do CI estável e combinando com o `publicar.js`,
      que faz push direto na `main`.
