// A sala recebe mensagens de outros PCs: nenhuma, por mais estranha que seja, pode derrubar o servidor nem deixar a
// sala num estado quebrado. Cada tipo de mensagem vai com valores malformados (nulo, número, lista, objeto, texto
// enorme, chaves perigosas) tanto direto no tratador (handleMemberMessage) quanto por um socket de verdade.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { WebSocket } = require('ws');
const { startServer, stopServer } = require('../signaling');
const { createChat, createSubsalas, createMusicas, newMember, handleMemberMessage, memberInfo, MAX_MEMBERS } = require('../sala-protocolo');

const TIPOS = ['ping', 'voice-state', 'subsala-create', 'subsala-delete', 'subsala-move', 'lider-pedir', 'lider-cancelar', 'lider-devolver',
  'lider-responder', 'lider-tirar', 'musica-set', 'musica-ouvindo', 'musica-ctl', 'share', 'chat', 'signal', 'avatar', 'razze', 'name-font',
  'leave', 'hello', 'info', 'senha', 'passe', 'amigos-membros', 'tipo-que-nao-existe'];
const CAMPOS = ['id', 'to', 'ch', 'channel', 'session', 'text', 'file', 'name', 'size', 'mime', 'videoId', 'action', 'pos', 'dur', 'title', 'modo', 'ok',
  'sharing', 'info', 'hash', 'full', 'font', 'data', 'muted', 'deafened', 'on', 'targetSession', 'resume', 'client', 'addrs', 'password'];
const grande = 'x'.repeat(100000);
const VALORES = [null, undefined, true, false, 0, -1, 1.5, 1e308, NaN, Infinity, '', ' ', '0', '999999', 'a'.repeat(70), grande, [], [1, 2], ['a'], {}, { a: 1 },
  { id: 'x'.repeat(10), size: 5 }, { side: 'voice', session: 5 }, { side: 'lider', role: 'ouvrir' }, '__proto__', 'constructor', 'toString',
  { __proto__: { polui: 1 } }, JSON.parse('{"__proto__":{"polui":1},"constructor":{"prototype":{"polui":1}}}'), () => 1].filter((v) => typeof v !== 'function');

function sala() {
  const enviados = [];
  const mk = (id, extra = {}) => ({ ws: { readyState: 1, send: (s) => enviados.push([id, s]), terminate() {} }, name: id, voiceSession: '', voiceChannel: '', ...extra });
  const members = new Map([['1', mk('1', { voiceSession: 's1' })], ['2', mk('2', { voiceSession: 's2' })], ['3', mk('3')]]);
  const subsalas = createSubsalas(); subsalas.create(); subsalas.create('lider');
  const musicas = createMusicas([{ ch: '', videoId: 'dQw4w9WgXcQ', by: '1', dur: 100 }]);
  const chat = createChat();
  const ctx = { members, broadcast: (m) => enviados.push(['*', JSON.stringify(m)]), chat, subsalas, musicas };
  return { ctx, members, enviados };
}

test('o tratador de mensagens não lança com nenhum tipo e valor estranhos (campo a campo)', () => {
  const { ctx, members } = sala();
  let n = 0;
  for (const type of TIPOS) {
    for (const campo of CAMPOS) {
      for (const valor of VALORES) {
        for (const quem of ['1', '3']) {
          try { handleMemberMessage(ctx, quem, members.get(quem), { type, [campo]: valor }); n++; }
          catch (e) { assert.fail(`lançou com { type: '${type}', ${campo}: ${typeof valor === 'string' ? valor.slice(0, 20) : JSON.stringify(valor)} } vindo de ${quem}: ${e.message}`); }
        }
      }
    }
  }
  assert.ok(n > 10000);
  assert.equal({}.polui, undefined, 'nenhuma mensagem polui o Object.prototype');
});

