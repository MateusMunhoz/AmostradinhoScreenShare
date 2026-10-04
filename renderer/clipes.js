'use strict';
// Clipes: os últimos segundos de uma transmissão, com o som dela, viram um MP4 em Vídeos\Tela P2P\Clipes.
// - Vídeo no modo "uma vez só" (encode-once.js): os pedaços H.264 que já chegam vão direto para o buffer (clipFeed),
//   sem recodificar.
// - Vídeo no modo "uma por pessoa": a faixa WebRTC é codificada de novo aqui, só para o clipe: pela placa de vídeo
//   (WebCodecs) no tamanho que chega; sem a placa, pelo processador em até 720p a 30 quadros, para pesar pouco.
// - Som: a faixa de som da transmissão (o jogo, não a voz da call) é codificada em AAC ou Opus num buffer ao lado.
// Duração: 15 s, 30 s, 1 min ou 2 min (Voz e atalhos). Atalho (Ctrl+Shift+C), tesoura em cada transmissão e item no
// ícone da bandeja. Buffers ficam no próprio link (o de quem você assiste) ou em `once` (a sua transmissão).
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, encode-once,
// clipe-mp4.

const CLIP_DURATIONS = [15, 30, 60, 120];
const CLIP_KEY_EVERY = 8; // s: quem transmite pelo NVENC só manda quadro-chave quando pedem
const CLIP_OWN_NVENC = true; // o NVENC não pausa sem ninguém assistindo: dá para clipar a própria tela sozinho (encode-once.js)
const CLIP_REC_KEY_MS = 2000; // quadro-chave do codificador do clipe (modo "uma por pessoa"): o clipe começa no máximo 2 s antes
const CLIP_MAX_BYTES = 400 * 1024 * 1024;
const clipState = { saving: false, timer: 0 };

function clipSeconds() {
  const s = Number(load('clipSeconds', '30'));
  return CLIP_DURATIONS.includes(s) ? s : 30;
}
const nowUs = () => performance.now() * 1000;

function clipVideoBuffer(target) {
  return target.clip || (target.clip = new ClipMp4.ClipBuffer({ seconds: clipSeconds() + 1, maxBytes: CLIP_MAX_BYTES }));
}

// Chamado a cada quadro inteiro: pelo encode-once.js (modo "uma vez só") e pelo codificador do clipe (uma por pessoa).
// target: o link de quem transmite, ou `once` (a sua transmissão).
function clipFeed(target, key, ts, data, askKey) {
  const b = clipVideoBuffer(target);
  b.push({ key, ts, data, at: nowUs() });
  const now = performance.now();
  if (b.sinceKey() > CLIP_KEY_EVERY && now - (target.clipAsked || 0) > CLIP_KEY_EVERY * 1000) {
    target.clipAsked = now;
    askKey();
  }
}
// Perdeu um pedaço: até o próximo quadro-chave os seguintes não servem (dependem do que faltou)
function clipGap(target) { target.clip?.gap(); }
function clipDrop(target) {
  if (!target) return;
  stopClipVideo(target);
  stopClipAudio(target);
  target.clip = null;
  target.clipAudio = null;
}

// ---------- Codificador do clipe (modo "uma por pessoa") ----------
// Placa de vídeo no tamanho que chega; sem ela, processador em até 720p e 30 quadros (fps: o codificador pula o resto)
const CLIP_SOFT_MAX = { w: 1280, h: 720, fps: 30 };
async function clipEncoderConfig(w, h) {
  for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software']) {
    const soft = hardwareAcceleration === 'prefer-software';
    const scale = soft ? Math.min(1, CLIP_SOFT_MAX.w / w, CLIP_SOFT_MAX.h / h) : 1;
    const cw = Math.round(w * scale) & ~1, ch = Math.round(h * scale) & ~1;
    const fps = soft ? CLIP_SOFT_MAX.fps : 60;
    const bitrate = Math.round(Math.min(16e6, Math.max(2e6, cw * ch * fps * 0.08)));
    for (const codec of [`avc1.6400${avcLevel(cw, ch)}`, `avc1.4d00${avcLevel(cw, ch)}`, `avc1.4200${avcLevel(cw, ch)}`]) {
      const config = { codec, width: cw, height: ch, bitrate, framerate: fps, hardwareAcceleration,
        latencyMode: 'realtime', bitrateMode: 'variable', avc: { format: 'annexb' } };
      try { if ((await VideoEncoder.isConfigSupported(config)).supported) return { config, fps }; } catch {}
    }
  }
  return null;
}

