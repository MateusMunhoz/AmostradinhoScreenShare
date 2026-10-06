'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApiServer } = require('../razze-api/server');

const ADMIN = 'razze-admin-test-token-with-at-least-thirty-characters';
const CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';
let api;
let baseUrl;
let clock = 9_000_000;
// O "Google" dos testes: cada código vira uma identidade; a função devolve o que o endpoint de tokens devolveria
const contas = new Map();
const trocas = [];
const jwt = (payload) => 'h.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.s';
const idToken = (extra = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(clock / 1000) + 3600, email_verified: true, ...extra });

async function request(path, options = {}, token) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const response = await fetch(baseUrl + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status: response.status, body: await response.json() };
}
const pedido = (code) => ({ code, codeVerifier: 'v'.repeat(64), redirectUri: 'http://127.0.0.1:53211/callback' });
const entrarComGoogle = (code) => request('/v1/auth/google', { method: 'POST', body: pedido(code) });

before(async () => {
  api = createApiServer({
    dbPath: ':memory:', tokenTtlMs: 60 * 60 * 1000 * 24 * 30, adminToken: ADMIN, stunPort: 0, now: () => clock, googleClientId: CLIENT_ID, googleClientSecret: 'segredo',
    googleExchange: async (p) => {
      trocas.push(p);
      const c = contas.get(p.code);
      if (!c) throw new Error('invalid_grant');
      return { id_token: jwt(c) };
    },
  });
  const address = await api.listen(0, '127.0.0.1');
  baseUrl = 'http://127.0.0.1:' + address.port;
  await request('/v1/admin/settings', { method: 'PATCH', body: { requireApproval: false } }, ADMIN).catch(() => {});
});

after(async () => { if (api) await api.close(); });
// O limite de tentativas erradas é por IP a cada 10 min: cada teste começa com ele zerado
const zerarLimite = () => { clock += 11 * 60 * 1000; };

test('a configuração diz se o Google está ligado e qual é o cliente', async () => {
  const cfg = await request('/v1/auth/google/config');
  assert.deepEqual(cfg.body, { enabled: true, clientId: CLIENT_ID, googleOnly: false, passwordLogin: true });
});

test('conta nova pelo Google: cria, entra e a troca leva o verificador e o retorno do PC', async () => {
  contas.set('codigo-ana-123', idToken({ sub: 'g-ana', email: 'Ana@Gmail.com', name: 'Ana Souza' }));
  const r = await entrarComGoogle('codigo-ana-123');
  assert.ok([200, 201, 202].includes(r.status));
  if (r.status === 202) {
    await request('/v1/admin/users/' + r.body.user.id + '/approve', { method: 'POST' }, ADMIN);
    return;
  }
  assert.equal(r.body.user.email, 'ana@gmail.com');
  assert.equal(r.body.user.displayName, 'Ana Souza');
  assert.equal(r.body.user.googleLinked, true);
  assert.equal(r.body.user.hasPassword, false);
  assert.ok(r.body.accessToken);
  const troca = trocas.at(-1);
  assert.equal(troca.codeVerifier, 'v'.repeat(64));
  assert.equal(troca.redirectUri, 'http://127.0.0.1:53211/callback');
  assert.equal(troca.clientSecret, 'segredo');
  // entrar de novo cai na mesma conta
  const de_novo = await entrarComGoogle('codigo-ana-123');
  assert.equal(de_novo.status, 200);
  assert.equal(de_novo.body.user.id, r.body.user.id);
});

test('recusa e-mail não confirmado, público errado, token vencido, emissor falso e código inválido', async () => {
  const casos = {
    'codigo-nao-confirmado': idToken({ sub: 'g1', email: 'x1@gmail.com', email_verified: false }),
    'codigo-publico-errado': idToken({ sub: 'g2', email: 'x2@gmail.com', aud: 'outro-cliente' }),
    'codigo-vencido': idToken({ sub: 'g3', email: 'x3@gmail.com', exp: Math.floor(clock / 1000) - 10 }),
    'codigo-emissor': idToken({ sub: 'g4', email: 'x4@gmail.com', iss: 'https://evil.example' }),
    'codigo-sem-email': idToken({ sub: 'g5' }),
  };
  for (const [code, payload] of Object.entries(casos)) {
    contas.set(code, payload);
    assert.equal((await entrarComGoogle(code)).status, 401, code);
  }
  assert.equal((await entrarComGoogle('codigo-que-nao-existe')).status, 401);
});

test('valida o pedido: retorno só em 127.0.0.1, verificador e código no tamanho', async () => {
  zerarLimite();
  const mau = (extra) => request('/v1/auth/google', { method: 'POST', body: { ...pedido('codigo-ana-123'), ...extra } });
  assert.equal((await mau({ redirectUri: 'https://evil.example/callback' })).status, 400);
  assert.equal((await mau({ redirectUri: 'http://localhost:5000/callback' })).status, 400);
  assert.equal((await mau({ redirectUri: 'http://127.0.0.1:5000/outro' })).status, 400);
  assert.equal((await mau({ codeVerifier: 'curto' })).status, 400);
  assert.equal((await mau({ code: 'x' })).status, 400);
});

