'use strict';

// Modo experimental "codificar uma vez só": em vez de uma faixa de vídeo WebRTC por pessoa
// (um codificador por conexão), o vídeo é codificado uma vez e os mesmos pedaços vão para todos
// por um canal de dados na conexão de cada um. O som continua como faixa WebRTC.
// Dois motores, nesta ordem:
//   1. NVENC direto (videocap.exe): captura do Windows + NVENC, sem a imagem sair da placa NVIDIA.
//   2. WebCodecs: captura do Chromium, codificação pela placa (qualquer marca) ou pelo processador.
// Se os dois falharem, cada pessoa volta a ter a própria faixa WebRTC (modo normal).
// Usa state, QUALITY, sendSignal, preferH264, toast e stopSharing do renderer.js.

const PART_SIZE = 64 * 1024 - 32;   // limite seguro de mensagem do canal de dados
const HEADER = 17;                  // [tipo 1][seq 4][timestamp 8][parte 2][total 2]
const KEY_INTERVAL = 4000;          // quadro-chave periódico do WebCodecs (ms)
const KEY_REQUEST_GAP = 500;        // no máximo 2 pedidos de quadro-chave por segundo
const NVENC_CODEC = 'avc1.64002a';  // H.264 High do videocap

const once = {
  active: false,
  engine: '',        // 'nvenc' ou 'webcodecs'
  encoder: null,
  reader: null,
  base: null,        // { codec, hardwareAcceleration } em uso
  hardware: false,
  width: 0,
  height: 0,
  seq: 0,
  lastKey: 0,
  keyWanted: false,
  lastKeyRequest: 0,
  nvencRunning: false,   // o videocap está codificando (e não em pausa)
  // contadores para o painel e as estatísticas
  captured: 0,
  encoded: 0,
  dropped: 0,
  sentBytes: 0,
};

function onceSupportedForViewer() {
  return typeof VideoDecoder === 'function' && typeof MediaStreamTrackGenerator === 'function';
}

const even = (n) => Math.max(2, Math.round(n) & ~1);

function encoderConfig(base, q, w, h) {
  return {
    ...base, width: even(w), height: even(h), bitrate: q.bitrate, framerate: q.fps,
    latencyMode: 'realtime', bitrateMode: 'variable', avc: { format: 'annexb' },
  };
}

// H.264 High e Main (nível 4.2, até 1080p60), primeiro pela placa de vídeo, depois pelo processador
async function pickEncoderConfig(q, w, h, softwareOnly = false) {
  if (typeof VideoEncoder !== 'function' || typeof MediaStreamTrackProcessor !== 'function') return null;
  const accels = softwareOnly ? ['no-preference'] : ['prefer-hardware', 'no-preference'];
  for (const hardwareAcceleration of accels) {
    for (const codec of ['avc1.64002a', 'avc1.4d002a', 'avc1.42002a']) {
      const base = { codec, hardwareAcceleration };
      try {
        const res = await VideoEncoder.isConfigSupported(encoderConfig(base, q, w, h));
        if (res.supported) return { base, hardware: hardwareAcceleration === 'prefer-hardware' };
      } catch {}
    }
  }
  return null;
}

// Qual motor o modo "uma vez só" vai usar neste PC: { engine, hardware } ou null
let onceSupportCache = null;
async function onceSupport() {
  if (!onceSupportCache) {
    onceSupportCache = (async () => {
      try {
        const probe = await window.api.videoCapProbe();
        if (probe && probe.nvenc) return { engine: 'nvenc', hardware: true, gpu: probe.gpu };
      } catch {}
      const q = QUALITY['1080p60'];
      const pick = await pickEncoderConfig(q, q.w, q.h);
      return pick ? { engine: 'webcodecs', hardware: pick.hardware } : null;
    })();
  }
  return onceSupportCache;
}

function engineName() {
  return once.engine === 'nvenc' ? 'NVENC direto' : 'WebCodecs';
}

// ---------- Quem transmite ----------
function onceLinks() {
  return [...state.out].filter(([, l]) => l.dc);
}

function configMessage() {
  return JSON.stringify({ config: { codec: once.base.codec, width: once.width, height: once.height } });
}

