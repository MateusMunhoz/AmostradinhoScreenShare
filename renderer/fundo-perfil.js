'use strict';
// Fundo do perfil: uma imagem ou um GIF atrás do perfil da pessoa (a caixinha da lista da voz e o perfil no mapa,
// renderSkyProfile em ceu-voz.js). docs/spec/fundo-do-perfil.md
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, fotos.
//
// Sem servidor, como a foto (fotos.js), mas só por mensagens diretas ({ side: 'fundo' }), que o servidor da sala
// repassa sem olhar: ao abrir o perfil de alguém, pede o hash do fundo dela ({ want: 'hash' } → { hash }); se ainda
// não tem esse fundo, pede o arquivo ({ want: <hash> }), que vem em pedaços ({ hash, part, of, mime, data }) para
// caber nas mensagens da sala (256 KB). Confere tudo (só o que pediu, tamanhos, base64, SHA-256, que é imagem) e
// guarda só na memória. O seu fica no PC (fundoPerfil).
//
// Imagem vira WebP (recortada, sem metadados); GIF vai como é (o navegador não regrava GIF animado). O GIF só anima
// com o perfil aberto; com "reduzir movimento" ou no modo gamer, fica o primeiro quadro.
const FUNDO_MAX = 1024 * 1024;           // bytes do arquivo
const FUNDO_B64 = Math.ceil(FUNDO_MAX / 3) * 4;
const FUNDO_PART = 200000;               // caracteres de base64 por mensagem (múltiplo de 4), bem abaixo dos 256 KB
const FUNDO_PARTS = Math.ceil(FUNDO_B64 / FUNDO_PART);
const FUNDO_SIDE = 520;                  // imagem: o quadrado em que ela é recortada
const FUNDO_GIF_SIDE = 1024;             // GIF: maior lado
const FUNDO_MIMES = ['image/gif', 'image/webp'];
const fundos = {
  mine: null,           // { hash, mime, data (base64) }
  urls: new Map(),      // hash -> data: URL (o arquivo, animado se for GIF)
  stills: new Map(),    // hash -> data: URL do primeiro quadro (WebP)
  of: new Map(),        // id -> hash do fundo dela ('' sem fundo), como ela respondeu
  askedHash: new Map(), // id -> quando pedi o hash (não pede de novo antes de 3 s)
  receiving: new Map(), // hash -> { from, of, mime, parts[], at } o arquivo chegando
  served: new Map(),    // `${id}:${hash}` -> quando mandei (não manda de novo antes de 10 s)
};
try {
  const m = JSON.parse(load('fundoPerfil', 'null'));
  if (m && /^[0-9a-f]{64}$/.test(m.hash) && FUNDO_MIMES.includes(m.mime) && typeof m.data === 'string') fundos.mine = m;
} catch {}

function isGif(b) { return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38; } // "GIF8"
function isWebp(b) { return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45; } // RIFF....WE
const stillFundo = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.gamer === 'on';

