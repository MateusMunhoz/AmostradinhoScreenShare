'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recorteCaixa, recorteArrastar } = require('../renderer/recorte');

test('sem zoom o corte é o maior quadrado, centralizado', () => {
  assert.deepEqual(recorteCaixa(1000, 500, 1, 0.5, 0.5), { lado: 500, x: 250, y: 0 });
  assert.deepEqual(recorteCaixa(500, 1000, 1, 0.5, 0.5), { lado: 500, x: 0, y: 250 });
});

test('o zoom diminui o quadrado e o centro nunca deixa o corte sair da imagem', () => {
  const c = recorteCaixa(1000, 500, 2, 0.5, 0.5);
  assert.equal(c.lado, 250);
  const canto = recorteCaixa(1000, 500, 2, 0, 0);
  assert.deepEqual(canto, { lado: 250, x: 0, y: 0 });
  const fim = recorteCaixa(1000, 500, 2, 1, 1);
  assert.deepEqual(fim, { lado: 250, x: 750, y: 250 });
  assert.equal(recorteCaixa(1000, 500, 99, 0.5, 0.5).lado, 125); // zoom máximo 4
  assert.equal(recorteCaixa(1000, 500, 0.2, 0.5, 0.5).lado, 500); // mínimo 1
});

test('arrastar anda o centro ao contrário e para na borda', () => {
  // imagem 1000x500, sem zoom: quadrado de 500 px na vista de 360 px => 1 px de tela = 1,39 px da imagem
  const a = recorteArrastar(1000, 500, 1, 0.5, 0.5, 36, 0);
  assert.ok(a.cx < 0.5 && a.cx > 0.4);
  assert.equal(a.cy, 0.5);
  const preso = recorteArrastar(1000, 500, 1, 0.5, 0.5, 100000, 100000);
  assert.equal(preso.cx, 0.25); // o corte encosta na esquerda: centro em 250/1000
  assert.equal(preso.cy, 0.5);  // na altura o quadrado já ocupa tudo
});