function sendConfigToAll() {
  const msg = configMessage();
  for (const [, l] of onceLinks()) if (l.dc.readyState === 'open') l.dc.send(msg);
}

// Pedido de quem acabou de entrar, voltou ou perdeu o decodificador: sempre atende
function requestKey() {
  if (once.engine === 'nvenc') window.api.videoCapCmd('key');
  else once.keyWanted = true;
}

// Alguém precisa de vídeo agora? (quem assiste com a janela aberta, ou a prévia)
function onceWanted() {
  return onceLinks().some(([, l]) => l.dc.readyState === 'open' && !l.videoOff) || !!ownPreview.link;
}

// O NVENC fica em pausa enquanto ninguém precisa do vídeo
function onceViewersChanged() {
  if (!once.active || once.engine !== 'nvenc') return;
  const want = onceWanted();
  if (want === once.nvencRunning) return;
  once.nvencRunning = want;
  window.api.videoCapCmd(want ? 'resume' : 'pause');
}

// ---- Motor 1: NVENC direto ----
async function startNvenc(sourceId) {
  const q = QUALITY[state.quality];
  window.api.onVideoCap(onNvencChunk, onNvencStats, onNvencEnded);
  let res;
  try {
    res = await window.api.videoCapStart({ sourceId, w: q.w, h: q.h, fps: q.fps, bitrate: q.bitrate });
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  if (!res.ok) {
    window.api.offVideoCap();
    console.warn('[1x] NVENC direto não começou:', res.error);
    return false;
  }
  Object.assign(once, {
    active: true, engine: 'nvenc', base: { codec: NVENC_CODEC }, hardware: true, width: res.width, height: res.height,
    seq: 0, captured: 0, encoded: 0, dropped: 0, sentBytes: 0, nvencRunning: true,
  });
  onceViewersChanged(); // ninguém assistindo ainda: pausa
  return true;
}

function onNvencChunk(c) {
  if (!once.active || once.engine !== 'nvenc') return;
  broadcastChunk({ key: c.key, timestamp: c.ts, data: c.data });
}

function onNvencStats(s) {
  if (once.engine !== 'nvenc') return;
  once.captured = s.captured;
  once.encoded = s.encoded;
}

function onNvencEnded(info) {
  if (!once.active || once.engine !== 'nvenc') return;
  window.api.offVideoCap();
  if (info.windowClosed) return stopSharing('A captura foi encerrada (a janela foi fechada?).');
  console.warn('[1x] NVENC direto parou:', info.error);
  switchToWebCodecs('O NVENC direto parou.');
}

// O NVENC parou no meio: continua uma vez só pelo WebCodecs, com a captura do Chromium
async function switchToWebCodecs(why) {
  once.active = false;
  once.engine = '';
  const track = await ensureChromeVideo();
  if (track && state.sharing && (await startOnceEncoder(track))) {
    sendConfigToAll();
    for (const [, l] of onceLinks()) l.needKey = true;
    requestKey();
    syncPreview();
    return toast(`${why} A transmissão continua pelo WebCodecs.`, 'error');
  }
  if (!state.sharing) return;
  fallbackToTracks();
  toast(`${why} A transmissão continua no modo normal (uma codificação por pessoa).`, 'error');
}

// ---- Motor 2: WebCodecs ----
function configureEncoder(w, h) {
  const q = QUALITY[state.quality];
  once.encoder.configure(encoderConfig(once.base, q, w, h));
  once.width = even(w);
  once.height = even(h);
  once.keyWanted = true;
  sendConfigToAll();
}

function newEncoder() {
  return new VideoEncoder({ output: onChunk, error: (e) => onEncoderError(e) });
}

async function startOnceEncoder(track) {
  const q = QUALITY[state.quality];
  const s = track.getSettings();
  const w = s.width || q.w;
  const h = s.height || q.h;
  const pick = await pickEncoderConfig(q, w, h);
  if (!pick) return false;
  Object.assign(once, { engine: 'webcodecs', base: pick.base, hardware: pick.hardware, lastKey: 0 });
  once.encoder = newEncoder();
  try {
    configureEncoder(w, h);
  } catch (e) {
    console.warn(e);
    once.encoder = null;
    once.engine = '';
    return false;
  }
  once.active = true;
  readFrames(track);
  return true;
}

async function readFrames(track) {
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  once.reader = reader;
  while (once.reader === reader) {
    let res;
    try { res = await reader.read(); } catch { break; }
    if (res.done) break;
    const frame = res.value;
    try { encodeFrame(frame); } catch (e) { console.warn(e); } finally { frame.close(); }
  }
}

function encodeFrame(frame) {
  once.captured++;
  const enc = once.encoder;
  if (!enc || enc.state !== 'configured') return;
  if (!onceWanted()) return; // ninguém precisa do vídeo: não codifica à toa
  // A placa/processador não está dando conta: descarta em vez de acumular atraso
  if (enc.encodeQueueSize > 2) { once.dropped++; return; }
  if (even(frame.displayWidth) !== once.width || even(frame.displayHeight) !== once.height) {
    configureEncoder(frame.displayWidth, frame.displayHeight); // janela mudou de tamanho
  }
  const now = performance.now();
  const keyFrame = once.keyWanted || now - once.lastKey > KEY_INTERVAL;
  if (keyFrame) { once.keyWanted = false; once.lastKey = now; }
  enc.encode(frame, { keyFrame });
}

function onChunk(chunk) {
  once.encoded++;
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  broadcastChunk({ key: chunk.type === 'key', timestamp: chunk.timestamp, data });
}

let encoderRetried = false;
async function onEncoderError(err) {
  console.warn('[1x] erro no codificador:', err);
  if (!once.active || once.engine !== 'webcodecs') return;
  const q = QUALITY[state.quality];
  // A placa de vídeo parou de codificar: tenta pelo processador, ainda uma vez só
  if (!encoderRetried) {
    encoderRetried = true;
    const pick = await pickEncoderConfig(q, once.width, once.height, true);
    if (pick && once.active) {
      try {
        once.base = pick.base;
        once.hardware = false;
        once.encoder = newEncoder();
        configureEncoder(once.width, once.height);
        return;
      } catch (e) { console.warn(e); }
    }
  }
  fallbackToTracks();
  toast('A codificação única falhou. A transmissão continua no modo normal (uma codificação por pessoa).', 'error');
}

// ---- Envio: o mesmo quadro para todos ----
function broadcastChunk({ key, timestamp, data }) {
  if (ownPreview.link) feedPreview(key, timestamp, data);
  const seq = once.seq = (once.seq + 1) >>> 0;
  const total = Math.max(1, Math.ceil(data.length / PART_SIZE));
  const msgs = [];
  for (let part = 0; part < total; part++) {
    const slice = data.subarray(part * PART_SIZE, (part + 1) * PART_SIZE);
    const buf = new ArrayBuffer(HEADER + slice.length);
    const v = new DataView(buf);
    v.setUint8(0, key ? 1 : 0);
    v.setUint32(1, seq);
    v.setFloat64(5, timestamp);
    v.setUint16(13, part);
    v.setUint16(15, total);
    new Uint8Array(buf, HEADER).set(slice);
    msgs.push(buf);
  }

  const q = QUALITY[state.quality];
  const limit = Math.max(q.bitrate / 16, 256 * 1024); // ~0,5 s de vídeo parado no envio
  for (const [, link] of onceLinks()) {
    const dc = link.dc;
    if (dc.readyState !== 'open' || link.videoOff) continue;
    // Internet dessa pessoa não está dando conta: pula quadros só para ela, até um quadro-chave
    if (dc.bufferedAmount > limit) {
      link.needKey = true;
      link.behind = (link.behind || 0) + 1;
      askKey();
      continue;
    }
    if (!key && link.needKey) continue;
    if (key) link.needKey = false;
    try {
      for (const m of msgs) dc.send(m);
      once.sentBytes += data.length;
    } catch (e) {
      console.warn(e);
      link.needKey = true;
    }
  }
}

// Pedido por atraso no envio: no máximo 2 por segundo, para não encher a rede de quadros-chave
function askKey() {
  const now = performance.now();
  if (now - once.lastKeyRequest < KEY_REQUEST_GAP) return;
  once.lastKeyRequest = now;
  requestKey();
}

// Canal de vídeo de uma pessoa que assiste no modo novo
function setupOnceSender(link) {
  link.needKey = true;
  link.dc.binaryType = 'arraybuffer';
  link.dc.onopen = () => {
    link.dc.send(configMessage());
    onceViewersChanged();
    requestKey();
  };
  link.dc.onclose = () => onceViewersChanged();
  link.dc.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.key) { link.needKey = true; requestKey(); }
  };
}

