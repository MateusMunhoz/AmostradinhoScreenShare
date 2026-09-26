const { app, BrowserWindow, ipcMain, desktopCapturer, session, globalShortcut, shell } = require('electron');
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
const { janelas } = require('./main/contexto');
const { pips, livePip, freeSlot, pipBounds, setPipSize, setPipGroup, setPipOpacity, setPipEdit, setupPip } = require('./main/janela-flutuante');
const { chatBounds, setupChatOverlay, chatComposeRequest } = require('./main/chat-jogo');
const { keys, setShortcut, setRoomKeys, setPtt } = require('./main/atalhos');

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
    if (janelas.chat && !janelas.chat.isDestroyed()) janelas.chat.close();
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
  ipcMain.handle('chat-compose', (_e, on, opening) => chatComposeRequest(on, opening));
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
