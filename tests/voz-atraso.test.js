// Atraso da voz entre duas pessoas (voice.js): a medida do buffer de recepção e a conexão refeita quando ele fica alto.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VoiceChat, medidaDaVoz, ATRASO_MAX_MS } = require('../voice');

const relatorio = ({ delay, emitted, lost = 0, recv = 1000, rtt = 0.04, relay = false }) => new Map([
  ['IT', { id: 'IT', type: 'inbound-rtp', kind: 'audio', jitterBufferDelay: delay, jitterBufferEmittedCount: emitted, packetsLost: lost, packetsReceived: recv }],
  ['T', { id: 'T', type: 'transport', selectedCandidatePairId: 'CP' }],
  ['CP', { id: 'CP', type: 'candidate-pair', currentRoundTripTime: rtt, localCandidateId: 'L' }],
  ['L', { id: 'L', type: 'local-candidate', candidateType: relay ? 'relay' : 'host' }],
]);

test('medidaDaVoz: média das últimas medidas, metade da ida e volta, perda e TURN', () => {
  const a = medidaDaVoz(relatorio({ delay: 10, emitted: 100000 }));
  assert.equal(a.atraso, null, 'a primeira medida só guarda os contadores');
  const b = medidaDaVoz(relatorio({ delay: 10 + 96000 * 0.08, emitted: 100000 + 96000, lost: 5, recv: 1095, rtt: 0.06, relay: true }), a.base);
  assert.deepEqual(b.atraso, { ms: 110, buffer: 80, rtt: 60, perda: 5, relay: true });
  assert.equal(medidaDaVoz(new Map()).atraso, null, 'sem áudio chegando, sem medida');
});

function sala(id, outro) {
  const enviados = [];
  const peers = [];
  let stats = relatorio({ delay: 0, emitted: 0 });
  const v = new VoiceChat({ send: (m) => enviados.push(m), changed() {}, error() {}, medirMs: 0,
    media: { getUserMedia: async () => ({ getAudioTracks: () => [], getTracks: () => [] }) },
    makePeer: () => { const pc = { connectionState: 'connected', addTrack() {}, close() {}, getStats: async () => stats,
      createOffer: async () => ({ type: 'offer', sdp: 'x' }), createAnswer: async () => ({ type: 'answer', sdp: 'x' }), setLocalDescription: async () => {}, setRemoteDescription: async function () { this.remoteDescription = {}; }, addIceCandidate: async () => {}, localDescription: { type: 'offer', sdp: 'x' } }; peers.push(pc); return pc; },
    makeAudio: () => ({ pause() {}, play: async () => {} }) });
  v.reset({ id, features: ['voice'], members: [{ id: outro, voiceSession: 's-' + outro }] });
  return { v, enviados, peers, setStats: (s) => { stats = s; } };
}

test('buffer alto em 3 medidas seguidas: quem iniciou refaz a conexão, uma vez por minuto', async () => {
  const { v, peers, setStats } = sala('1', '2');
  await v.join();
  v.update('1', v.session, false, false, '', 0);
  v.sync();
  assert.equal(peers.length, 1);
  const alto = (n) => relatorio({ delay: n * 0.5 * 48000, emitted: n * 48000 }); // 500 ms por amostra
  setStats(alto(1)); await v.medir();
  for (let n = 2; n <= 3; n++) { setStats(alto(n)); await v.medir(); }
  assert.ok(v.peers.get('2').atraso.buffer > ATRASO_MAX_MS);
  assert.equal(peers.length, 1, 'duas medidas altas ainda não bastam');
  setStats(alto(4)); await v.medir();
  assert.ok(v.peers.get('2').atraso === undefined, 'a conexão nova começa sem medida');
  assert.equal(peers.length, 2, 'a conexão foi refeita');
  for (let n = 5; n <= 9; n++) { setStats(alto(n)); await v.medir(); }
  assert.equal(peers.length, 2, 'não refaz de novo antes de um minuto');
  v.leave(false);
});

test('quem não iniciou pede para refazer pelo sinal; o pedido de quem não pode é ignorado', async () => {
  const { v, enviados, setStats } = sala('5', '2');
  await v.join();
  // 2 < 5: quem inicia é o 2. Chega a oferta dele e a conexão existe deste lado
  v.receive('2', { session: 's-2', targetSession: v.session, call: 'c1', sdp: { type: 'offer', sdp: 'x' } });
  const p = v.peers.get('2');
  assert.ok(p);
  const alto = (n) => relatorio({ delay: n * 0.4 * 48000, emitted: n * 48000 });
  for (let n = 1; n <= 4; n++) { setStats(alto(n)); await v.medir(); }
  const pedido = enviados.find((m) => m.type === 'signal' && m.data?.refazer === true);
  assert.ok(pedido, 'mandou o pedido');
  assert.equal(pedido.to, '2');
  assert.equal(v.peers.get('2'), p, 'não derruba a conexão sozinho');
  v.receive('2', { session: 's-2', targetSession: v.session, call: 'c1', refazer: true });
  assert.equal(v.peers.get('2'), p, 'o 2 (quem inicia) pedindo ao 5 não faz nada');
  v.leave(false);
});
