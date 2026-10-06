'use strict';

// Conta só pelo Google, lista de convidados, grupos e números do painel (docs/spec/conta-so-google-e-admin.md)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApiServer } = require('../razze-api/server');

const ADMIN = 'razze-admin-test-token-with-at-least-thirty-characters';
const CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';
let api;
let baseUrl;
let clock = 20_000_000;
const contas = new Map();
const jwt = (payload) => 'h.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.s';
const idToken = (extra = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(clock / 1000) + 3600, email_verified: true, ...extra });

async function request(path, options = {}, token) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const response = await fetch(baseUrl + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status: response.status, body: await response.json() };
}
const settings = (body) => request('/v1/admin/settings', { method: 'PATCH', body }, ADMIN);
const zerarLimite = () => { clock += 11 * 60 * 1000; };
let seq = 0;
async function google(email, name = 'Pessoa') {
  const code = 'codigo-teste-' + (++seq) + '-' + email;
  contas.set(code, idToken({ sub: 'g-' + email, email, name }));
  return request('/v1/auth/google', { method: 'POST', body: { code, codeVerifier: 'v'.repeat(64), redirectUri: 'http://127.0.0.1:53211/callback' } });
}
const lista = async (path) => (await request(path, {}, ADMIN)).body;

before(async () => {
  api = createApiServer({
    dbPath: ':memory:', tokenTtlMs: 60 * 60 * 1000 * 24 * 30, adminToken: ADMIN, stunPort: 0, now: () => clock, googleClientId: CLIENT_ID, googleClientSecret: 'segredo',
    googleExchange: async (p) => { const c = contas.get(p.code); if (!c) throw new Error('invalid_grant'); return { id_token: jwt(c) }; },
  });
  const address = await api.listen(0, '127.0.0.1');
  baseUrl = 'http://127.0.0.1:' + address.port;
});
after(async () => { if (api) await api.close(); });

test('só Google: cadastro e entrada por senha fecham, mas o Google continua abrindo conta', async () => {
  // Uma conta com senha criada antes (e o administrador, que continua entrando por senha)
  await settings({ requireApproval: false });
  const velho = await request('/v1/auth/register', { method: 'POST', body: { email: 'velho@exemplo.com', password: 'senha-longa-123', displayName: 'Velho' } });
  assert.equal(velho.status, 201);
  const adm = await request('/v1/auth/register', { method: 'POST', body: { email: 'adm@exemplo.com', password: 'senha-longa-123', displayName: 'Adm' } });
  await request('/v1/admin/users/' + adm.body.user.id, { method: 'PATCH', body: { role: 'admin' } }, ADMIN);
  await settings({ googleOnly: true });
  zerarLimite();
  // Sem resetar o banco: quem já tinha conta com senha continua entrando enquanto legacyPasswordLogin estiver ligado
  assert.equal((await request('/v1/auth/login', { method: 'POST', body: { email: 'velho@exemplo.com', password: 'senha-longa-123' } })).status, 200);
  await settings({ legacyPasswordLogin: false });
  zerarLimite();

  const reg = await request('/v1/auth/register', { method: 'POST', body: { email: 'novo@exemplo.com', password: 'senha-longa-123', displayName: 'Novo' } });
  assert.equal(reg.status, 403);
  assert.equal(reg.body.error.code, 'google_only');
  const login = await request('/v1/auth/login', { method: 'POST', body: { email: 'velho@exemplo.com', password: 'senha-longa-123' } });
  assert.equal(login.status, 403);
  assert.equal(login.body.error.code, 'google_only');
  const loginAdmin = await request('/v1/auth/login', { method: 'POST', body: { email: 'adm@exemplo.com', password: 'senha-longa-123' } });
  assert.equal(loginAdmin.status, 200, 'o administrador entra pelo painel com a senha');

  const g = await google('Ana@Gmail.com', 'Ana');
  assert.equal(g.status, 201);
  assert.equal(g.body.user.email, 'ana@gmail.com');
  assert.equal(g.body.user.role, 'user');
  await settings({ googleOnly: false, legacyPasswordLogin: true });
});

