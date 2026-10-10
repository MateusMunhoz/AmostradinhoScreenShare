'use strict';

// Login com Google no Android (POST /v1/auth/google/android): ID token assinado pelo "Google" dos testes (uma chave RSA
// gerada aqui, entregue como JWKS), nonce de uso único e uma sessão de PC e uma de Android por conta.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { createApiServer } = require('../razze-api/server');

const ADMIN = 'razze-admin-test-token-with-at-least-thirty-characters';
const CLIENT_ID = 'cliente-pc.apps.googleusercontent.com';
const WEB_CLIENT_ID = '123456789012-web.apps.googleusercontent.com';
let api;
let baseUrl;
let clock = 50_000_000;
const avancar = (ms) => { clock += ms; };
// O limite de tentativas erradas é por IP a cada 10 min: cada teste começa com ele zerado
const zerarLimite = () => avancar(11 * 60 * 1000);

const chave = generateKeyPairSync('rsa', { modulusLength: 2048 });
const outraChave = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...chave.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
let buscasJwks = 0;
let jwksFalha = false;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function assinar(payload, { header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }, privada = chave.privateKey } = {}) {
  const dados = b64(header) + '.' + b64(payload);
  return dados + '.' + sign('RSA-SHA256', Buffer.from(dados), privada).toString('base64url');
}
const conta = (extra = {}) => ({
  iss: 'https://accounts.google.com', aud: WEB_CLIENT_ID, sub: 'google-ana', email: 'ana@exemplo.com', email_verified: true,
  name: 'Ana Souza', iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 3600, ...extra,
});

async function request(path, options = {}, token) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const response = await fetch(baseUrl + path, { ...options, headers, body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined });
  return { status: response.status, body: await response.json() };
}
const nonce = async () => (await request('/v1/auth/google/nonce')).body.nonce;
// Um login inteiro do Android: pega o nonce, o "Google" assina com ele, manda
async function entrarAndroid(extra = {}, opcoes = {}) {
  const n = await nonce();
  return request('/v1/auth/google/android', { method: 'POST', body: { idToken: assinar(conta({ nonce: n, ...extra }), opcoes), nonce: n } });
}
// O login do PC (código trocado no "Google"): a mesma conta Google (sub) do celular
const codigosPc = new Map();
const entrarPc = (code) => request('/v1/auth/google', { method: 'POST', body: { code, codeVerifier: 'v'.repeat(64), redirectUri: 'http://127.0.0.1:53211/callback' } });

before(async () => {
  api = createApiServer({
    dbPath: ':memory:', tokenTtlMs: 30 * 24 * 60 * 60 * 1000, adminToken: ADMIN, stunPort: 0, now: () => clock,
    googleClientId: CLIENT_ID, googleClientSecret: 'segredo', googleWebClientId: WEB_CLIENT_ID,
    googleExchange: async (p) => {
      const c = codigosPc.get(p.code);
      if (!c) throw new Error('invalid_grant');
      return { id_token: 'h.' + b64(c) + '.s' };
    },
    googleJwks: async () => {
      buscasJwks++;
      if (jwksFalha) throw new Error('fora do ar');
      return { keys: [jwk], maxAgeMs: 60 * 60 * 1000 };
    },
  });
  const address = await api.listen(0, '127.0.0.1');
  baseUrl = 'http://127.0.0.1:' + address.port;
  await request('/v1/admin/settings', { method: 'PATCH', body: { requireApproval: false } }, ADMIN);
});

after(async () => { if (api) await api.close(); });

