'use strict';

// Confirmação de e-mail e dois fatores (docs/spec/email-e-dois-fatores.md), com envio de e-mail falso e relógio injetado
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApiServer } = require('../razze-api/server');
const totp = require('../razze-api/totp');

const ADMIN = 'razze-admin-test-token-with-at-least-thirty-characters';
const CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';
const REDIRECT = 'http://127.0.0.1:53111/callback';
const VERIFIER = 'v'.repeat(43);
let api, baseUrl;
let clock = 20_000_000_000;
const caixa = []; // e-mails "enviados"
const contas = new Map();

const idToken = (claims) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b64({ alg: 'none' }) + '.' + b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(clock / 1000) + 3600, email_verified: true, ...claims }) + '.x';
};
async function request(p, options = {}, token) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const response = await fetch(baseUrl + p, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status: response.status, body: await response.json() };
}
const post = (p, body, token) => request(p, { method: 'POST', body }, token);
const tick = () => new Promise((r) => setImmediate(r));
// Último código mandado para o e-mail
async function codigoPara(email) {
  await tick();
  const msg = [...caixa].reverse().find((m) => m.to === email && /código/.test(m.text));
  assert.ok(msg, 'nenhum código para ' + email);
  return /(\d{3}) (\d{3})/.exec(msg.text).slice(1).join('');
}
const avisosPara = async (email) => { await tick(); return caixa.filter((m) => m.to === email && !/código do Nebula é/.test(m.text)); };
const passar = (ms) => { clock += ms; };

