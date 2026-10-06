'use strict';
// Clipes: a parte pura, sem DOM, usada pelo renderer/clipes.js e pelos testes.
// - ClipBuffer guarda os últimos segundos dos pedaços H.264 (Annex B) do modo "uma vez só", começando sempre num
//   quadro-chave (sem ele, nenhum player abre o arquivo).
// - buildMp4 junta esses pedaços num MP4 sem recodificar: troca os códigos de início do Annex B pelo tamanho de cada
//   unidade (formato AVCC do MP4) e monta o avcC com o SPS e o PPS do quadro-chave. Usa o mp4-muxer (vendor/).
const ClipMp4 = (() => {
  const NAL_SPS = 7, NAL_PPS = 8, NAL_AUD = 9;

  // Unidades NAL de um pedaço Annex B (separadas por 00 00 01 ou 00 00 00 01), sem os códigos de início
  function splitNals(bytes) {
    const out = [];
    let start = -1;
    let i = 0;
    const n = bytes.length;
    while (i + 2 < n) {
      if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
        if (start >= 0) out.push(trimZeros(bytes, start, i));
        i += 3;
        start = i;
      } else i++;
    }
    if (start >= 0 && start < n) out.push(bytes.subarray(start, n));
    return out.filter((u) => u.length > 0);
  }
  // O zero a mais do código de 4 bytes fica no fim da unidade anterior: tira
  function trimZeros(bytes, start, end) {
    while (end > start && bytes[end - 1] === 0) end--;
    return bytes.subarray(start, end);
  }

  // Um pedaço Annex B -> amostra AVCC (tamanho de 4 bytes + unidade), sem SPS, PPS e delimitadores (vão no avcC)
  function toAvcc(bytes) {
    const nals = splitNals(bytes);
    let sps = null, pps = null;
    const keep = [];
    for (const u of nals) {
      const type = u[0] & 0x1f;
      if (type === NAL_SPS) sps = sps || u;
      else if (type === NAL_PPS) pps = pps || u;
      else if (type !== NAL_AUD) keep.push(u);
    }
    const size = keep.reduce((s, u) => s + 4 + u.length, 0);
    const data = new Uint8Array(size);
    let o = 0;
    for (const u of keep) {
      data[o] = u.length >>> 24; data[o + 1] = (u.length >>> 16) & 255; data[o + 2] = (u.length >>> 8) & 255; data[o + 3] = u.length & 255;
      data.set(u, o + 4);
      o += 4 + u.length;
    }
    return { data, sps, pps };
  }

  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // AVCDecoderConfigurationRecord (ISO 14496-15). Os codificadores do app sempre dão 4:2:0 de 8 bits.
  function avcC(sps, pps) {
    const profile = sps[1];
    const high = [100, 110, 122, 244].includes(profile);
    const out = [1, profile, sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps];
    if (high) out.push(0xfd, 0xf8, 0xf8, 0); // chroma 4:2:0, 8 bits, sem SPS estendido
    return new Uint8Array(out);
  }

  // "avc1.64002a" a partir do SPS (perfil, restrições, nível)
  function codecString(sps) {
    return 'avc1.' + [sps[1], sps[2], sps[3]].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Últimos segundos de uma transmissão. Pedaços: { key, ts (µs, relógio de quem codificou), data (Uint8Array),
  // at (µs, relógio deste PC na chegada; opcional, serve para alinhar o som) }.
  // Guarda a janela inteira mais o quadro-chave anterior a ela; se o tempo voltar ou pular (troca de motor, de
  // resolução), recomeça. Limite de memória para não crescer sem fim se faltar quadro-chave.
  class ClipBuffer {
    constructor({ seconds = 30, maxBytes = 160 * 1024 * 1024 } = {}) {
      this.seconds = seconds;
      this.maxBytes = maxBytes;
      this.reset();
    }
    reset() {
      this.frames = [];
      this.bytes = 0;
      this.lastKeyTs = -Infinity;
      this.sps = null;
      this.broken = false;
    }
    // Faltou um pedaço: os próximos dependem dele, então espera o próximo quadro-chave
    gap() { this.broken = true; }
    push(frame) {
      const last = this.frames[this.frames.length - 1];
      if (last && (frame.ts <= last.ts || frame.ts - last.ts > 5e6)) this.reset();
      if (frame.key) {
        // SPS novo (mudou a resolução ou o codificador): o que veio antes não cabe no mesmo arquivo
        const sps = splitNals(frame.data).find((u) => (u[0] & 0x1f) === NAL_SPS);
        if (sps && this.sps && !sameBytes(sps, this.sps)) this.reset();
        if (sps) this.sps = sps.slice();
        this.broken = false;
      } else if (this.broken) return false;
      if (!this.frames.length && !frame.key) return false; // sem quadro-chave não dá para começar
      this.frames.push(frame);
      this.bytes += frame.data.length;
      if (frame.key) this.lastKeyTs = frame.ts;
      this.trim();
      return true;
    }
    // Tira do começo enquanto houver outro quadro-chave ainda antes do início da janela (ou passar do limite)
    trim() {
      const from = this.frames[this.frames.length - 1].ts - this.seconds * 1e6;
      for (;;) {
        const next = this.frames.findIndex((f, i) => i > 0 && f.key);
        if (next < 0) break;
        if (this.frames[next].ts > from && this.bytes <= this.maxBytes) break;
        for (const f of this.frames.splice(0, next)) this.bytes -= f.data.length;
      }
    }
    // Segundos já guardados (do primeiro quadro-chave ao último pedaço)
    duration() {
      return this.frames.length ? (this.frames[this.frames.length - 1].ts - this.frames[0].ts) / 1e6 : 0;
    }
    // Há quanto tempo (no relógio dos pedaços) não chega quadro-chave
    sinceKey() {
      const last = this.frames[this.frames.length - 1];
      return last ? (last.ts - this.lastKeyTs) / 1e6 : Infinity;
    }
    // Cópia do que vai para o arquivo: do último quadro-chave antes da janela pedida até o fim
    take(seconds = this.seconds) {
      if (!this.frames.length) return [];
      const from = this.frames[this.frames.length - 1].ts - seconds * 1e6;
      let start = 0;
      for (let i = 0; i < this.frames.length; i++) if (this.frames[i].key && this.frames[i].ts <= from) start = i;
      return this.frames.slice(start);
    }
  }

  // Som do clipe: pedaços já codificados (AAC ou Opus) com ts no relógio deste PC (µs). Guarda um pouco mais que a
  // janela do vídeo, porque o vídeo começa no quadro-chave anterior.
  class ClipAudioBuffer {
    constructor({ seconds = 30 } = {}) {
      this.seconds = seconds;
      this.chunks = [];
      this.config = null; // { codec: 'aac'|'opus', sampleRate, numberOfChannels, description }
    }
    push(chunk) {
      const last = this.chunks[this.chunks.length - 1];
      if (last && chunk.ts <= last.ts) this.chunks = [];
      this.chunks.push(chunk);
      const from = chunk.ts - (this.seconds + 12) * 1e6;
      let drop = 0;
      while (drop < this.chunks.length && this.chunks[drop].ts < from) drop++;
      if (drop) this.chunks.splice(0, drop);
    }
  }

  // Soma pedaços de som (já decodificados) numa faixa estéreo só. Pedaços: { ts (µs, relógio deste PC), sampleRate,
  // channels: [Float32Array, ...] } (mono vai para os dois lados; outra taxa é ajustada pelo ponto mais próximo).
  // Saída: [esquerda, direita] com `frames` pontos a partir de `from` (µs), limitada a -1..1.
  function mixPcm(parts, { from, sampleRate, frames }) {
    const out = [new Float32Array(frames), new Float32Array(frames)];
    for (const p of parts) {
      const start = Math.round(((p.ts - from) / 1e6) * sampleRate);
      const ratio = sampleRate / p.sampleRate;
      const n = p.channels[0]?.length || 0;
      const left = p.channels[0], right = p.channels[1] || left;
      for (let j = Math.max(0, start), end = Math.min(frames, start + Math.floor(n * ratio)); j < end; j++) {
        const k = Math.min(n - 1, Math.floor((j - start) / ratio));
        out[0][j] += left[k];
        out[1][j] += right[k];
      }
    }
    for (const ch of out) for (let j = 0; j < frames; j++) ch[j] = Math.max(-1, Math.min(1, ch[j]));
    return out;
  }

  // Diferença entre o relógio deste PC e o do vídeo: a menor (o quadro que chegou com menos atraso)
  function videoOffset(frames) {
    let best = Infinity;
    for (const f of frames) if (typeof f.at === 'number') best = Math.min(best, f.at - f.ts);
    return Number.isFinite(best) ? best : null;
  }

  // Pedaços (começando num quadro-chave) -> bytes do MP4. muxerLib = o mp4-muxer (global Mp4Muxer ou require).
  // audio (opcional): { config, chunks } do ClipAudioBuffer; entra alinhado pelo `at` dos quadros.
  function buildMp4(frames, { width, height }, muxerLib, audio = null) {
    if (!frames.length || !frames[0].key) throw new Error('O clipe precisa começar num quadro-chave.');
    const samples = frames.map((f) => ({ key: f.key, ts: f.ts, ...toAvcc(f.data) }));
    const first = samples[0];
    if (!first.sps || !first.pps) throw new Error('O quadro-chave veio sem SPS/PPS.');
    const { Muxer, ArrayBufferTarget } = muxerLib;
    const target = new ArrayBufferTarget();
    const t0 = first.ts;
    const gaps = samples.slice(1).map((s, i) => s.ts - samples[i].ts);
    const typical = gaps.length ? gaps.slice().sort((a, b) => a - b)[gaps.length >> 1] : 16667;
    const end = samples[samples.length - 1].ts - t0 + typical;
    // Som: só o que cai dentro do vídeo, já no tempo do vídeo (sem nenhum pedaço, o arquivo sai sem faixa de som)
    const offset = videoOffset(frames);
    const sound = audio?.config && offset !== null
      ? audio.chunks.map((c) => ({ ...c, t: c.ts - offset - t0 })).filter((c) => c.t >= 0 && c.t <= end) : [];
    const muxer = new Muxer({
      target, fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset', video: { codec: 'avc', width, height },
      ...(sound.length ? { audio: { codec: audio.config.codec, sampleRate: audio.config.sampleRate, numberOfChannels: audio.config.numberOfChannels } } : {}),
    });
    const meta = { decoderConfig: { codec: codecString(first.sps), codedWidth: width, codedHeight: height, description: avcC(first.sps, first.pps) } };
    samples.forEach((s, i) => {
      const duration = i + 1 < samples.length ? samples[i + 1].ts - s.ts : typical;
      muxer.addVideoChunkRaw(s.data, s.key ? 'key' : 'delta', s.ts - t0, duration, i === 0 ? meta : undefined);
    });
    if (sound.length) {
      const c = audio.config;
      const ameta = { decoderConfig: { codec: c.codec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate: c.sampleRate, numberOfChannels: c.numberOfChannels,
        ...(c.description ? { description: c.description } : {}) } };
      sound.forEach((a, i) => muxer.addAudioChunkRaw(a.data, 'key', a.t, a.duration, i === 0 ? ameta : undefined));
    }
    muxer.finalize();
    return { bytes: new Uint8Array(target.buffer), seconds: end / 1e6, audio: sound.length > 0 };
  }

  return { splitNals, toAvcc, avcC, codecString, ClipBuffer, ClipAudioBuffer, mixPcm, videoOffset, buildMp4 };
})();
if (typeof module !== 'undefined') module.exports = ClipMp4;