function startClipVideo(target, track) {
  const rec = { track, stopped: false, encoder: null, w: 0, h: 0, lastKey: 0, configuring: false, noEncoder: false, gap: 0, lastTs: -Infinity };
  target.clipVideo = rec;
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  rec.reader = reader;
  rec.encoder = new VideoEncoder({
    output: (chunk) => {
      if (rec.stopped) return;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      clipFeed(target, chunk.type === 'key', chunk.timestamp, data, () => { rec.lastKey = 0; });
    },
    error: (e) => { console.warn('[clipe] codificador:', e); rec.encoder = null; },
  });
  (async () => {
    for (;;) {
      const { value: frame, done } = await reader.read().catch(() => ({ done: true }));
      if (done || rec.stopped) { frame?.close(); break; }
      clipEncode(target, rec, frame);
    }
  })();
}

function clipEncode(target, rec, frame) {
  const enc = rec.encoder;
  const w = frame.displayWidth & ~1, h = frame.displayHeight & ~1;
  if (!enc || rec.noEncoder || rec.configuring || !w || !h) return frame.close();
  if (w !== rec.w || h !== rec.h) {
    rec.configuring = true;
    frame.close();
    clipEncoderConfig(w, h).then((pick) => {
      rec.configuring = false;
      if (rec.stopped || !rec.encoder) return;
      if (!pick) { rec.noEncoder = true; console.warn('[clipe] este PC não codifica H.264: sem clipe no modo "uma por pessoa"'); return; }
      rec.encoder.configure(pick.config); // quadro maior que o configurado: o codificador reduz
      rec.w = w; rec.h = h; rec.lastKey = 0;
      rec.gap = 1e6 / pick.fps - 2000; // µs entre quadros (com folga para o tremido da chegada)
      target.clipDims = { width: pick.config.width, height: pick.config.height };
    });
    return;
  }
  if (frame.timestamp - rec.lastTs < rec.gap) return frame.close(); // acima dos quadros por segundo do clipe
  if (enc.state !== 'configured' || enc.encodeQueueSize > 2) return frame.close(); // o codificador não está dando conta: pula
  rec.lastTs = frame.timestamp;
  const now = performance.now();
  const keyFrame = now - rec.lastKey > CLIP_REC_KEY_MS;
  if (keyFrame) rec.lastKey = now;
  try { enc.encode(frame, { keyFrame }); } catch (e) { console.warn('[clipe]', e); }
  frame.close();
}

function stopClipVideo(target) {
  const rec = target.clipVideo;
  if (!rec) return;
  rec.stopped = true;
  rec.reader?.cancel().catch(() => {});
  if (rec.encoder && rec.encoder.state !== 'closed') { try { rec.encoder.close(); } catch {} }
  target.clipVideo = null;
}

// ---------- Som do clipe ----------
async function clipAudioConfig(sampleRate, numberOfChannels) {
  for (const [codec, bitrate] of [['mp4a.40.2', 160000], ['opus', 128000]]) {
    const config = { codec, sampleRate, numberOfChannels, bitrate };
    try { if ((await AudioEncoder.isConfigSupported(config)).supported) return config; } catch {}
  }
  return null;
}

function startClipAudio(target, track) {
  const rec = { track, stopped: false, encoder: null, configuring: false, offset: Infinity, failed: false };
  target.clipAudioRec = rec;
  const buf = target.clipAudio || (target.clipAudio = new ClipMp4.ClipAudioBuffer({ seconds: clipSeconds() + 1 }));
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  rec.reader = reader;
  (async () => {
    for (;;) {
      const { value: data, done } = await reader.read().catch(() => ({ done: true }));
      if (done || rec.stopped) { data?.close(); break; }
      // Relógio deste PC para o tempo do som: a menor diferença (o pedaço que chegou mais rápido)
      rec.offset = Math.min(rec.offset, nowUs() - data.timestamp);
      if (!rec.encoder && !rec.configuring && !rec.failed) {
        rec.configuring = true;
        const config = await clipAudioConfig(data.sampleRate, data.numberOfChannels);
        rec.configuring = false;
        if (!config || rec.stopped) { rec.failed = !config; data.close(); continue; }
        rec.encoder = new AudioEncoder({
          output: (chunk, meta) => {
            if (rec.stopped) return;
            if (meta?.decoderConfig) {
              const d = meta.decoderConfig.description;
              buf.config = { codec: config.codec === 'opus' ? 'opus' : 'aac', sampleRate: config.sampleRate, numberOfChannels: config.numberOfChannels,
                description: d ? new Uint8Array(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d.slice(0)) : null };
            }
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            buf.push({ ts: chunk.timestamp + rec.offset, data: bytes, duration: chunk.duration || 0 });
          },
          error: (e) => { console.warn('[clipe] som:', e); rec.failed = true; rec.encoder = null; },
        });
        rec.encoder.configure(config);
      }
      if (rec.encoder && rec.encoder.state === 'configured') {
        try { rec.encoder.encode(data); } catch (e) { console.warn('[clipe] som:', e); }
      }
      data.close();
    }
  })();
}

