'use strict';
// Comando de voz (docs/spec/comando-de-voz.md): baixa o Whisper (whisper.cpp) e o modelo só para quem liga o recurso,
// confere tudo por SHA-256 fixo aqui no código e transcreve o áudio do comando, que chega pela memória (stdin) e
// nunca vai para o disco. Só Windows. Só usa módulos do Node, para os testes rodarem sem o Electron
// (tests/comando-voz.test.js): o main.js passa a pasta de dados.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// whisper.cpp (licença MIT), versão de 11/09/2026. O zip traz muitos programas; ficam só estes, cada um conferido
const PROGRAMA = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip',
  tamanho: 8573270,
  sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
  arquivos: {
    'whisper-cli.exe': '19b976e037c02c0de712fa26096842d4ebafca03c976b12e8e6123215e7aab58',
    'whisper.dll': 'b7bb4ba92bd36b8afe0c00059ca6a0f69c6767193bfb5f0761e9ed27b1087803',
    'ggml.dll': 'c6e88687d6aa0238f2e834a87958f38d2dc96075a6a7bf6fb8b9cd728a0faed2',
    'ggml-base.dll': 'a5241b52206f61c9dfd6f0f53a8ef19076f9528ead2db1e039a66d7e03817bfc',
    // O whisper.cpp escolhe a que o processador aguenta
    'ggml-cpu-alderlake.dll': '5a5b11dcd38e321b13f85c95414940db9eab1132be3da6342f03dfb1d8e51bd5',
    'ggml-cpu-cannonlake.dll': '2c858781450b52eda95c381232cc65c9e19cbf621cc7b254d8c44fdbab77791e',
    'ggml-cpu-cascadelake.dll': 'ddf49bb749b34800afcb3d6224544966a05c5d00f1d0b6565bee9f3b010dd53c',
    'ggml-cpu-haswell.dll': '6b772e094b8976e22b4c043be86a1a8deda4b50511dc803a693b652c51b24944',
    'ggml-cpu-icelake.dll': 'bbd87ea5920edc401054848071ad2ef8c96bbf8007c4e4cd0ea82ba9b9e3bd10',
    'ggml-cpu-sandybridge.dll': 'de2ad5f84c7dfa557d515b3678d6452ce0216590268b2ca79cc537fe87cf239d',
    'ggml-cpu-skylakex.dll': '9fa3f9d984ca42d568181dd345072299db2978b328800343218c2c7f000b7152',
    'ggml-cpu-sse42.dll': '740fc769ef433985dfdb24a609a42d5acf188abda52287a4d89b89b567507c19',
    'ggml-cpu-x64.dll': '43ccf32b9b70aa4c47d0a12ac2ed3c241e0045571acdad565ecd9d1f99ffc08b',
  },
};
// Modelos multilíngues (licença MIT), quantizados: leve (base) e preciso (small). Endereço preso a uma versão do repositório
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';
const MODELOS = {
  leve: { arquivo: 'ggml-base-q5_1.bin', tamanho: 59707625, sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898' },
  preciso: { arquivo: 'ggml-small-q5_1.bin', tamanho: 190085487, sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb' },
};
const MAX_WAV = 44 + 16000 * 2 * 15; // 15 s de áudio 16 kHz mono 16 bits
const MAX_DICA = 600;
const TEMPO_MAX = 20000;

// Atalho do Electron ("CommandOrControl+Shift+V") -> teclas virtuais do Windows, para o teclas.exe (segurar)
const VK_NOMES = {
  CommandOrControl: 17, Control: 17, Ctrl: 17, Shift: 16, Alt: 18, Space: 32, Enter: 13, Return: 13, Tab: 9, Backspace: 8,
  Delete: 46, Insert: 45, Home: 36, End: 35, PageUp: 33, PageDown: 34, Up: 38, Down: 40, Left: 37, Right: 39,
  '`': 192, '-': 189, '=': 187, '[': 219, ']': 221, '\\': 220, ';': 186, "'": 222, ',': 188, '.': 190, '/': 191,
};
function vksDoAtalho(accel) {
  if (typeof accel !== 'string' || !accel || accel.length > 60) return [];
  const vks = [];
  for (const k of accel.split('+')) {
    let vk = VK_NOMES[k];
    if (!vk && /^[A-Z0-9]$/.test(k)) vk = k.charCodeAt(0);
    if (!vk && /^F([1-9]|1\d|2[0-4])$/.test(k)) vk = 111 + Number(k.slice(1));
    if (!vk && /^num\d$/.test(k)) vk = 96 + Number(k.slice(3));
    if (!vk) return [];
    vks.push(vk);
  }
  return [...new Set(vks)];
}

// opcoes (para os testes): plataforma, tar, programa, modelos e hf trocam o que vem do Windows e da internet
function criar(pastaDados, { plataforma = process.platform, tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
  programa = PROGRAMA, modelos = MODELOS, hf = HF } = {}) {
  const pasta = path.join(pastaDados, 'comando-voz');
  const pastaBin = path.join(pasta, 'bin');
  const caminhoModelo = (id) => path.join(pasta, modelos[id].arquivo);
  let baixando = null; // AbortController do download em andamento
  let ocupado = false;
  const conferidos = new Set(); // arquivos já conferidos nesta sessão (o hash do modelo leva um instante)

  async function sha256Arquivo(arquivo) {
    const h = crypto.createHash('sha256');
    for await (const pedaco of fs.createReadStream(arquivo)) h.update(pedaco);
    return h.digest('hex');
  }
  const existe = (arquivo, tamanho) => { try { const s = fs.statSync(arquivo); return s.isFile() && (!tamanho || s.size === tamanho); } catch { return false; } };

  function estado() {
    const programaOk = Object.keys(programa.arquivos).every((n) => existe(path.join(pastaBin, n)));
    const prontos = Object.keys(modelos).filter((id) => existe(caminhoModelo(id), modelos[id].tamanho));
    return { suportado: plataforma === 'win32', programa: programaOk, modelos: prontos, baixando: !!baixando };
  }

  // Baixa para <destino>.part conferindo tamanho e SHA-256 no caminho; só renomeia se bater
  async function baixar(url, destino, tamanho, sha256, sinal, avisar) {
    const parte = `${destino}.part`;
    const resp = await fetch(url, { signal: sinal, redirect: 'follow' });
    if (!resp.ok || !resp.body) throw new Error(`O download falhou (HTTP ${resp.status}).`);
    const h = crypto.createHash('sha256');
    const saida = fs.createWriteStream(parte);
    let feito = 0;
    try {
      for await (const pedaco of resp.body) {
        feito += pedaco.length;
        if (feito > tamanho) throw new Error('O arquivo baixado é maior do que o esperado.');
        h.update(pedaco);
        if (!saida.write(pedaco)) await new Promise((r) => saida.once('drain', r));
        avisar(feito, tamanho);
      }
      await new Promise((r, e) => saida.end((err) => (err ? e(err) : r())));
      if (feito !== tamanho || h.digest('hex') !== sha256) throw new Error('O arquivo baixado não confere (assinatura diferente). Nada foi instalado.');
      await fsp.rename(parte, destino);
    } catch (err) {
      saida.destroy();
      await fsp.rm(parte, { force: true });
      throw err;
    }
  }

  // Abre o zip (tar.exe do Windows) numa pasta temporária, confere cada arquivo que fica e copia para bin/
  async function instalarPrograma(zip) {
    const tmp = path.join(pasta, 'extraindo');
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true });
    try {
      await new Promise((resolve, reject) => {
        const p = spawn(tar, ['-xf', zip, '-C', tmp], { windowsHide: true, stdio: 'ignore' });
        p.on('error', reject);
        p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Não foi possível abrir o pacote do Whisper.'))));
      });
      await fsp.mkdir(pastaBin, { recursive: true });
      for (const [nome, sha] of Object.entries(programa.arquivos)) {
        const origem = path.join(tmp, 'Release', nome);
        if (!existe(origem) || (await sha256Arquivo(origem)) !== sha) throw new Error('O pacote do Whisper não confere. Nada foi instalado.');
        await fsp.copyFile(origem, path.join(pastaBin, nome));
      }
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
      await fsp.rm(zip, { force: true });
    }
  }

  // Baixa o que falta (programa e o modelo escolhido). avisar({ etapa: 'programa'|'modelo', feito, total })
  async function instalar(modelo, avisar = () => {}) {
    if (plataforma !== 'win32') return { ok: false, erro: 'O comando de voz ainda é só para Windows.' };
    if (!modelos[modelo]) return { ok: false, erro: 'Modelo desconhecido.' };
    if (baixando) return { ok: false, erro: 'Já tem um download em andamento.' };
    baixando = new AbortController();
    const sinal = baixando.signal;
    try {
      await fsp.mkdir(pasta, { recursive: true });
      if (!estado().programa) {
        const zip = path.join(pasta, 'whisper.zip');
        await baixar(programa.url, zip, programa.tamanho, programa.sha256, sinal, (feito, total) => avisar({ etapa: 'programa', feito, total }));
        await instalarPrograma(zip);
      }
      const m = modelos[modelo];
      if (!existe(caminhoModelo(modelo), m.tamanho)) {
        await baixar(`${hf}/${m.arquivo}`, caminhoModelo(modelo), m.tamanho, m.sha256, sinal, (feito, total) => avisar({ etapa: 'modelo', feito, total }));
      }
      conferidos.clear();
      baixando = null;
      return { ok: true, estado: estado() };
    } catch (err) {
      if (sinal.aborted) return { ok: false, cancelado: true, erro: 'Download cancelado.' };
      return { ok: false, erro: err?.cause?.code === 'ENOTFOUND' || /fetch failed/i.test(err?.message) ? 'Sem conexão com a internet.' : String(err?.message || err) };
    } finally {
      baixando = null;
    }
  }
  function cancelar() { baixando?.abort(); return true; }

  async function remover() {
    if (baixando || ocupado) return { ok: false, erro: 'Espere o download ou o comando terminar.' };
    await fsp.rm(pasta, { recursive: true, force: true });
    conferidos.clear();
    return { ok: true, estado: estado() };
  }

  // Confere (uma vez por sessão) o programa e o modelo antes de rodar: nada roda sem bater o SHA-256
  async function conferir(modelo) {
    const lista = [...Object.entries(programa.arquivos).map(([n, sha]) => [path.join(pastaBin, n), sha]), [caminhoModelo(modelo), modelos[modelo].sha256]];
    for (const [arquivo, sha] of lista) {
      if (conferidos.has(arquivo)) continue;
      if (!existe(arquivo) || (await sha256Arquivo(arquivo)) !== sha) return false;
      conferidos.add(arquivo);
    }
    return true;
  }

  // WAV (16 kHz, mono, 16 bits) -> texto. A dica tem os nomes da sala, para o Whisper escrever certo
  async function transcrever(wav, modelo, dica) {
    if (!modelos[modelo]) return { ok: false, erro: 'Modelo desconhecido.' };
    const audio = Buffer.isBuffer(wav) ? wav : wav instanceof Uint8Array ? Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength) : null;
    if (!audio || audio.length < 44 || audio.length > MAX_WAV || audio.toString('latin1', 0, 4) !== 'RIFF' || audio.toString('latin1', 8, 12) !== 'WAVE') {
      return { ok: false, erro: 'Áudio inválido.' };
    }
    if (ocupado) return { ok: false, erro: 'Ainda estou entendendo o comando anterior.' };
    ocupado = true;
    try {
      if (!(await conferir(modelo))) return { ok: false, erro: 'O Whisper ou o modelo não confere. Baixe de novo em Recursos extras.', reinstalar: true };
      const prompt = String(dica || '').replace(/[\x00-\x1f]/g, ' ').slice(0, MAX_DICA);
      const threads = String(Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))));
      // -of: sem ele, com o áudio pelo stdin, o whisper-cli não escreve o texto na saída (nenhum arquivo é gravado)
      const args = ['-m', caminhoModelo(modelo), '-l', 'pt', '-nt', '-np', '-t', threads, '-of', 'comando', ...(prompt ? ['--prompt', prompt] : []), '-f', '-'];
      const texto = await new Promise((resolve, reject) => {
        const p = spawn(path.join(pastaBin, 'whisper-cli.exe'), args, { cwd: pastaBin, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
        try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {} // o jogo vem primeiro
        let saida = '';
        const timer = setTimeout(() => { p.kill(); reject(new Error('O Whisper demorou demais.')); }, TEMPO_MAX);
        p.stdout.on('data', (d) => { if (saida.length < 4000) saida += d.toString('utf8'); });
        p.on('error', (err) => { clearTimeout(timer); reject(err); });
        p.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve(saida) : reject(new Error('O Whisper não conseguiu entender o áudio.')); });
        p.stdin.on('error', () => {});
        p.stdin.end(audio);
      });
      return { ok: true, texto: texto.replace(/\s+/g, ' ').trim() };
    } catch (err) {
      return { ok: false, erro: String(err?.message || err) };
    } finally {
      ocupado = false;
    }
  }

  return { estado, instalar, cancelar, remover, transcrever, pasta };
}

module.exports = { criar, vksDoAtalho, MODELOS, PROGRAMA };
