'use strict';
// Música junto (YouTube): uma música por canal (Voz geral ou subsala). Quem está no canal põe o link; ela aparece no
// painel de voz, embaixo do canal, com "Ouvir". Ouvir abre uma tela no palco, junto com as transmissões (destaque,
// tela cheia, arrastar). Cada pessoa toca no próprio player oficial do YouTube, visível (é a regra do YouTube); a
// sala só sincroniza os comandos: qual vídeo, tocando ou pausada, e em que ponto (sala-protocolo.js). Pausar, pular e
// trocar valem para todos; quem está no canal (ou quem pôs) controla. O volume é só seu.
// O player fala com a página pelo protocolo de mensagens dele (postMessage), sem carregar scripts do YouTube aqui.
// O main.js identifica o app para o YouTube (Referer); sem isso, o player recusa tocar numa página local.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, voz, membros,
// assistir, palco, subsalas.

const YT_ORIGIN = 'https://www.youtube-nocookie.com';
const MUSIC_DRIFT = 1.5; // segundos de diferença para o ponto da sala antes de corrigir
const musica = {
  offset: 0,     // relógio do servidor da sala menos o deste PC (para saber em que ponto a música está agora)
  volume: Math.max(0, Math.min(100, Number(load('musicaVolume', '60')))),
  legenda: load('musicaLegenda', '0') === '1', // legendas do YouTube: desligadas até você ligar (vale para todas as músicas)
  wantOpen: null, // canal em que você acabou de pôr uma música: abre a tela quando a sala confirmar
};
const musicKey = (ch) => `musica:${ch}`;
const myVoiceChannel = () => (voice.session ? voice.channel : '');
const canControlMusic = (e) => !!e && (e.by === state.myId || myVoiceChannel() === e.ch);
// Ponto da música agora, em segundos
function musicPos(e) { return e.pos + (e.playing ? (Date.now() + musica.offset - e.at) / 1000 : 0); }
function musicTitle(e) { return e?.title || 'Música do YouTube'; }
const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };

// Link do YouTube (watch, youtu.be, shorts, music.youtube.com, embed) ou o id de 11 caracteres
function parseYouTube(text) {
  const s = String(text || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return ''; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/) || [])[1] || '';
  return /^[\w-]{11}$/.test(id) ? id : '';
}

// ---------- Estado vindo da sala ----------
// quiet: ao entrar na sala, as músicas que já tocavam não viram aviso de "pôs uma música"
function setMusicas(list, serverNow, quiet = false) {
  if (typeof serverNow === 'number') musica.offset = serverNow - Date.now();
  const next = new Map();
  for (const e of Array.isArray(list) ? list : []) if (e && /^[\w-]{11}$/.test(String(e.videoId))) next.set(String(e.ch || ''), { ...e, ch: String(e.ch || '') });
  const before = state.musicas;
  state.musicas = next;
  for (const [ch, e] of next) {
    const old = before.get(ch);
    // Alguém pôs (ou trocou) a música do seu canal: avisa, para você poder ouvir junto
    if (!quiet && e.by !== state.myId && ch === myVoiceChannel() && (!old || old.videoId !== e.videoId) && !state.in.has(musicKey(ch))) {
      toast(`${nameOf(e.by)} ${old ? 'trocou' : 'pôs'} uma música em ${channelName(ch)}. Clique em Ouvir no painel de voz para ouvir junto.`);
    }
    state.in.get(musicKey(ch))?.music.sync(e);
    if (musica.wantOpen === ch && e.by === state.myId) { musica.wantOpen = null; listenMusic(ch); }
  }
  for (const ch of before.keys()) if (!next.has(ch) && state.in.has(musicKey(ch))) stopWatching(musicKey(ch), false);
  renderVoice();
  renderNavMusic(); // tocando ou pausada: o botão e o menu da barrinha acompanham
}
// Para a troca de host: o servidor novo continua com as músicas, do ponto em que estão agora
function musicSeed() {
  return [...state.musicas.values()].filter((e) => !e.ch || state.subsalas?.some((s) => s.id === e.ch))
    .map((e) => ({ ch: e.ch, videoId: e.videoId, title: e.title, by: e.by, playing: e.playing, pos: musicPos(e) }));
}
function clearMusicas() {
  for (const ch of state.musicas.keys()) if (state.in.has(musicKey(ch))) stopWatching(musicKey(ch), false);
  state.musicas = new Map();
  musica.wantOpen = null;
  closeMusicPop();
}
// Ao entrar (ou o servidor da sala trocar), conta de novo que você está ouvindo
function resendListening() { const l = listenedMusic(); if (l) send({ type: 'musica-ouvindo', ch: l.ch, on: true }); }
function musicCtl(e, action, extra = {}) { send({ type: 'musica-ctl', ch: e.ch, action, ...extra }); }

