// Prévia dos links do YouTube no chat (main/youtube-previa.js): título, canal e capa, com tudo limitado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { previaYoutube } = require('../main/youtube-previa');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

async function servidor(t, rotas) {
  const pedidos = [];
  const s = http.createServer((req, res) => {
    pedidos.push(req.url);
    const r = rotas(req.url);
    res.writeHead(r.status || 200, { 'content-type': r.tipo || 'application/json' });
    res.end(r.corpo);
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  t.after(() => s.close());
  return { base: `http://127.0.0.1:${s.address().port}`, pedidos };
}

test('vídeo público: título e canal limpos, capa em data: URL', async (t) => {
  const { base, pedidos } = await servidor(t, (url) => url.startsWith('/vi/')
    ? { tipo: 'image/jpeg', corpo: JPEG }
    : { corpo: JSON.stringify({ title: '  Clipe\nnovo \u0007ao vivo ', author_name: 'Canal do Koch' }) });
  const p = await previaYoutube('aaaaaaaaaa1', { youtube: base, capas: base });
  assert.deepEqual(p, { id: 'aaaaaaaaaa1', titulo: 'Clipe novo ao vivo', canal: 'Canal do Koch', capa: `data:image/jpeg;base64,${JPEG.toString('base64')}` });
  assert.ok(pedidos.some((u) => u.startsWith('/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Daaaaaaaaaa1')));
  assert.ok(pedidos.includes('/vi/aaaaaaaaaa1/mqdefault.jpg'));
  await previaYoutube('aaaaaaaaaa1', { youtube: base, capas: base });
  assert.equal(pedidos.length, 2, 'o mesmo vídeo não busca de novo');
});

test('id inválido não sai do PC', async () => {
  for (const id of ['', 'curto', '../../../etc', 'aaaaaaaaaa1?x', 42, null]) assert.equal(await previaYoutube(id), null);
});

test('vídeo privado ou removido: sem prévia, e tenta de novo depois', async (t) => {
  let privado = true;
  const { base, pedidos } = await servidor(t, (url) => url.startsWith('/vi/') ? { status: 404, corpo: '' }
    : privado ? { status: 401, corpo: 'Unauthorized' } : { corpo: JSON.stringify({ title: 'Agora público' }) });
  assert.equal(await previaYoutube('bbbbbbbbbb2', { youtube: base, capas: base }), null);
  privado = false;
  const p = await previaYoutube('bbbbbbbbbb2', { youtube: base, capas: base });
  assert.equal(p.titulo, 'Agora público');
  assert.equal(p.capa, '', 'sem capa, o cartão fica só com o título');
  assert.ok(pedidos.length >= 4);
});

test('resposta grande demais ou fora do formato é recusada', async (t) => {
  const { base } = await servidor(t, (url) => url.startsWith('/vi/')
    ? { tipo: 'text/html', corpo: '<script>' }
    : url.includes('cccc') ? { corpo: JSON.stringify({ title: 'x'.repeat(70 * 1024) }) } : { corpo: JSON.stringify({ title: 't'.repeat(500), author_name: ['lista'] }) });
  assert.equal(await previaYoutube('cccccccccc3', { youtube: base, capas: base }), null);
  const p = await previaYoutube('dddddddddd4', { youtube: base, capas: base });
  assert.equal(p.titulo.length, 150);
  assert.equal(p.canal, '');
  assert.equal(p.capa, '', 'capa que não é JPEG não vira imagem');
});
