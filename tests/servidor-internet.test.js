const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { WebSocket } = require('ws');
const { createInternetServer, turnCredentials, cleanCode } = require('../servidor-internet/server');

const SECRET = 'segredo-de-teste-bem-comprido';

async function start(t, opts = {}) {
  const server = createInternetServer({
    host: '127.0.0.1', port: 0, denyDelayMs: 5, graceMs: 300, turnHost: 'turn.exemplo.com', turnPort: 3479,
    turnSecret: SECRET, log: () => {}, ...opts,
  });
  const addr = await server.listen();
  t.after(() => server.close());
  return { server, url: `ws://127.0.0.1:${addr.port}` };
}

async function connect(url, hello) {
  const ws = new WebSocket(url);
  const messages = [];
  let closed = false;
  ws.on('message', (raw) => messages.push(JSON.parse(raw)));
  ws.on('close', () => { closed = true; });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const send = (msg) => ws.send(JSON.stringify(msg));
  const wait = async (predicate, ms = 3000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const i = messages.findIndex(predicate);
      if (i !== -1) return messages.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Mensagem não recebida');
  };
  if (hello) send({ type: 'hello', ...hello });
  const first = hello ? await wait((m) => m.type === 'welcome' || m.type === 'error') : null;
  return { ws, send, wait, messages, first, isClosed: () => closed };
}

const client = () => crypto.randomBytes(16).toString('hex');

test('cria a sala com código e entrega STUN + TURN com acesso temporário', async (t) => {
  const { url } = await start(t);
  const a = await connect(url, { create: true, name: 'Ana', password: 'pizza-azul', client: client() });
  t.after(() => a.ws.terminate());
  assert.equal(a.first.type, 'welcome');
  assert.equal(cleanCode(a.first.sala), a.first.sala);
  assert.equal(a.first.hostId, a.first.id);
  assert.ok(a.first.features.includes('internet'));
  assert.ok(!a.first.features.includes('handoff'));
  const [stun, turn] = a.first.iceServers;
  assert.ok(stun.urls.includes('stun:turn.exemplo.com:3479'));
  assert.deepEqual(turn.urls, ['turn:turn.exemplo.com:3479?transport=udp', 'turn:turn.exemplo.com:3479?transport=tcp']);
  // A senha do TURN é o HMAC-SHA1 do usuário com o segredo (o que o coturn confere com use-auth-secret)
  assert.equal(turn.credential, crypto.createHmac('sha1', SECRET).update(turn.username).digest('base64'));
  const expira = Number(turn.username.split(':')[0]);
  assert.ok(expira > Date.now() / 1000 + 3600);
});

test('entra com código + senha, repassa sinais e não espalha IPs', async (t) => {
  const { url } = await start(t);
  const a = await connect(url, { create: true, name: 'Ana', password: 'pizza-azul', client: client(), addrs: ['192.168.0.10'] });
  t.after(() => a.ws.terminate());
  const b = await connect(url, { room: a.first.sala.toLowerCase(), name: 'Beto', password: 'pizza-azul', client: client() });
  t.after(() => b.ws.terminate());
  assert.equal(b.first.type, 'welcome');
  assert.equal(b.first.members.length, 1);
  assert.deepEqual(b.first.members[0].addrs, []);
  await a.wait((m) => m.type === 'member-joined' && m.id === b.first.id);
  b.send({ type: 'signal', to: a.first.id, data: { side: 'viewer', subscribe: true } });
  const sig = await a.wait((m) => m.type === 'signal');
  assert.equal(sig.from, b.first.id);
  a.send({ type: 'chat', text: 'oi' });
  assert.equal((await b.wait((m) => m.type === 'chat')).text, 'oi');
});

test('senha errada e sala inexistente dão a mesma resposta, e o IP é bloqueado depois de várias', async (t) => {
  const { url } = await start(t, { failPerIp: 3 });
  const a = await connect(url, { create: true, name: 'Ana', password: 'pizza-azul', client: client() });
  t.after(() => a.ws.terminate());
  const wrong = await connect(url, { room: a.first.sala, name: 'X', password: 'errada' });
  const missing = await connect(url, { room: 'ZZZZZZ', name: 'X', password: 'pizza-azul' });
  assert.equal(wrong.first.type, 'error');
  assert.equal(wrong.first.message, missing.first.message);
  await connect(url, { room: 'ZZZZZZ', name: 'X', password: 'x' });
  const blocked = await connect(url, { room: a.first.sala, name: 'X', password: 'pizza-azul' });
  assert.equal(blocked.first.type, 'error');
  assert.match(blocked.first.message, /Muitas tentativas/);
});

test('criar sala sem senha é recusado', async (t) => {
  const { url } = await start(t);
  const a = await connect(url, { create: true, name: 'Ana', password: '' });
  assert.equal(a.first.type, 'error');
});

test('conexão que cai volta com o mesmo número; quem sai pelo botão sai na hora', async (t) => {
  const { url } = await start(t);
  const ca = client();
  const a = await connect(url, { create: true, name: 'Ana', password: 'pizza-azul', client: ca });
  const b = await connect(url, { room: a.first.sala, name: 'Beto', password: 'pizza-azul', client: client() });
  t.after(() => b.ws.terminate());
  a.ws.terminate(); // a internet da Ana piscou
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(b.messages.some((m) => m.type === 'member-left'), false);
  const a2 = await connect(url, { room: a.first.sala, name: 'Ana', password: 'pizza-azul', client: ca, resume: a.first.id });
  t.after(() => a2.ws.terminate());
  assert.equal(a2.first.id, a.first.id);
  assert.equal(a2.first.members.length, 1);
  const back = await b.wait((m) => m.type === 'member-joined');
  assert.equal(back.resumed, true);

  // Outro PC não pode "assumir" o número da Ana
  const fake = await connect(url, { room: a.first.sala, name: 'Falsa', password: 'pizza-azul', client: client(), resume: a.first.id });
  t.after(() => fake.ws.terminate());
  assert.notEqual(fake.first.id, a.first.id);

  a2.send({ type: 'leave' });
  const left = await b.wait((m) => m.type === 'member-left' && m.id === a.first.id, 200);
  assert.equal(left.id, a.first.id);
});

test('quem não volta a tempo sai da sala, e a sala vazia fecha', async (t) => {
  const { url, server } = await start(t);
  const a = await connect(url, { create: true, name: 'Ana', password: 'pizza-azul', client: client() });
  const b = await connect(url, { room: a.first.sala, name: 'Beto', password: 'pizza-azul', client: client() });
  a.ws.terminate();
  await b.wait((m) => m.type === 'member-left' && m.id === a.first.id, 2000);
  b.ws.terminate();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(server.rooms.size, 0);
});

test('credenciais do TURN no formato do coturn', () => {
  const { username, credential } = turnCredentials('abc', 'SALA-1', 60, 1_000_000);
  assert.equal(username, '1060:SALA-1');
  assert.equal(credential, crypto.createHmac('sha1', 'abc').update('1060:SALA-1').digest('base64'));
});