test('e-mail que já tem conta com senha não é juntado sozinho; vincula logado e depois entra pelo Google', async () => {
  zerarLimite();
  const reg = await request('/v1/auth/register', { method: 'POST', body: { email: 'bia@gmail.com', displayName: 'Bia', password: 'senha-bia-123' } });
  if (reg.status === 202) await request('/v1/admin/users/' + reg.body.user.id + '/approve', { method: 'POST' }, ADMIN);
  contas.set('codigo-bia-1', idToken({ sub: 'g-bia', email: 'bia@gmail.com', name: 'Bia G' }));
  const barrado = await entrarComGoogle('codigo-bia-1');
  assert.equal(barrado.status, 409);
  assert.equal(barrado.body.error.code, 'account_exists');
  const login = (await request('/v1/auth/login', { method: 'POST', body: { email: 'bia@gmail.com', password: 'senha-bia-123' } })).body;
  const vinculo = await request('/v1/me/google', { method: 'POST', body: pedido('codigo-bia-1') }, login.accessToken);
  assert.equal(vinculo.status, 200);
  assert.equal(vinculo.body.user.googleLinked, true);
  assert.equal(vinculo.body.user.hasPassword, true);
  const agora = await entrarComGoogle('codigo-bia-1');
  assert.equal(agora.status, 200);
  assert.equal(agora.body.user.id, login.user.id);
  // a mesma conta do Google não vai para um segundo usuário
  const reg2 = await request('/v1/auth/register', { method: 'POST', body: { email: 'caco@example.com', displayName: 'Caco', password: 'senha-caco-123' } });
  if (reg2.status === 202) await request('/v1/admin/users/' + reg2.body.user.id + '/approve', { method: 'POST' }, ADMIN);
  const caco = (await request('/v1/auth/login', { method: 'POST', body: { email: 'caco@example.com', password: 'senha-caco-123' } })).body;
  const taken = await request('/v1/me/google', { method: 'POST', body: pedido('codigo-bia-1') }, caco.accessToken);
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error.code, 'google_taken');
  // desvincular: tem senha, pode
  const livre = await request('/v1/me/google', { method: 'DELETE' }, agora.body.accessToken);
  assert.equal(livre.status, 200);
  assert.equal(livre.body.user.googleLinked, false);
});

test('quem só tem Google define a primeira senha sem a atual e só então pode desvincular', async () => {
  zerarLimite();
  contas.set('codigo-duda-1', idToken({ sub: 'g-duda', email: 'duda@gmail.com', name: 'Duda' }));
  let r = await entrarComGoogle('codigo-duda-1');
  if (r.status === 202) { await request('/v1/admin/users/' + r.body.user.id + '/approve', { method: 'POST' }, ADMIN); r = await entrarComGoogle('codigo-duda-1'); }
  const token = r.body.accessToken;
  const bloqueado = await request('/v1/me/google', { method: 'DELETE' }, token);
  assert.equal(bloqueado.status, 400);
  assert.equal(bloqueado.body.error.code, 'no_password');
  assert.equal((await request('/v1/me/password', { method: 'POST', body: { newPassword: 'curta' } }, token)).status, 400);
  assert.equal((await request('/v1/me/password', { method: 'POST', body: { newPassword: 'primeira-senha-1' } }, token)).status, 200);
  assert.equal((await request('/v1/auth/login', { method: 'POST', body: { email: 'duda@gmail.com', password: 'primeira-senha-1' } })).status, 200);
  const novo = (await request('/v1/auth/login', { method: 'POST', body: { email: 'duda@gmail.com', password: 'primeira-senha-1' } })).body.accessToken;
  assert.equal((await request('/v1/me/google', { method: 'DELETE' }, novo)).status, 200);
  // com senha definida, trocar a senha volta a pedir a atual
  assert.equal((await request('/v1/me/password', { method: 'POST', body: { newPassword: 'outra-senha-123' } }, novo)).status, 400);
});

test('sem cliente configurado o Google fica desligado', async () => {
  zerarLimite();
  const off = createApiServer({ dbPath: ':memory:', adminToken: ADMIN, stunPort: 0, googleClientId: '' });
  const address = await off.listen(0, '127.0.0.1');
  try {
    const url = 'http://127.0.0.1:' + address.port;
    assert.deepEqual(await (await fetch(url + '/v1/auth/google/config')).json(), { enabled: false, clientId: '', googleOnly: false, passwordLogin: true });
    const r = await fetch(url + '/v1/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pedido('codigo-ana-123')) });
    assert.equal(r.status, 503);
  } finally { await off.close(); }
});
