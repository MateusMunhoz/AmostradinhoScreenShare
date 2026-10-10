// Modo Líder (docs/spec/modo-lider.md): a subsala Líder fala para a sala toda
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { WebSocket } = require('ws');
const { startServer, stopServer } = require('../signaling');
const { createSubsalas } = require('../sala-protocolo');
const { VoiceChat, LiderAudio } = require('../voice');

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

test('subsalas com modo: Líder só uma por sala; a semente da troca de host mantém o modo', () => {
  const s = createSubsalas();
  assert.deepEqual(s.create(), { id: '1', name: 'Subsala_1' });
  assert.deepEqual(s.create('lider'), { id: '2', name: 'Subsala_2', modo: 'lider' });
  assert.equal(s.lider(), '2');
  assert.equal(s.create('lider'), null, 'a segunda Líder é recusada');
  assert.equal(s.create('qualquer').modo, undefined, 'modo desconhecido vira Padrão');
  s.remove('2');
  assert.equal(s.lider(), '');
  assert.equal(s.create('lider').id, '4');
  // Semente: o modo segue; duas Líderes na semente, só a primeira continua Líder
  assert.deepEqual(createSubsalas([{ id: '3', modo: 'lider' }, { id: '1', modo: 'lider' }, { id: '2', modo: 'x' }]).list,
    [{ id: '1', name: 'Subsala_1' }, { id: '2', name: 'Subsala_2' }, { id: '3', name: 'Subsala_3', modo: 'lider' }]);
});

test('sala: cria a Líder, recusa a segunda e só passa o sinal da Líder de/para quem está nela', async t => {
  const port = await freePort();
  assert.equal((await startServer(port)).ok, true);
  t.after(stopServer);
  const a = await client(port); t.after(() => a.ws.terminate());
  const b = await client(port); t.after(() => b.ws.terminate());
  const c = await client(port); t.after(() => c.ws.terminate());
  assert.ok(a.welcome.features.includes('lider'));
  const d = await client(port, { lider: true }); t.after(() => d.ws.terminate());
  assert.equal((await a.wait(m => m.type === 'member-joined' && m.id === d.welcome.id)).lider, true, 'o app novo avisa que conhece o Modo Líder');
  assert.equal(d.welcome.members.find(m => m.id === a.welcome.id).lider, false, 'o antigo não');
  a.send({ type: 'subsala-create', modo: 'lider' });
  assert.deepEqual((await b.wait(m => m.type === 'subsalas')).list, [{ id: '1', name: 'Subsala_1', modo: 'lider' }]);
  b.send({ type: 'subsala-create', modo: 'lider' });
  assert.match((await b.wait(m => m.type === 'subsala-erro')).text, /Já existe uma subsala Líder \(Subsala_1\)/);
  // A na Líder (fonte), B na Voz geral, C fora da voz
  a.send({ type: 'voice-state', session: 'sa', channel: '1' });
  b.send({ type: 'voice-state', session: 'sb', channel: '' });
  await c.wait(m => m.type === 'voice-state' && m.id === a.welcome.id);
  await c.wait(m => m.type === 'voice-state' && m.id === b.welcome.id);
  const lider = (to, role) => ({ type: 'signal', to, data: { side: 'lider', role, call: 'k', sessao: 'sa', sdp: { type: role === 'ouvir' ? 'offer' : 'answer' } } });
  c.send(lider(a.welcome.id, 'ouvir'));
  assert.equal((await a.wait(m => m.type === 'signal')).from, c.welcome.id, 'fora da voz, pedir para ouvir a fonte passa');
  a.send(lider(c.welcome.id, 'falar'));
  assert.equal((await c.wait(m => m.type === 'signal')).from, a.welcome.id, 'a fonte responde');
  // Quem não está na Líder não "fala" para ninguém, e ninguém pede para ouvir quem não é fonte
  b.send(lider(c.welcome.id, 'falar'));
  c.send(lider(b.welcome.id, 'ouvir'));
  b.send({ type: 'chat', text: 'barreira' });
  await c.wait(m => m.type === 'chat');
  await b.wait(m => m.type === 'chat');
  assert.equal(c.messages.some(m => m.type === 'signal'), false);
  assert.equal(b.messages.some(m => m.type === 'signal'), false);
  // Servidor antigo de mensagem: subsala-create sem modo continua criando Padrão
  a.send({ type: 'subsala-create' });
  assert.equal((await b.wait(m => m.type === 'subsalas')).list.at(-1).modo, undefined);
});

