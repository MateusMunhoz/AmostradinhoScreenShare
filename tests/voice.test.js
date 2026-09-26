const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VoiceChat } = require('../voice');

function fixture(media) {
  const sent = [], errors = [];
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const peers = [];
  let token = 0;
  const v = new VoiceChat({ send: m => sent.push(m), changed() {}, error: e => errors.push(e),
    token: () => `token-${++token}`, media: media || { getUserMedia: async () => stream },
    makeAudio: () => ({ play: async () => {}, pause() { this.paused = true; } }),
    makePeer: () => {
      const p = { candidates: [], addTrack() {}, close() { this.closed = true; },
        createOffer: async () => ({ type: 'offer', sdp: 'offer' }),
        createAnswer: async () => ({ type: 'answer', sdp: 'answer' }),
        async setLocalDescription(d) { this.localDescription = d; },
        async setRemoteDescription(d) { this.remoteDescription = d; },
        async addIceCandidate(c) { assert.ok(this.remoteDescription); this.candidates.push(c); } };
      peers.push(p); return p;
    } });
  v.reset({ id: '2', features: ['voice'], members: [] });
  return { v, track, stream, sent, errors, peers };
}

test('microfone só liga ao entrar; mute, saída e limpeza são independentes', async () => {
  const f = fixture();
  assert.equal(f.v.stream, null);
  await f.v.join();
  f.v.update('3', 'remote', false);
  const p = f.v.peers.get('3');
  await p.chain;
  assert.equal(f.sent.filter(m => m.data?.sdp).length, 1);
  f.v.mute(); assert.equal(f.track.enabled, false);
  f.v.deafen(); assert.equal(p.audio.muted, true); assert.equal(f.track.enabled, false);
  f.v.mute(); assert.equal(f.track.enabled, true); assert.equal(p.audio.muted, true);
  f.v.leave();
  assert.ok(f.track.stopped); assert.ok(p.pc.closed); assert.ok(p.audio.paused);
  assert.equal(p.audio.srcObject, null); assert.equal(f.v.peers.size, 0);
  assert.equal(f.sent.at(-1).session, '');
});

test('sair enquanto a permissão está pendente descarta a captura tardia', async () => {
  let resolve;
  const f = fixture({ getUserMedia: () => new Promise(r => { resolve = r; }) });
  const pending = f.v.join();
  f.v.reset(null);
  resolve(f.stream);
  await pending;
  assert.ok(f.track.stopped); assert.equal(f.v.session, ''); assert.equal(f.sent.length, 0);
});

test('negação de permissão e salas antigas não deixam o microfone ativo', async () => {
  const f = fixture({ getUserMedia: async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); } });
  await f.v.join();
  assert.equal(f.v.pending, false); assert.equal(f.v.session, ''); assert.match(f.errors[0], /Permita/);
  f.v.reset({ id: '2', features: ['chat'] });
  await f.v.join(); assert.equal(f.errors.length, 1);
});

test('ICE anterior à oferta é enfileirado; sessões antigas são ignoradas', async () => {
  const f = fixture(); await f.v.join(); f.v.update('1', 'remote', false);
  const base = { session: 'remote', targetSession: f.v.session, call: 'call1' };
  f.v.receive('1', { ...base, candidate: { candidate: 'ice' } });
  const p = f.v.peers.get('1'); await p.chain;
  assert.equal(p.pc.candidates.length, 0);
  f.v.receive('1', { ...base, sdp: { type: 'offer', sdp: 'offer' } }); await p.chain;
  assert.equal(p.pc.candidates.length, 1);
  assert.equal(f.sent.at(-1).data.sdp.type, 'answer');
  f.v.update('1', 'new-session', false);
  assert.ok(p.pc.closed);
  f.v.receive('1', { ...base, sdp: { type: 'offer' } });
  assert.equal(f.v.peers.size, 0);
  f.v.leave();
});

test('desconectar microfone encerra a chamada e notifica a sala', async () => {
  const f = fixture(); await f.v.join(); f.track.onended();
  assert.equal(f.v.session, ''); assert.equal(f.sent.at(-1).session, '');
  assert.match(f.errors[0], /desconectado/);
});
