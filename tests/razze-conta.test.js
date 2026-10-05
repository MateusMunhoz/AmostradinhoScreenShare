'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApiServer } = require('../razze-api/server');

const ADMIN = 'razze-admin-test-token-with-at-least-thirty-characters';
let api;
let baseUrl;
let clock = 5_000_000;
let eva, fabio;

async function request(path, options = {}, token) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const response = await fetch(baseUrl + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status: response.status, body: await response.json() };
}

async function newUser(name) {
  const email = name.toLowerCase() + '@example.com';
  const reg = await request('/v1/auth/register', { method: 'POST', body: { email, displayName: name, password: 'senha-' + name + '-1' } });
  if (reg.status === 202) await request('/v1/admin/users/' + reg.body.user.id + '/approve', { method: 'POST' }, ADMIN);
  const login = (await request('/v1/auth/login', { method: 'POST', body: { email, password: 'senha-' + name + '-1' } })).body;
  return { ...login, email };
}

before(async () => {
  api = createApiServer({ dbPath: ':memory:', tokenTtlMs: 60 * 60 * 1000 * 24 * 30, adminToken: ADMIN, stunPort: 0, now: () => clock });
  const address = await api.listen(0, '127.0.0.1');
  baseUrl = 'http://127.0.0.1:' + address.port;
  eva = await newUser('Eva');
  fabio = await newUser('Fabio');
});

after(async () => { if (api) await api.close(); });

test('frase do perfil: salva, limpa e limita; só ela pode ser alterada', async () => {
  assert.equal((await request('/v1/me', {}, eva.accessToken)).body.user.bio, '');
  const ok = await request('/v1/me', { method: 'PATCH', body: { bio: '  Jogo à noite\n e ouço rock  ' } }, eva.accessToken);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.bio, 'Jogo à noite e ouço rock');
  assert.equal((await request('/v1/me', { method: 'PATCH', body: { bio: 'x'.repeat(129) } }, eva.accessToken)).status, 400);
  assert.equal((await request('/v1/me', { method: 'PATCH', body: { bio: 'x'.repeat(128) } }, eva.accessToken)).status, 200);
  assert.equal((await request('/v1/me', { method: 'PATCH', body: { bio: 5 } }, eva.accessToken)).status, 400);
  assert.equal((await request('/v1/me', { method: 'PATCH', body: { displayName: 'Outro' } }, eva.accessToken)).status, 400);
  assert.equal((await request('/v1/me', { method: 'PATCH', body: { bio: 'x' } })).status, 401);
  await request('/v1/me', { method: 'PATCH', body: { bio: 'Jogo à noite' } }, eva.accessToken);
});

test('os amigos veem a frase do perfil', async () => {
  const sent = await request('/v1/friends/requests', { method: 'POST', body: { email: 'eva@example.com' } }, fabio.accessToken);
  await request('/v1/friends/requests/' + sent.body.id + '/accept', { method: 'POST' }, eva.accessToken);
  const list = (await request('/v1/friends', {}, fabio.accessToken)).body.friends;
  assert.equal(list[0].bio, 'Jogo à noite');
});

test('trocar a senha pede a atual, vale na hora e a sessão que trocou continua', async () => {
  const errada = await request('/v1/me/password', { method: 'POST', body: { currentPassword: 'errada', newPassword: 'nova-senha-123' } }, eva.accessToken);
  assert.equal(errada.status, 401);
  assert.equal((await request('/v1/me/password', { method: 'POST', body: { currentPassword: 'senha-Eva-1', newPassword: 'curta' } }, eva.accessToken)).status, 400);
  const feita = await request('/v1/me/password', { method: 'POST', body: { currentPassword: 'senha-Eva-1', newPassword: 'nova-senha-123' } }, eva.accessToken);
  assert.equal(feita.status, 200);
  assert.equal((await request('/v1/me', {}, eva.accessToken)).status, 200); // a sessão que trocou continua
  assert.equal((await request('/v1/auth/login', { method: 'POST', body: { email: eva.email, password: 'senha-Eva-1' } })).status, 401);
  const novo = await request('/v1/auth/login', { method: 'POST', body: { email: eva.email, password: 'nova-senha-123' } });
  assert.equal(novo.status, 200);
  eva = { ...novo.body, email: eva.email };
});

