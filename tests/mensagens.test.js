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
