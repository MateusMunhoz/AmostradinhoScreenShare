// Base dos testes de ponta a ponta: abre cópias do app (cada uma como uma pessoa diferente), controla
// cada uma pelo DevTools (CDP) e confere o resultado. Tudo roda no seu PC, em portas locais.
// Os perfis de teste e as fotos ficam em %TEMP%\tela-p2p-e2e (nunca no seu perfil de verdade).
const WebSocket = require('ws');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.resolve(__dirname, '..', '..');
const TMP = path.join(os.tmpdir(), 'tela-p2p-e2e');
const FOTOS = path.join(TMP, 'fotos');
fs.mkdirSync(FOTOS, { recursive: true });
const ELECTRON = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const FAKE = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Placar ----------
let ok = 0;
let bad = 0;
function check(name, cond, extra = '') {
  if (cond) ok++; else bad++;
  console.log(`${cond ? 'OK   ' : 'FALHA'} ${name}${extra !== '' ? `  (${extra})` : ''}`);
}

// ---------- Controle de cada cópia do app ----------
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url, { perMessageDeflate: false });
    this.id = 0;
    this.cb = new Map();
    this.ws.on('message', (m) => {
      const d = JSON.parse(m);
      if (d.id && this.cb.has(d.id)) { this.cb.get(d.id)(d); this.cb.delete(d.id); }
    });
  }
  open() { return new Promise((r) => this.ws.once('open', r)); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.cb.set(id, (d) => (d.error ? rej(new Error(d.error.message)) : res(d.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(expr, ms = 20000) {
    const t = Date.now();
    while (Date.now() - t < ms) {
      try { if (await this.eval(expr)) return true; } catch {}
      await sleep(200);
    }
    throw new Error(`tempo esgotado esperando: ${expr}`);
  }
  async shot(name) {
    const r = await Promise.race([this.send('Page.captureScreenshot', { format: 'png' }), sleep(8000).then(() => null)]);
    if (r) fs.writeFileSync(path.join(FOTOS, name), Buffer.from(r.data, 'base64'));
  }
}

async function attach(port, match = (t) => t.type === 'page' && !t.url.startsWith('about:')) {
  for (let i = 0; i < 100; i++) {
    try {
      const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(match);
      if (t) { const c = new CDP(t.webSocketDebuggerUrl); await c.open(); return c; }
    } catch {}
    await sleep(400);
  }
  throw new Error(`o app de teste na porta ${port} não abriu`);
}

const profileDir = (tag) => path.join(TMP, `perfil-${tag}`);

// Abre uma cópia do app com um perfil novo (cada "pessoa" tem o seu) e o DevTools numa porta
async function openApp(tag, port, { fake = false, size = true } = {}) {
  const dir = profileDir(tag);
  fs.rmSync(dir, { recursive: true, force: true });
  spawn(ELECTRON, ['.', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, ...(fake ? FAKE : [])], { cwd: APP, stdio: 'ignore' });
  const X = await attach(port);
  if (size) await X.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 780, deviceScaleFactor: 1, mobile: false });
  await X.waitFor(`typeof state === 'object'`);
  // As janelas de teste ficam umas por cima das outras. O app pausa o vídeo de janela escondida,
  // então aqui todas fingem estar à vista.
  await X.eval(`(() => {
    Object.defineProperty(document, 'hidden', { get: () => false });
    document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
  })()`);
  return X;
}

async function createRoom(X, { name, port, password = '' }) {
  await X.eval(`(() => { $('name').value = ${JSON.stringify(name)}; $('goCreate').click(); $('roomPort').value = '${port}'; $('roomPassword').value = ${JSON.stringify(password)}; $('createBtn').click(); })()`);
  await X.waitFor(`!$('room').hidden`);
}

async function joinRoom(X, { name, addr, password = '' }) {
  await X.eval(`(() => { $('name').value = ${JSON.stringify(name)}; $('goJoin').click(); $('roomAddr').value = ${JSON.stringify(addr)}; $('joinPassword').value = ${JSON.stringify(password)}; $('joinBtn').click(); })()`);
  await X.waitFor(`!$('room').hidden`);
}

// Transmite a câmera falsa do Chromium no lugar da tela
async function share(X) {
  await X.eval(`(() => {
    navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false });
    $('soundOn').checked = false; setRadio('encodeMode', 'per'); state.selectedSource = 'teste'; return startSharing();
  })()`);
  await X.waitFor(`state.sharing`, 20000);
}

// Quantos quadros um <video> desenhou em 1,5 s
const frames = (X, videoExpr) => X.eval(`(async () => { const v = ${videoExpr}; const a = v.getVideoPlaybackQuality().totalVideoFrames; await new Promise((r) => setTimeout(r, 1500)); return v.getVideoPlaybackQuality().totalVideoFrames - a; })()`);

// ---------- Janelas do Windows (estilo, posição, qual está na frente) ----------
const W32 = `Add-Type 'using System; using System.Runtime.InteropServices; using System.Text;
public struct RCT { public int L, T, R, B; }
public class W9 { public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RCT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'
function Title($h) { $sb = New-Object Text.StringBuilder 256; [void][W9]::GetWindowText($h, $sb, 256); $sb.ToString() }
function Find($t) { $script:found = $null; [W9]::EnumWindows({ param($h, $l) if ((Title $h) -eq $t -and [W9]::IsWindowVisible($h)) { $script:found = $h }; $true }, [IntPtr]::Zero) | Out-Null; $script:found }`;
function ps(script) {
  return execFileSync('powershell', ['-NoProfile', '-Command', `${W32}\n${script}`]).toString().trim();
}
const psq = (s) => s.replace(/'/g, "''");

// Estilo da janela: clique atravessa (WS_EX_TRANSPARENT), não pega foco (NOACTIVATE), sempre por cima (TOPMOST)
function winStyle(title) {
  const out = ps(`$h = Find '${psq(title)}'; if ($h) { '{0:X}' -f [W9]::GetWindowLong($h, -20) } else { 'nenhuma' }`);
  if (out === 'nenhuma') return null;
  const ex = parseInt(out, 16);
  return { transparent: !!(ex & 0x20), noActivate: !!(ex & 0x08000000), topmost: !!(ex & 0x8), hex: out };
}
function winRect(title) {
  const out = ps(`$h = Find '${psq(title)}'; if ($h) { $r = New-Object RCT; [void][W9]::GetWindowRect($h, [ref]$r); "$($r.L),$($r.T),$($r.R),$($r.B)" } else { 'nenhuma' }`);
  if (out === 'nenhuma') return null;
  const [l, t, r, b] = out.split(',').map(Number);
  return { l, t, r, b };
}
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const foreground = () => ps('Title ([W9]::GetForegroundWindow())');

// Teclas de verdade pelo Windows, só se a janela da frente for uma das permitidas (nunca digita em outro programa)
function keys(seq, allowed) {
  const list = allowed.map((t) => `'${psq(t)}'`).join(',');
  const out = ps(`Add-Type -AssemblyName System.Windows.Forms
$t = Title ([W9]::GetForegroundWindow())
if (@(${list}) -contains $t) { [System.Windows.Forms.SendKeys]::SendWait('${psq(seq)}'); 'ok' } else { 'recusado: ' + $t }`);
  if (out !== 'ok') throw new Error(`teclas "${seq}" não enviadas (${out})`);
}

// ---------- Trava: não atrapalhar um jogo aberto ----------
// Os testes abrem janelas que podem tirar o foco. Se o Windows diz que há um app em tela cheia na frente
// (jogo em tela cheia ou sem bordas, apresentação), eles não começam. É o mesmo sinal que o Windows usa
// para calar as notificações durante um jogo. TELA_E2E_FORCE=1 pula a trava.
const FULLSCREEN_STATES = { 2: 'um app em tela cheia', 3: 'um jogo em tela cheia (Direct3D)', 4: 'modo apresentação' };
function fullscreenApps() {
  if (process.env.TELA_E2E_FORCE === '1') return [];
  const out = ps(`Add-Type 'using System; using System.Runtime.InteropServices;
public class QU { [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s); }'
$s = 0; [void][QU]::SHQueryUserNotificationState([ref]$s)
"$s|$(Title ([W9]::GetForegroundWindow()))"`);
  const [state, title] = out.split('|');
  const what = FULLSCREEN_STATES[Number(state)];
  return what ? [`${what}: ${title || 'sem título'}`] : [];
}

// ---------- Limpeza ----------
// Fecha só as cópias de teste (o Electron de desenvolvimento e os ajudantes da pasta do projeto).
// O Tela P2P que você usa (o .exe) não é tocado.
// Fecha só as cópias de teste: as que usam o perfil temporário (tela-p2p-e2e) na linha de comando, e os
// ajudantes (audiocap, videocap, teclas) que elas abriram. O app que você abriu pelo npm start ou pelo .exe,
// mesmo rodando do mesmo Electron, não é tocado.
function killTest() {
  const script = `
    $all = Get-CimInstance Win32_Process
    $test = @($all | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*tela-p2p-e2e*' } | ForEach-Object { $_.ProcessId })
    $kids = @($all | Where-Object { $test -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId })
    foreach ($id in ($test + $kids | Select-Object -Unique)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', script]);
  } catch {}
}

// Roda um teste: tempo máximo, placar no fim, limpeza sempre. Sai com código 1 se algo falhou.
function run(name, timeoutMs, body) {
  console.log(`\n== ${name}`);
  setTimeout(() => { console.log('TEMPO ESGOTADO'); killTest(); process.exit(1); }, timeoutMs).unref();
  (async () => {
    try { await body(); } catch (e) { bad++; console.log('FALHOU:', e.message); }
    console.log(`${ok} ok, ${bad} falhas`);
    killTest();
    setTimeout(() => process.exit(bad ? 1 : 0), 600);
  })();
}

module.exports = {
  APP, TMP, FOTOS, FAKE, sleep, check, CDP, attach, openApp, createRoom, joinRoom, share, frames, profileDir,
  winStyle, winRect, overlap, foreground, keys, fullscreenApps, killTest, run,
};
