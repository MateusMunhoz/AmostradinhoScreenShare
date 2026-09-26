const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { startServer, stopServer } = require('./signaling');
const github = require('./github');
const {
  BIN, AUDIOCAP, setPriority, stopPriority, startStats, stopStats, probeVideoCap, startVideoCap, stopVideoCap,
  videoCapCommand, startAppAudio, stopAppAudio,
} = require('./main/nativos');

// Usa os IPs reais (26.x da Radmin) nos candidatos WebRTC em vez de endereços .local.
// No Windows 10, a captura moderna do Windows (a que o Chromium usa) desenha uma borda amarela em volta
// do que está sendo transmitido, e lá não dá para tirar. Desligada, o Chromium usa as capturas antigas:
// Duplicação da Área de Trabalho para a tela inteira e GDI para janelas, as duas sem borda.
// (TELA_P2P_WIN10=1 simula o Windows 10, para testar no Windows 11)
const WIN10 = process.platform === 'win32' && (Number(os.release().split('.')[2]) < 22000 || process.env.TELA_P2P_WIN10 === '1');
const disabledFeatures = ['WebRtcHideLocalIpsWithMdns'];
if (WIN10) disabledFeatures.push('AllowWgcScreenCapturer', 'AllowWgcWindowCapturer');
app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
// Cancelamento de eco do app inteiro: o filtro do microfone usa como referência tudo que o app toca
// (as vozes, que saem pelo mixer, e o som das transmissões), não só o som de elementos <audio>
app.commandLine.appendSwitch('enable-features', 'ChromeWideEchoCancellation');
// Deixa o vídeo do host tocar com som sem precisar clicar
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Com a janela minimizada, o Chromium joga a página para prioridade ociosa e modo de eficiência.
// Quem assiste enquanto joga ficava com o som picotando e respondendo atrasado a quem transmite,
// que então baixava a qualidade achando que a internet estava ruim.
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let selectedSourceId = null;
let captureSystemAudio = true;

// Atualizações pela sala (boot.js). Sem ele (ex.: "electron main.js"), o app só não se atualiza.
const updater = global.updater || {
  version: app.getVersion(), readCurrentPack: () => null, install: () => ({ ok: false, error: 'sem boot.js' }),
  started: () => {}, restart: () => { app.relaunch(); app.exit(0); },
};

const OWN_EXES = ['electron.exe', 'tela p2p.exe', 'audiocap.exe', path.basename(process.execPath).toLowerCase()];

// Processos do Windows e de drivers que usam som, mas que ninguém quer ignorar (só poluem a lista)
const HIDDEN_AUDIO_EXES = [
  'nvcontainer.exe', 'nvidia overlay.exe', 'nvidia share.exe', 'nvsphelper64.exe', 'audiodg.exe',
  'svchost.exe', 'explorer.exe', 'shellexperiencehost.exe', 'startmenuexperiencehost.exe', 'searchhost.exe',
  'runtimebroker.exe', 'systemsettings.exe', 'textinputhost.exe', 'rundll32.exe', 'dllhost.exe', 'lockapp.exe',
];

// Overlays que aparecem como janelas, mas sempre pretas
const HIDDEN_SOURCES = /^NVIDIA GeForce Overlay/i;

// Miniatura toda preta: a janela não deixa ser capturada (ex.: apps de administrador) ou está minimizada
function looksBlack(img) {
  const px = img.toBitmap();
  for (let i = 0; i < px.length; i += 4 * 97) if (px[i] > 12 || px[i + 1] > 12 || px[i + 2] > 12) return false;
  return true;
}

// Atualizações mais velhas que a versão que está rodando nunca mais são usadas: apaga as pastas
// (cada uma tem uma cópia do app e dos ajudantes audiocap.exe e videocap.exe)
function cleanOldUpdates() {
  const dir = path.join(app.getPath('userData'), 'atualizacoes');
  const parts = (v) => v.split('.').map(Number);
  const older = (a, b) => {
    const pa = parts(a), pb = parts(b);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i];
    return false;
  };
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const v of names) {
    if (!/^\d+\.\d+\.\d+$/.test(v) || !older(v, updater.version)) continue;
    fs.rm(path.join(dir, v), { recursive: true, force: true }, () => {});
  }
}

