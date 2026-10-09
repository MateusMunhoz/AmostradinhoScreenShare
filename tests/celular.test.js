// Configurações no celular (renderer/celular-modelo.js e renderer/qr.js): o que vai no arquivo, a cifra e a validação
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../renderer/celular-modelo');
const QR = require('../renderer/qr');

const memoria = (dados) => ({ getItem: (k) => (k in dados ? dados[k] : null), setItem: (k, v) => { dados[k] = v; } });
const fotoDe = (bytes) => ({ hash: crypto.createHash('sha256').update(bytes).digest('hex'), data: Buffer.from(bytes).toString('base64') });

test('Celular: junta só a lista; clientId, conta e caches nunca vão', () => {
  const pc = memoria({ name: 'Cris', clientId: 'abc', roomAddr: '1.2.3.4', 'foto:xyz': 'x', sessoesConhecidas: '[]', quality: '1080p30', vozVisao: 'mapa' });
  const itens = C.juntar(pc, { mute: 'CommandOrControl+Shift+M', estranho: 'X' });
  assert.deepEqual(Object.keys(itens).sort(), ['atalhos', 'name', 'quality', 'vozVisao']);
  assert.deepEqual(JSON.parse(itens.atalhos), { mute: 'CommandOrControl+Shift+M' });
});

test('Celular: cifra e decifra; senha errada e arquivo alterado são recusados', async () => {
  const itens = { name: 'Cris', quality: '1080p30' };
  const texto = await C.cifrar(itens, 'segredo123', { appVersion: '1.12.13' });
  const o = JSON.parse(texto);
  assert.equal(o.app, 'tela-p2p-config');
  assert.ok(!texto.includes('Cris'), 'nada em claro no arquivo');
  const aberto = await C.decifrar(texto, 'segredo123');
  assert.deepEqual(aberto.items, itens);
  assert.equal(aberto.appVersion, '1.12.13');
  await assert.rejects(C.decifrar(texto, 'outra-senha'), { code: 'senha' });
  const dados = Buffer.from(o.data, 'base64');
  dados[0] ^= 1;
  await assert.rejects(C.decifrar(JSON.stringify({ ...o, data: dados.toString('base64') }), 'segredo123'), { code: 'senha' });
  await assert.rejects(C.decifrar('{"app":"outro"}', 'x'), { code: 'formato' });
  await assert.rejects(C.decifrar('não é json', 'x'), { code: 'formato' });
  await assert.rejects(C.decifrar(JSON.stringify({ ...o, kdf: { ...o.kdf, iterations: 1e9 } }), 'segredo123'), { code: 'formato' });
});

test('Celular: ao trazer, cada item é validado e o desconhecido fica de fora', async () => {
  const boa = fotoDe(Buffer.from('foto de verdade'));
  const { itens, fora } = await C.limpar({
    name: '  Cris  ', clientId: 'ladrao', quality: '../x', stageLayout: 'spotlight', stageSide: '9', musicaVolume: '55',
    'appPreferences.v1': JSON.stringify({ colors: { main: '#000000', detail1: 'vermelho' }, sounds: { volume: 500 } }),
    vozConfig: JSON.stringify({ micId: 'abc', echo: true, gateDb: -40, duck: 900, vozes: 60, estranho: 1 }),
    volumes: JSON.stringify({ Ana: { voice: 80, screen: 30, muted: true }, Bia: { voice: 'alto' } }),
    excludeApps: JSON.stringify(['Discord.exe', '..\\..\\x.exe']),
    atalhos: JSON.stringify({ mute: 'CommandOrControl+Shift+M', edit: 'rm -rf' }),
    fotoPerfil: JSON.stringify(boa), fotoPerfilInteira: JSON.stringify({ ...boa, data: Buffer.from('outra').toString('base64') }),
  });
  assert.equal(itens.name, 'Cris');
  assert.equal(itens.stageLayout, 'spotlight');
  assert.equal(itens.musicaVolume, '55');
  for (const k of ['clientId', 'quality', 'stageSide', 'fotoPerfilInteira']) assert.ok(fora.includes(k) && !(k in itens), k);
  const prefs = JSON.parse(itens['appPreferences.v1']);
  assert.equal(prefs.colors.main, '#000000');
  assert.equal(prefs.sounds.volume, 100, 'passa pelo normalize das preferências');
  assert.deepEqual(JSON.parse(itens.vozConfig), { micId: 'abc', echo: true, gateDb: -40, vozes: 60 });
  assert.deepEqual(JSON.parse(itens.volumes), { Ana: { voice: 80, screen: 30, muted: true } });
  assert.deepEqual(JSON.parse(itens.excludeApps), ['Discord.exe']);
  assert.deepEqual(JSON.parse(itens.atalhos), { mute: 'CommandOrControl+Shift+M' });
  assert.deepEqual(JSON.parse(itens.fotoPerfil), boa, 'a foto que bate com o hash entra');
});

