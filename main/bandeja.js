'use strict';
// Ícone na bandeja do sistema (perto do relógio), como o do Discord. O X da janela esconde o app aqui em vez
// de fechar: a call e as janelas flutuantes continuam. Sair de verdade é pelo menu da bandeja.
// Mute e ensurdecer usam as mesmas mensagens dos atalhos globais (main/atalhos.js); "Procurar atualização"
// manda a página fazer a mesma busca do botão das configurações.
const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { janelas, sendMain } = require('./contexto');

let tray = null;
let inCall = false;
let hideWarned = false;
let quitting = false;
let actions = { restart: () => app.quit() };

// O menu, separado do Electron para dar para testar. Cada item tem um `id` que vira ação em buildMenu.
function menuModel({ version, call }) {
  return [
    { id: 'header', label: `Nebula ${version}`, enabled: false },
    { type: 'separator' },
    { id: 'open', label: 'Abrir o Nebula' },
    { id: 'update', label: 'Procurar atualização…' },
    { type: 'separator' },
    { id: 'mute', label: 'Mutar / desmutar microfone', enabled: call },
    { id: 'deafen', label: 'Ensurdecer / voltar a ouvir', enabled: call },
    { id: 'clip', label: 'Salvar clipe da transmissão', enabled: call },
    { type: 'separator' },
    { id: 'restart', label: 'Reiniciar o Nebula' },
    { id: 'quit', label: 'Sair do Nebula' },
  ];
}

function showMain() {
  const win = janelas.main;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quit() {
  quitting = true;
  // Fechar a janela leva ao window-all-closed do main.js, que encerra a sala, o áudio e o resto antes de sair
  const win = janelas.main;
  if (win && !win.isDestroyed()) win.close();
  else app.quit();
}

const RUN = {
  open: showMain,
  update: () => { showMain(); sendMain({ type: 'tray-update' }); },
  mute: () => sendMain({ type: 'mute-key' }),
  deafen: () => sendMain({ type: 'deafen-key' }),
  clip: () => sendMain({ type: 'clip-key' }),
  restart: () => actions.restart(),
  quit,
};

function buildMenu() {
  if (!tray) return;
  const icon = trayImage(16);
  const items = menuModel({ version: app.getVersion(), call: inCall }).map((item) => {
    const { id, ...opts } = item;
    if (id === 'header') return { ...opts, icon };
    return RUN[id] ? { ...opts, click: RUN[id] } : opts;
  });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

let themeIcon = null; // PNG da cor do tema, mandado pela página (setWindowIcon no main.js)
function trayImage(size) {
  const img = themeIcon || nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icone', 'tela-p2p.png'));
  return img.isEmpty() ? img : img.resize({ width: size, height: size, quality: 'best' });
}

function createTray(opts = {}) {
  if (tray) return tray;
  if (opts.restart) actions.restart = opts.restart;
  try {
    tray = new Tray(trayImage(process.platform === 'win32' ? 16 : 22));
  } catch (e) {
    // Linux sem área de notificação: sem bandeja, o X volta a fechar o app
    console.warn('Sem ícone na bandeja:', e.message);
    tray = null;
    return null;
  }
  tray.setToolTip('Nebula');
  tray.on('click', showMain);
  tray.on('double-click', showMain);
  buildMenu();
  return tray;
}

// Em call ou não (setRoomKeys): liga e desliga os itens de microfone
function setCall(on) {
  if (inCall === !!on) return;
  inCall = !!on;
  buildMenu();
}

function setTrayIcon(img) {
  themeIcon = img;
  if (!tray || tray.isDestroyed()) return;
  tray.setImage(trayImage(process.platform === 'win32' ? 16 : 22));
  buildMenu();
}

// Ligar no 'close' da janela principal: com a bandeja, o X esconde. Saindo de verdade (menu, atualização,
// reiniciar, desligar o PC), deixa fechar.
function hideOnClose(win) {
  win.on('session-end', () => { quitting = true; }); // Windows desligando ou saindo da conta
  win.on('close', (event) => {
    if (quitting || !tray || tray.isDestroyed()) return;
    event.preventDefault();
    win.hide();
    if (!hideWarned && process.platform === 'win32') {
      hideWarned = true;
      tray.displayBalloon({
        iconType: 'info',
        title: 'O Nebula continua aberto',
        content: 'Ele ficou aqui na bandeja. Para fechar de vez, clique com o botão direito no ícone e escolha Sair.',
      });
    }
  });
}

function setQuitting() { quitting = true; }

module.exports = { menuModel, createTray, setCall, setTrayIcon, hideOnClose, setQuitting };
