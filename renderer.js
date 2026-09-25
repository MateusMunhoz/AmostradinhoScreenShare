'use strict';

const $ = (id) => document.getElementById(id);

const QUALITY = {
  '720p30':  { w: 1280, h: 720,  fps: 30, bitrate: 2_500_000 },
  '720p60':  { w: 1280, h: 720,  fps: 60, bitrate: 4_000_000 },
  '1080p30': { w: 1920, h: 1080, fps: 30, bitrate: 4_500_000 },
  '1080p60': { w: 1920, h: 1080, fps: 60, bitrate: 7_000_000 },
};

// Sem STUN/TURN: pela Radmin VPN os PCs se enxergam direto pelos IPs 26.x
const RTC_CONFIG = { iceServers: [] };

const state = {
  ws: null,
  myId: null,
  isOwner: false,
  host: '',
  port: 8765,
  members: new Map(),      // id -> { name, sharing }  (outras pessoas na sala)

  // Minha transmissão
  stream: null,
  sharing: false,
  quality: '1080p30',
  selectedSource: null,
  appAudio: null,
  out: new Map(),          // id de quem me assiste -> { pc, chain }

  // O que eu estou assistindo
  in: new Map(),           // id de quem transmite -> { pc, chain, tile, lastBytes, lastTs }
  statsTimer: null,
  outStatsTimer: null,
};

// Atualizações pela sala: quem tem uma versão mais nova manda o pacote assinado para quem pedir
const update = {
  myVersion: '',
  ready: '',            // versão já baixada, que vale depois de reiniciar
  busy: null,           // download em andamento: { from, version, parts, total, sig, timer }
  tried: new Set(),     // "id@versão" já tentados nesta sala
  sending: new Set(),   // ids para quem estou mandando agora
};

// ---------- Utilidades ----------
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
}

let toastTimer;
function toast(text, kind = 'info') {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 5000);
}

function save(key, val) { try { localStorage.setItem(key, val); } catch {} }
function load(key, def = '') { try { return localStorage.getItem(key) ?? def; } catch { return def; } }
function getName() { return $('name').value.trim() || 'Anônimo'; }
function nameOf(id) { return state.members.get(id)?.name || 'Alguém'; }
function setBusy(btn, busy, label) { btn.disabled = busy; btn.textContent = label; }

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}
function sendSignal(to, data) { send({ type: 'signal', to, data }); }

function toggleFullscreen(el) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else el.requestFullscreen().catch(() => {});
}

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  expand: svg('M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7'),   // setinhas para os cantos
  shrink: svg('M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7'),  // setinhas para o centro
  volume: svg('M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14'),
  muted: svg('M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6'),
  close: svg('M18 6 6 18M6 6l12 12'),
};

