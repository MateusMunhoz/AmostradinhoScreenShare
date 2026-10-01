const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { WebSocket } = require('ws');
const { startServer, stopServer } = require('../signaling');
const { createMusicas, cleanVideoId } = require('../sala-protocolo');

async function freePort() {
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  return port;
}
async function client(port, hello = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const send = msg => ws.send(JSON.stringify(msg));
  const wait = async predicate => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const i = messages.findIndex(predicate);
      if (i !== -1) return messages.splice(i, 1)[0];
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('Mensagem não recebida');
  };
  send({ type: 'hello', name: 'Teste', ...hello });
  const welcome = await wait(m => m.type === 'welcome');
  return { ws, send, wait, messages, welcome };
}
const VID = 'dQw4w9WgXcQ', VID2 = 'M7lc1UVf-VE';

test('vídeo do YouTube: só ids de 11 caracteres; a semente (troca de host) limpa e uma por canal', () => {
  assert.equal(cleanVideoId(VID), VID);
  assert.equal(cleanVideoId('curto'), '');
  assert.equal(cleanVideoId('<script>abc'), '');
  let t = 1000;
  const m = createMusicas([{ ch: '', videoId: VID, pos: 42, playing: false, by: '3', title: 'x\u0001y' }, { ch: '', videoId: VID2 }, { ch: '2', videoId: 'ruim' }], () => t);
  assert.deepEqual([...m.map.values()], [{ ch: '', videoId: VID, title: 'x y', by: '3', playing: false, pos: 42, at: 1000 }]);
  t = 2000;
  assert.deepEqual(m.msg(), { type: 'musicas', list: [...m.map.values()], now: 2000 });
});

test('uma música por canal: vai para o canal de quem pôs; quem é de fora não controla; apagar a subsala para', async t => {
  const port = await freePort();
  assert.equal((await startServer(port)).ok, true);
  t.after(stopServer);
  const a = await client(port); t.after(() => a.ws.terminate());
  const b = await client(port); t.after(() => b.ws.terminate());
  assert.ok(a.welcome.features.includes('musica'));
  assert.deepEqual(a.welcome.musicas, []);
  assert.equal(typeof a.welcome.now, 'number');
  a.send({ type: 'subsala-create' });
  await b.wait(m => m.type === 'subsalas');
  a.send({ type: 'voice-state', session: 'sa', channel: '1' });
  await b.wait(m => m.type === 'voice-state' && m.id === a.welcome.id);

  // Ana (na Subsala_1) põe uma música: ela vai para a Subsala_1, tocando do começo
  a.send({ type: 'musica-set', videoId: VID });
  const set = await b.wait(m => m.type === 'musicas');
  assert.equal(set.list.length, 1);
  assert.deepEqual({ ...set.list[0], at: 0 }, { ch: '1', videoId: VID, title: '', by: a.welcome.id, playing: true, pos: 0, at: 0 });
  // Outra música no mesmo canal: recusada, com o motivo
  a.send({ type: 'musica-set', videoId: VID2 });
  assert.match((await a.wait(m => m.type === 'musica-erro')).text, /Já tem uma música em Subsala_1/);
  // Bia (fora da voz) põe na Voz geral: são duas músicas, uma em cada canal
  b.send({ type: 'musica-set', videoId: VID2 });
  assert.deepEqual((await a.wait(m => m.type === 'musicas' && m.list.length === 2)).list.map(m => m.ch).sort(), ['', '1']);
  // Bia não está na Subsala_1 nem pôs a música de lá: não controla
  b.send({ type: 'musica-ctl', ch: '1', action: 'pause', pos: 10 });
  assert.match((await b.wait(m => m.type === 'musica-erro')).text, /Só quem está em Subsala_1/);
  // Ana pausa em 12 s, pula para 30 s (continua pausada) e toca de novo
  a.messages.length = 0;
  a.send({ type: 'musica-ctl', ch: '1', action: 'pause', pos: 12 });
  let one = (await a.wait(m => m.type === 'musicas')).list.find(m => m.ch === '1');
  assert.deepEqual([one.playing, one.pos], [false, 12]);
  a.send({ type: 'musica-ctl', ch: '1', action: 'seek', pos: 30 });
  one = (await a.wait(m => m.type === 'musicas')).list.find(m => m.ch === '1');
  assert.deepEqual([one.playing, one.pos], [false, 30]);
  a.send({ type: 'musica-ctl', ch: '1', action: 'play', pos: 30 });
  one = (await a.wait(m => m.type === 'musicas')).list.find(m => m.ch === '1');
  assert.deepEqual([one.playing, one.pos], [true, 30]);
  // O título: vale o primeiro, de qualquer um que esteja ouvindo
  b.send({ type: 'musica-ctl', ch: '1', action: 'titulo', title: 'Never Gonna Give You Up' });
  assert.equal((await a.wait(m => m.type === 'musicas')).list.find(m => m.ch === '1').title, 'Never Gonna Give You Up');
  b.send({ type: 'musica-ctl', ch: '1', action: 'titulo', title: 'Outro' });
  // Trocar a música: outro vídeo, do começo, título novo
  a.send({ type: 'musica-ctl', ch: '1', action: 'trocar', videoId: VID2 });
  one = (await a.wait(m => m.type === 'musicas')).list.find(m => m.ch === '1');
  assert.deepEqual([one.videoId, one.pos, one.playing, one.title], [VID2, 0, true, '']);
  // Apagar a Subsala_1 para a música de lá; a da Voz geral continua
  a.send({ type: 'subsala-delete', id: '1' });
  assert.deepEqual((await b.wait(m => m.type === 'musicas' && m.list.length === 1)).list.map(m => m.ch), ['']);
  // Parar a da Voz geral (Bia pôs)
  b.send({ type: 'musica-ctl', ch: '', action: 'stop' });
  assert.deepEqual((await a.wait(m => m.type === 'musicas' && m.list.length === 0)).list, []);
});

test('troca de host: o servidor novo continua com a música, do ponto em que estava', async t => {
  const port = await freePort();
  assert.equal((await startServer(port, '', { subsalas: [{ id: '2' }], musicas: [{ ch: '2', videoId: VID, pos: 95.5, playing: true, by: '5' }], hostId: '5', nextId: 6 })).ok, true);
  t.after(stopServer);
  const a = await client(port, { resume: '5' }); t.after(() => a.ws.terminate());
  const m = a.welcome.musicas[0];
  assert.deepEqual([m.ch, m.videoId, m.pos, m.playing, m.by], ['2', VID, 95.5, true, '5']);
  assert.ok(Math.abs(m.at - a.welcome.now) < 1000);
});
