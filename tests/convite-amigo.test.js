'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { amigoTokenDe } = require('../renderer/primeira-entrada');

const TOKEN = 'Abc123_-' + 'x'.repeat(24);

test('aceita o link https, o telap2p://amigo, o segredo puro e o código com hífens', () => {
  assert.equal(amigoTokenDe('https://api.exemplo.com/a/' + TOKEN), TOKEN);
  assert.equal(amigoTokenDe('  https://api.exemplo.com/a/' + TOKEN + '  '), TOKEN);
  assert.equal(amigoTokenDe('telap2p://amigo/' + TOKEN), TOKEN);
  assert.equal(amigoTokenDe(TOKEN), TOKEN);
  assert.equal(amigoTokenDe('abcd-efgh-jk'), 'ABCD-EFGH-JK');
});

test('nickname comum não vira convite (nem com 10 letras sem hífen)', () => {
  assert.equal(amigoTokenDe('Cristian'), '');
  assert.equal(amigoTokenDe('Mateus Silva'), '');
  assert.equal(amigoTokenDe('ABCDEFGHJK'), '');
  assert.equal(amigoTokenDe(''), '');
  assert.equal(amigoTokenDe(null), '');
});

test('recusa link de outro tipo, caminho errado e segredo malformado', () => {
  assert.equal(amigoTokenDe('telap2p://invite/' + TOKEN), '');
  assert.equal(amigoTokenDe('https://api.exemplo.com/b/' + TOKEN), '');
  assert.equal(amigoTokenDe('https://api.exemplo.com/a/curto'), '');
  assert.equal(amigoTokenDe('javascript:alert(1)'), '');
  assert.equal(amigoTokenDe('telap2p://amigo/curto'), '');
  assert.equal(amigoTokenDe('x'.repeat(121)), '');
});

test('acha o link ou o código dentro da mensagem copiada pelo app', () => {
  const msg = 'Me adiciona no Tela P2P: https://api.exemplo.com/a/' + TOKEN + '\n(ou cole o código ABCD-EFGH-JK em Adicionar amigo)';
  assert.equal(amigoTokenDe(msg), TOKEN);
  assert.equal(amigoTokenDe('oi! me adiciona: abcd-efgh-jk valeu'), 'ABCD-EFGH-JK');
  assert.equal(amigoTokenDe('oi, sou o Cristian, me adiciona'), '');
  assert.equal(amigoTokenDe('olha https://site.com/outra/' + TOKEN), '');
});
