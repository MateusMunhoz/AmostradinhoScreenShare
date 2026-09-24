const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { startServer, stopServer } = require('./signaling');
const github = require('./github');

// Usa os IPs reais (26.x da Radmin) nos candidatos WebRTC em vez de endereços .local
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
// Deixa o vídeo do host tocar com som sem precisar clicar
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Com a janela minimizada, o Chromium joga a página para prioridade ociosa e modo de eficiência.
// Quem assiste enquanto joga ficava com o som picotando e respondendo atrasado a quem transmite,
// que então baixava a qualidade achando que a internet estava ruim.
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let selectedSourceId = null;
let captureSystemAudio = true;
let audioProc = null;

// Capturador nativo que ignora apps. Vem junto das atualizações; no .exe fica fora do .asar.
const AUDIOCAP = fs.existsSync(path.join(__dirname, 'bin', 'audiocap.exe'))
  ? path.join(__dirname, 'bin', 'audiocap.exe')
  : path.join(process.resourcesPath, 'bin', 'audiocap.exe');

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#161b26',
    autoHideMenuBar: true,
    title: 'Tela P2P',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.once('did-finish-load', () => updater.started());
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

  ipcMain.handle('get-version', () => updater.version);
  ipcMain.handle('get-own-pack', () => updater.readCurrentPack());
  ipcMain.handle('install-update', (_e, pack, sig) => updater.install(pack, sig));
  ipcMain.handle('github-check', () => github.check());
  ipcMain.handle('github-install', () => github.install(updater));
  ipcMain.handle('open-github', (_e, url) => github.openPage(url));
  ipcMain.handle('restart-app', () => {
    stopServer();
    stopAppAudio();
    if (boostProc) boostProc.kill();
    updater.restart();
  });

  ipcMain.handle('start-server', (_e, port, password) => startServer(port, password));
  ipcMain.handle('stop-server', () => stopServer());

  createWindow();
});

app.on('window-all-closed', () => {
  stopServer();
  stopAppAudio();
  if (boostProc) boostProc.kill();
  app.quit();
});
