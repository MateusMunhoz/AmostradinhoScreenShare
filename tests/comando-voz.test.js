const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { criar, vksDoAtalho, MODELOS, PROGRAMA } = require('../main/comando-voz');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('atalho do Electron vira teclas virtuais do Windows (para segurar pelo teclas.exe)', () => {
  assert.deepEqual(vksDoAtalho('CommandOrControl+Shift+V'), [17, 16, 86]);
  assert.deepEqual(vksDoAtalho('Alt+F9'), [18, 120]);
  assert.deepEqual(vksDoAtalho('CommandOrControl+num5'), [17, 101]);
  assert.deepEqual(vksDoAtalho('CommandOrControl+Space'), [17, 32]);
  for (const ruim of ['', 'Ctrl+Coisa', null, 'A'.repeat(80)]) assert.deepEqual(vksDoAtalho(ruim), []);
});

test('o que o app baixa está preso por tamanho e SHA-256 no código', () => {
  assert.match(PROGRAMA.url, /^https:\/\/github\.com\/ggml-org\/whisper\.cpp\/releases\/download\//);
  assert.match(PROGRAMA.sha256, /^[0-9a-f]{64}$/);
  assert.ok(PROGRAMA.arquivos['whisper-cli.exe']);
  for (const sha of Object.values(PROGRAMA.arquivos)) assert.match(sha, /^[0-9a-f]{64}$/);
  for (const m of Object.values(MODELOS)) { assert.match(m.sha256, /^[0-9a-f]{64}$/); assert.ok(m.tamanho > 1e6); }
});

// Servidor local no lugar da internet: /bom tem o conteúdo certo, /ruim tem outro do mesmo tamanho, /lento demora
async function servidor(conteudo) {
  const srv = http.createServer((req, res) => {
    if (req.url.endsWith('/lento.bin')) {
      res.writeHead(200);
      res.write(conteudo.subarray(0, 10));
      return; // nunca termina: espera o cancelamento
    }
    res.writeHead(200);
    res.end(req.url.endsWith('/ruim.bin') ? Buffer.alloc(conteudo.length, 7) : conteudo);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return srv;
}
function preparar(srv, conteudo, arquivoModelo) {
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'comando-voz-'));
  const programa = { url: '', tamanho: 0, sha256: '', arquivos: { 'whisper-cli.exe': sha('exe') } };
  // O programa já "instalado": o teste cobre o download do modelo
  fs.mkdirSync(path.join(dados, 'comando-voz', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dados, 'comando-voz', 'bin', 'whisper-cli.exe'), 'exe');
  const modelos = { leve: { arquivo: arquivoModelo, tamanho: conteudo.length, sha256: sha(conteudo) } };
  const cv = criar(dados, { plataforma: 'win32', programa, modelos, hf: `http://127.0.0.1:${srv.address().port}` });
  return { cv, dados };
}

test('download: assinatura certa instala; diferente não deixa nada; cancelar para', async (t) => {
  const conteudo = crypto.randomBytes(200_000);
  const srv = await servidor(conteudo);
  t.after(() => srv.close());

  const bom = preparar(srv, conteudo, 'bom.bin');
  const avisos = [];
  const r = await bom.cv.instalar('leve', (a) => avisos.push(a));
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(r.estado.modelos, ['leve']);
  assert.ok(avisos.length && avisos.at(-1).feito === conteudo.length && avisos.at(-1).etapa === 'modelo');
  assert.deepEqual(fs.readFileSync(path.join(bom.dados, 'comando-voz', 'bom.bin')), conteudo);

  const ruim = preparar(srv, conteudo, 'ruim.bin');
  const r2 = await ruim.cv.instalar('leve');
  assert.equal(r2.ok, false);
  assert.match(r2.erro, /não confere/);
  assert.deepEqual(fs.readdirSync(path.join(ruim.dados, 'comando-voz')), ['bin']); // nem o .part sobra

  const lento = preparar(srv, conteudo, 'lento.bin');
  const indo = lento.cv.instalar('leve');
  setTimeout(() => lento.cv.cancelar(), 100);
  const r3 = await indo;
  assert.equal(r3.cancelado, true);
  assert.deepEqual(fs.readdirSync(path.join(lento.dados, 'comando-voz')), ['bin']);

  assert.equal((await bom.cv.remover()).ok, true);
  assert.equal(fs.existsSync(path.join(bom.dados, 'comando-voz')), false);
  for (const d of [bom.dados, ruim.dados, lento.dados]) fs.rmSync(d, { recursive: true, force: true });
});

test('transcrever recusa o que não é WAV e o que é grande demais; fora do Windows não instala', async () => {
  const cv = criar(fs.mkdtempSync(path.join(os.tmpdir(), 'comando-voz-')), { plataforma: 'linux' });
  assert.equal((await cv.transcrever(Buffer.from('oi'), 'leve', '')).erro, 'Áudio inválido.');
  const grande = Buffer.alloc(44 + 16000 * 2 * 16);
  grande.write('RIFF', 0, 'latin1'); grande.write('WAVE', 8, 'latin1');
  assert.equal((await cv.transcrever(grande, 'leve', '')).erro, 'Áudio inválido.');
  assert.equal((await cv.transcrever(Buffer.alloc(100), 'nenhum', '')).erro, 'Modelo desconhecido.');
  assert.equal((await cv.instalar('leve')).ok, false);
  assert.equal(cv.estado().suportado, false);
});