async function contaConfirmada(nome) {
  const email = nome.toLowerCase() + '@example.com';
  const reg = await post('/v1/auth/register', { email, displayName: nome, password: 'senha-' + nome + '-1', handleName: nome });
  assert.equal(reg.status, 202);
  assert.equal(reg.body.status, 'confirm_email');
  const ok = await post('/v1/auth/confirm-email', { email, code: await codigoPara(email) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return { ...ok.body, email, senha: 'senha-' + nome + '-1' };
}
const codigoDoApp = (secret, deslocar = 0) => totp.codigo(totp.deBase32(secret), totp.passoDe(clock) + deslocar);

before(async () => {
  api = createApiServer({
    dbPath: ':memory:', adminToken: ADMIN, stunPort: 0, now: () => clock, requireApproval: false,
    sendEmail: async (msg) => { caixa.push(msg); }, emailRetries: [], totpKey: 'chave-mestra-de-teste-com-tamanho-bom',
    googleClientId: CLIENT_ID, googleClientSecret: 's',
    googleExchange: async (p) => { if (!contas.has(p.code)) throw new Error('código'); return { id_token: contas.get(p.code) }; },
  });
  baseUrl = 'http://127.0.0.1:' + (await api.listen(0, '127.0.0.1')).port;
});
after(async () => { if (api) await api.close(); });

test('a configuração conta que o e-mail e o 2FA estão ligados', async () => {
  const cfg = (await request('/v1/auth/google/config')).body;
  assert.equal(cfg.emailConfirmation, true);
  assert.equal(cfg.twoFactor, true);
});

test('cadastro só entra com o código; código errado conta tentativa; reenviar espera 1 minuto', async () => {
  const email = 'ana@example.com';
  const reg = await post('/v1/auth/register', { email, displayName: 'Ana', password: 'senha-Ana-1', handleName: 'Ana' });
  assert.equal(reg.status, 202);
  assert.equal(reg.body.enviadoPara, 'a•a@example.com');
  const semConfirmar = await post('/v1/auth/login', { email, password: 'senha-Ana-1' });
  assert.equal(semConfirmar.status, 403);
  assert.equal(semConfirmar.body.error.code, 'email_unconfirmed');
  assert.equal((await post('/v1/auth/confirm-email', { email, code: '000000' })).status, 400);
  assert.equal((await post('/v1/auth/confirm-email/resend', { email })).status, 429);
  passar(61_000);
  assert.equal((await post('/v1/auth/confirm-email/resend', { email })).status, 200);
  const certo = await post('/v1/auth/confirm-email', { email, code: await codigoPara(email) });
  assert.equal(certo.status, 200);
  assert.ok(certo.body.accessToken);
  assert.equal(certo.body.user.emailVerified, true);
  assert.equal((await post('/v1/auth/login', { email, password: 'senha-Ana-1' })).status, 200);
});

test('5 erros queimam o código', async () => {
  const email = 'bia@example.com';
  await post('/v1/auth/register', { email, displayName: 'Bia', password: 'senha-Bia-1', handleName: 'Bia' });
  const certo = await codigoPara(email);
  for (let i = 0; i < 5; i++) await post('/v1/auth/confirm-email', { email, code: '111111' });
  assert.equal((await post('/v1/auth/confirm-email', { email, code: certo })).status, 400);
});

test('conta não confirmada some em 24 h e não prende o e-mail: outro cadastro ou o Google ganham', async () => {
  await post('/v1/auth/register', { email: 'caio@example.com', displayName: 'Caio', password: 'senha-Caio-1', handleName: 'Caio' });
  const outro = await post('/v1/auth/register', { email: 'caio@example.com', displayName: 'Caio de verdade', password: 'senha-Caio-2', handleName: 'CaioReal' });
  assert.equal(outro.status, 202); // a anterior, não confirmada, sai
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'caio@example.com'").get().n, 1);
  contas.set('codigo-google-caio', idToken({ sub: 'sub-caio', email: 'caio@example.com', name: 'Caio' }));
  const g = await post('/v1/auth/google', { code: 'codigo-google-caio', codeVerifier: VERIFIER, redirectUri: REDIRECT });
  assert.equal(g.status, 201); // o Google confirmou o dono do e-mail
  await post('/v1/auth/register', { email: 'duda@example.com', displayName: 'Duda', password: 'senha-Duda-1', handleName: 'Duda' });
  passar(24 * 60 * 60 * 1000 + 1);
  await post('/v1/auth/login', { email: 'x@example.com', password: 'qualquer' }); // limpeza acontece nas rotas de conta
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'duda@example.com'").get().n, 0);
});

test('esqueci a senha por e-mail: responde igual para conta que não existe; código troca a senha e derruba as sessões', async () => {
  const eva = await contaConfirmada('Eva');
  assert.deepEqual((await post('/v1/auth/forgot', { login: 'ninguem@example.com' })).body, { ok: true, twoFactor: false });
  assert.equal((await post('/v1/auth/forgot', { login: eva.user.handle })).status, 200);
  const codigo = await codigoPara(eva.email);
  assert.equal((await post('/v1/auth/forgot/reset', { login: eva.email, code: '123456', password: 'nova-senha-123' })).status, 400);
  assert.equal((await post('/v1/auth/forgot/reset', { login: eva.email, code: codigo, password: 'nova-senha-123' })).status, 200);
  assert.equal((await request('/v1/me', {}, eva.accessToken)).status, 401);
  assert.equal((await post('/v1/auth/login', { login: eva.user.handle, password: 'nova-senha-123' })).status, 200);
  assert.ok((await avisosPara(eva.email)).some((m) => /senha/i.test(m.subject)));
});

test('trocar o e-mail: pede a senha, manda o código para o novo, avisa o antigo, a lista de convidados acompanha', async () => {
  const fabio = await contaConfirmada('Fabio');
  await request('/v1/admin/allowlist', { method: 'POST', body: { email: fabio.email, grupo: 'amigo' } }, ADMIN);
  assert.equal((await post('/v1/me/email', { email: 'fabio.novo@example.com' }, fabio.accessToken)).status, 401);
  const ok = await post('/v1/me/email', { email: 'fabio.novo@example.com', currentPassword: fabio.senha }, fabio.accessToken);
  assert.equal(ok.status, 202);
  const tomado = await post('/v1/me/email', { email: 'ana@example.com', currentPassword: fabio.senha }, fabio.accessToken);
  assert.equal(tomado.status, 409, JSON.stringify(tomado.body));
  assert.equal(tomado.status, 409);
  const fim = await post('/v1/me/email/confirm', { code: await codigoPara('fabio.novo@example.com') }, fabio.accessToken);
  assert.equal(fim.status, 200);
  assert.equal(fim.body.user.email, 'fabio.novo@example.com');
  assert.ok((await avisosPara(fabio.email)).some((m) => /trocado/.test(m.subject)));
  const lista = (await request('/v1/admin/allowlist', {}, ADMIN)).body.allowlist;
  assert.ok(lista.some((a) => a.email === 'fabio.novo@example.com'));
});

test('conta do Google: entra também com senha usando outro e-mail; só muda com o código; depois troca de Google', async () => {
  contas.set('codigo-google-gil', idToken({ sub: 'sub-gil', email: 'gil@gmail.com', name: 'Gil' }));
  const gil = (await post('/v1/auth/google', { code: 'codigo-google-gil', codeVerifier: VERIFIER, redirectUri: REDIRECT })).body;
  const pedido = await post('/v1/me/password-setup', { newPassword: 'senha-do-gil-1', email: 'gil@trabalho.com' }, gil.accessToken);
  assert.equal(pedido.status, 202);
  assert.equal((await request('/v1/me', {}, gil.accessToken)).body.user.hasPassword, false);
  const fim = await post('/v1/me/email/confirm', { code: await codigoPara('gil@trabalho.com') }, gil.accessToken);
  assert.equal(fim.status, 200);
  assert.equal(fim.body.user.email, 'gil@trabalho.com');
  assert.equal(fim.body.user.hasPassword, true);
  // (entrar de novo no PC troca a sessão do PC: segue com a nova)
  const sessao = await post('/v1/auth/login', { email: 'gil@trabalho.com', password: 'senha-do-gil-1' });
  assert.equal(sessao.status, 200);
  gil.accessToken = sessao.body.accessToken;
  // agora desvincula o Google antigo e vincula outro
  assert.equal((await request('/v1/me/google', { method: 'DELETE', body: { currentPassword: 'senha-do-gil-1' } }, gil.accessToken)).status, 200);
  contas.set('codigo-google-gil-2', idToken({ sub: 'sub-gil-2', email: 'gil.outro@gmail.com', name: 'Gil' }));
  const novo = await post('/v1/me/google', { code: 'codigo-google-gil-2', codeVerifier: VERIFIER, redirectUri: REDIRECT }, gil.accessToken);
  assert.equal(novo.status, 200);
  assert.equal(novo.body.user.email, 'gil@trabalho.com'); // vincular não troca o e-mail
});

test('conta antiga com e-mail não confirmado confirma pelo código', async () => {
  const id = (await post('/v1/auth/register', { email: 'hugo@example.com', displayName: 'Hugo', password: 'senha-Hugo-1', handleName: 'Hugo' })).body.user.id;
  api.db.prepare('UPDATE users SET confirmar_ate = NULL WHERE id = ?').run(id); // como as de antes da confirmação
  const login = (await post('/v1/auth/login', { email: 'hugo@example.com', password: 'senha-Hugo-1' })).body;
  assert.equal(login.user.emailVerified, false);
  passar(61_000);
  assert.equal((await post('/v1/me/email/verify', {}, login.accessToken)).status, 202);
  const ok = await post('/v1/me/email/confirm', { purpose: 'confirmar', code: await codigoPara('hugo@example.com') }, login.accessToken);
  assert.equal(ok.body.user.emailVerified, true);
});

test('2FA: liga com um código do app, pede no login por senha e nas ações sensíveis, recuperação vale uma vez', async () => {
  const ivo = await contaConfirmada('Ivo');
  assert.equal((await post('/v1/me/2fa/setup', {}, ivo.accessToken)).status, 401); // pede a senha
  const setup = await post('/v1/me/2fa/setup', { currentPassword: ivo.senha }, ivo.accessToken);
  assert.equal(setup.status, 200);
  assert.match(setup.body.otpauth, /^otpauth:\/\/totp\/Nebula%3AIvo%23\d{4}\?secret=/);
  assert.equal((await post('/v1/me/2fa/enable', { code: '000000' }, ivo.accessToken)).status, 401);
  const ligado = await post('/v1/me/2fa/enable', { code: codigoDoApp(setup.body.secret) }, ivo.accessToken);
  assert.equal(ligado.status, 200);
  assert.equal(ligado.body.recoveryCodes.length, 10);
  assert.equal(ligado.body.user.twoFactor, true);

  // login por senha: desafio + código; o mesmo código não vale duas vezes
  const etapa1 = await post('/v1/auth/login', { email: ivo.email, password: ivo.senha });
  assert.equal(etapa1.status, 403);
  assert.equal(etapa1.body.error.code, '2fa_required');
  const challenge = etapa1.body.error.challenge;
  assert.equal((await post('/v1/auth/login/2fa', { challenge, code: codigoDoApp(setup.body.secret) })).status, 401); // já usado no enable
  passar(30_000);
  const etapa2 = await post('/v1/auth/login/2fa', { challenge, code: codigoDoApp(setup.body.secret) });
  assert.equal(etapa2.status, 200);
  assert.ok(etapa2.body.accessToken);
  assert.equal((await post('/v1/auth/login/2fa', { challenge, code: codigoDoApp(setup.body.secret, 1) })).status, 401); // desafio gasto

  // código de recuperação: uma vez só, e avisa por e-mail
  const e1 = (await post('/v1/auth/login', { email: ivo.email, password: ivo.senha })).body.error.challenge;
  const rec = ligado.body.recoveryCodes[0];
  const porRecuperacao = await post('/v1/auth/login/2fa', { challenge: e1, code: rec.toLowerCase() });
  assert.equal(porRecuperacao.status, 200);
  const e2 = (await post('/v1/auth/login', { email: ivo.email, password: ivo.senha })).body.error.challenge;
  assert.equal((await post('/v1/auth/login/2fa', { challenge: e2, code: rec })).status, 401);
  assert.ok((await avisosPara(ivo.email)).some((m) => /recuperação/.test(m.subject)));

  // ação sensível pede o código do app (não a senha)
  const token = porRecuperacao.body.accessToken; // a sessão de PC mais nova
  const semCodigo = await post('/v1/me/email', { email: 'ivo2@example.com', currentPassword: ivo.senha }, token);
  assert.equal(semCodigo.body.error.code, 'code2fa_required');
  passar(30_000);
  assert.equal((await post('/v1/me/password', { currentPassword: ivo.senha, newPassword: 'outra-senha-1' }, token)).status, 401);
  assert.equal((await post('/v1/me/password', { currentPassword: ivo.senha, newPassword: 'outra-senha-1', code2fa: codigoDoApp(setup.body.secret) }, token)).status, 200);

  // desligar pede o código
  passar(30_000);
  assert.equal((await post('/v1/me/2fa/disable', {}, token)).status, 401);
  assert.equal((await post('/v1/me/2fa/disable', { code2fa: codigoDoApp(setup.body.secret) }, token)).body.user.twoFactor, false);
});

test('5 códigos errados no login derrubam o desafio', async () => {
  const jo = await contaConfirmada('Jo');
  const setup = await post('/v1/me/2fa/setup', { currentPassword: jo.senha }, jo.accessToken);
  await post('/v1/me/2fa/enable', { code: codigoDoApp(setup.body.secret) }, jo.accessToken);
  passar(30_000);
  const ch = (await post('/v1/auth/login', { email: jo.email, password: jo.senha })).body.error.challenge;
  for (let i = 0; i < 5; i++) await post('/v1/auth/login/2fa', { challenge: ch, code: '000000' });
  const depois = await post('/v1/auth/login/2fa', { challenge: ch, code: codigoDoApp(setup.body.secret) });
  assert.equal(depois.body.error.code, 'challenge_expired');
});

test('esqueci a senha com 2FA pede o código do app também', async () => {
  const lu = await contaConfirmada('Lu');
  const setup = await post('/v1/me/2fa/setup', { currentPassword: lu.senha }, lu.accessToken);
  await post('/v1/me/2fa/enable', { code: codigoDoApp(setup.body.secret) }, lu.accessToken);
  passar(61_000);
  assert.equal((await post('/v1/auth/forgot', { login: lu.email })).body.twoFactor, true);
  const codigo = await codigoPara(lu.email);
  const sem = await post('/v1/auth/forgot/reset', { login: lu.email, code: codigo, password: 'nova-senha-123' });
  assert.equal(sem.body.error.code, 'code2fa_required');
  passar(30_000);
  const com = await post('/v1/auth/forgot/reset', { login: lu.email, code: codigo, password: 'nova-senha-123', code2fa: codigoDoApp(setup.body.secret) });
  assert.equal(com.status, 200);
});

test('administrador precisa do 2FA para o painel; outro admin desliga o 2FA de quem perdeu o celular', async () => {
  const mel = await contaConfirmada('Mel');
  await request('/v1/admin/users/' + mel.user.id, { method: 'PATCH', body: { role: 'admin' } }, ADMIN);
  const barrado = await request('/v1/admin/overview', {}, mel.accessToken);
  assert.equal(barrado.status, 403);
  assert.equal(barrado.body.error.code, 'admin_2fa_required');
  const setup = await post('/v1/me/2fa/setup', { currentPassword: mel.senha }, mel.accessToken);
  await post('/v1/me/2fa/enable', { code: codigoDoApp(setup.body.secret) }, mel.accessToken);
  const visao = await request('/v1/admin/overview', {}, mel.accessToken);
  assert.equal(visao.status, 200);
  assert.equal(visao.body.email.ativo, true);
  // admin não desliga o próprio 2FA
  passar(30_000);
  assert.equal((await post('/v1/me/2fa/disable', { code2fa: codigoDoApp(setup.body.secret) }, mel.accessToken)).status, 400);
  const nil = await contaConfirmada('Nil');
  const s2 = await post('/v1/me/2fa/setup', { currentPassword: nil.senha }, nil.accessToken);
  await post('/v1/me/2fa/enable', { code: codigoDoApp(s2.body.secret) }, nil.accessToken);
  assert.equal((await post('/v1/admin/users/' + nil.user.id + '/2fa-reset', {}, mel.accessToken)).status, 200);
  assert.equal((await request('/v1/admin/users', {}, ADMIN)).body.users.find((u) => u.id === nil.user.id).twoFactor, false);
  assert.ok((await avisosPara(nil.email)).some((m) => /desligada/.test(m.subject)));
  assert.ok(api.db.prepare("SELECT 1 FROM audit_log WHERE action = '2fa.reset' AND target = ?").get(nil.user.id));
});

test('limites: no máximo 5 códigos por hora por conta', async () => {
  const email = 'olga@example.com';
  await post('/v1/auth/register', { email, displayName: 'Olga', password: 'senha-Olga-1', handleName: 'Olga' });
  for (let i = 0; i < 4; i++) { passar(61_000); assert.equal((await post('/v1/auth/confirm-email/resend', { email })).status, 200); }
  passar(61_000);
  assert.equal((await post('/v1/auth/confirm-email/resend', { email })).status, 429);
});

test('sem e-mail configurado tudo funciona como antes', async () => {
  const velho = createApiServer({ dbPath: ':memory:', stunPort: 0, stun: false, requireApproval: false, smtp: null });
  const url = 'http://127.0.0.1:' + (await velho.listen(0, '127.0.0.1')).port;
  try {
    const r = await (await fetch(url + '/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'p@example.com', displayName: 'P', password: 'senha-longa-1', handleName: 'Pe' }) })).json();
    assert.equal(r.status, 'active');
    assert.ok(r.accessToken);
    const esqueci = await fetch(url + '/v1/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'p@example.com' }) });
    assert.equal(esqueci.status, 503);
    const cfg = await (await fetch(url + '/v1/auth/google/config')).json();
    assert.equal(cfg.emailConfirmation, false);
  } finally { await velho.close(); }
});
