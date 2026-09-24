// Toca o PCM que chega do capturador nativo, com um buffer pequeno para absorver oscilações.
const START = 1920;   // 40 ms: começa a tocar quando tiver isso guardado
const MAX = 9600;     // 200 ms: se acumular mais que isso, descarta o excesso (evita atraso crescente)
const TARGET = 2880;  // 60 ms: nível para onde volta depois de descartar

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 48000; // 1 s de áudio estéreo
    this.data = new Float32Array(this.cap * 2);
    this.r = 0;
    this.w = 0;
    this.avail = 0;
    this.primed = false;
    this.port.onmessage = (e) => this.push(e.data);
  }

  // Recebe PCM 16 bits (Int16Array) e converte aqui, fora do thread da página
  push(i16) {
    const frames = i16.length >> 1;
    for (let i = 0; i < frames; i++) {
      this.data[this.w * 2] = i16[i * 2] / 32768;
      this.data[this.w * 2 + 1] = i16[i * 2 + 1] / 32768;
      this.w = (this.w + 1) % this.cap;
    }
    this.avail += frames;
    if (this.avail > MAX) {
      const drop = this.avail - TARGET;
      this.r = (this.r + drop) % this.cap;
      this.avail -= drop;
    }
  }

  process(_inputs, outputs) {
    const L = outputs[0][0];
    const R = outputs[0][1] || L;
    const n = L.length;
    if (!this.primed) {
      if (this.avail < START) return true; // silêncio enquanto enche o buffer
      this.primed = true;
    }
    if (this.avail < n) { this.primed = false; return true; }
    for (let i = 0; i < n; i++) {
      L[i] = this.data[this.r * 2];
      R[i] = this.data[this.r * 2 + 1];
      this.r = (this.r + 1) % this.cap;
    }
    this.avail -= n;
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