// Fecha tudo no fim (as conexões têm relógios de nova tentativa que segurariam o processo)
const abertos = [];
after(() => { for (const { v, l } of abertos) { l.reset(); v.reset(null); } });
function fixture(id) {
  const sent = [];
  const track = { enabled: true, stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let n = 0;
  const peers = [];
  const makePeer = () => {
    const p = { tracks: [], transceivers: [], addTrack(t) { this.tracks.push(t); }, addTransceiver(k, o) { this.transceivers.push(o.direction); },
      close() { this.closed = true; }, createOffer: async () => ({ type: 'offer' }), createAnswer: async () => ({ type: 'answer' }),
      async setLocalDescription(d) { this.localDescription = d; }, async setRemoteDescription(d) { this.remoteDescription = d; },
      async addIceCandidate() {} };
    peers.push(p); return p;
  };
  const makeAudio = () => ({ play: async () => {}, pause() {} });
  const v = new VoiceChat({ send: m => sent.push(m), changed() {}, error() {}, token: () => `t${++n}`, media: { getUserMedia: async () => stream }, makeAudio, makePeer });
  v.reset({ id, features: ['voice'], members: [] });
  const l = new LiderAudio({ voice: v, send: m => sent.push(m), token: () => `l${++n}`, makeAudio, makePeer, retryMs: 60000 });
  abertos.push({ v, l });
  return { v, l, sent, peers, track };
}
const sinais = (sent) => sent.filter(m => m.type === 'signal' && m.data.side === 'lider');
const flush = () => new Promise(r => setTimeout(r, 0));

test('LiderAudio: quem está em outro canal chama cada fonte só para receber; sair da Líder fecha', async () => {
  const { v, l, sent } = fixture('1');
  await v.join('');
  l.setCanal('5');
  v.update('2', 's2', false, false, '5'); l.sync();
  v.update('3', 's3', false, false, ''); l.sync(); // na Voz geral, como eu: não é fonte
  assert.deepEqual([...l.ouve.keys()], ['2']);
  await flush(); await flush();
  const offer = sinais(sent).at(-1);
  assert.deepEqual([offer.to, offer.data.role, offer.data.sessao, offer.data.sdp.type], ['2', 'ouvir', 's2', 'offer']);
  assert.deepEqual(l.ouve.get('2').pc.transceivers, ['recvonly']);
  assert.equal(l.ouve.get('2').pc.tracks.length, 0, 'quem ouve não manda o microfone');
  // A fonte responde
  l.receive('2', { side: 'lider', role: 'falar', call: offer.data.call, sessao: 's2', sdp: { type: 'answer' } });
  await flush(); await flush();
  assert.equal(l.ouve.get('2').pc.remoteDescription.type, 'answer');
  // Eu entro na Líder: viro fonte, paro de ouvir pela Líder (lá é o canal)
  v.setChannel('5'); l.sync();
  assert.equal(l.ouve.size, 0);
  assert.equal(sinais(sent).at(-1).data.bye, true);
});

test('LiderAudio: fora da voz só ouve com o Ouvir ligado; a fonte manda o microfone e fecha quando a pessoa entra na Líder', async () => {
  const ouvinte = fixture('1');
  ouvinte.l.setCanal('5');
  ouvinte.v.update('2', 's2', false, false, '5'); ouvinte.l.sync();
  assert.equal(ouvinte.l.ouve.size, 0, 'fora da voz, sem o Ouvir, nada');
  ouvinte.l.setOuvindo(true);
  assert.deepEqual([...ouvinte.l.ouve.keys()], ['2']);
  await flush(); await flush();
  const offer = sinais(ouvinte.sent).at(-1);

  const fonte = fixture('2');
  await fonte.v.join('5');
  fonte.l.setCanal('5');
  fonte.v.update('1', '', false, false, '');
  fonte.l.receive('1', { ...offer.data, sessao: 'outra' });
  assert.equal(fonte.l.fala.size, 0, 'sessão velha da fonte é ignorada');
  fonte.l.receive('1', { ...offer.data, sessao: fonte.v.session });
  await flush(); await flush();
  const p = fonte.l.fala.get('1');
  assert.equal(p.pc.tracks.length, 1, 'a fonte manda o microfone');
  const answer = sinais(fonte.sent).at(-1);
  assert.deepEqual([answer.to, answer.data.role, answer.data.sdp.type], ['1', 'falar', 'answer']);
  // A pessoa entra na voz, dentro da Líder: a fonte fecha a conexão da Líder (agora é o canal)
  fonte.v.update('1', 's1', false, false, '5'); fonte.l.sync();
  assert.equal(fonte.l.fala.size, 0);
  assert.ok(p.pc.closed);
  // Parar de ouvir avisa a fonte
  ouvinte.l.setOuvindo(false);
  assert.equal(ouvinte.l.ouve.size, 0);
  assert.equal(sinais(ouvinte.sent).at(-1).data.bye, true);
  // A Líder apagada: nada
  ouvinte.l.setOuvindo(true); ouvinte.l.setCanal('');
  assert.equal(ouvinte.l.ouve.size, 0);
  assert.equal(ouvinte.l.ouvindo, false);
});

test('LiderAudio: quem não é fonte ignora pedidos para ouvir', async () => {
  const { v, l } = fixture('2');
  await v.join('');
  l.setCanal('5');
  v.update('1', 's1', false, false, '3');
  l.receive('1', { side: 'lider', role: 'ouvir', call: 'c', sessao: v.session, sdp: { type: 'offer' } });
  assert.equal(l.fala.size, 0);
});

test('pedir para falar: a fila, quem decide, aceitar, recusar, tirar, devolver e a limpeza', async t => {
  const port = await freePort();
  assert.equal((await startServer(port)).ok, true);
  t.after(stopServer);
  const a = await client(port); t.after(() => a.ws.terminate());
  const b = await client(port); t.after(() => b.ws.terminate());
  const c = await client(port); t.after(() => c.ws.terminate());
  const ultimo = async (x) => { await new Promise(r => setTimeout(r, 80)); return x.messages.filter(m => m.type === 'lider').at(-1); };
  a.send({ type: 'subsala-create', modo: 'lider' });
  await b.wait(m => m.type === 'subsalas');
  a.send({ type: 'voice-state', session: 'sa', channel: '1' });
  b.send({ type: 'voice-state', session: 'sb', channel: '' });
  // Fora da voz não pede
  c.send({ type: 'lider-pedir' });
  b.send({ type: 'lider-pedir' });
  b.send({ type: 'lider-pedir' }); // repetido não duplica
  assert.deepEqual((await ultimo(a)).pedidos, [b.welcome.id]);
  // Quem não transmite na Líder não decide
  a.send({ type: 'lider-responder', id: b.welcome.id, ok: true });
  assert.match((await a.wait(m => m.type === 'subsala-erro')).text, /Só quem está transmitindo/);
  a.send({ type: 'share', sharing: true, info: {} });
  a.send({ type: 'lider-responder', id: b.welcome.id, ok: true });
  assert.equal((await b.wait(m => m.type === 'lider-aviso')).aviso, 'aceito');
  assert.deepEqual(await ultimo(c), { type: 'lider', pedidos: [], palavra: [b.welcome.id] });
  // Com a palavra, B fala para a sala toda: o sinal "falar" de B passa
  b.send({ type: 'signal', to: c.welcome.id, data: { side: 'lider', role: 'falar', call: 'k', sessao: 'sb' } });
  assert.equal((await c.wait(m => m.type === 'signal')).from, b.welcome.id);
  a.send({ type: 'lider-tirar', id: b.welcome.id });
  assert.equal((await b.wait(m => m.type === 'lider-aviso')).aviso, 'tirada');
  assert.deepEqual((await ultimo(c)).palavra, []);
  // Recusar
  b.messages.length = 0;
  b.send({ type: 'lider-pedir' });
  await b.wait(m => m.type === 'lider' && m.pedidos.length === 1);
  a.send({ type: 'lider-responder', id: b.welcome.id, ok: false });
  assert.equal((await b.wait(m => m.type === 'lider-aviso')).aviso, 'recusado');
  // Devolver e cancelar
  b.messages.length = 0;
  b.send({ type: 'lider-pedir' });
  await b.wait(m => m.type === 'lider' && m.pedidos.length === 1);
  b.send({ type: 'lider-cancelar' });
  assert.deepEqual((await ultimo(c)).pedidos, []);
  b.messages.length = 0;
  b.send({ type: 'lider-pedir' });
  await b.wait(m => m.type === 'lider' && m.pedidos.length === 1);
  b.messages.length = 0;
  a.send({ type: 'lider-responder', id: b.welcome.id, ok: true });
  await b.wait(m => m.type === 'lider' && m.palavra.length === 1);
  b.send({ type: 'lider-devolver' });
  assert.deepEqual((await ultimo(c)).palavra, []);
  // Limpeza: entrar na Líder, sair da voz e sair da sala
  b.messages.length = 0;
  b.send({ type: 'lider-pedir' });
  await b.wait(m => m.type === 'lider' && m.pedidos.length === 1);
  b.send({ type: 'voice-state', session: 'sb', channel: '1' });
  assert.deepEqual((await ultimo(c)).pedidos, [], 'entrou na Líder: o pedido some');
  b.send({ type: 'voice-state', session: 'sb', channel: '' });
  b.send({ type: 'lider-pedir' });
  await c.wait(m => m.type === 'lider' && m.pedidos.length === 1);
  b.ws.terminate();
  await c.wait(m => m.type === 'lider' && m.pedidos.length === 0);
  // Quem entra depois recebe o estado
  const d = await client(port); t.after(() => d.ws.terminate());
  assert.deepEqual(d.welcome.lider, { type: 'lider', pedidos: [], palavra: [] });
});

test('semente da troca de host: pedidos e palavra continuam, e só com a Líder', () => {
  const s = createSubsalas([{ id: '1', modo: 'lider' }], { pedidos: ['3', '4', '3', 'x'], palavra: ['4', '5'] });
  assert.deepEqual([s.pedidos, s.palavra], [['3'], ['4', '5']]);
  assert.deepEqual(createSubsalas([{ id: '1' }], { pedidos: ['3'], palavra: ['4'] }).liderMsg(), { type: 'lider', pedidos: [], palavra: [] });
  s.remove('1');
  assert.deepEqual([s.pedidos, s.palavra], [[], []], 'apagar a Líder zera');
});

test('LiderAudio com a palavra: quem tem a palavra vira fonte; dentro da Líder, ouço só a palavra', async () => {
  // Eu (1) dentro da Líder; a 2 tem a palavra na Voz geral; a 3 está na Líder comigo
  const { v, l } = fixture('1');
  await v.join('5');
  l.setCanal('5');
  v.update('2', 's2', false, false, '');
  v.update('3', 's3', false, false, '5');
  l.sync();
  assert.equal(l.ouve.size, 0);
  l.setPalavra(['2']);
  assert.deepEqual([...l.ouve.keys()], ['2'], 'ouço quem tem a palavra (de outro canal), não quem está comigo');
  l.setPalavra([]);
  assert.equal(l.ouve.size, 0);
  // Eu com a palavra, na Voz geral: viro fonte e aceito quem chama
  const f = fixture('2');
  await f.v.join('');
  f.l.setCanal('5');
  f.v.update('1', 's1', false, false, '5');
  f.l.receive('1', { side: 'lider', role: 'ouvir', call: 'c', sessao: f.v.session, sdp: { type: 'offer' } });
  assert.equal(f.l.fala.size, 0, 'sem a palavra, não');
  f.l.setPalavra(['2']);
  assert.equal(f.l.souFonte(), true);
  f.l.receive('1', { side: 'lider', role: 'ouvir', call: 'c', sessao: f.v.session, sdp: { type: 'offer' } });
  assert.equal(f.l.fala.size, 1);
  f.l.setPalavra([]);
  assert.equal(f.l.fala.size, 0, 'devolveu: para de mandar');
});
