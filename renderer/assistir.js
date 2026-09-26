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

// Transmitindo uma tela inteira e se vendo, a captura pegaria o próprio quadro, que mostra a captura...
// (espelho infinito: o mouse se multiplica e tudo se repete, para você e para quem assiste). Enquanto isso,
// a janela do app e as flutuantes saem da captura (o Windows mostra o que está atrás delas). Para você, nada
// muda na tela. Transmitindo uma janela, não precisa.
let captureExcluded = false;
function syncCaptureExclude() {
  const on = !!state.myId && state.in.get(state.myId)?.self === true && state.sharing && /^screen:/.test(state.sharingSource || '');
  if (on === captureExcluded) return;
  captureExcluded = on;
  window.api.captureExclude(on).catch(() => {});
  if (on) toast('Enquanto você se vê, a janela do app fica fora da sua transmissão (senão ela vira um espelho infinito).');
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
