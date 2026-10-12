'use strict';

// Identificador nome#1234 (docs/spec/identificador-nome-tag.md): migração, cadastro, troca, amigos e o Google
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiServer } = require('../razze-api/server');
const ident = require('../razze-api/identificador');

const ADMIN = 'razze-admin-test-token-with-at-least-thirty-characters';
const CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';
const REDIRECT = 'http://127.0.0.1:53111/callback';
const VERIFIER = 'v'.repeat(43);
let api, baseUrl;
let clock = 9_000_000;
const contas = new Map(); // código do Google -> id_token

const idToken = (claims) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b64({ alg: 'none' }) + '.' + b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(clock / 1000) + 3600, email_verified: true, ...claims }) + '.x';
};

async function request(p, options = {}, token) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const response = await fetch(baseUrl + p, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status: response.status, body: await response.json() };
}
const google = (code, extra = {}) => request('/v1/auth/google', { method: 'POST', body: { code, codeVerifier: VERIFIER, redirectUri: REDIRECT, ...extra } });

async function newUser(name, extra = {}) {
  const email = name.toLowerCase() + '@example.com';
  const reg = await request('/v1/auth/register', { method: 'POST', body: { email, displayName: name, password: 'senha-' + name + '-1', ...extra } });
  assert.ok([201, 202].includes(reg.status), JSON.stringify(reg.body));
  if (reg.status === 202) await request('/v1/admin/users/' + reg.body.user.id + '/approve', { method: 'POST' }, ADMIN);
  return (await request('/v1/auth/login', { method: 'POST', body: { email, password: 'senha-' + name + '-1' } })).body;
}

before(async () => {
  api = createApiServer({
    dbPath: ':memory:', adminToken: ADMIN, stunPort: 0, now: () => clock, requireApproval: false,
    googleClientId: CLIENT_ID, googleClientSecret: 's',
    googleExchange: async (p) => { if (!contas.has(p.code)) throw new Error('código'); return { id_token: contas.get(p.code) }; },
  });
  baseUrl = 'http://127.0.0.1:' + (await api.listen(0, '127.0.0.1')).port;
});
after(async () => { if (api) await api.close(); });

test('regras do nome: só letras sem acento e números, 2 a 32, sem reservados; sugestão limpa', () => {
  assert.equal(ident.problemaDoNome('Lucas2'), '');
  for (const ruim of ['', 'a', 'lú', 'lucas silva', 'lu_cas', 'lu.cas', 'lucas#1', 'lucаs', 'x'.repeat(33), 'Admin', 'suportenebula', 'NEBULA9']) {
    assert.notEqual(ident.problemaDoNome(ruim), '', ruim);
  }
  assert.equal(ident.sugerirNome('João da Silva'), 'JoaodaSilva');
  assert.equal(ident.sugerirNome('😀', 'ana.b@x.com'.split('@')[0]), 'anab');
  assert.equal(ident.sugerirNome('Á', 'x'), 'usuario');
  assert.equal(ident.sugerirNome('Admin'), 'usuario');
  assert.deepEqual(ident.lerIdentificador(' lucas#0420 '), { nome: 'lucas', tag: 420 });
  assert.equal(ident.lerIdentificador('lucas#0000'), null);
  assert.equal(ident.lerIdentificador('lucas'), null);
});