test('esqueci a senha: o administrador gera o código, uso único, expira e erra no máximo 5 vezes', async () => {
  const evaId = eva.user.id;
  assert.equal((await request('/v1/admin/users/' + evaId + '/reset-code', { method: 'POST' })).status, 401); // sem o token de admin
  const gen = await request('/v1/admin/users/' + evaId + '/reset-code', { method: 'POST' }, ADMIN);
  assert.equal(gen.status, 200);
  assert.match(gen.body.code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.equal(gen.body.expiresAt, clock + 60 * 60 * 1000);
  // código errado conta tentativa; e-mail errado não revela nada
  const bad = await request('/v1/auth/reset', { method: 'POST', body: { email: eva.email, code: 'AAAA-BBBB', password: 'outra-senha-1' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'reset_invalid');
  assert.equal((await request('/v1/auth/reset', { method: 'POST', body: { email: 'ninguem@example.com', code: gen.body.code, password: 'outra-senha-1' } })).status, 400);
  // o certo, em qualquer caixa e sem hífen, redefine e derruba as sessões
  const ok = await request('/v1/auth/reset', { method: 'POST', body: { email: eva.email, code: gen.body.code.toLowerCase().replace('-', ''), password: 'senha-redefinida-9' } });
  assert.equal(ok.status, 200);
  assert.equal((await request('/v1/me', {}, eva.accessToken)).status, 401);
  assert.equal((await request('/v1/auth/login', { method: 'POST', body: { email: eva.email, password: 'senha-redefinida-9' } })).status, 200);
  // uso único
  assert.equal((await request('/v1/auth/reset', { method: 'POST', body: { email: eva.email, code: gen.body.code, password: 'mais-uma-senha-1' } })).status, 400);
});

test('o código expira em 1 hora e some depois de 5 erros', async () => {
  const id = fabio.user.id;
  const a = (await request('/v1/admin/users/' + id + '/reset-code', { method: 'POST' }, ADMIN)).body;
  clock += 60 * 60 * 1000 + 1;
  assert.equal((await request('/v1/auth/reset', { method: 'POST', body: { email: fabio.email, code: a.code, password: 'senha-nova-123' } })).status, 400);
  const b = (await request('/v1/admin/users/' + id + '/reset-code', { method: 'POST' }, ADMIN)).body;
  for (let i = 0; i < 5; i++) await request('/v1/auth/reset', { method: 'POST', body: { email: fabio.email, code: 'ZZZZ-ZZZZ', password: 'senha-nova-123' } });
  assert.equal((await request('/v1/auth/reset', { method: 'POST', body: { email: fabio.email, code: b.code, password: 'senha-nova-123' } })).status, 400); // certo, mas já queimou
  assert.equal((await request('/v1/auth/login', { method: 'POST', body: { email: fabio.email, password: 'senha-Fabio-1' } })).status, 200); // a senha antiga segue valendo
});

test('atividade: só os amigos veem, limpa o texto, some em 2 minutos e apaga com tudo vazio', async () => {
  // Eva e Fábio são amigos (teste anterior); Gui não é amigo de ninguém
  const gui = await newUser('Gui');
  // as sessões dos testes anteriores foram trocadas: entra de novo
  eva = { ...(await request('/v1/auth/login', { method: 'POST', body: { email: eva.email, password: 'senha-redefinida-9' } })).body, email: eva.email };
  fabio = { ...(await request('/v1/auth/login', { method: 'POST', body: { email: fabio.email, password: 'senha-Fabio-1' } })).body, email: fabio.email };
  const antes = (await request('/v1/friends', {}, fabio.accessToken)).body.friends.find((f) => f.displayName === 'Eva');
  assert.equal(antes.activity, null);
  const salva = await request('/v1/me/activity', { method: 'PUT', body: { game: ' Valorant ', artist: 'Metallica', title: 'One\n(Remastered)' } }, eva.accessToken);
  assert.equal(salva.status, 200);
  const vista = (await request('/v1/friends', {}, fabio.accessToken)).body.friends.find((f) => f.displayName === 'Eva');
  assert.deepEqual(vista.activity, { game: 'Valorant', artist: 'Metallica', title: 'One (Remastered)' });
  assert.equal((await request('/v1/friends', {}, gui.accessToken)).body.friends.length, 0); // quem não é amigo não vê nada
  // validação
  assert.equal((await request('/v1/me/activity', { method: 'PUT', body: { game: 'x'.repeat(81) } }, eva.accessToken)).status, 400);
  assert.equal((await request('/v1/me/activity', { method: 'PUT', body: { game: 5 } }, eva.accessToken)).status, 400);
  assert.equal((await request('/v1/me/activity', { method: 'PUT', body: { cpf: '1' } }, eva.accessToken)).status, 400);
  assert.equal((await request('/v1/me/activity', { method: 'PUT', body: { game: 'a' } })).status, 401);
  // expira em 2 minutos sem renovar
  clock += 2 * 60 * 1000 + 1;
  assert.equal((await request('/v1/friends', {}, fabio.accessToken)).body.friends.find((f) => f.displayName === 'Eva').activity, null);
  // tudo vazio apaga
  await request('/v1/me/activity', { method: 'PUT', body: { game: 'Dota 2' } }, eva.accessToken);
  assert.equal((await request('/v1/friends', {}, fabio.accessToken)).body.friends.find((f) => f.displayName === 'Eva').activity.game, 'Dota 2');
  await request('/v1/me/activity', { method: 'PUT', body: {} }, eva.accessToken);
  assert.equal((await request('/v1/friends', {}, fabio.accessToken)).body.friends.find((f) => f.displayName === 'Eva').activity, null);
});
