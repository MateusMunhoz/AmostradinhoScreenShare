// Chat por cima do jogo: a janela transparente, a posição guardada e o modo de escrever (Ctrl+Enter).
const { app, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { janelas, sendMain } = require('./contexto');

// ---------- Chat por cima do jogo ----------
// Janela transparente, sempre por cima, sem foco e com o clique atravessando (menos no modo de ajuste).
// Ctrl+Shift+O esconde e mostra, de dentro do jogo. Lembra a posição e o tamanho.

// Ctrl+Enter, de dentro do jogo: o chat por cima do jogo pega o teclado só para escrever uma mensagem.
// Enter manda, Esc cancela, e nos dois casos o teclado volta para o jogo. Vale enquanto você está numa sala.
let composeOnOpen = false;
function setChatCompose(on) {
  janelas.chatCompose = !!on;
  if (janelas.chat && !janelas.chat.isDestroyed()) {
    if (janelas.chatCompose) {
      janelas.chat.setIgnoreMouseEvents(false);
      janelas.chat.setFocusable(true);
      if (!janelas.chat.isVisible()) janelas.chat.show();
      janelas.chat.focus();
    } else {
      if (!janelas.pipEdit) {
        janelas.chat.setIgnoreMouseEvents(true);
        janelas.chat.setFocusable(false);
      }
      janelas.chat.blur(); // o teclado volta para a janela que estava ativa (o jogo)
    }
  }
  sendMain({ type: 'compose', on: janelas.chatCompose });
}
const chatFile = () => path.join(app.getPath('userData'), 'janela-chat.json');
function chatBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(chatFile(), 'utf8'));
    const ok = ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) && b.width >= 240 && b.height >= 140;
    const visible = ok && screen.getAllDisplays().some(({ workArea: w }) =>
      b.x < w.x + w.width - 40 && b.x + b.width > w.x + 40 && b.y < w.y + w.height - 40 && b.y + b.height > w.y + 40);
    if (visible) return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {}
  const wa = screen.getPrimaryDisplay().workArea;
  return { width: 380, height: 300, x: wa.x + 24, y: wa.y + wa.height - 300 - 24 };
}
function setupChatOverlay(child) {
  janelas.chat = child;
  child.setAlwaysOnTop(true, 'screen-saver');
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (!child.isDestroyed()) fs.writeFile(chatFile(), JSON.stringify(child.getBounds()), () => {}); }, 400);
  };
  child.on('moved', save);
  child.on('resized', save);
  syncShortcuts();
  child.on('closed', () => {
    if (janelas.chat === child) janelas.chat = null;
    janelas.chatCompose = false;
    syncShortcuts();
    sendMain({ type: 'chat-closed' });
  });
  // Aberto pelo Ctrl+Enter: já vai direto para escrever; pelo botão: abre no modo de ajuste (posicione e trave)
  if (composeOnOpen) {
    composeOnOpen = false;
    setChatCompose(true);
  } else {
    setPipEdit(true);
  }
}

// Pedido da página: ligar ou desligar o modo de escrever, ou avisar que a janela vai abrir agora
// (aí ela já nasce pronta para escrever)
function chatComposeRequest(on, opening) {
  if (opening) composeOnOpen = true;
  else setChatCompose(!!on);
}

// Exportado antes dos require de baixo: atalhos.js também usa este arquivo
Object.assign(module.exports, { setChatCompose, chatBounds, setupChatOverlay, chatComposeRequest });
const { setPipEdit } = require('./janela-flutuante');
const { syncShortcuts } = require('./atalhos');
