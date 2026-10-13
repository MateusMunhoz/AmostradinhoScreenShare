'use strict';
// Pix do apoio (renderer/apoio.js): BR Code estático no padrão do Banco Central e o QR que cabe nele
const test = require('node:test');
const assert = require('node:assert');
const { APOIO_PIX, pixBrCode, pixCrc, pixTexto } = require('../renderer/apoio.js');
const QR = require('../renderer/qr.js');

test('CRC16-CCITT confere com o valor de referência', () => {
  assert.strictEqual(pixCrc('123456789'), '29B1');
  // Exemplo do manual do BR Code do Banco Central
  assert.strictEqual(pixCrc('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'), '1D3D');
});

test('BR Code com chave, nome e cidade, sem valor', () => {
  const s = pixBrCode({ chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'Fulano de Tal', cidade: 'Brasília' });
  assert.strictEqual(s,
    '000201' + '2658' + '0014br.gov.bcb.pix' + '0136123e4567-e12b-12d1-a456-426655440000'
    + '52040000' + '5303986' + '5802BR' + '5913FULANO DE TAL' + '6008BRASILIA' + '62070503***' + '6304' + s.slice(-4));
  assert.strictEqual(pixCrc(s.slice(0, -4)), s.slice(-4));
});

test('valor vai com duas casas; sem valor ou valor zero, quem paga escolhe', () => {
  const base = { chave: 'abc', nome: 'X', cidade: 'Y' };
  assert.match(pixBrCode({ ...base, valor: 10 }), /540510\.00/);
  assert.match(pixBrCode({ ...base, valor: 2.5 }), /54042\.50/);
  assert.doesNotMatch(pixBrCode({ ...base, valor: 0 }), /5304|54\d\d\d/);
});

test('sem chave, nome ou cidade não gera código', () => {
  assert.strictEqual(pixBrCode({ chave: '', nome: 'X', cidade: 'Y' }), '');
  assert.strictEqual(pixBrCode({ chave: 'abc', nome: '', cidade: 'Y' }), '');
  assert.strictEqual(pixBrCode({ chave: 'abc', nome: 'X', cidade: '' }), '');
});

test('nome e cidade sem acento, em maiúsculas e cortados no limite', () => {
  assert.strictEqual(pixTexto('São João', 15), 'SAO JOAO');
  assert.strictEqual(pixTexto('a'.repeat(40), 25).length, 25);
});

test('o maior código com valor cabe no QR do app', () => {
  const s = pixBrCode({ chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'n'.repeat(25), cidade: 'c'.repeat(15), valor: 50 });
  assert.ok(QR.svg(s).startsWith('<svg'));
});

// Trava da chave: trocar o Pix de quem recebe faz este teste (e o CI) falhar, para a troca aparecer no PR.
// Só mude junto com a chave, de propósito, e com a revisão de outra pessoa.
test('o Pix do apoio é o da conta combinada', () => {
  assert.deepStrictEqual(APOIO_PIX, { chave: 'dc3507fa-798f-4593-9ede-2908302d7058', nome: 'CRISTIAN D VILELA', cidade: 'RIO DE JANEIR' });
  // O mesmo código que o banco gera, sem o campo opcional 01 (QR estático)
  const banco = '00020126580014br.gov.bcb.pix0136dc3507fa-798f-4593-9ede-2908302d70585204000053039865802BR5917CRISTIAN D VILELA6013RIO DE JANEIR62070503***6304';
  assert.strictEqual(pixBrCode(APOIO_PIX), banco + pixCrc(banco));
});
