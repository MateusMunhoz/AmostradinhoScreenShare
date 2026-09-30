const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { WebSocket } = require('ws');
const { startServer, stopServer } = require('../signaling');
const { createSubsalas } = require('../sala-protocolo');
const { VoiceChat } = require('../voice');

async function freePort() {
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  return port;
}
async function client(port, hello = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const send = msg => ws.send(JSON.stringify(msg));
  const wait = async predicate => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const i = messages.findIndex(predicate);
      if (i !== -1) return messages.splice(i, 1)[0];
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('Mensagem não recebida');
  };
  send({ type: 'hello', name: 'Teste', ...hello });
  const welcome = await wait(m => m.type === 'welcome');
  return { ws, send, wait, messages, welcome };
}

test('nomes sempre Subsala_N: o número seguinte ao maior; apagar a última libera o número', () => {
  const s = createSubsalas();
  assert.deepEqual([s.create(), s.create(), s.create()].map(x => x.name), ['Subsala_1', 'Subsala_2', 'Subsala_3']);
  assert.equal(s.remove('2'), true);
  assert.equal(s.create().name, 'Subsala_4'); // o buraco do 2 não é reaproveitado
  s.remove('4'); s.remove('3');
  assert.equal(s.create().name, 'Subsala_2');
  assert.equal(s.remove('99'), false);
  // Semente da troca de host: limpa, sem repetidos, em ordem, com o nome refeito pelo número
  assert.deepEqual(createSubsalas([{ id: '3', name: 'x' }, { id: '1' }, { id: '3' }, { id: 'a' }]).list,
    [{ id: '1', name: 'Subsala_1' }, { id: '3', name: 'Subsala_3' }]);
});

test('sala cria e apaga subsalas; canais diferentes não trocam sinal de voz; apagar devolve para a Voz geral', async t => {
  const port = await freePort();
  assert.equal((await startServer(port)).ok, true);
  t.after(stopServer);
  const a = await client(port); t.after(() => a.ws.terminate());
  const b = await client(port); t.after(() => b.ws.terminate());
  assert.ok(a.welcome.features.includes('subsalas'));
  assert.deepEqual(a.welcome.subsalas, []);
  a.send({ type: 'subsala-create' });
  assert.deepEqual((await b.wait(m => m.type === 'subsalas')).list, [{ id: '1', name: 'Subsala_1' }]);
  a.send({ type: 'voice-state', session: 'sa', channel: '1' });
  assert.equal((await b.wait(m => m.type === 'voice-state' && m.id === a.welcome.id)).channel, '1');
  b.send({ type: 'voice-state', session: 'sb', channel: '' });
  await a.wait(m => m.type === 'voice-state' && m.id === b.welcome.id);
  // Canal que não existe vira Voz geral
  b.send({ type: 'voice-state', session: 'sb', channel: '7' });
  assert.equal((await a.wait(m => m.type === 'voice-state' && m.id === b.welcome.id)).channel, '');
  const offer = { type: 'signal', to: b.welcome.id, data: { side: 'voice', session: 'sa', targetSession: 'sb', call: 'c', sdp: { type: 'offer' } } };
  a.send(offer);
  a.send({ type: 'chat', text: 'barreira' });
  await b.wait(m => m.type === 'chat');
  assert.equal(b.messages.some(m => m.type === 'signal'), false, 'Voz geral e Subsala_1 não se ouvem');
  b.send({ type: 'voice-state', session: 'sb', channel: '1' });
  await a.wait(m => m.type === 'voice-state' && m.id === b.welcome.id);
  a.send(offer);
  assert.equal((await b.wait(m => m.type === 'signal')).from, a.welcome.id, 'na mesma subsala, o sinal passa');
  // Quem entra depois recebe a lista e o canal de cada um
  const c = await client(port); t.after(() => c.ws.terminate());
  assert.deepEqual(c.welcome.subsalas, [{ id: '1', name: 'Subsala_1' }]);
  assert.equal(c.welcome.members.find(m => m.id === a.welcome.id).voiceChannel, '1');
  // Apagar: os dois voltam para a Voz geral, e todo mundo (inclusive eles) fica sabendo
  a.messages.length = 0; // só o que vem depois de apagar
  c.send({ type: 'subsala-delete', id: '1' });
  const moved = [await a.wait(m => m.type === 'voice-state' && m.id === a.welcome.id), await a.wait(m => m.type === 'voice-state' && m.id === b.welcome.id)];
  assert.deepEqual(moved.map(m => [m.channel, m.session]), [['', 'sa'], ['', 'sb']]);
  assert.deepEqual((await a.wait(m => m.type === 'subsalas')).list, []);
});

test('troca de host: o servidor novo continua com as subsalas e com o canal de quem volta', async t => {
  const port = await freePort();
  assert.equal((await startServer(port, '', { subsalas: [{ id: '2' }], hostId: '5', nextId: 6 })).ok, true);
  t.after(stopServer);
  const a = await client(port, { resume: '5', voiceSession: 'sa', voiceChannel: '2' }); t.after(() => a.ws.terminate());
  assert.deepEqual(a.welcome.subsalas, [{ id: '2', name: 'Subsala_2' }]);
  const b = await client(port); t.after(() => b.ws.terminate());
  assert.equal(b.welcome.members.find(m => m.id === '5').voiceChannel, '2');
});

function voiceFixture(id) {
  const sent = [];
  const track = { enabled: true, stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let n = 0;
  const v = new VoiceChat({ send: m => sent.push(m), changed() {}, error() {}, token: () => `t${++n}`,
    media: { getUserMedia: async () => stream },
    makeAudio: () => ({ play: async () => {}, pause() {} }),
    makePeer: () => ({ addTrack() {}, close() { this.closed = true; },
      createOffer: async () => ({ type: 'offer' }), createAnswer: async () => ({ type: 'answer' }),
      async setLocalDescription(d) { this.localDescription = d; }, async setRemoteDescription(d) { this.remoteDescription = d; },
      async addIceCandidate() {} }) });
  v.reset({ id, features: ['voice'], members: [] });
  return { v, sent };
}

test('VoiceChat só conecta com quem está no mesmo canal e troca de canal fechando as conexões', async () => {
  const { v, sent } = voiceFixture('1');
  await v.join('3');
  assert.equal(sent.at(-1).channel, '3');
  v.update('2', 's2', false, false, '');
  assert.equal(v.peers.has('2'), false, 'Voz geral não conecta com a Subsala_3');
  v.update('4', 's4', false, false, '3');
  assert.equal(v.peers.has('4'), true);
  // Sinal de quem está em outro canal é ignorado
  v.receive('2', { session: 's2', targetSession: v.session, call: 'x', sdp: { type: 'answer' } });
  assert.equal(v.peers.has('2'), false);
  // Trocar para a Voz geral: fecha a Subsala_3, avisa, e conecta com a Voz geral quando o servidor confirma
  v.setChannel('');
  assert.equal(v.peers.size, 0);
  assert.deepEqual([sent.at(-1).type, sent.at(-1).channel], ['voice-state', '']);
  v.update('1', v.session, false, false, '');
  assert.equal(v.peers.has('2'), true);
  assert.equal(v.peers.has('4'), false);
  // O servidor manda você de volta para a Voz geral (subsala apagada): segue sem avisar de novo
  v.setChannel('3'); v.update('1', v.session, false, false, '3');
  const before = sent.length;
  v.update('1', v.session, false, false, '');
  assert.equal(v.channel, '');
  assert.equal(sent.length, before);
  v.leave();
  assert.equal(v.channel, '');
});