// Botão só com ícone: a dica (title) e o nome lido pelo leitor de tela são o mesmo texto
function setIcon(btn, icon, label) {
  btn.innerHTML = ICON[icon];
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

function setFsIcon(btn, full) {
  setIcon(btn, full ? 'shrink' : 'expand', full ? 'Sair da tela cheia' : 'Tela cheia');
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
function connectRoom(url, hello) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let joined = false;
    let errMsg = null;
    const timer = setTimeout(() => {
      if (!joined) { errMsg = 'Tempo esgotado. Confira o endereço e se a Radmin VPN está ligada.'; ws.close(); }
    }, 8000);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', ...hello, version: update.myVersion }));
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
        leaveRoom(e.reason === 'room-closed' ? 'Quem criou a sala encerrou a sala.' : 'A conexão com a sala caiu.', 'error');
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
  for (const m of welcome.members) state.members.set(m.id, { name: m.name, sharing: m.sharing, version: m.version });
  $('leaveBtn').textContent = owner ? 'Encerrar sala' : 'Sair da sala';
  renderRoomAddress();
  renderMembers();
  renderShareBox();
  updateStage();
  show('room');
  const live = welcome.members.filter((m) => m.sharing).length;
  if (live) toast(live === 1 ? '1 pessoa está transmitindo. Clique em Assistir para ver.' : `${live} pessoas estão transmitindo. Escolha quem assistir.`);
  checkUpdates();
}

function leaveRoom(reason, kind = 'info') {
  if (!state.myId) return;
  const ws = state.ws;
  state.ws = null;
  if (ws) { ws.onclose = null; ws.close(); }
  stopSharing();
  for (const id of [...state.in.keys()]) stopWatching(id, false);
  stopStats();
  if (state.isOwner) window.api.stopServer();
  state.members.clear();
  state.myId = null;
  state.isOwner = false;
  closeShareDialog();
  $('closeDialog').hidden = true;
  if (update.busy) { clearTimeout(update.busy.timer); update.busy = null; }
  update.tried.clear();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  show('home');
  if (reason) toast(reason, kind);
}

function onRoomMessage(m) {
  switch (m.type) {
    case 'member-joined':
      state.members.set(m.id, { name: m.name, sharing: false, version: m.version });
      renderMembers();
      toast(`${m.name} entrou na sala`);
      checkUpdates();
      break;
    case 'member-left': {
      const name = nameOf(m.id);
      if (update.busy?.from === m.id) cancelDownload();
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
      mem.sharing = m.sharing;
      if (m.sharing) toast(`${mem.name} começou a transmitir`);
      else stopWatching(m.id, false);
      renderMembers();
      updateStage();
      break;
    }
    case 'signal':
      handleSignal(m.from, m.data || {});
      break;
  }
}

// Cada par de PCs pode ter duas conexões (eu assisto você e você me assiste).
// O campo "side" diz de qual lado da conexão veio a mensagem.
function handleSignal(from, data) {
  if (data.side === 'viewer') {
    // Mensagem de alguém que assiste (ou quer assistir) a minha tela
    if (data.subscribe) return addWatcher(from, data.once === true);
    if (data.unsubscribe) return closeOut(from);
    const link = state.out.get(from);
    if (!link) return;
    if (typeof data.video === 'boolean') {
      link.videoOff = !data.video;
      if (data.video) onceVideoResumed(link);
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
    // Sem pausa fixa entre as partes: com a janela minimizada o Chromium atrasa timers para 1 por segundo.
    // Só espera se a conexão com a sala estiver muito cheia.
    while (state.ws && state.ws.bufferedAmount > 1_000_000) await new Promise((r) => setTimeout(r, 50));
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
    renderUpdateNotice();
    if (update.github && !newerVersion(update.github.version, update.ready)) $('githubUpdate').hidden = true;
    toast(`Versão ${res.version} baixada de ${nameOf(from)}. Reinicie o app para usar.`);
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
    $('githubUpdate').hidden = true;
    if (manual) toast(update.ready ? `A versão ${update.ready} já está baixada. Reinicie para usar.` : 'Você já está na versão mais nova.');
    return;
  }
  update.github = rel;
  $('githubText').textContent = `Versão ${rel.version} disponível no GitHub.`;
  $('githubBtn').textContent = 'Baixar atualização';
  $('githubBtn').onclick = installFromGithub;
  $('githubUpdate').hidden = false;
}

async function installFromGithub() {
  const btn = $('githubBtn');
  setBusy(btn, true, 'Baixando…');
  const res = await window.api.githubInstall();
  setBusy(btn, false, 'Baixar atualização');
  if (res.ok) {
    update.ready = res.version;
    $('githubUpdate').hidden = true;
    renderUpdateNotice();
    return;
  }
  if (res.page && /exe novo|pacote de atualização/.test(res.error)) {
    // Mudou algo que só um .exe novo traz (ex.: versão do Electron): manda para a página da versão
    $('githubText').textContent = `A versão ${update.github?.version || ''} precisa do .exe novo. Baixe na página do GitHub.`;
    btn.textContent = 'Abrir no GitHub';
    btn.onclick = () => window.api.openGithub(res.page);
    return;
  }
  toast(`Não deu para atualizar: ${res.error}`, 'error');
}

function renderUpdateNotice() {
  document.querySelectorAll('.update-notice').forEach((box) => {
    box.hidden = !update.ready;
    box.querySelector('.update-text').textContent = `Versão ${update.ready} pronta. Ela começa a valer quando o app reiniciar.`;
  });
}

// ---------- Estatísticas ----------
// Processador e placa de vídeo do app (e do PC inteiro, que inclui o jogo), atualizados a cada segundo
let codecTimer = null;
const pct = (v) => `${(v || 0).toFixed(1).replace('.', ',')}%`;

function openStats() {
  $('statsDialog').hidden = false;
  $('stNote').textContent = 'Medindo…';
  window.api.offStats();
  window.api.onStats(renderStats);
  window.api.statsStart();
  renderCodecInfo();
  codecTimer = setInterval(renderCodecInfo, 1000);
  $('closeStats').focus();
}

function closeStats() {
  if ($('statsDialog').hidden) return;
  $('statsDialog').hidden = true;
  window.api.statsStop();
  window.api.offStats();
  clearInterval(codecTimer);
}

function renderStats(s) {
  const sum = (get) => s.procs.reduce((t, p) => t + get(p), 0);
  const gpu = (eng) => (p) => p.gpu[eng] || 0;
  $('stCpu').textContent = pct(sum((p) => p.cpu));
  $('stCpuPC').textContent = `PC inteiro: ${pct(s.cpuPC)}`;
  const cards = [['stGpu', '3D'], ['stEnc', 'VideoEncode'], ['stDec', 'VideoDecode']];
  for (const [id, eng] of cards) {
    $(id).textContent = s.gpuAvailable ? pct(Math.min(sum(gpu(eng)), 100)) : '–';
    $(`${id}PC`).textContent = s.gpuAvailable ? `PC inteiro: ${pct(Math.min(s.gpuPC[eng] || 0, 100))}` : 'o Windows não informou';
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
  $('stNote').textContent = `Processador em % do PC inteiro (${s.cores} núcleos). "PC inteiro" inclui o jogo e outros programas. Atualiza a cada segundo.`;
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
    parts.push(`Transmitindo: H.264 com WebCodecs (${where(once.hardware)}), ${once.width}×${once.height}, 1 codificação para ${onceOut} ${onceOut > 1 ? 'pessoas' : 'pessoa'}.`);
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
}

function memberRow(id, name, sharing) {
  const li = document.createElement('li');
  li.className = 'member' + (sharing ? ' live' : '');
  const dot = document.createElement('span');
  dot.className = 'dot';
  const info = document.createElement('div');
  info.className = 'info';
  const nameEl = document.createElement('span');
  nameEl.className = 'mname';
  nameEl.textContent = name;
  const status = document.createElement('span');
  status.className = 'mstatus';
  status.textContent = sharing ? 'Transmitindo' : 'Na sala';
  info.append(nameEl, status);
  li.append(dot, info);

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
  $('memberCount').textContent = state.members.size + 1;
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
  const label = document.createElement('span');
  label.className = 'tile-name';
  label.textContent = name;
  const bar = document.createElement('div');
  bar.className = 'tile-bar';
  const stats = document.createElement('span');
  stats.className = 'tile-stats';
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
    video.volume = parseFloat(vol.value);
    if (video.volume > 0) video.muted = false;
    syncMute();
  };
  mute.onclick = () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) { video.volume = 1; vol.value = '1'; }
    syncMute();
  };
  syncMute();
  const fs = document.createElement('button');
  fs.className = 'btn icon';
  setFsIcon(fs, false);
  fs.onclick = () => toggleFullscreen(el);
  const close = document.createElement('button');
  close.className = 'btn icon';
  setIcon(close, 'close', 'Parar de assistir');
  close.onclick = () => stopWatching(id);
  bar.append(stats, mute, vol, fs, close);
  el.append(video, overlay, label, bar);
  el.addEventListener('dblclick', (e) => { if (!bar.contains(e.target)) toggleFullscreen(el); });
  $('tiles').append(el);
  return { el, video, overlay, stats, fs };
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
  renderMembers();
  updateStage();
  ensureStats();
}

