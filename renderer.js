'use strict';

// ---------- Volume por pessoa e quem está falando ----------
// Cada pessoa tem um volume de voz (0 a 200%), um da transmissão (0 a 100%) e "silenciar para mim".
// Fica guardado pelo nome, então vale de novo na próxima sala.
let volumes = {};
try { volumes = JSON.parse(load('volumes', '{}')) || {}; } catch { volumes = {}; }
function volOf(id) {
  return { voice: 100, screen: 100, muted: false, ...(volumes[nameOf(id)] || {}) };
}
function setVol(id, patch) {
  const name = nameOf(id);
  const v = { ...volOf(id), ...patch };
  if (v.voice === 100 && v.screen === 100 && !v.muted) delete volumes[name];
  else volumes[name] = v;
  save('volumes', JSON.stringify(volumes));
  mixer.apply(id);
  applyScreenVolume(id);
  renderMembers();
  renderVoiceAvatars();
}
// O som da transmissão sai pelo <video> do quadro: o volume dele segue o da pessoa
// Atenuação: enquanto alguém fala na voz, o som das transmissões vai para duck.factor (e volta suave depois)
const duck = { factor: 1, timer: null, releaseAt: 0 };
function duckTarget() {
  const others = [...speaking].some((id) => id !== state.myId);
  const talking = others || (voiceCfg.duckSelf && speaking.has(state.myId));
  const now = performance.now();
  if (talking) duck.releaseAt = now + 500; // espera meio segundo de silêncio para voltar
  return voiceCfg.duck > 0 && (talking || now < duck.releaseAt) ? 1 - voiceCfg.duck / 100 : 1;
}
// Abaixa rápido (~150 ms) e volta devagar (~500 ms); o relógio só roda enquanto está atenuado
function updateDuck() {
  if (duck.timer) return;
  duck.timer = setInterval(() => {
    const target = duckTarget();
    if (target < duck.factor) duck.factor = Math.max(target, duck.factor - 0.12);
    else if (target > duck.factor) duck.factor = Math.min(target, duck.factor + 0.035);
    for (const id of state.in.keys()) applyScreenVolume(id);
    if (duck.factor === 1 && target === 1) { clearInterval(duck.timer); duck.timer = null; }
  }, 20);
}

function applyScreenVolume(id) {
  const link = state.in.get(id);
  const t = link?.tile;
  if (!t || link.self) return; // a sua própria tela fica sempre sem som
  const v = volOf(id);
  t.video.volume = (v.screen / 100) * duck.factor;
  t.vol.value = String(v.screen / 100);
  if (!t.paused) t.video.muted = v.muted;
  else t.mutedBefore = v.muted;
  t.syncMute();
}

// As vozes tocam por aqui: cada uma com o seu volume (acima de 100% também) e um medidor de nível
const mixer = {
  ctx: null,
  nodes: new Map(),   // id -> { src, gain, an }
  localNode: null,    // meu microfone: só o medidor
  deafened: false,
  ensure() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  meter(src) {
    const an = this.ctx.createAnalyser();
    an.fftSize = 2048; // ~43 ms de som por medida: não perde sílabas curtas
    src.connect(an);
    return an;
  },
  attach(id, stream) {
    this.detach(id);
    if (!stream || !stream.getAudioTracks().length) return;
    const ctx = this.ensure();
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(ctx.destination);
    this.nodes.set(id, { src, gain, an: this.meter(src) });
    this.apply(id);
    startSpeakLoop();
  },
  detach(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.src.disconnect();
    n.gain.disconnect();
    this.nodes.delete(id);
  },
  local(stream, keepMic = false) {
    if (this.localNode) { this.localNode.src.disconnect(); this.localNode = null; }
    if (!stream && !keepMic) closeMic(micNow);
    if (!stream) return;
    const ctx = this.ensure();
    const src = ctx.createMediaStreamSource(stream);
    this.localNode = { src, an: this.meter(src) };
    startSpeakLoop();
  },
  deafen(on) {
    this.deafened = !!on;
    for (const id of this.nodes.keys()) this.apply(id);
  },
  apply(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    const v = volOf(id);
    n.gain.gain.value = this.deafened || v.muted ? 0 : v.voice / 100;
  },
  level(an) {
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const x of buf) sum += x * x;
    return Math.sqrt(sum / buf.length);
  },
};

// Falando: nível acima do limite nos últimos 350 ms (o anel não pisca entre uma sílaba e outra)
let speaking = new Set();
const lastLoud = new Map();
let speakTimer = null;
function startSpeakLoop() {
  if (!speakTimer) speakTimer = setInterval(tickSpeak, 100);
}
function tickSpeak() {
  const now = performance.now();
  const next = new Set();
  const check = (id, an, silent) => {
    if (!silent && mixer.level(an) > 0.015) lastLoud.set(id, now);
    if (now - (lastLoud.get(id) || 0) < 350) next.add(id);
  };
  // Com o fone mutado (ou a pessoa silenciada / no 0% para você), ela não aparece falando: você não está ouvindo
  const unheard = (id) => { const v = volOf(id); return voice.deafened || v.muted || v.voice === 0; };
  for (const [id, n] of mixer.nodes) {
    if (unheard(id)) { lastLoud.delete(id); continue; }
    check(id, n.an, voice.members.get(id)?.muted);
  }
  if (mixer.localNode && state.myId) check(state.myId, mixer.localNode.an, voice.muted);
  if (!mixer.nodes.size && !mixer.localNode) { clearInterval(speakTimer); speakTimer = null; }
  if (next.size === speaking.size && [...next].every((id) => speaking.has(id))) return;
  speaking = next;
  renderSpeaking();
}

// Marca quem fala em todo lugar que mostra a pessoa: lista, barra, quadro de vídeo e janelas flutuantes
function renderSpeaking() {
  for (const el of document.querySelectorAll('[data-person]')) el.classList.toggle('speaking', speaking.has(el.dataset.person));
  $('peopleSpeak').hidden = ![...speaking].some((id) => id !== state.myId);
  for (const [id, link] of state.in) link.tile.el.classList.toggle('speaking', speaking.has(id));
  renderPipSpeaking();
  renderChatOverlay();
  updateDuck();
}

const inVoice = (id) => (id === state.myId ? !!voice.session : !!voice.members.get(id)?.session);

const voice = new VoiceChat({ send, changed: renderVoice, error: message => toast(message, 'error'), mixer });
function renderVoice() {
  const active = !!voice.session;
  const join = $('voiceJoin');
  join.disabled = !voice.supported;
  $('voiceDock').classList.toggle('active', active || voice.pending);
  if (active || voice.pending) {
    join.className = 'btn icon voice-leave';
    setIcon(join, 'phoneOff', voice.pending ? 'Cancelar entrada na voz' : 'Sair da voz');
  } else {
    join.className = 'btn';
    join.innerHTML = ICON.mic;
    join.append('Entrar na voz');
    join.title = !voice.supported ? 'O host precisa da versão 1.8.4 ou mais nova para ter voz' : 'Liga o microfone e entra na conversa por voz';
    join.removeAttribute('aria-label');
  }
  $('voiceMute').hidden = $('voiceDeafen').hidden = $('voiceMe').hidden = !active;
  setIcon($('voiceMute'), voice.muted ? 'micOff' : 'mic', voice.muted ? 'Ligar o microfone' : 'Desligar o microfone');
  $('voiceMute').setAttribute('aria-pressed', String(voice.muted));
  setIcon($('voiceDeafen'), voice.deafened ? 'headphonesOff' : 'headphones', voice.deafened ? 'Ouvir as vozes' : 'Silenciar as vozes');
  $('voiceDeafen').setAttribute('aria-pressed', String(voice.deafened));
  if (state.myId) $('voiceMe').dataset.person = state.myId;
  setIcon($('voiceSettingsBtn'), 'sliders', 'Voz e atalhos: supressão de ruído, eco, apertar para falar e teclas');
  applyMicGate();
  syncPtt();
  renderVoiceMe();
  if (!$('voiceDialog').hidden) renderVoiceDialog();
  renderVoiceAvatars();
  if (state.myId) renderMembers();
  if (!$('personCard').hidden) renderPersonCard();
}

// Painel recolhido: quem está na voz fica na barra; clicar abre o volume da pessoa
function renderVoiceAvatars() {
  const box = $('voiceAvatars');
  box.replaceChildren();
  const ids = [...voice.members].filter(([id, m]) => m.session && state.members.has(id)).map(([id]) => id);
  box.hidden = chat.open || !ids.length;
  for (const id of ids) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'voice-avatar';
    b.dataset.person = id;
    b.style.setProperty('--person', personColor(id));
    const nm = document.createElement('span');
    nm.className = 'va-name';
    nm.textContent = nameOf(id);
    b.append(nm, speakBars());
    const label = `${nameOf(id)}${voice.members.get(id).muted ? ', microfone desligado' : ''}. Mudar o volume`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.classList.toggle('mic-off', !!voice.members.get(id).muted);
    b.classList.toggle('speaking', speaking.has(id));
    b.onclick = (e) => openPersonCard(id, b, e.detail === 0);
    box.append(b);
  }
}

// ---------- Cartão da pessoa: volume da voz, da transmissão e silenciar para mim ----------
function openPersonCard(id, anchor, byKeyboard = false) {
  const card = $('personCard');
  if (!card.hidden && card.dataset.for === id) return closePersonCard();
  card.dataset.for = id;
  card.style.setProperty('--person', personColor(id));
  renderPersonCard();
  card.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight;
  const left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8);
  const top = r.bottom + 6 + h < innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  // Pelo teclado, o foco vai para o controle; com o mouse, fica onde estava
  if (byKeyboard) card.querySelector('input, button')?.focus();
}
function closePersonCard() {
  const card = $('personCard');
  if (card.hidden) return;
  card.hidden = true;
  delete card.dataset.for;
}
function renderPersonCard() {
  const card = $('personCard');
  const id = card.dataset.for;
  if (!id || !state.members.has(id)) return closePersonCard();
  const v = volOf(id);
  const name = nameOf(id);
  const watching = state.in.has(id);
  const focused = document.activeElement && card.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
  card.replaceChildren();
  const head = document.createElement('div');
  head.className = 'pc-head';
  const who = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = name;
  const sub = document.createElement('span');
  sub.textContent = v.muted ? 'Silenciada para você' : [inVoice(id) && 'Na voz', state.members.get(id)?.sharing && 'Transmitindo'].filter(Boolean).join(' · ') || 'Na sala';
  who.append(strong, sub);
  const av = avatar(name);
  av.dataset.person = id;
  av.classList.toggle('speaking', speaking.has(id));
  head.append(av, who);
  card.append(head);
  const slider = (label, key, max, show) => {
    if (!show) return;
    const row = document.createElement('label');
    row.className = 'pc-slider';
    const top = document.createElement('span');
    const text = document.createElement('span');
    text.textContent = label;
    const val = document.createElement('span');
    val.className = 'pc-val';
    val.textContent = v.muted ? 'mudo' : `${v[key]}%`;
    top.append(text, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0'; input.max = String(max); input.step = '5';
    input.value = String(v[key]);
    input.setAttribute('aria-label', `${label} de ${name}`);
    // Enquanto arrasta, só muda o som; o cartão não é redesenhado (o controle não perde o foco)
    input.oninput = () => {
      val.textContent = `${input.value}%`;
      const next = { ...volOf(id), [key]: Number(input.value), muted: false };
      volumes[name] = next;
      mixer.apply(id);
      applyScreenVolume(id);
    };
    input.onchange = () => setVol(id, { [key]: Number(input.value), muted: false });
    row.append(top, input);
    card.append(row);
  };
  slider('Voz', 'voice', 200, inVoice(id));
  slider('Som da transmissão', 'screen', 100, watching);
  if (!inVoice(id) && !watching) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = `${name} não está na voz e você não está assistindo a tela. O volume vale quando entrar.`;
    card.append(p);
  }
  const actions = document.createElement('div');
  actions.className = 'pc-actions';
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.className = 'btn small' + (v.muted ? ' warn-on' : '');
  mute.textContent = v.muted ? `Ouvir ${name} de novo` : 'Silenciar para mim';
  mute.setAttribute('aria-pressed', String(v.muted));
  mute.onclick = () => { setVol(id, { muted: !v.muted }); renderPersonCard(); card.querySelector('.pc-actions .btn')?.focus(); };
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn small ghost';
  reset.textContent = 'Voltar para 100%';
  reset.onclick = () => { setVol(id, { voice: 100, screen: 100, muted: false }); renderPersonCard(); };
  actions.append(mute, reset);
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = `Só muda o que você ouve. ${name} e o resto da sala não percebem.`;
  card.append(actions, note);
  if (focused) card.querySelector(`[aria-label="${CSS.escape(focused)}"]`)?.focus();
}
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

function toggleFullscreen(el) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else el.requestFullscreen().catch(() => {});
}

// Pede Opus em estéreo e com bitrate alto (melhor para música e jogos)
function enhanceOpus(sdp) {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!m) return sdp;
  const pt = m[1];
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (line, params) =>
    params.includes('stereo=1') ? line : `a=fmtp:${pt} ${params};stereo=1;sprop-stereo=1;maxaveragebitrate=192000`);
}

// Coloca o H.264 em primeiro lugar (a placa de vídeo codifica, a CPU fica livre).
// Se o PC não tiver H.264, fica o padrão do WebRTC (VP8).
function preferH264(pc) {
  const tr = pc.getTransceivers().find((t) => t.sender.track && t.sender.track.kind === 'video');
  if (!tr || !tr.setCodecPreferences || !RTCRtpReceiver.getCapabilities) return;
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs || [];
  if (!codecs.some((c) => c.mimeType.toLowerCase() === 'video/h264')) return;
  const rank = (c) => {
    const mime = c.mimeType.toLowerCase();
    if (mime === 'video/h264') return (c.sdpFmtpLine || '').includes('packetization-mode=1') ? 0 : 1;
    if (mime === 'video/vp8') return 2;
    if (['video/rtx', 'video/red', 'video/ulpfec', 'video/flexfec-03'].includes(mime)) return 9;
    return 5;
  };
  try { tr.setCodecPreferences([...codecs].sort((a, b) => rank(a) - rank(b))); } catch (e) { console.warn(e); }
}

function codecName(report, codecId) {
  const mime = (codecId && report.get(codecId)?.mimeType) || '';
  return { 'video/h264': 'H.264', 'video/vp8': 'VP8', 'video/vp9': 'VP9', 'video/av1': 'AV1' }[mime.toLowerCase()] || '';
}

// true = placa de vídeo, false = processador, null = não deu para saber
function usesHardware(efficient, impl) {
  if (typeof efficient === 'boolean') return efficient;
  if (!impl) return null;
  if (/mediafoundation|accelerator|external|nvenc|d3d/i.test(impl)) return true;
  if (/openh264|libvpx|libaom|ffmpeg|software/i.test(impl)) return false;
  return null;
}

// videoOff: quem assiste está com a janela minimizada, então o vídeo para (só o som continua)
// e a placa de vídeo deixa de codificar para essa pessoa.
async function applyBitrate(link) {
  const q = QUALITY[state.quality];
  for (const sender of link.pc.getSenders()) {
    if (!sender.track || sender.track.kind !== 'video') continue;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = q.bitrate;
    params.encodings[0].maxFramerate = q.fps;
    params.encodings[0].active = !link.videoOff;
    try { await sender.setParameters(params); } catch (e) { console.warn(e); }
  }
}

// ---------- Criar / entrar / sair da sala ----------
// Meus endereços (Radmin primeiro): a sala guarda para me achar se eu virar o host
async function myAddrs() {
  try {
    const ips = await window.api.getIps();
    return ips.map((i) => i.address);
  } catch { return []; }
}

async function connectRoom(url, hello, timeoutMs = 8000) {
  const addrs = await myAddrs();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let joined = false;
    let errMsg = null;
    const timer = setTimeout(() => {
      if (!joined) { errMsg = 'Tempo esgotado. Confira o endereço e se a Radmin VPN está ligada.'; ws.close(); }
    }, timeoutMs);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', ...hello, addrs, version: update.myVersion }));
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!joined) {
        if (m.type === 'welcome') { joined = true; clearTimeout(timer); state.ws = ws; resolve(m); }
        else if (m.type === 'error') errMsg = m.message;
        return;
      }
      onRoomMessage(m);
    };
    ws.onclose = (e) => {
      clearTimeout(timer);
      if (!joined) {
        reject(new Error(errMsg || 'Não foi possível conectar. Confira o endereço e se a Radmin VPN está ligada nos dois PCs.'));
      } else if (state.ws === ws) {
        // Sem quem roda o servidor, a sala passa para quem está nela há mais tempo
        if (e.reason !== 'room-closed' && state.handoff) migrateRoom(e.reason);
        else leaveRoom(e.reason === 'room-closed' ? 'O host encerrou a sala.' : 'A conexão com a sala caiu.', 'error');
      }
    };
  });
}

