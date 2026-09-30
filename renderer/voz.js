'use strict';
// Voz: volume por pessoa, mixer, quem está falando, atenuação, barra da voz e cartão da pessoa.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, tema, microfone, membros, pip, overlay, chat.

// ---------- Volume por pessoa e quem está falando ----------
// Cada pessoa tem um volume de voz (0 a 200%), um da transmissão (0 a 100%) e "silenciar para mim".
// Fica guardado pelo nome, então vale de novo na próxima sala. O som da transmissão começa em 0%: a tela
// chega sem som, e você aumenta de quem quiser ouvir (no controle ou com a roda do mouse em cima da tela).
const DEFAULT_VOICE = 100;
const DEFAULT_SCREEN = 0;
let volumes = {};
try { volumes = JSON.parse(load('volumes', '{}')) || {}; } catch { volumes = {}; }
function volOf(id) {
  return { voice: DEFAULT_VOICE, screen: DEFAULT_SCREEN, muted: false, ...(volumes[nameOf(id)] || {}) };
}
function setVol(id, patch) {
  const name = nameOf(id);
  const v = { ...volOf(id), ...patch };
  if (v.voice === DEFAULT_VOICE && v.screen === DEFAULT_SCREEN && !v.muted) delete volumes[name];
  else volumes[name] = v;
  save('volumes', JSON.stringify(volumes));
  mixer.apply(id);
  applyScreenVolume(id);
  renderMembers();
  renderVoiceAvatars();
}

// ---------- Volume com a roda do mouse ----------
// Em cima da tela de alguém (som da transmissão), da janela flutuante, do nome na barra da voz, do botão de
// volume na lista ou do controle no cartão: cada "clique" da roda muda 5%. O touchpad manda muitos passos
// pequenos: eles se somam até dar um clique.
const WHEEL_STEP = 5;
const wheelAcc = new Map();
function wheelSteps(key, e) {
  const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  const acc = (wheelAcc.get(key) || 0) + px;
  const steps = Math.trunc(acc / 100);
  wheelAcc.set(key, acc - steps * 100);
  return -steps; // roda para cima = mais alto
}
function wheelVolume(id, key, e, where = document) {
  const steps = wheelSteps(`${id}|${key}`, e);
  if (!steps) return;
  const v = volOf(id);
  const max = key === 'voice' ? 200 : 100;
  const next = Math.max(0, Math.min(max, v[key] + steps * WHEEL_STEP));
  const tile = key === 'screen' && state.in.get(id)?.tile;
  if (tile) tile.userMuted = false; // mexer no volume da tela é querer ouvir
  setVol(id, { [key]: next, muted: false });
  if (!$('personCard').hidden && $('personCard').dataset.for === id) renderPersonCard();
  volBubble(where, `${key === 'voice' ? 'Voz' : 'Som da tela'} de ${nameOf(id)}: ${next}%`, e.clientX, e.clientY);
}
// Balãozinho perto do mouse com o volume novo (some sozinho). Vale também nas janelas flutuantes.
function volBubble(d, text, x, y) {
  let b = d.getElementById('volBubble');
  if (!b) {
    b = d.createElement('div');
    b.id = 'volBubble';
    b.setAttribute('role', 'status');
    Object.assign(b.style, {
      position: 'fixed', zIndex: '60', pointerEvents: 'none', padding: '5px 10px', borderRadius: '6px', whiteSpace: 'nowrap',
      background: THEME.glass, border: `1px solid ${THEME.line}`, color: THEME.text, fontFamily: THEME.font, fontSize: '12.5px', fontWeight: '600',
    });
    d.body.append(b);
  }
  b.textContent = text;
  const w = d.defaultView;
  b.style.left = `${Math.max(8, Math.min(w.innerWidth - 200, x + 14))}px`;
  b.style.top = `${Math.max(8, y - 34)}px`;
  b.style.display = 'block';
  clearTimeout(b.hideTimer);
  b.hideTimer = setTimeout(() => { b.style.display = 'none'; }, 1100);
}
function onWheelVolume(el, id, key, where) {
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelVolume(id, typeof key === 'function' ? key() : key, e, where);
  }, { passive: false });
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
  const muted = v.muted || t.userMuted; // "Silenciar para mim" ou o alto-falante da própria tela
  if (!t.paused) t.video.muted = muted;
  else t.mutedBefore = muted;
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

// Entrar e sair da voz: o som toca para você mesmo e, de quem mais, só se você estiver na voz (quem só está
// na sala, assistindo, não precisa ouvir cada entrada e saída da conversa)
const voice = new VoiceChat({ send, changed: renderVoice, error: message => toast(message, 'error'), mixer,
  activity: (event, id) => { if (id === voice.id || voice.session) void appSounds.play(event); } });