// ---------- A tela de música no palco ----------
function listenMusic(ch) {
  const key = musicKey(ch), e = state.musicas.get(ch);
  if (!e || state.in.has(key)) return;
  const tile = createMusicTile(ch, e);
  // Entra no palco como "você se vendo" (assistir.js): sem conexão, sem sinal para ninguém
  state.in.set(key, { self: true, music: tile.music, pc: SELF_PC, tile, videoOn: true, tracks: [], once: null, lastBytes: 0, lastTs: 0 });
  send({ type: 'musica-ouvindo', ch, on: true }); // ouvindo conta como gente: a música não é tirada por falta de ouvinte
  renderNavMusic();
  renderFocus();
  renderMembers();
  updateStage();
}
function toggleListenMusic(ch) {
  if (state.in.has(musicKey(ch))) stopWatching(musicKey(ch), false);
  else listenMusic(ch);
}

function createMusicTile(ch, entry) {
  const key = musicKey(ch);
  const el = document.createElement('div');
  el.className = 'tile music-tile';
  // Faixa de cima: nota, título, o canal; à direita os controles só seus (som, destaque, tela cheia, parar de ouvir)
  const label = document.createElement('div');
  label.className = 'tile-name';
  const note = document.createElement('span');
  note.className = 'music-note';
  note.innerHTML = ICON.music;
  const labelText = document.createElement('span');
  labelText.className = 'tile-name-text';
  const where = document.createElement('span');
  where.className = 'tile-chip music-where';
  const bar = document.createElement('div');
  bar.className = 'tile-bar';
  const barSpace = document.createElement('span');
  barSpace.className = 'tile-bar-space';
  const mute = document.createElement('button');
  mute.className = 'btn icon tile-mute';
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.className = 'tile-vol';
  vol.min = '0'; vol.max = '100'; vol.step = '1'; vol.value = String(musica.volume);
  vol.setAttribute('aria-label', 'Volume da música (só para você)');
  const focusBtn = document.createElement('button');
  focusBtn.className = 'btn icon';
  focusBtn.hidden = true;
  focusBtn.onclick = () => setFocus(state.focus === key ? null : key);
  const fs = document.createElement('button');
  fs.className = 'btn icon';
  setFsIcon(fs, false);
  fs.onclick = () => toggleFullscreen(el);
  const close = document.createElement('button');
  close.className = 'btn icon';
  setIcon(close, 'close', 'Parar de ouvir (a música continua para os outros)');
  close.onclick = () => stopWatching(key, false);
  const pipBtn = document.createElement('button'); // o palco espera um; a música não vai para a janela flutuante
  pipBtn.hidden = true;
  // Legendas (só para você): desligadas por padrão
  const cc = document.createElement('button');
  cc.className = 'btn icon';
  cc.onclick = () => {
    musica.legenda = !musica.legenda;
    save('musicaLegenda', musica.legenda ? '1' : '0');
    for (const link of state.in.values()) link.music?.captions();
  };
  bar.append(barSpace, mute, vol, cc, focusBtn, fs, close);
  label.append(note, labelText, where, bar);
  // O player (visível, como pede o YouTube) e, embaixo dele, os controles que valem para todos
  const body = document.createElement('div');
  body.className = 'tile-body music-body';
  const iframe = document.createElement('iframe');
  iframe.className = 'music-frame';
  iframe.allow = 'autoplay; encrypted-media';
  iframe.title = 'Player do YouTube';
  // Isolado: o player roda os scripts dele, mas não navega a janela do app nem abre janelas
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay music-overlay';
  overlay.textContent = 'Carregando o YouTube…';
  const controls = document.createElement('div');
  controls.className = 'music-controls';
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'btn icon';
  const time = document.createElement('span');
  time.className = 'music-time';
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.className = 'music-seek';
  seek.min = '0'; seek.max = '0'; seek.step = '1'; seek.value = '0';
  seek.setAttribute('aria-label', 'Ponto da música (para todos)');
  // Live do YouTube: no lugar do progresso, só o selo (não há fim nem ponto para combinar)
  const liveChip = document.createElement('span');
  liveChip.className = 'tile-chip live music-live';
  liveChip.textContent = 'Ao vivo';
  liveChip.hidden = true;
  const swap = document.createElement('button');
  swap.type = 'button';
  swap.className = 'btn small';
  swap.textContent = 'Trocar';
  const stopAll = document.createElement('button');
  stopAll.type = 'button';
  stopAll.className = 'btn small danger';
  stopAll.textContent = 'Parar a música';
  controls.append(playBtn, time, seek, liveChip, swap, stopAll);
  const pipNote = document.createElement('div'); // idem: o palco mexe nele, aqui fica sempre escondido
  pipNote.hidden = true;
  // Luz ambiente (Aparência), como nas transmissões: o player fica do tamanho do vídeo (16:9) e as barras em volta
  // pegam as cores dele (ambientTick)
  const ambient = document.createElement('canvas');
  ambient.className = 'tile-ambient';
  ambient.width = 32; ambient.height = 18;
  ambient.hidden = true;
  body.append(ambient, iframe, overlay, pipNote);
  el.append(label, body, controls);
  $('tiles').append(el);
  setupTileDrag(key, el);
  setupTileIdle(el);

  // O "vídeo" do quadro, para o palco: mudo quando outra tela está em destaque (setTilePaused) e no alto-falante
  const video = { srcObject: null, volume: 1, mutedFlag: false, get muted() { return this.mutedFlag; }, set muted(v) { this.mutedFlag = !!v; applyVolume(); } };
  const syncMute = () => {
    const silent = video.muted || musica.volume === 0;
    setIcon(mute, silent ? 'muted' : 'volume', silent ? 'Ativar o som da música' : 'Silenciar a música (só para você)');
  };
  mute.onclick = () => { video.muted = !video.muted; syncMute(); };
  vol.oninput = () => {
    musica.volume = Number(vol.value);
    if (musica.volume > 0 && video.muted && !tile.paused) video.muted = false;
    applyVolume();
    syncMute();
  };
  vol.onchange = () => save('musicaVolume', String(musica.volume));
  // Mexeu no volume da tela: o da barrinha da direita (menu da música) acompanha
  vol.addEventListener('input', () => { const nav = $('navMusicVol'); if (nav && nav !== document.activeElement) { nav.value = vol.value; nav.nextElementSibling.textContent = `${vol.value}%`; } });

  // ---------- Conversa com o player ----------
  const mu = { ch, entry, videoId: '', ready: false, state: -1, time: 0, timeAt: 0, duration: 0, title: '', error: 0, endTimer: null, listen: null, seeking: false, live: false };
  const post = (func, args = []) => iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), YT_ORIGIN);
  function applyVolume() {
    if (!mu.ready) return;
    // Silenciar é volume 0, nunca o mudo do player: com o app escondido (jogando), o YouTube pausa vídeo mudo
    const muted = video.muted || musica.volume === 0;
    post('unMute');
    post('setVolume', [muted ? 0 : Math.round(musica.volume * duck.factor)]);
  }
  // Legendas: o YouTube liga sozinho (até traduzida para o português). Desligar é escolher nenhuma faixa (descarregar
  // o módulo não segura: ele carrega de novo). Ligar de novo: o player guardou "nenhuma" e a API não diz quais faixas
  // há, então ele recarrega no ponto da sala, já com legenda, e escolhe a faixa que escolheria (1 a 2 s de pausa)
  function applyCaptions() {
    if (!mu.ready || musica.legenda) return;
    for (const mod of ['captions', 'cc']) post('setOption', [mod, 'track', {}]);
  }
  function syncCaptions() {
    setIcon(cc, 'captions', musica.legenda ? 'Desligar as legendas' : 'Ligar as legendas (só para você)');
    cc.classList.toggle('on', musica.legenda);
    cc.setAttribute('aria-pressed', String(musica.legenda));
  }
  function loadVideo(videoId, at) {
    if (videoId !== mu.videoId) mu.live = false; // recarregar o mesmo (legendas) continua sendo live
    mu.videoId = videoId;
    mu.ready = false;
    mu.state = -1;
    mu.title = '';
    mu.error = 0;
    mu.duration = 0;
    overlay.hidden = false;
    overlay.textContent = 'Carregando o YouTube…';
    // controls=0: os controles são os nossos (valem para todos); fs=0: a tela cheia é a do quadro
    iframe.src = `${YT_ORIGIN}/embed/${videoId}?enablejsapi=1&autoplay=1&controls=0&disablekb=1&fs=0&rel=0&iv_load_policy=3&playsinline=1&cc_load_policy=${musica.legenda ? 1 : 0}&start=${Math.floor(at)}`;
    // Até o player responder, pede para ele mandar os eventos (o "listening" do protocolo dele)
    clearInterval(mu.listen);
    let tries = 0;
    mu.listen = setInterval(() => {
      if (mu.ready || ++tries > 40 || !el.isConnected) return clearInterval(mu.listen);
      iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: key, channel: 'widget' }), YT_ORIGIN);
    }, 250);
  }
  const playerTime = () => mu.time + (mu.state === 1 ? (performance.now() - mu.timeAt) / 1000 : 0);
  // Leva o player para onde a sala está: tocando ou pausada, no ponto certo
  function correct() {
    const e = mu.entry;
    if (!mu.ready || mu.error || !e) return;
    // Live: a "duração" é só o que já foi transmitido e cresce aos pedaços (uns 10 s). Combinar o ponto pelo relógio
    // passa do fim e o player para esperando; aqui cada um fica na ponta da transmissão e a sala só diz tocar ou pausar
    if (mu.live) {
      if (e.playing && mu.state !== 1 && mu.state !== 3) post('playVideo');
      else if (!e.playing && (mu.state === 1 || mu.state === 3)) post('pauseVideo');
      return;
    }
    const want = musicPos(e);
    if (mu.duration && want >= mu.duration) { if (mu.state !== 0) post('seekTo', [mu.duration, true]); return; }
    const off = Math.abs(playerTime() - want) > MUSIC_DRIFT;
    if (e.playing) {
      if (off) post('seekTo', [want, true]);
      if (mu.state !== 1 && mu.state !== 3) post('playVideo');
    } else {
      if (mu.state === 1 || mu.state === 3) post('pauseVideo');
      if (off) post('seekTo', [want, true]);
    }
  }
  function onMessage(d) {
    if (d.event === 'onReady') {
      if (mu.ready) return;
      mu.ready = true;
      overlay.hidden = true;
      post('addEventListener', ['onApiChange']); // o aviso de módulo carregado (legendas) só vem para quem pede
      applyVolume();
      applyCaptions();
      correct();
    } else if (d.event === 'onError') {
      mu.error = Number(d.info) || 1;
      overlay.hidden = false;
      overlay.textContent = [101, 150, 153].includes(mu.error)
        ? 'Este vídeo não pode tocar aqui: quem publicou não deixa tocar fora do YouTube. Troque por outro.'
        : 'O YouTube não conseguiu tocar este vídeo. Troque por outro.';
      // Quem pôs fica sabendo na hora (os outros veem o aviso no quadro)
      if (mu.entry?.by === state.myId) toast('Este vídeo não pode tocar fora do YouTube. Troque por outro.', 'error');
    } else if (d.event === 'onApiChange') {
      applyCaptions(); // o player carregou um módulo (as legendas vêm por aqui): vale a sua escolha
    } else if (d.event === 'onStateChange') {
      if (Number(d.info) === 1) applyCaptions(); // começou a tocar: as legendas podem ter ligado sozinhas
      mu.state = Number(d.info);
    } else if (d.event === 'infoDelivery' && d.info) {
      const i = d.info;
      if (typeof i.currentTime === 'number') { mu.time = i.currentTime; mu.timeAt = performance.now(); }
      if (typeof i.playerState === 'number') mu.state = i.playerState;
      if (typeof i.duration === 'number' && i.duration > 0) {
        // A duração cresceu com o vídeo já carregado: é live (vídeo normal tem duração fixa)
        if (!mu.live && (i.videoData?.isLive === true || (mu.duration > 0 && i.duration > mu.duration + 2))) {
          mu.live = true;
          render();
          correct();
        }
        mu.duration = i.duration;
      } else if (!mu.live && i.videoData?.isLive === true) { mu.live = true; render(); }
      if (typeof i.volume === 'number') mu.volume = i.volume; // o que o player diz (para conferir o volume local)
      if (typeof i.muted === 'boolean') mu.muted = i.muted;
      const title = i.videoData?.title;
      if (title && title !== mu.title) {
        mu.title = title;
        if (!mu.entry.title) musicCtl(mu.entry, 'titulo', { title });
        render();
      }
    }
    // Acabou: quem pôs para a música (ou, se essa pessoa saiu, quem controla, um pouco depois)
    if (mu.state === 0 && !mu.live && !mu.endTimer && canControlMusic(mu.entry)) {
      const video0 = mu.videoId;
      mu.endTimer = setTimeout(() => {
        mu.endTimer = null;
        if (mu.state === 0 && mu.videoId === video0 && state.musicas.get(ch)?.videoId === video0) musicCtl(mu.entry, 'stop');
      }, mu.entry.by === state.myId || !state.members.has(mu.entry.by) ? 1500 : 6000);
    }
  }
  // A sala mudou algo (tocar, pausar, pular, trocar)
  mu.sync = (e) => {
    mu.entry = e;
    if (e.videoId !== mu.videoId) loadVideo(e.videoId, musicPos(e));
    else correct();
    render();
  };
  mu.onMessage = onMessage;
  mu.captions = () => {
    syncCaptions();
    if (musica.legenda && mu.videoId) loadVideo(mu.videoId, musicPos(mu.entry));
    else applyCaptions();
  };
  mu.render = () => render();
  mu.iframe = iframe;

  // ---------- Controles que valem para todos ----------
  playBtn.onclick = () => {
    const e = mu.entry;
    if (!canControlMusic(e)) return;
    musicCtl(e, e.playing ? 'pause' : 'play', { pos: e.playing ? (mu.ready ? playerTime() : musicPos(e)) : musicPos(e) });
  };
  seek.oninput = () => { mu.seeking = true; time.textContent = `${clock(Number(seek.value))} / ${clock(mu.duration)}`; };
  seek.onchange = () => { mu.seeking = false; if (canControlMusic(mu.entry)) musicCtl(mu.entry, 'seek', { pos: Number(seek.value) }); };
  swap.onclick = () => openMusicPop(ch, swap, 'trocar');
  stopAll.onclick = async () => {
    if (!(await appConfirm(`Parar a música de ${channelName(ch)} para todo mundo?`, { title: 'Parar a música', ok: 'Parar', danger: true }))) return;
    musicCtl(mu.entry, 'stop');
  };

  function render() {
    const e = mu.entry;
    const name = mu.title || musicTitle(e);
    labelText.textContent = name;
    tile.name = name;
    where.textContent = channelName(ch);
    where.title = `Música de ${channelName(ch)}, posta por ${e.by === state.myId ? 'você' : nameOf(e.by)}`;
    const can = canControlMusic(e);
    const why = can ? '' : ` (só quem está em ${channelName(ch)} controla)`;
    setIcon(playBtn, e.playing ? 'pause' : 'play', (e.playing ? 'Pausar para todos' : 'Tocar para todos') + why);
    for (const b of [playBtn, seek, swap, stopAll]) b.disabled = !can;
    time.hidden = seek.hidden = mu.live;
    liveChip.hidden = !mu.live;
    swap.title = can ? 'Trocar por outra música (para todos)' : why.trim();
    stopAll.title = can ? 'Parar a música para todo mundo' : why.trim();
    syncMute();
  }
  // Luz ambiente: o player é de outro site e a página não lê os pixels dele; quem tira a foto (32 x 18) da área dele
  // é o processo principal. Só com a opção ligada, barra sobrando, a tela grande, o vídeo carregado e o app em foco
  // (no jogo, para). Pega o meio do vídeo, longe das faixas de cima e de baixo, que ficam por cima dele
  const ambientCtx = ambient.getContext('2d', { alpha: false });
  let ambientBusy = false;
  async function ambientTick() {
    const bw = body.clientWidth, bh = body.clientHeight;
    const bars = bw && bh && Math.abs((16 / 9) / (bw / bh) - 1) > 0.02;
    if (!appPreferences.appearance.ambient || !bars || el.classList.contains('small')) { ambient.hidden = true; return; }
    if (ambientBusy || !mu.ready || mu.error || document.hidden || !document.hasFocus() || !window.api?.captureRegion) return;
    ambientBusy = true;
    try {
      const r = iframe.getBoundingClientRect();
      const url = await window.api.captureRegion(r.left, r.top + r.height * 0.15, r.width, r.height * 0.7);
      if (!url || !el.isConnected) return;
      const img = new Image();
      img.src = url;
      await img.decode();
      ambientCtx.drawImage(img, 0, 0, ambient.width, ambient.height);
      ambient.hidden = false;
    } catch {} finally { ambientBusy = false; }
  }
  // O relógio do quadro e a correção de tempos em tempos (o player pode atrasar ou adiantar um pouco)
  let ticks = 0;
  const timer = setInterval(() => {
    if (!el.isConnected) { clearInterval(timer); clearInterval(mu.listen); clearTimeout(mu.endTimer); return; }
    const now = mu.ready ? playerTime() : musicPos(mu.entry);
    if (!mu.seeking && !mu.live) {
      seek.max = String(Math.floor(mu.duration || 0));
      seek.value = String(Math.floor(Math.min(now, mu.duration || now)));
      time.textContent = mu.duration ? `${clock(now)} / ${clock(mu.duration)}` : clock(now);
    }
    // A cada 2 s: o ponto da sala e, com as legendas desligadas, de novo nenhuma faixa (o YouTube liga sozinho quando
    // carrega o módulo, e nem sempre avisa)
    if (++ticks % 4 === 0) { correct(); if (!musica.legenda) applyCaptions(); }
    ambientTick();
  }, 500);

  const tile = { el, video, vol, overlay, pipNote, fs, focusBtn, pipBtn, syncMute, name: musicTitle(entry), paused: false, mutedBefore: false, userMuted: false, music: mu, applyVolume };
  render();
  syncCaptions();
  loadVideo(entry.videoId, musicPos(entry));
  return tile;
}
// A voz mudou (você entrou, saiu ou trocou de canal): quem controla cada música pode ter mudado
function renderMusicTiles() { for (const link of state.in.values()) link.music?.render(); }
// As mensagens dos players chegam todas aqui: cada uma vai para o quadro do iframe que mandou
window.addEventListener('message', (e) => {
  if (e.origin !== YT_ORIGIN) return;
  let d;
  try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  for (const link of state.in.values()) if (link.music && link.music.iframe.contentWindow === e.source) return link.music.onMessage(d || {});
});

