'use strict';
// Assistir: quadros de vídeo, ver a própria transmissão, destaque, tela cheia e vídeo com o app escondido.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, rtc, tema, voz, membros, pip, overlay, estatisticas, transmitir.

function toggleFullscreen(el) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else el.requestFullscreen().catch(() => {});
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
  // Faixa de título em cima do vídeo: foto, nome, barrinhas de quem fala, "Ao vivo", a qualidade que está chegando
  // e, à direita, os controles (volume, janela flutuante, destaque, tela cheia, parar)
  const label = document.createElement('div');
  label.className = 'tile-name';
  label.style.setProperty('--person', personColor(id));
  const face = markProfile(avatar(name.replace(/ \(você\)$/, ''), id), id, name);
  const labelText = document.createElement('span');
  labelText.className = 'tile-name-text';
  labelText.textContent = name;
  paintName(labelText, id);
  const live = document.createElement('span');
  live.className = 'tile-chip live';
  live.textContent = 'Ao vivo';
  const quality = document.createElement('span');
  quality.className = 'tile-chip tile-quality';
  quality.hidden = true;
  quality.title = 'Resolução e quadros por segundo que estão chegando';
  // "sem som": quem transmite está sem o som do PC (desligado ou a captura falhou); aí o volume não tem o que mudar
  const noAudio = document.createElement('span');
  noAudio.className = 'tile-noaudio';
  noAudio.hidden = true;
  noAudio.innerHTML = ICON.muted;
  noAudio.append('sem som');
  noAudio.title = `${name} está transmitindo sem o som do PC`;
  label.append(face, labelText, speakBars(), live, quality, noAudio);
  const bar = document.createElement('div');
  bar.className = 'tile-bar';
  const barSpace = document.createElement('span');
  barSpace.className = 'tile-bar-space';
  const mute = document.createElement('button');
  mute.className = 'btn icon tile-mute';
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
    if (video.volume > 0) { video.muted = false; tile.userMuted = false; }
    syncMute();
  };
  // O volume do quadro fica guardado como o "som da transmissão" dessa pessoa
  vol.onchange = () => setVol(id, { screen: Math.round(parseFloat(vol.value) * 100), muted: false });
  // O mudo do alto-falante é só desta tela e fica no quadro (userMuted): a atenuação e o volume salvo o respeitam
  mute.onclick = () => {
    // Em 0% (o começo de toda transmissão), o alto-falante liga o som em 100% e guarda
    if (video.volume === 0 && !state.in.get(id)?.self) { tile.userMuted = false; return setVol(id, { screen: 100, muted: false }); }
    if (state.in.get(id)?.self) { video.muted = !video.muted; syncMute(); return; }
    const silent = tile.paused ? tile.mutedBefore : video.muted;
    tile.userMuted = !silent;
    if (silent && volOf(id).muted) return setVol(id, { muted: false }); // estava em "Silenciar para mim"
    applyScreenVolume(id);
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
  // Tesoura: salva os últimos segundos (renderer/clipes.js); só aparece quando já há o que clipar
  const clipBtn = document.createElement('button');
  clipBtn.className = 'btn icon';
  clipBtn.hidden = true;
  setIcon(clipBtn, 'scissors', 'Salvar clipe');
  clipBtn.onclick = () => saveClip(id);
  const fs = document.createElement('button');
  fs.className = 'btn icon';
  setFsIcon(fs, false);
  fs.onclick = () => toggleFullscreen(el);
  const close = document.createElement('button');
  close.className = 'btn icon';
  setIcon(close, 'close', 'Parar de assistir');
  close.onclick = () => stopWatching(id);
  bar.append(barSpace, mute, vol, clipBtn, pipBtn, focusBtn, fs, close);
  label.append(bar); // os controles ficam na faixa do nome, sempre à vista
  // Qualidade que está chegando: altura do vídeo e quadros por segundo (medidos a cada 2 s). Em pausa, só a altura.
  let lastFrames = null;
  const qualityTimer = setInterval(() => {
    if (!el.isConnected) return clearInterval(qualityTimer);
    clipBtn.hidden = !clipReady(id);
    if (!clipBtn.hidden) clipBtn.title = clipBtn.ariaLabel = `Salvar clipe dos últimos ${clipSeconds()} s (${accelLabel(shortcutKeys.clip || '')})`;
    const h = video.videoHeight;
    quality.hidden = !h;
    if (!h) return;
    const frames = video.getVideoPlaybackQuality?.().totalVideoFrames || 0, now = performance.now();
    const fps = lastFrames && !video.paused ? (frames - lastFrames.frames) / ((now - lastFrames.at) / 1000) : 0;
    lastFrames = { frames, at: now };
    quality.textContent = fps >= 1 ? `${h}p ${fps >= 20 ? Math.round(fps / 5) * 5 : Math.round(fps)}` : `${h}p`;
  }, 2000);
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
  const ambient = document.createElement('canvas');
  ambient.className = 'tile-ambient';
  ambient.width = 32; ambient.height = 18;
  ambient.hidden = true;
  body.append(ambient, video, overlay, pipNote);
  // Luz ambiente (Aparência): nas barras pretas, as cores do vídeo, desfocadas. Um quadro de 32 x 18 duas vezes
  // por segundo, e só quando o vídeo não enche o quadro; o desfoque fica por conta do CSS (.tile-ambient).
  const ambientCtx = ambient.getContext('2d', { alpha: false });
  const ambientTimer = setInterval(() => {
    if (!el.isConnected) return clearInterval(ambientTimer);
    const vw = video.videoWidth, vh = video.videoHeight, bw = body.clientWidth, bh = body.clientHeight;
    const bars = vw && vh && bw && bh && Math.abs((vw / vh) / (bw / bh) - 1) > 0.02;
    const want = appPreferences.appearance.ambient && !gamerOn(); // o modo gamer desliga a luz ambiente (modo-gamer.js)
    const on = want && bars && !video.paused && pipNote.hidden && !document.hidden;
    if (!on) { ambient.hidden = !(want && bars && pipNote.hidden); return; }
    try { ambientCtx.drawImage(video, 0, 0, ambient.width, ambient.height); ambient.hidden = false; } catch { ambient.hidden = true; }
  }, 500);
  el.append(label, body);
  // Roda do mouse em cima da tela: som dessa transmissão (a sua própria não tem som)
  el.addEventListener('wheel', (e) => {
    if (state.in.get(id)?.self) return;
    e.preventDefault();
    wheelVolume(id, 'screen', e);
  }, { passive: false });
  el.addEventListener('dblclick', (e) => { if (!bar.contains(e.target) && !el.classList.contains('small')) toggleFullscreen(el); });
  // Na coluna ao lado, clicar (ou Enter) numa tela pequena põe ela em destaque
  el.addEventListener('click', () => { if (el.classList.contains('small') && !palco.justDragged) setMain(id); });
  el.addEventListener('keydown', (e) => {
    if (el.classList.contains('small') && e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setMain(id); }
  });
  $('tiles').append(el);
  setupTileDrag(id, el);
  setupTileIdle(el);
  el.dataset.person = id;
  const tile = { el, video, vol, overlay, pipNote, fs, focusBtn, pipBtn, syncMute, name, paused: false, mutedBefore: false, userMuted: false };
  return tile;
}

