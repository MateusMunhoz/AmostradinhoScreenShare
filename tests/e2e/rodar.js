// Roda todos os testes de ponta a ponta, um depois do outro:  npm run test:e2e
// Só um:  npm run test:e2e -- chat   (o nome do arquivo, sem .js)
// Abre cópias do app na tela, então não começa com um jogo em tela cheia aberto
// (TELA_E2E_FORCE=1 pula essa trava). O Ctrl+Enter, que digita de verdade, fica de fora: node tests/e2e/ctrl-enter.js
const { spawnSync } = require('child_process');
const path = require('path');
const { APP, FOTOS, fullscreenApps } = require('./ajuda');

const TESTS = ['carga.cjs', 'filtros.cjs', 'atualizacao.js', 'chat.js', 'janela-flutuante.js', 'varias-telas.js', 'varias-janelas.js', 'voz.js', 'troca-de-host.js', 'trocar-tela.js', 'ver-a-propria.js', 'sessoes.js', 'espelho.js'];
const only = process.argv[2];
const list = only ? TESTS.filter((t) => t.replace(/\.c?js$/, '') === only) : TESTS;
if (!list.length) {
  console.log(`Não achei o teste "${only}". Os que existem: ${TESTS.map((t) => t.replace(/\.c?js$/, '')).join(', ')}`);
  process.exit(1);
}

// Só os de carga e filtros usam janela invisível; os outros abrem janelas e podem tirar o foco
if (list.some((t) => t !== 'filtros.cjs' && t !== 'carga.cjs')) {
  const busy = fullscreenApps();
  if (busy.length) {
    console.log(`Tem uma janela ocupando a tela inteira (${busy.join(', ')}). Parece um jogo, e os testes abrem janelas que tiram o foco.`);
    console.log('Feche o jogo e rode de novo. Para rodar mesmo assim: set TELA_E2E_FORCE=1');
    process.exit(1);
  }
}

const electron = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const results = [];
for (const t of list) {
  const file = path.join(__dirname, t);
  const r = t.endsWith('.cjs')
    ? spawnSync(electron, [file], { cwd: APP, stdio: 'inherit' })
    : spawnSync(process.execPath, [file], { cwd: APP, stdio: 'inherit' });
  results.push([t, r.status === 0]);
}
console.log('\n== Resumo');
for (const [t, passed] of results) console.log(`${passed ? 'OK   ' : 'FALHA'} ${t}`);
console.log(`Fotos em ${FOTOS}`);
process.exit(results.every(([, p]) => p) ? 0 : 1);