test('mensagens que não são objeto, e hello com campos estranhos, não derrubam o tratador e o newMember', () => {
  const { ctx, members } = sala();
  for (const msg of [null, undefined, 0, 'texto', [], [1, 2], true]) {
    // o servidor já descarta o que não é objeto antes de chegar aqui (signaling.js); o tratador não pode depender disso para não travar a sala
    try { handleMemberMessage(ctx, '1', members.get('1'), msg); } catch (e) { assert.ok(msg == null || typeof msg !== 'object' || Array.isArray(msg), e.message); }
  }
  for (const campo of CAMPOS) for (const valor of VALORES) {
    const m = newMember({ readyState: 1, send() {} }, { name: valor, [campo]: valor, version: valor, addrs: valor, razze: valor, avatar: valor, nameFont: valor }, valor);
    const info = memberInfo('9', m);
    assert.equal(typeof info.name, 'string');
    assert.ok(info.name.length <= 32, 'nome limitado a 32');
    assert.ok(Array.isArray(info.addrs));
    JSON.stringify(info); // tem de ser serializável (vai para todos)
  }
});

async function freePort() {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
}
function conectar(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const msgs = [];
  ws.on('message', (raw) => { try { msgs.push(JSON.parse(raw)); } catch {} });
  const pronto = new Promise((ok, erro) => { ws.once('open', ok); ws.once('error', erro); });
  const espera = async (pred, ms = 3000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { const i = msgs.findIndex(pred); if (i >= 0) return msgs.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error('mensagem não chegou');
  };
  return { ws, msgs, pronto, espera, manda: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)) };
}

test('pelo socket de verdade: lixo antes e depois do hello não derruba a sala, e ela segue atendendo', async (t) => {
  const port = await freePort();
  assert.equal((await startServer(port)).ok, true);
  t.after(stopServer);
  const erros = [];
  const pega = (e) => erros.push(e);
  process.on('uncaughtException', pega);
  t.after(() => process.off('uncaughtException', pega));

  // 1) Sem hello: tudo que não é hello/info é ignorado; JSON quebrado e tipos estranhos não derrubam
  const lixo = conectar(port); await lixo.pronto; t.after(() => lixo.ws.terminate());
  for (const bruto of ['', '{', 'null', '123', '"texto"', '[]', '[1,2,3]', '{"type":null}', '{"type":{"a":1}}', '{"type":"hello","name":{"a":1},"addrs":"x","resume":{"a":1},"client":["a"],"password":5}',
    '{"type":"hello","name":"' + 'n'.repeat(5000) + '","addrs":' + JSON.stringify(Array.from({ length: 500 }, (_, i) => `10.0.0.${i}:8765`)) + '}']) {
    if (lixo.ws.readyState !== 1) break;
    lixo.manda(bruto);
    await new Promise((r) => setTimeout(r, 15));
  }

  // 2) Dois PCs de verdade entram; um deles manda a bateria toda de mensagens estranhas
  const a = conectar(port); await a.pronto; t.after(() => a.ws.terminate());
  const b = conectar(port); await b.pronto; t.after(() => b.ws.terminate());
  a.manda({ type: 'hello', name: 'A' });
  const wa = await a.espera((m) => m.type === 'welcome');
  b.manda({ type: 'hello', name: 'B' });
  const wb = await b.espera((m) => m.type === 'welcome');
  let enviadas = 0;
  for (const type of TIPOS.filter((x) => x !== 'leave')) {
    for (const campo of CAMPOS) {
      for (const valor of [null, 0, -1, NaN, [], {}, 'x'.repeat(300), '__proto__', { __proto__: 1 }, { side: 'voice' }, { id: 'x', size: 1 }]) {
        if (a.ws.readyState !== 1) break;
        a.manda({ type, [campo]: valor, to: wb.id, id: wb.id });
        enviadas++;
      }
    }
  }
  assert.ok(enviadas > 1000);
  await new Promise((r) => setTimeout(r, 500));

  assert.deepEqual(erros.map((e) => e.message), [], 'nenhum erro não tratado no servidor');
  assert.equal(a.ws.readyState, 1, 'o PC que mandou lixo continua na sala (o servidor não o derrubou nem caiu)');
  b.manda({ type: 'ping' });
  await b.espera((m) => m.type === 'pong');
  b.manda({ type: 'chat', text: 'oi' });
  assert.equal((await a.espera((m) => m.type === 'chat' && m.text === 'oi')).text, 'oi');
  // A sala continua aceitando gente nova
  const c = conectar(port); await c.pronto; t.after(() => c.ws.terminate());
  c.manda({ type: 'hello', name: 'C' });
  const wc = await c.espera((m) => m.type === 'welcome');
  assert.ok(wc.members.length >= 2);
  assert.equal({}.polui, undefined);
  assert.ok(wa.id && wb.id && wc.id && new Set([wa.id, wb.id, wc.id]).size === 3);
});