// A janela de quem assiste foi minimizada ou voltou
function onceVideoChanged(link) {
  if (!link.dc) return;
  onceViewersChanged();
  if (link.videoOff) return;
  link.needKey = true; // voltou: quadro-chave para o vídeo aparecer na hora
  requestKey();
}

// Volta todo mundo para o modo normal: uma faixa de vídeo WebRTC em cada conexão
async function fallbackToTracks() {
  stopOnceEncoder();
  const video = await ensureChromeVideo();
  for (const [id, link] of state.out) {
    if (!link.dc) continue;
    link.dc.onclose = null;
    link.dc.close();
    link.dc = null;
    if (!video) continue;
    link.pc.addTrack(video, state.stream);
    preferH264(link.pc);
    link.chain = link.chain.then(async () => {
      await link.pc.setLocalDescription(await link.pc.createOffer());
      sendSignal(id, { side: 'sharer', sdp: link.pc.localDescription });
    }).catch(console.error);
  }
}

function stopOnceEncoder() {
  if (once.engine === 'nvenc') {
    window.api.offVideoCap();
    window.api.videoCapStop();
  }
  once.active = false;
  once.engine = '';
  once.nvencRunning = false;
  encoderRetried = false;
  const reader = once.reader;
  once.reader = null;
  if (reader) reader.cancel().catch(() => {});
  if (once.encoder && once.encoder.state !== 'closed') {
    try { once.encoder.close(); } catch {}
  }
  once.encoder = null;
  stopPreview();
}

