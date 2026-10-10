'use strict';
// Voz: volume por pessoa, mixer, quem está falando, atenuação, barra da voz e cartão da pessoa.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, tema, microfone, membros, pip, overlay, chat.

// ---------- Volume por pessoa e quem está falando ----------
// Cada pessoa tem um volume de voz (0 a 200%), um da transmissão (0 a 100%) e "silenciar para mim".
// Fica guardado pela conta Razze da pessoa (a id da conta, o nick oficial: continua valendo se ela trocar o nome na
// sala ou o nick da conta), então vale de novo na próxima sala. Sem conta na sala (ou sala antiga), pelo nome da
// sala, como antes; o volume que estava pelo nome passa para a conta na primeira vez que a pessoa aparece com ela.
// O som da transmissão começa em 0%: a tela chega sem som, e você aumenta de quem quiser ouvir (no controle ou com a
// roda do mouse em cima da tela).
const DEFAULT_VOICE = 100;
const DEFAULT_SCREEN = 0;
let volumes = {};
try { volumes = JSON.parse(load('volumes', '{}')) || {}; } catch { volumes = {}; }
function volKey(id) {
  const conta = contaDe(id);
  return conta ? 'razze:' + conta.id : nameOf(id);
}
function volOf(id) {
  const key = volKey(id);
  return { voice: DEFAULT_VOICE, screen: DEFAULT_SCREEN, muted: false, ...(volumes[key] || (key !== nameOf(id) && volumes[nameOf(id)]) || {}) };
}
function setVol(id, patch) {
  const key = volKey(id);
  const v = { ...volOf(id), ...patch };
  if (key !== nameOf(id)) delete volumes[nameOf(id)]; // o de antes, pelo nome, passou para a conta
  if (v.voice === DEFAULT_VOICE && v.screen === DEFAULT_SCREEN && !v.muted) delete volumes[key];
  else volumes[key] = v;
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
  if (link?.music) return t.applyVolume(); // música junto: o volume é o do player do YouTube (renderer/musica.js)
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
    if (this.clipDest) gain.connect(this.clipDest);
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
    if (this.clipDest) src.connect(this.clipDest);
    this.localNode = { src, an: this.meter(src) };
    startSpeakLoop();
  },
  // A voz da call para o clipe (renderer/clipes.js): o que você ouve (cada um no volume que você deu) mais o seu
  // microfone (mutado = silêncio). Só existe enquanto o clipe pede; on=false desliga.
  clipDest: null,
  clipTrack(on) {
    if (!on) {
      if (this.clipDest) {
        for (const n of this.nodes.values()) try { n.gain.disconnect(this.clipDest); } catch {}
        try { this.localNode?.src.disconnect(this.clipDest); } catch {}
        this.clipDest = null;
      }
      return null;
    }
    if (!this.clipDest) {
      this.clipDest = this.ensure().createMediaStreamDestination();
      for (const n of this.nodes.values()) n.gain.connect(this.clipDest);
      this.localNode?.src.connect(this.clipDest);
    }
    return this.clipDest.stream.getAudioTracks()[0] || null;
  },
  deafen(on) {
    this.deafened = !!on;
    for (const id of this.nodes.keys()) this.apply(id);
  },
  apply(id) {
    // A mesma pessoa pode tocar duas vezes: no seu canal (id) e falando da subsala Líder ('lider:' + id)
    if (!id.startsWith('lider:')) this.apply('lider:' + id);
    const n = this.nodes.get(id);
    if (!n) return;
    const lider = id.startsWith('lider:'), v = volOf(lider ? id.slice(6) : id);
    // O volume da pessoa vezes o volume geral das vozes (Voz e atalhos › Volume das vozes); da Líder, vezes o volume dela
    n.gain.gain.value = this.deafened || v.muted ? 0 : (v.voice / 100) * (voiceCfg.vozes / 100) * (lider ? liderVolume / 100 : 1);
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
  const unheard = (id) => { const v = volOf(id); return voice.deafened || v.muted || v.voice === 0 || voiceCfg.vozes === 0; };
  for (const [key, n] of mixer.nodes) {
    const daLider = key.startsWith('lider:'), id = daLider ? key.slice(6) : key; // a voz da subsala Líder acende a mesma pessoa
    if (unheard(id) || (daLider && liderVolume === 0)) { lastLoud.delete(id); continue; }
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
  renderVoiceAvatars(true); // quem começou a falar entra na barra de baixo (se não estava à vista)
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
const voice = new VoiceChat({ send, changed: () => { lider.sync(); renderVoice(); }, error: message => toast(message, 'error'), mixer,
  activity: (event, id) => { if (id === voice.id || voice.session) void appSounds.play(event); } });
// A voz da subsala Líder para a sala toda (voice.js › LiderAudio; o canal dela vem de setSubsalas, em subsalas.js)
const lider = new LiderAudio({ voice, send, mixer, changed: () => scheduleVoiceLists() });
// Volume das vozes da Líder (0 a 100%), separado do volume de cada pessoa; fica salvo neste PC
let liderVolume = Math.max(0, Math.min(100, Number(load('liderVolume', '100')) || 0));
function setLiderVolume(v) {
  liderVolume = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  save('liderVolume', String(liderVolume));
  for (const key of mixer.nodes.keys()) if (key.startsWith('lider:')) mixer.apply(key);
}
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
  if (typeof renderMusicTiles === 'function') renderMusicTiles(); // os controles da música dependem do seu canal (musica.js)
  if (typeof syncShareOpen === 'function') syncShareOpen(); // transmissão só para o seu canal: quem saiu dele para de ver
  if (typeof syncComandoVozMic === 'function') void syncComandoVozMic(); // comando de voz: na voz, o microfone dele espera aberto
  const active = !!voice.session;
  const join = $('voiceJoin');
  join.disabled = !voice.supported;
  $('voiceDock').classList.toggle('active', active || voice.pending);
  if (active || voice.pending) {
    join.className = 'btn icon voice-leave';
    setIcon(join, 'phoneOff', voice.pending ? 'Cancelar entrada na voz' : 'Sair da voz');
  } else renderVoiceJoin();
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
  if (voiceSettingsOpen()) renderVoiceDialog();
  scheduleVoiceLists();
  if (!$('personCard').hidden) renderPersonCard();
  syncMuteSound();
}

// A lista de pessoas é refeita inteira: entrar na voz muda o estado várias vezes seguidas (pendente, sessão, cada
// conexão), então junta tudo num redesenho só, na próxima tarefa. MessageChannel e não setTimeout: com o app
// atrás do jogo o Chromium segura os timers por até 1 s, e a mensagem não.
let voiceListsQueued = false;
const voiceListsChannel = new MessageChannel();
voiceListsChannel.port1.onmessage = () => {
  voiceListsQueued = false;
  renderVoiceAvatars();
  if (state.myId) renderMembers();
  if (typeof renderHomeCall === 'function') renderHomeCall(); // a faixa do início mostra a sua voz
};
function scheduleVoiceLists() {
  if (voiceListsQueued) return;
  voiceListsQueued = true;
  voiceListsChannel.port2.postMessage(0);
}

// Painel recolhido: quem está na voz fica na barra; clicar abre o volume da pessoa.
// Só quem está no mesmo canal que você (na Voz geral ou na mesma subsala; fora da voz, todo mundo) e no máximo
// 3 pessoas, sempre com a foto (ou a estrela). Quem começa a falar entra na hora, no lugar de alguém calado, e quem
// já está à vista não muda de lugar (a barra não fica pulando); o resto vira "+N", que abre o painel da voz.
const DOCK_VOICE_MAX = 3;
let dockVoiceShown = [];
function dockVoicePick() {
  const mine = voice.session ? (voice.channel || '') : null;
  const all = [...voice.members].filter(([id, m]) => m.session && state.members.has(id)
    && (mine === null || typeof subsalasOn !== 'function' || !subsalasOn() || voiceChannelOf(id) === mine)).map(([id]) => id);
  const shown = dockVoiceShown.filter((id) => all.includes(id)).slice(0, DOCK_VOICE_MAX);
  for (const id of all) if (shown.length < DOCK_VOICE_MAX && !shown.includes(id)) shown.push(id);
  for (const id of all) {
    if (!speaking.has(id) || shown.includes(id)) continue;
    const quiet = shown.map((x, i) => [x, i]).reverse().find(([x]) => !speaking.has(x));
    if (quiet) shown[quiet[1]] = id;
  }
  return { all, shown, rest: all.filter((id) => !shown.includes(id)) };
}
let dockVoiceKey = '';
// Quem está na voz, na barra (com o painel recolhido): até 3 fotos sobrepostas (quem fala entra nelas e acende) e
// quantos são, num botão só, colado no Entrar. Clicar abre a lista que sobe (renderVoiceStackPop)
function renderVoiceAvatars(onlyIfChanged = false) {
  if (!voice.session && !voice.pending) renderVoiceJoin(); // as bolinhas do Entrar acompanham quem entra e sai
  const { all, shown } = dockVoicePick();
  const key = shown.join(',') + '|' + all.length;
  if (onlyIfChanged && key === dockVoiceKey) return;
  dockVoiceKey = key;
  dockVoiceShown = shown;
  const box = $('voiceAvatars');
  box.replaceChildren();
  box.hidden = !all.length; // no fim da pílula, quem está na chamada com você
  if (box.hidden) return closeVoiceStackPop();
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'voice-stack';
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', String(!!$('voiceStackPop')));
  const faces = document.createElement('span');
  faces.className = 'vs-faces';
  for (const id of shown) {
    const av = avatar(nameOf(id), id);
    av.dataset.person = id;
    av.classList.toggle('speaking', speaking.has(id));
    faces.append(av);
  }
  const count = document.createElement('span');
  count.className = 'vs-count';
  count.textContent = String(all.length);
  const label = document.createElement('span');
  label.className = 'vs-label';
  label.textContent = 'na voz';
  b.append(faces, count, label);
  const names = all.map(nameOf).join(', ');
  b.title = `Na voz: ${names}`;
  b.setAttribute('aria-label', `${all.length} na voz: ${names}. Abrir a lista`);
  b.onclick = () => ($('voiceStackPop') ? closeVoiceStackPop() : openVoiceStackPop());
  box.append(b);
  renderVoiceStackPop();
}

// ---------- Entrar na voz (fora dela): as bolinhas de quem já está conversando e "Entrar" ----------
// Sem ninguém, fica "Voz". Entrar vai para o canal com mais gente (empate: a Voz geral; nunca a subsala Líder). Com subsalas e gente em mais
// de um canal, a setinha ao lado abre a lista desses canais (voiceJoinPop) para escolher onde entrar.
function voiceBusyChannels() {
  if (!subsalasOn()) {
    const ids = [...voice.members].filter(([id, m]) => m.session && state.members.has(id)).map(([id]) => id);
    return ids.length ? [{ ch: '', ids }] : [];
  }
  return ['', ...state.subsalas.map((x) => x.id)].map((ch) => ({ ch, ids: voiceIdsIn(ch).filter(Boolean) })).filter((c) => c.ids.length);
}
// A subsala Líder nunca é o destino do Entrar: lá a pessoa falaria para a sala toda (só entra nela escolhendo)
function voiceJoinTarget() {
  const busy = voiceBusyChannels().filter((c) => !c.ch || c.ch !== liderChannel());
  return busy.reduce((best, c) => (c.ids.length > best.ids.length ? c : best), busy[0] || { ch: '', ids: [] });
}
function voiceFaces(ids) {
  const faces = document.createElement('span');
  faces.className = 'vs-faces';
  for (const id of ids.slice(0, DOCK_VOICE_MAX)) {
    const av = avatar(nameOf(id), id);
    av.dataset.person = id;
    av.classList.toggle('speaking', speaking.has(id));
    faces.append(av);
  }
  return faces;
}
function renderVoiceJoin() {
  const join = $('voiceJoin'), more = $('voiceJoinMore');
  if (voice.session || voice.pending) { more.hidden = true; return closeVoiceJoinPop(); }
  const busy = voiceBusyChannels(), target = voiceJoinTarget();
  join.className = 'btn voice-enter';
  join.replaceChildren();
  if (target.ids.length) join.append(voiceFaces(target.ids), 'Entrar');
  else { join.innerHTML = ICON.mic; join.append('Entrar na voz'); }
  const names = target.ids.map(nameOf).join(', ');
  join.title = !voice.supported ? 'O host precisa da versão 1.8.4 ou mais nova para ter voz'
    : target.ids.length ? `Entrar na voz${subsalasOn() ? ` (${channelName(target.ch)})` : ''}: ${names}` : 'Liga o microfone e entra na conversa por voz';
  join.setAttribute('aria-label', join.title);
  join.dataset.channel = target.ch;
  more.hidden = busy.length < 2;
  if (more.hidden) closeVoiceJoinPop(); else renderVoiceJoinPop();
}
function openVoiceJoinPop() {
  const pop = document.createElement('div');
  pop.id = 'voiceJoinPop';
  pop.className = 'voice-stack-pop';
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', 'Canais com gente na voz');
  document.body.append(pop);
  $('voiceJoinMore').setAttribute('aria-expanded', 'true');
  renderVoiceJoinPop();
  pop.querySelector('button')?.focus();
}
function closeVoiceJoinPop() {
  $('voiceJoinPop')?.remove();
  $('voiceJoinMore')?.setAttribute('aria-expanded', 'false');
}
function renderVoiceJoinPop() {
  const pop = $('voiceJoinPop');
  if (!pop) return;
  pop.replaceChildren();
  const head = document.createElement('div');
  head.className = 'vsp-head';
  head.innerHTML = '<strong>Entrar em</strong>';
  const list = document.createElement('div');
  list.className = 'vsp-list';
  for (const { ch, ids } of voiceBusyChannels()) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vs-row';
    row.setAttribute('role', 'menuitem');
    const name = document.createElement('span');
    name.className = 'vs-name';
    name.textContent = channelName(ch);
    const count = document.createElement('span');
    count.className = 'vsp-where';
    count.textContent = String(ids.length);
    row.append(voiceFaces(ids), name, count);
    row.title = `Entrar em ${channelName(ch)}: ${ids.map(nameOf).join(', ')}`;
    row.onclick = () => { closeVoiceJoinPop(); joinVoiceIn(ch); };
    list.append(row);
  }
  pop.append(head, list);
  const r = $('voiceDock').getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
}
function joinVoiceIn(ch) {
  if (state.systemLoopback) return toast('Pare sua transmissão, entre na voz e depois reinicie a transmissão: a captura atual inclui todo o som do PC.', 'error');
  mixer.ensure(); // o clique libera o áudio do app
  voice.setChannel(ch);
}

