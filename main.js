const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { startServer, stopServer } = require('./signaling');
const github = require('./github');

// Usa os IPs reais (26.x da Radmin) nos candidatos WebRTC em vez de endereços .local.
// No Windows 10, a captura moderna do Windows (a que o Chromium usa) desenha uma borda amarela em volta
// do que está sendo transmitido, e lá não dá para tirar. Desligada, o Chromium usa as capturas antigas:
// Duplicação da Área de Trabalho para a tela inteira e GDI para janelas, as duas sem borda.
// (TELA_P2P_WIN10=1 simula o Windows 10, para testar no Windows 11)
const WIN10 = process.platform === 'win32' && (Number(os.release().split('.')[2]) < 22000 || process.env.TELA_P2P_WIN10 === '1');
const disabledFeatures = ['WebRtcHideLocalIpsWithMdns'];
if (WIN10) disabledFeatures.push('AllowWgcScreenCapturer', 'AllowWgcWindowCapturer');
app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
// Deixa o vídeo do host tocar com som sem precisar clicar
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Com a janela minimizada, o Chromium joga a página para prioridade ociosa e modo de eficiência.
// Quem assiste enquanto joga ficava com o som picotando e respondendo atrasado a quem transmite,
// que então baixava a qualidade achando que a internet estava ruim.
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let selectedSourceId = null;
let captureSystemAudio = true;
let audioProc = null;

// Ajudantes nativos (som e NVENC). Vêm junto das atualizações; no .exe ficam fora do .asar.
const BIN = fs.existsSync(path.join(__dirname, 'bin', 'audiocap.exe'))
  ? path.join(__dirname, 'bin')
  : path.join(process.resourcesPath, 'bin');
const AUDIOCAP = path.join(BIN, 'audiocap.exe');
const VIDEOCAP = path.join(BIN, 'videocap.exe');

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

// Prioridade de todos os processos do app (o capturador cuida disso enquanto o app estiver aberto)
const PRIORITIES = ['normal', 'above', 'high'];
let boostProc = null;

function setPriority(level) {
  if (!PRIORITIES.includes(level)) level = 'above';
  if (boostProc) boostProc.kill();
  try {
    const proc = spawn(AUDIOCAP, ['--boost', level, String(process.pid)], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    proc.on('error', (err) => console.warn('Não foi possível ajustar a prioridade:', err.message));
    proc.on('exit', () => { if (boostProc === proc) boostProc = null; });
    boostProc = proc;
  } catch (err) {
    console.warn('Não foi possível ajustar a prioridade:', err.message);
  }
}

// Tela de Estatísticas: o capturador mede processador e placa de vídeo de cada processo do app
let statsProc = null;

// O que cada processo do Chromium faz, para a tabela ficar legível
function processLabels() {
  const labels = new Map();
  for (const m of app.getAppMetrics()) {
    const svc = m.serviceName || '';
    const label = m.type === 'Browser' ? 'Principal (captura a tela)'
      : m.type === 'GPU' ? 'Placa de vídeo (desenha e decodifica)'
      : m.type === 'Tab' ? 'Página (codifica o vídeo)'
      : /Network/.test(svc) ? 'Rede'
      : /Audio/.test(svc) ? 'Áudio'
      : /VideoCapture/.test(svc) ? 'Captura de vídeo'
      : `Outro (${m.type})`;
    labels.set(m.pid, label);
  }
  if (videoProc) labels.set(videoProc.pid, 'Captura e NVENC');
  return labels;
}

function startStats(sender) {
  stopStats();
  let proc;
  try {
    proc = spawn(AUDIOCAP, ['--stats', String(process.pid)], { windowsHide: true });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  statsProc = proc;
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let s;
      try { s = JSON.parse(line); } catch { continue; }
      const labels = processLabels();
      s.procs = s.procs.filter((p) => p.name.toLowerCase() !== 'conhost.exe'); // console do Windows dos ajudantes
      for (const p of s.procs) p.label = labels.get(p.pid) || (p.name === 'audiocap.exe' ? 'Ajudante (som, prioridade, estatísticas)' : p.name);
      if (!sender.isDestroyed()) sender.send('stats', s);
    }
  });
  proc.on('error', () => {});
  proc.on('exit', () => { if (statsProc === proc) statsProc = null; });
  return { ok: true };
}

function stopStats() {
  if (statsProc) statsProc.kill();
  statsProc = null;
}

// ---------- NVENC direto (videocap.exe) ----------
// Captura a tela pelo Windows e codifica no NVENC sem a imagem sair da placa. O vídeo pronto
// (H.264) vai para a página, que manda o mesmo para todos no modo "uma vez só".
let videoProc = null;
let videoProbe = null;