// ---------- No painel de voz: a música de cada canal, e "Pôr música" no seu ----------
function musicRow(ch) {
  const e = state.musicas.get(ch);
  if (!e) return null;
  const li = document.createElement('li');
  li.className = 'voice-music';
  const icon = document.createElement('span');
  icon.className = 'voice-music-icon';
  icon.innerHTML = ICON.music;
  const info = document.createElement('div');
  info.className = 'voice-music-info';
  const title = document.createElement('strong');
  const open = state.in.get(musicKey(ch));
  title.textContent = open?.tile.name || musicTitle(e);
  const by = document.createElement('span');
  by.textContent = `${e.playing ? 'Tocando' : 'Pausada'} · posta por ${e.by === state.myId ? 'você' : nameOf(e.by)}`;
  info.append(title, by);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small';
  btn.textContent = open ? 'Parar de ouvir' : 'Ouvir';
  btn.title = open ? 'Fecha a tela da música (ela continua para os outros)' : 'Abre a tela da música e ouve junto, no mesmo ponto';
  btn.onclick = () => toggleListenMusic(ch);
  li.append(icon, info, btn);
  return li;
}
// O botão de pôr música vai no cabeçalho do seu canal (fora da voz, a Voz geral), se ainda não tem uma lá
function musicHeadButton(ch) {
  if (!state.musicaOn || state.musicas.has(ch) || ch !== myVoiceChannel()) return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small icon voice-channel-music';
  setIcon(b, 'music', `Pôr uma música do YouTube em ${channelName(ch)} (todos ouvem junto)`);
  b.onclick = (ev) => { ev.stopPropagation(); musicPopFor?.ch === ch ? closeMusicPop() : openMusicPop(ch, b, 'por'); };
  return b;
}