function stopWatching(id, notify = true) {
  const link = state.in.get(id);
  if (!link) return;
  if (notify) sendSignal(id, { side: 'viewer', unsubscribe: true });
  if (document.fullscreenElement === link.tile.el) document.exitFullscreen().catch(() => {});
  closeOnceReceiver(link);
  link.pc.close();
  link.tile.video.srcObject = null;
  link.tile.el.remove();
  state.in.delete(id);
  renderMembers();
  updateStage();
}

function ensureStats() {
  if (state.statsTimer) return;
  state.statsTimer = setInterval(async () => {
    if (!state.in.size) return stopStats();
    if (document.hidden) return; // ninguém está vendo os números
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
        link.tile.stats.textContent = `H.264 (1x), ${r.width || '–'}×${r.height || '–'}, ${Math.round(fps)} fps, ${mbps.toFixed(1)} Mbps`;
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
        const codec = codecName(report, r.codecId);
        link.tile.stats.textContent = [
          codec,
          `${r.frameWidth || '–'}×${r.frameHeight || '–'}`,
          `${Math.round(r.framesPerSecond || 0)} fps`,
          `${mbps.toFixed(1)} Mbps`,
        ].filter(Boolean).join(', ');
      });
    }
    $('downloadInfo').textContent = `Baixando ${total.toFixed(1)} Mbps no total`;
  }, 1000);
}