async function createRoom() {
  const port = parseInt($('roomPort').value, 10) || 8765;
  const password = $('roomPassword').value;
  save('roomPort', String(port));
  const btn = $('createBtn');
  setBusy(btn, true, 'Criando…');
  try {
    const res = await window.api.startServer(port, password);
    if (!res.ok) throw new Error(res.error);
    try {
      const welcome = await connectRoom(`ws://127.0.0.1:${port}`, { name: getName(), password });
      state.password = password;
      enterRoom(welcome, true, '127.0.0.1', port);
    } catch (err) {
      await window.api.stopServer();
      throw err;
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setBusy(btn, false, 'Criar sala');
  }
}

async function joinRoom() {
  const raw = $('roomAddr').value.trim().replace(/^ws:\/\//, '');
  if (!raw) return toast('Digite o endereço que aparece na tela de quem criou a sala.', 'error');
  const [host, portStr] = raw.split(':');
  const port = parseInt(portStr, 10) || 8765;
  save('roomAddr', raw);
  const btn = $('joinBtn');
  setBusy(btn, true, 'Entrando…');
  try {
    const welcome = await connectRoom(`ws://${host}:${port}`, { name: getName(), password: $('joinPassword').value });
    state.password = $('joinPassword').value;
    enterRoom(welcome, false, host, port);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setBusy(btn, false, 'Entrar');
  }
}

function enterRoom(welcome, owner, host, port) {
  state.myId = welcome.id;
  state.isOwner = owner;
  state.host = host;
  state.port = port;
  state.members.clear();
  for (const m of welcome.members) state.members.set(m.id, { name: m.name, sharing: m.sharing, version: m.version, addrs: m.addrs || [], shareInfo: m.shareInfo || null });
  state.hostId = welcome.hostId || null;
  state.handoff = (welcome.features || []).includes('handoff');
  state.order = [...welcome.members.map((m) => m.id), welcome.id];
  voice.reset(welcome);
  window.api.roomKeys(true).catch(() => {});
  renderLeaveBtn();
  resetChat(welcome);
  renderRoomAddress();
  renderMembers();
  renderShareBox();
  updateStage();
  show('room');
  perfStart();
  const live = welcome.members.filter((m) => m.sharing).length;
  if (live) toast(live === 1 ? '1 pessoa está transmitindo. Clique em Assistir para ver.' : `${live} pessoas estão transmitindo. Escolha quem assistir.`);
  checkUpdates();
}

// endRoom: o host encerra para todos; sem isso, ao sair ele passa a sala para quem está há mais tempo
function leaveRoom(reason, kind = 'info', endRoom = false) {
  if (!state.myId) return;
  voice.reset(null);
  const ws = state.ws;
  state.ws = null;
  state.migrating = false;
  clearTimeout(state.graceTimer);
  if (ws) { ws.onclose = null; ws.close(); }
  stopSharing();
  for (const id of [...state.in.keys()]) stopWatching(id, false);
  stopStats();
  closeStats();
  perfStop();
  if (state.isOwner) window.api.stopServer(endRoom);
  closeChatOverlay();
  closePersonCard();
  window.api.roomKeys(false).catch(() => {});
  resetChat(null);
  state.members.clear();
  state.myId = null;
  state.isOwner = false;
  state.hostId = null;
  state.order = [];
  closeShareDialog();
  $('closeDialog').hidden = true;
  if (update.busy) { clearTimeout(update.busy.timer); update.busy = null; }
  update.tried.clear();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  show('home');
  if (reason) toast(reason, kind);
}

function renderLeaveBtn() {
  const endsRoom = state.isOwner && !state.handoff;
  setIcon($('leaveBtn'), 'leave', endsRoom ? 'Encerrar sala (sai todo mundo)' : 'Sair da sala');
}

// Quem assume se o host sair: o mais antigo na sala (sem contar o host)
function successors() {
  return state.order.filter((id) => id !== state.hostId && (id === state.myId || state.members.has(id)));
}

// ---------- Troca de host ----------
// O servidor da sala roda no app do host. Se ele sai ou o app fecha, todo mundo calcula a mesma
// pessoa (a mais antiga): ela abre um servidor novo, na mesma porta, e os outros se conectam nela
// pelos endereços que ela tinha avisado. Cada um volta com o mesmo número, então as conexões diretas
// (quem assiste quem) continuam de pé e a tela não cai.
async function migrateRoom(reason) {
  const myId = state.myId;
  state.ws = null;
  state.migrating = true;
  const oldHost = state.hostId;
  const hostName = oldHost && oldHost !== myId ? nameOf(oldHost) : 'O host';
  // Talvez só a minha conexão tenha caído: tenta voltar para o mesmo host antes de trocar
  if (reason !== 'host-left' && !state.isOwner) {
    for (let i = 0; i < 2 && state.migrating; i++) {
      if (await rejoin(`${state.host}`, 2500)) return;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (!state.migrating || state.myId !== myId) return;
  if (oldHost && oldHost !== myId && state.members.has(oldHost)) onRoomMessage({ type: 'member-left', id: oldHost });
  state.hostId = null;
  const line = successors();
  toast(`${hostName} saiu. Passando a sala para ${line[0] === myId ? 'você' : nameOf(line[0])}…`);
  for (const id of line) {
    if (!state.migrating || state.myId !== myId) return;
    if (id === myId) {
      if (await becomeHost()) return;
      continue;
    }
    // Espera o próximo abrir a sala (até ~15 s), tentando cada endereço que ele avisou
    const addrs = (state.members.get(id)?.addrs || []).slice(0, 4);
    const until = Date.now() + 15000;
    while (Date.now() < until && state.migrating && state.members.has(id)) {
      for (const addr of addrs) if (await rejoin(addr, 2500)) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (state.migrating && state.myId === myId) leaveRoom('Não foi possível continuar a sala depois que o host saiu.', 'error');
}

async function becomeHost() {
  const known = [...state.members.keys(), state.myId].map(Number).filter(Number.isFinite);
  // Se o app do host acabou de cair, a porta pode levar um instante para ficar livre
  let res;
  for (let i = 0; i < 6; i++) {
    res = await window.api.startServer(state.port, state.password, { chat: chat.log, nextId: Math.max(0, ...known) + 1, hostId: state.myId });
    if (res.ok || !state.migrating) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!res.ok) { toast(res.error, 'error'); return false; }
  const ok = await rejoin('127.0.0.1', 4000);
  if (!ok) { await window.api.stopServer(); return false; }
  return true;
}

// Entra no servidor novo com o mesmo número e avisa se estou transmitindo
async function rejoin(host, timeoutMs) {
  const myId = state.myId;
  let welcome;
  try {
    welcome = await connectRoom(`ws://${host}:${state.port}`, {
      name: getName(), password: state.password, resume: myId, sharing: state.sharing, shareInfo: state.sharing ? state.shareInfo : undefined,
      voiceSession: voice.session || '', muted: voice.muted,
    }, timeoutMs);
  } catch { return false; }
  if (!state.migrating || state.myId !== myId) { state.ws?.close(); return false; }
  if (welcome.id !== myId) { // o servidor não aceitou o número: melhor sair do que misturar as conexões
    state.migrating = false;
    leaveRoom('Não foi possível continuar a sala depois que o host saiu.', 'error');
    return true;
  }
  state.migrating = false;
  const sameHost = !!state.hostId && state.hostId === welcome.hostId;
  state.isOwner = host === '127.0.0.1';
  state.host = host;
  state.hostId = welcome.hostId || null;
  state.handoff = (welcome.features || []).includes('handoff');
  if (!state.isOwner) save('roomAddr', `${host}:${state.port}`);
  const present = new Set(welcome.members.map((m) => m.id));
  for (const m of state.members.values()) delete m.back;
  for (const m of welcome.members) {
    const before = state.members.get(m.id);
    state.members.set(m.id, { name: m.name, sharing: m.sharing, version: m.version, addrs: m.addrs || [], shareInfo: m.shareInfo || null, back: true });
    if (!state.order.includes(m.id)) state.order.push(m.id);
    if (before && before.sharing && !m.sharing) stopWatching(m.id, false);
    voice.update(m.id, m.voiceSession || '', !!m.muted);
  }
  // Quem ainda não voltou tem um tempo para voltar; depois disso, conta como quem saiu
  clearTimeout(state.graceTimer);
  state.graceTimer = setTimeout(() => {
    for (const id of [...state.members.keys()]) {
      if (!state.members.get(id).back) onRoomMessage({ type: 'member-left', id });
    }
  }, 20000);
  renderLeaveBtn();
  renderRoomAddress();
  renderMembers();
  renderShareBox();
  updateStage();
  toast(sameHost ? 'Conexão com a sala de volta.' : state.isOwner ? 'Você agora é o host da sala.' : `${nameOf(state.hostId)} agora é o host da sala.`);
  return true;
}

function onRoomMessage(m) {
  switch (m.type) {
    case 'member-joined': {
      // Quem volta depois da troca de host continua de onde estava (mesmo número, mesmas conexões)
      const back = state.members.get(m.id);
      state.members.set(m.id, { name: m.name, sharing: !!m.sharing, version: m.version, addrs: m.addrs || [], shareInfo: m.shareInfo || null, back: true });
      if (!state.order.includes(m.id)) state.order.push(m.id);
      if (back && back.sharing && !m.sharing) stopWatching(m.id, false);
      voice.update(m.id, m.voiceSession || '', !!m.muted);
      renderMembers();
      updateStage();
      if (!back) toast(`${m.name} entrou na sala`);
      checkUpdates();
      break;
    }
    case 'member-left': {
      const name = nameOf(m.id);
      state.order = state.order.filter((id) => id !== m.id);
      voice.remove(m.id);
      if (update.busy?.from === m.id) cancelDownload();
      chatMemberLeft(m.id);
      closeOut(m.id);
      stopWatching(m.id, false);
      state.members.delete(m.id);
      renderMembers();
      updateStage();
      toast(`${name} saiu da sala`);
      break;
    }
    case 'share-state': {
      const mem = state.members.get(m.id);
      if (!mem) return;
      const started = m.sharing && !mem.sharing; // com sharing de novo, é só a configuração que mudou
      mem.sharing = m.sharing;
      mem.shareInfo = m.sharing ? m.info || null : null;
      if (started) toast(`${mem.name} começou a transmitir`);
      else if (!m.sharing) stopWatching(m.id, false);
      renderMembers();
      updateStage();
      break;
    }
    case 'voice-state':
      if (m.id === state.myId || state.members.has(m.id)) voice.update(m.id, m.session, m.muted);
      break;
    case 'signal':
      handleSignal(m.from, m.data || {});
      break;
    case 'chat':
      onChatMessage(m);
      break;
  }
}

// Cada par de PCs pode ter duas conexões (eu assisto você e você me assiste).
// O campo "side" diz de qual lado da conexão veio a mensagem.
function handleSignal(from, data) {
  if (data.side === 'voice') return voice.receive(from, data);
  if (data.side === 'viewer') {
    // Mensagem de alguém que assiste (ou quer assistir) a minha tela
    if (data.subscribe) return addWatcher(from, data.once === true);
    if (data.unsubscribe) return closeOut(from);
    const link = state.out.get(from);
    if (!link) return;
    if (typeof data.video === 'boolean') {
      link.videoOff = !data.video;
      onceVideoChanged(link);
      renderWatchers();
      link.chain = link.chain.then(() => applyBitrate(link)).catch(console.error);
      return;
    }
    link.chain = link.chain.then(async () => {
      if (data.sdp) {
        await link.pc.setRemoteDescription({ type: data.sdp.type, sdp: enhanceOpus(data.sdp.sdp) });
        await applyBitrate(link);
      } else if (data.candidate) {
        await link.pc.addIceCandidate(data.candidate);
      }
    }).catch(console.error);
  } else if (data.side === 'update') {
    onUpdateSignal(from, data);
  } else if (data.side === 'file') {
    onFileSignal(from, data);
  } else if (data.side === 'sharer') {
    // Mensagem de quem transmite uma tela que eu pedi para assistir
    const link = state.in.get(from);
    if (!link) return;
    if (data.unavailable) {
      stopWatching(from, false);
      return toast(`${nameOf(from)} não está mais transmitindo.`);
    }
    link.chain = link.chain.then(async () => {
      if (data.sdp) {
        await link.pc.setRemoteDescription(data.sdp);
        await link.pc.setLocalDescription(await link.pc.createAnswer());
        sendSignal(from, { side: 'viewer', sdp: link.pc.localDescription });
      } else if (data.candidate) {
        await link.pc.addIceCandidate(data.candidate);
      }
    }).catch(console.error);
  }
}

// Pedaços grandes pela sala (atualizações e arquivos do chat): sem pausa fixa entre as partes, porque com a
// janela minimizada o Chromium atrasa timers para 1 por segundo. Só espera se a conexão estiver muito cheia.
async function waitRoomBuffer() {
  while (state.ws && state.ws.bufferedAmount > 1_000_000) await new Promise((r) => setTimeout(r, 50));
}

// ---------- Atualizações pela sala ----------
// true se a versão a for mais nova que b ("1.2.10" > "1.2.9")
function newerVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// Procura na sala alguém com versão mais nova que a minha (e que a já baixada) e pede o pacote
function checkUpdates() {
  if (update.busy || !state.ws || !update.myVersion) return;
  const base = update.ready || update.myVersion;
  let best = null;
  for (const [id, m] of state.members) {
    if (!m.version || !newerVersion(m.version, base) || update.tried.has(`${id}@${m.version}`)) continue;
    if (!best || newerVersion(m.version, best.version)) best = { id, version: m.version };
  }
  if (!best) return;
  update.tried.add(`${best.id}@${best.version}`);
  update.busy = { from: best.id, version: best.version, parts: [], total: 0, sig: '', timer: setTimeout(cancelDownload, 60000) };
  sendSignal(best.id, { side: 'update', want: best.version });
}

function cancelDownload() {
  if (!update.busy) return;
  clearTimeout(update.busy.timer);
  update.busy = null;
  checkUpdates(); // tenta outra pessoa, se houver
}

async function sendUpdate(to, want) {
  const pack = want === update.myVersion && !update.sending.has(to) ? await window.api.getOwnPack() : null;
  if (!pack) return sendSignal(to, { side: 'update', unavailable: true });
  update.sending.add(to);
  const CHUNK = 48 * 1024;
  const total = Math.ceil(pack.pack.length / CHUNK);
  for (let part = 0; part < total && state.members.has(to); part++) {
    const msg = { side: 'update', version: want, part, total, data: pack.pack.slice(part * CHUNK, (part + 1) * CHUNK) };
    if (part === 0) msg.sig = pack.sig;
    sendSignal(to, msg);
    await waitRoomBuffer();
  }
  update.sending.delete(to);
}

async function onUpdateSignal(from, data) {
  if (data.want) return sendUpdate(from, String(data.want));
  const b = update.busy;
  if (!b || b.from !== from) return;
  if (data.unavailable) return cancelDownload();
  if (data.version !== b.version || !Number.isInteger(data.part) || !Number.isInteger(data.total)
      || data.total < 1 || data.total > 300 || data.part >= data.total || typeof data.data !== 'string') return;
  if (data.sig) b.sig = data.sig;
  b.total = data.total;
  b.parts[data.part] = data.data;
  if (b.parts.filter((p) => p !== undefined).length < b.total) return;

  clearTimeout(b.timer);
  update.busy = null;
  // O processo principal confere a assinatura antes de guardar qualquer coisa
  const res = await window.api.installUpdate(b.parts.join(''), b.sig);
  if (res.ok) {
    update.ready = res.version;
    renderUpdateBanner();
  } else {
    console.warn(`Atualização de ${nameOf(from)} recusada:`, res.error);
  }
  checkUpdates();
}

// ---------- Atualizações pelo GitHub ----------
// Procura a última versão publicada; se for mais nova, mostra o botão na tela inicial
async function checkGithub(manual = false) {
  const link = $('checkUpdates');
  link.disabled = true;
  link.textContent = 'Procurando…';
  const res = await window.api.githubCheck();
  link.disabled = false;
  link.textContent = 'Procurar atualização';
  if (!res.ok) {
    if (manual) toast(`Não deu para ver o GitHub: ${res.error}`, 'error');
    return;
  }
  const rel = res.release;
  if (!rel || !newerVersion(rel.version, update.ready || update.myVersion)) {
    update.github = null;
    renderUpdateBanner();
    if (manual) toast(update.ready ? `A versão ${update.ready} já está baixada. Reinicie para usar.` : 'Você já está na versão mais nova.');
    return;
  }
  if (update.github?.version !== rel.version) update.exePage = '';
  update.github = rel;
  if (manual) update.dismissed = '';
  renderUpdateBanner();
}

// ---------- Aviso de atualização ----------
// Um cartão no canto da tela, em qualquer tela do app. Um botão faz tudo: baixa do GitHub (se ainda
// não veio pela sala) e reinicia o app já na versão nova. "Depois" esconde até a próxima versão.
function updateMode() {
  if (update.ready) return { mode: 'ready', version: update.ready };
  if (update.github) return { mode: update.exePage ? 'exe' : 'github', version: update.github.version };
  return null;
}

function renderUpdateBanner() {
  const m = updateMode();
  const banner = $('updateBanner');
  if (!m || update.dismissed === m.version || update.installing) {
    banner.hidden = !update.installing;
    return;
  }
  const inRoom = !!state.myId;
  const leaves = inRoom ? ' Você sai da sala e o app abre de novo sozinho.' : ' O app fecha e abre de novo sozinho.';
  $('ubTitle').textContent = m.mode === 'ready' ? `Versão ${m.version} pronta` : `Versão ${m.version} disponível`;
  $('ubText').textContent = m.mode === 'ready' ? `Já está baixada.${leaves}`
    : m.mode === 'github' ? `Baixa em poucos segundos e atualiza.${leaves}`
    : 'Esta versão precisa do .exe novo. Baixe na página do GitHub e abra no lugar do antigo.';
  $('ubGo').textContent = m.mode === 'exe' ? 'Abrir no GitHub' : 'Atualizar agora';
  $('ubGo').disabled = false;
  $('ubLater').hidden = false;
  banner.hidden = false;
}

async function runUpdate() {
  const m = updateMode();
  if (!m) return;
  if (m.mode === 'exe') return window.api.openGithub(update.exePage);
  const go = $('ubGo');
  update.installing = true;
  $('ubLater').hidden = true;
  if (m.mode === 'github') {
    setBusy(go, true, 'Baixando…');
    $('ubText').textContent = 'Baixando a versão nova do GitHub…';
    const res = await window.api.githubInstall();
    if (!res.ok) {
      update.installing = false;
      if (res.page && /exe novo|pacote de atualização/.test(res.error)) {
        // Mudou algo que só um .exe novo traz (ex.: versão do Electron): manda para a página da versão
        update.exePage = res.page;
      } else {
        toast(`Não deu para atualizar: ${res.error}`, 'error');
      }
      return renderUpdateBanner();
    }
    update.ready = res.version;
  }
  setBusy(go, true, 'Reiniciando…');
  $('ubText').textContent = 'Abrindo a versão nova…';
  window.api.restartApp();
}

// ---------- Estatísticas ----------
// Processador e placa de vídeo do app (e do PC inteiro, que inclui o jogo), atualizados a cada segundo
let codecTimer = null;
const pct = (v) => `${(v || 0).toFixed(1).replace('.', ',')}%`;

const fpsText = (v) => `${Math.round(v || 0)} fps`;
const mbpsText = (v) => `${(v || 0).toFixed(1).replace('.', ',')} Mbps`;

// ---------- Desempenho ao longo do tempo ----------
// Enquanto você está numa sala, o capturador mede processador e placa de vídeo uma vez por segundo,
// com a janela de Estatísticas aberta ou não. Guarda 10 minutos para os gráficos e as médias de 30 s.
const PERF_KEEP = 600;
const PERF_AVG = 30;
const perf = {
  samples: [],
  last: null,     // última leitura completa (para a tabela por processo)
  since: 0,
  // números da transmissão agora, preenchidos por startOutStats e ensureStats
  live: { captureFps: null, sentFps: null, upMbps: 0, downMbps: 0 },
};

function perfStart() {
  perf.samples = [];
  perf.last = null;
  perf.since = Date.now();
  window.api.offStats();
  window.api.onStats(onPerfSample);
  window.api.statsStart();
}

function perfStop() {
  window.api.statsStop();
  window.api.offStats();
}

function onPerfSample(s) {
  const sum = (get) => s.procs.reduce((t, p) => t + get(p), 0);
  const gpu = (eng) => (s.gpuAvailable ? Math.min(sum((p) => p.gpu[eng] || 0), 100) : null);
  const gpuPC = (eng) => (s.gpuAvailable ? Math.min(s.gpuPC[eng] || 0, 100) : null);
  const live = perf.live;
  perf.samples.push({
    cpu: sum((p) => p.cpu), cpuPC: s.cpuPC,
    gpu3d: gpu('3D'), gpu3dPC: gpuPC('3D'),
    enc: gpu('VideoEncode'), encPC: gpuPC('VideoEncode'),
    dec: gpu('VideoDecode'), decPC: gpuPC('VideoDecode'),
    captureFps: state.sharing ? live.captureFps : null,
    sentFps: state.sharing ? live.sentFps : null,
    upMbps: state.sharing ? live.upMbps : 0,
    downMbps: state.in.size ? live.downMbps : 0,
  });
  if (perf.samples.length > PERF_KEEP) perf.samples.shift();
  perf.last = s;
  if (!$('statsDialog').hidden) renderStats();
}

// Média, mínimo e máximo dos últimos N segundos (só o que foi medido)
function perfWindow(key, secs = PERF_AVG) {
  const vals = perf.samples.slice(-secs).map((x) => x[key]).filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals) };
}

const STAT_CARDS = [
  { id: 'stCpu', key: 'cpu', pc: 'cpuPC', fmt: pct, max: 100, label: 'Processador' },
  { id: 'stGpu', key: 'gpu3d', pc: 'gpu3dPC', fmt: pct, max: 100, label: 'Placa de vídeo 3D' },
  { id: 'stEnc', key: 'enc', pc: 'encPC', fmt: pct, max: 100, label: 'Codificação de vídeo' },
  { id: 'stDec', key: 'dec', pc: 'decPC', fmt: pct, max: 100, label: 'Decodificação de vídeo' },
  { id: 'stCap', key: 'captureFps', fmt: fpsText, label: 'Quadros capturados', only: 'sharing' },
  { id: 'stSent', key: 'sentFps', fmt: fpsText, label: 'Quadros enviados', only: 'sharing' },
  { id: 'stUp', key: 'upMbps', fmt: mbpsText, label: 'Enviando' },
  { id: 'stDown', key: 'downMbps', fmt: mbpsText, label: 'Recebendo' },
];

// Linha dos últimos 10 minutos (o mais novo à direita); trechos sem medida ficam em branco
function drawSpark(svg, key, max, label, fmt) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 600, H = 60, step = W / (PERF_KEEP - 1);
  const vals = perf.samples.map((x) => x[key]);
  const top = max || Math.max(1, ...vals.filter((v) => typeof v === 'number')) * 1.15;
  svg.replaceChildren();
  const el = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
    return n;
  };
  el('rect', { class: 'band', x: W - step * PERF_AVG, y: 0, width: step * PERF_AVG, height: H });
  el('line', { class: 'base', x1: 0, y1: H - 1, x2: W, y2: H - 1 });
  let pts = [];
  const flush = () => { if (pts.length > 1) el('polyline', { points: pts.join(' ') }); pts = []; };
  vals.forEach((v, i) => {
    if (typeof v !== 'number') return flush();
    const x = (PERF_KEEP - vals.length + i) * step;
    const y = H - 2 - (Math.min(v, top) / top) * (H - 6);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  flush();
  const all = perfWindow(key, PERF_KEEP);
  const mins = Math.max(1, Math.round(perf.samples.length / 60));
  svg.setAttribute('aria-label', all
    ? `${label}, últimos ${mins} min: média ${fmt(all.avg)}, pico ${fmt(all.max)}`
    : `${label}: sem medidas ainda`);
}

// Abas das Estatísticas: Desempenho (uso do PC e rede) e Transmissão (cada pessoa que transmite)
let statsTab = 'perf';
function setStatsTab(tab, focus = false) {
  statsTab = tab;
  for (const [t, btn, panel] of [['perf', 'statsTabPerf', 'statsPerf'], ['stream', 'statsTabStream', 'statsStream']]) {
    $(btn).setAttribute('aria-selected', String(t === tab));
    $(btn).tabIndex = t === tab ? 0 : -1;
    $(panel).hidden = t !== tab;
  }
  if (focus) $(tab === 'perf' ? 'statsTabPerf' : 'statsTabStream').focus();
  renderStats();
}

const QUALITY_TEXT = (q) => {
  const m = /^(\d+)p(\d+)$/.exec(q || '');
  return m ? `${m[1]}p a ${m[2]} fps` : '–';
};

// Um cartão por pessoa transmitindo (você primeiro): a configuração dela e o que chega aqui
function streamCard(id) {
  const me = !id;
  const m = me ? null : state.members.get(id);
  const info = me ? state.shareInfo : m.shareInfo;
  const link = me ? null : state.in.get(id);
  const card = document.createElement('section');
  card.className = 'stream-card';
  card.style.setProperty('--person', personColor(id));
  const head = document.createElement('div');
  head.className = 'stream-head';
  const title = document.createElement('strong');
  title.textContent = me ? `${getName()} (você)` : m.name;
  const where = document.createElement('span');
  where.className = 'hint';
  const watchers = [...state.out.values()].filter((l) => l.pc.connectionState === 'connected').length;
  where.textContent = me
    ? (watchers ? `${watchers} ${watchers > 1 ? 'pessoas assistindo' : 'pessoa assistindo'}` : 'Ninguém assistindo agora')
    : !link ? 'Você não está assistindo'
      : state.pips.has(id) ? 'Na janela flutuante'
        : state.focus && state.focus !== id ? 'Em pausa para você'
          : 'Você está assistindo';
  head.append(title, where);

  const rows = [];
  const hw = (h) => (h === true ? ', placa de vídeo' : h === false ? ', processador' : '');
  if (info) {
    rows.push(['Qualidade escolhida', QUALITY_TEXT(info.quality)]);
    rows.push(['Codificação', info.mode === 'once' ? `Uma vez só para todos, ${info.engine || 'H.264'}${hw(info.hw)}` : `Uma por pessoa${hw(info.hw)}`]);
    rows.push(['Som do PC', info.audio ? 'Junto com a tela' : 'Sem som']);
  }
  if (me) {
    const live = perf.live;
    rows.push(['Capturando', typeof live.captureFps === 'number' ? fpsText(live.captureFps) : '–']);
    rows.push(['Enviando', watchers ? `${fpsText(live.sentFps)}, ${mbpsText(live.upMbps)}` : '–']);
  } else if (link?.rx && link.pc.connectionState === 'connected') {
    const r = link.rx;
    rows.push(['Chegando aqui', `${r.width || '–'}×${r.height || '–'}, ${fpsText(r.fps)}`]);
    rows.push(['Taxa', mbpsText(r.mbps)]);
    rows.push(['Codec', r.codec ? `${r.codec}${r.decoder ? `, decodificando pela ${r.decoder}` : ''}` : '–']);
    if (typeof r.lost === 'number') rows.push(['Pacotes perdidos', `${r.lost.toFixed(1).replace('.', ',')}%`]);
  }
  const dl = document.createElement('dl');
  dl.className = 'stream-grid';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    const pair = document.createElement('div');
    pair.append(dt, dd);
    dl.append(pair);
  }
  card.append(head);
  if (rows.length) card.append(dl);
  if (!me && !info) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'A configuração não chegou: quem transmite ou o host está numa versão antiga do app.';
    card.append(p);
  }
  return card;
}

function renderStreamStats() {
  const cards = [];
  if (state.sharing) cards.push(streamCard(null));
  for (const [id, m] of state.members) if (m.sharing) cards.push(streamCard(id));
  $('streamRows').replaceChildren(...cards);
  $('streamEmpty').hidden = cards.length > 0;
}

function openStats() {
  $('statsDialog').hidden = false;
  renderStats();
  renderCodecInfo();
  codecTimer = setInterval(renderCodecInfo, 1000);
  $('closeStats').focus();
}

function closeStats() {
  if ($('statsDialog').hidden) return;
  $('statsDialog').hidden = true;
  clearInterval(codecTimer);
}

function renderStats() {
  if (statsTab === 'stream') return renderStreamStats();
  const s = perf.last;
  const last = perf.samples[perf.samples.length - 1];
  for (const c of STAT_CARDS) {
    const now = last ? last[c.key] : null;
    const w = perfWindow(c.key);
    $(c.id).textContent = typeof now === 'number' ? c.fmt(now) : '–';
    $(`${c.id}Avg`).textContent = w
      ? `Média 30 s: ${c.fmt(w.avg)} · mín. ${c.fmt(w.min)} · pico ${c.fmt(w.max)}`
      : c.only === 'sharing' ? (state.sharing ? 'Ninguém assistindo agora' : 'Só enquanto você transmite')
        : s && !s.gpuAvailable && c.max ? 'O Windows não informou' : '';
    if (c.pc) {
      const pc = perfWindow(c.pc);
      $(`${c.id}PC`).textContent = pc ? `PC inteiro, média 30 s: ${c.fmt(pc.avg)}` : '';
    }
    drawSpark($(`${c.id}Chart`), c.key, c.max, c.label, c.fmt);
  }
  if (!s) {
    $('stNote').textContent = 'Medindo… As medidas começam quando você entra numa sala.';
    return;
  }

  const rows = [...s.procs].sort((a, b) => (b.cpu + (b.gpu['3D'] || 0)) - (a.cpu + (a.gpu['3D'] || 0)));
  const body = $('stRows');
  body.innerHTML = '';
  for (const p of rows) {
    const tr = document.createElement('tr');
    const cells = [p.label, pct(p.cpu), pct(p.gpu['3D']), pct(p.gpu.VideoEncode), pct(p.gpu.VideoDecode), `${p.gpuMemMB} MB`];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.append(td);
    }
    body.append(tr);
  }
  const secs = perf.samples.length;
  $('stNote').textContent = secs < PERF_AVG
    ? `Coletando há ${secs} s, desde que você entrou na sala. As médias usam os últimos 30 s.`
    : `Médias dos últimos 30 s (a faixa no fim de cada gráfico); gráficos dos últimos ${Math.min(10, Math.round(secs / 60)) || 1} min. Processador em % do PC inteiro (${s.cores} núcleos); "PC inteiro" inclui o jogo e outros programas.`;
}

// Qual codificador/decodificador o WebRTC está usando de verdade agora
async function renderCodecInfo() {
  const parts = [];
  const describe = async (links, type, implKey, hwKey) => {
    const seen = [];
    for (const link of links) {
      if (link.pc.connectionState !== 'connected') continue;
      let report;
      try { report = await link.pc.getStats(); } catch { continue; }
      report.forEach((r) => {
        if (r.type !== type || r.kind !== 'video' || !r.codecId) return;
        const codec = codecName(report, r.codecId) || '?';
        const size = r.frameWidth ? `, ${r.frameWidth}×${r.frameHeight} a ${Math.round(r.framesPerSecond || 0)} fps` : '';
        if (!r[implKey]) {
          // O Chromium só diz qual é o (de)codificador para quem está capturando a tela
          seen.push(`${codec}${size} (o Chromium não informa o decodificador para quem só assiste)`);
          return;
        }
        const hw = usesHardware(r[hwKey], r[implKey]);
        seen.push(`${codec} com ${r[implKey]}${hw === true ? ' (placa de vídeo)' : hw === false ? ' (processador)' : ''}${size}`);
      });
    }
    return seen;
  };
  const enc = await describe([...state.out.values()].filter((l) => !l.dc), 'outbound-rtp', 'encoderImplementation', 'powerEfficientEncoder');
  const dec = await describe([...state.in.values()].filter((l) => !l.once), 'inbound-rtp', 'decoderImplementation', 'powerEfficientDecoder');
  const where = (h) => (h ? 'placa de vídeo' : 'processador');
  const onceOut = [...state.out.values()].filter((l) => l.dc && l.dc.readyState === 'open').length;
  if (once.active && onceOut) {
    parts.push(`Transmitindo: H.264 com ${engineName()} (${where(once.hardware)}), ${once.width}×${once.height}, 1 codificação para ${onceOut} ${onceOut > 1 ? 'pessoas' : 'pessoa'}.`);
  }
  for (const link of state.in.values()) {
    if (link.once?.decoder) dec.push(`H.264 com WebCodecs (${where(link.once.hardware)}), ${link.once.width}×${link.once.height}`);
  }
  if (enc.length) parts.push(`Transmitindo: ${[...new Set(enc)].join(', ')}${enc.length > 1 ? ` (${enc.length} codificações, uma por pessoa)` : ''}.`);
  if (dec.length) parts.push(`Assistindo: ${[...new Set(dec)].join(', ')}.`);
  $('stCodec').textContent = parts.join(' ') || 'Sem vídeo agora. Transmita ou assista uma tela para ver qual codificador está em uso.';
}

// ---------- Painel da sala ----------
async function renderRoomAddress() {
  const box = $('roomAddress');
  box.innerHTML = '';
  let addrs;
  if (state.isOwner) {
    const ips = await window.api.getIps();
    const radmin = ips.filter((i) => i.radmin);
    $('noRadmin').hidden = radmin.length > 0;
    addrs = (radmin.length ? radmin : ips).map((i) => `${i.address}:${state.port}`);
  } else {
    $('noRadmin').hidden = true;
    addrs = [`${state.host}:${state.port}`];
  }
  for (const addr of addrs) {
    const row = document.createElement('div');
    row.className = 'addr';
    const code = document.createElement('code');
    code.textContent = addr;
    const copy = document.createElement('button');
    copy.className = 'btn small';
    copy.textContent = 'Copiar';
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(addr);
        copy.textContent = 'Copiado';
        setTimeout(() => { copy.textContent = 'Copiar'; }, 1500);
      } catch { toast('Não foi possível copiar. Selecione o endereço e use Ctrl+C.', 'error'); }
    };
    row.append(code, copy);
    box.append(row);
  }
  state.roomAddr = addrs[0] || '';
  $('dockAddrText').textContent = state.roomAddr;
  $('dockAddr').hidden = chat.open || !state.roomAddr;
}