// ---------- Janela flutuante (picture in picture) ----------
// Cada transmissão pode ir para a sua janela pequena, sempre por cima (inclusive de jogo em tela cheia sem
// bordas). Travadas, o mouse passa por elas (o clique vai para o jogo) e elas nunca pegam o foco. No modo de
// ajuste dá para arrastar e redimensionar. Ctrl+Shift+E troca todas entre os dois, de dentro do jogo.
// Cada vaga (1ª, 2ª, 3ª janela aberta...) lembra a própria posição, tamanho e transparência.
let mainWin = null;
const pips = new Map(); // id da transmissão -> { win, slot, opacity }
let pipEdit = false;
const pipFile = () => path.join(app.getPath('userData'), 'janela-flutuante.json');

// Arquivo: { slots: [{ x, y, width, height, opacity }, ...], group }. O formato antigo (uma janela só) vira a vaga 0.
// group: linked = todas do mesmo tamanho (mexer numa muda todas e reorganiza); layout 'coluna' ou 'linha';
// corner = canto da tela onde a fila começa (tl, tr, bl, br).
function readPipFile() {
  try {
    const data = JSON.parse(fs.readFileSync(pipFile(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}
let pipSlots = null;
const slots = () => (pipSlots ??= (() => { const d = readPipFile(); return Array.isArray(d.slots) ? d.slots : d.width ? [d] : []; })());
let pipGroup = null;
const group = () => (pipGroup ??= (() => {
  const g = readPipFile().group || {};
  return {
    linked: !!g.linked,
    layout: g.layout === 'linha' ? 'linha' : 'coluna',
    corner: ['tl', 'tr', 'bl', 'br'].includes(g.corner) ? g.corner : 'br',
  };
})());

// Última posição e tamanho da vaga, se ainda couber numa das telas; senão, empilhadas a partir do canto de
// baixo à direita (subindo, e depois numa coluna mais à esquerda)
function pipBounds(slot) {
  const b = slots()[slot];
  const ok = b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) && b.width >= 192 && b.height >= 108;
  const visible = ok && screen.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width - 40 && b.x + b.width > w.x + 40 && b.y < w.y + w.height - 40 && b.y + b.height > w.y + 40);
  if (visible) return { x: b.x, y: b.y, width: b.width, height: b.height };
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 480, height = 270, gap = 12;
  const perCol = Math.max(1, Math.floor((wa.height - 24) / (height + gap)));
  const col = Math.floor(slot / perCol), row = slot % perCol;
  return {
    width, height,
    x: Math.max(wa.x, wa.x + wa.width - 24 - width - col * (width + gap)),
    y: wa.y + wa.height - 24 - height - row * (height + gap),
  };
}

function freeSlot() {
  const used = new Set([...pips.values()].map((p) => p.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  return slot;
}

function sendMain(msg) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('pip', msg);
}

const livePip = (id) => { const p = pips.get(String(id)); return p && !p.win.isDestroyed() ? p : null; };

// Tamanhos rápidos (P, M, G) mantendo o canto de baixo à direita no lugar
const PIP_SIZES = { P: 320, M: 480, G: 640 };
function setPipSize(id, key) {
  const p = livePip(id);
  if (!p || !PIP_SIZES[key]) return;
  const b = p.win.getBounds();
  const width = PIP_SIZES[key];
  const height = Math.round(width * 9 / 16);
  markArranging();
  p.win.setBounds({ x: b.x + b.width - width, y: b.y + b.height - height, width, height });
  if (group().linked) arrangePips(id);
}

// Mudanças feitas pelo app (não pelo mouse) não disparam uma nova arrumação
let arrangingUntil = 0;
const markArranging = () => { arrangingUntil = Date.now() + 500; };

// Enfileira as janelas a partir do canto escolhido, em coluna ou em linha, sem uma cobrir a outra.
// Quando a fila não cabe na tela, continua numa coluna (ou linha) ao lado. Com "todas do mesmo tamanho",
// todas ficam do tamanho da janela que você mexeu.
function arrangePips(anchorId) {
  const list = [...pips.values()].filter((p) => !p.win.isDestroyed()).sort((a, b) => a.slot - b.slot);
  if (!list.length) return;
  const anchor = livePip(anchorId) || list[0];
  const g = group();
  const ab = anchor.win.getBounds();
  const wa = screen.getDisplayMatching(ab).workArea;
  const margin = 24, gap = 12;
  const right = g.corner.endsWith('r'), bottom = g.corner.startsWith('b');
  let along = 0, across = 0, acrossMax = 0;
  markArranging();
  for (const p of list) {
    const own = p.win.getBounds();
    const w = g.linked ? ab.width : own.width;
    const h = g.linked ? ab.height : own.height;
    let dx, dy;
    if (g.layout === 'coluna') {
      if (along > 0 && along + h > wa.height - 2 * margin) { across += acrossMax + gap; along = 0; acrossMax = 0; }
      dx = across; dy = along; along += h + gap; acrossMax = Math.max(acrossMax, w);
    } else {
      if (along > 0 && along + w > wa.width - 2 * margin) { across += acrossMax + gap; along = 0; acrossMax = 0; }
      dx = along; dy = across; along += w + gap; acrossMax = Math.max(acrossMax, h);
    }
    p.win.setBounds({
      width: w, height: h,
      x: right ? wa.x + wa.width - margin - w - dx : wa.x + margin + dx,
      y: bottom ? wa.y + wa.height - margin - h - dy : wa.y + margin + dy,
    });
  }
  for (const p of list) savePip(p);
}

function setPipGroup(id, patch) {
  const g = group();
  if (patch && typeof patch === 'object') {
    if (typeof patch.linked === 'boolean') g.linked = patch.linked;
    if (patch.layout === 'coluna' || patch.layout === 'linha') g.layout = patch.layout;
    if (['tl', 'tr', 'bl', 'br'].includes(patch.corner)) g.corner = patch.corner;
  }
  // Ligar "mesmo tamanho" ou escolher arrumação/canto já arruma na hora
  if (patch && (patch.linked === true || patch.layout || patch.corner)) arrangePips(id);
  else savePipFile();
  sendMain({ type: 'group', group: g });
}

function setPipOpacity(id, v) {
  const p = livePip(id);
  if (!p) return;
  p.opacity = Math.min(1, Math.max(0.4, Number(v) || 1));
  p.win.setOpacity(p.opacity);
  savePip(p);
}

function savePip(p) {
  if (p.win.isDestroyed()) return;
  const list = slots();
  list[p.slot] = { ...p.win.getBounds(), opacity: p.opacity };
  for (let i = 0; i < list.length; i++) list[i] ??= {};
  savePipFile();
}

let pipSaveTimer = null;
function savePipFile() {
  clearTimeout(pipSaveTimer);
  pipSaveTimer = setTimeout(() => fs.writeFile(pipFile(), JSON.stringify({ slots: slots(), group: group() }), () => {}), 50);
}

function pipOpacities() {
  const out = {};
  for (const [id, p] of pips) out[id] = p.opacity;
  return out;
}

function setPipEdit(on) {
  pipEdit = !!on;
  for (const p of pips.values()) {
    if (!p.win.isDestroyed()) p.win.setIgnoreMouseEvents(!pipEdit); // travada: o clique atravessa
  }
  // O chat por cima do jogo entra e sai do modo de ajuste junto; só nele recebe o teclado (para responder)
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.setIgnoreMouseEvents(!pipEdit && !chatCompose);
    chatWin.setFocusable(pipEdit || chatCompose);
  }
  sendMain({ type: 'edit', on: pipEdit, opacity: pipOpacities(), group: group() });
}

// ---------- Atalhos (dá para trocar em "Voz e atalhos") ----------
// Cada atalho só fica registrado enquanto faz sentido: ajustar as janelas enquanto houver janela
// flutuante ou chat por cima do jogo; esconder o chat enquanto ele existir; escrever no chat e ligar/desligar
// o microfone enquanto você estiver numa sala. Fora disso, a tecla fica livre para os outros programas.
const DEFAULT_KEYS = {
  edit: 'CommandOrControl+Shift+E',
  hideChat: 'CommandOrControl+Shift+O',
  compose: 'CommandOrControl+Enter',
  mute: 'CommandOrControl+Shift+M',
};
const keysFile = () => path.join(app.getPath('userData'), 'atalhos.json');
let shortcutKeys = null;
function keys() {
  if (!shortcutKeys) {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(keysFile(), 'utf8')) || {}; } catch {}
    shortcutKeys = { ...DEFAULT_KEYS };
    for (const k of Object.keys(DEFAULT_KEYS)) if (typeof saved[k] === 'string') shortcutKeys[k] = saved[k];
  }
  return shortcutKeys;
}
let roomKeysOn = false;
const chatOpen = () => !!(chatWin && !chatWin.isDestroyed());
const ACTIONS = {
  edit: { active: () => pips.size > 0 || chatOpen(), run: () => setPipEdit(!pipEdit) },
  hideChat: {
    active: chatOpen,
    run: () => {
      if (!chatOpen()) return;
      if (chatWin.isVisible()) chatWin.hide();
      else chatWin.showInactive();
    },
  },
  compose: { active: () => roomKeysOn, run: () => sendMain({ type: 'compose-key' }) },
  mute: { active: () => roomKeysOn, run: () => sendMain({ type: 'mute-key' }) },
};
const registered = {}; // ação -> atalho registrado agora
const busyWarned = {};
function syncShortcuts() {
  for (const [action, a] of Object.entries(ACTIONS)) {
    const want = a.active() ? keys()[action] : '';
    if (registered[action] === want) continue;
    if (registered[action]) globalShortcut.unregister(registered[action]);
    registered[action] = '';
    if (!want) continue;
    let ok = false;
    try { ok = globalShortcut.register(want, a.run); } catch { ok = false; }
    if (ok) { registered[action] = want; busyWarned[action] = ''; }
    else if (busyWarned[action] !== want) { busyWarned[action] = want; sendMain({ type: 'shortcut-busy', action, accel: want }); }
  }
}
// Troca um atalho: testa o novo (outro programa pode estar usando) e só então guarda
function setShortcut(action, accel) {
  if (!ACTIONS[action] || typeof accel !== 'string' || accel.length > 60) return { ok: false, error: 'Atalho inválido.' };
  const clash = Object.entries(keys()).find(([k, v]) => k !== action && v && v === accel);
  if (clash) return { ok: false, error: 'Esse atalho já é usado por outra ação do app.' };
  if (accel) {
    const mine = Object.values(registered).includes(accel);
    if (!mine) {
      let ok = false;
      try { ok = globalShortcut.register(accel, () => {}); } catch { return { ok: false, error: 'Essa combinação não pode ser usada como atalho.' }; }
      if (!ok) return { ok: false, error: 'Outro programa já usa essa combinação.' };
      globalShortcut.unregister(accel);
    }
  }
  keys()[action] = accel;
  fs.writeFile(keysFile(), JSON.stringify(keys()), () => {});
  syncShortcuts();
  return { ok: true, keys: keys() };
}

