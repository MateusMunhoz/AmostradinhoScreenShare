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