test('lista de convidados: entra direto, com o grupo e o papel combinados, mesmo exigindo aprovação', async () => {
  await settings({ requireApproval: true, googleOnly: true });
  assert.equal((await request('/v1/admin/allowlist', { method: 'POST', body: { email: 'Cris@Gmail.com', grupo: 'admin', label: 'Cristian' } }, ADMIN)).status, 200);
  assert.equal((await request('/v1/admin/allowlist', { method: 'POST', body: { email: 'bia@gmail.com', grupo: 'teste' } }, ADMIN)).status, 200);

  const cris = await google('cris@gmail.com', 'Cristian');
  assert.equal(cris.status, 201, 'o convidado não espera aprovação');
  assert.equal(cris.body.user.role, 'admin');
  const bia = await google('bia@gmail.com', 'Bia');
  assert.equal(bia.status, 201);

  const users = (await lista('/v1/admin/users')).users;
  assert.equal(users.find((u) => u.email === 'bia@gmail.com').grupo, 'teste');
  assert.equal(users.find((u) => u.email === 'cris@gmail.com').role, 'admin');

  // Quem não está na lista cai na aprovação e aparece como pendente
  const ze = await google('ze@gmail.com', 'Zé');
  assert.equal(ze.status, 202);
  assert.equal(ze.body.status, 'pending_approval');
  assert.equal((await lista('/v1/admin/users')).users.find((u) => u.email === 'ze@gmail.com').status, 'pending');

  // Pôr um pendente na lista libera e define o grupo
  await request('/v1/admin/allowlist', { method: 'POST', body: { email: 'ze@gmail.com', grupo: 'amigo' } }, ADMIN);
  const ativo = (await lista('/v1/admin/users')).users.find((u) => u.email === 'ze@gmail.com');
  assert.equal(ativo.status, 'active');
  assert.equal(ativo.grupo, 'amigo');
  await settings({ requireApproval: false, googleOnly: false });
});

test('só convidados: e-mail fora da lista não cria conta; sair da lista não apaga quem já entrou', async () => {
  await settings({ onlyAllowlist: true });
  const fora = await google('fora@gmail.com', 'Fora');
  assert.equal(fora.status, 403);
  assert.equal(fora.body.error.code, 'not_allowed');
  assert.equal((await lista('/v1/admin/users')).users.some((u) => u.email === 'fora@gmail.com'), false);

  const antes = (await lista('/v1/admin/allowlist')).allowlist;
  assert.equal(antes.find((a) => a.email === 'bia@gmail.com').joined, true);
  assert.equal((await request('/v1/admin/allowlist/' + encodeURIComponent('bia@gmail.com'), { method: 'DELETE' }, ADMIN)).status, 200);
  assert.equal((await request('/v1/admin/allowlist/' + encodeURIComponent('bia@gmail.com'), { method: 'DELETE' }, ADMIN)).status, 404);
  assert.equal((await lista('/v1/admin/users')).users.find((u) => u.email === 'bia@gmail.com').status, 'active');
  await settings({ onlyAllowlist: false });
});

test('a lista valida o e-mail, o grupo e o texto, e só o administrador mexe', async () => {
  const post = (body, token = ADMIN) => request('/v1/admin/allowlist', { method: 'POST', body }, token);
  assert.equal((await post({ email: 'nao-e-email' })).status, 400);
  assert.equal((await post({ email: 'x@y.com', grupo: 'rei' })).status, 400);
  assert.equal((await post({ email: 'x@y.com', label: 'a'.repeat(61) })).status, 400);
  assert.equal((await post({ email: 'x@y.com', label: 'oi\u0007' })).status, 400);
  const comum = await google('comum@gmail.com', 'Comum');
  const token = comum.body.accessToken || (await google('comum@gmail.com')).body.accessToken;
  assert.equal((await post({ email: 'x@y.com' }, token)).status, 403);
  assert.equal((await request('/v1/admin/analytics', {}, token)).status, 403);
});

test('grupo da conta muda pelo painel e só aceita amigo ou teste', async () => {
  const bia = (await lista('/v1/admin/users')).users.find((u) => u.email === 'bia@gmail.com');
  assert.equal((await request('/v1/admin/users/' + bia.id, { method: 'PATCH', body: { grupo: 'amigo' } }, ADMIN)).body.user.grupo, 'amigo');
  assert.equal((await request('/v1/admin/users/' + bia.id, { method: 'PATCH', body: { grupo: 'admin' } }, ADMIN)).status, 400);
});

