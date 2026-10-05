const { test } = require('node:test');
const assert = require('node:assert/strict');
const { novidadesDoLog, lerArgs } = require('../publicar');

const LOG = [
  '2026-10-03|Chat: /musica com prévia; players isolados',
  '2026-10-03|CI: smoke no Windows',
  '2026-10-03|Merge branch main',
  '2026-10-02|Versão 1.12.9',
  '2026-10-02|Amigos: busca única',
  '2026-10-01|Versão 1.12.8',
  '2026-10-01|Versão 1.12.7',
  '2026-10-01|add yt music player',
];

test('commits sem "Versão" vão para a versão nova; CI e merge ficam de fora', () => {
  const l = novidadesDoLog(LOG, '1.12.10', '2026-10-04');
  assert.deepEqual(l[0], { version: '1.12.10', date: '2026-10-04', items: ['Chat: /musica com prévia; players isolados'] });
  assert.deepEqual(l[1], { version: '1.12.9', date: '2026-10-02', items: ['Amigos: busca única'] });
});

test('versão sem commit próprio vira "Correções e melhorias"', () => {
  const l = novidadesDoLog(LOG, '1.12.10', '2026-10-04');
  assert.deepEqual(l[2].items, ['Correções e melhorias']);
  assert.deepEqual(l[3].items, ['add yt music player']);
});

test('sem versão nova, os commits soltos do topo não entram; guarda no máximo "max" versões', () => {
  const l = novidadesDoLog(LOG, null, '', 2);
  assert.deepEqual(l.map((n) => n.version), ['1.12.9', '1.12.8']);
});

test('mensagem muito longa é cortada', () => {
  const l = novidadesDoLog(['2026-10-01|' + 'a'.repeat(400)], '2.0.0', '2026-10-01');
  assert.equal(l[0].items[0].length, 300);
});

test('publicar: a versão escolhida vale com ou sem --notas, e o texto das notas nunca vira versão', () => {
  assert.equal(lerArgs(['1.17.0']).version, '1.17.0');
  assert.equal(lerArgs([]).version, undefined);
  assert.deepEqual(lerArgs(['1.17.0', '--notas', 'texto', '--sem-github']), { version: '1.17.0', notes: 'texto', github: false });
  assert.equal(lerArgs(['--notas', '2.0.0']).version, undefined);
  assert.equal(lerArgs(['--notas', '2.0.0', '1.17.0']).version, '1.17.0');
});
