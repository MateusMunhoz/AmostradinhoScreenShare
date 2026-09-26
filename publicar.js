// Publica uma versão nova do Tela P2P.
//
//   node publicar.js --gerar-chave         uma vez só: cria a chave de assinatura (fica fora do projeto)
//   npm run publicar                       sobe a versão (1.1.0 -> 1.1.1), assina, gera o .exe e
//                                          manda tudo para o GitHub (commit, tag e Release)
//   npm run publicar -- 1.2.0              o mesmo, escolhendo a versão
//   npm run publicar -- --notas "texto"    texto da Release (sem ele, o GitHub lista os commits)
//   npm run publicar -- --sem-github       só assina e gera o .exe, sem mandar nada
//
// O pacote assinado vai dentro do .exe (resources/pack), para a pasta de atualizações deste PC e para
// a Release do GitHub. Os apps baixam dali (botão na tela inicial) ou uns dos outros pela sala, e
// só instalam depois de conferir a assinatura.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const KEY_FILE = path.join(os.homedir(), '.tela-p2p', 'chave-de-atualizacao.pem');
const BOOT = path.join(ROOT, 'boot.js');
// O que viaja pela sala. boot.js fica de fora: ele confere as assinaturas e só muda com um .exe novo.
const PACK_FILES = ['main.js', 'preload.js', 'signaling.js', 'github.js', 'index.html', 'styles.css', 'renderer/util.js', 'renderer/estado.js', 'renderer/rtc.js', 'renderer/tema.js', 'renderer/sala.js', 'renderer/voz.js', 'renderer/microfone.js', 'renderer/membros.js', 'renderer/assistir.js', 'renderer/pip.js', 'renderer/overlay.js', 'renderer/chat.js', 'renderer.js', 'voice.js', 'encode-once.js', 'pcm-worklet.js', 'bin/audiocap.exe', 'bin/videocap.exe', 'bin/teclas.exe',
  'vendor/noise/rnnoiseWorklet.js', 'vendor/noise/rnnoise.wasm', 'vendor/noise/rnnoise_simd.wasm', 'vendor/noise/LICENSE', 'vendor/noise/NOTICE.md'];

function fail(msg) {
  console.error('\n' + msg + '\n');
  process.exit(1);
}

function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function buildPack(version) {
  const files = {};
  for (const f of PACK_FILES) files[f] = fs.readFileSync(path.join(ROOT, f)).toString('base64');
  const electron = require('electron/package.json').version;
  return Buffer.from(JSON.stringify({ app: 'tela-p2p', version, electron, created: new Date().toISOString(), files }));
}

function sign(packBuf, privateKeyPem) {
  return crypto.sign(null, packBuf, privateKeyPem).toString('base64');
}

function bootPublicKey() {
  const m = fs.readFileSync(BOOT, 'utf8').match(/const PUBLIC_KEY = `([^`]*)`;/);
  return m ? m[1].trim() : '';
}

function generateKey() {
  if (fs.existsSync(KEY_FILE)) fail(`Já existe uma chave em ${KEY_FILE}. Trocar a chave faria os apps dos amigos recusarem suas atualizações.`);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).trim();
  const src = fs.readFileSync(BOOT, 'utf8').replace(/const PUBLIC_KEY = `[^`]*`;/, `const PUBLIC_KEY = \`${pub}\`;`);
  fs.writeFileSync(BOOT, src);
  console.log(`Chave criada em ${KEY_FILE} e a parte pública gravada no boot.js.`);
  console.log('Faça uma cópia dessa chave (pen drive, nuvem). Sem ela você não consegue mais publicar atualizações');
  console.log('para quem já tem o app, e quem tiver ela consegue publicar no seu nome. Nunca mande para ninguém.');
}

