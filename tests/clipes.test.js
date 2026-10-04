// Clipes: a conversão Annex B -> MP4 (renderer/clipe-mp4.js) e a gravação na pasta (main/clipes.js), sem o Electron.
// O teste com vídeo de verdade (WebCodecs) é tests/e2e/clipe.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ClipMp4 = require('../renderer/clipe-mp4');
const Mp4Muxer = require('../vendor/mp4-muxer/mp4-muxer');
const { createClipStore, cleanName } = require('../main/clipes');

const SPS = [0x67, 0x64, 0x00, 0x2a, 0xac, 0x2b];
const PPS = [0x68, 0xee, 0x3c, 0x80];
const annexb = (...nals) => new Uint8Array(nals.flatMap((n, i) => [...(i % 2 ? [0, 0, 1] : [0, 0, 0, 1]), ...n]));
// Dentro de uma unidade nunca aparece 00 00 01 (o codificador põe o 03 de proteção): 00 00 03 01 é válido
const keyFrame = (extra = 1) => annexb([0x09, 0xf0], SPS, PPS, [0x65, 0x88, 0, 0, 3, 1, extra | 1]);
const delta = (b = 7) => annexb([0x41, 0x9a, b | 1]);

test('Annex B: separa as unidades, com códigos de 3 e 4 bytes', () => {
  const nals = ClipMp4.splitNals(keyFrame());
  assert.deepEqual(nals.map((u) => u[0] & 0x1f), [9, 7, 8, 5]);
  assert.deepEqual([...nals[1]], SPS);
  assert.deepEqual([...nals[3]], [0x65, 0x88, 0, 0, 3, 1, 1], 'zeros no meio da unidade continuam');
});

test('AVCC: tamanho de 4 bytes por unidade, sem SPS/PPS/AUD na amostra', () => {
  const { data, sps, pps } = ClipMp4.toAvcc(keyFrame());
  assert.deepEqual([...sps], SPS);
  assert.deepEqual([...pps], PPS);
  assert.deepEqual([...data], [0, 0, 0, 7, 0x65, 0x88, 0, 0, 3, 1, 1]);
  const rec = ClipMp4.avcC(sps, pps);
  assert.deepEqual([...rec.subarray(0, 8)], [1, 0x64, 0x00, 0x2a, 0xff, 0xe1, 0, SPS.length]);
  assert.deepEqual([...rec.subarray(-4)], [0xfd, 0xf8, 0xf8, 0], 'perfil High leva o croma no fim');
  assert.equal(ClipMp4.codecString(sps), 'avc1.64002a');
});

test('Buffer: começa num quadro-chave e guarda a janela inteira mais o quadro-chave antes dela', () => {
  const b = new ClipMp4.ClipBuffer({ seconds: 10 });
  assert.equal(b.push({ key: false, ts: 0, data: delta() }), false, 'sem quadro-chave não começa');
  // 30 s a 10 quadros/s, quadro-chave a cada 4 s
  for (let i = 0; i < 300; i++) b.push({ key: i % 40 === 0, ts: i * 1e5, data: i % 40 === 0 ? keyFrame() : delta() });
  assert.ok(b.frames[0].key);
  assert.equal(b.frames[0].ts, 16e6, 'quadro-chave de 16 s: o último antes de 29,9 - 10 s');
  assert.ok(b.duration() >= 10 && b.duration() < 14);
  const clip = b.take(5);
  assert.equal(clip[0].ts, 24e6);
  assert.ok(b.sinceKey() < 4);
});

test('Buffer: tempo voltando, SPS novo e pedaço perdido', () => {
  const b = new ClipMp4.ClipBuffer({ seconds: 10 });
  b.push({ key: true, ts: 1e6, data: keyFrame() });
  b.push({ key: false, ts: 1.1e6, data: delta() });
  b.push({ key: true, ts: 0.5e6, data: keyFrame() });
  assert.equal(b.frames.length, 1, 'tempo voltou (outro motor): recomeça');
  b.gap();
  assert.equal(b.push({ key: false, ts: 0.6e6, data: delta() }), false, 'depois de perder um pedaço, espera o quadro-chave');
  assert.equal(b.push({ key: true, ts: 0.7e6, data: keyFrame() }), true);
  const other = annexb([0x67, 0x42, 0x00, 0x1f, 0x99], PPS, [0x65, 1]);
  b.push({ key: true, ts: 0.8e6, data: other });
  assert.equal(b.frames.length, 1, 'resolução nova (SPS diferente): recomeça');
});

test('MP4: ftyp, moov e mdat; duração pelos tempos dos quadros', () => {
  const frames = [];
  for (let i = 0; i < 90; i++) frames.push({ key: i % 30 === 0, ts: 5e6 + i * 33333, data: i % 30 === 0 ? keyFrame(i) : delta(i) });
  const { bytes, seconds } = ClipMp4.buildMp4(frames, { width: 1280, height: 720 }, Mp4Muxer);
  const boxes = [];
  for (let o = 0; o < bytes.length;) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + o).getUint32(0);
    boxes.push(String.fromCharCode(...bytes.subarray(o + 4, o + 8)));
    o += size;
  }
  assert.deepEqual(boxes, ['ftyp', 'moov', 'mdat']);
  assert.ok(Math.abs(seconds - 3) < 0.01);
  assert.throws(() => ClipMp4.buildMp4(frames.slice(1), { width: 1, height: 1 }, Mp4Muxer), /quadro-chave/);
});

test('Gravar: nome limpo, sem sobrescrever, e "mostrar" só para clipes deste app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipes-'));
  const shown = [];
  const store = createClipStore({ dir: path.join(dir, 'Clipes'), showItem: (f) => shown.push(f) });
  assert.equal(cleanName('Clipe - A/n:a* - 2026'), 'Clipe - Ana - 2026');
  assert.equal(cleanName('..\\..\\x. '), '....x');
  assert.equal(cleanName(''), 'Clipe');
  const a = await store.save(new Uint8Array(100), 'Clipe - Ana');
  const b = await store.save(new Uint8Array(100), 'Clipe - Ana');
  assert.equal(a.name, 'Clipe - Ana.mp4');
  assert.equal(b.name, 'Clipe - Ana (2).mp4');
  assert.equal(fs.readdirSync(path.join(dir, 'Clipes')).length, 2);
  assert.equal(store.show(a.id), true);
  assert.equal(store.show(999), false);
  assert.equal(shown.length, 1);
  assert.equal((await store.save('texto', 'x')).ok, false);
  assert.equal((await store.save(new Uint8Array(2), 'x')).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
