'use strict';

// O serviço do app (main/razze-service.js) com o e-mail confirmado, o 2FA e o Google: o desafio e os tickets ficam
// no processo principal; a página só vê o status
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiServer } = require('../razze-api/server');
const { createRazzeService } = require('../main/razze-service');
const totp = require('../razze-api/totp');
const { problemaDoNomeId, sugerirNomeId, pareceIdentificador } = require('../renderer/conta-seguranca');

const CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from('sealed:' + value),
  decryptString: (value) => value.toString().slice('sealed:'.length),
};

test('nome do identificador no app: mesmas regras do servidor', () => {
  assert.equal(problemaDoNomeId('Lucas2'), '');
  for (const ruim of ['', 'a', 'lú', 'lu cas', 'lu_cas', 'adminx', 'x'.repeat(33)]) assert.notEqual(problemaDoNomeId(ruim), '', ruim);
  assert.equal(sugerirNomeId('João Pedro'), 'JoaoPedro');
  assert.equal(sugerirNomeId('😀'), '');
  assert.equal(pareceIdentificador(' lucas#0420 '), true);
  for (const nao of ['lucas', 'lucas#42', 'lu cas#0420', 'a@b.com']) assert.equal(pareceIdentificador(nao), false, nao);
});

test('cadastro com código, login com 2FA e Google com escolha do nome pelo serviço', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-conta-'));
  let clock = 30_000_000_000;
  const caixa = [];
  const contas = new Map();
  const server = createApiServer({
    dbPath: ':memory:', requireApproval: false, stun: false, now: () => clock,
    sendEmail: async (m) => { caixa.push(m); }, emailRetries: [], totpKey: 'chave-de-teste-do-servico-com-tamanho',
    googleClientId: CLIENT_ID, googleClientSecret: 's',
    googleExchange: async (p) => ({ id_token: contas.get(p.code) }),
  });
  const address = await server.listen(0, '127.0.0.1');
  const codigo = async () => { await new Promise((r) => setImmediate(r)); return /(\d{3}) (\d{3})/.exec(caixa.at(-1).text).slice(1).join(''); };
  try {
    const app = createRazzeService({ app: { getPath: () => profile }, safeStorage, wireguard: {} });
    app.configure('http://127.0.0.1:' + address.port);

    // Cadastro: o código chega por e-mail e só ele entra
    const reg = await app.register('nina@example.com', 'senha-da-nina', 'Nina', 'Nina');
    assert.equal(reg.status, 'confirm_email');
    assert.match(reg.enviadoPara, /@example\.com$/);
    assert.equal(app.state().authenticated, false);
    const ok = await app.confirmEmail(await codigo());
    assert.equal(ok.status, 'active');
    assert.match(ok.user.handle, /^Nina#\d{4}$/);
    assert.equal(app.state().authenticated, true);

    // 2FA: liga e o login por senha passa a pedir o código; o desafio não sai do serviço
    const setup = await app.twoFactorSetup({ currentPassword: 'senha-da-nina' });
    const chave = totp.deBase32(setup.secret);
    await app.twoFactorEnable(totp.codigo(chave, totp.passoDe(clock)));
    await app.logout();
    clock += 30_000;
    const etapa = await app.login(ok.user.handle, 'senha-da-nina');
    assert.deepEqual(etapa, { status: '2fa_required' });
    await assert.rejects(app.login2fa('000000'), /incorreto/);
    const dentro = await app.login2fa(totp.codigo(chave, totp.passoDe(clock)));
    assert.equal(dentro.status, 'active');

    // Google novo: escolhe o nome antes de criar (o ticket fica no serviço)
    await app.logout();
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    contas.set('codigo-google-otavio', b64({ alg: 'none' }) + '.' + b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(clock / 1000) + 3600, email_verified: true, sub: 's-otavio', email: 'otavio@gmail.com', name: 'Otávio' }) + '.x');
    const abrir = async (url) => { // o "navegador": devolve o código para o servidor local do login
      const u = new URL(url);
      await fetch(u.searchParams.get('redirect_uri') + '?code=codigo-google-otavio&state=' + u.searchParams.get('state'));
    };
    const escolha = await app.googleLogin(abrir);
    assert.equal(escolha.status, 'choose_handle');
    assert.equal(escolha.suggestion, 'Otavio');
    assert.equal(escolha.ticket, undefined); // o ticket não vai para a página
    await assert.rejects(app.googleFinish('ota vio'), /letras sem acento/);
    const criado = await app.googleFinish('Tavinho');
    assert.equal(criado.status, 'active');
    assert.match(criado.user.handle, /^Tavinho#\d{4}$/);
  } finally {
    await server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
