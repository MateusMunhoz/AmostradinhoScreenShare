'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiServer } = require('../razze-api/server');
const ROOT = 'test-bootstrap-token-with-thirty-plus-characters';
async function fixture(t, opts = {}) {
  let clock = 1000000;
  const server = createApiServer({ dbPath: ':memory:', adminToken: ROOT, requireApproval: false, stun: false, now: () => clock, ...opts });
  const address = await server.listen(0, '127.0.0.1');
  t.after(() => { server.server.closeAllConnections(); return server.close(); });
  const url = 'http://127.0.0.1:' + address.port;
  const req = async (route, method = 'GET', body, token) => {
    const response = await fetch(url + '/v1/' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ...(await response.json()), status: response.status };
  };
  const register = async name => req('auth/register', 'POST', { email: name + '@test.example', displayName: name, password: 'correct-password-123' });
  return { server, url, req, register, advance: ms => { clock += ms; } };
}
test('heartbeat: amigos online, redes e salas privadas; expiração e logout por sessão', async t => {
  const { req, register, advance } = await fixture(t);
  const a = await register('Alice'), b = await register('Bob'), stranger = await register('Eve');
  const friend = await req('friends/requests', 'POST', { email: b.user.email }, a.accessToken);
  await req('friends/requests/' + friend.id + '/accept', 'POST', undefined, b.accessToken);
  const { network } = await req('networks', 'POST', { name: 'Privada' }, a.accessToken);
  const invitation = await req('networks/' + network.id + '/invites', 'POST', {}, a.accessToken);
  await req('invites/accept', 'POST', { token: invitation.token }, b.accessToken);
  const deviceId = 'a'.repeat(32);
  const { device } = await req('networks/' + network.id + '/devices', 'POST', { deviceId, name: 'PC', publicKey: Buffer.alloc(32,1).toString('base64') }, a.accessToken);
  const heartbeat = { connections: [{ networkId: network.id, deviceId }], room: { id: 'f'.repeat(16), networkId: network.id, host: 'Alice', porta: 8765, pessoas: 2, senha: true } };
  assert.equal((await req('presence/heartbeat', 'POST', heartbeat, a.accessToken)).status, 200);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].online, true);
  const rooms = (await req('rooms', 'GET', undefined, b.accessToken)).rooms;
  assert.equal(rooms.length, 1); assert.equal(rooms[0].endereco, device.assignedIp); assert.equal(rooms[0].senha, true);
  assert.equal((await req('rooms', 'GET', undefined, stranger.accessToken)).rooms.length, 0);
  assert.equal((await req('presence/heartbeat', 'POST', heartbeat, stranger.accessToken)).status, 403);
  const listed = (await req('networks', 'GET', undefined, b.accessToken)).networks[0];
  assert.equal(listed.onlineCount, 1); assert.equal(listed.roomCount, 1);
  // Sala encerrada some na próxima batida, sem colocar o amigo offline.
  await req('presence/heartbeat', 'POST', { ...heartbeat, room: null }, a.accessToken);
  assert.equal((await req('rooms', 'GET', undefined, b.accessToken)).rooms.length, 0);
  await req('presence/heartbeat', 'POST', heartbeat, a.accessToken);
  advance(71000);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].online, false);
  assert.equal((await req('rooms', 'GET', undefined, b.accessToken)).rooms.length, 0);
  await req('presence/heartbeat', 'POST', heartbeat, a.accessToken);
  const second = await req('auth/login', 'POST', { email: a.user.email, password: 'correct-password-123' });
  await req('presence/heartbeat', 'POST', {}, second.accessToken);
  await req('auth/logout', 'POST', undefined, a.accessToken);
  assert.equal((await req('rooms', 'GET', undefined, b.accessToken)).rooms.length, 0);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].online, true);
  await req('presence', 'DELETE', undefined, second.accessToken);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].online, false);
});
test('administradores, aprovação, banimento, auditoria e consulta sanitizada ao banco', async t => {
  const { req, register, url } = await fixture(t);
  const a = await register('Admin'), b = await register('Member');
  assert.equal((await req('admin/users', 'GET', undefined, b.accessToken)).status, 403);
  assert.equal((await req('admin/users/' + a.user.id, 'PATCH', { role: 'admin' }, ROOT)).status, 200);
  assert.equal((await req('admin/me', 'GET', undefined, a.accessToken)).user.role, 'admin');
  assert.equal((await req('admin/users/' + a.user.id, 'PATCH', { role: 'user' }, ROOT)).status, 400);
  assert.equal((await req('admin/settings', 'PATCH', { requireApproval: true }, a.accessToken)).status, 200);
  const pending = await register('Pending'); assert.equal(pending.status, 202);
  assert.equal((await req('admin/users/' + pending.user.id + '/approve', 'POST', undefined, a.accessToken)).status, 200);
  await req('admin/users/' + b.user.id, 'PATCH', { status: 'disabled', banReason: 'Teste' }, a.accessToken);
  assert.equal((await req('me', 'GET', undefined, b.accessToken)).status, 401);
  assert.equal((await req('auth/login', 'POST', { email: b.user.email, password: 'correct-password-123' })).status, 403);
  await req('admin/users/' + b.user.id, 'PATCH', { status: 'active' }, a.accessToken);
  assert.equal((await req('auth/login', 'POST', { email: b.user.email, password: 'correct-password-123' })).status, 200);
  await req('admin/settings', 'PATCH', { registrationOpen: false }, a.accessToken);
  assert.equal((await register('Blocked')).status, 403);
  assert.equal((await req('admin/settings', 'PATCH', { presenceTimeoutSeconds: 3 }, a.accessToken)).status, 400);
  assert.equal((await req('admin/settings', 'PATCH', { unknown: true }, a.accessToken)).status, 400);
  for (const name of ['users', 'sessions', 'invites', 'audit_log']) {
    const page = await req('admin/database/' + name + '?limit=1', 'GET', undefined, a.accessToken);
    assert.equal(page.status, 200); assert.ok(page.rows.length <= 1);
    assert.doesNotMatch(JSON.stringify(page), /password_hash|password_salt|token_hash|accessToken/);
  }
  assert.equal((await req('admin/database/sqlite_master', 'GET', undefined, a.accessToken)).status, 404);
  assert.equal((await req('admin/database/users?offset=-1', 'GET', undefined, a.accessToken)).status, 400);
  const audit = await req('admin/database/audit_log', 'GET', undefined, a.accessToken);
  assert.ok(audit.rows.some(r => r.action === 'user.update' && r.target === b.user.id));
  const page = await fetch(url + '/admin/'); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /Clientes/);
});
test('clientes: uma conta mantém somente uma sessão ativa', async t => {
  const { req, register } = await fixture(t);
  const a = await register('Alice');

  const second = await req('auth/login', 'POST', {
    email: a.user.email,
    password: 'correct-password-123'
  });

  assert.notEqual(a.accessToken, second.accessToken);

  await req('presence/heartbeat', 'POST', {}, a.accessToken);
  await req('presence/heartbeat', 'POST', {}, second.accessToken);

  const clients = (await req('admin/clients', 'GET', undefined, ROOT)).clients;

  assert.equal(clients.length, 1);
  assert.equal(clients.filter(c => c.online).length, 1);

  const overview = await req('admin/overview', 'GET', undefined, ROOT);
  assert.equal(overview.connectedClients, 1);
  assert.equal(overview.online, 1);

  const statuses = [
    (await req('me', 'GET', undefined, a.accessToken)).status,
    (await req('me', 'GET', undefined, second.accessToken)).status
  ].sort();

  assert.deepEqual(statuses, [200, 401]);
});
test('configurações persistem após reiniciar e presença exige nova confirmação', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-control-'));
  const dbPath = path.join(temp, 'data.sqlite');
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const first = await fixture(t, { dbPath });
  const a = await first.register('Alice');
  await first.req('admin/settings', 'PATCH', { requireApproval: true, presenceTimeoutSeconds: 90 }, ROOT);
  await first.req('presence/heartbeat', 'POST', {}, a.accessToken);
  await first.server.close();
  const second = await fixture(t, { dbPath });
  assert.equal((await second.req('admin/settings', 'GET', undefined, ROOT)).settings.requireApproval, true);
  assert.equal((await second.req('admin/overview', 'GET', undefined, ROOT)).online, 0);
  assert.equal((await second.register('Pending')).status, 202);
  await second.server.close();
});