function stopStats() {
  clearInterval(state.statsTimer);
  state.statsTimer = null;
}

// Com a janela minimizada ou coberta (ex.: jogo em tela cheia) por alguns segundos, para de baixar
// o vídeo das telas que você assiste e fica só com o som. Quem transmite economiza uma codificação,
// e você, a decodificação. Ao voltar para a janela, o vídeo volta na hora.
let hiddenTimer = null;
function setIncomingVideo(on) {
  for (const [id, link] of state.in) {
    if (link.videoOn === on) continue;
    link.videoOn = on;
    sendSignal(id, { side: 'viewer', video: on });
  }
}

// A prévia da sua própria tela só roda com a janela do app em foco: enquanto você joga, ela para.
function syncPreview() {
  const preview = $('myPreview');
  const active = state.sharing && document.hasFocus() && !document.hidden;
  const src = active ? state.stream : null;
  if (preview.srcObject !== src) preview.srcObject = src;
  $('previewPaused').hidden = !state.sharing || active;
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
function openShareDialog() {
  $('shareDialog').hidden = false;
  loadSources();
  syncAudioMode();
  checkEncodeOnce();
}

// A opção "uma vez só" só fica disponível se o PC codifica H.264 pelo WebCodecs
let encodeOnceSupport = null;
async function checkEncodeOnce() {
  if (encodeOnceSupport === null) {
    const q = QUALITY['1080p60'];
    encodeOnceSupport = await pickEncoderConfig(q, q.w, q.h);
  }
  const opt = $('encodeMode').querySelector('option[value="once"]');
  opt.disabled = !encodeOnceSupport;
  if (!encodeOnceSupport) $('encodeMode').value = 'per';
  syncEncodeNote();
}

function syncEncodeNote() {
  const note = $('encodeNote');
  if (encodeOnceSupport === null) return;
  note.hidden = false;
  note.textContent = !encodeOnceSupport
    ? 'Este PC não consegue codificar uma vez só para todos, então cada pessoa recebe a própria codificação.'
    : $('encodeMode').value === 'once'
      ? `Codifica o vídeo uma vez só${encodeOnceSupport.hardware ? ', pela placa de vídeo' : ', pelo processador'}, e manda o mesmo para todos: o peso não aumenta quando mais gente assiste. Quem tem versão antiga do app recebe no modo normal.`
      : 'O processador codifica o vídeo uma vez para cada pessoa que assiste. Com vários amigos assistindo, experimente "Uma vez só para todos".';
}
function closeShareDialog() { $('shareDialog').hidden = true; }

async function loadSources() {
  const grid = $('sources');
  grid.innerHTML = '<p class="hint">Carregando telas e janelas…</p>';
  let sources = [];
  try { sources = await window.api.getSources(); } catch (e) { console.error(e); }
  grid.innerHTML = '';
  if (!sources.length) {
    grid.innerHTML = '<p class="hint">Nenhuma tela encontrada. Clique em "Atualizar lista".</p>';
    return;
  }
  if (!sources.some((s) => s.id === state.selectedSource)) state.selectedSource = null;
  $('startBtn').disabled = !state.selectedSource;

  for (const s of sources) {
    const btn = document.createElement('button');
    btn.className = 'source' + (s.id === state.selectedSource ? ' selected' : '');
    const img = document.createElement('img');
    img.src = s.thumbnail;
    img.alt = '';
    const label = document.createElement('span');
    label.textContent = s.id.startsWith('screen') ? `Tela inteira: ${s.name}` : s.name;
    btn.append(img, label);
    btn.onclick = () => {
      state.selectedSource = s.id;
      grid.querySelectorAll('.source').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      $('startBtn').disabled = false;
    };
    btn.ondblclick = () => startSharing();
    grid.append(btn);
  }
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
}

function syncAudioMode() {
  const withAudio = $('audioMode').value !== 'none';
  $('excludeField').hidden = !withAudio;
  $('audioNote').hidden = !withAudio;
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
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  stopAppAudio();
}

async function startSharing() {
  if (!state.selectedSource || state.sharing || !state.ws) return;
  const btn = $('startBtn');
  setBusy(btn, true, 'Iniciando…');

  state.quality = $('quality').value;
  const q = QUALITY[state.quality];
  const audioMode = $('audioMode').value;
  const encodeMode = $('encodeMode').value;
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
      if (!excluded.length) {
        loopback = true;
        toast('Não deu para separar o som deste app, então quem você assiste pode se ouvir na sua transmissão.', 'error');
      } else {
        toast(`Não foi possível ignorar os apps escolhidos: ${err.message}. Transmitindo sem áudio.`, 'error');
      }
    }
  }

  try {
    await window.api.selectSource(state.selectedSource, loopback);
    state.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: q.w }, height: { max: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
      audio: loopback
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : false,
    });
  } catch (err) {
    stopAppAudio();
    setBusy(btn, false, 'Iniciar transmissão');
    return toast(`Não foi possível capturar a tela: ${err.message}`, 'error');
  }
  if (audioTrack) state.stream.addTrack(audioTrack);

  const vTrack = state.stream.getVideoTracks()[0];
  if (vTrack) {
    vTrack.contentHint = 'motion';
    vTrack.onended = () => stopSharing('A captura foi encerrada (a janela foi fechada?).');
    if (encodeMode === 'once' && !(await startOnceEncoder(vTrack))) {
      toast('Este PC não conseguiu codificar uma vez só. Transmitindo no modo normal.', 'error');
    }
  }

  state.sharing = true;
  send({ type: 'share', sharing: true });
  updateStage();
  startOutStats();
  $('noAudio').hidden = audioMode === 'none' || state.stream.getAudioTracks().length > 0;
  closeShareDialog();
  renderShareBox();
  renderMembers();
  setBusy(btn, false, 'Iniciar transmissão');
}

