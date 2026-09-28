'use strict';
// O que no Windows vem dos ajudantes nativos (.exe), no Linux (X11) vem daqui:
// - Estatísticas: processador de cada processo do app, pelo próprio Electron (sem placa de vídeo por processo);
// - Apertar para falar: o xinput (pacote xinput, já vem no Ubuntu e no Mint) avisa cada tecla e botão do mouse
//   apertado e solto em qualquer janela, como o teclas.exe faz no Windows.
const { app } = require('electron');
const os = require('os');
const { spawn } = require('child_process');

// ---------- Estatísticas ----------
function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const [k, v] of Object.entries(c.times)) { total += v; if (k === 'idle') idle += v; }
  }
  return { idle, total };
}

// Mesmo formato do audiocap.exe --stats: { procs: [{ pid, name, cpu, gpu, gpuMemMB }], cpuPC, gpuAvailable, gpuPC }
function startStatsLinux(send, labelsFor) {
  const cores = Math.max(1, os.cpus().length);
  let before = cpuTimes();
  app.getAppMetrics(); // a primeira leitura só zera a contagem
  const timer = setInterval(() => {
    const now = cpuTimes();
    const total = now.total - before.total;
    const cpuPC = total > 0 ? Math.max(0, Math.min(100, 100 * (1 - (now.idle - before.idle) / total))) : 0;
    before = now;
    const labels = labelsFor();
    const procs = app.getAppMetrics().map((m) => ({
      pid: m.pid,
      name: m.name || m.type,
      label: labels.get(m.pid) || m.type,
      cpu: (m.cpu?.percentCPUUsage || 0) / cores, // o Electron conta por núcleo; aqui é do PC inteiro, como no Windows
      gpu: {},
      gpuMemMB: 0,
    }));
    send({ procs, cpuPC, gpuAvailable: false, gpuPC: {} });
  }, 1000);
  return { kill: () => clearInterval(timer) };
}

// ---------- Apertar para falar ----------
// O app guarda a tecla como o código do Windows (keyCode do navegador, igual no Linux). O xinput fala em
// keycodes do X (código do kernel + 8). Botões do mouse: 4 = do meio, 5 e 6 = laterais (no X, 2, 8 e 9).
const EVDEV = {
  8: [14], 9: [15], 13: [28, 96], 16: [42, 54], 17: [29, 97], 18: [56, 100], 19: [119], 20: [58], 27: [1], 32: [57],
  33: [104], 34: [109], 35: [107], 36: [102], 37: [105], 38: [103], 39: [106], 40: [108], 45: [110], 46: [111],
  93: [127], 106: [55], 107: [78], 109: [74], 110: [83], 111: [98], 144: [69], 145: [70],
  186: [39], 187: [13], 188: [51], 189: [12], 190: [52], 191: [53], 192: [41], 219: [26], 220: [43], 221: [27], 222: [40],
};
'1234567890'.split('').forEach((d, i) => { EVDEV[d.charCodeAt(0)] = [i + 2]; });
const LETRAS = { Q: 16, W: 17, E: 18, R: 19, T: 20, Y: 21, U: 22, I: 23, O: 24, P: 25, A: 30, S: 31, D: 32, F: 33, G: 34, H: 35, J: 36, K: 37, L: 38, Z: 44, X: 45, C: 46, V: 47, B: 48, N: 49, M: 50 };
for (const [l, code] of Object.entries(LETRAS)) EVDEV[l.charCodeAt(0)] = [code];
[59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88].forEach((code, i) => { EVDEV[112 + i] = [code]; });      // F1 a F12
for (let i = 0; i < 12; i++) EVDEV[124 + i] = [183 + i];                                                 // F13 a F24
[82, 79, 80, 81, 75, 76, 77, 71, 72, 73].forEach((code, i) => { EVDEV[96 + i] = [code]; });           // teclado numérico 0 a 9

function xinputAlvo(vk) {
  if (vk === 4) return { tipo: 'button', codes: [2] };
  if (vk === 5) return { tipo: 'button', codes: [8] };
  if (vk === 6) return { tipo: 'button', codes: [9] };
  const ev = EVDEV[vk];
  return ev ? { tipo: 'key', codes: ev.map((c) => c + 8) } : null;
}

// onDown(bool). Devolve o processo (para parar) ou null se não der (tecla sem equivalente, sem X, sem xinput).
function startPttLinux(vk, onDown, onExit) {
  const alvo = xinputAlvo(vk);
  if (!alvo || !process.env.DISPLAY) return null;
  let proc;
  try { proc = spawn('xinput', ['test-xi2', '--root'], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
  let buf = '';
  let evento = '';
  let apertado = false;
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const tipo = /^EVENT type \d+ \((Raw(?:Key|Button)(?:Press|Release))\)/.exec(line);
      if (tipo) { evento = tipo[1]; continue; }
      const det = /^detail:\s*(\d+)/.exec(line);
      if (!det || !evento) continue;
      const ehTecla = evento.startsWith('RawKey');
      if ((alvo.tipo === 'key') !== ehTecla || !alvo.codes.includes(Number(det[1]))) { evento = ''; continue; }
      const down = evento.endsWith('Press');
      evento = '';
      if (down !== apertado) { apertado = down; onDown(down); }
    }
  });
  proc.on('error', () => onExit());
  proc.on('exit', () => onExit());
  return proc;
}

module.exports = { startStatsLinux, startPttLinux, xinputAlvo };
