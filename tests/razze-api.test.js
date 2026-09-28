'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { createApiServer } = require('../razze-api/server');

let api;
let baseUrl;
let alice;
let bob;
const adminToken = 'razze-admin-test-token-with-at-least-thirty-characters';

async function request(path, options = {}, token) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const response = await fetch(baseUrl + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  api = createApiServer({ dbPath: ':memory:', tokenTtlMs: 60_000, adminToken, stunPort: 0 });
  const address = await api.listen(0, '127.0.0.1');
  baseUrl = 'http://127.0.0.1:' + address.port;
});

after(async () => { if (api) await api.close(); });

test('health, cadastro e autenticação', async () => {
  const health = (await request('/v1/health')).body;
  assert.equal(health.ok, true);
  assert.equal(health.service, 'razze-api');
  assert.equal(health.stun.protocol, 'udp');
  assert.ok(health.stun.port > 0);
  const created = await request('/v1/auth/register', { method: 'POST', body: { email: 'Alice@example.com', displayName: 'Alice', password: 'segredo-123' } });
  assert.equal(created.status, 202);
  assert.equal(created.body.user.email, 'alice@example.com');
  assert.equal(created.body.status, 'pending_approval');
  assert.equal((await request('/v1/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'segredo-123' } })).status, 403);
  const approved = await request('/v1/admin/users/' + created.body.user.id + '/approve', { method: 'POST' }, adminToken);
  assert.equal(approved.body.status, 'active');
  const login = await request('/v1/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'segredo-123' } });
  assert.equal(login.status, 200);
  alice = login.body;
  const duplicate = await request('/v1/auth/register', { method: 'POST', body: { email: 'alice@example.com', displayName: 'Outra', password: 'segredo-123' } });
  assert.equal(duplicate.status, 409);
  const listed = await request('/v1/admin/users', {}, adminToken);
  assert.equal(listed.body.users.length, 1);
  const badLogin = await request('/v1/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'errada' } });
  assert.equal(badLogin.status, 401);
});

test('amizades, redes e convites respeitam permissões', async () => {
  const registered = await request('/v1/auth/register', { method: 'POST', body: { email: 'bob@example.com', displayName: 'Bob', password: 'segredo-456' } });
  assert.equal(registered.status, 202);
  const approved = await request('/v1/admin/users/' + registered.body.user.id + '/approve', { method: 'POST' }, adminToken);
  assert.equal(approved.status, 200);
  bob = (await request('/v1/auth/login', { method: 'POST', body: { email: 'bob@example.com', password: 'segredo-456' } })).body;
  const networkResult = await request('/v1/networks', { method: 'POST', body: { name: 'Rede privada', visibility: 'private' } }, alice.accessToken);
  assert.equal(networkResult.status, 201);
  const network = networkResult.body.network;
  assert.equal((await request('/v1/networks/' + network.id, {}, bob.accessToken)).status, 404);
  assert.equal((await request('/v1/networks/' + network.id, { method: 'PATCH', body: { name: 'Invadida' } }, bob.accessToken)).status, 403);
  const friendRequest = await request('/v1/friends/requests', { method: 'POST', body: { email: 'alice@example.com' } }, bob.accessToken);
  assert.equal(friendRequest.body.status, 'pending');
  const accepted = await request('/v1/friends/requests/' + friendRequest.body.id + '/accept', { method: 'POST' }, alice.accessToken);
  assert.equal(accepted.body.status, 'accepted');
  assert.equal((await request('/v1/friends', {}, bob.accessToken)).body.friends.length, 1);
  const invite = await request('/v1/networks/' + network.id + '/invites', { method: 'POST', body: { maxUses: 1, ttlHours: 1 } }, alice.accessToken);
  assert.equal(invite.status, 201);
  const joined = await request('/v1/invites/accept', { method: 'POST', body: { token: invite.body.token } }, bob.accessToken);
  assert.equal(joined.status, 200);
  assert.equal(joined.body.joined, true);
  const repeated = await request('/v1/invites/accept', { method: 'POST', body: { token: invite.body.token } }, bob.accessToken);
  assert.equal(repeated.body.joined, false);
  assert.equal((await request('/v1/networks/' + network.id + '/members', {}, bob.accessToken)).body.members.length, 2);
  const aliceDevice = await request('/v1/networks/' + network.id + '/devices', { method: 'POST', body: { deviceId: 'a'.repeat(32), name: 'PC Alice', publicKey: Buffer.alloc(32, 1).toString('base64') } }, alice.accessToken);
  assert.equal(aliceDevice.status, 201);
  assert.equal(aliceDevice.body.device.assignedIp, '10.64.0.2');
  const bobDevice = await request('/v1/networks/' + network.id + '/devices', { method: 'POST', body: { deviceId: 'b'.repeat(32), name: 'PC Bob', publicKey: Buffer.alloc(32, 2).toString('base64') } }, bob.accessToken);
  assert.equal(bobDevice.body.device.assignedIp, '10.64.0.3');
  assert.equal((await request('/v1/networks/' + network.id + '/devices/' + 'a'.repeat(32) + '/endpoint', { method: 'PATCH', body: { host: '203.0.113.10', port: 53111 } }, alice.accessToken)).body.ok, true);
  const deviceList = await request('/v1/networks/' + network.id + '/devices', {}, bob.accessToken);
  assert.equal(deviceList.body.peers[0].endpointHost, '203.0.113.10');
  assert.equal(deviceList.body.subnet, '10.64.0.0/24');
  assert.equal((await request('/v1/networks/' + network.id, { method: 'PATCH', body: { name: 'Nova rede' } }, alice.accessToken)).body.network.name, 'Nova rede');
  assert.equal((await request('/v1/networks/' + network.id, { method: 'DELETE' }, alice.accessToken)).body.ok, true);
  assert.equal((await request('/v1/admin/networks', {}, adminToken)).body.networks.length, 0);
});

test('valida JSON, login e TLS do cliente', async () => {
  const invalid = await fetch(baseUrl + '/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  const unauthenticated = await request('/v1/me');
  assert.equal(unauthenticated.status, 401);
  const { RazzeApiClient } = require('../main/razze-api-client');
  assert.throws(() => new RazzeApiClient('http://example.com'), /HTTPS/);
  const client = new RazzeApiClient(baseUrl);
  assert.equal((await client.health()).ok, true);
});

test('autenticação administrativa aceita segredo aleatório e recusa segredo curto configurado', async () => {
  const randomSecret = 's3cret+/with=standard-base64-chars-0123456789';
  const authorized = createApiServer({ dbPath: ':memory:', adminToken: randomSecret, stun: false });
  const address = await authorized.listen(0, '127.0.0.1');
  try {
    const response = await fetch('http://127.0.0.1:' + address.port + '/v1/admin/users', {
      headers: { Authorization: 'Bearer ' + randomSecret },
    });
    assert.equal(response.status, 200);
  } finally { await authorized.close(); }

  const weak = createApiServer({ dbPath: ':memory:', adminToken: 'weak-token', stun: false });
  const weakAddress = await weak.listen(0, '127.0.0.1');
  try {
    const response = await fetch('http://127.0.0.1:' + weakAddress.port + '/v1/admin/users', {
      headers: { Authorization: 'Bearer weak-token' },
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'admin_token_weak');
  } finally { await weak.close(); }
});

test('o servidor STUN revela endpoint reflexivo UDP', async () => {
  const address = api.stunServer.address();
  const socket = dgram.createSocket('udp4');
  const requestPacket = Buffer.alloc(20);
  requestPacket.writeUInt16BE(0x0001, 0);
  requestPacket.writeUInt16BE(0, 2);
  requestPacket.writeUInt32BE(0x2112a442, 4);
  Buffer.from('0123456789ab').copy(requestPacket, 8);
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('STUN response timeout')), 1500);
    socket.once('message', (packet) => { clearTimeout(timer); resolve(packet); });
    socket.once('error', reject);
    socket.send(requestPacket, address.port, '127.0.0.1');
  });
  socket.close();
  assert.equal(response.readUInt16BE(0), 0x0101);
  assert.equal(response.readUInt16BE(20), 0x0020);
});

test('erro ao reservar a porta STUN limpa o listener HTTP e permite fechar o banco', async () => {
  const occupied = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.bind(0, '127.0.0.1', resolve);
  });
  const api = createApiServer({ dbPath: ':memory:', stunHost: '127.0.0.1', stunPort: occupied.address().port });
  try {
    await assert.rejects(api.listen(0, '127.0.0.1'), (error) => error.code === 'EADDRINUSE');
    assert.equal(api.server.listening, false);
    await api.close();
    assert.throws(() => api.db.prepare('SELECT 1').get(), /not open/i);
  } finally {
    occupied.close();
    await api.close();
  }
});

test('limita tentativas repetidas de login por endereço de origem', async () => {
  const throttled = createApiServer({ dbPath: ':memory:', stun: false });
  const address = await throttled.listen(0, '127.0.0.1');
  try {
    const endpoint = 'http://127.0.0.1:' + address.port + '/v1/auth/login';
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unknown@example.com', password: 'incorrect' }) });
      assert.equal(response.status, 401);
    }
    const blocked = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unknown@example.com', password: 'incorrect' }) });
    assert.equal(blocked.status, 429);
  } finally { await throttled.close(); }
});