function stopSharing(reason) {
  if (!state.sharing) return;
  state.sharing = false;
  stopOnceEncoder();
  stopOutStats();
  for (const id of [...state.out.keys()]) closeOut(id);
  stopTracks();
  send({ type: 'share', sharing: false });
  updateStage();
  renderShareBox();
  renderMembers();
  if (reason) toast(reason);
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
  state.stream.getTracks().filter((t) => !useOnce || t.kind !== 'video').forEach((t) => pc.addTrack(t, state.stream));
  if (useOnce) {
    link.dc = pc.createDataChannel('video');
    setupOnceSender(link);
  } else {
    preferH264(pc);
  }
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

// Mostra para quem transmite qual codec está em uso e se a placa de vídeo está codificando
function startOutStats() {
  stopOutStats();
  const last = { ts: performance.now(), captured: 0, encoded: 0, dropped: 0, sent: 0, behind: 0 };
  state.outStatsTimer = setInterval(async () => {
    const active = [...state.out.values()].filter((l) => l.pc.connectionState === 'connected' && !l.videoOff);
    const links = active.filter((l) => !l.dc);
    const onceCount = active.length - links.length;
    if (!active.length) { if (!document.hidden) $('encoderInfo').textContent = ''; return; }
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
    if (document.hidden) {
      away.samples.push({ captureFps, sentFps, mbps, limit }); // ninguém está vendo o painel agora
      return;
    }
    const place = (h) => (h === true ? ' pela placa de vídeo' : h === false ? ' pelo processador' : '');
    let text = '';
    if (onceCount) {
      text = `Codificando em H.264 uma vez só${onceCount > 1 ? ` para ${onceCount} pessoas,` : ''}${place(once.hardware)}.`;
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
  $('encoderInfo').textContent = '';
  $('awayInfo').textContent = '';
  away.samples = [];
}

function renderShareBox() {
  $('shareIdle').hidden = state.sharing;
  $('shareLive').hidden = !state.sharing;
  syncPreview();
  renderWatchers();
}

function renderWatchers() {
  const names = [...state.out].map(([id, l]) => nameOf(id) + (l.videoOff ? ' (só som, janela minimizada)' : ''));
  $('watcherInfo').textContent = names.length
    ? `Assistindo você: ${names.join(', ')}`
    : 'Ninguém está assistindo ainda. Só é enviado vídeo para quem clicar em Assistir.';
}

// ---------- Início ----------
$('name').value = load('name');
$('name').addEventListener('input', () => save('name', $('name').value));
$('roomPort').value = load('roomPort', '8765');
$('roomAddr').value = load('roomAddr');
$('quality').value = load('quality', '1080p30');
$('audioMode').value = load('audioMode', 'all') === 'none' ? 'none' : 'all';
$('encodeMode').value = load('encodeMode', 'per') === 'once' ? 'once' : 'per';
$('encodeMode').addEventListener('change', syncEncodeNote); // "exclude" da versão antiga vira "all"
// Prioridade vale para o app inteiro e já na abertura, não só durante a transmissão
$('priority').value = load('priority', 'above');
window.api.setPriority($('priority').value);
$('priority').addEventListener('change', () => {
  save('priority', $('priority').value);
  window.api.setPriority($('priority').value);
});

window.api.getVersion().then((v) => {
  update.myVersion = v;
  $('appVersion').textContent = `Versão ${v}`;
  checkGithub();
});
$('checkUpdates').onclick = () => checkGithub(true);
document.querySelectorAll('.update-restart').forEach((b) => { b.onclick = () => window.api.restartApp(); });

$('goCreate').onclick = () => show('create-room');
$('goJoin').onclick = () => { show('join-room'); $('roomAddr').focus(); };
document.querySelectorAll('.back').forEach((b) => { b.onclick = () => show('home'); });

$('createBtn').onclick = createRoom;
$('roomPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') createRoom(); });
$('joinBtn').onclick = joinRoom;
$('roomAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('joinPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });

// Quem criou a sala derruba todo mundo ao sair: pede confirmação se tiver mais alguém
function openCloseDialog() {
  $('closeDialog').hidden = false;
  $('cancelClose').focus();
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
$('confirmClose').onclick = () => leaveRoom('Sala encerrada.');
$('shareBtn').onclick = openShareDialog;
$('stopShareBtn').onclick = () => stopSharing();
$('cancelShare').onclick = closeShareDialog;
$('startBtn').onclick = startSharing;
$('refreshSources').onclick = loadSources;
$('audioMode').addEventListener('change', syncAudioMode);
$('refreshApps').onclick = loadAudioApps;
$('openStatsHome').onclick = openStats;
$('openStatsRoom').onclick = openStats;
$('closeStats').onclick = closeStats;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('statsDialog').hidden) closeStats();
  else if (!$('closeDialog').hidden) closeCloseDialog();
  else if (!$('shareDialog').hidden) closeShareDialog();
});
document.addEventListener('fullscreenchange', () => {
  for (const link of state.in.values()) setFsIcon(link.tile.fs, document.fullscreenElement === link.tile.el);
});
document.addEventListener('visibilitychange', onVisibility);
window.addEventListener('focus', syncPreview);
window.addEventListener('blur', syncPreview);

show('home');