// O primeiro quadro, para quando não pode animar (o createImageBitmap de um GIF pega o primeiro quadro)
async function fundoStill(bytes, mime) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.85 });
  return `data:image/webp;base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}
// Guarda um fundo (meu ou que chegou) pronto para pintar
async function rememberFundo(hash, mime, data) {
  if (fundos.urls.has(hash)) return;
  for (const old of [...fundos.urls.keys()].slice(0, Math.max(0, fundos.urls.size - 29))) {
    if (old === fundos.mine?.hash) continue;
    fundos.urls.delete(old); fundos.stills.delete(old); // até 30 na memória: os mais antigos saem
  }
  const bytes = fromBase64(data);
  fundos.urls.set(hash, `data:${mime};base64,${data}`);
  if (mime === 'image/gif') { try { fundos.stills.set(hash, await fundoStill(bytes, mime)); } catch {} }
}

// O fundo de alguém (data: URL), se já está aqui; '' sem fundo ou ainda chegando. id null/meu = o meu
function profileBgOf(id) {
  const hash = !id || id === state.myId ? fundos.mine?.hash || '' : fundos.of.get(id) || '';
  if (!hash) return '';
  if (stillFundo() && fundos.stills.has(hash)) return fundos.stills.get(hash);
  return fundos.urls.get(hash) || '';
}
// Abriu o perfil de alguém: pergunta qual é o fundo dela (pode ter trocado)
function requestProfileBg(id) {
  if (!id || id === state.myId || !state.members.has(id)) return;
  const at = fundos.askedHash.get(id);
  if (at && Date.now() - at < 3000) return;
  fundos.askedHash.set(id, Date.now());
  sendSignal(id, { side: 'fundo', want: 'hash' });
}
// O fundo de alguém mudou ou chegou: redesenha o perfil aberto, se for dela
function fundoChanged(id) {
  if (typeof skyFocusId !== 'undefined' && skyFocusId === id) { skyFocusKey = ''; renderSkyProfile(); }
}

// Mensagens diretas do fundo: alguém pede o meu, ou chega o de alguém
async function onProfileBgSignal(from, data) {
  if (!state.members.has(from)) return;
  if (data.want === 'hash') return sendSignal(from, { side: 'fundo', hash: fundos.mine?.hash || '' });
  if (typeof data.want === 'string') {
    const m = fundos.mine, key = `${from}:${data.want}`, at = fundos.served.get(key);
    if (!m || data.want !== m.hash || (at && Date.now() - at < 10000)) return;
    fundos.served.set(key, Date.now());
    const of = Math.ceil(m.data.length / FUNDO_PART);
    for (let part = 0; part < of; part++) {
      sendSignal(from, { side: 'fundo', hash: m.hash, mime: m.mime, part, of, data: m.data.slice(part * FUNDO_PART, (part + 1) * FUNDO_PART) });
    }
    return;
  }
  const hash = typeof data.hash === 'string' ? data.hash : null;
  if (hash === null || (hash && !/^[0-9a-f]{64}$/.test(hash))) return;
  // Só o hash: a resposta ao { want: 'hash' }
  if (data.part === undefined) {
    if (!fundos.askedHash.has(from)) return;
    const before = fundos.of.get(from) || '';
    fundos.of.set(from, hash);
    if (hash && !fundos.urls.has(hash) && !fundos.receiving.has(hash)) {
      fundos.receiving.set(hash, { from, of: 0, mime: '', parts: [], at: Date.now() });
      sendSignal(from, { side: 'fundo', want: hash });
    }
    if (hash !== before || fundos.urls.has(hash)) fundoChanged(from);
    return;
  }
  // Um pedaço do arquivo
  const r = fundos.receiving.get(hash);
  if (!r || r.from !== from) return; // só o que eu pedi, de quem eu pedi
  if (Date.now() - r.at > 30000) { fundos.receiving.delete(hash); return; } // demorou demais: pede de novo ao reabrir
  const { part, of, mime } = data;
  if (!Number.isInteger(of) || of < 1 || of > FUNDO_PARTS || !Number.isInteger(part) || part < 0 || part >= of) return;
  if (!FUNDO_MIMES.includes(mime) || (r.of && (r.of !== of || r.mime !== mime))) return;
  if (typeof data.data !== 'string' || data.data.length > FUNDO_PART || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.data)) return;
  r.of = of; r.mime = mime; r.parts[part] = data.data;
  for (let i = 0; i < of; i++) if (typeof r.parts[i] !== 'string') return; // falta pedaço
  fundos.receiving.delete(hash);
  const b64 = r.parts.join('');
  if (b64.length > FUNDO_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return; // base64 puro: vai parar num url("") do CSS
  let bytes;
  try { bytes = fromBase64(b64); } catch { return; }
  if (bytes.length > FUNDO_MAX || await sha256(bytes) !== hash) return;
  if (!(mime === 'image/gif' ? isGif(bytes) : isWebp(bytes))) return;
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const ok = bmp.width <= FUNDO_GIF_SIDE && bmp.height <= FUNDO_GIF_SIDE;
    bmp.close();
    if (!ok) return;
  } catch { return; } // não é imagem
  await rememberFundo(hash, mime, b64);
  for (const [id, h] of fundos.of) if (h === hash) fundoChanged(id);
}

// ---------- O meu fundo (Perfil) ----------
// GIF: do jeito que é, se couber. Outra imagem: recortada num quadrado de 520 (cobrindo, do meio), em WebP
async function setMyProfileBg(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let mime, out;
  if (isGif(bytes)) {
    if (bytes.length > FUNDO_MAX) throw new Error('grande');
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/gif' }));
    const ok = bmp.width <= FUNDO_GIF_SIDE && bmp.height <= FUNDO_GIF_SIDE;
    bmp.close();
    if (!ok) throw new Error('lado');
    mime = 'image/gif'; out = bytes;
  } else {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const c = new OffscreenCanvas(FUNDO_SIDE, FUNDO_SIDE), g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const side = Math.min(bmp.width, bmp.height);
    g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, FUNDO_SIDE, FUNDO_SIDE);
    bmp.close();
    for (const quality of [0.85, 0.7, 0.55]) {
      out = new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality })).arrayBuffer());
      if (out.length <= 300 * 1024) break;
    }
    mime = 'image/webp';
  }
  const mine = { hash: await sha256(out), mime, data: toBase64(out) };
  try { localStorage.setItem('fundoPerfil', JSON.stringify(mine)); } catch { throw new Error('espaco'); }
  fundos.mine = mine;
  await rememberFundo(mine.hash, mime, mine.data);
  renderMyProfileBg();
}
function removeMyProfileBg() {
  fundos.mine = null;
  save('fundoPerfil', 'null');
  recorteApagar('fundoOrigem');
  renderMyProfileBg();
}
function renderMyProfileBg() {
  const url = profileBgOf(null);
  // O fundo da prévia do perfil; sem fundo, a faixa fica na sua cor
  $('profileBgPreview').classList.toggle('has-bg', !!url);
  $('profileBgPreview').style.backgroundImage = url ? `url("${url}")` : '';
  $('profileBgPreview').style.setProperty('--person', personColor(null));
  $('profileBgRemove').hidden = !fundos.mine;
  $('profileBgAdjust').hidden = !fundos.mine || !recorteTem('fundoOrigem');
  $('profileBgPick').textContent = fundos.mine ? 'Trocar' : 'Escolher';
  $('profileBgPickTop').querySelector('span').textContent = fundos.mine ? 'Trocar fundo' : 'Escolher fundo';
  if (typeof skyFocusId !== 'undefined' && skyFocusId === state.myId) fundoChanged(skyFocusId);
}
function setupProfileBg() {
  $('profileBgPick').onclick = $('profileBgPickTop').onclick = () => $('profileBgFile').click();
  $('profileBgFile').onchange = async () => {
    const file = $('profileBgFile').files[0];
    $('profileBgFile').value = '';
    if (!file) return;
    try {
      if (/gif/i.test(file.type)) { await setMyProfileBg(file); recorteApagar('fundoOrigem'); } // GIF não corta: fica animado
      else await ajustarFundo(file);
    } catch (e) {
      toast(e.message === 'grande' ? 'Este GIF é grande demais (máx. 1 MB). Tente um menor ou mais curto.'
        : e.message === 'lado' ? 'Este GIF é grande demais (máx. 1024 px de lado).'
        : e.message === 'espaco' ? 'Não sobrou espaço para guardar esse fundo neste PC.'
        : 'Não deu para abrir essa imagem. Escolha uma imagem (JPG, PNG, WebP) ou um GIF.', 'error');
    }
  };
  $('profileBgRemove').onclick = removeMyProfileBg;
  if (fundos.mine) rememberFundo(fundos.mine.hash, fundos.mine.mime, fundos.mine.data).then(renderMyProfileBg, renderMyProfileBg);
  else renderMyProfileBg();
}
// Saiu da sala: esquece o que sabia dos outros (os arquivos ficam na memória, pelo hash)
function resetProfileBgs() { fundos.of.clear(); fundos.askedHash.clear(); fundos.receiving.clear(); fundos.served.clear(); }
