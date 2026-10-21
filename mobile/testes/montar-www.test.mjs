// O montador gera mobile/www a partir do desktop sem mexer no desktop: tem tudo que o index.html carrega, a ponte vem antes
// do primeiro script, e a CSP muda só no connect-src.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { montar, arquivosDoIndex, transformarHtml, ajustarProjetoIos } from '../scripts/montar-www.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const original = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

let saida, antes, html;
before(async () => {
  antes = Object.fromEntries(['index.html', 'preload.js', 'main.js', 'package.json'].map((f) => [f, hash(path.join(RAIZ, f))]));
  saida = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-www-'));
  await montar({ raiz: RAIZ, saida });
  html = fs.readFileSync(path.join(saida, 'index.html'), 'utf8');
});

test('o www tem tudo o que o index.html carrega, mais os worklets e o ruído', () => {
  const usados = arquivosDoIndex(original);
  assert.ok(usados.length > 60, `achou só ${usados.length} arquivos no index.html`);
  for (const f of usados) assert.ok(fs.existsSync(path.join(saida, f)), `falta ${f}`);
  for (const f of ['pcm-worklet.js', 'renderer/rnnoise-vad-worklet.js', 'vendor/noise/rnnoiseWorklet.js', 'vendor/noise/rnnoise.wasm', 'vendor/noise/rnnoise_simd.wasm', 'ponte.js']) {
    assert.ok(fs.existsSync(path.join(saida, f)), `falta ${f}`);
  }
});

test('não leva arquivo que só o desktop usa para gerar coisas (scripts de imagem e de áudio, notas)', () => {
  const todos = [];
  const andar = (d) => { for (const i of fs.readdirSync(d, { withFileTypes: true })) i.isDirectory() ? andar(path.join(d, i.name)) : todos.push(path.join(d, i.name)); };
  andar(saida);
  assert.deepEqual(todos.filter((f) => /\.(py|md)$|gerar-[^/\\]*\.js$/i.test(f)), []);
});

test('a ponte vem antes do primeiro script e o html sabe que é iOS', () => {
  const ponte = html.indexOf('<script src="ponte.js">');
  const primeiro = html.search(/<script src="(?!ponte\.js)/);
  assert.ok(ponte > 0 && ponte < primeiro, 'ponte.js antes de qualquer outro script');
  assert.match(html, /<html data-plataforma="ios"/);
  assert.equal((html.match(/ponte\.js/g) || []).length, 1);
});

test('o CSS do iPhone vai para o www e entra depois dos estilos do desktop', () => {
  assert.ok(fs.existsSync(path.join(saida, 'styles-ios.css')));
  const ios = html.indexOf('href="styles-ios.css"');
  const outros = [...html.matchAll(/<links+rel="stylesheet"[^>]*href="(?!styles-ios)[^"]+"/g)].map((m) => m.index);
  assert.ok(ios > 0 && outros.every((i) => i < ios), 'styles-ios.css por último');
});

test('a CSP muda só no connect-src (ganha https:); o resto fica como no desktop', () => {
  const csp = (t) => /Content-Security-Policy"\s+content="([^"]+)"/.exec(t)[1];
  const nova = csp(html), velha = csp(original);
  assert.notEqual(nova, velha);
  assert.equal(nova.replace('connect-src ws: wss: https:', 'connect-src ws: wss:'), velha);
  assert.ok(!/'unsafe-(inline|eval)'/.test(nova), "sem 'unsafe-inline' nem 'unsafe-eval' (o 'wasm-unsafe-eval' do RNNoise já existe no desktop)");
});

test('tem o viewport do aparelho, depois do charset', () => {
  assert.match(html, /<meta charset="utf-8">\s*<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
});

test('o desktop não muda: index.html, preload.js, main.js e package.json ficam iguais', () => {
  for (const [f, h] of Object.entries(antes)) assert.equal(hash(path.join(RAIZ, f)), h, `${f} mudou durante a montagem`);
});

test('se a CSP do desktop mudar, o montador avisa em vez de gerar um app sem rede', () => {
  assert.throws(() => transformarHtml(original.replace('connect-src ws: wss:', "connect-src 'self'")), /connect-src/);
  assert.throws(() => transformarHtml('<html><head></head><body></body></html>'), /CSP/);
});

test('ajustarProjetoIos: iOS 16.4, versão do desktop, e rodar de novo não muda nada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-pbx-'));
  const pbx = path.join(dir, 'project.pbxproj');
  fs.writeFileSync(pbx, 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nMARKETING_VERSION = 1.0;\nPRODUCT_BUNDLE_IDENTIFIER = com.telap2p.nebula;\nIPHONEOS_DEPLOYMENT_TARGET = 15.0;\n');
  assert.equal(ajustarProjetoIos('1.20.5', pbx), true);
  const t = fs.readFileSync(pbx, 'utf8');
  assert.equal((t.match(/IPHONEOS_DEPLOYMENT_TARGET = 16\.4;/g) || []).length, 2);
  assert.match(t, /MARKETING_VERSION = 1\.20\.5;/);
  assert.match(t, /PRODUCT_BUNDLE_IDENTIFIER = com\.telap2p\.nebula;/);
  assert.equal(ajustarProjetoIos('1.20.5', pbx), false);
  assert.equal(ajustarProjetoIos('1.0.0', path.join(dir, 'nao-existe')), false);
});

test('o projeto iOS gerado está no 16.4 e na versão do desktop', () => {
  const pbx = path.join(RAIZ, 'mobile', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  const t = fs.readFileSync(pbx, 'utf8');
  assert.ok(!/IPHONEOS_DEPLOYMENT_TARGET = 1[0-5]\./.test(t), 'algum alvo abaixo de 16.4');
  assert.ok([...t.matchAll(/MARKETING_VERSION = ([^;]+);/g)].every((m) => m[1] === pacote.version), 'MARKETING_VERSION diferente da versão do desktop (rode npm run montar)');
  assert.match(t, /PRODUCT_BUNDLE_IDENTIFIER = com\.telap2p\.nebula;/);
});

test('nada de mobile/ vai no pacote do desktop (PACK_FILES e build.files)', () => {
  const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  assert.ok(!pacote.build.files.some((p) => /(^|\/)mobile\b/.test(p)));
  const publicar = fs.readFileSync(path.join(RAIZ, 'publicar.js'), 'utf8');
  assert.ok(!/['"]mobile\//.test(publicar));
});
