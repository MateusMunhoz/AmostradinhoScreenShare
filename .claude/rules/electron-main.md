---
paths:
  - "main.js"
  - "main/**"
  - "preload.js"
  - "boot.js"
  - "native/**"
  - "bin/**"
---

# Processo principal, preload, boot e nativos

- Janela principal com `contextIsolation: true` e `nodeIntegration: false`. Não afrouxe isso em janela nenhuma.
- IPC: `ipcMain.handle('nome', ...)` em `main.js` + função em `window.api` no `preload.js` (`ipcRenderer.invoke`).
  Trate todo argumento vindo da página como não confiável: converta e limite (`String(x || '')`, `Number(x) || 0`,
  `!!x`), como os handlers existentes fazem. Nunca exponha `ipcRenderer` cru nem caminhos/comandos livres.
- `main/janela-flutuante.js`, `main/chat-jogo.js` e `main/atalhos.js` dependem uns dos outros: cada um faz o
  `module.exports` **antes** dos `require` dos outros (senão o ciclo entrega objeto vazio).
- `boot.js` não vai na atualização assinada: só muda com `.exe` novo. Tem a chave pública que valida as atualizações —
  nunca a troque. Mudança aqui ou na versão do Electron: avise no PR.
- `main.js` e `main/` vão na atualização: arquivo novo em `main/` entra em `PACK_FILES` (`publicar.js`).
- RazzeAPI no cliente: token e identidade WireGuard protegidos com `safeStorage`; cliente HTTP exige HTTPS fora de
  localhost. O ajudante elevado (`main/razze-ajudante.js`, `main/razze-privilegiado.js`) aceita poucos pedidos
  fixos sobre túneis `Razze…`: não amplie o que ele aceita sem plano aprovado.
- `main/celular.js` (configurações no celular) abre um servidor HTTP em `0.0.0.0` só enquanto o QR está aberto: chave de
  uso único no caminho, 5 minutos, um download ou um envio de até 4 MB, e fecha. Não deixe ele servir nada além da
  página e do arquivo, nem ficar aberto sem a janela do QR. A cifra é feita no renderer; a página do celular não tem cripto.
- Nativos (`native/*.cpp`) são só Windows e compilam com `native\build.cmd` (VS Build Tools). Os `.exe` em `bin/` são
  versionados e vão no pacote; o CI não compila. No Linux, `main/linux.js` faz o papel deles.