// ---------- Lista que sobe do "N na voz" ----------
// Quem está na voz (clicar abre o volume da pessoa; a roda do mouse em cima muda o volume), Entrar na voz (se você
// está fora) e o painel da voz. Fecha com Esc ou clique fora (inicio.js)
function openVoiceStackPop() {
  const pop = document.createElement('div');
  pop.id = 'voiceStackPop';
  pop.className = 'voice-stack-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Quem está na voz');
  document.body.append(pop);
  $('voiceAvatars').querySelector('.voice-stack')?.setAttribute('aria-expanded', 'true');
  renderVoiceStackPop();
}
function closeVoiceStackPop() {
  if (typeof skyFocusFrom !== 'undefined' && skyFocusFrom === 'pilula') closeSkyProfile();
  guardarSkyFocus($('voiceStackPop'));
  $('voiceStackPop')?.remove();
  $('voiceAvatars').querySelector('.voice-stack')?.setAttribute('aria-expanded', 'false');
}
function renderVoiceStackPop() {
  const pop = $('voiceStackPop');
  if (!pop) return;
  const { all } = dockVoicePick();
  if ($('voiceAvatars').hidden || !all.length) return closeVoiceStackPop();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  guardarSkyFocus(pop); // volta no fim, se o perfil continua aberto
  pop.replaceChildren();
  const head = el('div', 'vsp-head');
  head.append(el('strong', '', 'Na voz'), el('span', '', String(all.length)));
  if (voice.session && subsalasOn()) head.append(el('span', 'vsp-where', `· ${channelName(voice.channel)}`));
  const list = el('div', 'vsp-list');
  for (const id of all) {
    const m = voice.members.get(id);
    const row = el('button', 'vs-row');
    row.type = 'button';
    const av = avatar(nameOf(id), id);
    av.dataset.person = id;
    av.classList.toggle('speaking', speaking.has(id));
    row.append(av, paintName(el('span', 'vs-name', nameOf(id)), id));
    if (!voice.session && subsalasOn()) row.append(el('span', 'vsp-where', channelName(voiceChannelOf(id))));
    for (const [on, icon, label] of [[m?.muted, 'micOff', 'Microfone desligado'], [m?.deafened, 'headphonesOff', 'Fone silenciado']]) {
      if (!on) continue;
      const s = el('span', 'vs-state');
      s.innerHTML = ICON[icon];
      s.title = label;
      s.setAttribute('role', 'img');
      s.setAttribute('aria-label', label);
      row.append(s);
    }
    row.title = `${nameOf(id)}: volume (a roda do mouse em cima também muda)`;
    // O mesmo perfil das outras listas, aberto dentro desta; a mesma pessoa de novo fecha
    row.onclick = (e) => (skyFocusId === id && skyFocusFrom === 'pilula' ? closeSkyProfile() : openSkyProfile(id, e.detail === 0 ? row : e, 'pilula'));
    onWheelVolume(row, id, 'voice');
    list.append(row);
  }
  const actions = el('div', 'vsp-actions');
  if (!voice.session && !voice.pending) {
    const join = el('button', 'btn primary');
    join.type = 'button';
    join.innerHTML = ICON.mic;
    join.append('Entrar na voz');
    join.onclick = () => { closeVoiceStackPop(); $('voiceJoin').click(); };
    actions.append(join);
  }
  const panel = el('button', 'btn ghost', 'Abrir o painel da voz');
  panel.type = 'button';
  panel.onclick = () => { closeVoiceStackPop(); setPainelSala({ aba: 'voz', recolhido: false }); };
  actions.append(panel);
  pop.append(head, list, actions);
  if (skyFocusFrom === 'pilula' && skyFocusId) pop.append($('skyFocus')); // o perfil aberto continua na lista redesenhada
  // Sobe a partir do botão, alinhado à esquerda dele (sem passar da janela)
  const r = $('voiceAvatars').getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
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
  if (el.closest('#peoplePop')) { // na lista de Pessoas, o mesmo perfil da voz; a mesma pessoa de novo fecha
    if (skyFocusId === el.dataset.profile && skyFocusFrom === 'pessoas') return closeSkyProfile();
    return openSkyProfile(el.dataset.profile, e.detail === 0 ? el : e, 'pessoas');
  }
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
// ---------- Os nomes de quem está na sala ----------
// Cada pessoa tem o nome que escolheu no app (o da sala) e, se entrou na conta Razze, o nome da conta no servidor,
// que vem junto pela sala (sala-protocolo.js › cleanRazze). A conta é declarada pelo app da pessoa: só a sua lista de
// amigos (pela id) confirma. Sala ou servidor antigos não repassam a conta: aí vale o nome da sala, como antes.
function contaDe(id) { return id === state.myId ? contaSala() : state.members.get(id)?.razze || null; }
const mesmoNome = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
// O amigo (da sua lista) que é essa pessoa: pela conta; sem conta na sala, pelo nome, como antes
function amigoDe(id) {
  if (typeof friendsData !== 'object') return null;
  const conta = contaDe(id);
  return friendsData.friends.find((f) => (conta ? f.id === conta.id : mesmoNome(f.displayName, nameOf(id)))) || null;
}
// "Na sala" e "Conta Razze" no perfil (null sem conta)
function nomesDe(id) {
  const conta = contaDe(id);
  if (!conta) return null;
  const eu = id === state.myId, amigo = !eu && amigoDe(id);
  const linha = (rotulo, valor, nota) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = rotulo;
    const dd = document.createElement('dd');
    dd.textContent = valor;
    row.append(dt, dd);
    if (!nota) return row;
    const n = document.createElement('div'); // a nota numa linha só dela, embaixo do nome
    n.className = 'nomes-nota';
    const ndd = document.createElement('dd');
    ndd.textContent = nota;
    n.append(ndd);
    return [row, n];
  };
  const dl = document.createElement('dl');
  dl.className = 'nomes-pessoa';
  dl.append(linha('Nome na sala', eu ? getName() : nameOf(id)),
    ...[].concat(linha('Nome da conta', amigo ? amigo.displayName : conta.nome, eu || amigo ? '' : 'informado pelo app da pessoa')));
  return dl;
}

