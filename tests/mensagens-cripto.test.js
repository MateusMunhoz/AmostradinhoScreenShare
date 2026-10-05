'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDmE2E } = require('../main/mensagens-cripto');

const ANA = 'a'.repeat(32), BIA = 'b'.repeat(32);
// safeStorage de mentira: "cifra" com um prefixo (o que importa aqui é passar por ele)
const storage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('X' + s), decryptString: (b) => b.toString().slice(1) };

// RazzeAPI de mentira, só o que as mensagens usam; guarda o que o servidor vê
function fakeServer() {
  const keys = new Map(), msgs = [];
  let seq = 0;
  const serviceFor = (id, name) => ({
    me: async () => ({ user: { id } }),
    state: () => ({ baseUrl: 'https://razze.test' }),
    api: () => ({ setDmKey: async (k) => { keys.set(id, k); return { ok: true }; } }),
    listFriends: async () => ({ friends: [ANA, BIA].filter((x) => x !== id).map((x) => ({ id: x, displayName: x === ANA ? 'Ana' : 'Bia', dmKey: keys.get(x) || null })) }),
    sendMessage: async (to, text) => { const m = { seq: ++seq, id: 'm' + seq, from: id, to, text, createdAt: seq }; msgs.push(m); return { message: { ...m } }; },
    messages: async (after) => ({ messages: msgs.filter((m) => m.seq > after && (m.to === id || m.from === id)).map((m) => ({ ...m })), more: false }),
    name,
  });
  return { keys, msgs, serviceFor };
}