test('a configuração traz o client ID web e o nonce sai com 43 caracteres, cada um diferente', async () => {
  zerarLimite();
  const cfg = await request('/v1/auth/google/config');
  assert.equal(cfg.body.webClientId, WEB_CLIENT_ID);
  const a = await nonce();
  const b = await nonce();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test('conta nova pelo Android e a mesma conta no PC: os dois ficam logados juntos', async () => {
  zerarLimite();
  const android = await entrarAndroid();
  assert.equal(android.status, 201);
  assert.equal(android.body.status, 'active');
  assert.equal(android.body.user.email, 'ana@exemplo.com');
  assert.equal(android.body.user.displayName, 'Ana Souza');
  const tokenAndroid = android.body.accessToken;

  // O PC entra com a mesma conta Google (mesmo sub, outro client ID): mesma conta, e o celular não cai
  codigosPc.set('codigo-ana-pc', { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'google-ana', email: 'ana@exemplo.com', email_verified: true, exp: Math.floor(clock / 1000) + 3600 });
  const pc = await entrarPc('codigo-ana-pc');
  assert.equal(pc.status, 200);
  assert.equal(pc.body.user.id, android.body.user.id);
  assert.equal((await request('/v1/me', {}, tokenAndroid)).status, 200);
  assert.equal((await request('/v1/me', {}, pc.body.accessToken)).status, 200);

  // Outro login no Android derruba só a sessão de Android anterior
  const android2 = await entrarAndroid();
  assert.equal(android2.status, 200);
  assert.equal((await request('/v1/me', {}, tokenAndroid)).status, 401);
  assert.equal((await request('/v1/me', {}, android2.body.accessToken)).status, 200);
  assert.equal((await request('/v1/me', {}, pc.body.accessToken)).status, 200);

  // E outro login no PC derruba só a de PC
  const pc2 = await entrarPc('codigo-ana-pc');
  assert.equal((await request('/v1/me', {}, pc.body.accessToken)).status, 401);
  assert.equal((await request('/v1/me', {}, pc2.body.accessToken)).status, 200);
  assert.equal((await request('/v1/me', {}, android2.body.accessToken)).status, 200);
});

test('recusa token falso, de outro app, vencido, sem e-mail confirmado ou de outro emissor', async () => {
  const casos = [
    [{}, { privada: outraChave.privateKey }], // assinado por outra chave
    [{}, { header: { alg: 'none', kid: 'k1' } }],
    [{}, { header: { alg: 'RS256', kid: 'desconhecida' } }],
    [{ aud: CLIENT_ID }], // token do client de PC, não do web
    [{ aud: 'outro-app.apps.googleusercontent.com' }],
    [() => ({ exp: Math.floor(clock / 1000) - 120 })],
    [() => ({ iat: Math.floor(clock / 1000) + 3600 })], // emitido no futuro
    [{ email_verified: false }],
    [{ iss: 'https://evil.example.com' }],
    [{ sub: '' }],
  ];
  for (const [extra, opcoes] of casos) {
    zerarLimite(); // o relógio anda: o que depende da hora é calculado agora
    const r = await entrarAndroid(typeof extra === 'function' ? extra() : extra, opcoes);
    assert.equal(r.status, 401, JSON.stringify(extra) + JSON.stringify(opcoes?.header || ''));
    assert.equal(r.body.error.code, 'google_failed');
  }
});

test('o nonce vale uma vez, tem que ser o do token e vence em 5 minutos', async () => {
  zerarLimite();
  const n = await nonce();
  const token = assinar(conta({ nonce: n }));
  assert.equal((await request('/v1/auth/google/android', { method: 'POST', body: { idToken: token, nonce: n } })).status, 200);
  // o mesmo token de novo: o nonce já foi usado
  assert.equal((await request('/v1/auth/google/android', { method: 'POST', body: { idToken: token, nonce: n } })).status, 401);
  // nonce que o servidor nunca deu
  const inventado = 'A'.repeat(43);
  assert.equal((await request('/v1/auth/google/android', { method: 'POST', body: { idToken: assinar(conta({ nonce: inventado })), nonce: inventado } })).status, 401);
  // nonce válido, mas o token foi feito com outro
  const n2 = await nonce();
  assert.equal((await request('/v1/auth/google/android', { method: 'POST', body: { idToken: assinar(conta({ nonce: 'B'.repeat(43) })), nonce: n2 } })).status, 401);
  // vencido
  zerarLimite();
  const n3 = await nonce();
  avancar(5 * 60 * 1000 + 1);
  assert.equal((await request('/v1/auth/google/android', { method: 'POST', body: { idToken: assinar(conta({ nonce: n3 })), nonce: n3 } })).status, 401);
});

test('pedido malformado: campo desconhecido, token que não é JWT e corpo grande demais', async () => {
  zerarLimite();
  const n = await nonce();
  const extra = await request('/v1/auth/google/android', { method: 'POST', body: { idToken: assinar(conta({ nonce: n })), nonce: n, email: 'outra@exemplo.com' } });
  assert.equal(extra.status, 400);
  assert.equal((await request('/v1/auth/google/android', { method: 'POST', body: { idToken: 'nao-e-jwt', nonce: n } })).status, 401);
  const grande = await request('/v1/auth/google/android', { method: 'POST', body: { idToken: 'a'.repeat(9000), nonce: n } });
  assert.equal(grande.status, 413);
});

test('erros seguidos bloqueiam o IP por 10 minutos', async () => {
  zerarLimite();
  for (let i = 0; i < 10; i++) assert.equal((await entrarAndroid({ aud: 'x' })).status, 401);
  assert.equal((await entrarAndroid()).status, 429);
  zerarLimite();
  assert.equal((await entrarAndroid()).status, 200);
});

test('conta nova com aprovação ligada fica pendente, nos dois caminhos', async () => {
  zerarLimite();
  await request('/v1/admin/settings', { method: 'PATCH', body: { requireApproval: true } }, ADMIN);
  try {
    const r = await entrarAndroid({ sub: 'google-bia', email: 'bia@exemplo.com' });
    assert.equal(r.status, 202);
    assert.equal(r.body.status, 'pending_approval');
    assert.equal(r.body.accessToken, undefined);
    const de_novo = await entrarAndroid({ sub: 'google-bia', email: 'bia@exemplo.com' });
    assert.equal(de_novo.status, 403);
    assert.equal(de_novo.body.error.code, 'account_pending');
  } finally {
    await request('/v1/admin/settings', { method: 'PATCH', body: { requireApproval: false } }, ADMIN);
  }
});

test('chave nova do Google: busca o JWKS de novo; Google fora do ar responde 503 sem contar como erro', async () => {
  zerarLimite();
  const antes = buscasJwks;
  assert.equal((await entrarAndroid()).status, 200);
  assert.equal(buscasJwks, antes); // a chave conhecida ficou guardada
  assert.equal((await entrarAndroid({}, { header: { alg: 'RS256', kid: 'nova' } })).status, 401);
  assert.equal(buscasJwks, antes + 1); // kid desconhecido: buscou de novo antes de recusar
  jwksFalha = true;
  try {
    avancar(2 * 60 * 60 * 1000); // o cache venceu
    for (let i = 0; i < 12; i++) assert.equal((await entrarAndroid()).status, 503);
  } finally { jwksFalha = false; }
  assert.equal((await entrarAndroid()).status, 200); // 503 não conta para o bloqueio por IP
});

test('sem o client ID web, o Android fica desligado', async () => {
  const off = createApiServer({ dbPath: ':memory:', adminToken: ADMIN, stunPort: 0, googleClientId: CLIENT_ID, googleWebClientId: '' });
  const address = await off.listen(0, '127.0.0.1');
  try {
    const url = 'http://127.0.0.1:' + address.port;
    assert.equal((await (await fetch(url + '/v1/auth/google/config')).json()).webClientId, '');
    assert.equal((await fetch(url + '/v1/auth/google/nonce')).status, 503);
    const r = await fetch(url + '/v1/auth/google/android', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: 'a.b.c', nonce: 'n' }) });
    assert.equal(r.status, 503);
  } finally { await off.close(); }
});
