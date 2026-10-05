'use strict';
// Porta do microfone (sensibilidade): estimativa do ruído de fundo e a decisão aberto/fechado. Modelo puro,
// sem Web Audio: recebe os volumes medidos (dB) e o relógio (ms). Usado por renderer/microfone.js e pelos testes.
const MicGate = (() => {
  const TICK_MS = 20;          // uma medição a cada 20 ms (o setInterval do microfone.js)
  const WINDOW = 200;          // ~4 s de medições para o percentil: cobre as pausas de uma frase
  const PERCENTILE = 0.1;      // percentil 10: as pausas definem o ruído, a voz não o puxa para cima
  const CALIBRATE_MS = 500;    // começo: o ruído é o volume mais baixo desse período
  const MARGIN_DB = 12;        // limite = ruído + 12 dB (o mesmo de antes)
  const STEADY_N = 150;        // ~3 s acima do limite...
  const STEADY_STD_DB = 2;     // ...com desvio padrão menor que 2 dB = barulho constante (voz varia muito mais)
  const SILENT_DB = -95;       // abaixo disso é silêncio digital (o microfone ainda abrindo): não é ruído
  const HYSTERESIS_DB = 3;     // abre no limite, só fecha 3 dB abaixo dele
  const HOLD_MS = 300;         // espera antes de fechar (não corta o fim das palavras)
  const VAD_MIN = 0.5;         // com a IA: só abre no limite se a chance de voz do RNNoise passar de 50%...
  const VAD_SURE = 0.9;        // ...e com chance acima de 90% abre até 6 dB abaixo dele (não corta a 1ª sílaba)
  const VAD_EARLY_DB = 6;
  const MIN_DB = -72, MIN_IA_DB = -60, MAX_DB = -30;

  // Ruído de fundo de um sinal. start: o último ruído conhecido deste microfone (ou -70)
  function createFloor(start = -70) {
    return { buf: new Float64Array(WINDOW), n: 0, i: 0, recent: new Float64Array(STEADY_N), ri: 0, rn: 0,
      above: 0, t: 0, min: Infinity, floor: start };
  }
  function push(f, db) {
    f.buf[f.i] = db;
    f.i = (f.i + 1) % WINDOW;
    if (f.n < WINDOW) f.n++;
  }
  // Ordenar 200 números a cada 20 ms é barato; só ordena quando a janela mudou
  function percentile(f) {
    const s = f.buf.slice(0, f.n).sort();
    return s[Math.floor(PERCENTILE * (f.n - 1))];
  }
  function updateFloor(f, db) {
    if (!Number.isFinite(db) || db < SILENT_DB) return f.floor;
    f.t += TICK_MS;
    f.recent[f.ri] = db;
    f.ri = (f.ri + 1) % STEADY_N;
    if (f.rn < STEADY_N) f.rn++;
    if (f.t <= CALIBRATE_MS) {
      f.min = Math.min(f.min, db);
      push(f, db);
      f.floor = f.min;
      return f.floor;
    }
    if (db < f.floor + MARGIN_DB) {
      // Abaixo do limite: é ruído (ou pausa da fala), entra na janela
      f.above = 0;
      push(f, db);
      f.floor = percentile(f);
      return f.floor;
    }
    // Acima do limite: voz não entra (senão o limite sobe até ela). Mas se ficou ~3 s quase reto, é barulho
    // novo (ventilador): o ruído vira ele de uma vez
    f.above++;
    if (f.above >= STEADY_N && f.rn >= STEADY_N) {
      let sum = 0, sq = 0;
      for (const x of f.recent) { sum += x; sq += x * x; }
      const mean = sum / STEADY_N;
      if (Math.sqrt(Math.max(0, sq / STEADY_N - mean * mean)) < STEADY_STD_DB) {
        f.buf.set(f.recent);
        f.n = Math.min(WINDOW, STEADY_N);
        f.i = f.n % WINDOW;
        f.floor = percentile(f);
        f.above = 0;
      }
    }
    return f.floor;
  }

  // Limite da porta. Com a IA, o som que sai dela quase não tem ruído: o mínimo sobe para -60 dB
  function threshold({ auto, manualDb, ns, floor }) {
    if (!auto) return manualDb;
    return Math.max(ns === 'ia' ? MIN_IA_DB : MIN_DB, Math.min(MAX_DB, floor + MARGIN_DB));
  }

  // Decisão aberto/fechado com histerese e espera. g: { open, holdUntil }. vad: chance de voz do RNNoise
  // (0 a 1) ou null sem IA. Aberto, continua com o volume até 3 dB abaixo do limite, com ou sem voz: o fim das
  // palavras tem pouca chance de voz e não pode ser cortado. Devolve se mudou.
  function createGate() { return { open: false, holdUntil: 0 }; }
  function decide(g, db, th, now, vad = null) {
    const trigger = vad == null ? db > th
      : (db > th && vad >= VAD_MIN) || (vad >= VAD_SURE && db > th - VAD_EARLY_DB);
    if (trigger || (g.open && db > th - HYSTERESIS_DB)) g.holdUntil = now + HOLD_MS;
    const want = trigger || now < g.holdUntil;
    const changed = want !== g.open;
    g.open = want;
    return changed;
  }

  return { TICK_MS, WINDOW, PERCENTILE, CALIBRATE_MS, MARGIN_DB, STEADY_N, STEADY_STD_DB, HYSTERESIS_DB, HOLD_MS,
    VAD_MIN, VAD_SURE, VAD_EARLY_DB,
    createFloor, updateFloor, threshold, createGate, decide };
})();
if (typeof module !== 'undefined') module.exports = MicGate;
