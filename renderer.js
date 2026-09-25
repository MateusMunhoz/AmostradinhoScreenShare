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
  sources: [],             // telas e janelas da última busca
  sourceTab: 'screens',    // aba aberta na janela de transmitir: 'screens' ou 'windows'
  appAudio: null,
  out: new Map(),          // id de quem me assiste -> { pc, chain }

  // O que eu estou assistindo
  in: new Map(),           // id de quem transmite -> { pc, chain, tile, lastBytes, lastTs }
  focus: null,             // id da transmissão em destaque (as outras ficam pausadas para mim)
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
  if (id === 'home') renderHome();
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
  refresh: svg('M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6'),
  stats: svg('M22 12h-4l-3 9L9 3l-3 9H2'),                 // pulso: estatísticas
  focus: svg('M3 5h18v14H3zM7 9h10v6H7z'),                  // um quadro dentro do outro: destacar
  grid: svg('M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z'), // grade: mostrar todas
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
  perfStart();
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
  closeStats();
  perfStop();
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
  const paused = id && state.focus && state.focus !== id && state.in.has(id);
  status.textContent = !sharing ? 'Na sala' : paused ? 'Transmitindo, em pausa para você' : 'Transmitindo';
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
  bar.append(stats, mute, vol, focusBtn, fs, close);
  el.append(video, overlay, label, bar);
  el.addEventListener('dblclick', (e) => { if (!bar.contains(e.target)) toggleFullscreen(el); });
  $('tiles').append(el);
  return { el, video, overlay, stats, fs, focusBtn, syncMute, name, paused: false, mutedBefore: false };
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
  if (state.focus) state.focus = id;   // pediu para assistir alguém durante o destaque: essa pessoa vira o destaque
  renderFocus();
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
  if (state.focus === id) state.focus = null; // quem estava em destaque saiu: as outras voltam
  renderFocus();
  renderMembers();
  updateStage();
}

// ---------- Destaque ----------
// Uma transmissão ocupa toda a área de vídeo e as outras ficam pausadas só para mim: quem
// transmite para de mandar o vídeo (o mesmo pedido da janela minimizada) e o som fica mudo.
function setFocus(id) {
  state.focus = id && state.in.has(id) ? id : null;
  renderFocus();
  renderMembers();
}

function renderFocus() {
  if (state.focus && (!state.in.has(state.focus) || state.in.size < 2)) state.focus = null;
  const focus = state.focus;
  $('tiles').classList.toggle('focused', !!focus);
  for (const [id, link] of state.in) {
    const t = link.tile;
    const paused = !!focus && id !== focus;
    t.el.classList.toggle('focus', id === focus);
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
        if (paint) link.tile.stats.textContent = `H.264 (1x), ${r.width || '–'}×${r.height || '–'}, ${Math.round(fps)} fps, ${mbps.toFixed(1)} Mbps`;
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
        if (!paint) return;
        const codec = codecName(report, r.codecId);
        link.tile.stats.textContent = [
          codec,
          `${r.frameWidth || '–'}×${r.frameHeight || '–'}`,
          `${Math.round(r.framesPerSecond || 0)} fps`,
          `${mbps.toFixed(1)} Mbps`,
        ].filter(Boolean).join(', ');
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
    const on = appVisible && (!state.focus || state.focus === id);
    if (link.videoOn === on) continue;
    link.videoOn = on;
    sendSignal(id, { side: 'viewer', video: on });
  }
}

// A prévia da sua própria tela só roda com a janela do app em foco: enquanto você joga, ela para.
function syncPreview() {
  const preview = $('myPreview');
  const active = state.sharing && document.hasFocus() && !document.hidden;
  const hasTrack = !!(state.stream && state.stream.getVideoTracks()[0]);
  if (once.active && once.engine === 'nvenc' && !hasTrack) {
    // NVENC direto: não há captura do Chromium, então a prévia decodifica a própria transmissão
    if (active) startPreview(preview);
    else stopPreview();
  } else {
    stopPreview();
    const src = active ? state.stream : null;
    if (preview.srcObject !== src) preview.srcObject = src;
  }
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
  $('shareSummary').classList.toggle('ready', !!src);
  $('shareSummaryText').textContent = src
    ? [sourceLabel(src), QUALITY_SPEC[radioValue('quality')], encodeText(), soundText()].join(' · ')
    : 'Escolha uma tela ou janela para começar';
  $('shareSummary').title = $('shareSummaryText').textContent; // texto inteiro, se não couber
  $('startBtn').disabled = !src;
  const open = $('advToggle').getAttribute('aria-expanded') === 'true';
  const prio = document.querySelector('input[name="priority"]:checked')?.nextElementSibling?.textContent || '';
  $('advSummary').textContent = open ? '' : `${encodeText()} · prioridade ${prio.toLowerCase()}`;
}

function setAdvanced(open) {
  $('advToggle').setAttribute('aria-expanded', String(open));
  $('advPanel').hidden = !open;
  renderShareSummary();
}

function closeShareDialog() { $('shareDialog').hidden = true; }

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
      if (!excluded.length) {
        loopback = true;
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
    setBusy(btn, false, 'Iniciar transmissão');
    return toast(`Não foi possível capturar a tela: ${err.message}`, 'error');
  }
  if (audioTrack) state.stream.addTrack(audioTrack);

  const vTrack = state.stream.getVideoTracks()[0];
  if (vTrack) {
    setupChromeVideo(vTrack);
    if (encodeMode === 'once' && !nvenc && !(await startOnceEncoder(vTrack))) {
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
        await window.api.selectSource(state.selectedSource, false);
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

function renderShareBox() {
  $('shareIdle').hidden = state.sharing;
  $('shareLive').hidden = !state.sharing;
  syncPreview();
  renderWatchers();
}

function renderWatchers() {
  const names = [...state.out].map(([id, l]) => nameOf(id) + (l.videoOff ? ' (vídeo pausado)' : ''));
  $('watcherInfo').textContent = names.length
    ? `Assistindo você: ${names.join(', ')}`
    : 'Ninguém está assistindo ainda. Só é enviado vídeo para quem clicar em Assistir.';
}

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
document.querySelectorAll('.update-restart').forEach((b) => { b.onclick = () => window.api.restartApp(); });

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
$('refreshApps').onclick = loadAudioApps;
// Ícone das Estatísticas, na sala ao lado de Sair da sala
setIcon($('openStatsRoom'), 'stats', 'Estatísticas: uso de processador e placa de vídeo');
$('openStatsRoom').onclick = openStats;
$('closeStats').onclick = closeStats;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('statsDialog').hidden) closeStats();
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
