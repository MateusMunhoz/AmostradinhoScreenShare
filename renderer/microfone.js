'use strict';
// Microfone (RNNoise, eco, sensibilidade), ouvir a própria voz, apertar para falar e a janela "Voz e atalhos".
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, voz, chat.

// ---------- Microfone: supressão de ruído, eco e apertar para falar ----------
// ns: 'ia' (RNNoise, roda no PC), 'chrome' (o filtro básico do Chrome) ou 'off'. echo: cancelamento de eco.
// mode: 'voz' (o microfone fica aberto) ou 'ptt' (só enquanto a tecla está apertada).
// gateAuto/gateDb: sensibilidade (abaixo do limite, o microfone fica fechado). duck: quanto o som das
// transmissões abaixa enquanto alguém fala (0 = não abaixa); duckSelf: abaixa também quando eu falo.
// micId: microfone escolhido em Voz e atalhos ('' = o padrão do Windows); micLabel: o nome dele, para a lista
// vozes: volume de todas as vozes de uma vez (0 a 200%), multiplicado pelo volume de cada pessoa (renderer/voz.js)
const voiceCfg = { micId: '', micLabel: '', ns: 'ia', echo: true, mode: 'voz', pttVk: 0, pttLabel: '', gateAuto: true, gateDb: -50, duck: 0, duckSelf: false, vozes: 100 };
try { Object.assign(voiceCfg, JSON.parse(load('vozConfig', '{}')) || {}); } catch {}
voiceCfg.vozes = Number.isFinite(voiceCfg.vozes) ? Math.max(0, Math.min(200, Math.round(voiceCfg.vozes))) : 100;
function saveVoiceCfg() { save('vozConfig', JSON.stringify(voiceCfg)); }

const RNNOISE_ID = '@sapphi-red/web-noise-suppressor/rnnoise';
let micNow = null;   // { raw, out, ctx, node } do microfone em uso
let noiseWasm = null;
const simdOk = () => WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));

// Abre o microfone da voz (o micNow) com os filtros escolhidos
async function openMic() {
  const mic = await buildMic();
  micNow = mic;
  return mic.out;
}

