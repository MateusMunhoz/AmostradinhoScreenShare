const { app, BrowserWindow, ipcMain, desktopCapturer, session, globalShortcut, shell, clipboard, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { startServer, stopServer, roomInfo, roomSize, onRoomChange } = require('./signaling');
const github = require('./github');
const {
  BIN, AUDIOCAP, setPriority, stopPriority, startStats, stopStats, probeVideoCap, startVideoCap, stopVideoCap,
  videoCapCommand, startAppAudio, stopAppAudio,
} = require('./main/nativos');
const { janelas } = require('./main/contexto');
const { lerAtividade } = require('./main/atividade');
const { pips, livePip, freeSlot, pipBounds, setPipSize, setPipGroup, setPipOpacity, setPipEdit, setupPip } = require('./main/janela-flutuante');
const { chatBounds, setupChatOverlay, chatComposeRequest } = require('./main/chat-jogo');
const { keys, setShortcut, setRoomKeys, setPtt, setVoiceCmdKey } = require('./main/atalhos');
const comandoVoz = require('./main/comando-voz');
const { criarIa, buscarYoutube } = require('./main/comando-voz-ia');
let vozCmd = null; // comando de voz: Whisper baixado só por quem liga (criado quando o app fica pronto)
const sessoes = require('./main/sessoes');
const celular = require('./main/celular');
const { dedupeWindows, thumbSignature } = require('./main/fontes');
const { createRazzeService } = require('./main/razze-service');
const razze = createRazzeService();
const { createDmStore } = require('./main/mensagens');
let dmStore = null; // criado quando o app fica pronto (precisa da pasta do usuário)
const { createDmE2E } = require('./main/mensagens-cripto');
let dmE2E = null; // mensagens criptografadas de ponta a ponta (criado junto com o dmStore)
const { createPresence, cleanInternetRoom, cleanSalaAtual } = require('./main/razze-presence');
const bandeja = require('./main/bandeja');
const { createClipStore } = require('./main/clipes');
let clips = null; // clipes salvos (criado quando o app fica pronto: precisa da pasta Vídeos)
let activeRazzeNetwork = '', roomRazzeNetwork = '';
let internetRoom = null; // sala do modo Internet em que estou, para os amigos (renderer/salas-amigos.js)
let salaAtual = null; // em que sala estou, em qualquer modo, sem endereço: os amigos veem "Na sala de..." (renderer/salas-amigos.js)
const razzePresence = createPresence({
  service: razze,
  clientName: os.hostname().slice(0, 80),
  getAppVersion: () => updater.version,
  getRoom: () => { const info = roomInfo(); return roomRazzeNetwork && info ? { ...info, networkId: roomRazzeNetwork } : null; },
  getInternetRoom: () => internetRoom,
  getSalaAtual: () => salaAtual,
  publish: (value) => { if (janelas.main && !janelas.main.isDestroyed()) janelas.main.webContents.send('razze-presence', value); },
});

let pendingRazzeInvite = '';
let pendingFriendLink = '';
// Links do app: telap2p://invite/<token> (rede Razze) e telap2p://amigo/<token> (convite de amigo, docs/spec/convite-por-link.md)
function consumeRazzeInvite(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { return false; }
  if (parsed.protocol !== 'telap2p:' || !['invite', 'amigo'].includes(parsed.hostname)) return false;
  const token = parsed.pathname.replace(/^\//, '');
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(token)) return false;
  const friend = parsed.hostname === 'amigo';
  if (friend) pendingFriendLink = token; else pendingRazzeInvite = token;
  if (janelas.main && !janelas.main.isDestroyed()) janelas.main.webContents.send(friend ? 'razze-friend-link' : 'razze-invite', token);
  return true;
}
function showMainWindow() {
  const win = janelas.main;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
process.argv.forEach(consumeRazzeInvite);
const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) app.quit();
else {
  app.on('second-instance', (_event, argv) => { argv.forEach(consumeRazzeInvite); showMainWindow(); });
  app.on('open-url', (event, url) => { event.preventDefault(); consumeRazzeInvite(url); showMainWindow(); });
}

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
// Linux: o som do PC junto da tela vem do PulseAudio/PipeWire (no Windows, o Chromium já faz isso sozinho)
app.commandLine.appendSwitch('enable-features', process.platform === 'linux' ? 'ChromeWideEchoCancellation,PulseaudioLoopbackForScreenShare' : 'ChromeWideEchoCancellation');
// Deixa o vídeo do host tocar com som sem precisar clicar
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Com a janela minimizada, o Chromium joga a página para prioridade ociosa e modo de eficiência.
// Quem assiste enquanto joga ficava com o som picotando e respondendo atrasado a quem transmite,
// que então baixava a qualidade achando que a internet estava ruim.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// Com a janela escondida, o Chromium pausa sozinho os vídeos sem som. A música junto (player do YouTube) silenciada
// enquanto você joga pararia e sairia do ponto da sala. As telas assistidas não mudam: com o app escondido, quem
// transmite já para de mandar o vídeo (syncIncomingVideo em assistir.js).
app.commandLine.appendSwitch('disable-background-media-suspend');

let selectedSourceId = null;
let captureSystemAudio = true;
let localDiscoveryEnabled = true;

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

// Reabre o app depois de instalar uma atualização. O .exe portátil apaga a pasta temporária quando
// fecha, então o novo só abre depois de 2 s, por um cmd separado. Antes, o Node escapava as aspas do
// caminho ("Tela P2P.exe" tem espaço) com \", que o cmd não entende: o comando falhava calado e o app
// não voltava. Com os argumentos literais, o cmd recebe as aspas como estão.
function relaunch() {
  // AppImage (Linux): o app roda de uma montagem que some ao fechar; reabre pelo arquivo .AppImage
  if (process.env.APPIMAGE) {
    app.relaunch({ execPath: process.env.APPIMAGE, args: [] });
    app.exit(0);
    return;
  }
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

// Fundo da janela (Configurações gerais > Aparência). O vidro fica só dentro do app, sobre um fundo desenhado
// pela página: a janela acrílica transparente do Windows 11 deixava rastros (a tela anterior continuava
// aparecendo e o texto ganhava um brilho de tanto ser redesenhado por cima) com backdrop-filter. Sempre opaca.
const TITLEBAR_HEIGHT = 32;
// Cores dos botões minimizar, maximizar e fechar (o fundo da barra acompanha a página; com vidro, transparente)
function setTitleBar(color, symbolColor) {
  const win = janelas.main;
  const ok = (c) => typeof c === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(c);
  if (!win || win.isDestroyed() || !ok(color) || !ok(symbolColor) || typeof win.setTitleBarOverlay !== 'function') return false;
  try { win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT }); return true; } catch { return false; }
}
// Ícone da janela (barra de tarefas e Alt+Tab): o desenho da barra de título na cor do tema, que a página
// desenha num canvas (renderer/icone-app.js). Só aceita um PNG pequeno.
function setWindowIcon(png) {
  const win = janelas.main;
  if (!win || win.isDestroyed() || typeof png !== 'string' || !png.startsWith('data:image/png;base64,') || png.length > 512 * 1024) return false;
  const img = nativeImage.createFromDataURL(png);
  if (img.isEmpty()) return false;
  win.setIcon(img);
  bandeja.setTrayIcon(img);
  return true;
}
// Luz ambiente da música (renderer/musica.js): o player do YouTube é de outro site e a página não lê os pixels dele.
// A página pede um retângulo da própria janela principal e recebe só um PNG de 32 x 18 (as cores, sem detalhe: não
// serve de print). Um pedido por vez; janela escondida ou minimizada não tira foto.
const AMBIENT_SIZE = { width: 32, height: 18 };
let capturing = false;
async function captureRegion(x, y, w, h) {
  const win = janelas.main;
  if (capturing || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return '';
  // As medidas vêm em px do CSS; a foto é em px da janela (com o zoom da página)
  const zoom = win.webContents.getZoomFactor() || 1;
  const [cw, ch] = win.getContentSize();
  const r = [x, y, w, h].map((v) => Math.round(Number(v) * zoom));
  if (!r.every(Number.isFinite) || r[2] < 1 || r[3] < 1) return '';
  const left = Math.max(0, Math.min(r[0], cw - 1)), top = Math.max(0, Math.min(r[1], ch - 1));
  const rect = { x: left, y: top, width: Math.max(1, Math.min(r[2], cw - left)), height: Math.max(1, Math.min(r[3], ch - top)) };
  capturing = true;
  try {
    const img = await win.webContents.capturePage(rect);
    return img.isEmpty() ? '' : img.resize({ ...AMBIENT_SIZE, quality: 'good' }).toDataURL();
  } catch {
    return '';
  } finally {
    capturing = false;
  }
}
function setWindowMaterial(_mode, color) {
  const win = janelas.main;
  if (!win || win.isDestroyed()) return { material: 'none', supported: false };
  try {
    if (typeof win.setBackgroundMaterial === 'function') win.setBackgroundMaterial('none');
    win.setBackgroundColor(/^#[\da-f]{6}$/i.test(color) ? color : '#22271E');
  } catch {}
  return { material: 'none', supported: false };
}

// Fora da captura: enquanto você se vê transmitindo uma tela inteira, a janela do app e as flutuantes não
// aparecem na captura (senão vira um espelho infinito). No Windows 10 2004 ou mais novo, a captura mostra o que
// está atrás delas; nos mais velhos, um retângulo preto. Para quem usa o PC, nada muda.
let excludeFromCapture = false;
function protectFromCapture(win) {
  if (win && !win.isDestroyed()) win.setContentProtection(excludeFromCapture);
}
function setCaptureExclude(on) {
  excludeFromCapture = !!on;
  protectFromCapture(janelas.main);
  for (const p of pips.values()) protectFromCapture(p.win);
  return excludeFromCapture;
}

// Para de anunciar a sessão. Sem encerrar para todos e com mais gente na sala, ela vai para outro PC
// (troca de host): aí não avisa que fechou, e o novo host continua o anúncio com o mesmo id.
function endSession(endRoom) {
  sessoes.pararAnuncio({ passaAdiante: !endRoom && roomSize() > 1 });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#22271E',
    autoHideMenuBar: true,
    // Barra de título no tema: a página desenha a barra (titlebar em index.html) e o Windows só os botões
    // minimizar, maximizar e fechar, nas cores que a página manda (setTitleBar)
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#22271E', symbolColor: '#FFFFFF', height: TITLEBAR_HEIGHT },
    title: 'Nebula',
    // Até a página mandar o da cor do tema: o mesmo desenho na cor padrão (npm run icone)
    icon: path.join(__dirname, 'assets', 'icone', process.platform === 'win32' ? 'tela-p2p.ico' : 'tela-p2p.png'),
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
  janelas.main = win;
  // A única janela que a página pode abrir é a flutuante (uma por transmissão, "tela-pip-<id>"); ela nasce
  // sem moldura, por cima e sem foco
  const pipId = (frameName) => (/^tela-pip-([\w-]{1,40})$/.exec(frameName) || [])[1];
  const opening = new Map(); // id -> vaga escolhida ao abrir
  win.webContents.setWindowOpenHandler(({ frameName }) => {
    if (frameName === 'tela-chat') {
      if (janelas.chat && !janelas.chat.isDestroyed()) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...chatBounds(), minWidth: 240, minHeight: 140,
          frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true,
          focusable: false, resizable: true, minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
          title: 'Nebula · chat da sala',
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
        backgroundColor: '#000000', title: 'Nebula · janela flutuante',
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
    protectFromCapture(child);
  });
  bandeja.hideOnClose(win);
  win.on('closed', () => {
    for (const p of pips.values()) if (!p.win.isDestroyed()) p.win.close();
    if (janelas.chat && !janelas.chat.isDestroyed()) janelas.chat.close();
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

if (hasSingleInstance) app.whenReady().then(() => {
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (process.platform === 'win32' && app.isPackaged && portableExe) app.setAsDefaultProtocolClient('telap2p', portableExe);
  else app.setAsDefaultProtocolClient('telap2p');
  // Quando a página pede getDisplayMedia, entregamos a tela escolhida + áudio do sistema
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const source = sources.find((s) => s.id === selectedSourceId) || sources[0];
    callback(captureSystemAudio ? { video: source, audio: 'loopback' } : { video: source });
  });
  // Música junto (renderer/musica.js): o player oficial do YouTube embutido. A página é um arquivo local, sem
  // endereço; o YouTube pede que um app embutindo o player se identifique pelo Referer (sem isso, erro 153)
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (details, callback) => {
    details.requestHeaders.Referer = 'https://com.telap2p.app/';
    callback({ requestHeaders: details.requestHeaders });
  });

  ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
    const shown = sources.filter((s) => !s.thumbnail.isEmpty() && !own.has(s.id) && !HIDDEN_SOURCES.test(s.name));
    // Janelas repetidas do mesmo app (WhatsApp e "(22) WhatsApp", com a mesma imagem) viram uma só
    const unique = dedupeWindows(shown.map((s) => ({ id: s.id, name: s.name, source: s, sig: thumbSignature(s.thumbnail) })));
    return unique
      .map(({ id, name, source: s }) => ({ id, name, thumbnail: s.thumbnail.toDataURL(), dark: looksBlack(s.thumbnail) }))
      .sort((a, b) => a.dark - b.dark); // as pretas vão para o fim, na mesma ordem
  });

  ipcMain.handle('select-source', (_e, id, withSystemAudio) => {
    selectedSourceId = id;
    captureSystemAudio = withSystemAudio !== false;
  });

  ipcMain.handle('list-audio-apps', () => new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
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

  // Configurações no celular (main/celular.js, docs/spec/config-no-celular.md): avisos voltam pelo canal 'celular'
  const avisarCelular = (sender) => (msg) => { if (!sender.isDestroyed()) sender.send('celular', msg); };
  ipcMain.handle('celular-entregar', (e, texto) => celular.abrir('entregar', typeof texto === 'string' && texto.length <= celular.MAX ? texto : '', avisarCelular(e.sender)));
  ipcMain.handle('celular-receber', (e) => celular.abrir('receber', '', avisarCelular(e.sender)));
  ipcMain.handle('celular-fechar', () => { celular.fechar(); return true; });

  ipcMain.handle('get-ips', async (_e, provider = 'radmin') => {
    const list = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
      for (const a of addrs || []) {
        const v4 = a.family === 'IPv4' || a.family === 4;
        // Túnel da Razze: "Razze…" no Windows, "rz…" no Linux (nome de interface tem no máximo 15 letras)
        if (v4 && !a.internal) list.push({ name, address: a.address, radmin: a.address.startsWith('26.'), razze: /razze/i.test(name) || /^rz[a-f0-9]{12}$/.test(name) });
      }
    }
    if (provider === 'razze') {
      return list.filter((item) => item.razze).sort((a, b) => a.name.localeCompare(b.name));
    }
    return list.sort((a, b) => Number(b.radmin) - Number(a.radmin));
  });
  // Copiar pelo processo principal: o navigator.clipboard da página falha quando a janela perde o foco
  ipcMain.handle('copy-text', (_e, text) => { clipboard.writeText(String(text || '').slice(0, 4096)); return true; });
  ipcMain.handle('razze-state', () => razze.state());
  ipcMain.handle('razze-pending-invite', () => { const token = pendingRazzeInvite; pendingRazzeInvite = ''; return token; });
  ipcMain.handle('razze-pending-friend-link', () => { const token = pendingFriendLink; pendingFriendLink = ''; return token; });
  ipcMain.handle('razze-configure', async (_e, url) => {
    const { RazzeApiClient } = require('./main/razze-api-client');
    const normalized = new RazzeApiClient(String(url || '')).baseUrl;
    if (razze.state().baseUrl !== normalized) {
      await razzePresence.reset(); activeRazzeNetwork = ''; roomRazzeNetwork = '';
    }
    const result = razze.configure(normalized);
    dmE2E?.reset();
    void razzePresence.tick();
    return result;
  });
  ipcMain.handle('razze-health', () => razze.health());
  ipcMain.handle('razze-me', () => razze.me());
  ipcMain.handle('razze-register', async (_e, email, password, name) => { const result = await razze.register(String(email || ''), String(password || ''), String(name || '')); dmE2E?.reset(); return result; });
  ipcMain.handle('razze-login', async (_e, email, password) => { const result = await razze.login(String(email || ''), String(password || '')); dmE2E?.reset(); void razzePresence.tick(); return result; });
  ipcMain.handle('razze-logout', async () => { await razzePresence.reset(); activeRazzeNetwork = ''; roomRazzeNetwork = ''; dmE2E?.reset(); return razze.logout(); });
  ipcMain.handle('razze-presence-state', () => razzePresence.snapshot());
  ipcMain.handle('razze-internet-room', (_e, value) => {
    const next = cleanInternetRoom(value);
    const changed = (next?.servidor + next?.codigo + next?.passe) !== (internetRoom?.servidor + internetRoom?.codigo + internetRoom?.passe);
    internetRoom = next;
    if (changed) void razzePresence.tick(); // abriu, fechou ou trocou o passe: avisa já; o número de pessoas vai na próxima batida
    return !!next;
  });
  ipcMain.handle('razze-sala-atual', (_e, value) => {
    const next = cleanSalaAtual(value);
    const changed = !!next !== !!salaAtual || next?.modo !== salaAtual?.modo || next?.host !== salaAtual?.host;
    salaAtual = next;
    if (changed) void razzePresence.tick(); // entrou, saiu ou trocou de sala: avisa já; pessoas e voz vão na próxima batida
    return !!next;
  });
  ipcMain.handle('razze-list-networks', () => razze.listNetworks());
  ipcMain.handle('razze-create-network', (_e, network) => razze.createNetwork(network));
  ipcMain.handle('razze-update-network', (_e, id, patch) => razze.updateNetwork(String(id || ''), patch));
  ipcMain.handle('razze-delete-network', (_e, id) => razze.deleteNetwork(String(id || '')));
  ipcMain.handle('razze-accept-invite', (_e, token) => razze.acceptInvite(String(token || '')));
  ipcMain.handle('razze-list-members', (_e, id) => razze.listMembers(String(id || '')));
  ipcMain.handle('razze-remove-member', (_e, id, userId) => razze.removeMember(String(id || ''), String(userId || '')));
  ipcMain.handle('razze-create-invite', (_e, id, options) => razze.createInvite(String(id || ''), options));
  ipcMain.handle('razze-friends', () => razze.listFriends());
  ipcMain.handle('razze-friend-requests', () => razze.friendRequests());
  ipcMain.handle('razze-request-friend', (_e, nickname) => razze.requestFriend(String(nickname || '')));
  ipcMain.handle('razze-request-friend-id', (_e, userId, nome) => {
    if (!/^[a-f0-9]{32}$/.test(String(userId))) throw new Error('Conta inválida.');
    return razze.requestFriendById(String(userId), String(nome || '').slice(0, 60));
  });
  ipcMain.handle('razze-accept-friend', (_e, id) => razze.acceptFriendRequest(String(id || '')));
  ipcMain.handle('razze-cancel-friend-request', (_e, id) => razze.cancelFriendRequest(String(id || '')));
  ipcMain.handle('razze-remove-friend', (_e, id) => razze.removeFriend(String(id || '')));
  const abrirGoogle = (url) => { if (!String(url).startsWith('https://accounts.google.com/o/oauth2/')) throw new Error('Endereço não permitido.'); return shell.openExternal(url); };
  ipcMain.handle('razze-google-config', () => razze.googleConfig());
  ipcMain.handle('razze-google-login', () => razze.googleLogin(abrirGoogle));
  ipcMain.handle('razze-google-link', () => razze.googleLink(abrirGoogle));
  ipcMain.handle('razze-google-unlink', () => razze.googleUnlink());
  ipcMain.handle('razze-change-password', (_e, current, next) => razze.changePassword(String(current || '').slice(0, 200), String(next || '').slice(0, 200)));
  ipcMain.handle('razze-reset-password', (_e, email, code, password) => razze.resetPassword(String(email || '').slice(0, 254), String(code || '').slice(0, 20), String(password || '').slice(0, 200)));
  // Atividade no perfil: só lê o que a página pediu (jogo e/ou Spotify) e devolve o nome do jogo e a faixa
  ipcMain.handle('atividade-ler', (_e, opcoes) => lerAtividade({ jogos: !!opcoes?.jogos, musica: !!opcoes?.musica }));
  ipcMain.handle('razze-set-activity', (_e, a) => razze.setActivity({ game: String(a?.game || '').slice(0, 200), artist: String(a?.artist || '').slice(0, 200), title: String(a?.title || '').slice(0, 200) }));
  ipcMain.handle('razze-set-bio', (_e, bio) => razze.setBio(String(bio || '').slice(0, 400)));
  ipcMain.handle('razze-friend-link-create', () => razze.friendLinkCreate());
  ipcMain.handle('razze-friend-link-list', () => razze.friendLinkList());
  ipcMain.handle('razze-friend-link-revoke', (_e, id) => razze.friendLinkRevoke(String(id || '')));
  ipcMain.handle('razze-friend-link-preview', (_e, token) => razze.friendLinkPreview(String(token || '').slice(0, 200)));
  ipcMain.handle('razze-friend-link-accept', (_e, token) => razze.friendLinkAccept(String(token || '').slice(0, 200)));
  // Painel de administração (renderer/admin.js): a lista de rotas permitidas fica em main/razze-api-client.js
  ipcMain.handle('razze-admin', (_e, method, endpoint, body) => razze.admin(String(method || '').slice(0, 8), String(endpoint || '').slice(0, 300), body));
  // Mensagens diretas: cifradas aqui antes de ir para a RazzeAPI e decifradas ao chegar (main/mensagens-cripto.js)
  ipcMain.handle('razze-send-message', (_e, to, text) => dmE2E.send(String(to || ''), String(text || '')));
  ipcMain.handle('razze-messages', (_e, after) => dmE2E.messages(Number(after) || 0));
  dmStore = createDmStore(path.join(app.getPath('userData'), 'mensagens'), { storage: safeStorage });
  dmE2E = createDmE2E({ baseDir: path.join(app.getPath('userData'), 'mensagens'), storage: safeStorage, service: razze });
  ipcMain.handle('dm-list', (_e, account) => dmStore.list(String(account || '')));
  ipcMain.handle('dm-load', (_e, account, friend) => dmStore.load(String(account || ''), String(friend || '')));
  ipcMain.handle('dm-save', (_e, account, friend, data) => dmStore.save(String(account || ''), String(friend || ''), data));
  // Conexão direta das mensagens (renderer/mensagens-direto.js): os sinais vão cifrados pela RazzeAPI
  ipcMain.handle('dm-signal-send', (_e, to, text) => dmE2E.sendSignal(String(to || ''), String(text || '')));
  ipcMain.handle('dm-signals', () => dmE2E.signals());
  ipcMain.handle('dm-retencao', (_e, days, account) => dmStore.setRetention(Number(days) || 0, String(account || '')));
  ipcMain.handle('dm-imagem-salvar', (_e, account, id, mime, bytes) => dmStore.saveImage(String(account || ''), String(id || ''), String(mime || ''), bytes instanceof Uint8Array ? bytes : new Uint8Array(0)));
  ipcMain.handle('dm-imagem-ler', (_e, account, id) => dmStore.loadImage(String(account || ''), String(id || '')));
  // Backup no celular: o texto das conversas vai para a janela, que cifra com a senha do backup (celular-modelo.js)
  ipcMain.handle('dm-exportar', (_e, account) => dmStore.exportAll(String(account || '')));
  ipcMain.handle('dm-importar', (_e, account, convs) => dmStore.importAll(String(account || ''), Array.isArray(convs) ? convs : []));
  ipcMain.handle('razze-wg-connections', () => razze.wireguard.connections());
  ipcMain.handle('razze-wg-status', (_e, networkId) => razze.wireguard.status(String(networkId || '')));
  ipcMain.handle('razze-wg-connect', async (_e, networkId, name) => { const result = await razze.wireguard.connect(razze.api(), String(networkId || ''), String(name || 'Razze')); activeRazzeNetwork = String(networkId); razzePresence.track(activeRazzeNetwork); return result; });
  ipcMain.handle('razze-wg-disconnect', async (_e, networkId) => { const result = await razze.wireguard.disconnect(String(networkId || '')); if (result.ok) { razzePresence.untrack(String(networkId)); if (activeRazzeNetwork === networkId) activeRazzeNetwork = ''; } return result; });
  ipcMain.handle('razze-wg-disconnect-all', async () => { const result = await razze.wireguard.disconnectAll(); if (result.ok) { await razzePresence.reset(); activeRazzeNetwork = ''; roomRazzeNetwork = ''; void razzePresence.tick(); } return result; });
  ipcMain.handle('razze-wg-resume', async (_e, networkId) => { const result = await razze.resume(String(networkId || '')); if (result.connected) { activeRazzeNetwork = String(networkId); razzePresence.track(activeRazzeNetwork); } return result; });

  setPriority('above'); // a página manda a escolha salva assim que abre
  ipcMain.handle('set-priority', (_e, level) => setPriority(level));
  ipcMain.handle('stats-start', (e) => startStats(e.sender));
  ipcMain.handle('stats-stop', () => stopStats());

  ipcMain.handle('get-version', () => updater.version);
  ipcMain.handle('window-material', (_e, mode, color) => setWindowMaterial(mode, color));
  ipcMain.handle('window-titlebar', (_e, color, symbolColor) => setTitleBar(color, symbolColor));
  ipcMain.handle('window-icon', (_e, png) => setWindowIcon(png));
  ipcMain.handle('capture-region', (_e, x, y, w, h) => captureRegion(Number(x) || 0, Number(y) || 0, Number(w) || 0, Number(h) || 0));
  ipcMain.handle('get-own-pack', () => updater.readCurrentPack());
  ipcMain.handle('install-update', (_e, pack, sig) => updater.install(pack, sig));
  ipcMain.handle('github-check', () => github.check());
  ipcMain.handle('github-install', () => github.install(updater));
  ipcMain.handle('open-github', (_e, url) => github.openPage(url));
  ipcMain.handle('pip-edit', (_e, on) => setPipEdit(on));
  ipcMain.handle('pip-size', (_e, id, key) => setPipSize(id, key));
  ipcMain.handle('pip-opacity', (_e, id, v) => setPipOpacity(id, v));
  ipcMain.handle('pip-group', (_e, id, patch) => setPipGroup(id, patch));
  ipcMain.handle('room-keys', (_e, on) => { bandeja.setCall(!!on); return setRoomKeys(!!on); });
  ipcMain.handle('get-shortcuts', () => ({ ...keys() }));
  ipcMain.handle('set-shortcut', (_e, action, accel) => setShortcut(String(action), accel));
  ipcMain.handle('ptt', (_e, vk) => setPtt(vk));
  // Supressão de ruído com IA (RNNoise): o .wasm vem daqui, a página não precisa ler arquivos
  ipcMain.handle('noise-wasm', (_e, simd) => {
    try { return fs.readFileSync(path.join(__dirname, 'vendor', 'noise', simd ? 'rnnoise_simd.wasm' : 'rnnoise.wasm')); } catch { return null; }
  });
  ipcMain.handle('chat-compose', (_e, on, opening) => chatComposeRequest(on, opening));
  // Clipes (renderer/clipes.js): a página manda os bytes do MP4 e um nome; a pasta é sempre a mesma
  clips = createClipStore({ dir: path.join(app.getPath('videos'), 'Tela P2P', 'Clipes'), showItem: (file) => shell.showItemInFolder(file) });
  ipcMain.handle('clip-save', (_e, bytes, label) => clips.save(bytes, String(label || '')));
  ipcMain.handle('clip-show', (_e, id) => clips.show(Number(id) || 0));
  // Comando de voz (renderer/comando-voz.js): o Whisper e o modelo vão para a pasta de dados, conferidos por SHA-256;
  // a página manda só o WAV (na memória) e a dica com os nomes, e recebe o texto
  vozCmd = comandoVoz.criar(app.getPath('userData'));
  ipcMain.handle('voz-cmd-estado', () => vozCmd.estado());
  ipcMain.handle('voz-cmd-instalar', (e, modelo) => vozCmd.instalar(String(modelo || ''), (p) => {
    if (!e.sender.isDestroyed()) e.sender.send('voz-cmd', { etapa: p.etapa, feito: p.feito, total: p.total });
  }));
  ipcMain.handle('voz-cmd-cancelar', () => vozCmd.cancelar());
  ipcMain.handle('voz-cmd-remover', () => vozCmd.remover());
  ipcMain.handle('voz-cmd-transcrever', (_e, wav, modelo, dica) => vozCmd.transcrever(wav, String(modelo || ''), String(dica || '')));
  ipcMain.handle('voz-cmd-tecla', (_e, on) => setVoiceCmdKey(!!on));
  // Pedidos livres (etapa B): a chave da Anthropic fica aqui, cifrada; a página só grava, apaga e pergunta se existe
  const vozIa = criarIa(app.getPath('userData'), { storage: safeStorage });
  const opcoesIa = (o) => ({ provedor: o?.provedor === 'nuvem' || o?.provedor === 'local' ? o.provedor : '', modelo: String(o?.modelo || '').slice(0, 100), url: String(o?.url || '').slice(0, 200) });
  ipcMain.handle('voz-ia-estado', () => ({ temChave: vozIa.temChave(), nuvem: vozIa.nuvemDisponivel() }));
  ipcMain.handle('voz-ia-chave', (_e, chave) => vozIa.salvarChave(String(chave || '').slice(0, 400)));
  ipcMain.handle('voz-ia-apagar-chave', () => vozIa.apagarChave());
  ipcMain.handle('voz-ia-entender', (_e, texto, ctx, opcoes) => vozIa.entender(String(texto || '').slice(0, 500), ctx && typeof ctx === 'object' ? ctx : {}, opcoesIa(opcoes)));
  ipcMain.handle('voz-ia-testar', (_e, opcoes) => vozIa.testar(opcoesIa(opcoes)));
  ipcMain.handle('voz-cmd-youtube', (_e, busca) => buscarYoutube(String(busca || '').slice(0, 100))); // "toca Evidências"
  ipcMain.handle('open-link', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('restart-app', restartApp);

  // A sala aberta aparece na lista de sessões de quem está na rede (menos se foi criada oculta)
  ipcMain.handle('start-server', async (_e, port, password, seed, provider = 'radmin') => {
    const res = await startServer(port, password, { ...(seed || {}), onlyRazze: provider === 'razze' });
    localDiscoveryEnabled = provider === 'radmin';
    if (res.ok && localDiscoveryEnabled) sessoes.anunciar(roomInfo, updater.version);
    roomRazzeNetwork = res.ok && provider === 'razze' ? activeRazzeNetwork : '';
    void razzePresence.tick();
    return res;
  });
  ipcMain.handle('stop-server', (_e, endRoom) => {
    endSession(!!endRoom);
    stopServer({ endRoom: !!endRoom });
    roomRazzeNetwork = '';
    void razzePresence.tick();
  });
  onRoomChange(() => { if (localDiscoveryEnabled) sessoes.anunciarAgora(); void razzePresence.tick(); });
  ipcMain.handle('capture-exclude', (_e, on) => setCaptureExclude(on));
  ipcMain.handle('sessoes-observar', (e, on) => sessoes.observar(!!on, e.sender));

  razzePresence.start();
  createWindow();
  bandeja.createTray({ restart: restartApp });
});

function restartApp() {
  endSession(false);
  stopServer();
  stopAppAudio();
  stopVideoCap();
  stopPriority();
  relaunch();
}

let presenceQuit = false;
app.on('before-quit', (event) => {
  bandeja.setQuitting(); // saindo de verdade: o X da janela fecha em vez de esconder na bandeja
  if (presenceQuit) return;
  event.preventDefault(); presenceQuit = true;
  Promise.race([razzePresence.stop().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]).finally(() => app.quit());
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); setPtt(0); });

app.on('window-all-closed', () => {
  celular.fechar();
  endSession(false);
  stopServer();
  stopAppAudio();
  stopVideoCap();
  stopStats();
  stopPriority();
  app.quit();
});