test('sala do modo Internet: só os amigos aceitos veem, sem rede nem VPN, e some ao fechar ou expirar', async t => {
  const { req, register, advance } = await fixture(t);
  const a = await register('Ana'), b = await register('Bia'), stranger = await register('Eve');
  const friend = await req('friends/requests', 'POST', { email: b.user.email }, a.accessToken);
  await req('friends/requests/' + friend.id + '/accept', 'POST', undefined, b.accessToken);
  const passe = 'x'.repeat(43);
  const internetRoom = { servidor: 'ws://203.0.113.5:8765', codigo: 'ABC234', pessoas: 2, passe };
  assert.equal((await req('presence/heartbeat', 'POST', { internetRoom }, a.accessToken)).status, 200);
  const seen = (await req('rooms', 'GET', undefined, b.accessToken)).internet;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].host, 'Ana'); assert.equal(seen[0].codigo, 'ABC234'); assert.equal(seen[0].passe, passe);
  assert.equal((await req('rooms', 'GET', undefined, stranger.accessToken)).internet.length, 0);
  assert.equal((await req('rooms', 'GET', undefined, a.accessToken)).internet.length, 0); // a própria sala não aparece
  for (const bad of [{ ...internetRoom, servidor: 'https://x.com' }, { ...internetRoom, codigo: 'abc' }, { ...internetRoom, passe: 'curto' }, { ...internetRoom, pessoas: 0 }]) {
    assert.equal((await req('presence/heartbeat', 'POST', { internetRoom: bad }, a.accessToken)).status, 400);
  }
  await req('presence/heartbeat', 'POST', {}, a.accessToken);
  assert.equal((await req('rooms', 'GET', undefined, b.accessToken)).internet.length, 0);
  await req('presence/heartbeat', 'POST', { internetRoom }, a.accessToken);
  advance(71000);
  assert.equal((await req('rooms', 'GET', undefined, b.accessToken)).internet.length, 0);
  // Admin não vê o passe pelo banco
  const page = await req('admin/database/live_presence', 'GET', undefined, ROOT);
  assert.doesNotMatch(JSON.stringify(page), new RegExp(passe));
});

