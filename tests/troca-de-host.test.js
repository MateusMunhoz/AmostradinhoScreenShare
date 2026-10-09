// Troca de host (renderer/sala.js › successors): todo PC precisa calcular a mesma fila, senão a sala se divide.
// sala.js é script clássico que só declara funções na carga: roda num vm com um state de mentira.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sala(st) {
  const ctx = vm.createContext({ state: st });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/sala.js'), 'utf8'), ctx);
  return ctx;
}

const pc = (myId, order, outros) => ({ myId, hostId: '1', order, members: new Map(outros.map((id) => [id, {}])) });

test('a fila vai pelo número de cada um, não pela ordem em que o PC viu as pessoas entrarem', () => {
  // Sala do host 1 com 2, 3 e 4. O 2 caiu e voltou: os outros o puseram no fim; ele mesmo continua no começo.
  const doDois = pc('2', ['1', '2', '3', '4'], ['1', '3', '4']);
  const doTres = pc('3', ['1', '3', '4', '2'], ['1', '2', '4']);
  const doQuatro = pc('4', ['1', '3', '4', '2'], ['1', '2', '3']);
  const filas = [doDois, doTres, doQuatro].map((st) => [...sala(st).successors()]);
  for (const fila of filas) assert.deepEqual(fila, ['2', '3', '4']);
});

test('quem entrou depois de uma troca de host calcula a mesma fila dos outros', () => {
  // welcome.members vem na ordem em que cada um voltou ao servidor novo (3 antes do 2); o 5 é novo
  const doCinco = pc('5', ['3', '2', '1', '5'], ['1', '2', '3']);
  assert.deepEqual([...sala(doCinco).successors()], ['2', '3', '5']);
});

test('números com mais de um dígito ficam em ordem de número, não de texto', () => {
  const st = pc('9', ['1', '10', '9', '2'], ['1', '2', '10']);
  assert.deepEqual([...sala(st).successors()], ['2', '9', '10']);
});