// Mutar e desmutar o seu microfone tocam som (o botão ou o atalho; o apertar para falar não). O fone tem o som
// dele; quando o fone muda, o microfone muda junto e toca só o som do fone.
let voiceWasMuted = false, voiceWasDeafened = false;
function syncMuteSound() {
  const muted = !!voice.session && voice.muted, deafened = !!voice.session && voice.deafened;
  if (voice.session && deafened !== voiceWasDeafened) void appSounds.play(deafened ? 'deafen' : 'undeafen');
  else if (voice.session && muted !== voiceWasMuted) void appSounds.play(muted ? 'mute' : 'unmute');
  voiceWasMuted = muted;
  voiceWasDeafened = deafened;
}
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
  syncMicTest();
  if (!$('voiceDialog').hidden) renderVoiceDialog();
  renderVoiceAvatars();
  if (state.myId) renderMembers();
  if (!$('personCard').hidden) renderPersonCard();
  syncMuteSound();
  if (typeof renderHomeCall === 'function') renderHomeCall(); // a faixa do início mostra a sua voz
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
    b.dataset.initial = (nameOf(id).trim()[0] || '?').toUpperCase(); // barra apertada: sem o nome, fica a inicial
    b.style.setProperty('--person', personColor(id));
    const nm = document.createElement('span');
    nm.className = 'va-name';
    nm.textContent = nameOf(id);
    paintName(nm, id);
    if (photoHashOf(id)) b.append(avatar(nameOf(id), id)); // com foto, ela vem antes do nome
    b.append(nm, speakBars());
    const m = voice.members.get(id);
    // Fone silenciado: o ícone do fone cortado ao lado do nome
    if (m.deafened) { const d = document.createElement('span'); d.className = 'va-deaf'; d.innerHTML = ICON.headphonesOff; b.append(d); }
    const label = `${nameOf(id)}${m.muted ? ', microfone desligado' : ''}${m.deafened ? ', fone silenciado' : ''}. Mudar o volume`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.classList.toggle('mic-off', !!m.muted);
    b.classList.toggle('speaking', speaking.has(id));
    b.onclick = (e) => openPersonCard(id, b, e.detail === 0);
    onWheelVolume(b, id, 'voice');
    box.append(b);
  }
}

// ---------- Cartão da pessoa: volume da voz, da transmissão e silenciar para mim ----------
// Foto ou nome de outra pessoa (data-profile="id") em qualquer lugar: clicar ou Enter abre o cartão dela
function markProfile(el, id, name) {
  if (!id || id === state.myId) return el;
  el.dataset.profile = id;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.title = `Ver o perfil de ${name}`;
  return el;
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-profile]');
  if (!el || !state.members.has(el.dataset.profile)) return;
  e.stopPropagation();
  openPersonCard(el.dataset.profile, el, e.detail === 0);
});
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches?.('[data-profile]')) return;
  e.preventDefault();
  if (state.members.has(e.target.dataset.profile)) openPersonCard(e.target.dataset.profile, e.target, true);
});
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
  // "fixed" aqui conta a partir do body (que desce pela barra de título): mede o 0 de verdade e desconta
  card.style.left = '0px'; card.style.top = '0px';
  const origin = card.getBoundingClientRect();
  card.style.left = `${left - origin.left}px`;
  card.style.top = `${top - origin.top}px`;
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
  paintName(strong, id);
  const sub = document.createElement('span');
  sub.textContent = v.muted ? 'Silenciada para você' : [inVoice(id) && 'Na voz', state.members.get(id)?.sharing && 'Transmitindo'].filter(Boolean).join(' · ') || 'Na sala';
  who.append(strong, sub);
  const av = avatar(name, id);
  av.dataset.person = id;
  av.classList.add('pc-photo');
  av.classList.toggle('speaking', speaking.has(id));
  // Com foto: ela aparece inteira no topo (sem o corte redondo); clicar abre em tamanho grande
  if (photoHashOf(id)) {
    const photoBtn = document.createElement('button');
    photoBtn.type = 'button';
    photoBtn.className = 'pc-photo-btn';
    photoBtn.classList.toggle('speaking', speaking.has(id));
    photoBtn.setAttribute('aria-label', `Ver a foto de ${name} em tamanho grande`);
    photoBtn.title = 'Ver em tamanho grande';
    const img = document.createElement('img');
    img.className = 'pc-photo-full';
    img.alt = '';
    const hash = state.members.get(id)?.avatarFull;
    img.src = (hash && fotos.fullUrls.get(hash)) || photoUrl(photoHashOf(id));
    // A inteira chega depois (a pequena é quadrada, cortada): troca quando vier
    if (!hash || !fotos.fullUrls.has(hash)) fullPhotoOf(id).then((url) => { if (url && img.isConnected) img.src = url; });
    photoBtn.append(img);
    photoBtn.onclick = () => openPhotoViewer(id, name, photoBtn);
    card.append(photoBtn);
    head.append(who);
  } else head.append(av, who);
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
    // A roda do mouse em cima do controle anda de 5 em 5 (o controle do Chromium não reage à roda)
    input.addEventListener('wheel', (e) => {
      e.preventDefault();
      const steps = wheelSteps(`${id}|${key}`, e);
      if (!steps) return;
      input.value = String(Math.max(0, Math.min(max, Number(input.value) + steps * WHEEL_STEP)));
      input.oninput();
      input.onchange();
    }, { passive: false });
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
  reset.textContent = 'Voltar ao padrão';
  reset.title = `Voz em ${DEFAULT_VOICE}% e a transmissão sem som (${DEFAULT_SCREEN}%)`;
  reset.onclick = () => { setVol(id, { voice: DEFAULT_VOICE, screen: DEFAULT_SCREEN, muted: false }); renderPersonCard(); };
  actions.append(mute, reset);
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = `Só muda o que você ouve. ${name} e o resto da sala não percebem.`;
  card.append(actions, note);
  if (focused) card.querySelector(`[aria-label="${CSS.escape(focused)}"]`)?.focus();
}
