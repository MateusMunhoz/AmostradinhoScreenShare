// Contador da call: tempo do canal de voz a partir da idade que o host manda (voice.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VoiceChat, formatarTempoCall } = require('../voice');

const voz = () => new VoiceChat({ send() {}, changed() {}, error() {}, media: {}, makePeer: () => ({}), makeAudio: () => ({}) });

test('formatarTempoCall: mm:ss e h:mm:ss', () => {
  assert.equal(formatarTempoCall(0), '00:00');
  assert.equal(formatarTempoCall(59_999), '00:59');
  assert.equal(formatarTempoCall(61_000), '01:01');
  assert.equal(formatarTempoCall(3_600_000), '1:00:00');
  assert.equal(formatarTempoCall(3_723_000), '1:02:03');
  assert.equal(formatarTempoCall(-5), '00:00');
});

test('tempoDoCanal: vale a pessoa mais antiga do canal e some com o canal vazio', () => {
  const v = voz();
  const agora = Date.now();
  v.id = 'eu';
  assert.equal(v.tempoDoCanal(''), null, 'canal vazio não tem contador');
  v.update('a', 's-a', false, false, '', 120_000);
  v.update('b', 's-b', false, false, '', 30_000);
  v.update('c', 's-c', false, false, '7', 500_000);
  const t = v.tempoDoCanal('');
  assert.ok(t >= 119_000 && t <= 121_000 + (Date.now() - agora), `esperava ~120 s, veio ${t}`);
  const t7 = v.tempoDoCanal('7');
  assert.ok(t7 >= 499_000 && t7 < 502_000);
  v.update('a', '', false, false, '', 0);
  const depois = v.tempoDoCanal('');
  assert.ok(depois >= 29_000 && depois < 33_000, 'quem saiu deixa de contar');
});

test('tempoDoCanal: servidor antigo (sem idade) não mostra contador', () => {
  const v = voz();
  v.update('a', 's-a', false, false, '');
  assert.equal(v.tempoDoCanal(''), null);
});

test('idade absurda vinda da rede não vira contador (teto de 7 dias)', () => {
  const v = voz();
  v.update('a', 's-a', false, false, '', 1e300);
  assert.equal(v.tempoDoCanal(''), null);
  v.update('b', 's-b', false, false, '', 8 * 86_400_000);
  assert.equal(v.tempoDoCanal(''), null);
  v.update('c', 's-c', false, false, '', 6 * 86_400_000);
  assert.ok(v.tempoDoCanal('') >= 6 * 86_400_000);
});

test('sozinho no canal: a sua idade vinda do host redesenha a lista', () => {
  let redesenhos = 0;
  const v = new VoiceChat({ send() {}, changed() { redesenhos++; }, error() {}, media: {}, makePeer: () => ({}), makeAudio: () => ({}) });
  v.id = 'eu';
  v.session = 's-eu';
  v.channel = '';
  v.sync = () => {};
  assert.equal(v.tempoDoCanal(''), null);
  v.update('eu', 's-eu', false, false, '', 0);
  assert.equal(redesenhos, 1, 'sem redesenhar, o contador não aparece');
  assert.ok(v.tempoDoCanal('') < 1_000);
  v.update('eu', 's-eu', true, false, '', 5_000);
  assert.equal(redesenhos, 1, 'o relógio de 1 s já atualiza o número');
});
