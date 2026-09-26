'use strict';
// Microfone (RNNoise, eco, sensibilidade), apertar para falar e a janela "Voz e atalhos".
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, voz, chat.

// ---------- Microfone: supressão de ruído, eco e apertar para falar ----------
// ns: 'ia' (RNNoise, roda no PC), 'chrome' (o filtro básico do Chrome) ou 'off'. echo: cancelamento de eco.
// mode: 'voz' (o microfone fica aberto) ou 'ptt' (só enquanto a tecla está apertada).
// gateAuto/gateDb: sensibilidade (abaixo do limite, o microfone fica fechado). duck: quanto o som das
// transmissões abaixa enquanto alguém fala (0 = não abaixa); duckSelf: abaixa também quando eu falo.
const voiceCfg = { ns: 'ia', echo: true, mode: 'voz', pttVk: 0, pttLabel: '', gateAuto: true, gateDb: -50, duck: 0, duckSelf: false };
try { Object.assign(voiceCfg, JSON.parse(load('vozConfig', '{}')) || {}); } catch {}
function saveVoiceCfg() { save('vozConfig', JSON.stringify(voiceCfg)); }

const RNNOISE_ID = '@sapphi-red/web-noise-suppressor/rnnoise';
let micNow = null;   // { raw, out, ctx, node } do microfone em uso
let noiseWasm = null;
const simdOk = () => WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));

// Abre o microfone com os filtros escolhidos. Com a IA, o som passa pelo RNNoise (48 kHz) antes de sair.
async function openMic() {
  const raw = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: { echoCancellation: voiceCfg.echo, noiseSuppression: voiceCfg.ns === 'chrome', autoGainControl: true },
  });
  // microfone -> [IA] -> medidor -> porta (sensibilidade) -> o que vai para a sala
  const ctx = new AudioContext({ sampleRate: 48000 });
  const src = ctx.createMediaStreamSource(raw);
  let last = src;
  let node = null;
  if (voiceCfg.ns === 'ia') {
    try {
      if (!noiseWasm) noiseWasm = await window.api.noiseWasm(simdOk());
      if (!noiseWasm) throw new Error('arquivo da IA não encontrado');
      await ctx.audioWorklet.addModule('vendor/noise/rnnoiseWorklet.js');
      const bin = noiseWasm.buffer.slice(noiseWasm.byteOffset, noiseWasm.byteOffset + noiseWasm.byteLength);
      node = new AudioWorkletNode(ctx, RNNOISE_ID, { processorOptions: { maxChannels: 1, wasmBinary: bin } });
      src.connect(node);
      last = node;
    } catch (err) {
      console.warn('Supressão de ruído com IA indisponível:', err);
      toast('A supressão de ruído com IA não carregou. Usando a básica.', 'error');
      node = null;
    }
  }
  const pre = ctx.createAnalyser();
  pre.fftSize = 1024;
  const gate = ctx.createGain();
  const dest = ctx.createMediaStreamDestination();
  last.connect(pre);
  last.connect(gate);
  gate.connect(dest);
  const mic = { raw, out: dest.stream, ctx, node, pre, gate, gateOpen: true, holdUntil: 0, floor: -70, level: -100, timer: null };
  mic.timer = setInterval(() => tickGate(mic), 20);
  // Microfone desconectado: avisa a voz do mesmo jeito que o microfone "cru" avisaria
  for (const t of raw.getAudioTracks()) t.addEventListener('ended', () => dest.stream.getAudioTracks().forEach((o) => o.dispatchEvent(new Event('ended'))));
  micNow = mic;
  return mic.out;
}

// Sensibilidade: mede o som (depois da IA) a cada 20 ms. Acima do limite, a porta abre na hora; abaixo,
// espera 300 ms e fecha suave. No automático, o limite fica 12 dB acima do ruído de fundo medido.
function gateThreshold(mic) {
  return voiceCfg.gateAuto ? Math.max(-72, Math.min(-30, mic.floor + 12)) : voiceCfg.gateDb;
}
function tickGate(mic) {
  const buf = new Float32Array(mic.pre.fftSize);
  mic.pre.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const x of buf) sum += x * x;
  const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
  mic.level = db;
  // Ruído de fundo: desce rápido, sobe devagar (a voz não puxa o limite para cima)
  mic.floor = db < mic.floor ? db * 0.3 + mic.floor * 0.7 : mic.floor + 0.02;
  const now = performance.now();
  const open = db > gateThreshold(mic);
  if (open) mic.holdUntil = now + 300;
  const want = open || now < mic.holdUntil;
  if (want !== mic.gateOpen) {
    mic.gateOpen = want;
    mic.gate.gain.setTargetAtTime(want ? 1 : 0, mic.ctx.currentTime, want ? 0.004 : 0.04);
  }
}