// Cada pessoa tem uma cor (a mesma no chat e na lista); você é sempre o amarelo
// Cores do tema lan house usadas nas janelas que o app monta por código (flutuantes e chat por cima do jogo)
const THEME = {
  bg: '#22271E', sunken: '#1B1F17', card: '#2D3327', raised: '#3A4232', line: '#434C3A', field: '#6B7560',
  text: '#E4E9DD', muted: '#A9B29C', primary: '#D6C45C', onPrimary: '#221E06', accent: '#D6C45C',
  accentSoft: 'rgba(214, 196, 92, .16)', ok: '#A6D089', ink: '#1B1F17', glass: 'rgba(27, 31, 23, .9)',
  font: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
};
// Longe do amarelo (você) e do verde (quem fala), e legíveis sobre o oliva
const PERSON_COLORS = ['#E3A76F', '#8FC1E3', '#D59BD0', '#7FD1C1', '#B9C7F2', '#E6C3A0'];
function personColor(id) {
  if (!id || id === state.myId) return 'var(--accent)';
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}

function avatar(name) {
  const el = document.createElement('span');
  el.className = 'avatar';
  el.textContent = (name.trim()[0] || '?').toUpperCase();
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// As 3 barrinhas de quem fala (aparecem pelo CSS quando o elemento de cima está .speaking)
function speakBars() {
  const eq = document.createElement('span');
  eq.className = 'eq';
  eq.setAttribute('role', 'img');
  eq.setAttribute('aria-label', 'Falando');
  eq.innerHTML = '<span></span><span></span><span></span>';
  return eq;
}

// O mesmo gráfico nas janelas que o app monta por código (flutuante e chat por cima do jogo)
function speakBarsIn(d) {
  const eq = d.createElement('span');
  eq.setAttribute('role', 'img');
  eq.setAttribute('aria-label', 'Falando');
  Object.assign(eq.style, { display: 'inline-flex', alignItems: 'flex-end', gap: '2px', height: '11px' });
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (let i = 0; i < 3; i++) {
    const b = d.createElement('span');
    Object.assign(b.style, { width: '3px', height: '100%', borderRadius: '1px', background: THEME.ok, transformOrigin: 'bottom', transform: 'scaleY(.6)' });
    if (!still) b.animate([{ transform: 'scaleY(.3)' }, { transform: 'scaleY(1)' }, { transform: 'scaleY(.3)' }], { duration: 900, delay: i * 250, iterations: Infinity, easing: 'ease-in-out' });
    eq.append(b);
  }
  return eq;
}

// Nome de quem fala, com as barrinhas, para as janelas montadas por código
function talkerChip(d, id) {
  const el = d.createElement('span');
  Object.assign(el.style, {
    display: 'inline-flex', alignItems: 'center', gap: '7px', height: '24px', padding: '0 9px', borderRadius: '5px',
    background: 'rgba(20, 23, 17, .82)', border: `1px solid ${THEME.ok}`, color: THEME.text, fontSize: '12px', fontWeight: '600',
  });
  const dot = d.createElement('span');
  Object.assign(dot.style, { width: '8px', height: '8px', borderRadius: '2px', background: personColor(id) });
  el.append(dot, nameOf(id), speakBarsIn(d));
  el.title = `${nameOf(id)} está falando`;
  return el;
}

function memberRow(id, name, sharing) {
  const who = id || state.myId;
  const li = document.createElement('li');
  li.className = 'member' + (sharing ? ' live' : '');
  li.style.setProperty('--person', personColor(id));
  li.dataset.person = who;
  li.classList.toggle('speaking', speaking.has(who));
  const dot = avatar(id ? name : getName());
  const info = document.createElement('div');
  info.className = 'info';
  const nameEl = document.createElement('span');
  nameEl.className = 'mname';
  nameEl.textContent = name;
  nameEl.append(speakBars());
  const status = document.createElement('span');
  status.className = 'mstatus';
  const paused = id && state.focus && state.focus !== id && state.in.has(id);
  const inPip = id && state.pips.has(id);
  const voiceOn = inVoice(who);
  const micOff = voiceOn && (id ? !!voice.members.get(id)?.muted : voice.muted);
  const parts = [];
  if (who === state.hostId) parts.push('Host');
  if (sharing) parts.push(inPip ? 'Transmitindo · na janela flutuante' : paused ? 'Transmitindo, em pausa para você' : 'Transmitindo');
  if (voiceOn) parts.push(micOff ? 'na voz, microfone desligado' : 'na voz');
  status.textContent = parts.join(' · ') || 'Na sala';
  info.append(nameEl, status);
  li.append(dot, info);
  if (micOff) {
    const mo = document.createElement('span');
    mo.className = 'mic-off-icon';
    mo.innerHTML = ICON.micOff;
    mo.title = 'Microfone desligado';
    li.append(mo);
  }

  // Volume dessa pessoa para você (voz e/ou transmissão); mostra o valor quando não está em 100%
  if (id && (voiceOn || state.in.has(id))) {
    const v = volOf(id);
    const changed = v.muted || v.voice !== 100 || v.screen !== 100;
    const vb = document.createElement('button');
    vb.type = 'button';
    vb.className = 'btn small vol-btn' + (changed ? ' changed' : '');
    vb.innerHTML = v.muted ? ICON.muted : ICON.volume;
    const badge = v.muted ? 'mudo' : voiceOn && v.voice !== 100 ? `${v.voice}%` : !voiceOn && v.screen !== 100 ? `${v.screen}%` : '';
    if (badge) vb.append(badge);
    const label = `Volume de ${name}${v.muted ? ' (silenciada para você)' : badge ? ` (${badge})` : ''}`;
    vb.title = label;
    vb.setAttribute('aria-label', label);
    vb.setAttribute('aria-expanded', String($('personCard').dataset.for === id && !$('personCard').hidden));
    vb.onclick = (e) => openPersonCard(id, vb, e.detail === 0);
    li.append(vb);
  }

  if (!id && sharing && state.myId) {
    const watching = state.in.has(state.myId);
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = watching ? 'Parar de ver' : 'Ver';
    btn.title = watching ? 'Tirar a sua tela da sala' : 'Ver a sua própria transmissão, como um quadro na sala';
    btn.onclick = toggleSelfView;
    li.append(btn);
  }

  if (id && sharing) {
    const watching = state.in.has(id);
    const btn = document.createElement('button');
    btn.className = watching ? 'btn small' : 'btn small primary';
    btn.textContent = watching ? 'Parar' : 'Assistir';
    btn.onclick = () => (watching ? stopWatching(id) : watch(id));
    li.append(btn);
  }
  return li;
}

function renderMembers() {
  const list = $('members');
  list.innerHTML = '';
  $('memberCount').textContent = $('memberTitleCount').textContent = state.members.size + 1;
  $('peopleBtn').setAttribute('aria-label', `Pessoas na sala (${state.members.size + 1})`);
  $('peopleBtn').title = 'Pessoas na sala';
  const inVoiceCount = [...voice.members.values()].filter((m) => m.session).length + (voice.session ? 1 : 0);
  $('voiceCount').textContent = inVoiceCount ? `${inVoiceCount} na voz` : '';
  list.append(memberRow(null, `${getName()} (você)`, state.sharing));
  const others = [...state.members].sort((a, b) => Number(b[1].sharing) - Number(a[1].sharing));
  for (const [id, m] of others) list.append(memberRow(id, m.name, m.sharing));
}

function updateStage() {
  const othersSharing = [...state.members.values()].some((m) => m.sharing);
  $('emptyStage').hidden = state.in.size > 0;
  $('tiles').hidden = state.in.size === 0;
  $('emptyText').textContent = othersSharing
    ? 'Escolha na lista ao lado quem você quer assistir. A tela só começa a ser baixada depois que você clicar em Assistir.'
    : state.sharing
      ? 'Você está transmitindo. Quando outra pessoa começar, aparece um botão Assistir ao lado do nome dela.'
      : 'Ninguém está transmitindo agora. Quando alguém começar, aparece um botão Assistir ao lado do nome.';
  if (!state.in.size) $('downloadInfo').textContent = '';
}

// ---------- Assistir ----------
function createTile(id, name) {
  const el = document.createElement('div');
  el.className = 'tile';
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';
  overlay.textContent = 'Conectando…';
  // Faixa de título em cima do vídeo: o nome e, quando a pessoa fala, as barrinhas
  const label = document.createElement('div');
  label.className = 'tile-name';
  label.style.setProperty('--person', personColor(id));
  const labelText = document.createElement('span');
  labelText.className = 'tile-name-text';
  labelText.textContent = name;
  label.append(labelText, speakBars());
  const bar = document.createElement('div');
  bar.className = 'tile-bar';
  const barSpace = document.createElement('span');
  barSpace.className = 'tile-bar-space';
  const mute = document.createElement('button');
  mute.className = 'btn icon';
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.className = 'tile-vol';
  vol.min = '0'; vol.max = '1'; vol.step = '0.01'; vol.value = '1';
  vol.setAttribute('aria-label', `Volume de ${name}`);
  const syncMute = () => {
    const silent = video.muted || video.volume === 0;
    setIcon(mute, silent ? 'muted' : 'volume', silent ? `Ativar o som de ${name}` : `Silenciar ${name}`);
  };
  vol.oninput = () => {
    video.volume = parseFloat(vol.value) * duck.factor;
    if (video.volume > 0) video.muted = false;
    syncMute();
  };
  // O volume do quadro fica guardado como o "som da transmissão" dessa pessoa
  vol.onchange = () => setVol(id, { screen: Math.round(parseFloat(vol.value) * 100), muted: false });
  mute.onclick = () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) { video.volume = 1; vol.value = '1'; }
    syncMute();
  };
  syncMute();
  const pipBtn = document.createElement('button');
  pipBtn.className = 'btn icon';
  setIcon(pipBtn, 'pip', 'Abrir em janela flutuante (fica por cima do jogo)');
  pipBtn.onclick = () => togglePip(id);
  const focusBtn = document.createElement('button');
  focusBtn.className = 'btn icon';
  focusBtn.hidden = true; // só com 2 ou mais transmissões abertas
  focusBtn.onclick = () => setFocus(state.focus === id ? null : id);
  const fs = document.createElement('button');
  fs.className = 'btn icon';
  setFsIcon(fs, false);
  fs.onclick = () => toggleFullscreen(el);
  const close = document.createElement('button');
  close.className = 'btn icon';
  setIcon(close, 'close', 'Parar de assistir');
  close.onclick = () => stopWatching(id);
  bar.append(barSpace, mute, vol, pipBtn, focusBtn, fs, close);
  // Aviso no lugar do vídeo enquanto ele está na janela flutuante
  const pipNote = document.createElement('div');
  pipNote.className = 'tile-pip-note';
  pipNote.hidden = true;
  const pipIcon = document.createElement('span');
  pipIcon.innerHTML = ICON.pip;
  const pipTitle = document.createElement('strong');
  pipTitle.textContent = 'Picture in picture ativado, transmissão pausada';
  const pipText = document.createElement('span');
  pipText.textContent = `${name} está na janela flutuante, por cima do jogo. O som continua saindo por aqui.`;
  const pipActions = document.createElement('div');
  pipActions.className = 'pip-note-actions';
  const pipBack = document.createElement('button');
  pipBack.type = 'button';
  pipBack.className = 'btn primary';
  pipBack.textContent = 'Trazer de volta';
  pipBack.onclick = () => closePip(id);
  const pipAdjust = document.createElement('button');
  pipAdjust.type = 'button';
  pipAdjust.className = 'btn';
  pipAdjust.textContent = 'Ajustar janela';
  pipAdjust.onclick = () => window.api.pipSetEdit(true);
  pipActions.append(pipBack, pipAdjust);
  const pipHint = document.createElement('span');
  pipHint.className = 'hint';
  pipHint.textContent = 'ou Ctrl+Shift+E de dentro do jogo';
  pipNote.append(pipIcon, pipTitle, pipText, pipActions, pipHint);
  const body = document.createElement('div');
  body.className = 'tile-body';
  body.append(video, overlay, pipNote, bar);
  el.append(label, body);
  el.addEventListener('dblclick', (e) => { if (!bar.contains(e.target) && !el.classList.contains('small')) toggleFullscreen(el); });
  // Na coluna ao lado, clicar (ou Enter) numa tela pequena põe ela em destaque
  el.addEventListener('click', () => { if (el.classList.contains('small')) setMain(id); });
  el.addEventListener('keydown', (e) => {
    if (el.classList.contains('small') && e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setMain(id); }
  });
  $('tiles').append(el);
  el.dataset.person = id;
  return { el, video, vol, overlay, pipNote, fs, focusBtn, pipBtn, syncMute, name, paused: false, mutedBefore: false };
}