test('a sala cheia recusa e não deixa quem chega derrubar quem já está (limite de pessoas)', async (t) => {
  const port = await freePort();
  assert.equal((await startServer(port)).ok, true);
  t.after(stopServer);
  const todos = [];
  t.after(() => todos.forEach((c) => c.ws.terminate()));
  for (let i = 0; i < MAX_MEMBERS; i++) {
    const c = conectar(port); await c.pronto; todos.push(c);
    c.manda({ type: 'hello', name: `P${i}` });
    await c.espera((m) => m.type === 'welcome', 5000);
  }
  const extra = conectar(port); await extra.pronto; t.after(() => extra.ws.terminate());
  extra.manda({ type: 'hello', name: 'sobrando' });
  assert.match((await extra.espera((m) => m.type === 'error')).message, /cheia/);
  assert.equal(todos[0].ws.readyState, 1);
});

// ---------- O servidor do modo Internet (sala por código, na VPS): mesma língua, mais o código, a senha e o passe ----------
const crypto = require('node:crypto');
const { createInternetServer } = require('../servidor-internet/server');

test('servidor da internet: hello e mensagens estranhas não derrubam nem travam a sala', async (t) => {
  const server = createInternetServer({ host: '127.0.0.1', port: 0, denyDelayMs: 1, graceMs: 200, turnHost: 'turn.exemplo.com', turnPort: 3479, turnSecret: 'segredo-de-teste-bem-comprido', log: () => {} });
  const addr = await server.listen();
  t.after(() => server.close());
  const erros = [];
  const pega = (e) => erros.push(e);
  process.on('uncaughtException', pega);
  t.after(() => process.off('uncaughtException', pega));
  const client = () => crypto.randomBytes(16).toString('hex');

  // Criar sala e entrar nela de verdade
  const mk = async () => { const c = conectar(Number(addr.port)); await c.pronto; t.after(() => c.ws.terminate()); return c; };
  const ana = await mk();
  ana.manda({ type: 'hello', create: true, name: 'Ana', password: 'pizza-azul', client: client() });
  const wa = await ana.espera((m) => m.type === 'welcome' || m.type === 'error');
  assert.equal(wa.type, 'welcome');
  const bia = await mk();
  bia.manda({ type: 'hello', name: 'Bia', room: wa.sala, password: 'pizza-azul', client: client() });
  const wb = await bia.espera((m) => m.type === 'welcome' || m.type === 'error');
  assert.equal(wb.type, 'welcome');

  // hello estranho, de gente nova: nenhum vira sala nem derruba
  for (const valor of [null, 0, -1, NaN, [], {}, 'x'.repeat(500), '__proto__', { __proto__: 1 }, true]) {
    const x = await mk();
    for (const campo of ['room', 'password', 'name', 'create', 'client', 'resume', 'passe', 'senha', 'addrs', 'amigosMembros']) {
      if (x.ws.readyState !== 1) break;
      x.manda({ type: 'hello', [campo]: valor });
      await new Promise((r) => setTimeout(r, 3));
    }
    x.ws.terminate();
  }

  // Quem está dentro manda a bateria de mensagens estranhas
  let enviadas = 0;
  for (const type of TIPOS.filter((x) => x !== 'leave' && x !== 'hello')) {
    for (const campo of CAMPOS) {
      for (const valor of [null, 0, -1, NaN, [], {}, 'x'.repeat(300), '__proto__', { side: 'voice' }, { id: 'x', size: 1 }]) {
        if (ana.ws.readyState !== 1) break;
        ana.manda({ type, [campo]: valor, to: wb.id, id: wb.id });
        enviadas++;
      }
    }
  }
  assert.ok(enviadas > 1000);
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(erros.map((e) => e.message), [], 'nenhum erro não tratado no servidor da internet');
  assert.equal(ana.ws.readyState, 1);
  bia.manda({ type: 'ping' });
  await bia.espera((m) => m.type === 'pong');
  bia.manda({ type: 'chat', text: 'oi' });
  assert.equal((await ana.espera((m) => m.type === 'chat' && m.text === 'oi')).text, 'oi');
  assert.equal({}.polui, undefined);
});