function closeMic(mic) {
  if (!mic) return;
  mic.raw.getTracks().forEach((t) => t.stop());
  if (mic.out !== mic.raw) mic.out.getTracks().forEach((t) => t.stop());
  clearInterval(mic.timer);
  try { mic.node?.port.postMessage('destroy'); } catch {}
  mic.ctx?.close().catch(() => {});
  if (micNow === mic) micNow = null;
}

// Trocar o filtro no meio da conversa: abre o microfone de novo e troca a faixa em cada conexão, sem cair
async function restartMic() {
  if (!voice.session || !voice.stream) return;
  const old = micNow;
  const oldTrack = voice.stream.getAudioTracks()[0];
  let stream;
  try { stream = await openMic(); } catch (err) { toast(`Não foi possível reabrir o microfone: ${err.message}`, 'error'); return; }
  if (!voice.session) { closeMic(micNow); return; }
  const track = stream.getAudioTracks()[0];
  track.onended = oldTrack ? oldTrack.onended : null;
  if (oldTrack) oldTrack.onended = null;
  for (const p of voice.peers.values()) {
    const sender = p.pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
    if (sender) await sender.replaceTrack(track).catch(() => {});
  }
  voice.stream = stream;
  mixer.local(stream, true);
  closeMic(old);
  applyMicGate();
}

// O microfone só manda som quando: não está desligado e (detecção de voz, ou a tecla está apertada)
const ptt = { down: false, active: 0, releaseTimer: null };
function applyMicGate() {
  const t = voice.stream?.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !voice.muted && (voiceCfg.mode !== 'ptt' || ptt.down);
}
function syncPtt() {
  const want = voice.session && voiceCfg.mode === 'ptt' ? voiceCfg.pttVk : 0;
  if (want === ptt.active) return;
  ptt.active = want;
  ptt.down = false;
  window.api.ptt(want).then((ok) => { if (!ok && want) toast('Não foi possível ligar o apertar para falar (teclas.exe não encontrado).', 'error'); }).catch(() => {});
  applyMicGate();
}
function onPttKey(down) {
  clearTimeout(ptt.releaseTimer);
  if (down) {
    ptt.down = true;
    applyMicGate();
    renderVoiceMe();
  } else {
    // Solta 200 ms depois, para não cortar o fim da última palavra
    ptt.releaseTimer = setTimeout(() => { ptt.down = false; applyMicGate(); renderVoiceMe(); }, 200);
  }
}
function renderVoiceMe() {
  const label = $('voiceMeText');
  if (!label) return;
  label.textContent = voiceCfg.mode === 'ptt'
    ? (voiceCfg.pttVk ? `Segure ${voiceCfg.pttLabel}` : 'Escolha a tecla') // apertada, só as barrinhas acendem
    : 'Na voz';
  $('voiceMe').classList.toggle('ptt-open', voiceCfg.mode === 'ptt' && ptt.down);
}

// ---------- Janela "Voz e atalhos" ----------
const SHORTCUT_NAMES = {
  compose: 'Escrever no chat por cima do jogo',
  mute: 'Ligar ou desligar o microfone',
  edit: 'Ajustar ou travar as janelas por cima do jogo',
  hideChat: 'Esconder ou mostrar o chat por cima do jogo',
};
let shortcutKeys = {};
let capturing = null; // { kind: 'shortcut'|'ptt', action, btn }

// "CommandOrControl+Shift+E" -> "Ctrl+Shift+E"
function accelLabel(accel) {
  if (!accel) return 'Nenhum';
  return accel.split('+').map((k) => ({ CommandOrControl: 'Ctrl', Control: 'Ctrl', Return: 'Enter', Space: 'Espaço' }[k] || k)).join('+');
}

// Tecla do teclado -> nome no formato de atalho do Electron
const ACCEL_CODES = {
  Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/',
};
function accelFromEvent(e) {
  let key = '';
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) key = e.code;
  else if (/^Numpad\d$/.test(e.code)) key = `num${e.code.slice(6)}`;
  else key = ACCEL_CODES[e.code] || '';
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return { accel: [...mods, key].join('+'), fkey: /^F\d+$/.test(key), strong: e.ctrlKey || e.altKey };
}