function dir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-e2e-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('mensagem vai cifrada: o servidor só vê e2e1, a Bia lê, a Ana lê a própria e a chave privada fica selada', async (t) => {
  const srv = fakeServer();
  const dA = dir(t), dB = dir(t);
  const ana = createDmE2E({ baseDir: dA, storage, service: srv.serviceFor(ANA) });
  const bia = createDmE2E({ baseDir: dB, storage, service: srv.serviceFor(BIA) });
  await bia.ensurePublished();
  const sent = await ana.send(BIA, 'oi Bia, ção 🎉');
  assert.equal(sent.message.text, 'oi Bia, ção 🎉');
  assert.equal(sent.message.e2e, true);
  assert.match(srv.msgs[0].text, /^e2e1:[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(srv.msgs[0].text, /Bia|ção/);
  const got = await bia.messages(0);
  assert.equal(got.messages[0].text, 'oi Bia, ção 🎉');
  assert.equal(got.messages[0].e2e, true);
  assert.equal((await ana.messages(0)).messages[0].text, 'oi Bia, ção 🎉'); // a enviada volta legível para quem mandou
  const file = JSON.parse(fs.readFileSync(path.join(dA, ANA, 'chave.json'), 'utf8'));
  assert.equal(file.sealed, true);
  assert.ok(Buffer.from(file.privateKey, 'base64').toString().startsWith('X'));
});

test('amigo sem chave: a mensagem não sai e o erro pede para atualizar', async (t) => {
  const srv = fakeServer();
  const ana = createDmE2E({ baseDir: dir(t), storage, service: srv.serviceFor(ANA) });
  await assert.rejects(ana.send(BIA, 'oi'), /Bia precisa atualizar o Tela P2P/);
  assert.equal(srv.msgs.length, 0);
});

test('chave do amigo mudou (PC novo): avisa; a mensagem para a chave antiga não abre no PC novo; mexida não abre', async (t) => {
  const srv = fakeServer();
  const ana = createDmE2E({ baseDir: dir(t), storage, service: srv.serviceFor(ANA) });
  const bia1 = createDmE2E({ baseDir: dir(t), storage, service: srv.serviceFor(BIA) });
  await bia1.ensurePublished();
  await ana.send(BIA, 'para o PC antigo');
  await bia1.send(ANA, 'oi do PC antigo');
  assert.equal((await ana.messages(0)).messages.find((m) => m.from === BIA).keyChanged, undefined); // primeira vez: só fixa
  // A Bia troca de PC: chave nova publicada
  const bia2 = createDmE2E({ baseDir: dir(t), storage, service: srv.serviceFor(BIA) });
  await bia2.ensurePublished();
  const old = (await bia2.messages(0)).messages.find((m) => m.from === ANA);
  assert.equal(old.locked, true);
  assert.equal(old.text, '');
  const sent = await ana.send(BIA, 'para o PC novo');
  assert.equal(sent.message.keyChanged, true);
  await bia2.send(ANA, 'oi do PC novo');
  const fromNew = (await ana.messages(0)).messages.filter((m) => m.from === BIA).at(-1);
  assert.equal(fromNew.text, 'oi do PC novo');
  // Um byte trocado no meio: não abre (a autenticação do AES-GCM pega)
  const m = srv.msgs.at(-1);
  const buf = Buffer.from(m.text.slice(5), 'base64url');
  buf[buf.length - 20] ^= 1;
  m.text = 'e2e1:' + buf.toString('base64url');
  const tampered = (await ana.messages(0)).messages.at(-1);
  assert.equal(tampered.locked, true);
});

test('mensagem antiga sem criptografia passa marcada como plain', async (t) => {
  const srv = fakeServer();
  const bia = createDmE2E({ baseDir: dir(t), storage, service: srv.serviceFor(BIA) });
  srv.msgs.push({ seq: 99, id: 'velha', from: ANA, to: BIA, text: 'mensagem de antes', createdAt: 1 });
  const m = (await bia.messages(0)).messages[0];
  assert.equal(m.text, 'mensagem de antes');
  assert.equal(m.plain, true);
});

test('de ponta a ponta com a RazzeAPI de verdade: o banco guarda só o texto cifrado', async (t) => {
  const { createApiServer } = require('../razze-api/server');
  const { RazzeApiClient } = require('../main/razze-api-client');
  const server = createApiServer({ dbPath: ':memory:', requireApproval: false, stun: false });
  const address = await server.listen(0, '127.0.0.1');
  t.after(() => { server.server.closeAllConnections(); return server.close(); });
  const url = 'http://127.0.0.1:' + address.port;
  const account = async (name) => {
    const client = new RazzeApiClient(url);
    const r = await client.register(name + '@test.example', 'correct-password-123', name);
    client.setAccessToken(r.accessToken);
    const service = { me: () => client.me(), state: () => ({ baseUrl: url }), api: () => client, listFriends: () => client.listFriends(),
      sendMessage: (to, text) => client.sendMessage(to, text), messages: (after) => client.messages(after) };
    return { client, id: r.user.id, e2e: createDmE2E({ baseDir: dir(t), storage, service }) };
  };
  const ana = await account('Ana'), bia = await account('Bia');
  const reqId = (await ana.client.requestFriend('Bia')).id;
  await bia.client.acceptFriendRequest(reqId);
  await bia.e2e.ensurePublished();
  await ana.e2e.send(bia.id, 'segredo entre amigas');
  const raw = await bia.client.messages(0); // o que o servidor entrega, sem decifrar
  assert.match(raw.messages[0].text, /^e2e1:/);
  assert.equal((await bia.e2e.messages(0)).messages[0].text, 'segredo entre amigas');
});

test('sinais da conexão direta: vão cifrados, só abrem para o amigo, e chave diferente da fixada é recusada', async (t) => {
  const { createApiServer } = require('../razze-api/server');
  const { RazzeApiClient } = require('../main/razze-api-client');
  const server = createApiServer({ dbPath: ':memory:', requireApproval: false, stun: false });
  const address = await server.listen(0, '127.0.0.1');
  t.after(() => { server.server.closeAllConnections(); return server.close(); });
  const url = 'http://127.0.0.1:' + address.port;
  const account = async (name, client = new RazzeApiClient(url)) => {
    const r = await client.register(name + '@test.example', 'correct-password-123', name);
    client.setAccessToken(r.accessToken);
    return { client, id: r.user.id, r };
  };
  const e2eFor = (client, baseDir) => createDmE2E({ baseDir, storage, service: { me: () => client.me(), state: () => ({ baseUrl: url }), api: () => client, listFriends: () => client.listFriends(),
    sendMessage: (to, text) => client.sendMessage(to, text), messages: (after) => client.messages(after) } });
  const ana = await account('Ana'), bia = await account('Bia');
  await bia.client.acceptFriendRequest((await ana.client.requestFriend('Bia')).id);
  ana.e2e = e2eFor(ana.client, dir(t));
  bia.e2e = e2eFor(bia.client, dir(t));
  await ana.e2e.ensurePublished();
  await bia.e2e.ensurePublished();
  const oferta = JSON.stringify({ t: 'oferta', sdp: 'v=0 segredo', s: 'c'.repeat(32) });
  await ana.e2e.sendSignal(bia.id, oferta);
  const raw = await bia.client.signals(); // o que o servidor entrega: só cifrado (e já some de lá)
  assert.match(raw.signals[0].text, /^e2e1:/);
  assert.ok(!raw.signals[0].text.includes('segredo'));
  await ana.e2e.sendSignal(bia.id, oferta);
  const abertos = await bia.e2e.signals();
  assert.deepEqual(abertos.map((s) => [s.from, s.text]), [[ana.id, oferta]]);
  assert.deepEqual(await bia.e2e.signals(), []); // entregue uma vez só
  await assert.rejects(ana.e2e.sendSignal(bia.id, 'x'.repeat(12001)));
  // A Ana troca de PC (chave nova): a Bia, que fixou a antiga, descarta o sinal dela até chegar uma mensagem
  const anaNova = e2eFor(ana.client, dir(t));
  await anaNova.ensurePublished();
  await anaNova.sendSignal(bia.id, oferta);
  assert.deepEqual(await bia.e2e.signals(), []);
  await assert.rejects(bia.e2e.sendSignal(ana.id, oferta), /mudou/);
});
