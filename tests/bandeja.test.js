// Menu do ícone na bandeja (main/bandeja.js): só o modelo, sem o Electron.
const test = require('node:test');
const assert = require('node:assert');
const { menuModel } = require('../main/bandeja');

const ids = (items) => items.filter((i) => i.id).map((i) => i.id);

test('menu tem as ações em português, com sair por último', () => {
  const items = menuModel({ version: '1.2.3', call: false });
  assert.deepStrictEqual(ids(items), ['header', 'open', 'update', 'mute', 'deafen', 'clip', 'restart', 'quit']);
  assert.strictEqual(items[0].label, 'Tela P2P 1.2.3');
  assert.strictEqual(items[0].enabled, false);
  assert.strictEqual(items.at(-1).label, 'Sair do Tela P2P');
  assert.match(items.find((i) => i.id === 'update').label, /^Procurar atualização/);
});

test('mutar, ensurdecer e clipe só ficam ativos na sala', () => {
  const off = menuModel({ version: '1', call: false });
  const on = menuModel({ version: '1', call: true });
  for (const id of ['mute', 'deafen', 'clip']) {
    assert.strictEqual(off.find((i) => i.id === id).enabled, false);
    assert.strictEqual(on.find((i) => i.id === id).enabled, true);
  }
});
