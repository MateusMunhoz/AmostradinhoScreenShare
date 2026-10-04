// Clipes salvos (renderer/clipes.js monta o MP4; aqui só grava). Tudo vai para uma pasta só (Vídeos\Tela P2P\Clipes),
// com o nome limpo; a página nunca escolhe caminho. "Mostrar na pasta" só abre clipes que este app salvou nesta sessão.
// Só módulos do Node: testado sem o Electron (tests/clipes.test.js).
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 300 * 1024 * 1024;

// "Clipe - Ana - 2026-10-03 21-14-05": sem caracteres que o Windows recusa, sem pontos no fim, até 80 letras
function cleanName(label) {
  const name = String(label || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
  return name || 'Clipe';
}

function createClipStore({ dir, showItem }) {
  const saved = new Map(); // id -> caminho
  let next = 1;
  async function save(bytes, label) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > MAX_BYTES) return { ok: false, error: 'Clipe vazio ou grande demais.' };
    const base = cleanName(label);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      let file = path.join(dir, `${base}.mp4`);
      for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base} (${i}).mp4`);
      await fs.promises.writeFile(file, bytes);
      const id = next++;
      saved.set(id, file);
      return { ok: true, id, name: path.basename(file) };
    } catch (e) {
      return { ok: false, error: `Não deu para salvar o clipe: ${e.message}` };
    }
  }
  function show(id) {
    const file = saved.get(Number(id));
    if (!file || !fs.existsSync(file)) return false;
    showItem(file);
    return true;
  }
  return { save, show, dir };
}

module.exports = { createClipStore, cleanName, MAX_BYTES };