test('números do painel: contas, uso por dia, pico, versões e quem nunca abriu', async () => {
  const bia = await google('bia@gmail.com', 'Bia');
  assert.equal(bia.status, 200);
  const beat = (token, body = {}) => request('/v1/presence/heartbeat', { method: 'POST', body: { clientName: 'Tela P2P', ...body } }, token);
  assert.equal((await beat(bia.body.accessToken, { appVersion: '1.18.0' })).status, 200);
  const cris = await google('cris@gmail.com', 'Cristian');
  assert.equal((await beat(cris.body.accessToken, { appVersion: '1.18.1' })).status, 200);
  assert.equal((await beat(cris.body.accessToken, { appVersion: 'drop table' })).status, 200, 'versão estranha é ignorada, não derruba');

  const a = (await request('/v1/admin/analytics', {}, ADMIN)).body;
  assert.equal(a.usage.online, 2);
  assert.equal(a.usage.today, 2);
  assert.equal(a.usage.peakToday, 2);
  assert.ok(a.accounts.total >= 5);
  assert.equal(a.accounts.admins >= 2, true);
  assert.deepEqual(a.versions.map((v) => v.version).sort(), ['1.18.0', '1.18.1']);
  assert.equal(a.daily.length, 14);
  assert.equal(a.daily.at(-1).active, 2);
  assert.ok(a.daily.at(-1).signups >= 1);
  assert.ok(a.usage.neverUsed >= 1, 'quem criou conta e nunca abriu aparece');
  assert.equal(JSON.stringify(a).includes('@'), false, 'nenhum e-mail nos números');
});

test('a lista de convidados não promove conta cujo e-mail o Google não confirmou', async () => {
  await settings({ requireApproval: false, googleOnly: false });
  zerarLimite();
  const vincular = (token, email) => {
    const code = 'codigo-vinculo-' + (++seq) + '-' + email;
    contas.set(code, idToken({ sub: 'g-' + email, email, name: 'Pessoa' }));
    return request('/v1/me/google', { method: 'POST', body: { code, codeVerifier: 'v'.repeat(64), redirectUri: 'http://127.0.0.1:53211/callback' } }, token);
  };
  // Alguém registra por senha o e-mail de um futuro administrador e ainda vincula o próprio Google (outro e-mail)
  const pirata = await request('/v1/auth/register', { method: 'POST', body: { email: 'futuro-admin@gmail.com', password: 'senha-longa-123', displayName: 'Pirata' } });
  assert.equal(pirata.status, 201);
  assert.equal((await vincular(pirata.body.accessToken, 'pirata@gmail.com')).status, 200);
  const add = await request('/v1/admin/allowlist', { method: 'POST', body: { email: 'futuro-admin@gmail.com', grupo: 'admin' } }, ADMIN);
  assert.equal(add.status, 200);
  assert.equal(add.body.semGoogle, true, 'o painel fica sabendo que a conta não foi promovida');
  assert.equal((await request('/v1/admin/me', {}, pirata.body.accessToken)).status, 403);
  assert.equal((await lista('/v1/admin/users')).users.find((u) => u.email === 'futuro-admin@gmail.com').role, 'user');

  // Conta antiga com senha que vincula o Google do mesmo e-mail continua sendo promovida
  const legado = await request('/v1/auth/register', { method: 'POST', body: { email: 'legado@gmail.com', password: 'senha-longa-123', displayName: 'Legado' } });
  assert.equal((await vincular(legado.body.accessToken, 'legado@gmail.com')).status, 200);
  const ok = await request('/v1/admin/allowlist', { method: 'POST', body: { email: 'legado@gmail.com', grupo: 'admin' } }, ADMIN);
  assert.equal(ok.body.semGoogle, undefined);
  assert.equal((await request('/v1/admin/me', {}, legado.body.accessToken)).status, 200);
});

test('painel mostra quem vinculou o Google; sem senha, o 409 não manda entrar com a senha', async () => {
  await settings({ requireApproval: false, googleOnly: false, legacyPasswordLogin: true });
  zerarLimite();
  const semVinculo = await request('/v1/auth/register', { method: 'POST', body: { email: 'so-senha@gmail.com', password: 'senha-longa-123', displayName: 'Só senha' } });
  assert.equal(semVinculo.status, 201);
  const users = (await lista('/v1/admin/users')).users;
  assert.equal(users.find((u) => u.email === 'so-senha@gmail.com').googleLinked, false);
  assert.equal(users.find((u) => u.email === 'legado@gmail.com').googleLinked, true);

  assert.match((await google('so-senha@gmail.com')).body.error.message, /Entre com a senha/);
  await settings({ googleOnly: true, legacyPasswordLogin: false });
  const travado = await google('so-senha@gmail.com');
  assert.equal(travado.status, 409);
  assert.equal(travado.body.error.code, 'account_exists');
  assert.doesNotMatch(travado.body.error.message, /Entre com a senha/);
  assert.match(travado.body.error.message, /administrador/);
  await settings({ googleOnly: false, legacyPasswordLogin: true });
});
