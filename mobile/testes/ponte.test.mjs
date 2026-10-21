// A ponte do iPhone (window.api) tem que ter exatamente as chaves do preload.js do desktop, e cada uma tem que se
// comportar: Promise (ou nada, nos eventos) e nunca lançar de forma síncrona. Roda o ponte.js JÁ empacotado, num contexto
// isolado, como a WebView o carregaria.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { montar } from '../scripts/montar-www.mjs';
import { STUBS } from '../ponte/stubs.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REAIS = ['platform', 'copyText', 'openLink', 'getVersion', 'noiseWasm'];

// As chaves do window.api no preload.js: as linhas com 2 espaços de recuo dentro do exposeInMainWorld
function chavesDoPreload() {
  const src = fs.readFileSync(path.join(RAIZ, 'preload.js'), 'utf8');
  const corpo = src.slice(src.indexOf("exposeInMainWorld('api', {"));
  return [...corpo.matchAll(/^ {2}([A-Za-z0-9]+):/gm)].map((m) => m[1]);
}

let api, copiados, saida;
before(async () => {
  saida = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-www-'));
  await montar({ raiz: RAIZ, saida });
  copiados = [];
  const sandbox = {
    navigator: { clipboard: { writeText: async (t) => { copiados.push(t); } } },
    fetch: async (url) => ({ ok: true, arrayBuffer: async () => new Uint8Array([0, 97, 115, 109]).buffer, url }),
    console, setTimeout, clearTimeout, URL, Promise, Uint8Array, ArrayBuffer, Error, JSON,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = { documentElement: { dataset: {} }, addEventListener() {}, removeEventListener() {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(saida, 'ponte.js'), 'utf8'), sandbox);
  api = sandbox.window.api;
});

test('o desktop expõe 155 entradas e a ponte tem as mesmas, sem faltar nem sobrar', () => {
  const preload = chavesDoPreload();
  assert.equal(preload.length, 155, 'o preload.js mudou: confira se o regex ainda acha todas as chaves');
  const ponte = Object.keys(api);
  assert.deepEqual(preload.filter((k) => !ponte.includes(k)), [], 'faltam na ponte do iPhone (função nova no desktop?)');
  assert.deepEqual(ponte.filter((k) => !preload.includes(k)), [], 'sobram na ponte');
});

test('as chaves reais e os stubs não se repetem', () => {
  for (const k of REAIS) assert.ok(!(k in STUBS), `${k} é real, não pode estar também em stubs.js`);
});

test('platform é ios', () => {
  assert.equal(api.platform, 'ios');
});

test('todo stub é função, devolve Promise (ou nada, nos eventos) e nunca lança de forma síncrona', async () => {
  for (const [nome, [tipo]] of Object.entries(STUBS)) {
    assert.equal(typeof api[nome], 'function', nome);
    let r;
    assert.doesNotThrow(() => { r = api[nome](); }, nome);
    if (tipo === 'evento') {
      assert.equal(r, undefined, `${nome}: evento não devolve nada`);
      assert.doesNotThrow(() => api[nome](() => {}, () => {}, () => {}), nome);
    } else {
      assert.ok(r instanceof Promise, `${nome} devolve Promise`);
      if (tipo === 'erro') await assert.rejects(r, (e) => e instanceof Error && e.message.length > 5, nome);
      else await r;
    }
  }
});

test('os formatos que o renderer espera quando algo não existe no iPhone', async () => {
  assert.deepEqual(await api.razzeState(), { configured: false, baseUrl: '', authenticated: false });
  assert.deepEqual(await api.getIps(), []);
  assert.deepEqual(await api.getSources(), []);
  assert.equal(await api.getOwnPack(), null, 'sem pacote para repassar pela sala');
  assert.equal((await api.startServer(8765, '', {}, 'internet')).ok, false);
  assert.match((await api.startServer()).error, /entrar nas salas/);
  assert.equal(await api.razzePendingInvite(), '');
  assert.deepEqual(await api.getShortcuts(), {});
  // Formatos que o renderer lê na carga (um deles já derrubou o inicio.js: e.modelos.length)
  const voz = await api.vozCmdEstado();
  assert.ok(Array.isArray(voz.modelos) && voz.suportado === false && voz.programa === false);
  assert.deepEqual(await api.atividadeLer({ jogos: true, musica: true }), { jogo: '', jogoImagem: '', musica: null });
  assert.deepEqual(await api.razzeMessages(0), { messages: [] });
  assert.deepEqual(await api.dmLoad('a', 'b'), { name: '', messages: [] });
  assert.deepEqual(await api.razzeWireGuardStatus('x'), { connected: false, error: 'Indisponível no iPhone.' });
  await assert.rejects(api.razzeLogin('a', 'b'), /conta Razze ainda não está disponível/);
});

test('cada chamada devolve uma cópia: mexer no resultado não estraga o próximo', async () => {
  const a = await api.razzeState();
  a.configured = true;
  assert.equal((await api.razzeState()).configured, false);
});

test('copiar texto usa o clipboard e limita a 4096 caracteres', async () => {
  assert.equal(await api.copyText('x'.repeat(5000)), true);
  assert.equal(copiados.at(-1).length, 4096);
  assert.equal(await api.copyText(undefined), true);
  assert.equal(copiados.at(-1), '');
});

test('abrir link só aceita http(s) e nunca lança', async () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'telap2p://sala', 'http://a b', '', null, undefined, 42, {}]) {
    await assert.doesNotReject(api.openLink(url), String(url));
  }
});

test('versão e ruído: a versão é a do desktop e o .wasm sai como bytes', async () => {
  const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  assert.equal(await api.getVersion(), pacote.version);
  const bytes = await api.noiseWasm(false);
  assert.ok(bytes instanceof Uint8Array && bytes.length === 4);
});