function probeVideoCap() {
  if (!videoProbe) {
    videoProbe = new Promise((resolve) => {
      if (!fs.existsSync(VIDEOCAP)) return resolve({ nvenc: false, error: 'videocap.exe não encontrado' });
      execFile(VIDEOCAP, ['--probe'], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
        try { resolve(JSON.parse(stdout)); } catch { resolve({ nvenc: false, error: err ? err.message : 'resposta inválida' }); }
      });
    });
  }
  return videoProbe;
}

// Id do desktopCapturer -> o que o videocap entende: "window:<HWND>:0" ou "screen:<id>:0"
async function captureTarget(sourceId) {
  const win = /^window:(\d+):/.exec(sourceId || '');
  if (win) return ['--window', win[1]];
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const src = sources.find((s) => s.id === sourceId);
  const display = screen.getAllDisplays().find((d) => src && String(d.id) === src.display_id) || screen.getPrimaryDisplay();
  const center = { x: Math.round(display.bounds.x + display.bounds.width / 2), y: Math.round(display.bounds.y + display.bounds.height / 2) };
  const p = screen.dipToScreenPoint(center); // pixels físicos
  return ['--monitor', `${Math.round(p.x)},${Math.round(p.y)}`];
}

function stopVideoCap() {
  if (!videoProc) return;
  const proc = videoProc;
  videoProc = null;
  proc.stdout.removeAllListeners('data');
  proc.stdin.end();
  setTimeout(() => { if (proc.exitCode === null) proc.kill(); }, 1000);
}

async function startVideoCap(sender, opts) {
  stopVideoCap();
  const probe = await probeVideoCap();
  if (!probe.nvenc) return { ok: false, error: probe.error };
  const o = opts || {};
  const num = (v, min, max, def) => (Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : def);
  const args = [
    ...(await captureTarget(o.sourceId)),
    '--width', String(num(o.w, 16, 7680, 1920)), '--height', String(num(o.h, 16, 4320, 1080)),
    '--fps', String(num(o.fps, 1, 240, 60)), '--bitrate', String(num(o.bitrate, 100000, 100000000, 7000000)),
  ];
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(VIDEOCAP, args, { windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }
    videoProc = proc;
    let settled = false;
    const finish = (res) => { if (!settled) { settled = true; clearTimeout(timer); resolve(res); } };
    const timer = setTimeout(() => finish({ ok: false, error: 'o videocap não respondeu' }), 8000);
    const alive = () => videoProc === proc && !sender.isDestroyed();

    // Cada quadro: [tamanho u32][chave u8][timestamp f64][H.264]
    let buf = Buffer.alloc(0);
    proc.stdout.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      while (buf.length >= 13) {
        const size = buf.readUInt32LE(0);
        if (buf.length < 13 + size) break;
        if (alive()) sender.send('vchunk', { key: buf[4] === 1, ts: buf.readDoubleLE(5), data: buf.subarray(13, 13 + size) });
        buf = buf.subarray(13 + size);
      }
    });

    let errBuf = '';
    let lastError = '';
    proc.stderr.on('data', (d) => {
      errBuf += d;
      let nl;
      while ((nl = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, nl).trim();
        errBuf = errBuf.slice(nl + 1);
        const ready = /^READY (\d+) (\d+)/.exec(line);
        const stats = /^STATS (\d+) (\d+)/.exec(line);
        if (ready) finish({ ok: true, width: +ready[1], height: +ready[2], gpu: probe.gpu });
        else if (stats) { if (alive()) sender.send('vstats', { captured: +stats[1], encoded: +stats[2] }); }
        else if (line.startsWith('ERROR')) { lastError = line.slice(6); finish({ ok: false, error: lastError }); }
        else if (line === 'ENDED') lastError = 'ended';
      }
    });
    proc.on('error', (err) => finish({ ok: false, error: err.message }));
    proc.on('exit', (code) => {
      finish({ ok: false, error: lastError || 'o videocap fechou' });
      // Fechou sozinho no meio da transmissão: a página decide o que fazer (janela fechou / reserva)
      if (videoProc === proc) {
        videoProc = null;
        if (!sender.isDestroyed()) sender.send('vended', { windowClosed: lastError === 'ended' || code === 2, error: lastError });
      }
    });
  });
}

function videoCapCommand(line) {
  if (videoProc && videoProc.stdin.writable) videoProc.stdin.write(line + '\n');
}

function stopAppAudio() {
  if (audioProc) {
    audioProc.stdout.removeAllListeners('data');
    audioProc.kill();
    audioProc = null;
  }
}

