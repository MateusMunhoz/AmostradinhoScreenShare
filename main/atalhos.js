// Atalhos globais (dá para trocar em "Voz e atalhos") e o apertar para falar (teclas.exe).
// Cada atalho só fica registrado enquanto faz sentido; fora disso, a tecla fica livre para os outros programas.
const { app, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { BIN } = require('./nativos');
const { janelas, sendMain } = require('./contexto');

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
const chatOpen = () => !!(janelas.chat && !janelas.chat.isDestroyed());
const ACTIONS = {
  edit: { active: () => pips.size > 0 || chatOpen(), run: () => setPipEdit(!janelas.pipEdit) },
  hideChat: {
    active: chatOpen,
    run: () => {
      if (!chatOpen()) return;
      if (janelas.chat.isVisible()) janelas.chat.hide();
      else janelas.chat.showInactive();
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

function setRoomKeys(on) {
  roomKeysOn = !!on;
  syncShortcuts();
  if (!on) {
    if (janelas.chatCompose) setChatCompose(false);
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

// Exportado antes dos require de baixo: janela-flutuante.js e chat-jogo.js também usam este arquivo
Object.assign(module.exports, { keys, syncShortcuts, setShortcut, setRoomKeys, setPtt });
const { pips, setPipEdit } = require('./janela-flutuante');
const { setChatCompose } = require('./chat-jogo');
