const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDmStore } = require('../main/mensagens');

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);

test('histórico local das mensagens diretas: um arquivo por amigo, lista com a última mensagem', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-dm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createDmStore(dir);
  assert.deepEqual(store.load(A, B), { name: '', messages: [] });
  assert.deepEqual(store.list(A), []);
  store.save(A, B, { name: 'Bob', messages: [
    { id: '1', seq: 1, from: A, text: 'oi', createdAt: 10 },
    { id: '2', seq: 2, from: B, text: 'olá', createdAt: 20 },
    { id: 'lixo', from: 'x', text: 3 },
  ] });
  const loaded = store.load(A, B);
  assert.equal(loaded.name, 'Bob');
  assert.deepEqual(loaded.messages.map((m) => m.text), ['oi', 'olá']);
  assert.ok(fs.existsSync(path.join(dir, A, B + '.json')));
  store.save(A, C, { name: 'Carol', messages: [] }); // conversa vazia não aparece na lista
  assert.deepEqual(store.list(A).map((c) => [c.friend, c.name, c.last.text]), [[B, 'Bob', 'olá']]);
  // Outra conta no mesmo PC não vê as conversas da primeira
  assert.deepEqual(store.list(C), []);
  // Ids inválidos não viram caminho de arquivo
  assert.throws(() => store.save('../x', B, { messages: [] }));
  assert.deepEqual(store.load(A, '../../y'), { name: '', messages: [] });
});

test('histórico com o safeStorage fica cifrado no arquivo, e o arquivo antigo em texto ainda abre', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-dm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from([...Buffer.from(s)].map((x) => x ^ 0x5a)), decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString() };
  // Arquivo antigo, em texto
  fs.mkdirSync(path.join(dir, A), { recursive: true });
  fs.writeFileSync(path.join(dir, A, B + '.json'), JSON.stringify({ friend: B, name: 'Bob', messages: [{ id: '1', seq: 1, from: B, text: 'segredo antigo', createdAt: 1 }] }));
  const store = createDmStore(dir, { storage });
  assert.equal(store.load(A, B).messages[0].text, 'segredo antigo');
  store.save(A, B, { name: 'Bob', messages: [...store.load(A, B).messages, { id: '2', seq: 2, from: A, text: 'segredo novo', createdAt: 2, e2e: true }] });
  const raw = fs.readFileSync(path.join(dir, A, B + '.json'), 'utf8');
  assert.doesNotMatch(raw, /segredo|Bob/);
  assert.equal(JSON.parse(raw).v, 2);
  const back = store.load(A, B);
  assert.deepEqual(back.messages.map((m) => m.text), ['segredo antigo', 'segredo novo']);
  assert.equal(back.messages[1].e2e, true);
  assert.equal(store.list(A)[0].last.text, 'segredo novo');
});

test('prazo do histórico: para sempre por padrão; com 30 dias, o antigo sai ao ler, ao gravar e ao mudar o prazo', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-dm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const DAY = 24 * 60 * 60 * 1000;
  let now = 100 * DAY;
  const store = createDmStore(dir, { now: () => now });
  store.save(A, B, { name: 'Bob', messages: [
    { id: 'velha', seq: 1, from: B, text: 'de 40 dias atrás', createdAt: now - 40 * DAY },
    { id: 'nova', seq: 2, from: A, text: 'de ontem', createdAt: now - DAY },
  ] });
  assert.equal(store.load(A, B).messages.length, 2);
  assert.equal(store.setRetention(30, A), 30);
  assert.deepEqual(store.load(A, B).messages.map((m) => m.id), ['nova']);
  // O arquivo já foi regravado sem a velha: voltar para "para sempre" não traz ela de volta
  store.setRetention(0);
  assert.deepEqual(store.load(A, B).messages.map((m) => m.id), ['nova']);
  assert.equal(store.setRetention('qualquer coisa'), 0);
});

test('imagens da conexão direta: só imagem, até 8 MB, cifradas, com id segura, e seguem o prazo', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-dm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from([...Buffer.from(s)].map((x) => x ^ 0x5a)), decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString() };
  let now = Date.now();
  const store = createDmStore(dir, { storage, now: () => now });
  const id = 'f'.repeat(32);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  store.saveImage(A, id, 'image/png', png);
  assert.ok(!fs.readFileSync(path.join(dir, A, 'anexos', id), 'utf8').includes(Buffer.from(png).toString('base64')));
  const back = store.loadImage(A, id);
  assert.equal(back.mime, 'image/png');
  assert.deepEqual([...back.bytes], [...png]);
  assert.throws(() => store.saveImage(A, id, 'application/pdf', png));
  assert.throws(() => store.saveImage(A, id, 'image/png', new Uint8Array(8 * 1024 * 1024 + 1)));
  assert.throws(() => store.saveImage(A, '../fora', 'image/png', png));
  assert.equal(store.loadImage(A, '../../x'), null);
  // Com 30 dias, a imagem guardada há mais tempo some
  now += 31 * 24 * 60 * 60 * 1000;
  store.setRetention(30, A);
  assert.equal(store.loadImage(A, id), null);
  assert.ok(!fs.existsSync(path.join(dir, A, 'anexos', id)));
});

test('backup no celular: exporta o texto das conversas e, ao importar, junta pela id sem apagar nada', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-dm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createDmStore(dir);
  const arquivo = { id: 'a1', name: 'foto.png', size: 10, mime: 'image/png' };
  store.save(A, B, { name: 'Bob', messages: [{ id: '1', seq: 1, from: A, text: 'oi', createdAt: 10 }, { id: '2', from: B, text: '', createdAt: 15, direto: true, file: arquivo }] });
  const exportado = store.exportAll(A);
  assert.deepEqual(exportado.map((c) => [c.friend, c.name, c.messages.length]), [[B, 'Bob', 2]]);
  assert.deepEqual(exportado[0].messages[1].file, arquivo);
  // Em outro PC (ou depois de perder o histórico): junta com o que tem
  const outro = createDmStore(fs.mkdtempSync(path.join(dir, 'outro-')));
  outro.save(A, B, { name: 'Bob', messages: [{ id: '3', seq: 3, from: B, text: 'só aqui', createdAt: 20 }] });
  assert.equal(outro.importAll(A, exportado), 2);
  assert.deepEqual(outro.load(A, B).messages.map((m) => m.id), ['1', '2', '3']);
  assert.equal(outro.importAll(A, exportado), 0); // de novo: nada duplica
  assert.equal(outro.importAll(A, [{ friend: '../x', messages: [] }, null]), 0);
  assert.throws(() => outro.importAll('../conta', exportado));
});