// ---------- Na barrinha da direita: a música que você está ouvindo ----------
// Aparece enquanto você ouve uma música (a tela dela está no palco). Clicar abre um menu com Pausar ou Continuar (para
// todos, como no player; só quem pode controlar) e Sair (para de ouvir; a música continua para os outros).
function listenedMusic() {
  for (const [key, link] of state.in) if (link.music) { const ch = key.slice('musica:'.length); return { key, ch, e: state.musicas.get(ch), link }; }
  return null;
}
function renderNavMusic() {
  const m = listenedMusic(), btn = $('navMusic');
  $('navMusicWrap').hidden = !m?.e;
  if (!m?.e) { closeNavMusic(); return; }
  setIcon(btn, 'music', `${m.link.tile.name || musicTitle(m.e)} · ${m.e.playing ? 'tocando' : 'pausada'}`);
  btn.dataset.playing = String(!!m.e.playing);
  // Menu aberto: redesenha com o estado novo, menos enquanto o volume está sendo arrastado
  if (!$('navMusicMenu').hidden && document.activeElement?.id !== 'navMusicVol') buildNavMusic();
}
function buildNavMusic() {
  const m = listenedMusic(), menu = $('navMusicMenu');
  if (!m?.e) return;
  const can = canControlMusic(m.e);
  const head = document.createElement('div');
  head.className = 'rail-music-head';
  const title = document.createElement('strong');
  title.textContent = m.link.tile.name || musicTitle(m.e);
  const where = document.createElement('span');
  where.textContent = `${m.e.playing ? 'Tocando' : 'Pausada'} em ${channelName(m.ch)}`;
  head.append(title, where);
  const item = (icon, text, tip, onclick, disabled = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dock-more-item';
    b.setAttribute('role', 'menuitem');
    b.innerHTML = ICON[icon];
    const label = document.createElement('span');
    label.textContent = text;
    b.append(label);
    b.title = tip;
    b.disabled = disabled;
    b.onclick = onclick;
    return b;
  };
  const why = can ? '' : `Só quem está em ${channelName(m.ch)} controla`;
  // Volume só seu: o mesmo controle da tela da música (mexe nele, e ele faz o resto: player, mudo, salvar)
  const volRow = document.createElement('label');
  volRow.className = 'rail-music-vol';
  volRow.title = 'Volume da música (só para você)';
  const vol = document.createElement('input');
  vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.step = '1'; vol.id = 'navMusicVol';
  vol.value = m.link.tile.vol.value;
  vol.setAttribute('aria-label', 'Volume da música (só para você)');
  const out = document.createElement('output');
  out.textContent = `${vol.value}%`;
  vol.oninput = () => { m.link.tile.vol.value = vol.value; m.link.tile.vol.dispatchEvent(new Event('input')); out.textContent = `${vol.value}%`; };
  vol.onchange = () => m.link.tile.vol.dispatchEvent(new Event('change'));
  volRow.insertAdjacentHTML('afterbegin', ICON.volume);
  volRow.append(vol, out);
  menu.replaceChildren(head, volRow,
    item(m.e.playing ? 'pause' : 'play', m.e.playing ? 'Pausar' : 'Continuar', why || (m.e.playing ? 'Pausar para todos' : 'Continuar para todos'),
      () => { const e = state.musicas.get(m.ch); if (e && canControlMusic(e)) musicCtl(e, e.playing ? 'pause' : 'play', { pos: musicPos(e) }); }, !can),
    item('leave', 'Sair da música', 'Para de ouvir (a música continua para os outros)', () => { closeNavMusic(); stopWatching(m.key, false); }));
}
function openNavMusic() {
  buildNavMusic();
  $('navMusicMenu').hidden = false;
  $('navMusic').setAttribute('aria-expanded', 'true');
  $('navMusicMenu').querySelector('button:not(:disabled)')?.focus();
}
function closeNavMusic(focusButton = false) {
  if ($('navMusicMenu').hidden) return;
  $('navMusicMenu').hidden = true;
  $('navMusic').setAttribute('aria-expanded', 'false');
  if (focusButton) $('navMusic').focus();
}