// Monta a cadeia do microfone escolhido com os filtros escolhidos. Com a IA, o som passa pelo RNNoise (48 kHz)
// antes de sair. Microfone escolhido que não está mais ligado ao PC: abre o padrão do Windows.
// Serve para a voz (openMic) e para o teste de ouvir a própria voz fora dela.
async function buildMic() {
  const audio = { echoCancellation: voiceCfg.echo, noiseSuppression: voiceCfg.ns === 'chrome', autoGainControl: true };
  let raw;
  try {
    raw = await navigator.mediaDevices.getUserMedia({ video: false, audio: voiceCfg.micId ? { ...audio, deviceId: { exact: voiceCfg.micId } } : audio });
  } catch (err) {
    if (!voiceCfg.micId || !['NotFoundError', 'OverconstrainedError'].includes(err.name)) throw err;
    raw = await navigator.mediaDevices.getUserMedia({ video: false, audio });
  }
  // microfone -> [IA] -> medidor -> porta (sensibilidade) -> o que vai para a sala
  const ctx = new AudioContext({ sampleRate: 48000 });
  const src = ctx.createMediaStreamSource(raw);
  let last = src;
  let node = null;
  if (voiceCfg.ns === 'ia') {
    try {
      if (!noiseWasm) noiseWasm = await window.api.noiseWasm(simdOk());
      if (!noiseWasm) throw new Error('arquivo da IA não encontrado');
      // O nosso worklet primeiro: ele embrulha o RNNoise para devolver a chance de voz (VAD)
      await ctx.audioWorklet.addModule('renderer/rnnoise-vad-worklet.js').catch((err) => console.warn('VAD do RNNoise indisponível:', err));
      await ctx.audioWorklet.addModule('vendor/noise/rnnoiseWorklet.js');
      const bin = noiseWasm.buffer.slice(noiseWasm.byteOffset, noiseWasm.byteOffset + noiseWasm.byteLength);
      // A IA limpa um canal só (maxChannels: 1). Microfone estéreo (muitos fones) entrava com dois e o segundo
      // saía mudo: "ouvir minha voz" tocava só no lado esquerdo. Entra e sai mono; na saída, o mono vai
      // igual para os dois lados.
      const opts = {
        channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers', outputChannelCount: [1],
        processorOptions: { maxChannels: 1, wasmBinary: bin },
      };
      try { node = new AudioWorkletNode(ctx, `${RNNOISE_ID}#vad`, opts); } catch { node = new AudioWorkletNode(ctx, RNNOISE_ID, opts); }
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
  // O som cru, antes da IA: mostra o ruído do ambiente (depois da IA ele quase some)
  const rawAn = ctx.createAnalyser();
  rawAn.fftSize = 1024;
  src.connect(rawAn);
  const gate = ctx.createGain();
  const dest = ctx.createMediaStreamDestination();
  last.connect(pre);
  last.connect(gate);
  gate.connect(dest);
  // O ruído começa do último medido neste microfone (com este filtro) e se calibra nos primeiros 500 ms
  const noise = loadNoiseFloors();
  const key = noiseKey(node ? 'ia' : voiceCfg.ns);
  const mic = { raw, out: dest.stream, ctx, node, pre, rawAn, gate, key, buf: new Float32Array(pre.fftSize),
    porta: MicGate.createGate(), floorEst: MicGate.createFloor(noise[key] ?? -70), ambEst: MicGate.createFloor(noise[noiseKey('cru')] ?? -70),
    gateOpen: false, level: -100, ambient: -70, vad: null, vadAt: 0, timer: null };
  // Chance de voz do RNNoise (vem do worklet a cada ~21 ms): número de 0 a 1, o resto é ignorado
  if (node) node.port.onmessage = (e) => {
    const v = e.data?.vad;
    if (typeof v === 'number' && v >= 0 && v <= 1) { mic.vad = v; mic.vadAt = performance.now(); }
  };
  gate.gain.value = 0;
  mic.timer = setInterval(() => tickGate(mic), MicGate.TICK_MS);
  // Microfone desconectado: avisa a voz do mesmo jeito que o microfone "cru" avisaria
  for (const t of raw.getAudioTracks()) t.addEventListener('ended', () => dest.stream.getAudioTracks().forEach((o) => o.dispatchEvent(new Event('ended'))));
  return mic;
}

// Último ruído medido de cada microfone, por filtro ('ia', 'chrome', 'off') e o do som cru
const noiseKey = (kind) => `${voiceCfg.micId || 'padrao'}|${kind}`;
function loadNoiseFloors() {
  try { const o = JSON.parse(load('vozRuido', '{}')); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
function saveNoiseFloors(mic) {
  const o = loadNoiseFloors();
  const fin = (v) => Number.isFinite(v) && v > -100 && v < 0;
  if (fin(mic.floorEst.floor)) o[mic.key] = Math.round(mic.floorEst.floor * 10) / 10;
  const raw = mic.key.replace(/\|[^|]*$/, '|cru');
  if (fin(mic.ambEst.floor)) o[raw] = Math.round(mic.ambEst.floor * 10) / 10;
  save('vozRuido', JSON.stringify(o));
}

const rmsDb = (an, buf) => {
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const x of buf) sum += x * x;
  return Math.max(-100, 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9));
};
// Sensibilidade: mede o som (depois da IA) e o cru a cada 20 ms. As contas ficam em renderer/porta-microfone.js:
// ruído pelo percentil 10 dos últimos ~4 s, limite 12 dB acima dele, abre no limite e fecha 3 dB abaixo após 300 ms.
function gateThreshold(mic) {
  return MicGate.threshold({ auto: voiceCfg.gateAuto, manualDb: voiceCfg.gateDb, ns: mic.node ? 'ia' : voiceCfg.ns, floor: mic.floorEst.floor });
}
function tickGate(mic) {
  const db = rmsDb(mic.pre, mic.buf);
  mic.level = db;
  MicGate.updateFloor(mic.floorEst, db);
  mic.ambient = mic.node ? MicGate.updateFloor(mic.ambEst, rmsDb(mic.rawAn, mic.buf)) : mic.floorEst.floor;
  const now = performance.now();
  // VAD só no automático e se chegou há pouco (worklet sem VAD ou travado: decide só pelo volume)
  const vad = voiceCfg.gateAuto && now - mic.vadAt < 100 ? mic.vad : null;
  if (MicGate.decide(mic.porta, db, gateThreshold(mic), now, vad)) {
    mic.gateOpen = mic.porta.open;
    mic.gate.gain.setTargetAtTime(mic.gateOpen ? 1 : 0, mic.ctx.currentTime, mic.gateOpen ? 0.004 : 0.04);
  }
}

function closeMic(mic) {
  if (!mic) return;
  mic.raw.getTracks().forEach((t) => t.stop());
  if (mic.out !== mic.raw) mic.out.getTracks().forEach((t) => t.stop());
  clearInterval(mic.timer);
  saveNoiseFloors(mic);
  try { mic.node?.port.postMessage('destroy'); } catch {}
  mic.ctx?.close().catch(() => {});
  if (micNow === mic) micNow = null;
}

// Trocar o filtro no meio da conversa: abre o microfone de novo e troca a faixa em cada conexão, sem cair
async function restartMic() {
  if (!voice.session || !voice.stream) { refreshMicTest(); return; }
  const old = micNow;
  const oldTrack = voice.stream.getAudioTracks()[0];
  let stream;
  try { stream = await openMic(); } catch (err) { toast(`Não foi possível reabrir o microfone: ${err.message}`, 'error'); return; }
  if (!voice.session) { closeMic(micNow); return; }
  const track = stream.getAudioTracks()[0];
  track.onended = oldTrack ? oldTrack.onended : null;
  if (oldTrack) oldTrack.onended = null;
  for (const p of [...voice.peers.values(), ...lider.fala.values()]) { // o canal e quem ouve você da subsala Líder
    const sender = p.pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
    if (sender) await sender.replaceTrack(track).catch(() => {});
  }
  voice.stream = stream;
  mixer.local(stream, true);
  closeMic(old);
  applyMicGate();
  syncMicTest();
}

// ---------- Ouvir a própria voz (testar o microfone) ----------
// Toca nas suas caixas ou no fone o som do microfone depois da IA e da sensibilidade: o que a sala ouve.
// Na voz, escuta o mesmo microfone da conversa (mesmo com o microfone desligado, então dá para testar
// sem os outros ouvirem). Fora da voz, abre um microfone só para o teste e fecha quando o teste para.
// own: o microfone aberto só para o teste. mic: o que está tocando agora. tap: o volume que liga o som à saída.
const micTest = { on: false, own: null, mic: null, tap: null, busy: false, again: false };

async function startMicTest() {
  if (micTest.on) return;
  micTest.on = true;
  renderMicTest();
  await attachMicTest();
}
function stopMicTest() {
  if (!micTest.on) return;
  micTest.on = false;
  micTest.again = false;
  detachMicTest();
  renderMicTest();
}
function detachMicTest() {
  if (micTest.tap) {
    try { micTest.mic.gate.disconnect(micTest.tap); } catch {}
    micTest.tap.disconnect();
    micTest.tap = null;
  }
  micTest.mic = null;
  if (micTest.own) { closeMic(micTest.own); micTest.own = null; }
}
// Liga o som do microfone certo (o da voz ou um só do teste) à saída
async function attachMicTest() {
  micTest.busy = true;
  detachMicTest();
  let mic = voice.session ? micNow : null;
  if (!mic) {
    try {
      mic = await buildMic();
    } catch (err) {
      micTest.busy = false;
      micTest.on = false;
      renderMicTest();
      toast(err.name === 'NotAllowedError' ? 'Permita o acesso ao microfone nas configurações do Windows.'
        : err.name === 'NotFoundError' ? 'Nenhum microfone encontrado.' : `Não foi possível abrir o microfone: ${err.message}`, 'error');
      return;
    }
    micTest.own = mic;
  }
  micTest.busy = false;
  if (!micTest.on) { detachMicTest(); return; } // parou enquanto o microfone abria
  if (micTest.again) { micTest.again = false; return attachMicTest(); } // o filtro mudou enquanto abria
  const tap = mic.ctx.createGain();
  mic.gate.connect(tap);
  tap.connect(mic.ctx.destination);
  if (mic.ctx.state === 'suspended') mic.ctx.resume().catch(() => {});
  micTest.tap = tap;
  micTest.mic = mic;
  renderMicTest();
  syncMicTest(); // a voz pode ter começado ou acabado enquanto abria
}
// Entrou ou saiu da voz, ou o microfone da voz foi reaberto: troca para o microfone certo
function syncMicTest() {
  if (!micTest.on || micTest.busy) return;
  const want = voice.session ? micNow : micTest.own;
  if (!want || micTest.mic !== want) attachMicTest();
}
// Trocou o filtro fora da voz: abre o microfone do teste de novo, com o filtro novo
function refreshMicTest() {
  if (!micTest.on) return;
  if (micTest.busy) micTest.again = true;
  else if (micTest.own) attachMicTest();
}
function renderMicTest() {
  const btn = $('micTestBtn');
  if (!btn) return;
  btn.textContent = micTest.on ? 'Parar de ouvir' : 'Ouvir minha voz';
  btn.classList.toggle('primary', micTest.on);
  btn.setAttribute('aria-pressed', String(micTest.on));
  if (voiceSettingsOpen()) renderVoiceDialog();
}

// O microfone só manda som quando: não está desligado e (detecção de voz, ou a tecla está apertada)
const ptt = { down: false, active: 0, releaseTimer: null };
function applyMicGate() {
  const t = voice.stream?.getAudioTracks()[0];
  if (!t) return;
  // Segurando a tecla do comando de voz (comando-voz.js), a call não ouve
  t.enabled = !voice.muted && (voiceCfg.mode !== 'ptt' || ptt.down) && !(typeof comandoVoz === 'object' && comandoVoz.gravando);
}
function syncPtt() {
  const want = voice.session && voiceCfg.mode === 'ptt' ? voiceCfg.pttVk : 0;
  if (want === ptt.active) return;
  ptt.active = want;
  ptt.down = false;
  window.api.ptt(want).then((ok) => {
    if (ok || !want) return;
    toast(window.api.platform === 'linux'
      ? 'Não foi possível ligar o apertar para falar. No Linux ele precisa de uma sessão X11 e do xinput (sudo apt install xinput).'
      : 'Não foi possível ligar o apertar para falar (teclas.exe não encontrado).', 'error');
  }).catch(() => {});
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
  deafen: 'Silenciar ou voltar a ouvir as vozes (fone; desliga o microfone junto)',
  edit: 'Ajustar ou travar as janelas por cima do jogo',
  hideChat: 'Esconder ou mostrar o chat por cima do jogo',
  clip: 'Salvar clipe da transmissão (os últimos segundos, com o som; vai para Vídeos › Tela P2P › Clipes)',
  voiceCmd: 'Comando de voz: segure e fale (Configurações › Recursos extras)',
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

// Voz e atalhos é um grupo das configurações (abas Voz e Atalhos): abrir leva até ele; o medidor e o teste do
// microfone só correm com ele à vista (enterVoiceSettings/leaveVoiceSettings, chamados por showSettingsTab)
const voiceSettingsOpen = () => settingsOpenOn('voz');
function openVoiceDialog(tab = 'voice') { openGeneralSettings(tab); }
function closeVoiceDialog() { if (voiceSettingsOpen()) closeGeneralSettings(); }
function enterVoiceSettings() {
  renderVoiceDialog();
  renderMicList();
  window.api.getShortcuts().then((k) => { shortcutKeys = k || {}; renderShortcutRows(); }).catch(() => {});
  meterLoop();
}
function leaveVoiceSettings() {
  stopCapture();
  stopMicTest();
}

function renderVoiceDialog() {
  document.querySelectorAll('input[name="noise"]').forEach((r) => { r.checked = r.value === voiceCfg.ns; });
  document.querySelectorAll('input[name="talkMode"]').forEach((r) => { r.checked = r.value === voiceCfg.mode; });
  $('echoOn').checked = voiceCfg.echo;
  $('nsHint').textContent = {
    ia: 'Tira teclado, ventilador e barulho de fundo. Usa um pouco de processador.',
    chrome: 'Tira só chiado constante. Teclado e mouse passam.',
    off: 'Sem filtro de ruído.',
  }[voiceCfg.ns];
  $('pttRow').hidden = voiceCfg.mode !== 'ptt';
  $('pttKey').textContent = voiceCfg.pttVk ? voiceCfg.pttLabel : 'Nenhuma';
  $('modeHint').textContent = voiceCfg.mode === 'ptt'
    ? 'Só manda som enquanto você segura a tecla (ou o botão do mouse).'
    : 'Microfone aberto enquanto você está na voz.';
  $('micMeterBox').hidden = !voice.session && !micTest.own;
  $('gateAuto').checked = voiceCfg.gateAuto;
  $('gateDb').disabled = voiceCfg.gateAuto;
  if (!voiceCfg.gateAuto) { $('gateDb').value = String(voiceCfg.gateDb); $('gateMark').style.left = `${dbToPct(voiceCfg.gateDb)}%`; $('gateValue').textContent = `${voiceCfg.gateDb} dB`; }
  $('gateHint').textContent = voice.session || micTest.own
    ? 'Barulho abaixo da marca não passa.'
    : 'O medidor aparece na voz ou no teste.';
  $('vozesVolume').value = String(voiceCfg.vozes);
  $('vozesValue').textContent = voiceCfg.vozes ? `${voiceCfg.vozes}%` : 'Sem som';
  $('duckAmount').value = String(voiceCfg.duck);
  $('duckValue').textContent = voiceCfg.duck ? `${voiceCfg.duck}%` : 'Desligada';
  $('duckSelf').checked = voiceCfg.duckSelf;
  $('duckSelf').disabled = !voiceCfg.duck;
}

// Lista de microfones: o padrão do Windows (com o nome de qual é agora) e cada microfone ligado ao PC.
// O escolhido que foi desconectado continua na lista, marcado, até escolherem outro.
async function renderMicList() {
  let mics = [];
  try { mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch {}
  const real = mics.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications');
  const def = mics.find((d) => d.deviceId === 'default');
  const defName = def && (real.find((d) => d.groupId === def.groupId)?.label || def.label.replace(/^[^-]+ - /, ''));
  const opts = [['', defName ? `Padrão do Windows (${defName})` : 'Padrão do Windows']];
  for (const d of real) opts.push([d.deviceId, d.label || 'Microfone sem nome']);
  if (voiceCfg.micId && !real.some((d) => d.deviceId === voiceCfg.micId)) {
    opts.push([voiceCfg.micId, `${voiceCfg.micLabel || 'Microfone'} (desconectado, usando o padrão)`]);
  }
  $('micSelect').replaceChildren(...opts.map(([value, textContent]) => Object.assign(document.createElement('option'), { value, textContent })));
  $('micSelect').value = voiceCfg.micId;
}

function renderShortcutRows() {
  const box = $('shortcutRows');
  box.replaceChildren();
  for (const [action, name] of Object.entries(SHORTCUT_NAMES)) {
    if (action === 'voiceCmd' && !comandoVoz.ligado) continue; // só para quem ligou o recurso
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
  if (action === 'voiceCmd') renderComandoVozConfig(); // a tecla aparece em Recursos extras
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
  if (!voiceSettingsOpen()) return;
  const mic = micNow || micTest.own;
  // Verde: o microfone abriu e o som sai (na voz, também precisa não estar desligado ou esperando a tecla)
  const sending = mic === micTest.own || !!voice.stream?.getAudioTracks()[0]?.enabled;
  $('micMeter').style.width = `${mic ? dbToPct(mic.level) : 0}%`;
  $('micMeter').classList.toggle('open', !!mic && mic.gateOpen && sending);
  if (mic) {
    const th = gateThreshold(mic);
    $('gateMark').style.left = `${dbToPct(th)}%`;
    if (voiceCfg.gateAuto) $('gateDb').value = String(Math.round(th));
    $('gateValue').textContent = `${Math.round(th)} dB`;
  }
  $('micAmbient').textContent = mic ? `Ruído do ambiente: ${Math.round(mic.ambient)} dB` : '';
  requestAnimationFrame(meterLoop);
}
