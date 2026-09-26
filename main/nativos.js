// Ajudantes nativos do processo principal: prioridade do app, medidas das Estatísticas, NVENC direto
// (videocap.exe) e o som capturado sem o próprio app (audiocap.exe).
const { app, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

// Ajudantes nativos (som e NVENC). Vêm junto das atualizações; no .exe ficam fora do .asar.
const BIN = fs.existsSync(path.join(__dirname, '..', 'bin', 'audiocap.exe'))
  ? path.join(__dirname, '..', 'bin')
  : path.join(process.resourcesPath, 'bin');
const AUDIOCAP = path.join(BIN, 'audiocap.exe');
const VIDEOCAP = path.join(BIN, 'videocap.exe');

let audioProc = null;

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

// A prioridade fica ligada enquanto o app estiver aberto; ao reiniciar ou fechar, o ajudante sai junto
function stopPriority() {
  if (boostProc) boostProc.kill();
}

module.exports = {
  BIN, AUDIOCAP, VIDEOCAP, setPriority, stopPriority, startStats, stopStats, probeVideoCap, startVideoCap, stopVideoCap,
  videoCapCommand, startAppAudio, stopAppAudio,
};