// Manda a versão para o GitHub: commit de tudo que mudou, tag vX.Y.Z e uma Release com o .exe
// (para quem ainda não tem o app) e o pacote assinado (para o botão de atualizar do app)
function publishGithub(version, productName, notes) {
  const ok = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' }).status === 0;
  const quiet = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'ignore' }).status === 0;
  if (!fs.existsSync(path.join(ROOT, '.git')) || !quiet('git', ['--version']) || !quiet('gh', ['--version'])) {
    console.log('\nGitHub pulado: precisa do projeto clonado do GitHub, do Git e do GitHub CLI (gh auth login).');
    return false;
  }
  const exe = path.join(ROOT, 'dist', `${productName}.exe`);
  const steps = [
    ['git', ['add', '-u']], // só o que o git já acompanha: arquivo novo (ex.: protótipos) nunca entra sozinho
    ['git', ['commit', '-m', `Versão ${version}`]],
    ['git', ['tag', '-a', `v${version}`, '-m', `Versão ${version}`]],
    ['git', ['push', 'origin', 'HEAD']],
    ['git', ['push', 'origin', `v${version}`]],
    ['gh', ['release', 'create', `v${version}`, exe, path.join(ROOT, 'pack', 'pack.json'), path.join(ROOT, 'pack', 'pack.sig'),
      '--title', `${productName} ${version}`, ...(notes ? ['--notes', notes] : ['--generate-notes'])]],
  ];
  for (const [cmd, args] of steps) {
    console.log(`> ${cmd} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
    if (!ok(cmd, args)) fail(`Parou no passo acima. A versão ${version} já está assinada e o .exe gerado; corrija e rode os passos que faltam.`);
  }
  return true;
}

function publish(requested, { notes = '', github = true } = {}) {
  if (!fs.existsSync(KEY_FILE)) fail('Nenhuma chave encontrada. Rode uma vez: node publicar.js --gerar-chave');
  const privateKey = fs.readFileSync(KEY_FILE, 'utf8');
  const myPublic = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).trim();
  if (bootPublicKey() !== myPublic) fail('A chave pública do boot.js não é a da sua chave. As atualizações seriam recusadas.');

  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  // O .exe novo substitui o da pasta dist: se ele estiver aberto, o Windows não deixa. Confere antes de mexer em nada.
  const dist = path.join(ROOT, 'dist');
  for (const f of fs.existsSync(dist) ? fs.readdirSync(dist) : []) {
    if (!f.startsWith(pkg.build.productName) || !f.endsWith('.exe')) continue;
    try { fs.closeSync(fs.openSync(path.join(dist, f), 'r+')); } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') fail(`O "${f}" da pasta dist está aberto. Feche o app e rode de novo.`);
    }
  }
  const [maj, min, pat] = pkg.version.split('.').map(Number);
  const version = requested || `${maj}.${min}.${pat + 1}`;
  if (!/^\d+\.\d+\.\d+$/.test(version) || !newer(version, pkg.version)) fail(`A versão ${version} precisa ser maior que a atual (${pkg.version}).`);

  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  const pack = buildPack(version);
  const sig = sign(pack, privateKey);
  for (const dir of [path.join(ROOT, 'pack'), path.join(process.env.APPDATA, pkg.build.productName, 'atualizacoes', version)]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack.json'), pack);
    fs.writeFileSync(path.join(dir, 'pack.sig'), sig);
  }
  console.log(`Versão ${version} assinada (${Math.round(pack.length / 1024)} KB). O app deste PC já usa ela na próxima vez que abrir.`);

  // O .exe tem sempre o mesmo nome: o da versão anterior (e os antigos, com a versão no nome) saem
  for (const f of fs.existsSync(dist) ? fs.readdirSync(dist) : []) {
    if (f.startsWith(pkg.build.productName) && f.endsWith('.exe')) fs.rmSync(path.join(dist, f), { force: true });
  }
  console.log('Gerando o .exe para quem ainda não tem o app...');
  const r = spawnSync('npx electron-builder --win portable', { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) fail('O .exe não foi gerado, mas a atualização pela sala já funciona.');

  const onGithub = github && publishGithub(version, pkg.build.productName, notes);
  console.log(`\nPronto. Os amigos recebem a ${version} ${onGithub ? 'pelo botão "Baixar atualização" do app ou ' : ''}pela sala, entrando numa sala com você.`);
}

module.exports = { buildPack, sign, newer, KEY_FILE, PACK_FILES };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--gerar-chave') {
    generateKey();
  } else {
    const notesAt = args.indexOf('--notas');
    const notes = notesAt >= 0 ? args[notesAt + 1] || '' : '';
    const version = args.find((a, i) => /^\d+\.\d+\.\d+$/.test(a) && i !== notesAt + 1);
    publish(version, { notes, github: !args.includes('--sem-github') });
  }
}
