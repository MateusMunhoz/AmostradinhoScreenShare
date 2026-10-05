'use strict';
const test = require('node:test');
const assert = require('node:assert');
const MicGate = require('../renderer/porta-microfone');

// Gerador fixo (os testes não podem variar de uma rodada para outra)
function rng(seed = 1) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
// Roda uma sequência de volumes (um por medição de 20 ms) e devolve o que aconteceu em cada uma
function run(levels, { ns = 'off', auto = true, manualDb = -50, start } = {}) {
  const f = MicGate.createFloor(start);
  const g = MicGate.createGate();
  const out = [];
  levels.forEach((db, i) => {
    const now = i * MicGate.TICK_MS;
    MicGate.updateFloor(f, db);
    const th = MicGate.threshold({ auto, manualDb, ns, floor: f.floor });
    MicGate.decide(g, db, th, now);
    out.push({ db, th, floor: f.floor, open: g.open, now });
  });
  return out;
}
const ticks = (ms) => Math.round(ms / MicGate.TICK_MS);
const fill = (ms, fn) => Array.from({ length: ticks(ms) }, fn);

test('silêncio e depois fala com pausas: abre na fala e fecha nas pausas longas', () => {
  const r = rng(2);
  const levels = [...fill(2000, () => -70 + r())];
  for (let k = 0; k < 4; k++) levels.push(...fill(1000, () => -30 + r() * 10), ...fill(1000, () => -70 + r()));
  const out = run(levels);
  assert.ok(out.slice(0, ticks(2000)).every((o) => !o.open), 'fechado no silêncio');
  for (let k = 0; k < 4; k++) {
    const s = ticks(2000) + k * ticks(2000);
    assert.ok(out.slice(s, s + ticks(1000)).every((o) => o.open), `aberto na fala ${k}`);
    // pausa de 1 s: passa a espera de 300 ms e fecha
    assert.ok(out.slice(s + ticks(1400), s + ticks(2000)).every((o) => !o.open), `fechado na pausa ${k}`);
  }
});

test('fala contínua por 15 s: o limite não passa de 6 dB acima do ruído inicial', () => {
  const r = rng(3);
  const out = run([...fill(1000, () => -70 + r()), ...fill(15000, () => -30 + r() * 10)]);
  const start = out[ticks(1000) - 1].floor;
  const maxTh = Math.max(...out.slice(ticks(1000)).map((o) => o.th));
  assert.ok(maxTh <= start + MicGate.MARGIN_DB + 6, `limite ${maxTh} com ruído inicial ${start}`);
  assert.ok(out.slice(ticks(1000)).every((o) => o.open), 'não corta a fala');
});

test('ventilador que liga: em até ~4 s o microfone volta a fechar', () => {
  const r = rng(4);
  const out = run([...fill(2000, () => -70 + r()), ...fill(8000, () => -45 + r() - 0.5)]);
  const after = out.slice(ticks(2000));
  assert.ok(after[5].open, 'abre quando o barulho começa');
  assert.ok(after.slice(ticks(4000)).every((o) => !o.open), 'fecha depois de ~4 s e fica fechado');
  assert.ok(Math.abs(after.at(-1).floor + 45) < 1.5, `o ruído vira o ventilador (${after.at(-1).floor})`);
});

test('volume oscilando 1 dB em cima do limite: não fica abrindo e fechando (histerese)', () => {
  const levels = fill(4000, (_, i) => (i % 2 ? -49 : -51));
  const out = run(levels, { auto: false, manualDb: -50 });
  let changes = 0;
  for (let i = 1; i < out.length; i++) if (out[i].open !== out[i - 1].open) changes++;
  assert.ok(changes <= 1, `${changes} trocas`);
  // também no automático, com o ruído já medido
  const r = rng(5);
  const auto = run([...fill(1000, () => -62 + r() * 0.5), ...fill(4000, (_, i) => (i % 2 ? -49 : -51))]);
  let c2 = 0;
  for (let i = ticks(1000) + 1; i < auto.length; i++) if (auto[i].open !== auto[i - 1].open) c2++;
  assert.ok(c2 <= 2, `${c2} trocas no automático`);
});

test('começo com ruído de -55 dB: o limite fica certo em até 500 ms', () => {
  const r = rng(6);
  const out = run(fill(1000, () => -55 + r()));
  const at = out[ticks(500) - 1];
  assert.ok(Math.abs(at.floor + 55) < 1, `ruído ${at.floor}`);
  assert.ok(Math.abs(at.th - (-43)) < 1.5, `limite ${at.th}`);
  assert.ok(out.slice(ticks(800)).every((o) => !o.open), 'o próprio ruído não abre o microfone');
});

test('começa do último ruído guardado e ignora o silêncio digital do microfone abrindo', () => {
  const f = MicGate.createFloor(-58);
  assert.strictEqual(f.floor, -58);
  MicGate.updateFloor(f, -140);
  assert.strictEqual(f.floor, -58);
});

test('IA ligada: o limite mínimo sobe para -60 dB; manual não muda', () => {
  assert.strictEqual(MicGate.threshold({ auto: true, ns: 'ia', floor: -90 }), -60);
  assert.strictEqual(MicGate.threshold({ auto: true, ns: 'off', floor: -90 }), -72);
  assert.strictEqual(MicGate.threshold({ auto: true, ns: 'off', floor: -10 }), -30);
  assert.strictEqual(MicGate.threshold({ auto: false, manualDb: -66, ns: 'ia', floor: -90 }), -66);
});

test('VAD do RNNoise: barulho acima do limite sem voz não abre; voz certa abre um pouco antes do limite', () => {
  const g = MicGate.createGate();
  MicGate.decide(g, -40, -50, 0, 0.1);
  assert.strictEqual(g.open, false, 'estalo alto sem voz');
  MicGate.decide(g, -54, -50, 20, 0.95);
  assert.strictEqual(g.open, true, 'voz certa 4 dB abaixo do limite');
  // aberto: o fim da palavra (pouca chance de voz) segura até 3 dB abaixo do limite
  MicGate.decide(g, -52, -50, 400, 0.05);
  assert.strictEqual(g.open, true);
  MicGate.decide(g, -70, -50, 600, 0.05);
  MicGate.decide(g, -70, -50, 800, 0.05);
  assert.strictEqual(g.open, false, 'fecha depois da espera');
  const h = MicGate.createGate();
  MicGate.decide(h, -58, -50, 0, 0.95);
  assert.strictEqual(h.open, false, 'nem com voz certa abre mais de 6 dB abaixo');
  MicGate.decide(h, -45, -50, 20, 0.6);
  assert.strictEqual(h.open, true);
});