// ---- Prévia da própria tela no modo NVENC (não há faixa do Chromium): decodifica o próprio vídeo ----
const ownPreview = { link: null };

function startPreview(videoEl) {
  if (ownPreview.link) return;
  const link = { tracks: [], tile: { video: videoEl }, once: null };
  const fakeChannel = { readyState: 'open', send: () => requestKey() }; // o único pedido é "quadro-chave"
  ownPreview.link = link;
  setupOnceReceiver(link, fakeChannel);
  configureDecoder(link, once.base.codec);
  onceViewersChanged();
  requestKey();
}

function feedPreview(key, ts, data) {
  const r = ownPreview.link && ownPreview.link.once;
  if (r) decodeFrame(ownPreview.link, { key, ts, parts: [data], size: data.length });
}

function stopPreview() {
  const link = ownPreview.link;
  if (!link) return;
  ownPreview.link = null;
  closeOnceReceiver(link);
  link.tile.video.srcObject = null;
  onceViewersChanged();
}

// ---------- Quem assiste ----------
function setupOnceReceiver(link, dc) {
  dc.binaryType = 'arraybuffer';
  const gen = new MediaStreamTrackGenerator({ kind: 'video' });
  const r = {
    dc, gen, writer: gen.writable.getWriter(), decoder: null, codec: '', hardware: null,
    frame: null, waitKey: true, width: 0, height: 0, decoded: 0, bytes: 0,
  };
  link.once = r;
  setVideoTrack(link, gen);

  dc.onmessage = (e) => {
    if (typeof e.data === 'string') {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.config && typeof m.config.codec === 'string') configureDecoder(link, m.config.codec);
      return;
    }
    onPart(link, e.data);
  };
  dc.onclose = () => closeOnceReceiver(link);
}

async function configureDecoder(link, codec) {
  const r = link.once;
  if (!r || (r.codec === codec && r.decoder && r.decoder.state === 'configured')) return;
  r.codec = codec;
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
    const config = { codec, hardwareAcceleration, optimizeForLatency: true };
    try {
      if (!(await VideoDecoder.isConfigSupported(config)).supported) continue;
    } catch { continue; }
    if (link.once !== r) return;
    if (r.decoder && r.decoder.state !== 'closed') r.decoder.close();
    r.decoder = new VideoDecoder({ output: (f) => onDecoded(link, f), error: (e) => onDecoderError(link, e) });
    try {
      r.decoder.configure(config);
    } catch (e) { console.warn(e); continue; }
    r.hardware = hardwareAcceleration === 'prefer-hardware';
    r.waitKey = true;
    askKeyFrom(r);
    return;
  }
  console.warn('[1x] este PC não decodifica', codec);
}