// ---------- Chat por cima do jogo ----------
// Janela transparente, sempre por cima, sem foco e com o clique atravessando (menos no modo de ajuste).
// Ctrl+Shift+O esconde e mostra, de dentro do jogo. Lembra a posição e o tamanho.
let chatWin = null;

// Ctrl+Enter, de dentro do jogo: o chat por cima do jogo pega o teclado só para escrever uma mensagem.
// Enter manda, Esc cancela, e nos dois casos o teclado volta para o jogo. Vale enquanto você está numa sala.
let chatCompose = false;
let composeOnOpen = false;
function setRoomKeys(on) {
  roomKeysOn = !!on;
  syncShortcuts();
  if (!on) {
    if (chatCompose) setChatCompose(false);
    setPtt(0);
  }
}

// ---------- Apertar para falar ----------
// teclas.exe avisa quando a tecla (ou botão do mouse) escolhida é apertada e solta; a página liga o
// microfone só enquanto ela está apertada.
const TECLAS = path.join(BIN, 'teclas.exe');
let pttProc = null;
let pttVk = 0;
function setPtt(vk) {
  vk = Number(vk) || 0;
  if (vk === pttVk && (vk === 0 || pttProc)) return true;
  if (pttProc) { const p = pttProc; pttProc = null; try { p.stdin.end(); p.kill(); } catch {} }
  pttVk = 0;
  if (!vk || vk < 1 || vk > 255) return true;
  if (!fs.existsSync(TECLAS)) return false;
  const proc = spawn(TECLAS, [String(vk)], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  pttProc = proc;
  pttVk = vk;
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('down ')) sendMain({ type: 'ptt', down: true });
      else if (line.startsWith('up ')) sendMain({ type: 'ptt', down: false });
    }
  });
  proc.on('exit', () => { if (pttProc === proc) { pttProc = null; pttVk = 0; sendMain({ type: 'ptt', down: false }); } });
  return true;
}
function setChatCompose(on) {
  chatCompose = !!on;
  if (chatWin && !chatWin.isDestroyed()) {
    if (chatCompose) {
      chatWin.setIgnoreMouseEvents(false);
      chatWin.setFocusable(true);
      if (!chatWin.isVisible()) chatWin.show();
      chatWin.focus();
    } else {
      if (!pipEdit) {
        chatWin.setIgnoreMouseEvents(true);
        chatWin.setFocusable(false);
      }
      chatWin.blur(); // o teclado volta para a janela que estava ativa (o jogo)
    }
  }
  sendMain({ type: 'compose', on: chatCompose });
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
  chatWin = child;
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
    if (chatWin === child) chatWin = null;
    chatCompose = false;
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

function setupPip(child, id, slot) {
  const saved = slots()[slot];
  const p = { win: child, slot, opacity: Math.min(1, Math.max(0.4, Number(saved && saved.opacity) || 1)) };
  pips.set(id, p);
  child.setAlwaysOnTop(true, 'screen-saver');
  child.setAspectRatio(16 / 9);
  child.setOpacity(p.opacity);
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePip(p), 400);
  };
  child.on('moved', save);
  child.on('resized', () => {
    save();
    // Com "todas do mesmo tamanho", redimensionar uma com o mouse muda todas e reorganiza a fila
    if (group().linked && Date.now() > arrangingUntil) arrangePips(id);
  });
  // Nova janela com "todas do mesmo tamanho": entra na fila com o tamanho das outras
  if (group().linked && pips.size > 1) {
    const other = [...pips.values()].find((o) => o !== p && !o.win.isDestroyed());
    if (other) arrangePips([...pips].find(([, o]) => o === other)[0]);
  }
  syncShortcuts();
  child.on('closed', () => {
    if (pips.get(id) === p) pips.delete(id);
    syncShortcuts();
    sendMain({ type: 'closed', id });
  });
  setPipEdit(true); // abre no modo de ajuste (todas juntas): posicione e trave
}

