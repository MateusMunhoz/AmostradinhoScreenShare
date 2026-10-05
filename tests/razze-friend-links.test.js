'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApiServer } = require('../razze-api/server');

let api;
let baseUrl;
let clock = 1_000_000;
let ana, caio, dora;

async function request(path, options = {}, token) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const response = await fetch(baseUrl + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, body, headers: response.headers };
}

async function newUser(name) {
  const email = name.toLowerCase() + '@example.com';
  const reg = await request('/v1/auth/register', { method: 'POST', body: { email, displayName: name, password: 'segredo-' + name } });
  assert.ok([201, 202].includes(reg.status));
  if (reg.status === 202) await request('/v1/admin/users/' + reg.body.user.id + '/approve', { method: 'POST' }, 'razze-admin-test-token-with-at-least-thirty-characters');
  return (await request('/v1/auth/login', { method: 'POST', body: { email, password: 'segredo-' + name } })).body;
}

before(async () => {
  api = createApiServer({ dbPath: ':memory:', tokenTtlMs: 60 * 60 * 1000 * 24 * 30, adminToken: 'razze-admin-test-token-with-at-least-thirty-characters', stunPort: 0, now: () => clock, publicUrl: 'https://razze.example/' });
  const address = await api.listen(0, '127.0.0.1');
  baseUrl = 'http://127.0.0.1:' + address.port;
  ana = await newUser('Ana');
  caio = await newUser('Caio');
  dora = await newUser('Dora');
});

after(async () => { if (api) await api.close(); });

const friendsOf = async (user) => (await request('/v1/friends', {}, user.accessToken)).body.friends.map((f) => f.displayName).sort();

test('criar link devolve segredo, código curto e endereço; o banco guarda só hashes', async () => {
  const made = await request('/v1/friends/links', { method: 'POST' }, ana.accessToken);
  assert.equal(made.status, 201);
  assert.match(made.body.token, /^[A-Za-z0-9_-]{20,120}$/);
  assert.match(made.body.code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{2}$/);
  assert.equal(made.body.url, 'https://razze.example/a/' + made.body.token);
  assert.equal(made.body.appLink, 'telap2p://amigo/' + made.body.token);
  assert.equal(made.body.maxUses, 1);
  assert.equal(made.body.expiresAt, clock + 7 * 24 * 60 * 60 * 1000);
  const listed = await request('/v1/friends/links', {}, ana.accessToken);
  assert.equal(listed.body.links.length, 1);
  assert.equal(JSON.stringify(listed.body).includes(made.body.token), false);
  await request('/v1/friends/links/' + made.body.id, { method: 'DELETE' }, ana.accessToken);
});

test('quem recebe vê o nome, aceita e os dois viram amigos; uso único', async () => {
  const made = (await request('/v1/friends/links', { method: 'POST' }, ana.accessToken)).body;
  const preview = await request('/v1/friends/links/preview?token=' + made.token, {}, caio.accessToken);
  assert.deepEqual(preview.body, { displayName: 'Ana', own: false, alreadyFriends: false });
  const accepted = await request('/v1/friends/links/accept', { method: 'POST', body: { token: made.token } }, caio.accessToken);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, 'accepted');
  assert.equal(accepted.body.friend.displayName, 'Ana');
  assert.deepEqual(await friendsOf(ana), ['Caio']);
  assert.deepEqual(await friendsOf(caio), ['Ana']);
  // a terceira pessoa não consegue usar o mesmo link (1 uso)
  const again = await request('/v1/friends/links/accept', { method: 'POST', body: { token: made.token } }, dora.accessToken);
  assert.equal(again.status, 404);
  assert.equal(again.body.error.code, 'link_invalid');
  // quem já é amigo pode abrir de novo sem erro e sem gastar nada
  const repeat = await request('/v1/friends/links/accept', { method: 'POST', body: { token: made.token } }, caio.accessToken);
  assert.equal(repeat.status, 200);
  assert.deepEqual(await friendsOf(ana), ['Caio']);
});

test('o código curto vale, com hífen ou sem, em qualquer caixa', async () => {
  const made = (await request('/v1/friends/links', { method: 'POST' }, caio.accessToken)).body;
  const typed = made.code.toLowerCase().replace(/-/g, ' ');
  const accepted = await request('/v1/friends/links/accept', { method: 'POST', body: { token: typed } }, dora.accessToken);
  assert.equal(accepted.status, 200);
  assert.deepEqual(await friendsOf(dora), ['Caio']);
});