function stopClipAudio(target) {
  const rec = target.clipAudioRec;
  if (!rec) return;
  rec.stopped = true;
  rec.reader?.cancel().catch(() => {});
  if (rec.encoder && rec.encoder.state !== 'closed') { try { rec.encoder.close(); } catch {} }
  target.clipAudioRec = null;
}

// ---------- Quem grava o quê ----------
// A cada 2 s: liga e desliga os gravadores conforme as transmissões abertas (a sua e as que você assiste)
function clipTargets() {
  const out = [];
  for (const [, link] of state.in) {
    if (link.self) continue; // a sua tela aberta no palco: o clipe dela sai de `once`
    const live = (kind) => link.tracks.find((t) => t.kind === kind && t.readyState === 'live') || null;
    out.push({ target: link, video: link.once ? null : live('video'), audio: live('audio') });
  }
  if (state.sharing && state.stream) {
    const live = (list) => list.find((t) => t.readyState === 'live') || null;
    out.push({ target: once, video: once.active ? null : live(state.stream.getVideoTracks()), audio: live(state.stream.getAudioTracks()) });
  }
  return out;
}
let clipKnown = new Set();
function syncClips() {
  const now = new Set();
  for (const { target, video, audio } of clipTargets()) {
    now.add(target);
    if ((target.clipVideo?.track || null) !== video) { stopClipVideo(target); if (video) startClipVideo(target, video); }
    if ((target.clipAudioRec?.track || null) !== audio) { stopClipAudio(target); if (audio) startClipAudio(target, audio); }
  }
  for (const t of clipKnown) if (!now.has(t)) clipDrop(t);
  clipKnown = now;
}
function startClips() {
  clearInterval(clipState.timer);
  clipState.timer = setInterval(syncClips, 2000);
  for (const input of document.querySelectorAll('input[name=clipSeconds]')) {
    input.checked = Number(input.value) === clipSeconds();
    input.onchange = () => { if (input.checked) setClipSeconds(Number(input.value)); };
  }
}
function setClipSeconds(s) {
  if (!CLIP_DURATIONS.includes(s)) return;
  save('clipSeconds', String(s));
  for (const t of [...clipKnown, once]) {
    if (t.clip) t.clip.seconds = s + 1;
    if (t.clipAudio) t.clipAudio.seconds = s + 1;
  }
}

// ---------- Salvar ----------
// De onde sai o clipe de uma pessoa: a sua transmissão (once; vale mesmo sem a sua tela aberta) ou o link de quem
// você assiste
function clipSource(id) {
  const target = id && id === state.myId ? (state.sharing ? once : null) : state.in.get(id);
  if (!target || target.self || !target.clip) return null;
  const dims = target === once && once.active ? { width: once.width, height: once.height }
    : target.once ? { width: target.once.width || 1280, height: target.once.height || 720 }
    : target.clipDims || { width: 1280, height: 720 };
  return { buffer: target.clip, audio: target.clipAudio, ...dims };
}
function clipReady(id) { return (clipSource(id)?.buffer.duration() || 0) >= 1; }

// Quem o atalho salva: a transmissão em destaque; sem destaque, a única com clipe; senão a principal
function clipTargetId() {
  if (state.focus && clipReady(state.focus)) return state.focus;
  const ready = [...new Set([...state.in.keys(), state.myId])].filter((id) => id && clipReady(id));
  if (ready.length === 1) return ready[0];
  if (state.main && ready.includes(state.main)) return state.main;
  return ready.find((id) => id !== state.myId) || ready[0] || null;
}

const pad2 = (n) => String(n).padStart(2, '0');
function clipLabel(id) {
  const d = new Date();
  const who = id === state.myId ? 'Minha tela' : nameOf(id);
  return `Clipe - ${who} - ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

async function saveClip(id = clipTargetId()) {
  if (clipState.saving) return;
  const src = id ? clipSource(id) : null;
  if (!src || src.buffer.duration() < 1) {
    return toast('Nada para clipar agora. Abra uma transmissão (ou transmita) e espere uns segundos.', 'error');
  }
  clipState.saving = true;
  try {
    const { bytes, seconds, audio } = ClipMp4.buildMp4(src.buffer.take(clipSeconds()), src, Mp4Muxer, src.audio);
    const res = await window.api.clipSave(bytes, clipLabel(id));
    if (!res.ok) return toast(res.error, 'error');
    toast(`Clipe salvo (${Math.round(seconds)} s${audio ? '' : ', sem som'}): ${res.name}`, 'info', { label: 'Mostrar na pasta', run: () => window.api.clipShow(res.id) });
  } catch (e) {
    console.warn('[clipe]', e);
    toast(`Não deu para montar o clipe: ${e.message}`, 'error');
  } finally {
    clipState.saving = false;
  }
}