// Mostra a barra do vídeo por alguns segundos, para quem nunca passou o mouse em cima descobrir os botões
function revealBar(tile) {
  tile.el.classList.add('show-bar');
  clearTimeout(tile.barTimer);
  tile.barTimer = setTimeout(() => tile.el.classList.remove('show-bar'), 4000);
}

// A transmissão tem som? Vale o que quem transmite diz (versão 1.9.0 ou mais nova); sem isso, se a faixa de
// som chegou alguns segundos depois de conectar
function renderTileAudio(id) {
  const link = state.in.get(id);
  if (!link || link.self) return;
  const info = state.members.get(id)?.shareInfo;
  const hasTrack = link.tracks.some((t) => t.kind === 'audio');
  const silent = info && typeof info.audio === 'boolean' ? !info.audio : link.audioChecked && !hasTrack;
  link.tile.el.classList.toggle('no-audio', !!silent);
  link.tile.el.querySelector('.tile-noaudio').hidden = !silent;
}

let soundHintShown = false; // o aviso do som desligado aparece uma vez só por vez que o app abre
function watch(id) {
  if (state.in.has(id) || !state.members.get(id)?.sharing) return;
  if (!canWatch(id)) return toast(closedShareText(id)); // fechada para outros canais (transmitir.js)
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const tile = createTile(id, nameOf(id));
  const link = { pc, chain: Promise.resolve(), tile, lastBytes: 0, lastTs: 0, videoOn: true, tracks: [], once: null };
  state.in.set(id, link);
  // Toda transmissão começa sem som; o alto-falante do quadro liga no volume que você deixou para essa pessoa
  tile.userMuted = true;
  applyScreenVolume(id);
  renderTileAudio(id);
  if (!soundHintShown) {
    soundHintShown = true;
    toast('As telas começam sem som. Clique no alto-falante da tela (ou role a roda do mouse em cima dela) para ouvir.');
  }

  pc.ontrack = (e) => {
    if (e.track.kind === 'video') setVideoTrack(link, e.track);
    else { link.tracks.push(e.track); refreshTileStream(link); renderTileAudio(id); }
  };
  // Quem transmite no modo "uma vez só" manda o vídeo já codificado por este canal
  pc.ondatachannel = (e) => { if (e.channel.label === 'video') setupOnceReceiver(link, e.channel); };
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal(id, { side: 'viewer', candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    const o = tile.overlay;
    if (s === 'connected') {
      clearTimeout(link.audioTimer);
      link.audioTimer = setTimeout(() => { link.audioChecked = true; renderTileAudio(id); }, 4000);
      if (!o.hidden) revealBar(tile);
      o.hidden = true;
    } else {
      o.hidden = false;
      // Caiu: quem transmite refaz o caminho sozinho. Pede também daqui, caso o lado de lá não tenha percebido.
      if (s === 'failed') sendSignal(id, { side: 'viewer', restart: true });
      o.textContent = s === 'failed' || s === 'disconnected' ? 'A conexão caiu. Reconectando…' : 'Conectando…';
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

// Transmitindo uma tela inteira e se vendo, a captura pegaria o próprio quadro, que mostra a captura...
// (espelho infinito: o mouse se multiplica e tudo se repete, para você e para quem assiste). Enquanto isso,
// a janela do app e as flutuantes saem da captura (o Windows mostra o que está atrás delas). Para você, nada
// muda na tela. Transmitindo uma janela, não precisa.
// O Mapa de conexões (endereços e redes, em Configurações › Rede) também: à vista durante a transmissão, o app sai da captura.
let captureExcluded = false;
function syncCaptureExclude() {
  const mirror = !!state.myId && state.in.get(state.myId)?.self === true && state.sharing && /^screen:/.test(state.sharingSource || '');
  const secret = state.sharing && connectionMapVisible();
  const on = mirror || secret;
  if (on === captureExcluded) return;
  captureExcluded = on;
  window.api.captureExclude(on).catch(() => {});
  if (on) toast(mirror ? 'Enquanto você se vê, a janela do app fica fora da sua transmissão (senão ela vira um espelho infinito).'
    : 'O Mapa de conexões não aparece na sua transmissão: enquanto Configurações › Rede está aberta, o app fica fora dela.');
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
  syncCaptureExclude(); // antes do vídeo aparecer
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
  syncCaptureExclude(); // trocou de tela para janela (ou o contrário)
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
  if (link.music) { renderNavMusic(); send({ type: 'musica-ouvindo', ch: id.slice('musica:'.length), on: false }); } // parou de ouvir: o botão de música da barrinha some
  if (state.focus === id) state.focus = null; // quem estava em destaque saiu: as outras voltam
  renderFocus();
  renderMembers();
  updateStage();
  if (link.self) { syncCaptureExclude(); renderShareBox(); }
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
  if (!state.in.has(state.main)) state.main = stageIds()[0] || null;
  const focus = state.focus;
  const column = !focus && state.in.size > 1 && palco.layout === 'spotlight';
  const tiles = $('tiles');
  tiles.classList.toggle('focused', !!focus);
  tiles.classList.toggle('column', column);
  tiles.classList.toggle('grid', !column);
  // Destaque: linhas vazias em cima e embaixo deixam a coluna centralizada ao lado da tela grande.
  // Grade: colunas e linhas vêm de layoutGrid (palco.js).
  tiles.style.gridTemplateColumns = '';
  tiles.style.gridTemplateRows = column ? `minmax(0, 1fr) repeat(${state.in.size - 1}, auto) minmax(0, 1fr)` : '';
  let row = 2;
  for (const id of stageIds()) {
    const t = state.in.get(id).tile;
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
  layoutStage();
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
    // Painel "Transmissão" desligado: as telas estão escondidas, então o vídeo pausa como com o app minimizado
    const streamsShown = typeof workspaceViews !== 'object' || workspaceViews.streams !== false;
    const on = inPip || (appVisible && streamsShown && (!state.focus || state.focus === id));
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