function askKeyFrom(r) {
  if (r.dc.readyState === 'open') r.dc.send(JSON.stringify({ key: true }));
}

function onPart(link, buf) {
  const r = link.once;
  if (!r || buf.byteLength < HEADER) return;
  const v = new DataView(buf);
  const key = v.getUint8(0) === 1;
  const seq = v.getUint32(1);
  const part = v.getUint16(13);
  const total = v.getUint16(15);
  const body = new Uint8Array(buf, HEADER);
  if (part === 0) {
    r.frame = { key, seq, ts: v.getFloat64(5), total, parts: [body], size: body.length };
  } else if (r.frame && r.frame.seq === seq && r.frame.parts.length === part) {
    r.frame.parts.push(body);
    r.frame.size += body.length;
  } else {
    r.frame = null; // pedaço fora de ordem: descarta o quadro
    return;
  }
  if (r.frame.parts.length < total) return;
  const f = r.frame;
  r.frame = null;
  r.bytes += f.size;
  decodeFrame(link, f);
}

function decodeFrame(link, f) {
  const r = link.once;
  const dec = r.decoder;
  if (!dec || dec.state !== 'configured') return;
  if (r.waitKey && !f.key) return;
  // Decodificação atrasada: descarta até o próximo quadro-chave
  if (dec.decodeQueueSize > 6) { r.waitKey = true; askKeyFrom(r); return; }
  const data = f.parts.length === 1 ? f.parts[0] : new Uint8Array(f.size);
  if (f.parts.length > 1) {
    let off = 0;
    for (const p of f.parts) { data.set(p, off); off += p.length; }
  }
  if (f.key) r.waitKey = false;
  try {
    dec.decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: f.ts, data }));
  } catch (e) {
    console.warn(e);
    r.waitKey = true;
    askKeyFrom(r);
  }
}

function onDecoded(link, frame) {
  const r = link.once;
  if (!r) return frame.close();
  r.decoded++;
  r.width = frame.displayWidth;
  r.height = frame.displayHeight;
  // O vídeo na tela ainda não pegou o último quadro: descarta este, sem acumular atraso
  if (r.writer.desiredSize !== null && r.writer.desiredSize <= 0) return frame.close();
  r.writer.write(frame).catch(() => frame.close());
}

function onDecoderError(link, err) {
  console.warn('[1x] erro no decodificador:', err);
  const r = link.once;
  if (!r) return;
  const codec = r.codec;
  r.codec = '';
  configureDecoder(link, codec); // recria e pede quadro-chave
}

function closeOnceReceiver(link) {
  const r = link.once;
  if (!r) return;
  link.once = null;
  if (r.decoder && r.decoder.state !== 'closed') { try { r.decoder.close(); } catch {} }
  r.writer.close().catch(() => {});
  r.gen.stop();
}

// O vídeo do tile vem de uma faixa WebRTC (modo normal) ou da faixa com os quadros decodificados
function setVideoTrack(link, track) {
  const tracks = link.tracks.filter((t) => t.kind !== 'video');
  link.tracks = [...tracks, track];
  refreshTileStream(link);
}

// Com a janela flutuante aberta para esta transmissão, o vídeo vai só para ela; o quadro no app fica
// só com o som (não desenha o mesmo vídeo duas vezes)
function refreshTileStream(link) {
  const video = link.tile.video;
  const pip = [...state.pips].find(([id, p]) => !p.win.closed && state.in.get(id) === link)?.[1];
  const full = new MediaStream(link.tracks);
  if (pip) {
    pip.video.srcObject = full;
    pip.video.play().catch(() => {});
    video.srcObject = new MediaStream(link.tracks.filter((t) => t.kind === 'audio'));
  } else {
    video.srcObject = full;
  }
  video.play().catch(() => {});
}