test('cadastro: escolhe o nome, a tag é sorteada; nome repetido ganha outra tag; nome inválido é recusado', async () => {
  const a = await newUser('Lia', { handleName: 'Lia' });
  const b = await newUser('Lia2', { handleName: 'lia' });
  assert.match(a.user.handle, /^Lia#\d{4}$/);
  assert.match(b.user.handle, /^lia#\d{4}$/);
  assert.notEqual(a.user.handle.slice(-4), b.user.handle.slice(-4));
  const ruim = await request('/v1/auth/register', { method: 'POST', body: { email: 'x@example.com', displayName: 'X', password: 'senha-longa-1', handleName: 'com espaço' } });
  assert.equal(ruim.status, 400);
  assert.equal(ruim.body.error.code, 'invalid_handle');
  // App antigo (sem handleName): usa a sugestão do nome de exibição
  const antigo = (await request('/v1/auth/register', { method: 'POST', body: { email: 'icaro@example.com', displayName: 'Ícaro Souza', password: 'senha-longa-1' } })).body;
  assert.match(antigo.user.handle, /^IcaroSouza#\d{4}$/);
});

test('entra pelo identificador e pelo e-mail', async () => {
  const u = await newUser('Malu', { handleName: 'Malu' });
  const pelaTag = await request('/v1/auth/login', { method: 'POST', body: { login: u.user.handle.toLowerCase(), password: 'senha-Malu-1' } });
  assert.equal(pelaTag.status, 200);
  assert.equal(pelaTag.body.user.id, u.user.id);
  assert.equal((await request('/v1/auth/login', { method: 'POST', body: { login: 'Malu#' + (u.user.handle.endsWith('0001') ? '0002' : '0001'), password: 'senha-Malu-1' } })).status, 401);
});

test('trocar o nome: mantém a tag se livre, intervalo de 7 dias, maiúsculas não contam como troca', async () => {
  const u = await newUser('Nina', { handleName: 'Nina' });
  const tag = u.user.handle.slice(-4);
  const troca = await request('/v1/me/handle', { method: 'PATCH', body: { name: 'NinaGamer' } }, u.accessToken);
  assert.equal(troca.status, 200);
  assert.equal(troca.body.user.handle, 'NinaGamer#' + tag);
  assert.ok(troca.body.user.handleChangeAt > clock);
  const caixa = await request('/v1/me/handle', { method: 'PATCH', body: { name: 'ninagamer' } }, u.accessToken);
  assert.equal(caixa.status, 200);
  assert.equal(caixa.body.user.handle, 'ninagamer#' + tag);
  const cedo = await request('/v1/me/handle', { method: 'PATCH', body: { name: 'Outra' } }, u.accessToken);
  assert.equal(cedo.status, 429);
  assert.equal(cedo.body.error.code, 'handle_cooldown');
  clock += 7 * 24 * 60 * 60 * 1000 + 1;
  assert.equal((await request('/v1/me/handle', { method: 'PATCH', body: { name: 'admin' } }, u.accessToken)).status, 400);
  assert.equal((await request('/v1/me/handle', { method: 'PATCH', body: { name: 'Nina' } }, u.accessToken)).status, 200);
});

test('tag ocupada no nome novo: sorteia outra', async () => {
  const a = await newUser('Otto', { handleName: 'Otto' });
  const b = await newUser('Pio', { handleName: 'Pio' });
  // Força: Pio vai para "Otto" com a mesma tag de Otto -> tem de mudar a tag
  api.db.prepare('UPDATE users SET handle_tag = ? WHERE id = ?').run(Number(a.user.handle.slice(-4)), b.user.id);
  const r = await request('/v1/me/handle', { method: 'PATCH', body: { name: 'otto' } }, b.accessToken);
  assert.equal(r.status, 200);
  assert.match(r.body.user.handle, /^otto#\d{4}$/);
  assert.notEqual(r.body.user.handle.slice(-4), a.user.handle.slice(-4));
});

test('amigos: pelo identificador exato; sem tag pede a tag; e-mail não vale mais; listas trazem o identificador', async () => {
  const a = await newUser('Rui', { handleName: 'Rui' });
  const b = await newUser('Sol', { handleName: 'Sol' });
  const porEmail = await request('/v1/friends/requests', { method: 'POST', body: { email: 'sol@example.com' } }, a.accessToken);
  assert.equal(porEmail.status, 400);
  assert.match(porEmail.body.error.message, /identificador/);
  const errado = await request('/v1/friends/requests', { method: 'POST', body: { nickname: 'Sol#' + (b.user.handle.endsWith('9999') ? '9998' : '9999') } }, a.accessToken);
  assert.equal(errado.status, 404);
  const pedido = await request('/v1/friends/requests', { method: 'POST', body: { nickname: b.user.handle.toUpperCase() } }, a.accessToken);
  assert.equal(pedido.status, 201);
  const recebidos = (await request('/v1/friends/requests', {}, b.accessToken)).body.incoming;
  assert.equal(recebidos[0].handle, a.user.handle);
  await request('/v1/friends/requests/' + pedido.body.id + '/accept', { method: 'POST' }, b.accessToken);
  assert.equal((await request('/v1/friends', {}, a.accessToken)).body.friends[0].handle, b.user.handle);
});

test('Google: o app novo escolhe o nome antes de criar; fechar no meio não cria conta', async () => {
  contas.set('codigo-g-tati', idToken({ sub: 'sub-tati', email: 'tati@gmail.com', name: 'Tatiana Lóis' }));
  const escolha = await google('codigo-g-tati', { escolherNome: true });
  assert.equal(escolha.status, 200, JSON.stringify(escolha.body));
  assert.equal(escolha.status, 200);
  assert.equal(escolha.body.status, 'choose_handle');
  assert.equal(escolha.body.suggestion, 'TatianaLois');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'tati@gmail.com'").get().n, 0);
  const ruim = await request('/v1/auth/google/finish', { method: 'POST', body: { ticket: escolha.body.ticket, handleName: 'tá' } });
  assert.equal(ruim.status, 400);
  const ok = await request('/v1/auth/google/finish', { method: 'POST', body: { ticket: escolha.body.ticket, handleName: 'Tati' } });
  assert.equal(ok.status, 201);
  assert.match(ok.body.user.handle, /^Tati#\d{4}$/);
  assert.ok(ok.body.accessToken);
  assert.equal((await request('/v1/auth/google/finish', { method: 'POST', body: { ticket: escolha.body.ticket, handleName: 'Tati' } })).status, 401);
  // App antigo: cria direto com a sugestão
  contas.set('codigo-g-ugo', idToken({ sub: 'sub-ugo', email: 'ugo@gmail.com', name: 'Ugo' }));
  const antigo = await google('codigo-g-ugo');
  assert.equal(antigo.status, 201);
  assert.match(antigo.body.user.handle, /^Ugo#\d{4}$/);
});

test('Google com e-mail de conta de senha: 409 diz o identificador e o ticket vincula depois de entrar', async () => {
  const dona = await newUser('Vera', { handleName: 'Vera' });
  contas.set('codigo-g-vera', idToken({ sub: 'sub-vera', email: 'vera@example.com', name: 'Vera' }));
  const barrado = await google('codigo-g-vera', { escolherNome: true });
  assert.equal(barrado.status, 409);
  assert.equal(barrado.body.error.code, 'account_exists');
  assert.equal(barrado.body.error.handle, dona.user.handle);
  assert.match(barrado.body.error.message, new RegExp(dona.user.handle));
  const vinculo = await request('/v1/me/google', { method: 'POST', body: { ticket: barrado.body.error.ticket } }, dona.accessToken);
  assert.equal(vinculo.status, 200);
  assert.equal(vinculo.body.user.googleLinked, true);
  assert.equal((await google('codigo-g-vera')).body.user.id, dona.user.id);
});

test('mover o Google de outra conta: só-Google é excluída; com senha só perde o Google; admin e redes com gente bloqueiam', async () => {
  // B só entra pelo Google
  contas.set('codigo-g-wil', idToken({ sub: 'sub-wil', email: 'wil@gmail.com', name: 'Wil' }));
  const b = (await google('codigo-g-wil')).body;
  const a = await newUser('Xena', { handleName: 'Xena' });
  contas.set('codigo-g-wil-2', contas.get('codigo-g-wil'));
  const conflito = await request('/v1/me/google', { method: 'POST', body: { code: 'codigo-g-wil-2', codeVerifier: VERIFIER, redirectUri: REDIRECT } }, a.accessToken);
  assert.equal(conflito.status, 409);
  assert.equal(conflito.body.error.code, 'google_taken');
  assert.equal(conflito.body.error.handle, b.user.handle);
  assert.equal(conflito.body.error.excluir, true);
  const semSenha = await request('/v1/me/google', { method: 'POST', body: { ticket: conflito.body.error.ticket, move: true } }, a.accessToken);
  assert.equal(semSenha.status, 401); // mover pede a senha de quem está logado
  const movido = await request('/v1/me/google', { method: 'POST', body: { ticket: conflito.body.error.ticket, move: true, currentPassword: 'senha-Xena-1' } }, a.accessToken);
  assert.equal(movido.status, 200);
  assert.equal(movido.body.deleted, true);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(b.user.id).n, 0);
  assert.equal((await google('codigo-g-wil')).body.user.id, a.user.id);

  // C tem senha e Google: perde só o Google
  const c = await newUser('Yuri', { handleName: 'Yuri' });
  contas.set('codigo-g-yuri', idToken({ sub: 'sub-yuri', email: 'yuri.g@gmail.com', name: 'Yuri' }));
  await request('/v1/me/google', { method: 'POST', body: { code: 'codigo-g-yuri', codeVerifier: VERIFIER, redirectUri: REDIRECT } }, c.accessToken);
  const d = await newUser('Zeca', { handleName: 'Zeca' });
  contas.set('codigo-g-yuri-2', contas.get('codigo-g-yuri'));
  const c2 = await request('/v1/me/google', { method: 'POST', body: { code: 'codigo-g-yuri-2', codeVerifier: VERIFIER, redirectUri: REDIRECT } }, d.accessToken);
  assert.equal(c2.body.error.excluir, false);
  const m2 = await request('/v1/me/google', { method: 'POST', body: { ticket: c2.body.error.ticket, move: true, currentPassword: 'senha-Zeca-1' } }, d.accessToken);
  assert.equal(m2.body.deleted, false);
  assert.equal((await request('/v1/me', {}, c.accessToken)).status, 401); // sessões de C caíram
  const cDeNovo = (await request('/v1/auth/login', { method: 'POST', body: { email: 'yuri@example.com', password: 'senha-Yuri-1' } })).body;
  assert.equal(cDeNovo.user.googleLinked, false);

  // Admin: recusa
  const e = await newUser('Bel', { handleName: 'Bel' });
  contas.set('codigo-g-bel', idToken({ sub: 'sub-bel', email: 'bel.g@gmail.com', name: 'Bel' }));
  await request('/v1/me/google', { method: 'POST', body: { code: 'codigo-g-bel', codeVerifier: VERIFIER, redirectUri: REDIRECT } }, e.accessToken);
  await request('/v1/admin/users/' + e.user.id, { method: 'PATCH', body: { role: 'admin' } }, ADMIN);
  contas.set('codigo-g-bel-2', contas.get('codigo-g-bel'));
  const adm = await request('/v1/me/google', { method: 'POST', body: { code: 'codigo-g-bel-2', codeVerifier: VERIFIER, redirectUri: REDIRECT } }, d.accessToken);
  assert.match(adm.body.error.bloqueio, /administrador/);
  const admMove = await request('/v1/me/google', { method: 'POST', body: { ticket: adm.body.error.ticket, move: true, currentPassword: 'senha-Zeca-1' } }, d.accessToken);
  assert.equal(admMove.status, 409);
});

test('painel: mostra e troca o identificador sem intervalo', async () => {
  const u = await newUser('Caju', { handleName: 'Caju' });
  const lista = (await request('/v1/admin/users', {}, ADMIN)).body.users;
  assert.equal(lista.find((x) => x.id === u.user.id).handle, u.user.handle);
  const r = await request('/v1/admin/users/' + u.user.id, { method: 'PATCH', body: { handleName: 'CajuNovo' } }, ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.handle, 'CajuNovo#' + u.user.handle.slice(-4));
  assert.equal((await request('/v1/admin/users/' + u.user.id, { method: 'PATCH', body: { handleName: 'nebula1' } }, ADMIN)).status, 400);
});

test('migração: contas antigas ganham identificador único, Google vai para as identidades', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-ident-'));
  const file = path.join(dir, 'antigo.sqlite');
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, google_sub TEXT, password_set INTEGER NOT NULL DEFAULT 1)");
  const ins = db.prepare('INSERT INTO users(id, email, display_name, password_salt, password_hash, created_at, google_sub) VALUES(?, ?, ?, ?, ?, ?, ?)');
  ins.run('a'.repeat(32), 'a@x.com', 'Lucas', 's', 'h', 1, 'sub-antigo');
  ins.run('b'.repeat(32), 'b@x.com', 'lucas', 's', 'h', 2, null);
  ins.run('c'.repeat(32), 'c@x.com', '😀', 's', 'h', 3, null);
  db.close();
  const velho = createApiServer({ dbPath: file, stunPort: 0, stun: false });
  try {
    const rows = velho.db.prepare('SELECT id, handle_name AS nome, handle_key AS chave, handle_tag AS tag FROM users ORDER BY created_at').all();
    assert.equal(rows[0].nome, 'Lucas');
    assert.equal(rows[1].nome, 'lucas');
    assert.notEqual(rows[0].tag, rows[1].tag); // mesmo nome sem diferenciar maiúsculas: tags diferentes
    assert.equal(rows[2].nome, 'usuario'); // só emoji e e-mail curto demais
  } finally {
    assert.equal(velho.db.prepare("SELECT user_id AS id FROM user_identities WHERE provider = 'google' AND subject = 'sub-antigo'").get().id, 'a'.repeat(32));
    await velho.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('TOTP do módulo bate com o vetor da RFC 6238 (SHA-1)', () => {
  const totp = require('../razze-api/totp');
  const chave = Buffer.from('12345678901234567890');
  // RFC 6238, T = 59 s -> 94287082 (8 dígitos); com 6 dígitos, os 6 últimos
  assert.equal(totp.codigo(chave, Math.floor(59 / 30)), '287082');
  assert.equal(totp.codigo(chave, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp.base32(totp.deBase32('GEZDGNBVGY3TQOJQ')).toString(), 'GEZDGNBVGY3TQOJQ');
  assert.ok(createHmac); // node:crypto disponível
});
