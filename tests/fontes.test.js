const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanTitle, dedupeWindows } = require('../main/fontes');

const img = (v) => new Array(32 * 18).fill(v);

test('Título: tira o contador de não lidas da frente', () => {
  assert.equal(cleanTitle('(22) WhatsApp'), 'WhatsApp');
  assert.equal(cleanTitle('(99+) Discord'), 'Discord');
  assert.equal(cleanTitle('WhatsApp'), 'WhatsApp');
  assert.equal(cleanTitle('Planilha (2) final'), 'Planilha (2) final'); // só na frente
});

test('Janelas repetidas do mesmo app com a mesma imagem viram uma, sem o contador no nome', () => {
  const list = dedupeWindows([
    { id: 'screen:0:0', name: 'Tela inteira', sig: img(40) },
    { id: 'window:1:0', name: 'WhatsApp', sig: img(80) },
    { id: 'window:2:0', name: '(22) WhatsApp', sig: img(83) },
    { id: 'window:3:0', name: 'Discord', sig: img(80) },
  ]);
  assert.deepEqual(list.map((s) => [s.id, s.name]), [['screen:0:0', 'Tela inteira'], ['window:1:0', 'WhatsApp'], ['window:3:0', 'Discord']]);
});

test('Duas janelas do mesmo app com imagens diferentes (duas conversas abertas) continuam as duas', () => {
  const list = dedupeWindows([
    { id: 'window:1:0', name: 'WhatsApp', sig: img(30) },
    { id: 'window:2:0', name: 'WhatsApp', sig: img(200) },
  ]);
  assert.equal(list.length, 2);
});