// Mostra a barra do vídeo por alguns segundos, para quem nunca passou o mouse em cima descobrir os botões
function revealBar(tile) {
  tile.el.classList.add('show-bar');
  clearTimeout(tile.barTimer);
  tile.barTimer = setTimeout(() => tile.el.classList.remove('show-bar'), 4000);
}

function watch(id) {
  if (state.in.has(id) || !state.members.get(id)?.sharing) return;
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const tile = createTile(id, nameOf(id));
  const link = { pc, chain: Promise.resolve(), tile, lastBytes: 0, lastTs: 0, videoOn: true, tracks: [], once: null };
  state.in.set(id, link);
  applyScreenVolume(id); // o volume que você deixou para essa pessoa da última vez

  pc.ontrack = (e) => {
    if (e.track.kind === 'video') setVideoTrack(link, e.track);
    else { link.tracks.push(e.track); refreshTileStream(link); }
  };
  // Quem transmite no modo "uma vez só" manda o vídeo já codificado por este canal
  pc.ondatachannel = (e) => { if (e.channel.label === 'video') setupOnceReceiver(link, e.channel); };
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal(id, { side: 'viewer', candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    const o = tile.overlay;
    if (s === 'connected') {
      if (!o.hidden) revealBar(tile);
      o.hidden = true;
    } else {
      o.hidden = false;
      o.textContent = s === 'failed'
        ? 'A conexão direta falhou. Confira a Radmin VPN e libere o app no Firewall do Windows nos dois PCs.'
        : s === 'disconnected' ? 'Conexão instável, tentando recuperar…' : 'Conectando…';
    }
  };

  sendSignal(id, { side: 'viewer', subscribe: true, once: onceSupportedForViewer() });
  if (document.hidden) onVisibility(); // começou a assistir com a janela já oculta: pausa o vídeo também
  if (state.focus) state.focus = id;   // pediu para assistir alguém durante o destaque: essa pessoa vira o destaque
  renderFocus();
  renderMembers();
  updateStage();
  ensureStats();
}

// ---------- Ver a própria transmissão ----------
// Você vira um quadro como os outros (com destaque e janela flutuante), sem conexão: o vídeo é a própria
// captura, sem som (não volta para você). No NVENC direto, que não usa a captura do Chromium, pega uma
// captura leve da mesma fonte só para ver.
const SELF_PC = { connectionState: 'connected', getStats: async () => new Map(), getSenders: () => [], close() {} };

async function selfTrack(link) {
  link.ownTrack?.stop();
  link.ownTrack = null;
  const t = state.stream?.getVideoTracks().find((x) => x.readyState === 'live');
  if (t) return t;
  try {
    await window.api.selectSource(state.sharingSource, false);
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 30 } }, audio: false });
    link.ownTrack = s.getVideoTracks()[0];
    return link.ownTrack;
  } catch (err) {
    toast(`Não deu para mostrar a sua tela: ${err.message}`, 'error');
    return null;
  }
}

async function watchSelf() {
  const id = state.myId;
  if (!state.sharing || !id || state.in.has(id)) return;
  const tile = createTile(id, `${getName()} (você)`);
  tile.overlay.hidden = true;
  tile.video.muted = true;
  tile.vol.hidden = true;
  tile.el.querySelector('.tile-bar .btn.icon').hidden = true; // o botão de silenciar: não tem som
  const link = { self: true, pc: SELF_PC, tile, videoOn: true, tracks: [], once: null, lastBytes: 0, lastTs: 0 };
  state.in.set(id, link);
  if (state.focus) state.focus = id;
  renderFocus();
  renderMembers();
  updateStage();
  renderShareBox();
  const track = await selfTrack(link);
  if (state.in.get(id) !== link) { link.ownTrack?.stop(); return; }
  if (!track) return stopWatching(id, false);
  setVideoTrack(link, track);
}

// Trocou a fonte no meio: o quadro passa a mostrar a nova
async function refreshSelfView() {
  const link = state.in.get(state.myId);
  if (!link?.self) return;
  const track = await selfTrack(link);
  if (track && state.in.get(state.myId) === link) setVideoTrack(link, track);
}

function toggleSelfView() {
  if (state.in.has(state.myId)) stopWatching(state.myId, false);
  else watchSelf();
}

function stopWatching(id, notify = true) {
  const link = state.in.get(id);
  if (!link) return;
  if (link.self) { notify = false; link.ownTrack?.stop(); }
  if (notify) sendSignal(id, { side: 'viewer', unsubscribe: true });
  if (state.pips.has(id)) closePip(id);
  if (document.fullscreenElement === link.tile.el) document.exitFullscreen().catch(() => {});
  closeOnceReceiver(link);
  link.pc.close();
  link.tile.video.srcObject = null;
  link.tile.el.remove();
  state.in.delete(id);
  if (state.focus === id) state.focus = null; // quem estava em destaque saiu: as outras voltam
  renderFocus();
  renderMembers();
  updateStage();
  if (link.self) renderShareBox();
}

// ---------- Chat ----------
// Mensagens passam pelo servidor da sala (que guarda as últimas 100 para quem entrar depois). Um arquivo
// anexado fica no PC de quem mandou; quem clica em Baixar recebe direto dele, em pedaços, pela sala.
const CHAT_MAX_FILE = 200 * 1024 * 1024;
const CHAT_AUTO_IMAGE = 8 * 1024 * 1024;
const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const FILE_CHUNK = 48 * 1024;
const chat = {
  open: true,             // painel (pessoas + chat) aberto
  log: [],                // as últimas 100 mensagens, como vieram do servidor
  lastMsg: null,          // para agrupar mensagens seguidas da mesma pessoa
  divider: null,          // linha "N mensagens novas"
  sending: new Set(),     // "pessoa|arquivo" que estou mandando agora (Cancelar do outro lado para)
  supported: false,
  unread: 0,
  files: new Map(),       // id -> File que eu anexei (disponível enquanto eu estiver na sala)
  downloads: new Map(),   // id -> { from, file, chunks, got, bytes, card }
  cards: new Map(),       // id do arquivo -> partes do cartão na tela
  urls: [],               // blob: criados, para liberar ao sair
};

const two = (n) => String(n).padStart(2, '0');
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// Painel (endereço, pessoas e chat) aberto ou recolhido pelo balão da barra
function setPanelOpen(open) {
  chat.open = open;
  save('panelOpen', open ? '1' : '0');
  $('roomGrid').classList.toggle('panel-closed', !open);
  $('chatToggle').setAttribute('aria-pressed', String(open));
  $('dockAddr').hidden = open || !state.roomAddr;
  if (open && chatAtBottom()) markRead();
  renderUnread();
  renderVoiceAvatars();
  closePersonCard();
  setPeopleOpen(false);
}

// Lista de pessoas: abre pelo botão no topo do chat, por cima das mensagens
function setPeopleOpen(open) {
  $('peoplePop').hidden = !open;
  $('peopleBtn').setAttribute('aria-expanded', String(open));
  if (!open) closePersonCard();
}

function chatAtBottom() {
  const l = $('chatList');
  return l.scrollHeight - l.scrollTop - l.clientHeight < 40;
}

function scrollChatToEnd() {
  const l = $('chatList');
  l.scrollTop = l.scrollHeight;
}

function markRead() {
  if (!chat.unread) return;
  chat.unread = 0;
  renderUnread();
}

function renderUnread() {
  const n = chat.unread;
  $('chatUnread').hidden = !n;
  $('chatUnread').textContent = n > 99 ? '99+' : String(n);
  const label = chat.open ? 'Recolher o painel da sala'
    : n ? `Abrir o chat (${n} ${n === 1 ? 'mensagem nova' : 'mensagens novas'})` : 'Abrir o painel da sala e o chat';
  $('chatToggle').title = label;
  $('chatToggle').setAttribute('aria-label', label);
  $('chatJump').hidden = !n || !chat.open || chatAtBottom();
}

function resetChat(welcome) {
  for (const u of chat.urls) URL.revokeObjectURL(u);
  chat.urls = [];
  chat.files.clear();
  chat.downloads.clear();
  chat.cards.clear();
  chat.sending.clear();
  chat.unread = 0;
  chat.lastMsg = null;
  chat.divider = null;
  chat.supported = !!welcome && Array.isArray(welcome.features) && welcome.features.includes('chat');
  chat.log = ((welcome && welcome.chat) || []).slice(-100);
  $('chatList').innerHTML = '';
  $('chatOff').hidden = !welcome || chat.supported;
  $('chatInput').disabled = $('chatSend').disabled = $('chatAttach').disabled = !chat.supported;
  for (const m of (welcome && welcome.chat) || []) appendMessage(m, false);
  $('chatEmpty').hidden = !!$('chatList').children.length || !chat.supported;
  setPanelOpen(load('panelOpen', '1') !== '0');
  requestAnimationFrame(scrollChatToEnd);
}

function onChatMessage(m) {
  // Cópia da conversa: se eu virar o host, o novo servidor continua daqui
  const { type, ...entry } = m;
  chat.log.push(entry);
  if (chat.log.length > 100) chat.log.shift();
  renderChatOverlay();
  const wasBottom = chatAtBottom();
  const unseen = m.from !== state.myId && (!chat.open || document.hidden || !wasBottom);
  if (unseen && !chat.unread) {
    // Começa um lote de novas: a linha "mensagens novas" vai antes desta
    if (chat.divider) chat.divider.remove();
    chat.divider = document.createElement('li');
    chat.divider.className = 'new-divider';
    $('chatList').append(chat.divider);
    chat.lastMsg = null;
  }
  appendMessage(m, true);
  $('chatEmpty').hidden = true;
  if (m.from === state.myId || (chat.open && wasBottom && !document.hidden)) scrollChatToEnd();
  if (unseen) {
    chat.unread++;
    chat.divider.textContent = `${chat.unread} ${chat.unread === 1 ? 'mensagem nova' : 'mensagens novas'}`;
    if (!chat.open) toast(`${m.name}: ${m.text || `mandou ${m.file.name}`}`);
  }
  renderUnread();
}

// Texto sempre como texto; só endereços http(s) viram link, que abre no navegador
function textWithLinks(p, text) {
  for (const part of text.split(/(https?:\/\/[^\s]+)/i)) {
    if (!/^https?:\/\//i.test(part)) { p.append(part); continue; }
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = part;
    a.title = 'Abrir no navegador';
    a.onclick = (e) => { e.preventDefault(); window.api.openLink(part); };
    p.append(a);
  }
}

// Mensagens seguidas da mesma pessoa (em até 5 min) ficam juntas, sem repetir nome e hora
function appendMessage(m, live) {
  const mine = m.from === state.myId;
  const prev = chat.lastMsg;
  const grouped = !!prev && prev.from === m.from && m.ts - prev.ts < 5 * 60 * 1000;
  const li = document.createElement('li');
  li.className = 'msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '');
  const name = mine ? 'Você' : m.name;
  li.style.setProperty('--person', personColor(m.from));
  const d = new Date(m.ts);
  const when = document.createElement('time');
  when.className = 'msg-time';
  when.textContent = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const line = document.createElement('p');
  line.className = 'msg-line';
  const who = document.createElement('strong');
  who.className = 'msg-who';
  who.textContent = name;
  const sep = document.createElement('span');
  sep.className = 'msg-sep';
  sep.textContent = ' : ';
  line.append(who, sep);
  if (m.text) {
    const text = document.createElement('span');
    text.className = 'msg-text';
    textWithLinks(text, m.text);
    line.append(text);
  }
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.append(line);
  if (m.file) body.append(fileCard(m, live));
  li.append(when, body);
  $('chatList').append(li);
  chat.lastMsg = { from: m.from, ts: m.ts };
}

// Cartão de arquivo: ícone, nome, tamanho/estado, botão (Baixar, Cancelar, Salvar) e barra de progresso
function fileCard(m, live) {
  const f = m.file;
  const mine = m.from === state.myId;
  const card = document.createElement('div');
  card.className = 'file-card';
  const row = document.createElement('div');
  row.className = 'file-row';
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.innerHTML = ICON.doc;
  const info = document.createElement('div');
  info.className = 'file-info';
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = f.name;
  name.title = f.name;
  const meta = document.createElement('span');
  meta.className = 'file-meta';
  info.append(name, meta);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small primary';
  btn.textContent = 'Baixar';
  row.append(icon, info);
  const bar = document.createElement('div');
  bar.className = 'file-bar';
  bar.hidden = true;
  const fill = document.createElement('span');
  bar.append(fill);
  card.append(row, bar);
  const parts = { card, row, icon, meta, bar, fill, btn, f, from: m.from, state: 'offer' };
  chat.cards.set(f.id, parts);

  const local = mine && chat.files.get(f.id);
  if (local) {
    parts.state = 'mine';
    meta.textContent = `${formatBytes(f.size)} · disponível enquanto você estiver na sala`;
    if (CHAT_IMAGE_TYPES.includes(f.mime)) showImage(parts, URL.createObjectURL(local));
  } else if (mine) {
    setCardGone(parts, 'enviado antes de você reabrir o app, não está mais disponível');
  } else if (!state.members.has(m.from)) {
    setCardGone(parts, 'Quem mandou saiu da sala');
  } else {
    meta.textContent = formatBytes(f.size);
    btn.onclick = () => requestFile(m.from, f);
    row.append(btn);
    // Imagem pequena chega sozinha e aparece no chat
    if (live && CHAT_IMAGE_TYPES.includes(f.mime) && f.size <= CHAT_AUTO_IMAGE) requestFile(m.from, f);
  }
  return card;
}

function setCardGone(parts, text) {
  parts.state = 'gone';
  parts.card.classList.add('gone');
  parts.icon.innerHTML = ICON.warn;
  parts.bar.hidden = true;
  parts.btn.remove();
  parts.meta.textContent = text;
}

function showImage(parts, url) {
  if (!chat.urls.includes(url)) chat.urls.push(url);
  const img = document.createElement('img');
  img.src = url;
  img.alt = parts.f.name;
  parts.card.insertBefore(img, parts.card.firstChild);
}

function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text || !chat.supported) return;
  send({ type: 'chat', text });
  input.value = '';
  fitChatInput();
}