// Reabre o app depois de instalar uma atualização. O .exe portátil apaga a pasta temporária quando
// fecha, então o novo só abre depois de 2 s, por um cmd separado. Antes, o Node escapava as aspas do
// caminho ("Tela P2P.exe" tem espaço) com \", que o cmd não entende: o comando falhava calado e o app
// não voltava. Com os argumentos literais, o cmd recebe as aspas como estão.
function relaunch() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!exe) {
    app.relaunch();
    app.exit(0);
    return;
  }
  spawn('cmd.exe', ['/d', '/s', '/c', `"ping -n 3 127.0.0.1 >nul & start "" "${exe}""`], {
    detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
  }).unref();
  app.quit();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#22271E',
    autoHideMenuBar: true,
    title: 'Tela P2P',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.once('did-finish-load', () => {
    updater.started();
    cleanOldUpdates();
  });
  mainWin = win;
  // A única janela que a página pode abrir é a flutuante (uma por transmissão, "tela-pip-<id>"); ela nasce
  // sem moldura, por cima e sem foco
  const pipId = (frameName) => (/^tela-pip-([\w-]{1,40})$/.exec(frameName) || [])[1];
  const opening = new Map(); // id -> vaga escolhida ao abrir
  win.webContents.setWindowOpenHandler(({ frameName }) => {
    if (frameName === 'tela-chat') {
      if (chatWin && !chatWin.isDestroyed()) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...chatBounds(), minWidth: 240, minHeight: 140,
          frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true,
          focusable: false, resizable: true, minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
          title: 'Tela P2P · chat da sala',
        },
      };
    }
    const id = pipId(frameName);
    if (!id || livePip(id)) return { action: 'deny' };
    const slot = freeSlot();
    opening.set(id, slot);
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...pipBounds(slot), minWidth: 192, minHeight: 108,
        frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: true,
        minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
        backgroundColor: '#000000', title: 'Tela P2P · janela flutuante',
      },
    };
  });
  win.webContents.on('did-create-window', (child, { frameName }) => {
    if (frameName === 'tela-chat') return setupChatOverlay(child);
    const id = pipId(frameName);
    if (!id) return;
    const slot = opening.has(id) ? opening.get(id) : freeSlot();
    opening.delete(id);
    setupPip(child, id, slot);
  });
  win.on('closed', () => {
    for (const p of pips.values()) if (!p.win.isDestroyed()) p.win.close();
    if (chatWin && !chatWin.isDestroyed()) chatWin.close();
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  // Quando a página pede getDisplayMedia, entregamos a tela escolhida + áudio do sistema
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const source = sources.find((s) => s.id === selectedSourceId) || sources[0];
    callback(captureSystemAudio ? { video: source, audio: 'loopback' } : { video: source });
  });

  ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
    return sources
      .filter((s) => !s.thumbnail.isEmpty() && !own.has(s.id) && !HIDDEN_SOURCES.test(s.name))
      .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL(), dark: looksBlack(s.thumbnail) }))
      .sort((a, b) => a.dark - b.dark); // as pretas vão para o fim, na mesma ordem
  });

  ipcMain.handle('select-source', (_e, id, withSystemAudio) => {
    selectedSourceId = id;
    captureSystemAudio = withSystemAudio !== false;
  });

  ipcMain.handle('list-audio-apps', () => new Promise((resolve) => {
    execFile(AUDIOCAP, ['--list'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([]);
      // Cada linha: "Discord.exe<TAB>Discord"
      const apps = stdout.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
        const [exe, name] = line.split('\t').map((s) => (s || '').trim());
        return { exe, name: name || exe.replace(/\.exe$/i, '') };
      }).filter((a) => a.exe && !OWN_EXES.includes(a.exe.toLowerCase()) && !HIDDEN_AUDIO_EXES.includes(a.exe.toLowerCase()));
      resolve(apps);
    });
  }));

  ipcMain.handle('start-app-audio', (e, exes) => startAppAudio(e.sender, exes));
  ipcMain.handle('videocap-probe', () => probeVideoCap());
  ipcMain.handle('videocap-start', (e, opts) => startVideoCap(e.sender, opts));
  ipcMain.handle('videocap-stop', () => stopVideoCap());
  ipcMain.handle('videocap-cmd', (_e, cmd) => {
    if (cmd === 'key' || cmd === 'pause' || cmd === 'resume' || /^bitrate \d{5,9}$/.test(cmd)) videoCapCommand(cmd);
  });
  ipcMain.handle('stop-app-audio', () => stopAppAudio());

  ipcMain.handle('get-ips', () => {
    const list = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
      for (const a of addrs || []) {
        const v4 = a.family === 'IPv4' || a.family === 4;
        if (v4 && !a.internal) list.push({ name, address: a.address, radmin: a.address.startsWith('26.') });
      }
    }
    return list.sort((a, b) => b.radmin - a.radmin);
  });

  setPriority('above'); // a página manda a escolha salva assim que abre
  ipcMain.handle('set-priority', (_e, level) => setPriority(level));
  ipcMain.handle('stats-start', (e) => startStats(e.sender));
  ipcMain.handle('stats-stop', () => stopStats());

  ipcMain.handle('get-version', () => updater.version);
  ipcMain.handle('get-own-pack', () => updater.readCurrentPack());
  ipcMain.handle('install-update', (_e, pack, sig) => updater.install(pack, sig));
  ipcMain.handle('github-check', () => github.check());
  ipcMain.handle('github-install', () => github.install(updater));
  ipcMain.handle('open-github', (_e, url) => github.openPage(url));
  ipcMain.handle('pip-edit', (_e, on) => setPipEdit(on));
  ipcMain.handle('pip-size', (_e, id, key) => setPipSize(id, key));
  ipcMain.handle('pip-opacity', (_e, id, v) => setPipOpacity(id, v));
  ipcMain.handle('pip-group', (_e, id, patch) => setPipGroup(id, patch));
  ipcMain.handle('room-keys', (_e, on) => setRoomKeys(!!on));
  ipcMain.handle('get-shortcuts', () => ({ ...keys() }));
  ipcMain.handle('set-shortcut', (_e, action, accel) => setShortcut(String(action), accel));
  ipcMain.handle('ptt', (_e, vk) => setPtt(vk));
  // Supressão de ruído com IA (RNNoise): o .wasm vem daqui, a página não precisa ler arquivos
  ipcMain.handle('noise-wasm', (_e, simd) => {
    try { return fs.readFileSync(path.join(__dirname, 'vendor', 'noise', simd ? 'rnnoise_simd.wasm' : 'rnnoise.wasm')); } catch { return null; }
  });
  ipcMain.handle('chat-compose', (_e, on, opening) => {
    if (opening) composeOnOpen = true; // a janela vai abrir agora: ela já nasce pronta para escrever
    else setChatCompose(!!on);
  });
  ipcMain.handle('open-link', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('restart-app', () => {
    stopServer();
    stopAppAudio();
    stopVideoCap();
    stopPriority();
    relaunch();
  });

  ipcMain.handle('start-server', (_e, port, password, seed) => startServer(port, password, seed || {}));
  ipcMain.handle('stop-server', (_e, endRoom) => stopServer({ endRoom: !!endRoom }));

  createWindow();
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); setPtt(0); });

app.on('window-all-closed', () => {
  stopServer();
  stopAppAudio();
  stopVideoCap();
  stopStats();
  stopPriority();
  app.quit();
});
