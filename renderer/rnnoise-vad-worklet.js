'use strict';
// Chance de voz (VAD) do RNNoise, sem mexer em vendor/. Roda no AudioWorklet e é carregado ANTES de
// vendor/noise/rnnoiseWorklet.js. A biblioteca joga fora o que rnnoise_process_frame devolve (a chance de voz,
// 0 a 1); aqui o wasm é embrulhado para guardar esse valor, e um processador "#vad" (igual ao da biblioteca)
// manda a média pelo port a cada ~21 ms. Se algo mudar na biblioteca, o "#vad" não é registrado e o
// microfone.js usa o processador normal, sem VAD.
let vadSum = 0;
let vadN = 0;

const instantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async function (...args) {
  const res = await instantiate.apply(this, args);
  const instance = res instanceof WebAssembly.Instance ? res : res.instance;
  const fn = instance?.exports?.rnnoise_process_frame;
  if (typeof fn !== 'function') return res;
  const exports = { ...instance.exports, rnnoise_process_frame(...a) {
    const v = fn(...a);
    if (Number.isFinite(v)) { vadSum += v; vadN++; }
    return v;
  } };
  return res === instance ? { exports } : { module: res.module, instance: { exports } };
};

const register = registerProcessor;
globalThis.registerProcessor = (name, Cls) => {
  register(name, Cls);
  if (name !== '@sapphi-red/web-noise-suppressor/rnnoise') return;
  register(`${name}#vad`, class extends Cls {
    constructor(opts) { super(opts); this.vadTick = 0; }
    process(inputs, outputs, params) {
      const keep = super.process(inputs, outputs, params);
      // 128 amostras a 48 kHz = 2,7 ms por chamada; 8 chamadas ≈ uma medição da porta (20 ms)
      if (++this.vadTick >= 8 && vadN) {
        this.port.postMessage({ vad: vadSum / vadN });
        vadSum = 0;
        vadN = 0;
        this.vadTick = 0;
      }
      return keep;
    }
  });
};