function attachFiles(list) {
  if (!chat.supported) return;
  for (const file of list) {
    if (!file.size) continue;
    if (file.size > CHAT_MAX_FILE) { toast(`${file.name} passa de 200 MB e não pode ser enviado pelo chat.`, 'error'); continue; }
    const id = crypto.randomUUID();
    chat.files.set(id, file);
    send({ type: 'chat', file: { id, name: file.name, size: file.size, mime: file.type } });
  }
}

function fitChatInput() {
  const t = $('chatInput');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
}

function requestFile(from, f) {
  if (chat.downloads.has(f.id)) return;
  const parts = chat.cards.get(f.id);
  chat.downloads.set(f.id, { from, file: f, chunks: [], got: 0, bytes: 0 });
  if (parts) {
    parts.state = 'downloading';
    parts.btn.textContent = 'Cancelar';
    parts.btn.className = 'btn small';
    parts.btn.onclick = () => cancelFile(f.id);
    parts.bar.hidden = false;
    parts.fill.style.width = '0%';
    parts.meta.textContent = `Pedindo a ${nameOf(from)}…`;
  }
  sendSignal(from, { side: 'file', want: f.id });
}

// Cancelar: avisa quem manda para parar, e o cartão volta a oferecer o Baixar
function cancelFile(id) {
  const dl = chat.downloads.get(id);
  if (!dl) return;
  chat.downloads.delete(id);
  sendSignal(dl.from, { side: 'file', cancel: id });
  const parts = chat.cards.get(id);
  if (!parts) return;
  parts.state = 'offer';
  parts.bar.hidden = true;
  parts.btn.textContent = 'Baixar';
  parts.btn.className = 'btn small primary';
  parts.btn.onclick = () => requestFile(dl.from, dl.file);
  parts.meta.textContent = formatBytes(dl.file.size);
}

function fileFailed(id, text) {
  chat.downloads.delete(id);
  const parts = chat.cards.get(id);
  if (parts) setCardGone(parts, `${formatBytes(parts.f.size)} · ${text}`);
}

