// Configurações no celular: o servidor da rede local (main/celular.js), sem o Electron
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const celular = require('../main/celular');

const redeTeste = { interfaces: { 'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.0.10' }] } }; // finge um Wi-Fi
afterEach(() => celular.fechar());

// O servidor escuta em 0.0.0.0: nos testes, fala com ele pelo 127.0.0.1, na porta do endereço devolvido
const local = (url) => url.replace(/^http:\/\/[\d.]+/, 'http://127.0.0.1');

test('Celular: só IPs da rede local, sem Radmin nem Razze', () => {
  const ips = celular.ipsLocais({
    'Radmin VPN': [{ family: 'IPv4', internal: false, address: '26.1.2.3' }],
    'Razze-casa': [{ family: 'IPv4', internal: false, address: '10.8.0.2' }],
    Ethernet: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
    'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.1.20' }, { family: 'IPv6', internal: false, address: 'fe80::1' }],
    Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    Publico: [{ family: 'IPv4', internal: false, address: '200.1.2.3' }],
  });
  assert.deepEqual(ips.map((i) => i.address), ['192.168.1.20', '10.0.0.5']);
});

test('Celular: entrega uma vez só, com a chave; sem ela, 404', async () => {
  const avisos = [];
  const res = await celular.abrir('entregar', '{"app":"tela-p2p-config"}', (m) => avisos.push(m.tipo), redeTeste);
  assert.ok(res.ok);
  const url = local(res.urls[0].url);
  assert.match(res.urls[0].url, /^http:\/\/192\.168\.0\.10:\d+\/c\/[A-Za-z0-9_-]{43}$/);
  assert.equal((await fetch(url.replace(/\/c\/.+$/, '/c/' + 'x'.repeat(43)))).status, 404);
  assert.equal((await fetch(url.replace(/\/c\/.+$/, '/'))).status, 404);
  const pagina = await fetch(url);
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(await pagina.text(), /Baixar arquivo/);
  const arquivo = await fetch(url + '/arquivo');
  assert.equal(await arquivo.text(), '{"app":"tela-p2p-config"}');
  assert.match(arquivo.headers.get('content-disposition'), /attachment; filename="tela-p2p-config-\d{4}-\d\d-\d\d\.tp2p"/);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(avisos, ['aberto', 'entregue']);
  await assert.rejects(fetch(url + '/arquivo'), 'depois de entregar, a porta fecha');
});

test('Celular: recebe só um arquivo do app, até 2 MB', async () => {
  let recebido = null;
  const res = await celular.abrir('receber', '', (m) => { if (m.tipo === 'recebido') recebido = m.texto; }, redeTeste);
  const url = local(res.urls[0].url) + '/arquivo';
  assert.equal((await fetch(url, { method: 'POST', body: '{"app":"outro"}' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', body: 'x'.repeat(celular.MAX + 10) }).catch(() => ({ status: 413 }))).status, 413);
  assert.equal((await fetch(url, { method: 'GET' })).status, 404, 'no recebimento não há o que baixar');
  const ok = await fetch(url, { method: 'POST', body: '{"app":"tela-p2p-config","v":1}' });
  assert.equal(ok.status, 200);
  assert.equal(recebido, '{"app":"tela-p2p-config","v":1}');
});

test('Celular: entrega sem arquivo ou sem rede local é recusada', async () => {
  assert.equal((await celular.abrir('entregar', '', () => {}, redeTeste)).ok, false);
  assert.equal((await celular.abrir('qualquer', 'x', () => {}, redeTeste)).ok, false);
  assert.equal((await celular.abrir('receber', '', () => {}, { interfaces: {} })).ok, false);
});