test('mensagens criptografadas: chave pública por conta, entregue só aos amigos; texto cifrado longo aceito', async t => {
  const { req, register } = await fixture(t);
  const a = await register('Ana'), b = await register('Bia'), stranger = await register('Eve');
  const friend = await req('friends/requests', 'POST', { email: b.user.email }, a.accessToken);
  await req('friends/requests/' + friend.id + '/accept', 'POST', undefined, b.accessToken);
  const key = Buffer.alloc(32, 7).toString('base64');
  assert.equal((await req('me/dm-key', 'PUT', { publicKey: 'curta' }, a.accessToken)).status, 400);
  assert.equal((await req('me/dm-key', 'PUT', { publicKey: key }, a.accessToken)).status, 200);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].dmKey, key);
  assert.equal((await req('friends', 'GET', undefined, a.accessToken)).friends[0].dmKey, null);
  assert.equal((await req('friends', 'GET', undefined, stranger.accessToken)).friends.length, 0);
  const longE2e = 'e2e1:' + 'A'.repeat(8000);
  assert.equal((await req('messages', 'POST', { to: b.user.id, text: longE2e }, a.accessToken)).status, 201);
  assert.equal((await req('messages', 'POST', { to: b.user.id, text: 'x'.repeat(2001) }, a.accessToken)).status, 400);
  assert.equal((await req('messages', 'POST', { to: b.user.id, text: 'e2e1:' + 'A'.repeat(9001) }, a.accessToken)).status, 400);
  assert.equal((await req('messages', 'GET', undefined, b.accessToken)).messages[0].text, longE2e);
});