// ---------- Balão de colar o link ----------
let musicPopFor = null; // { ch, mode: 'por' | 'trocar' }
function openMusicPop(ch, anchor, mode) {
  const pop = $('musicPop');
  musicPopFor = { ch, mode };
  $('musicPopTitle').textContent = mode === 'trocar' ? `Trocar a música de ${channelName(ch)}` : `Música em ${channelName(ch)}`;
  $('musicPopGo').textContent = mode === 'trocar' ? 'Trocar' : 'Tocar';
  $('musicUrl').value = '';
  $('musicPopError').textContent = '';
  pop.hidden = false;
  // "fixed" aqui conta a partir do body (que desce pela barra de título): mede o 0 de verdade e desconta
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const top = r.bottom + 8 + h < innerHeight - 8 ? r.bottom + 8 : Math.max(8, r.top - 8 - h);
  pop.style.left = '0px'; pop.style.top = '0px';
  const o = pop.getBoundingClientRect();
  pop.style.left = `${left - o.left}px`;
  pop.style.top = `${top - o.top}px`;
  $('musicUrl').focus();
}
function closeMusicPop() {
  if (!$('musicPop')) return;
  $('musicPop').hidden = true;
  musicPopFor = null;
}
function submitMusicPop() {
  if (!musicPopFor) return;
  const videoId = parseYouTube($('musicUrl').value);
  if (!videoId) { $('musicPopError').textContent = 'Não reconheci esse link. Cole o endereço de um vídeo do YouTube.'; return; }
  const { ch, mode } = musicPopFor;
  if (mode === 'trocar') {
    const e = state.musicas.get(ch);
    if (e) musicCtl(e, 'trocar', { videoId });
  } else {
    musica.wantOpen = ch;
    send({ type: 'musica-set', videoId });
  }
  closeMusicPop();
}

function setupMusica() {
  $('navMusic').onclick = () => ($('navMusicMenu').hidden ? openNavMusic() : closeNavMusic(true));
  $('navMusicMenu').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNavMusic(true); } });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('#navMusicWrap')) closeNavMusic(); });
  $('musicPopForm').onsubmit = (e) => { e.preventDefault(); submitMusicPop(); };
  $('musicPopCancel').onclick = closeMusicPop;
  document.addEventListener('pointerdown', (e) => {
    if (!$('musicPop').hidden && !e.target.closest?.('#musicPop, .voice-channel-music, .sky-card-nomusic, .music-controls')) closeMusicPop();
  });
}
setupMusica();
