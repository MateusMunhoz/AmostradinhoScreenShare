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
