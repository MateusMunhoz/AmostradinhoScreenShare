'use strict';

// Modo experimental "codificar uma vez só": em vez de uma faixa de vídeo WebRTC por pessoa
// (um codificador por conexão), o vídeo é codificado uma vez com WebCodecs, pela placa de vídeo
// quando der, e os mesmos pedaços vão para todos por um canal de dados na conexão de cada um.
// O som continua como faixa WebRTC. Usa state, QUALITY, sendSignal, preferH264 e toast do renderer.js.

const PART_SIZE = 64 * 1024 - 32;   // limite seguro de mensagem do canal de dados
const HEADER = 17;                  // [tipo 1][seq 4][timestamp 8][parte 2][total 2]
const KEY_INTERVAL = 4000;          // quadro-chave periódico (ms)
const KEY_REQUEST_GAP = 500;        // no máximo 2 pedidos de quadro-chave por segundo

const once = {
  active: false,
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

// ---------- Quem transmite ----------
function onceLinks() {
  return [...state.out].filter(([, l]) => l.dc);
}

// Pedido de quem acabou de entrar, voltou ou perdeu o decodificador: sempre atende
function requestKey() {
  once.keyWanted = true;
}

function configureEncoder(w, h) {
  const q = QUALITY[state.quality];
  once.encoder.configure(encoderConfig(once.base, q, w, h));
  once.width = even(w);
  once.height = even(h);
  once.keyWanted = true;
  const msg = JSON.stringify({ config: { codec: once.base.codec, width: once.width, height: once.height } });
  for (const [, l] of onceLinks()) if (l.dc.readyState === 'open') l.dc.send(msg);
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
  Object.assign(once, { base: pick.base, hardware: pick.hardware, seq: 0, lastKey: 0, captured: 0, encoded: 0, dropped: 0, sentBytes: 0 });
  once.encoder = newEncoder();
  try {
    configureEncoder(w, h);
  } catch (e) {
    console.warn(e);
    once.encoder = null;
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
  // Ninguém com vídeo ligado no modo novo: não codifica à toa
  if (!onceLinks().some(([, l]) => l.dc.readyState === 'open' && !l.videoOff)) return;
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
  const key = chunk.type === 'key';
  const seq = once.seq = (once.seq + 1) >>> 0;
  const total = Math.max(1, Math.ceil(data.length / PART_SIZE));
  const msgs = [];
  for (let part = 0; part < total; part++) {
    const slice = data.subarray(part * PART_SIZE, (part + 1) * PART_SIZE);
    const buf = new ArrayBuffer(HEADER + slice.length);
    const v = new DataView(buf);
    v.setUint8(0, key ? 1 : 0);
    v.setUint32(1, seq);
    v.setFloat64(5, chunk.timestamp);
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
    link.dc.send(JSON.stringify({ config: { codec: once.base.codec, width: once.width, height: once.height } }));
    requestKey();
  };
  link.dc.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.key) { link.needKey = true; requestKey(); }
  };
}

// Vídeo da pessoa voltou (janela restaurada): quadro-chave para aparecer na hora
function onceVideoResumed(link) {
  if (!link.dc) return;
  link.needKey = true;
  requestKey();
}

let encoderRetried = false;
async function onEncoderError(err) {
  console.warn('[1x] erro no codificador:', err);
  if (!once.active) return;
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

// Volta todo mundo para o modo normal: uma faixa de vídeo WebRTC em cada conexão
function fallbackToTracks() {
  const video = state.stream && state.stream.getVideoTracks()[0];
  stopOnceEncoder();
  for (const [id, link] of state.out) {
    if (!link.dc) continue;
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
  once.active = false;
  encoderRetried = false;
  const reader = once.reader;
  once.reader = null;
  if (reader) reader.cancel().catch(() => {});
  if (once.encoder && once.encoder.state !== 'closed') {
    try { once.encoder.close(); } catch {}
  }
  once.encoder = null;
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

function refreshTileStream(link) {
  const video = link.tile.video;
  video.srcObject = new MediaStream(link.tracks);
  video.play().catch(() => {});
}
