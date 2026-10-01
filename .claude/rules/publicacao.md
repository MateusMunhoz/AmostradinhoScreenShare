---
paths:
  - "publicar.js"
  - "github.js"
  - "icone-exe.js"
  - "gerar-icone.js"
  - "package.json"
  - "linux/**"
  - ".github/**"
---

# Publicação e build

- Agente nunca roda `npm run publicar`, `node publicar.js` (nem `--gerar-chave`), `git push`, `git tag` ou `gh release`.
  Publicar é de um humano: veja "Publicar uma versão" em `docs/desenvolvimento.md`.
- `publicar.js` sobe a versão, assina o pacote com a chave de `~/.tela-p2p/`, gera o `.exe` e faz commit, push na `main`,
  tag e Release. A versão do `package.json` muda só por ele.
- `PACK_FILES` (`publicar.js`) e `build.files` (`package.json`) andam juntos. O CI confere que tudo que o `index.html`
  carrega está nos dois.
- `github.js` só aceita downloads de `https://github.com/`; o `boot.js` confere a assinatura antes de instalar. Não
  enfraqueça nenhum dos dois.
- Mudar a versão do Electron obriga todo mundo a baixar o `.exe` novo: só com decisão da equipe.
- `.github/workflows/`: só comandos que existem no `package.json`; testes que precisam de Windows, janelas ou rede real
  não entram no job obrigatório.
