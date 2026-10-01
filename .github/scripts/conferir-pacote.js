// Confere que todo arquivo que o index.html carrega vai na atualização assinada (PACK_FILES do publicar.js)
// e no .exe (build.files do package.json). É a mesma checagem que o publicar.js faz antes de publicar,
// adiantada para o PR. Roda com: node .github/scripts/conferir-pacote.js
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { PACK_FILES } = require(path.join(ROOT, 'publicar.js'));
const { build } = require(path.join(ROOT, 'package.json'));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const used = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^":]+)"/g)].map((m) => m[1]);
const inBuild = (f) => build.files.some((p) => (p.endsWith('/**') ? f.startsWith(p.slice(0, -2)) : f === p));

const semPack = used.filter((f) => !PACK_FILES.includes(f));
const semBuild = used.filter((f) => !inBuild(f));
const faltando = used.filter((f) => !fs.existsSync(path.join(ROOT, f)));

if (semPack.length) console.error(`Fora do PACK_FILES (publicar.js): ${semPack.join(', ')}`);
if (semBuild.length) console.error(`Fora do build.files (package.json): ${semBuild.join(', ')}`);
if (faltando.length) console.error(`O index.html carrega arquivos que não existem: ${faltando.join(', ')}`);
if (semPack.length || semBuild.length || faltando.length) process.exit(1);
console.log(`OK: os ${used.length} arquivos que o index.html carrega estão no pacote e no .exe.`);
