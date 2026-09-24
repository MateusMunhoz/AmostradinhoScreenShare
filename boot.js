// Início do app. Escolhe qual código rodar: o que veio dentro do .exe ou uma atualização mais nova
// que chegou de alguém da sala. Atualização só roda se estiver assinada com a chave de quem publica
// (a chave pública fica aqui; a privada, só no PC de quem publica). Este arquivo não é atualizado
// pela sala: é ele que confere as assinaturas.
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawn } = require('child_process');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAvitBDfmcU8rG/PCKWq8QG03uT1nSoPT/MQ9BldYkbgA=
-----END PUBLIC KEY-----`;

const BUNDLED = {
  version: app.getVersion(),
  dir: __dirname,
  packDir: app.isPackaged ? path.join(process.resourcesPath, 'pack') : path.join(__dirname, 'pack'),
};
const UPDATES_DIR = path.join(app.getPath('userData'), 'atualizacoes');
const VERSION = /^\d+\.\d+\.\d+$/;
const SAFE_PATH = /^[\w.-]+(\/[\w.-]+)*$/;

// true se a versão a for mais nova que b ("1.2.10" > "1.2.9")
function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function verify(packBuf, sig) {
  if (!PUBLIC_KEY) return false;
  try { return crypto.verify(null, packBuf, PUBLIC_KEY, Buffer.from(String(sig || '').trim(), 'base64')); } catch { return false; }
}

// Lê e confere um pacote já com assinatura válida
function parsePack(packBuf) {
  const p = JSON.parse(packBuf.toString('utf8'));
  if (p.app !== 'tela-p2p' || !VERSION.test(p.version) || !p.files || !p.files['main.js']) throw new Error('pacote inválido');
  if (p.electron !== process.versions.electron) throw new Error(`a versão ${p.version} precisa do .exe novo (Electron ${p.electron})`);
  for (const f of Object.keys(p.files)) if (!SAFE_PATH.test(f) || f.split('/').includes('..')) throw new Error('arquivo com nome inválido: ' + f);
  return p;
}

// Escreve os arquivos do pacote (só os que mudaram, para não mexer em um .exe em uso)
function extract(p, dir) {
  for (const [rel, b64] of Object.entries(p.files)) {
    const dest = path.join(dir, ...rel.split('/'));
    const data = Buffer.from(b64, 'base64');
    let same = false;
    try { same = fs.readFileSync(dest).equals(data); } catch {}
    if (same) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
}

// A atualização instalada mais nova que passar em todas as conferências
function pickUpdate() {
  let names = [];
  try { names = fs.readdirSync(UPDATES_DIR); } catch {}
  const versions = names.filter((v) => VERSION.test(v)).sort((a, b) => (newer(a, b) ? -1 : 1));
  for (const v of versions) {
    const dir = path.join(UPDATES_DIR, v);
    if (!newer(v, BUNDLED.version)) {
      fs.rmSync(dir, { recursive: true, force: true }); // o .exe já é igual ou mais novo
      continue;
    }
    if (fs.existsSync(path.join(dir, 'ruim'))) continue;
    if (fs.existsSync(path.join(dir, 'iniciando'))) {
      // Na última vez esta versão não chegou a abrir a janela: não tenta de novo
      fs.renameSync(path.join(dir, 'iniciando'), path.join(dir, 'ruim'));
      continue;
    }
    try {
      const buf = fs.readFileSync(path.join(dir, 'pack.json'));
      if (!verify(buf, fs.readFileSync(path.join(dir, 'pack.sig'), 'utf8'))) throw new Error('assinatura inválida');
      const p = parsePack(buf);
      if (p.version !== v) throw new Error('versão trocada');
      extract(p, path.join(dir, 'app'));
      return { version: v, dir: path.join(dir, 'app'), packDir: dir };
    } catch (e) {
      console.error(`Atualização ${v} ignorada:`, e.message);
    }
  }
  return null;
}

let current = BUNDLED;
const chosen = pickUpdate();

const updater = {
  get version() { return current.version; },

  // O pacote assinado do código que está rodando agora, para mandar a quem pedir na sala
  readCurrentPack() {
    try {
      const pack = fs.readFileSync(path.join(current.packDir, 'pack.json'), 'utf8');
      const sig = fs.readFileSync(path.join(current.packDir, 'pack.sig'), 'utf8').trim();
      if (JSON.parse(pack).version !== current.version || !verify(Buffer.from(pack, 'utf8'), sig)) return null;
      return { pack, sig };
    } catch {
      return null;
    }
  },

  // Guarda um pacote recebido da sala; ele passa a valer na próxima vez que o app abrir
  install(pack, sig) {
    try {
      const buf = Buffer.from(String(pack), 'utf8');
      if (!verify(buf, sig)) return { ok: false, error: 'assinatura inválida' };
      const p = parsePack(buf);
      if (!newer(p.version, current.version)) return { ok: false, error: 'não é mais nova que a atual' };
      const dir = path.join(UPDATES_DIR, p.version);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pack.json'), buf);
      fs.writeFileSync(path.join(dir, 'pack.sig'), String(sig).trim());
      return { ok: true, version: p.version };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // A janela abriu: a versão funciona
  started() {
    if (current !== BUNDLED) fs.rmSync(path.join(current.packDir, 'iniciando'), { force: true });
  },

  restart() {
    const portable = process.env.PORTABLE_EXECUTABLE_FILE;
    if (portable) {
      // O .exe portátil apaga a pasta temporária quando fecha: abre o novo só depois de 2 s
      spawn('cmd.exe', ['/c', `ping -n 3 127.0.0.1 >nul & start "" "${portable}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      app.quit();
    } else {
      app.relaunch();
      app.exit(0);
    }
  },
};
global.updater = updater;

if (chosen) {
  // O código atualizado fica fora do .exe: ele ainda usa as bibliotecas (ws) que vieram no .exe
  process.env.NODE_PATH = [path.join(BUNDLED.dir, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();
  current = chosen;
  fs.writeFileSync(path.join(chosen.packDir, 'iniciando'), '');
  try {
    require(path.join(chosen.dir, 'main.js'));
  } catch (e) {
    console.error(`A versão ${chosen.version} não abriu, voltando para a do .exe:`, e);
    fs.renameSync(path.join(chosen.packDir, 'iniciando'), path.join(chosen.packDir, 'ruim'));
    current = BUNDLED;
    require(path.join(BUNDLED.dir, 'main.js'));
  }
} else {
  require(path.join(BUNDLED.dir, 'main.js'));
}