// O som deste app (as telas que você está assistindo) sempre fica de fora, pelo PID,
// para quem você assiste não se ouvir de volta na sua transmissão.
function startAppAudio(sender, excludeExes) {
  stopAppAudio();
  const args = ['--exclude-pid', String(process.pid)];
  for (const exe of Array.isArray(excludeExes) ? excludeExes.slice(0, 32) : []) {
    if (typeof exe === 'string' && exe) args.push('--exclude', exe);
  }
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(AUDIOCAP, args, { windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }
    audioProc = proc;
    let settled = false;
    const finish = (res) => { if (!settled) { settled = true; resolve(res); } };
    const timer = setTimeout(() => finish({ ok: false, error: 'o capturador não respondeu' }), 6000);

    // Manda o áudio para a página em blocos com tamanho múltiplo de 4 bytes (1 quadro estéreo 16 bits)
    let leftover = Buffer.alloc(0);
    proc.stdout.on('data', (chunk) => {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = buf.length - (buf.length % 4);
      leftover = buf.subarray(usable);
      if (usable && !sender.isDestroyed()) sender.send('pcm', buf.subarray(0, usable));
    });

    proc.stderr.on('data', (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (line.startsWith('READY')) { clearTimeout(timer); finish({ ok: true }); }
        else if (line.startsWith('ERROR')) { clearTimeout(timer); finish({ ok: false, error: line.slice(6) }); }
      }
    });
    proc.on('error', (err) => { clearTimeout(timer); finish({ ok: false, error: err.message }); });
    proc.on('exit', () => {
      clearTimeout(timer);
      finish({ ok: false, error: 'o capturador fechou' });
      if (audioProc === proc) audioProc = null;
    });
  });
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
const PIP_KEY = 'CommandOrControl+Shift+E';
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

// O atalho de ajuste vale enquanto houver janela flutuante ou o chat por cima do jogo
function holdEditKey() {
  if (!globalShortcut.isRegistered(PIP_KEY) && !globalShortcut.register(PIP_KEY, () => setPipEdit(!pipEdit))) {
    sendMain({ type: 'shortcut-busy' });
  }
}
function releaseEditKey() {
  if (!pips.size && !(chatWin && !chatWin.isDestroyed())) globalShortcut.unregister(PIP_KEY);
}

// ---------- Chat por cima do jogo ----------
// Janela transparente, sempre por cima, sem foco e com o clique atravessando (menos no modo de ajuste).
// Ctrl+Shift+O esconde e mostra, de dentro do jogo. Lembra a posição e o tamanho.
const CHAT_KEY = 'CommandOrControl+Shift+O';
let chatWin = null;

// Ctrl+Enter, de dentro do jogo: o chat por cima do jogo pega o teclado só para escrever uma mensagem.
// Enter manda, Esc cancela, e nos dois casos o teclado volta para o jogo. Vale enquanto você está numa sala.
const COMPOSE_KEY = 'CommandOrControl+Enter';
let chatCompose = false;
let composeOnOpen = false;
function setRoomKeys(on) {
  if (!on) {
    globalShortcut.unregister(COMPOSE_KEY);
    if (chatCompose) setChatCompose(false);
    return;
  }
  if (!globalShortcut.isRegistered(COMPOSE_KEY) && !globalShortcut.register(COMPOSE_KEY, () => sendMain({ type: 'compose-key' }))) {
    sendMain({ type: 'compose-key-busy' });
  }
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
  holdEditKey();
  if (!globalShortcut.isRegistered(CHAT_KEY)) {
    const ok = globalShortcut.register(CHAT_KEY, () => {
      if (!chatWin || chatWin.isDestroyed()) return;
      if (chatWin.isVisible()) chatWin.hide();
      else chatWin.showInactive();
    });
    if (!ok) sendMain({ type: 'chat-key-busy' });
  }
  child.on('closed', () => {
    if (chatWin === child) chatWin = null;
    chatCompose = false;
    globalShortcut.unregister(CHAT_KEY);
    releaseEditKey();
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
  holdEditKey();
  child.on('closed', () => {
    if (pips.get(id) === p) pips.delete(id);
    releaseEditKey();
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
    backgroundColor: '#111111',
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
    if (boostProc) boostProc.kill();
    relaunch();
  });

  ipcMain.handle('start-server', (_e, port, password, seed) => startServer(port, password, seed || {}));
  ipcMain.handle('stop-server', (_e, endRoom) => stopServer({ endRoom: !!endRoom }));

  createWindow();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  stopServer();
  stopAppAudio();
  stopVideoCap();
  stopStats();
  if (boostProc) boostProc.kill();
  app.quit();
});
