const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { WebSocket } = require('ws');
const { startServer, stopServer } = require('../signaling');

async function client(port) {
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
  send({ type: 'hello', name: 'Teste' });
  const welcome = await wait(m => m.type === 'welcome');
  return { ws, send, wait, messages, welcome };
}

test('sala anuncia voz, guarda estado e só encaminha sinais entre sessões ativas', async t => {
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  assert.equal((await startServer(port)).ok, true);
  t.after(stopServer);
  const a = await client(port); t.after(() => a.ws.terminate());
  assert.ok(a.welcome.features.includes('voice'));
  a.send({ type: 'voice-state', session: 'session-a', muted: true });
  await a.wait(m => m.type === 'voice-state');
  const b = await client(port); t.after(() => b.ws.terminate());
  assert.equal(b.welcome.members[0].voiceSession, 'session-a');
  assert.equal(b.welcome.members[0].muted, true);
  b.send({ type: 'voice-state', session: 'session-b' });
  await b.wait(m => m.type === 'voice-state');
  const signal = { type: 'signal', to: b.welcome.id, data: {
    side: 'voice', session: 'session-a', targetSession: 'session-b', call: 'call', sdp: { type: 'offer' },
  } };
  a.send(signal);
  assert.equal((await b.wait(m => m.type === 'signal')).from, a.welcome.id);
  b.send({ type: 'voice-state', session: '' });
  await b.wait(m => m.type === 'voice-state');
  a.send(signal);
  // Uma mensagem posterior no mesmo socket serve de barreira, sem depender de um sleep.
  a.send({ type: 'chat', text: 'barreira' });
  await b.wait(m => m.type === 'chat');
  assert.equal(b.messages.some(m => m.type === 'signal'), false);
  a.send(null); a.send({ type: 'voice-state', session: { invalid: true } });
  a.send({ type: 'chat', text: 'continua vivo' });
  await b.wait(m => m.type === 'chat' && m.text === 'continua vivo');
  a.ws.close();
  assert.equal((await b.wait(m => m.type === 'member-left')).id, a.welcome.id);
});

async function freePort() {
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  return port;
}

// Pergunta "info" sem entrar na sala (o que a lista de sessões faz com os endereços conhecidos)
async function askInfo(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const reply = new Promise(resolve => {
    ws.once('message', raw => resolve(JSON.parse(raw)));
    ws.once('close', () => resolve(null));
  });
  ws.send(JSON.stringify({ type: 'info' }));
  return reply;
}

test('sessão: id, pessoas e senha para quem procura, sem entrar; sala oculta não aparece', async t => {
  const { roomInfo, roomSize, onRoomChange } = require('../signaling');
  const port = await freePort();
  let changes = 0;
  onRoomChange(() => { changes++; });
  t.after(() => onRoomChange(null));
  assert.equal((await startServer(port, 'segredo')).ok, true);
  t.after(stopServer);
  assert.equal(roomInfo(), null, 'antes do host entrar, nada a anunciar');
  const a = await client(port); t.after(() => a.ws.terminate());
  assert.match(a.welcome.sessao.id, /^[a-f0-9]{16}$/);
  assert.equal(a.welcome.sessao.oculta, false);
  assert.ok(a.welcome.features.includes('sessoes'));
  const info = await askInfo(port);
  assert.deepEqual(info, { type: 'info', app: 'tela-p2p', id: a.welcome.sessao.id, host: 'Teste', pessoas: 1, senha: true, porta: port });
  assert.equal(roomSize(), 1, 'quem só perguntou não conta como pessoa');
  const b = await client(port); t.after(() => b.ws.terminate());
  assert.equal(roomInfo().pessoas, 2);
  assert.ok(changes >= 2, 'avisa quando entra alguém');
  stopServer();
  assert.equal(roomInfo(), null);

  // Troca de host: o novo servidor continua com o mesmo id; oculta continua oculta
  const port2 = await freePort();
  assert.equal((await startServer(port2, '', { sessao: { id: a.welcome.sessao.id, oculta: true } })).ok, true);
  const c = await client(port2); t.after(() => c.ws.terminate());
  assert.equal(c.welcome.sessao.id, a.welcome.sessao.id);
  assert.equal(roomInfo(), null, 'oculta não é anunciada');
  assert.equal(roomSize(), 1);
  assert.equal(await askInfo(port2), null, 'oculta não responde info');
});