// Amizade (conta Razze). Já amigos ou pedido enviado: o botão só informa; pedido recebido: aceita; senão, manda o
// pedido pela conta da pessoa (o nome do servidor, não o da sala); sem conta na sala, pelo nome da sala, como antes.
// Sem conta sua, abre o Perfil, na Conta Razze, para entrar.
function friendButton(id, name) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small icon pc-friend';
  const conta = contaDe(id);
  const nome = conta?.nome || name;
  const find = (list) => list.find((x) => (conta ? x.userId === conta.id : mesmoNome(x.displayName, name)));
  const friend = amigoDe(id), sent = find(friendsData.outgoing), got = find(friendsData.incoming);
  if (friend || sent) {
    setIcon(b, friend ? 'userCheck' : 'userPlus', friend ? `Você e ${friend.displayName} já são amigos` : `Pedido de amizade enviado para ${nome}`);
    b.setAttribute('aria-disabled', 'true');
    b.classList.add('done');
    return b;
  }
  setIcon(b, 'userPlus', got ? `Aceitar o pedido de amizade de ${got.displayName || nome}` : `Adicionar ${nome} como amigo`);
  if (got) b.classList.add('accent');
  b.onclick = async () => {
    if (got) { await acceptFriend(got); toast(`Agora você e ${got.displayName || nome} são amigos.`); return renderPersonCard(); }
    const account = await window.api.razzeState().catch(() => null);
    if (!account?.authenticated) {
      toast('Entre na sua conta Razze (no seu Perfil) para adicionar amigos.');
      return openRazzeLogin();
    }
    b.disabled = true;
    try {
      const result = conta ? await window.api.razzeRequestFriendId(conta.id, conta.nome) : await window.api.razzeRequestFriend(name.trim());
      toast(result.status === 'accepted' ? `Agora você e ${nome} são amigos.` : `Pedido de amizade enviado para ${nome}.`);
      await refreshRazzeLists();
    } catch (error) {
      toast(`Não deu para adicionar ${nome}: ${error.message}`, 'error');
    }
    renderPersonCard();
  };
  return b;
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
  const nomes = nomesDe(id);
  if (nomes) who.append(nomes);
  const av = avatar(name, id);
  av.dataset.person = id;
  av.classList.add('pc-photo');
  av.classList.toggle('speaking', speaking.has(id));
  // Com foto: a bolinha (encaixada, sem esticar); clicar nela abre a foto em tela cheia (a inteira, quando houver)
  if (photoHashOf(id)) {
    const photoBtn = document.createElement('button');
    photoBtn.type = 'button';
    photoBtn.className = 'pc-photo-btn';
    photoBtn.setAttribute('aria-label', `Ver a foto de ${name} em tela cheia`);
    photoBtn.title = 'Ver em tela cheia';
    photoBtn.append(av);
    photoBtn.onclick = () => openPhotoViewer(id, name, photoBtn);
    head.append(photoBtn, who);
  } else head.append(av, who);
  head.append(friendButton(id, name));
  card.append(head);
  // O "i" de que só muda para você fica ao lado do primeiro controle que aparece
  let tipDone = false;
  const tipText = `Volume e silenciar só mudam o que você ouve. ${name} e o resto da sala não percebem.`;
  const slider = (label, key, max, show) => {
    if (!show) return;
    const row = document.createElement('label');
    row.className = 'pc-slider';
    const top = document.createElement('span');
    const text = document.createElement('span');
    text.textContent = label;
    if (!tipDone) { text.append(tipButton(tipText)); tipDone = true; }
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
      volumes[volKey(id)] = next;
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
    p.textContent = 'O volume vale quando entrar na voz ou na tela.';
    p.append(tipButton(tipText));
    card.append(p);
  }
  const actions = document.createElement('div');
  actions.className = 'pc-actions';
  const mute = document.createElement('button');
  mute.type = 'button';
  // Só ícones: o nome de cada um aparece ao passar o mouse (e é o que o leitor de tela lê)
  mute.className = 'btn small icon' + (v.muted ? ' warn-on' : '');
  setIcon(mute, 'muted', v.muted ? `Ouvir ${name} de novo` : `Silenciar ${name} para mim`);
  mute.setAttribute('aria-pressed', String(v.muted));
  mute.onclick = () => { setVol(id, { muted: !v.muted }); renderPersonCard(); card.querySelector('.pc-actions .btn')?.focus(); };
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn small icon';
  setIcon(reset, 'reset', `Voltar ao padrão: voz em ${DEFAULT_VOICE}% e a transmissão sem som`);
  reset.onclick = () => { setVol(id, { voice: DEFAULT_VOICE, screen: DEFAULT_SCREEN, muted: false }); renderPersonCard(); };
  actions.append(mute, reset);
  card.append(actions);
  if (focused) card.querySelector(`[aria-label="${CSS.escape(focused)}"]`)?.focus();
}