test('o próprio link, link inventado, revogado e expirado não criam amizade', async () => {
  const made = (await request('/v1/friends/links', { method: 'POST' }, dora.accessToken)).body;
  const own = await request('/v1/friends/links/accept', { method: 'POST', body: { token: made.token } }, dora.accessToken);
  assert.equal(own.status, 400);
  assert.equal(own.body.error.code, 'own_link');
  assert.equal((await request('/v1/friends/links/accept', { method: 'POST', body: { token: 'x'.repeat(32) } }, ana.accessToken)).status, 404);
  assert.equal((await request('/v1/friends/links/accept', { method: 'POST', body: { token: 'curto' } }, ana.accessToken)).status, 404);
  assert.equal((await request('/v1/friends/links/accept', { method: 'POST', body: {} }, ana.accessToken)).status, 404);
  const revoked = await request('/v1/friends/links/' + made.id, { method: 'DELETE' }, dora.accessToken);
  assert.equal(revoked.status, 200);
  assert.equal((await request('/v1/friends/links/accept', { method: 'POST', body: { token: made.token } }, ana.accessToken)).status, 404);
  const old = (await request('/v1/friends/links', { method: 'POST' }, dora.accessToken)).body;
  clock += 7 * 24 * 60 * 60 * 1000 + 1;
  assert.equal((await request('/v1/friends/links/accept', { method: 'POST', body: { token: old.token } }, ana.accessToken)).status, 404);
  assert.deepEqual(await friendsOf(ana), ['Caio']);
});

test('só o dono revoga o link e há no máximo 5 ativos', async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await request('/v1/friends/links', { method: 'POST' }, ana.accessToken)).body.id);
  const sixth = await request('/v1/friends/links', { method: 'POST' }, ana.accessToken);
  assert.equal(sixth.status, 409);
  assert.equal(sixth.body.error.code, 'too_many_links');
  assert.equal((await request('/v1/friends/links/' + ids[0], { method: 'DELETE' }, caio.accessToken)).status, 404);
  assert.equal((await request('/v1/friends/links/' + ids[0], { method: 'DELETE' }, ana.accessToken)).status, 200);
  assert.equal((await request('/v1/friends/links', { method: 'POST' }, ana.accessToken)).status, 201);
});

test('exige login para criar, ver e aceitar', async () => {
  assert.equal((await request('/v1/friends/links', { method: 'POST' })).status, 401);
  assert.equal((await request('/v1/friends/links/preview?token=' + 'a'.repeat(30))).status, 401);
  assert.equal((await request('/v1/friends/links/accept', { method: 'POST', body: { token: 'a'.repeat(30) } })).status, 401);
});

test('a página /a/<token> abre o app e leva ao download, sem login nem script', async () => {
  const token = 'Abc123_-' + 'x'.repeat(24);
  const page = await request('/a/' + token);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.ok(page.body.includes('href="telap2p://amigo/' + token + '"'));
  assert.ok(page.body.includes('releases/latest'));
  assert.equal(page.body.includes('<script'), false);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(page.body.includes('Ana'), false); // não revela quem convidou
  assert.equal((await request('/a/curto')).status, 404);
  assert.equal((await request('/a/' + token + '%22%3E%3Cscript')).status, 404); // nada de injeção pelo caminho
});

test('o cliente do app (main/razze-api-client.js) cria, vê, aceita, lista e revoga', async () => {
  const { RazzeApiClient } = require('../main/razze-api-client');
  const a = new RazzeApiClient(baseUrl);
  const b = new RazzeApiClient(baseUrl);
  a.setAccessToken(ana.accessToken);
  b.setAccessToken(dora.accessToken);
  // limpa os links ativos que os testes acima deixaram
  for (const l of (await a.friendLinkList()).links) await a.friendLinkRevoke(l.id);
  const made = await a.friendLinkCreate();
  assert.equal((await a.friendLinkList()).links.length, 1);
  const preview = await b.friendLinkPreview(made.code);
  assert.equal(preview.displayName, 'Ana');
  const accepted = await b.friendLinkAccept(made.token);
  assert.equal(accepted.friend.displayName, 'Ana');
  await a.friendLinkRevoke(made.id);
  assert.equal((await a.friendLinkList()).links.length, 0);
  await assert.rejects(() => b.friendLinkPreview('x'.repeat(30)), /expirou|disponível/);
});