async function streamFile(to, id, file) {
  const key = `${to}|${id}`;
  chat.sending.add(key);
  const total = Math.max(1, Math.ceil(file.size / FILE_CHUNK));
  for (let part = 0; part < total && state.members.has(to) && chat.files.has(id) && chat.sending.has(key); part++) {
    const buf = new Uint8Array(await file.slice(part * FILE_CHUNK, (part + 1) * FILE_CHUNK).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    sendSignal(to, { side: 'file', fileId: id, part, total, data: btoa(bin) });
    await waitRoomBuffer();
  }
  chat.sending.delete(key);
}

function onFileSignal(from, data) {
  if (typeof data.want === 'string') {
    const file = chat.files.get(data.want);
    if (!file) return sendSignal(from, { side: 'file', fileId: data.want, unavailable: true });
    streamFile(from, data.want, file).catch((e) => console.warn(e));
    return;
  }
  if (typeof data.cancel === 'string') return void chat.sending.delete(`${from}|${data.cancel}`);
  const dl = chat.downloads.get(data.fileId);
  if (!dl || dl.from !== from) return;
  if (data.unavailable) return fileFailed(data.fileId, 'não está mais disponível (quem mandou reabriu o app)');
  if (!Number.isInteger(data.part) || data.part !== dl.got || typeof data.data !== 'string') return fileFailed(data.fileId, 'o download falhou, tente de novo');
  const bin = atob(data.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  dl.chunks.push(bytes);
  dl.got++;
  dl.bytes += bytes.length;
  const parts = chat.cards.get(data.fileId);
  if (parts) {
    const pct = Math.min(100, Math.round((dl.bytes / dl.file.size) * 100));
    parts.fill.style.width = `${pct}%`;
    parts.meta.textContent = `${formatBytes(dl.bytes)} de ${formatBytes(dl.file.size)} · ${pct}%`;
  }
  if (dl.got < data.total) return;

  chat.downloads.delete(data.fileId);
  if (dl.bytes !== dl.file.size) return fileFailed(data.fileId, 'chegou incompleto, tente de novo');
  const blob = new Blob(dl.chunks, { type: dl.file.mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  chat.urls.push(url);
  if (!parts) return;
  parts.state = 'done';
  parts.card.classList.add('done');
  parts.icon.innerHTML = ICON.check;
  parts.bar.hidden = true;
  parts.btn.remove();
  parts.meta.textContent = `${formatBytes(dl.file.size)} · recebido`;
  if (CHAT_IMAGE_TYPES.includes(dl.file.mime)) showImage(parts, url);
  // Salvar: o Electron pergunta onde guardar
  const saveLink = document.createElement('a');
  saveLink.className = 'btn small primary';
  saveLink.href = url;
  saveLink.download = dl.file.name;
  saveLink.textContent = 'Salvar';
  parts.row.append(saveLink);
  parts.blob = blob;
}

// Quem saiu leva os arquivos: downloads em andamento e botões Baixar dele param
function chatMemberLeft(id) {
  for (const [fid, dl] of chat.downloads) if (dl.from === id) fileFailed(fid, 'quem mandou saiu da sala');
  for (const [fid, parts] of chat.cards) {
    if (parts.from === id && parts.state === 'offer') fileFailed(fid, 'quem mandou saiu da sala');
  }
}

// ---------- Janela flutuante ----------
// A página abre a janela (about:blank, mesmo processo) e monta nela um <video> com o mesmo MediaStream do
// tile: nada é decodificado de novo. O processo principal cuida de deixar a janela por cima, sem foco e,
// travada, com o clique atravessando.
// Cada transmissão pode ter a sua janela; o nome da janela leva o id para o processo principal saber de quem é
function togglePip(id) {
  if (state.pips.has(id)) return closePip(id);
  const win = window.open('', `tela-pip-${id}`);
  if (!win) return toast('Não foi possível abrir a janela flutuante.', 'error');
  const p = buildPip(win, id);
  state.pips.set(id, p);
  setPipStream(id);
}

function pipButton(d, text, onClick, primary) {
  const b = d.createElement('button');
  b.type = 'button';
  b.textContent = text;
  Object.assign(b.style, {
    font: 'inherit', fontSize: '12px', fontWeight: '600', height: '28px', padding: '0 10px', borderRadius: '6px', cursor: 'pointer',
    border: '1px solid ' + (primary ? THEME.primary : THEME.line), background: primary ? THEME.primary : THEME.card, color: primary ? THEME.onPrimary : THEME.text,
  });
  b.style.setProperty('-webkit-app-region', 'no-drag');
  b.onclick = onClick;
  return b;
}

// Tudo por CSSOM: a página herda a regra de segurança do app, que não deixa estilo escrito em HTML
function buildPip(win, id) {
  const d = win.document;
  d.documentElement.style.height = '100%';
  Object.assign(d.body.style, {
    margin: '0', height: '100%', overflow: 'hidden', background: '#000000', color: THEME.text, userSelect: 'none',
    fontFamily: THEME.font,
  });
  const video = d.createElement('video');
  video.autoplay = true;
  video.muted = true; // o som continua saindo pelo app, com o volume de cada tela
  video.playsInline = true;
  Object.assign(video.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', objectFit: 'contain' });

  // Modo de ajuste: borda, nome, botões e a dica; a janela inteira arrasta
  const edit = d.createElement('div');
  Object.assign(edit.style, {
    position: 'fixed', inset: '0', boxSizing: 'border-box', border: `2px solid ${THEME.accent}`, padding: '8px',
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '8px',
    background: 'rgba(0, 0, 0, .35)', fontSize: '12px', cursor: 'move',
  });
  edit.style.setProperty('-webkit-app-region', 'drag');
  const top = d.createElement('div');
  Object.assign(top.style, { display: 'flex', alignItems: 'center', gap: '6px' });
  const name = d.createElement('span');
  Object.assign(name.style, { flex: '1', fontSize: '13px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 2px #000' });
  Object.assign(top.style, { background: 'rgba(0, 0, 0, .72)', margin: '-8px -8px 0', padding: '8px' });
  const sizes = d.createElement('div');
  Object.assign(sizes.style, { display: 'flex', gap: '2px', padding: '2px', background: THEME.sunken, borderRadius: '6px' });
  sizes.style.setProperty('-webkit-app-region', 'no-drag');
  for (const key of ['P', 'M', 'G']) {
    const b = pipButton(d, key, () => window.api.pipSize(id, key), false);
    Object.assign(b.style, { width: '28px', height: '24px', padding: '0', border: '0', borderRadius: '4px', background: 'transparent', color: THEME.muted });
    b.title = { P: 'Pequena', M: 'Média', G: 'Grande' }[key];
    sizes.append(b);
  }
  top.append(name, sizes, pipButton(d, 'Travar', () => window.api.pipSetEdit(false), true), pipButton(d, 'Fechar', () => closePip(id), false));
  const bottom = d.createElement('div');
  Object.assign(bottom.style, { display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(0, 0, 0, .72)', margin: '0 -8px -8px', padding: '8px 10px' });
  const opacityRow = d.createElement('label');
  Object.assign(opacityRow.style, { display: 'flex', alignItems: 'center', gap: '8px', color: '#d0d0d0' });
  opacityRow.style.setProperty('-webkit-app-region', 'no-drag');
  const opacity = d.createElement('input');
  opacity.type = 'range';
  opacity.min = '40';
  opacity.max = '100';
  opacity.value = '100';
  Object.assign(opacity.style, { flex: '1', accentColor: THEME.accent });
  opacity.oninput = () => window.api.pipOpacity(id, Number(opacity.value) / 100);
  opacityRow.append('Transparência', opacity);

  // Com 2 ou mais janelas: mesmo tamanho para todas e como enfileirar (coluna ou linha, a partir de qual canto)
  const groupRow = d.createElement('div');
  Object.assign(groupRow.style, { display: 'none', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', color: '#d0d0d0' });
  groupRow.style.setProperty('-webkit-app-region', 'no-drag');
  const linkedLabel = d.createElement('label');
  Object.assign(linkedLabel.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' });
  const linked = d.createElement('input');
  linked.type = 'checkbox';
  linked.style.accentColor = THEME.accent;
  linked.onchange = () => window.api.pipGroup(id, { linked: linked.checked });
  linkedLabel.append(linked, 'Todas do mesmo tamanho');
  const seg = (items, onPick) => {
    const box = d.createElement('div');
    Object.assign(box.style, { display: 'flex', gap: '2px', padding: '2px', background: THEME.sunken, borderRadius: '6px' });
    const btns = {};
    for (const [key, text, title] of items) {
      const b = pipButton(d, text, () => onPick(key), false);
      Object.assign(b.style, { minWidth: '26px', height: '24px', padding: '0 7px', border: '0', borderRadius: '4px' });
      b.title = title;
      b.setAttribute('aria-label', title);
      btns[key] = b;
      box.append(b);
    }
    return { box, btns };
  };
  const layoutSeg = seg([['coluna', 'Coluna', 'Enfileirar em coluna'], ['linha', 'Linha', 'Enfileirar em linha']],
    (layout) => window.api.pipGroup(id, { layout }));
  const cornerSeg = seg([['tl', '↖', 'Começar no canto de cima à esquerda'], ['tr', '↗', 'Começar no canto de cima à direita'],
    ['bl', '↙', 'Começar no canto de baixo à esquerda'], ['br', '↘', 'Começar no canto de baixo à direita']],
    (corner) => window.api.pipGroup(id, { corner }));
  groupRow.append(linkedLabel, layoutSeg.box, cornerSeg.box);

  const hint = d.createElement('span');
  hint.textContent = 'Arraste para mover · puxe um canto para redimensionar · Ctrl+Shift+E trava todas';
  Object.assign(hint.style, { lineHeight: '1.35', color: '#d0d0d0' });
  bottom.append(groupRow, opacityRow, hint);
  // Janela baixa (tamanho P): a dica sai para caber o resto
  const fitHint = () => { hint.style.display = win.innerHeight < 230 ? 'none' : ''; };
  win.addEventListener('resize', fitHint);
  fitHint();
  edit.append(top, bottom);

  // Travada: só uma etiqueta pequena com o nome; ao travar, um aviso rápido
  const lockTag = d.createElement('span');
  Object.assign(lockTag.style, {
    position: 'fixed', top: '8px', left: '8px', display: 'none', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: '600',
    padding: '3px 7px', borderRadius: '5px', background: 'rgba(0, 0, 0, .55)', color: 'rgba(237, 237, 237, .85)',
  });
  const notice = d.createElement('span');
  notice.textContent = 'Janela travada: o clique vai para o jogo · Ctrl+Shift+E para ajustar';
  Object.assign(notice.style, {
    position: 'fixed', left: '50%', bottom: '10px', transform: 'translateX(-50%)', display: 'none', whiteSpace: 'nowrap',
    fontSize: '12px', padding: '6px 10px', borderRadius: '8px', background: THEME.glass, border: `1px solid ${THEME.line}`,
  });
  // Borda verde quando a pessoa desta janela fala; embaixo, quem mais está falando na voz
  const speakRing = d.createElement('div');
  Object.assign(speakRing.style, { position: 'fixed', inset: '0', border: `2px solid ${THEME.ok}`, display: 'none', pointerEvents: 'none' });
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    speakRing.animate([{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], { duration: 1100, iterations: Infinity, easing: 'ease-in-out' });
  }
  const talkers = d.createElement('div');
  Object.assign(talkers.style, { position: 'fixed', left: '8px', bottom: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px', pointerEvents: 'none' });
  d.body.append(video, speakRing, talkers, edit, lockTag, notice);
  const p = { win, id, video, edit, name, opacity, lockTag, notice, noticeTimer: null, groupRow, linked, layoutSeg, cornerSeg, speakRing, talkers };
  requestAnimationFrame(() => renderPipSpeaking());
  return p;
}

function renderPipSpeaking() {
  for (const p of state.pips.values()) {
    if (p.win.closed) continue;
    const d = p.win.document;
    p.speakRing.style.display = speaking.has(p.id) ? 'block' : 'none';
    const others = [...speaking].filter((id) => id !== p.id && id !== state.myId && state.members.has(id));
    p.talkers.replaceChildren(...others.map((id) => talkerChip(d, id)));
  }
}

// Os controles de grupo aparecem só com 2 ou mais janelas, e mostram a escolha atual em todas
let pipGroupState = { linked: false, layout: 'coluna', corner: 'br' };
function renderPipGroup() {
  const many = state.pips.size > 1;
  const g = pipGroupState;
  for (const p of state.pips.values()) {
    if (p.win.closed) continue;
    p.groupRow.style.display = many ? 'flex' : 'none';
    p.linked.checked = g.linked;
    for (const [segKey, seg] of [['layout', p.layoutSeg], ['corner', p.cornerSeg]]) {
      for (const [key, b] of Object.entries(seg.btns)) {
        const on = g[segKey] === key;
        b.style.background = on ? THEME.accentSoft : 'transparent';
        b.style.color = on ? THEME.accent : THEME.muted;
        b.setAttribute('aria-pressed', String(on));
      }
    }
  }
}

function setPipStream(id) {
  const link = state.in.get(id);
  const p = state.pips.get(id);
  if (!link || !p || p.win.closed) return;
  refreshTileStream(link);
  p.name.textContent = link.tile.name;
  p.lockTag.textContent = link.tile.name;
  p.win.document.title = `${link.tile.name} · Tela P2P`;
  syncIncomingVideo();
  renderPipButtons();
}

function closePip(id) {
  const p = state.pips.get(id);
  state.pips.delete(id);
  if (p && !p.win.closed) p.win.close();
  pipClosed(p);
}

// O vídeo volta para o quadro no app
function pipClosed(p) {
  const link = p && state.in.get(p.id);
  if (link) refreshTileStream(link);
  syncIncomingVideo();
  renderPipButtons();
}

function renderPipButtons() {
  for (const [id, link] of state.in) {
    const on = state.pips.has(id);
    setIcon(link.tile.pipBtn, 'pip', on ? 'Fechar a janela flutuante' : 'Abrir em janela flutuante (fica por cima do jogo)');
    link.tile.pipBtn.classList.toggle('on', on);
    link.tile.pipNote.hidden = !on;
  }
  // Barra: quais transmissões estão em janela flutuante, com o atalho e o X (fecha todas)
  renderPipGroup();
  const names = [...state.pips.keys()].filter((id) => state.in.has(id)).map((id) => state.in.get(id).tile.name);
  $('pipChip').hidden = !names.length;
  $('pipChipText').textContent = names.length === 1 ? `Janela flutuante: ${names[0]}` : `Janelas flutuantes: ${names.join(', ')}`;
  setIcon($('pipChipClose'), 'close', names.length > 1 ? 'Fechar as janelas flutuantes' : 'Fechar a janela flutuante');
  if (state.myId) renderMembers();
}

function setPipLocked(p, locked) {
  p.edit.style.display = locked ? 'none' : 'flex';
  p.lockTag.style.display = locked ? 'inline-flex' : 'none';
  clearTimeout(p.noticeTimer);
  p.notice.style.display = locked ? 'block' : 'none';
  if (locked) p.noticeTimer = setTimeout(() => { p.notice.style.display = 'none'; }, 3000);
}

// ---------- Chat por cima do jogo ----------
// Uma janela transparente, sempre por cima, com as últimas mensagens (somem depois de 20 s) e quem está
// falando na voz. Travada, o clique atravessa para o jogo. No modo de ajuste (Ctrl+Shift+E, o mesmo da
// janela flutuante) dá para mover, redimensionar e responder. Ctrl+Shift+O esconde e mostra de novo.
const OVERLAY_SHOW_MS = 20000;
const overlay = { p: null, edit: false, compose: false, timer: null };

// Ctrl+Enter no jogo: abre o chat por cima do jogo (se estiver fechado) já com o campo de escrever
async function onComposeKey() {
  if (!state.myId || !chat.supported) return;
  if (overlay.compose) return endCompose();
  if (!overlay.p || overlay.p.win.closed) {
    await window.api.chatCompose(true, true);
    toggleChatOverlay();
    return;
  }
  window.api.chatCompose(true);
}
function endCompose() {
  if (!overlay.compose) return;
  window.api.chatCompose(false);
}

function toggleChatOverlay() {
  if (overlay.p && !overlay.p.win.closed) return closeChatOverlay();
  const win = window.open('', 'tela-chat');
  if (!win) return toast('Não foi possível abrir o chat por cima do jogo.', 'error');
  overlay.p = buildChatOverlay(win);
  renderChatOverlay();
  renderOverlayButton();
}

function closeChatOverlay() {
  const p = overlay.p;
  overlay.p = null;
  clearTimeout(overlay.timer);
  if (p && !p.win.closed) p.win.close();
  renderOverlayButton();
}

function renderOverlayButton() {
  const on = !!overlay.p;
  setIcon($('overlayToggle'), 'overlay', on
    ? 'Fechar o chat por cima do jogo (Ctrl+Shift+O esconde e mostra)'
    : 'Chat por cima do jogo: as mensagens aparecem sobre a tela. Ctrl+Enter escreve, Ctrl+Shift+O esconde');
  $('overlayToggle').setAttribute('aria-pressed', String(on));
  $('overlayToggle').classList.toggle('on', on);
}

// Tudo por CSSOM, como a janela flutuante (a regra de segurança do app não deixa estilo escrito em HTML)
function buildChatOverlay(win) {
  const d = win.document;
  Object.assign(d.documentElement.style, { height: '100%', background: 'transparent' });
  Object.assign(d.body.style, {
    margin: '0', height: '100%', overflow: 'hidden', background: 'transparent', color: THEME.text,
    fontFamily: THEME.font, fontSize: '14px',
  });
  d.title = 'Chat da sala · Tela P2P';
  const frame = d.createElement('div');
  Object.assign(frame.style, {
    position: 'fixed', inset: '0', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px',
  });
  // Cabeçalho do modo de ajuste: arrasta a janela, trava e fecha
  const head = d.createElement('div');
  Object.assign(head.style, {
    display: 'none', alignItems: 'center', gap: '6px', padding: '6px 6px 6px 10px', borderRadius: '8px',
    background: THEME.glass, fontSize: '12px', cursor: 'move',
  });
  head.style.setProperty('-webkit-app-region', 'drag');
  const title = d.createElement('span');
  title.textContent = 'Chat da sala · arraste para mover';
  Object.assign(title.style, { flex: '1', fontWeight: '600' });
  head.append(title, pipButton(d, 'Travar', () => window.api.pipSetEdit(false), true), pipButton(d, 'Fechar', () => closeChatOverlay(), false));
  // Quem está falando agora
  const talkers = d.createElement('div');
  Object.assign(talkers.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
  // Mensagens: as mais novas embaixo
  const list = d.createElement('div');
  Object.assign(list.style, { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '4px', overflow: 'hidden' });
  // Responder (só no modo de ajuste, quando a janela pode receber o teclado)
  const form = d.createElement('form');
  Object.assign(form.style, { display: 'none', gap: '6px' });
  const input = d.createElement('input');
  input.type = 'text';
  input.maxLength = 2000;
  input.placeholder = 'Mensagem para a sala (Enter manda)';
  input.setAttribute('aria-label', 'Mensagem para a sala');
  Object.assign(input.style, {
    flex: '1', minWidth: '0', height: '34px', boxSizing: 'border-box', padding: '0 10px', borderRadius: '8px',
    border: `1px solid ${THEME.field}`, background: 'rgba(27, 31, 23, .92)', color: THEME.text, font: 'inherit', fontSize: '13px', outline: 'none',
  });
  input.onfocus = () => { input.style.borderColor = THEME.accent; };
  input.onblur = () => { input.style.borderColor = THEME.field; };
  form.style.setProperty('-webkit-app-region', 'no-drag');
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !chat.supported) return;
    send({ type: 'chat', text });
    input.value = '';
    endCompose();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); input.value = ''; endCompose(); }
  };
  input.addEventListener('blur', () => setTimeout(() => { if (overlay.compose && d.activeElement !== input) endCompose(); }, 150));
  form.append(input);
  const hint = d.createElement('span');
  hint.textContent = 'Ctrl+Shift+E trava · Ctrl+Shift+O esconde';
  Object.assign(hint.style, { display: 'none', fontSize: '11px', color: '#d0d0d0', textShadow: '0 1px 2px #000' });
  frame.append(head, talkers, list, form, hint);
  d.body.append(frame);
  return { win, frame, head, talkers, list, form, input, hint };
}

function renderChatOverlay() {
  const p = overlay.p;
  if (!p || p.win.closed) return;
  const d = p.win.document;
  const edit = overlay.edit;
  const open = edit || overlay.compose;
  p.frame.style.border = open ? `2px solid ${THEME.accent}` : '2px solid transparent';
  p.frame.style.background = open ? 'rgba(0, 0, 0, .35)' : 'transparent';
  p.head.style.display = edit ? 'flex' : 'none';
  p.form.style.display = open ? 'flex' : 'none';
  p.hint.style.display = open ? 'block' : 'none';
  p.hint.textContent = overlay.compose && !edit ? 'Enter manda · Esc volta para o jogo' : 'Ctrl+Shift+E trava · Ctrl+Shift+O esconde · Ctrl+Enter escreve';

  p.talkers.replaceChildren(...[...speaking].filter((id) => id !== state.myId && state.members.has(id)).map((id) => talkerChip(d, id)));

  // As últimas 6; travada, cada uma some 20 s depois de chegar
  const now = Date.now();
  const recent = chat.log.slice(-6).filter((m) => open || now - m.ts < OVERLAY_SHOW_MS);
  p.list.replaceChildren(...recent.map((m) => {
    const row = d.createElement('div');
    Object.assign(row.style, {
      alignSelf: 'flex-start', maxWidth: '100%', boxSizing: 'border-box', padding: '5px 9px', borderRadius: '8px',
      background: 'rgba(0, 0, 0, .66)', lineHeight: '1.35', overflowWrap: 'anywhere', fontSize: '13px',
    });
    const who = d.createElement('strong');
    who.textContent = m.from === state.myId ? 'Você' : m.name;
    who.style.color = m.from === state.myId ? THEME.accent : personColor(m.from);
    who.style.marginRight = '6px';
    row.append(who, m.text || `mandou ${m.file ? m.file.name : 'um arquivo'}`);
    return row;
  }));
  // Acorda quando a próxima mensagem visível tiver que sumir
  clearTimeout(overlay.timer);
  if (!open && recent.length) {
    const next = Math.min(...recent.map((m) => m.ts + OVERLAY_SHOW_MS - now));
    overlay.timer = setTimeout(renderChatOverlay, Math.max(200, next + 50));
  }
}

// ---------- Destaque ----------
// Uma transmissão ocupa toda a área de vídeo e as outras ficam pausadas só para mim: quem
// transmite para de mandar o vídeo (o mesmo pedido da janela minimizada) e o som fica mudo.
function setFocus(id) {
  state.focus = id && state.in.has(id) ? id : null;
  if (state.focus) state.main = state.focus; // ao sair do destaque, ela continua sendo a grande
  renderFocus();
  renderMembers();
}

// Com 2 ou mais telas: uma grande à esquerda e as outras numa coluna ao lado, todas ao vivo
function setMain(id) {
  if (!state.in.has(id)) return;
  state.main = id;
  renderFocus();
}

function renderFocus() {
  if (state.focus && (!state.in.has(state.focus) || state.in.size < 2)) state.focus = null;
  if (!state.in.has(state.main)) state.main = state.in.keys().next().value || null;
  const focus = state.focus;
  const column = !focus && state.in.size > 1;
  const tiles = $('tiles');
  tiles.classList.toggle('focused', !!focus);
  tiles.classList.toggle('column', column);
  // Linhas vazias em cima e embaixo deixam a coluna centralizada ao lado da tela grande
  tiles.style.gridTemplateRows = column ? `minmax(0, 1fr) repeat(${state.in.size - 1}, auto) minmax(0, 1fr)` : '';
  let row = 2;
  for (const [id, link] of state.in) {
    const t = link.tile;
    const paused = !!focus && id !== focus;
    const small = column && id !== state.main;
    t.el.classList.toggle('focus', id === focus);
    t.el.classList.toggle('small', small);
    t.el.style.gridColumn = !column ? '' : small ? '2' : '1';
    t.el.style.gridRow = !column ? '' : small ? String(row++) : '1 / -1';
    t.el.tabIndex = small ? 0 : -1;
    t.el.title = small ? `Pôr ${t.name} em destaque` : '';
    t.el.hidden = paused;
    setTilePaused(t, paused);
    t.focusBtn.hidden = state.in.size < 2;
    if (id === focus) setIcon(t.focusBtn, 'grid', 'Mostrar todas');
    else setIcon(t.focusBtn, 'focus', `Destacar ${t.name} (as outras pausam)`);
  }
  renderPausedStrip();
  syncIncomingVideo();
}

// O som da transmissão pausada fica mudo; ao voltar, fica como a pessoa tinha deixado
function setTilePaused(t, paused) {
  if (paused === t.paused) return;
  t.paused = paused;
  if (paused) {
    t.mutedBefore = t.video.muted;
    t.video.muted = true;
  } else {
    t.video.muted = t.mutedBefore;
    t.syncMute();
  }
}

function renderPausedStrip() {
  const strip = $('pausedStrip');
  strip.innerHTML = '';
  strip.hidden = !state.focus;
  if (!state.focus) return;
  const label = document.createElement('span');
  label.className = 'paused-label';
  label.textContent = 'Em pausa para você:';
  strip.append(label);
  for (const [id, link] of state.in) {
    if (id === state.focus) continue;
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.type = 'button';
    btn.textContent = link.tile.name;
    btn.title = `Destacar ${link.tile.name}`;
    btn.onclick = () => setFocus(id);
    strip.append(btn);
  }
  const all = document.createElement('button');
  all.className = 'btn small ghost';
  all.type = 'button';
  all.textContent = 'Mostrar todas';
  all.onclick = () => setFocus(null);
  strip.append(all);
}

function ensureStats() {
  if (state.statsTimer) return;
  state.statsTimer = setInterval(async () => {
    if (!state.in.size) return stopStats();
    const paint = !document.hidden; // escondida: mede para as Estatísticas, sem pintar a tela
    let total = 0;
    for (const link of state.in.values()) {
      if (link.pc.connectionState !== 'connected') continue;
      const r = link.once;
      if (r) {
        const now = performance.now();
        const secs = link.onceTs ? (now - link.onceTs) / 1000 : 0;
        const mbps = secs ? ((r.bytes - link.onceBytes) * 8) / secs / 1e6 : 0;
        const fps = secs ? (r.decoded - link.onceFrames) / secs : 0;
        Object.assign(link, { onceTs: now, onceBytes: r.bytes, onceFrames: r.decoded });
        total += mbps;
        link.rx = { codec: 'H.264', width: r.width, height: r.height, fps, mbps, lost: null, decoder: r.hardware === true ? 'placa de vídeo' : r.hardware === false ? 'processador' : null, once: true };
        continue;
      }
      let report;
      try { report = await link.pc.getStats(); } catch { continue; }
      report.forEach((r) => {
        if (r.type !== 'inbound-rtp' || r.kind !== 'video') return;
        const mbps = link.lastTs ? ((r.bytesReceived - link.lastBytes) * 8) / (r.timestamp - link.lastTs) / 1000 : 0;
        link.lastBytes = r.bytesReceived;
        link.lastTs = r.timestamp;
        total += mbps;
        const got = (r.packetsReceived || 0) + (r.packetsLost || 0);
        link.rx = {
          codec: codecName(report, r.codecId), width: r.frameWidth, height: r.frameHeight, fps: r.framesPerSecond || 0, mbps,
          lost: got ? (100 * (r.packetsLost || 0)) / got : null, decoder: null, once: false,
        };
      });
    }
    perf.live.downMbps = total;
    if (paint) $('downloadInfo').textContent = `Baixando ${total.toFixed(1)} Mbps no total`;
  }, 1000);
}

function stopStats() {
  clearInterval(state.statsTimer);
  state.statsTimer = null;
  perf.live.downMbps = 0;
}

// Com a janela minimizada ou coberta (ex.: jogo em tela cheia) por alguns segundos, para de baixar
// o vídeo das telas que você assiste e fica só com o som. Quem transmite economiza uma codificação,
// e você, a decodificação. Ao voltar para a janela, o vídeo volta na hora.
let hiddenTimer = null;
let appVisible = true;
function setIncomingVideo(on) {
  appVisible = on;
  syncIncomingVideo();
}

// Recebe vídeo de quem estiver na tela: janela do app visível e (sem destaque, ou em destaque)
function syncIncomingVideo() {
  for (const [id, link] of state.in) {
    // Na janela flutuante, o vídeo continua vindo mesmo com o app escondido (é para ver enquanto joga)
    const inPip = state.pips.has(id);
    const on = inPip || (appVisible && (!state.focus || state.focus === id));
    if (link.videoOn === on) continue;
    link.videoOn = on;
    if (!link.self) sendSignal(id, { side: 'viewer', video: on });
  }
}

// A prévia da sua própria tela só roda com a janela do app em foco: enquanto você joga, ela para.
// A prévia da sua própria tela saiu do painel (você já vê o que escolheu ao começar a transmitir):
// só garante que nenhuma prévia antiga siga decodificando
function syncPreview() {
  stopPreview();
}

function onVisibility() {
  clearTimeout(hiddenTimer);
  if (document.hidden) {
    hiddenTimer = setTimeout(() => setIncomingVideo(false), 3000);
    away.since = Date.now();
    away.samples = [];
  } else {
    setIncomingVideo(true);
    awayReport();
  }
  syncPreview();
}

// ---------- Transmitir ----------
function openShareDialog(switching = false) {
  state.shareSwitching = switching && state.sharing;
  $('shareDialog').hidden = false;
  $('shareDialog').classList.toggle('switching', state.shareSwitching);
  $('shareTitle').textContent = state.shareSwitching ? 'Trocar o que transmitir' : 'Transmitir';
  $('shareSubtitle').textContent = state.shareSwitching
    ? 'A transmissão continua: quem assiste passa a ver o que você escolher'
    : 'Escolha o que os outros vão ver';
  if (state.shareSwitching) state.selectedSource = state.sharingSource;
  loadSources();
  syncAudioMode();
  checkEncodeOnce();
  renderShareSummary();
}

const QUALITY_SPEC = { '720p30': '720p 30 fps', '720p60': '720p 60 fps', '1080p30': '1080p 30 fps', '1080p60': '1080p 60 fps' };
function radioValue(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value || ''; }
function setRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el && !el.disabled) el.checked = true;
}
// "Discord", "Discord e Spotify", "Discord, Spotify e Chrome"
function joinNames(list) { return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`; }
// Com um monitor só, o Chromium chama a tela de "Tela cheia" / "Entire screen": fica só "Tela inteira"
function sourceLabel(s) {
  if (!s.id.startsWith('screen')) return s.name;
  return /^(tela cheia|tela inteira|entire screen)$/i.test(s.name.trim()) ? 'Tela inteira' : `Tela inteira: ${s.name}`;
}

// A opção "uma vez só" só fica disponível se o PC codifica H.264 pelo NVENC ou pelo WebCodecs
let encodeOnceSupport = null;
async function checkEncodeOnce() {
  if (encodeOnceSupport === null) encodeOnceSupport = await onceSupport();
  const once = document.querySelector('input[name="encodeMode"][value="once"]');
  once.disabled = !encodeOnceSupport;
  $('encodeOnceLabel').textContent = encodeOnceSupport?.engine === 'nvenc' ? 'Uma vez só (NVENC direto)' : 'Uma vez só';
  if (!encodeOnceSupport) { once.checked = false; setRadio('encodeMode', 'per'); }
  syncEncodeNote();
  renderShareSummary();
}

function syncEncodeNote() {
  const note = $('encodeNote');
  if (encodeOnceSupport === null) return;
  note.hidden = false;
  note.textContent = !encodeOnceSupport
    ? 'Este PC não consegue codificar uma vez só para todos, então cada pessoa recebe a própria codificação.'
    : radioValue('encodeMode') === 'once'
      ? `Codifica o vídeo uma vez só${encodeOnceSupport.engine === 'nvenc' ? ', direto no NVENC da placa NVIDIA (a imagem nem passa pelo processador)' : encodeOnceSupport.hardware ? ', pela placa de vídeo' : ', pelo processador'}, e manda o mesmo para todos: o peso não aumenta quando mais gente assiste. Quem tem versão antiga do app recebe no modo normal.`
      : 'O processador codifica o vídeo uma vez para cada pessoa que assiste. Com vários amigos assistindo, experimente "Uma vez só".';
}

function encodeText() {
  if (radioValue('encodeMode') !== 'once' || !encodeOnceSupport) return 'uma codificação por pessoa';
  return encodeOnceSupport.engine === 'nvenc' ? 'NVENC direto' : encodeOnceSupport.hardware ? 'uma vez só pela placa' : 'uma vez só pelo processador';
}

function soundText() {
  if (!$('soundOn').checked) return 'sem som';
  const names = appsLoaded()
    ? [...$('excludeApps').querySelectorAll('input:checked')].map((i) => i.parentElement.textContent.trim())
    : savedExcludes().map((exe) => exe.replace(/\.exe$/i, ''));
  return names.length ? `som sem ${joinNames(names)}` : 'todo o som do PC';
}

// Rodapé: o que vai acontecer ao clicar em Iniciar; e o resumo do Avançado quando está fechado
function renderShareSummary() {
  const src = state.sources.find((s) => s.id === state.selectedSource);
  const same = state.shareSwitching && state.selectedSource === state.sharingSource;
  $('shareSummary').classList.toggle('ready', !!src && !same);
  $('shareSummaryText').textContent = state.shareSwitching
    ? (!src ? 'Escolha a tela ou janela nova'
      : same ? `${sourceLabel(src)} · é o que você já está transmitindo`
      : `${sourceLabel(src)} · a qualidade e o som continuam os mesmos`)
    : src
      ? [sourceLabel(src), QUALITY_SPEC[radioValue('quality')], encodeText(), soundText()].join(' · ')
      : 'Escolha uma tela ou janela para começar';
  $('shareSummary').title = $('shareSummaryText').textContent; // texto inteiro, se não couber
  $('startBtn').disabled = !src || same;
  if (!$('startBtn').dataset.busy) $('startBtn').textContent = state.shareSwitching ? 'Trocar para esta' : 'Iniciar transmissão';
  const open = $('advToggle').getAttribute('aria-expanded') === 'true';
  const prio = document.querySelector('input[name="priority"]:checked')?.nextElementSibling?.textContent || '';
  $('advSummary').textContent = open ? '' : `${encodeText()} · prioridade ${prio.toLowerCase()}`;
}

function setAdvanced(open) {
  $('advToggle').setAttribute('aria-expanded', String(open));
  $('advPanel').hidden = !open;
  renderShareSummary();
}

function closeShareDialog() {
  $('shareDialog').hidden = true;
  if (state.shareSwitching) state.selectedSource = state.sharingSource; // cancelou: a escolha volta a ser a de agora
  state.shareSwitching = false;
  $('shareDialog').classList.remove('switching');
}

async function loadSources() {
  $('sources').innerHTML = '<p class="hint">Carregando telas e janelas…</p>';
  let sources = [];
  try { sources = await window.api.getSources(); } catch (e) { console.error(e); }
  state.sources = sources;
  const sel = sources.find((s) => s.id === state.selectedSource);
  if (!sel) state.selectedSource = null;
  else state.sourceTab = sel.id.startsWith('screen') ? 'screens' : 'windows';
  renderSources();
}

function selectSource(id) {
  state.selectedSource = id;
  for (const el of $('shareDialog').querySelectorAll('[data-source]')) {
    const on = el.dataset.source === id;
    el.classList.toggle('selected', on);
    el.setAttribute('aria-pressed', String(on));
  }
  renderShareSummary();
}

// Abas Telas | Janelas. Janelas que saem pretas (administrador, protegidas ou minimizadas) ficam à parte.
function renderSources() {
  const grid = $('sources');
  const screens = state.sources.filter((s) => s.id.startsWith('screen'));
  const windows = state.sources.filter((s) => !s.id.startsWith('screen') && !s.dark);
  const blocked = state.sources.filter((s) => !s.id.startsWith('screen') && s.dark);
  $('countScreens').textContent = screens.length || '';
  $('countWindows').textContent = windows.length || '';
  $('tabScreens').setAttribute('aria-selected', String(state.sourceTab === 'screens'));
  $('tabWindows').setAttribute('aria-selected', String(state.sourceTab === 'windows'));
  const shown = state.sourceTab === 'screens' ? screens : windows;

  grid.innerHTML = '';
  if (!shown.length) {
    grid.innerHTML = state.sources.length
      ? '<p class="hint">Nenhuma janela aberta agora.</p>'
      : '<p class="hint">Nenhuma tela encontrada. Clique em atualizar.</p>';
  }
  for (const s of shown) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'source';
    btn.dataset.source = s.id;
    const img = document.createElement('img');
    img.src = s.thumbnail;
    img.alt = '';
    const label = document.createElement('span');
    label.textContent = sourceLabel(s);
    btn.append(img, label);
    btn.onclick = () => selectSource(s.id);
    btn.ondblclick = () => startSharing();
    grid.append(btn);
  }

  const note = $('blockedNote');
  note.hidden = state.sourceTab !== 'windows' || !blocked.length;
  if (!note.hidden) {
    $('blockedTitle').textContent = `Aparecem pretas (${blocked.length})`;
    $('blockedText').textContent = `${joinNames(blocked.map((s) => s.name))}: janela de administrador, protegida ou minimizada. Se estiver minimizada, abra a janela e clique em atualizar; senão, transmita a Tela inteira.`;
  }
  selectSource(state.selectedSource);
}

// Apps marcados da última vez. Sem nada salvo, o Discord já vem marcado (a voz da call não vai
// para a transmissão), a não ser que a pessoa já transmitisse com todo o som na versão antiga.
function savedExcludes() {
  try {
    const list = JSON.parse(load('excludeApps', 'null'));
    if (Array.isArray(list)) return list;
  } catch {}
  const oldMode = load('audioMode', '');
  if (oldMode === 'exclude') return [load('excludeApp', 'Discord.exe')]; // versão antiga: um app só
  return oldMode === 'all' ? [] : ['Discord.exe'];
}

function appsLoaded() { return !!$('excludeApps').querySelector('input'); }

function checkedApps() {
  return [...$('excludeApps').querySelectorAll('input:checked')].map((i) => i.value);
}

async function loadAudioApps() {
  const box = $('excludeApps');
  const wanted = appsLoaded() ? checkedApps() : savedExcludes();
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  if (!appsLoaded()) box.innerHTML = '<span class="hint">Procurando apps que estão tocando som…</span>';
  let apps = [];
  try { apps = await window.api.listAudioApps(); } catch (e) { console.error(e); }
  // Discord sempre aparece, mesmo sem estar numa call agora; os marcados antes também
  if (!apps.some((a) => same(a.exe, 'Discord.exe'))) apps.push({ exe: 'Discord.exe', name: 'Discord' });
  for (const w of wanted) if (!apps.some((a) => same(a.exe, w))) apps.push({ exe: w, name: w.replace(/\.exe$/i, '') });
  // Discord e Spotify primeiro (os mais ignorados), o resto em ordem alfabética
  const rank = (a) => ['discord.exe', 'spotify.exe'].indexOf(a.exe.toLowerCase()) >>> 0;
  apps.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'pt-BR'));
  box.innerHTML = '';
  for (const a of apps) {
    const chip = document.createElement('label');
    chip.className = 'app-chip';
    chip.title = a.exe;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = a.exe;
    input.checked = wanted.some((w) => same(w, a.exe));
    const text = document.createElement('span');
    text.textContent = a.name;
    chip.append(input, text);
    box.append(chip);
  }
  renderShareSummary();
}

function syncAudioMode() {
  const withAudio = $('soundOn').checked;
  $('excludeField').hidden = !withAudio;
  if (withAudio && !appsLoaded()) loadAudioApps();
}

async function createAppAudioTrack(exes) {
  const res = await window.api.startAppAudio(exes);
  if (!res.ok) throw new Error(res.error);

  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('pcm-worklet.js');
  const node = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
  const dest = ctx.createMediaStreamDestination();
  node.connect(dest);
  await ctx.resume();

  // O worklet converte para float no thread de áudio; aqui só copia e repassa
  window.api.onPcm((bytes) => {
    const i16 = new Int16Array(bytes.slice().buffer);
    node.port.postMessage(i16, [i16.buffer]);
  });

  state.appAudio = { ctx };
  return dest.stream.getAudioTracks()[0];
}

function stopAppAudio() {
  if (!state.appAudio) return;
  window.api.offPcm();
  window.api.stopAppAudio();
  state.appAudio.ctx.close().catch(() => {});
  state.appAudio = null;
}

function stopTracks() {
  state.systemLoopback = false;
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  stopAppAudio();
}

async function startSharing() {
  if (!state.selectedSource || state.sharing || !state.ws) return;
  const btn = $('startBtn');
  setBusy(btn, true, 'Iniciando…');

  state.quality = QUALITY[radioValue('quality')] ? radioValue('quality') : '1080p30';
  const q = QUALITY[state.quality];
  const audioMode = $('soundOn').checked ? 'all' : 'none';
  const encodeMode = radioValue('encodeMode') || 'per';
  save('encodeMode', encodeMode);
  const excluded = audioMode === 'none' ? [] : appsLoaded() ? checkedApps() : savedExcludes();
  save('quality', state.quality);
  save('audioMode', audioMode);
  if (audioMode !== 'none') save('excludeApps', JSON.stringify(excluded));

  // O som vem do capturador próprio, que sempre deixa de fora o som deste app (as telas que você
  // está assistindo) e os apps marcados. Se ele falhar sem nenhum app marcado, volta para a
  // captura comum do Windows; com apps marcados, transmite sem som (melhor que vazar a call).
  let audioTrack = null;
  let loopback = false;
  if (audioMode !== 'none') {
    try {
      audioTrack = await createAppAudioTrack(excluded);
    } catch (err) {
      stopAppAudio();
      if (!excluded.length && !voice.session && !voice.pending) {
        loopback = true;
        state.systemLoopback = true;
        toast('Não deu para separar o som deste app, então quem você assiste pode se ouvir na sua transmissão.', 'error');
      } else {
        toast(`Não foi possível ignorar os apps escolhidos: ${err.message}. Transmitindo sem áudio.`, 'error');
      }
    }
  }

  // Uma vez só + placa NVIDIA: o videocap captura e codifica, sem a captura do Chromium
  let nvenc = false;
  if (encodeMode === 'once' && (await onceSupport())?.engine === 'nvenc') nvenc = await startNvenc(state.selectedSource);

  try {
    if (nvenc && !loopback) {
      state.stream = new MediaStream();
    } else {
      await window.api.selectSource(state.selectedSource, loopback);
      state.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: q.w }, height: { max: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
        audio: loopback
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : false,
      });
      // Com o NVENC, a captura do Chromium só serviu para pegar o som do Windows
      if (nvenc) for (const t of state.stream.getVideoTracks()) { t.stop(); state.stream.removeTrack(t); }
    }
  } catch (err) {
    stopOnceEncoder();
    stopAppAudio();
    state.systemLoopback = false;
    setBusy(btn, false, 'Iniciar transmissão');
    return toast(`Não foi possível capturar a tela: ${err.message}`, 'error');
  }
  if (audioTrack) state.stream.addTrack(audioTrack);
  state.systemLoopback = loopback;

  const vTrack = state.stream.getVideoTracks()[0];
  if (vTrack) {
    setupChromeVideo(vTrack);
    if (encodeMode === 'once' && !nvenc && !(await startOnceEncoder(vTrack))) {
      toast('Este PC não conseguiu codificar uma vez só. Transmitindo no modo normal.', 'error');
    }
  }

  state.sharing = true;
  state.sharingSource = state.selectedSource;
  state.shareInfoKey = '';
  sendShareInfo();
  updateStage();
  startOutStats();
  $('noAudio').hidden = audioMode === 'none' || state.stream.getAudioTracks().length > 0;
  closeShareDialog();
  renderShareBox();
  renderMembers();
  setBusy(btn, false, 'Iniciar transmissão');
}

function setupChromeVideo(track) {
  track.contentHint = 'motion';
  track.onended = () => stopSharing('A captura foi encerrada (a janela foi fechada?).');
}

// Faixa de vídeo do Chromium, pega só quando precisa: no modo NVENC, para quem tem versão antiga
// ou quando o NVENC para no meio da transmissão
let chromeVideoPending = null;
function ensureChromeVideo() {
  const have = state.stream && state.stream.getVideoTracks()[0];
  if (have) return Promise.resolve(have);
  if (!state.sharing || !state.stream) return Promise.resolve(null);
  if (!chromeVideoPending) {
    chromeVideoPending = (async () => {
      const q = QUALITY[state.quality];
      try {
        await window.api.selectSource(state.sharingSource || state.selectedSource, false);
        const s = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { max: q.w }, height: { max: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
          audio: false,
        });
        const track = s.getVideoTracks()[0];
        if (!state.sharing || !state.stream) { track.stop(); return null; }
        setupChromeVideo(track);
        state.stream.addTrack(track);
        syncPreview();
        return track;
      } catch (err) {
        console.warn('Não foi possível capturar a tela pelo Chromium:', err);
        return null;
      } finally {
        chromeVideoPending = null;
      }
    })();
  }
  return chromeVideoPending;
}

// No modo NVENC, a captura do Chromium só fica ligada enquanto alguém com versão antiga assiste
function releaseChromeVideo() {
  if (!once.active || once.engine !== 'nvenc' || !state.stream) return;
  if ([...state.out.values()].some((l) => !l.dc)) return;
  for (const t of state.stream.getVideoTracks()) { t.onended = null; t.stop(); state.stream.removeTrack(t); }
  syncPreview();
}

function stopSharing(reason) {
  if (!state.sharing) return;
  state.sharing = false;
  state.sharingSource = null;
  if (state.shareSwitching) closeShareDialog();
  stopWatching(state.myId, false);
  stopOnceEncoder();
  stopOutStats();
  for (const id of [...state.out.keys()]) closeOut(id);
  stopTracks();
  state.shareInfo = null;
  state.shareInfoKey = '';
  send({ type: 'share', sharing: false });
  updateStage();
  renderShareBox();
  renderMembers();
  if (reason) toast(reason);
}

// Troca a tela ou janela no meio da transmissão, sem derrubar ninguém. O som não muda (vem do
// capturador de áudio, não da tela).
//   Modo normal: a faixa nova entra no lugar da antiga em cada conexão (replaceTrack, sem renegociar).
//   Uma vez só pelo WebCodecs: o codificador passa a ler da faixa nova.
//   Uma vez só pelo NVENC direto: o videocap recomeça apontando para a fonte nova, e todos recebem um
//   quadro-chave. Se o NVENC não conseguir, continua pelo WebCodecs com a faixa do Chromium.
async function switchSource() {
  const id = state.selectedSource;
  if (!state.sharing || !id || id === state.sharingSource) return closeShareDialog();
  const btn = $('startBtn');
  btn.dataset.busy = '1';
  setBusy(btn, true, 'Trocando…');
  const q = QUALITY[state.quality];
  const oldVideo = state.stream.getVideoTracks()[0] || null;
  const nvenc = once.active && once.engine === 'nvenc';
  let newVideo = null;
  try {
    // Faixa nova do Chromium: sempre, menos no NVENC sem ninguém de versão antiga (que não usa essa faixa)
    if (oldVideo || !nvenc) {
      await window.api.selectSource(id, false);
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: q.w }, height: { max: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
        audio: false,
      });
      newVideo = s.getVideoTracks()[0];
    }
  } catch (err) {
    delete btn.dataset.busy;
    setBusy(btn, false, 'Trocar para esta');
    return toast(`Não foi possível capturar: ${err.message}`, 'error');
  }
  if (!state.sharing) { newVideo?.stop(); delete btn.dataset.busy; return; }
  state.sharingSource = id;

  if (newVideo) {
    if (oldVideo) { oldVideo.onended = null; state.stream.removeTrack(oldVideo); }
    state.stream.addTrack(newVideo);
    setupChromeVideo(newVideo);
    for (const link of state.out.values()) {
      const sender = link.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
      if (sender) await sender.replaceTrack(newVideo).catch((e) => console.warn(e));
    }
    if (once.active && once.engine === 'webcodecs') {
      const reader = once.reader;
      once.reader = null;
      if (reader) reader.cancel().catch(() => {});
      once.keyWanted = true;
      readFrames(newVideo);
    }
    oldVideo?.stop();
  }

  if (nvenc) {
    window.api.offVideoCap();
    await window.api.videoCapStop().catch(() => {});
    once.active = false;
    once.engine = '';
    if (await startNvenc(id)) {
      sendConfigToAll();
      for (const [, l] of onceLinks()) l.needKey = true;
      requestKey();
    } else {
      await switchToWebCodecs('O NVENC direto não conseguiu capturar a fonte nova.');
    }
  }

  delete btn.dataset.busy;
  setBusy(btn, false, 'Trocar para esta');
  closeShareDialog();
  renderShareBox();
  sendShareInfo();
  refreshSelfView();
  const src = state.sources.find((s) => s.id === id);
  toast(`Agora você está transmitindo: ${src ? sourceLabel(src) : 'a fonte nova'}.`);
}

// Alguém clicou em Assistir na minha transmissão: só agora a conexão é criada
// Se eu transmito no modo "uma vez só" e o app da pessoa entende, o vídeo vai pelo canal de dados;
// senão (ex.: versão antiga), vai como faixa WebRTC normal, com o codificador próprio dessa conexão.
function addWatcher(id, wantsOnce) {
  if (!state.sharing || !state.stream) return sendSignal(id, { side: 'sharer', unavailable: true });
  closeOut(id);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const link = { pc, chain: Promise.resolve(), dc: null };
  state.out.set(id, link);

  const useOnce = wantsOnce && once.active;
  if (useOnce) {
    link.dc = pc.createDataChannel('video');
    setupOnceSender(link);
  }
  // No modo NVENC não há faixa de vídeo do Chromium: quem precisa dela (versão antiga) espera ela ser pega
  link.chain = link.chain.then(async () => {
    if (!useOnce) await ensureChromeVideo();
    if (!state.stream || state.out.get(id) !== link) return;
    state.stream.getTracks().filter((t) => !useOnce || t.kind !== 'video').forEach((t) => pc.addTrack(t, state.stream));
    if (!useOnce) preferH264(pc);
  });
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal(id, { side: 'sharer', candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') link.chain = link.chain.then(() => applyBitrate(link)).catch(console.error);
    renderWatchers();
  };
  link.chain = link.chain.then(async () => {
    await pc.setLocalDescription(await pc.createOffer());
    sendSignal(id, { side: 'sharer', sdp: pc.localDescription });
  }).catch(console.error);

  renderWatchers();
  toast(`${nameOf(id)} está assistindo você`);
}

function closeOut(id) {
  const link = state.out.get(id);
  if (!link) return;
  if (link.dc) link.dc.close();
  link.pc.close();
  state.out.delete(id);
  releaseChromeVideo();
  renderWatchers();
}

// Como a transmissão foi enquanto a janela estava escondida (ex.: jogo em tela cheia). Ao voltar,
// o painel diz o que limitou: captura lenta (placa de vídeo ocupada), processador ou internet.
const away = { since: 0, samples: [] };

function formatDuration(secs) {
  return secs < 120 ? `${Math.round(secs)} s` : `${Math.round(secs / 60)} min`;
}

function awayReport() {
  const s = away.samples;
  away.samples = [];
  const secs = (Date.now() - away.since) / 1000;
  if (!state.sharing || s.length < 3 || secs < 10) return;
  const avg = (k) => s.reduce((t, x) => t + x[k], 0) / s.length;
  const share = (l) => s.filter((x) => x.limit === l).length / s.length;
  const fps = QUALITY[state.quality].fps;
  const measured = s.some((x) => x.captureFps > 0);
  const captured = measured ? avg('captureFps') : avg('sentFps');
  const why = share('cpu') > 0.3 ? 'O processador ficou no limite.'
    : share('bandwidth') > 0.3 ? 'A internet limitou o envio.'
    : captured < fps * 0.7 ? 'A captura da tela entregou poucos quadros: se o jogo estava rodando, a placa de vídeo estava ocupada ou a janela do jogo não deixa ser capturada em tela cheia. Limite o FPS do jogo ou use o modo janela sem bordas.'
    : 'Nada limitou a transmissão.';
  $('awayInfo').textContent = `Enquanto o app estava escondido (${formatDuration(secs)}): captura a ${Math.round(captured)} de ${fps} fps, `
    + `enviando ${Math.round(avg('sentFps'))} fps e ${avg('mbps').toFixed(1)} Mbps. ${why}`;
  console.log('[diagnóstico]', $('awayInfo').textContent, s);
}

// O que eu estou usando para transmitir, para a aba Transmissão das Estatísticas de quem está na sala.
// Só manda de novo quando algo muda (ex.: o NVENC caiu para o WebCodecs, ou descobriu a placa de vídeo).
function myShareInfo(hw) {
  const info = { quality: state.quality, mode: once.active ? 'once' : 'per', engine: once.active ? engineName() : 'WebRTC',
    audio: !!state.stream?.getAudioTracks().length };
  const h = once.active ? once.hardware : hw;
  if (typeof h === 'boolean') info.hw = h;
  return info;
}
function sendShareInfo(hw) {
  if (!state.sharing) return;
  const info = myShareInfo(hw ?? state.shareInfo?.hw);
  const key = JSON.stringify(info);
  if (key === state.shareInfoKey) return;
  state.shareInfoKey = key;
  state.shareInfo = info;
  send({ type: 'share', sharing: true, info });
}

// Mostra para quem transmite qual codec está em uso e se a placa de vídeo está codificando
function startOutStats() {
  stopOutStats();
  const last = { ts: performance.now(), captured: 0, encoded: 0, dropped: 0, sent: 0, behind: 0 };
  state.outStatsTimer = setInterval(async () => {
    const active = [...state.out.values()].filter((l) => l.pc.connectionState === 'connected' && !l.videoOff);
    const links = active.filter((l) => !l.dc);
    const onceCount = active.length - links.length;
    if (!active.length) {
      Object.assign(perf.live, { captureFps: null, sentFps: 0, upMbps: 0 }); // ninguém assistindo
      if (!document.hidden) $('encoderInfo').textContent = '';
      return;
    }
    let codec = '', hw = null, limit = 'none', captureFps = 0, sentFps = 0, mbps = 0;

    // Modo "uma vez só": contadores próprios, já que não há faixa de vídeo WebRTC
    const now = performance.now();
    const secs = (now - last.ts) / 1000;
    const behind = active.reduce((t, l) => t + (l.behind || 0), 0);
    if (once.active && secs > 0) {
      captureFps = (once.captured - last.captured) / secs;
      if (onceCount) {
        sentFps = (once.encoded - last.encoded) / secs;
        mbps = ((once.sentBytes - last.sent) * 8) / secs / 1e6;
        if (once.dropped > last.dropped) limit = 'cpu';
        else if (behind > last.behind) limit = 'bandwidth';
      }
    }
    Object.assign(last, { ts: now, captured: once.captured, encoded: once.encoded, dropped: once.dropped, sent: once.sentBytes, behind });

    for (const link of links) {
      let report;
      try { report = await link.pc.getStats(); } catch { continue; }
      report.forEach((r) => {
        if (r.type === 'media-source' && r.kind === 'video') captureFps = Math.max(captureFps, r.framesPerSecond || 0);
        if (r.type !== 'outbound-rtp' || r.kind !== 'video') return;
        codec = codecName(report, r.codecId) || codec;
        const h = usesHardware(r.powerEfficientEncoder, r.encoderImplementation);
        if (h !== null) hw = hw === null ? h : hw && h;
        if (r.qualityLimitationReason === 'cpu') limit = 'cpu';
        else if (r.qualityLimitationReason === 'bandwidth' && limit !== 'cpu') limit = 'bandwidth';
        sentFps += (r.framesPerSecond || 0) / active.length;
        if (link.lastTs) mbps += ((r.bytesSent - link.lastBytes) * 8) / (r.timestamp - link.lastTs) / 1000;
        link.lastBytes = r.bytesSent;
        link.lastTs = r.timestamp;
      });
    }
    Object.assign(perf.live, { captureFps, sentFps, upMbps: mbps });
    sendShareInfo(hw); // a placa de vídeo só aparece depois das primeiras medidas
    if (document.hidden) {
      away.samples.push({ captureFps, sentFps, mbps, limit }); // ninguém está vendo o painel agora
      return;
    }
    const place = (h) => (h === true ? ' pela placa de vídeo' : h === false ? ' pelo processador' : '');
    let text = '';
    if (onceCount) {
      text = `Codificando em H.264 uma vez só${onceCount > 1 ? ` para ${onceCount} pessoas,` : ''}${once.engine === 'nvenc' ? ' pelo NVENC direto' : place(once.hardware)}.`;
    }
    if (codec) {
      const n = links.length;
      text += `${text ? ' ' : ''}Codificando em ${codec}${place(hw)}${onceCount ? ` para quem tem versão antiga` : ''}.`;
      if (n > 1) text += ` São ${n} codificações, uma para cada pessoa.`;
    }
    if (!text) return;
    if (limit === 'cpu') text += ' O processador está no limite, então a qualidade foi reduzida.';
    else if (limit === 'bandwidth') text += ' A internet está limitando a qualidade.';
    $('encoderInfo').textContent = text;
  }, 2000);
}

function stopOutStats() {
  clearInterval(state.outStatsTimer);
  state.outStatsTimer = null;
  Object.assign(perf.live, { captureFps: null, sentFps: null, upMbps: 0 });
  $('encoderInfo').textContent = '';
  $('awayInfo').textContent = '';
  away.samples = [];
}

// Transmitindo: a barra mostra "Ao vivo" e Parar; o painel mostra a prévia e os detalhes
function renderShareBox() {
  $('shareBtn').hidden = state.sharing;
  $('liveChip').hidden = !state.sharing;
  const selfOn = !!state.myId && state.in.has(state.myId);
  setIcon($('selfViewBtn'), 'eye', selfOn ? 'Parar de ver a sua transmissão' : 'Ver a sua própria transmissão');
  $('selfViewBtn').setAttribute('aria-pressed', String(selfOn));
  $('myShare').hidden = !state.sharing;
  syncPreview();
  renderWatchers();
}

function renderWatchers() {
  const names = [...state.out].map(([id, l]) => nameOf(id) + (l.videoOff ? ' (vídeo pausado)' : ''));
  $('watcherInfo').textContent = names.length
    ? `Assistindo você: ${names.join(', ')}`
    : 'Ninguém está assistindo ainda. Só é enviado vídeo para quem clicar em Assistir.';
  const n = state.out.size;
  $('liveText').textContent = n === 0 ? 'ninguém assistindo' : n === 1 ? '1 assistindo' : `${n} assistindo`;
}

// ---------- Partida: o que roda na carga, na mesma ordem de antes ----------
voice.media = { getUserMedia: () => openMic() };
document.addEventListener('mousedown', (e) => {
  const card = $('personCard');
  if (!card.hidden && !card.contains(e.target) && !e.target.closest('.vol-btn, .voice-avatar')) closePersonCard();
});

$('voiceJoin').onclick = () => {
  if (voice.session || voice.pending) return voice.leave();
  if (state.systemLoopback) return toast('Pare sua transmissão, entre na voz e depois reinicie a transmissão: a captura atual inclui todo o som do PC.', 'error');
  mixer.ensure(); // o clique libera o áudio do app
  voice.join();
};
$('voiceMute').onclick = () => voice.mute();
$('voiceDeafen').onclick = () => voice.deafen();
// Captura antes de qualquer outro atalho da página
window.addEventListener('keydown', async (e) => {
  if (!capturing) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') return stopCapture();
  const c = capturing;
  if (c.kind === 'ptt') {
    if (!e.keyCode) return;
    voiceCfg.pttVk = e.keyCode; // no Windows, é o código de tecla virtual que o teclas.exe usa
    voiceCfg.pttLabel = keyLabel(e);
    saveVoiceCfg();
    stopCapture();
    ptt.active = -1; // força reiniciar com a tecla nova
    syncPtt();
    renderVoiceDialog();
    renderVoiceMe();
    return;
  }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; // espera a tecla principal
  const a = accelFromEvent(e);
  if (!a) return toast('Essa tecla não pode ser usada como atalho.', 'error');
  if (!a.strong && !a.fkey) return toast('Use Ctrl ou Alt junto (ou uma tecla de F1 a F24), para não atrapalhar quando você digita.', 'error');
  stopCapture();
  await applyShortcut(c.action, a.accel);
}, true);
// Botões do mouse para o apertar para falar: meio e os laterais (o esquerdo e o direito ficam de fora)
window.addEventListener('mousedown', (e) => {
  if (!capturing || capturing.kind !== 'ptt' || ![1, 3, 4].includes(e.button)) return;
  e.preventDefault();
  voiceCfg.pttVk = { 1: 4, 3: 5, 4: 6 }[e.button];
  voiceCfg.pttLabel = { 1: 'Botão do meio', 3: 'Mouse 4', 4: 'Mouse 5' }[e.button];
  saveVoiceCfg();
  stopCapture();
  ptt.active = -1;
  syncPtt();
  renderVoiceDialog();
  renderVoiceMe();
}, true);

document.querySelectorAll('input[name="noise"]').forEach((r) => {
  r.onchange = () => { voiceCfg.ns = r.value; saveVoiceCfg(); renderVoiceDialog(); restartMic(); };
});
$('echoOn').onchange = () => { voiceCfg.echo = $('echoOn').checked; saveVoiceCfg(); restartMic(); };
document.querySelectorAll('input[name="talkMode"]').forEach((r) => {
  r.onchange = () => {
    voiceCfg.mode = r.value;
    saveVoiceCfg();
    renderVoiceDialog();
    syncPtt();
    applyMicGate();
    renderVoiceMe();
    if (voiceCfg.mode === 'ptt' && !voiceCfg.pttVk) startCapture({ kind: 'ptt', btn: $('pttChange') });
  };
});
$('pttChange').onclick = () => startCapture({ kind: 'ptt', btn: $('pttChange') });
$('gateAuto').onchange = () => {
  voiceCfg.gateAuto = $('gateAuto').checked;
  if (!voiceCfg.gateAuto && micNow) voiceCfg.gateDb = Math.round(gateThreshold(micNow)); // começa de onde o automático estava
  saveVoiceCfg();
  renderVoiceDialog();
};
$('gateDb').oninput = () => { voiceCfg.gateDb = Number($('gateDb').value); saveVoiceCfg(); renderVoiceDialog(); };
$('duckAmount').oninput = () => { voiceCfg.duck = Number($('duckAmount').value); saveVoiceCfg(); renderVoiceDialog(); updateDuck(); };
$('duckSelf').onchange = () => { voiceCfg.duckSelf = $('duckSelf').checked; saveVoiceCfg(); updateDuck(); };
$('shortcutReset').onclick = async () => {
  const defaults = { compose: 'CommandOrControl+Enter', mute: 'CommandOrControl+Shift+M', edit: 'CommandOrControl+Shift+E', hideChat: 'CommandOrControl+Shift+O' };
  for (const action of Object.keys(defaults)) await window.api.setShortcut(action, '').catch(() => {}); // solta todos antes
  for (const [action, accel] of Object.entries(defaults)) await applyShortcut(action, accel);
};
$('voiceSettingsBtn').onclick = openVoiceDialog;
$('closeVoiceDialog').onclick = closeVoiceDialog;
$('voiceDialog').addEventListener('mousedown', (e) => { if (e.target === $('voiceDialog')) closeVoiceDialog(); });
$('statsDialog').addEventListener('mousedown', (e) => { if (e.target === $('statsDialog')) closeStats(); });

window.addEventListener('beforeunload', () => voice.leave(false));

window.api.onPip((m) => {
  // O modo de ajuste vale para todas as janelas ao mesmo tempo
  if (m.group) { pipGroupState = m.group; renderPipGroup(); }
  if (m.type === 'edit') { overlay.edit = !!m.on; renderChatOverlay(); }
  if (m.type === 'chat-closed') { overlay.p = null; overlay.compose = false; clearTimeout(overlay.timer); renderOverlayButton(); }
  if (m.type === 'compose-key') onComposeKey();
  if (m.type === 'ptt') onPttKey(!!m.down);
  if (m.type === 'mute-key' && voice.session) voice.mute();
  if (m.type === 'compose') {
    overlay.compose = !!m.on;
    renderChatOverlay();
    if (overlay.compose) setTimeout(() => overlay.p?.input.focus(), 30);
  }
  if (m.type === 'edit') {
    for (const [id, p] of state.pips) {
      if (p.win.closed) continue;
      setPipLocked(p, !m.on);
      const o = m.opacity && m.opacity[id];
      if (typeof o === 'number') p.opacity.value = String(Math.round(o * 100));
    }
  }
  else if (m.type === 'closed' && state.pips.has(m.id)) { const p = state.pips.get(m.id); state.pips.delete(m.id); pipClosed(p); }
  else if (m.type === 'shortcut-busy') toast(`Outro programa já usa ${accelLabel(m.accel)}, então esse atalho não funciona agora. Dá para trocar em Voz e atalhos (a engrenagem na barra).`, 'error');
});

// ---------- Início ----------
$('name').value = load('name');
$('name').addEventListener('input', () => save('name', $('name').value));
$('roomPort').value = load('roomPort', '8765');
$('roomAddr').value = load('roomAddr');
// "720p 30 fps" saiu das opções: quem usava fica na Leve (720p 60 fps)
const savedQuality = load('quality', '1080p30');
setRadio('quality', savedQuality === '720p30' ? '720p60' : savedQuality);
if (!radioValue('quality')) setRadio('quality', '1080p30');
$('soundOn').checked = load('audioMode', 'all') !== 'none'; // "exclude" da versão antiga conta como com som
setRadio('encodeMode', load('encodeMode', 'per') === 'once' ? 'once' : 'per');
// Prioridade vale para o app inteiro e já na abertura, não só durante a transmissão
setRadio('priority', load('priority', 'above'));
if (!radioValue('priority')) setRadio('priority', 'above');
window.api.setPriority(radioValue('priority'));

// Qualquer mudança na janela de transmitir atualiza o resumo do rodapé
$('shareDialog').addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'priority') {
    save('priority', t.value);
    window.api.setPriority(t.value);
  } else if (t.name === 'encodeMode') {
    syncEncodeNote();
  } else if (t.id === 'soundOn') {
    syncAudioMode();
  }
  renderShareSummary();
});
$('tabScreens').onclick = () => { state.sourceTab = 'screens'; renderSources(); };
$('tabWindows').onclick = () => { state.sourceTab = 'windows'; renderSources(); };
$('advToggle').onclick = () => setAdvanced($('advToggle').getAttribute('aria-expanded') !== 'true');
setIcon($('closeShare'), 'close', 'Fechar');
setIcon($('refreshSources'), 'refresh', 'Atualizar lista');
$('closeShare').onclick = closeShareDialog;

// Tela inicial: Radmin VPN, última sala e "Entrar numa sala" aberto ali mesmo
async function renderRadmin() {
  let ips = [];
  try { ips = await window.api.getIps(); } catch {}
  const r = ips.find((i) => i.radmin);
  $('radminDot').className = 'dot ' + (r ? 'ok' : 'warn');
  $('radminTitle').textContent = r ? 'Radmin VPN conectada' : 'Radmin VPN não encontrada';
  $('radminDetail').textContent = r ? r.address : 'Ligue a Radmin e entre na rede';
}

function renderLastRoom() {
  const last = load('roomAddr');
  $('lastRoom').hidden = !last;
  $('lastRoomAddr').textContent = last;
}

function renderHome() {
  renderRadmin();
  renderLastRoom();
}

function setJoinOpen(open) {
  $('joinPanel').hidden = !open;
  $('goJoin').hidden = open;
  $('goJoin').setAttribute('aria-expanded', String(open));
  $('homeCard').classList.toggle('joining', open);
  (open ? $('roomAddr') : $('goJoin')).focus();
}
window.addEventListener('focus', () => { if (!$('home').hidden) renderRadmin(); });

window.api.getVersion().then((v) => {
  update.myVersion = v;
  $('appVersion').textContent = `Versão ${v}`;
  checkGithub();
});
$('checkUpdates').onclick = () => checkGithub(true);
$('ubGo').onclick = runUpdate;
$('ubLater').onclick = () => { update.dismissed = updateMode()?.version || ''; renderUpdateBanner(); };
setInterval(() => checkGithub(), 30 * 60 * 1000); // quem deixa o app aberto também fica sabendo

$('goCreate').onclick = () => show('create-room');
$('goJoin').onclick = () => setJoinOpen(true);
$('cancelJoin').onclick = () => setJoinOpen(false);
$('rejoinBtn').onclick = () => {
  $('roomAddr').value = load('roomAddr');
  setJoinOpen(true);
  joinRoom();
};
document.querySelectorAll('.back').forEach((b) => { b.onclick = () => show('home'); });

$('createBtn').onclick = createRoom;
$('roomPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') createRoom(); });
$('joinBtn').onclick = joinRoom;
$('roomAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('joinPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });

// O host, ao sair com mais gente na sala: passa a sala para o mais antigo ou encerra para todos
function openCloseDialog() {
  const next = successors().find((id) => id !== state.myId);
  const handoff = state.handoff && !!next;
  $('closeTitle').textContent = handoff ? 'Sair da sala?' : 'Encerrar a sala para todos?';
  $('closeText').textContent = handoff
    ? `Você é o host. Se sair, ${nameOf(next)} vira o host e a sala continua para os outros, sem as transmissões caírem. Ou encerre a sala para todo mundo.`
    : 'Todo mundo sai da sala e as transmissões param. Para voltar, crie a sala de novo e passe o endereço.';
  $('handoffLeave').hidden = !handoff;
  $('confirmClose').textContent = handoff ? 'Encerrar para todos' : 'Encerrar sala';
  $('closeDialog').hidden = false;
  (handoff ? $('handoffLeave') : $('cancelClose')).focus();
}
function closeCloseDialog() {
  $('closeDialog').hidden = true;
  $('leaveBtn').focus();
}
$('leaveBtn').onclick = () => {
  if (state.isOwner && state.members.size) openCloseDialog();
  else leaveRoom(state.isOwner ? 'Sala encerrada.' : null);
};
$('cancelClose').onclick = closeCloseDialog;
$('confirmClose').onclick = () => leaveRoom('Sala encerrada.', 'info', true);
$('handoffLeave').onclick = () => leaveRoom(`Você saiu. ${nameOf(successors().find((id) => id !== state.myId))} agora é o host da sala.`);
$('shareBtn').onclick = openShareDialog;
$('stopShareBtn').onclick = () => stopSharing();
$('cancelShare').onclick = closeShareDialog;
$('startBtn').onclick = () => (state.shareSwitching ? switchSource() : startSharing());
$('switchShareBtn').onclick = () => openShareDialog(true);
$('refreshSources').onclick = loadSources;
$('refreshApps').onclick = loadAudioApps;
// Ícone das Estatísticas, na sala ao lado de Sair da sala
setIcon($('openStatsRoom'), 'stats', 'Estatísticas: desempenho do PC e a transmissão de cada pessoa');
$('openStatsRoom').onclick = openStats;
$('selfViewBtn').onclick = toggleSelfView;
$('statsTabPerf').onclick = () => setStatsTab('perf');
$('statsTabStream').onclick = () => setStatsTab('stream');
for (const id of ['statsTabPerf', 'statsTabStream']) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setStatsTab(statsTab === 'perf' ? 'stream' : 'perf', true);
  });
}

// Chat
$('chatToggle').insertAdjacentHTML('afterbegin', ICON.chat);
$('chatToggle').onclick = () => setPanelOpen(!chat.open);
setIcon($('chatCollapse'), 'chevron', 'Recolher o painel da sala');
$('chatCollapse').onclick = () => setPanelOpen(false);
$('peopleBtn').onclick = () => setPeopleOpen($('peoplePop').hidden);
// Clicar fora da lista fecha (o cartão de volume, que abre de dentro dela, conta como dentro)
document.addEventListener('mousedown', (e) => {
  if ($('peoplePop').hidden) return;
  if (e.target.closest('#peoplePop, #peopleBtn, #personCard')) return;
  setPeopleOpen(false);
});
$('chatJump').onclick = () => { scrollChatToEnd(); markRead(); };
$('chatList').addEventListener('scroll', () => { if (chatAtBottom() && chat.open && !document.hidden) markRead(); else renderUnread(); });
// A barra de rolagem fica escondida e aparece enquanto rola (e com o mouse em cima, pelo CSS)
let chatScrollTimer = 0;
$('chatList').addEventListener('scroll', () => {
  $('chatList').classList.add('scrolling');
  clearTimeout(chatScrollTimer);
  chatScrollTimer = setTimeout(() => $('chatList').classList.remove('scrolling'), 900);
}, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && chat.open && chatAtBottom()) markRead(); });
$('dockAddr').onclick = async () => {
  try { await navigator.clipboard.writeText(state.roomAddr); toast('Endereço copiado.'); } catch { toast('Não foi possível copiar.', 'error'); }
};
setIcon($('pipChipClose'), 'close', 'Fechar as janelas flutuantes');
renderOverlayButton();
$('overlayToggle').onclick = toggleChatOverlay;
$('pipChipClose').onclick = () => { for (const id of [...state.pips.keys()]) closePip(id); };
setIcon($('chatAttach'), 'attach', 'Mandar arquivo (até 200 MB)');
setIcon($('chatSend'), 'send', 'Enviar');
$('chatForm').onsubmit = (e) => { e.preventDefault(); sendChat(); };
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
$('chatInput').addEventListener('input', fitChatInput);
$('chatAttach').onclick = () => $('chatFile').click();
$('chatFile').onchange = () => { attachFiles([...$('chatFile').files]); $('chatFile').value = ''; };
// Arrastar arquivo para o chat; fora dele, soltar um arquivo não faz a janela abrir o arquivo
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
$('chatTab').addEventListener('dragover', (e) => { e.preventDefault(); if (chat.supported) $('chatDrop').hidden = false; });
$('chatTab').addEventListener('dragleave', (e) => { if (!$('chatTab').contains(e.relatedTarget)) $('chatDrop').hidden = true; });
$('chatTab').addEventListener('drop', (e) => {
  e.preventDefault();
  $('chatDrop').hidden = true;
  attachFiles([...e.dataTransfer.files]);
});
$('closeStats').onclick = closeStats;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('voiceDialog').hidden) { if (!capturing) closeVoiceDialog(); }
  else if (!$('personCard').hidden) closePersonCard();
  else if (!$('peoplePop').hidden) { setPeopleOpen(false); $('peopleBtn').focus(); }
  else if (!$('statsDialog').hidden) closeStats();
  else if (!$('closeDialog').hidden) closeCloseDialog();
  else if (!$('shareDialog').hidden) closeShareDialog();
  else if (state.focus && !document.fullscreenElement) setFocus(null);
  else if (!$('home').hidden && !$('joinPanel').hidden) setJoinOpen(false);
});
document.addEventListener('fullscreenchange', () => {
  for (const link of state.in.values()) setFsIcon(link.tile.fs, document.fullscreenElement === link.tile.el);
});
document.addEventListener('visibilitychange', onVisibility);
window.addEventListener('focus', syncPreview);
window.addEventListener('blur', syncPreview);

show('home');
