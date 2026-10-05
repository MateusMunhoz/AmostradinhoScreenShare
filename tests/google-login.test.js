'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loginComGoogle, desafio, AUTH_URL } = require('../main/google-login');

const CLIENTE = 'cliente-teste.apps.googleusercontent.com';

// O "navegador": lê o endereço do Google, e responde como o Google responderia, para o servidor local
const navegador = (resposta) => async (endereco) => {
  const url = new URL(endereco);
  assert.equal(url.origin + url.pathname, AUTH_URL);
  const p = url.searchParams;
  assert.equal(p.get('client_id'), CLIENTE);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.match(p.get('scope'), /openid/);
  assert.match(p.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const q = resposta({ state: p.get('state'), challenge: p.get('code_challenge') });
  const r = await fetch(p.get('redirect_uri') + '?' + new URLSearchParams(q));
  await r.text();
  return r.status;
};

test('devolve o código, o verificador do PKCE e o retorno certo', async () => {
  let desafioVisto = '';
  const r = await loginComGoogle({ clientId: CLIENTE, abrir: navegador(({ state, challenge }) => { desafioVisto = challenge; return { code: 'codigo-do-google-123', state }; }) });
  assert.equal(r.code, 'codigo-do-google-123');
  assert.match(r.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.equal(r.codeVerifier.length, 64);
  assert.equal(desafio(r.codeVerifier), desafioVisto); // o Google guardou o desafio; o servidor depois prova com o verificador
});

test('recusa resposta com estado diferente (outro pedido) e não entrega o código', async () => {
  await assert.rejects(
    loginComGoogle({ clientId: CLIENTE, abrir: navegador(() => ({ code: 'codigo-qualquer-1', state: 'estado-errado' })) }),
    /não bateu/,
  );
});

test('login cancelado no Google avisa e fecha o servidor local', async () => {
  let porta = 0;
  await assert.rejects(
    loginComGoogle({ clientId: CLIENTE, abrir: async (e) => { const u = new URL(new URL(e).searchParams.get('redirect_uri')); porta = u.port; return navegador(({ state }) => ({ error: 'access_denied', state }))(e); } }),
    /cancelado/,
  );
  await new Promise((r) => setTimeout(r, 400));
  await assert.rejects(fetch('http://127.0.0.1:' + porta + '/callback')); // ninguém mais escuta
});

test('passa do tempo sem resposta: erro claro e o servidor local fecha', async () => {
  await assert.rejects(loginComGoogle({ clientId: CLIENTE, tempoMs: 150, abrir: async () => {} }), /demorou/);
});

test('cliente inválido não abre nada', async () => {
  let abriu = false;
  await assert.rejects(loginComGoogle({ clientId: 'x', abrir: async () => { abriu = true; } }), /inválido/);
  assert.equal(abriu, false);
});

test('só o caminho /callback responde', async () => {
  await loginComGoogle({
    clientId: CLIENTE,
    abrir: async (e) => {
      const redirect = new URL(e).searchParams.get('redirect_uri');
      assert.equal((await fetch(redirect.replace('/callback', '/outro'))).status, 404);
      return navegador(({ state }) => ({ code: 'codigo-do-google-456', state }))(e);
    },
  });
});