// Nome curto de uma tecla (para o apertar para falar)
function keyLabel(e) {
  const names = { ' ': 'Espaço', Control: 'Ctrl', CapsLock: 'Caps Lock', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace' };
  if (names[e.key]) return names[e.key];
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

function openVoiceDialog() {
  $('voiceDialog').hidden = false;
  renderVoiceDialog();
  window.api.getShortcuts().then((k) => { shortcutKeys = k || {}; renderShortcutRows(); }).catch(() => {});
  $('closeVoiceDialog').focus();
  meterLoop();
}
function closeVoiceDialog() {
  stopCapture();
  $('voiceDialog').hidden = true;
  $('voiceSettingsBtn').focus();
}

function renderVoiceDialog() {
  document.querySelectorAll('input[name="noise"]').forEach((r) => { r.checked = r.value === voiceCfg.ns; });
  document.querySelectorAll('input[name="talkMode"]').forEach((r) => { r.checked = r.value === voiceCfg.mode; });
  $('echoOn').checked = voiceCfg.echo;
  $('nsHint').textContent = {
    ia: 'Uma IA no seu PC tira teclado, ventilador, barulho da rua e respiração, e deixa só a voz. Usa um pouco de processador.',
    chrome: 'Tira chiado constante (ventilador, ar-condicionado). Barulhos como teclado e mouse passam.',
    off: 'Sua voz vai sem filtro de ruído. Bom para microfones de estúdio em lugar silencioso.',
  }[voiceCfg.ns];
  $('pttRow').hidden = voiceCfg.mode !== 'ptt';
  $('pttKey').textContent = voiceCfg.pttVk ? voiceCfg.pttLabel : 'Nenhuma';
  $('modeHint').textContent = voiceCfg.mode === 'ptt'
    ? 'Seu microfone só manda som enquanto você segura a tecla, até de dentro do jogo. Vale tecla do teclado ou botão lateral do mouse.'
    : 'Seu microfone fica aberto enquanto você está na voz; a supressão de ruído corta o que não é voz.';
  $('micMeterBox').hidden = !voice.session;
  $('gateAuto').checked = voiceCfg.gateAuto;
  $('gateDb').disabled = voiceCfg.gateAuto;
  if (!voiceCfg.gateAuto) { $('gateDb').value = String(voiceCfg.gateDb); $('gateMark').style.left = `${dbToPct(voiceCfg.gateDb)}%`; $('gateValue').textContent = `${voiceCfg.gateDb} dB`; }
  $('gateHint').textContent = voice.session
    ? 'Fale normalmente: a barra fica verde quando o microfone abre. Barulho abaixo da marca não passa.'
    : 'Entre na voz para ver o medidor do seu microfone.';
  $('duckAmount').value = String(voiceCfg.duck);
  $('duckValue').textContent = voiceCfg.duck ? `${voiceCfg.duck}%` : 'Desligada';
  $('duckSelf').checked = voiceCfg.duckSelf;
  $('duckSelf').disabled = !voiceCfg.duck;
}

function renderShortcutRows() {
  const box = $('shortcutRows');
  box.replaceChildren();
  for (const [action, name] of Object.entries(SHORTCUT_NAMES)) {
    const row = document.createElement('div');
    row.className = 'vd-row';
    const label = document.createElement('span');
    label.textContent = name;
    const keysBox = document.createElement('span');
    keysBox.className = 'vd-keys';
    const kbd = document.createElement('kbd');
    kbd.textContent = accelLabel(shortcutKeys[action]);
    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'btn small';
    change.textContent = 'Trocar';
    change.setAttribute('aria-label', `Trocar o atalho de: ${name}`);
    change.onclick = () => startCapture({ kind: 'shortcut', action, btn: change });
    keysBox.append(kbd, change);
    if (shortcutKeys[action]) {
      const off = document.createElement('button');
      off.type = 'button';
      off.className = 'btn small ghost';
      off.textContent = 'Tirar';
      off.setAttribute('aria-label', `Tirar o atalho de: ${name}`);
      off.onclick = () => applyShortcut(action, '');
      keysBox.append(off);
    }
    row.append(label, keysBox);
    box.append(row);
  }
}

async function applyShortcut(action, accel) {
  const res = await window.api.setShortcut(action, accel).catch((err) => ({ ok: false, error: err.message }));
  if (!res.ok) { toast(res.error || 'Não deu para usar esse atalho.', 'error'); return false; }
  shortcutKeys = res.keys;
  renderShortcutRows();
  return true;
}

function startCapture(c) {
  stopCapture();
  capturing = c;
  c.btn.textContent = c.kind === 'ptt' ? 'Aperte a tecla ou o botão do mouse… (Esc cancela)' : 'Aperte a combinação… (Esc cancela)';
  c.btn.classList.add('capturing');
}
function stopCapture() {
  if (!capturing) return;
  capturing.btn.classList.remove('capturing');
  capturing.btn.textContent = 'Trocar';
  capturing = null;
}

// Medidor do microfone (o que sai depois dos filtros), enquanto a janela está aberta
// Escala do medidor e do controle: -80 dB (esquerda) a 0 dB (direita)
const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));
function meterLoop() {
  if ($('voiceDialog').hidden) return;
  const mic = micNow;
  $('micMeter').style.width = `${mic ? dbToPct(mic.level) : 0}%`;
  $('micMeter').classList.toggle('open', !!mic && mic.gateOpen && !!voice.stream?.getAudioTracks()[0]?.enabled);
  if (mic) {
    const th = gateThreshold(mic);
    $('gateMark').style.left = `${dbToPct(th)}%`;
    if (voiceCfg.gateAuto) $('gateDb').value = String(Math.round(th));
    $('gateValue').textContent = `${Math.round(th)} dB`;
  }
  requestAnimationFrame(meterLoop);
}