test('Celular: o fundo do perfil vai junto, GIF ou WebP, e tem de bater com o hash', async () => {
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40, 7)]);
  const bom = { ...fotoDe(gif), mime: 'image/gif' };
  assert.deepEqual(JSON.parse((await C.limpar({ fundoPerfil: JSON.stringify(bom) })).itens.fundoPerfil), bom);
  for (const ruim of [{ ...bom, mime: 'image/svg+xml' }, { ...bom, hash: 'a'.repeat(64) }, { ...bom, data: 'A'.repeat(1400000) }]) {
    const { itens, fora } = await C.limpar({ fundoPerfil: JSON.stringify(ruim) });
    assert.ok(!itens.fundoPerfil && fora.includes('fundoPerfil'));
  }
  assert.ok(C.resumo({ fundoPerfil: '{}' }).includes('Fundo do perfil'));
});

test('Celular: resumo do que o arquivo traz', () => {
  const linhas = C.resumo({ name: 'Cris', volumes: JSON.stringify({ Ana: {}, Bia: {} }), atalhos: '{}', fotoPerfil: '{}' });
  assert.ok(linhas.includes('Nome: Cris') && linhas.includes('Volume de 2 pessoas') && linhas.includes('Foto de perfil') && linhas.includes('Atalhos de teclado'));
});

test('QR: versões 1 a 10 com o tamanho certo, e texto grande demais recusado', () => {
  for (const [texto, versao] of [['oi', 1], ['http://192.168.100.100:65535/c/' + 'A'.repeat(43), 5], ['k'.repeat(211), 10]]) {
    const { size, modules } = QR.encode(texto);
    assert.equal(size, versao * 4 + 17);
    assert.equal(modules.length, size);
    assert.equal(modules[0][0], true, 'o canto do localizador é escuro');
  }
  assert.throws(() => QR.encode('x'.repeat(300)));
  assert.match(QR.svg('oi'), /^<svg class="qr"/);
});

test('Celular: mensagens privadas vão só quando pedidas, validadas, e passando do limite ficam as mais novas', async () => {
  const conta = 'a'.repeat(32), amigo = 'b'.repeat(32);
  const conversas = [{ friend: amigo, name: 'Bia', messages: [
    { id: 'm1', seq: 1, from: amigo, text: 'antiga', createdAt: 1, e2e: true },
    { id: 'm2', seq: 2, from: conta, text: 'nova', createdAt: 2, direto: true },
  ] }];
  assert.equal(C.juntar(memoria({}), null).mensagens, undefined);
  const b = C.mensagensBackup(conta, conversas);
  assert.equal(b.fora, 0);
  const itens = C.juntar(memoria({}), null, b.item);
  const { itens: limpos } = await C.limpar(itens);
  assert.deepEqual(JSON.parse(limpos.mensagens).conversas[0].messages.map((m) => m.text), ['antiga', 'nova']);
  assert.ok(C.resumo(limpos).includes('Mensagens privadas: 1 conversa'));
  // Limite pequeno: só a mais nova cabe
  const curto = C.mensagensBackup(conta, conversas, JSON.stringify(conversas[0].messages[1]).length + 1);
  assert.equal(curto.fora, 1);
  assert.deepEqual(JSON.parse(curto.item).conversas[0].messages.map((m) => m.id), ['m2']);
  // Conta inválida ou mensagem estranha: fora
  const { itens: ruins, fora } = await C.limpar({ mensagens: JSON.stringify({ conta: '../x', conversas: [] }) });
  assert.equal(ruins.mensagens, undefined);
  assert.deepEqual(fora, ['mensagens']);
  const misto = JSON.parse((await C.limpar({ mensagens: JSON.stringify({ conta, conversas: [{ friend: amigo, messages: [{ id: 'ok', from: amigo, text: 'x', createdAt: 1 }, { id: '../', from: amigo, text: 'y', createdAt: 1 }] }] }) })).itens.mensagens);
  assert.deepEqual(misto.conversas[0].messages.map((m) => m.id), ['ok']);
  assert.equal(C.MAX, 16 * 1024 * 1024);
});
