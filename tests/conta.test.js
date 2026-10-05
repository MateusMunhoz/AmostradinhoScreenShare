'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
global.load = () => '';
const { limparBio } = require('../renderer/conta');

test('a frase do perfil perde quebras de linha e espaços repetidos, e passa de 128 só até 128', () => {
  assert.equal(limparBio('  Jogo à noite\n\te   ouço rock  '), 'Jogo à noite e ouço rock');
  assert.equal(limparBio(null), '');
  assert.equal(Array.from(limparBio('é'.repeat(300))).length, 128);
  assert.equal(limparBio('a\u0000b'), 'a b');
});
