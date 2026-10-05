'use strict';
// Foto de perfil, sem servidor.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado.
//
// A foto fica no PC de cada um: cortada em quadrado, 128x128, WebP (o que também tira os metadados). Na sala
// só passa a "impressão digital" dela (SHA-256): vai no hello, o servidor repassa na lista de membros, e muda
// com { type: 'avatar' } se a pessoa trocar de foto na sala. Quem vê um hash que não tem pede a foto direto ao
// dono ({ side: 'foto', want }) e recebe { side: 'foto', hash, data }; confere o hash e guarda no PC.
// Na próxima sala, a foto já está aqui: com o mesmo hash, nada passa pela rede.
//
// Toda bolinha de pessoa (avatar()) é pintada por paintAvatar(): com a foto, se houver, ou com a inicial.
// Ela guarda de quem é (data-owner); quando uma foto chega ou alguém troca de foto, repinta as bolinhas daquela
// pessoa onde estiverem (lista, cartão, barra da voz, chat, perfil).
const FOTO_SIZE = 128;
const FOTO_MAX = 64 * 1024;      // bytes da imagem que alguém pode mandar
const FOTO_KEEP = 50;            // fotos dos outros guardadas no PC (as mais recentes)
// A foto inteira (sem o corte quadrado), para ver no perfil: até 1024 px no lado maior. Vai pela sala só quando
// alguém abre o seu perfil, e cabe numa mensagem da sala (256 KB) já em base64.
const FOTO_FULL_SIDE = 1024;
const FOTO_FULL_MAX = 170 * 1024;
const fotos = {
  mine: null,                    // { hash, data (base64) }
  mineFull: null,                // { hash, data } a minha foto inteira
  urls: new Map(),               // hash -> data: URL, já lidas
  fullUrls: new Map(),           // hash da foto inteira -> data: URL (só na memória: não enche o PC)
  asked: new Map(),              // hash -> quando pedi (não pede de novo antes de 20 s)
  fullWaiting: new Map(),        // hash da foto inteira -> quem espera por ela (o visualizador)
};
try { const m = JSON.parse(load('fotoPerfil', 'null')); if (m && /^[0-9a-f]{64}$/.test(m.hash) && typeof m.data === 'string') fotos.mine = m; } catch {}
try { const m = JSON.parse(load('fotoPerfilInteira', 'null')); if (m && /^[0-9a-f]{64}$/.test(m.hash) && typeof m.data === 'string') fotos.mineFull = m; } catch {}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(bytes) { return hex(await crypto.subtle.digest('SHA-256', bytes)); }
function toBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s); }
function fromBase64(b64) { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
function imageMime(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  return 'image/webp';
}

// O hash da foto de alguém: 'me' (ou sem id, ou o meu id) é a minha
function photoHashOf(id) {
  if (!id || id === 'me' || id === state.myId) return fotos.mine?.hash || '';
  return state.members.get(id)?.avatar || '';
}

// A foto (data: URL) de um hash, se ela já está neste PC
function photoUrl(hash) {
  if (!hash) return '';
  if (fotos.urls.has(hash)) return fotos.urls.get(hash);
  let data = hash === fotos.mine?.hash ? fotos.mine.data : '';
  if (!data) data = load(`foto:${hash}`, '');
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return '';
  const url = `data:${imageMime(fromBase64(data.slice(0, 8)))};base64,${data}`;
  fotos.urls.set(hash, url);
  return url;
}

// Guarda a foto de outra pessoa; as mais antigas saem quando passa do limite
function keepPhoto(hash, data) {
  let list = [];
  try { list = JSON.parse(load('fotosGuardadas', '[]')); } catch {}
  list = [hash, ...list.filter((h) => h !== hash)];
  for (const old of list.splice(FOTO_KEEP)) { try { localStorage.removeItem(`foto:${old}`); } catch {} fotos.urls.delete(old); }
  save(`foto:${hash}`, data);
  save('fotosGuardadas', JSON.stringify(list));
}

// Sem foto, a bolinha é uma estrela. Cada pessoa sem foto tem uma cor, na ordem em que entrou na sala (só contam
// as sem foto): a primeira verde, a segunda vermelha, e assim por diante. Fora da sala, a sua é a verde.
const STAR_COLORS = ['#39D98A', '#FF5A5F', '#5DA9FF', '#FFC93C', '#B07CFF', '#FF8A3D', '#FF6FB5', '#3DD6D0'];
function starColorOf(owner) {
  const me = state.myId || 'me';
  const ids = [me, ...state.members.keys()].sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  const noPhoto = ids.filter((x) => !photoHashOf(x === me ? 'me' : x));
  const i = noPhoto.indexOf(owner === 'me' ? me : owner);
  return STAR_COLORS[Math.max(0, i) % STAR_COLORS.length];
}
// Pinta uma bolinha de pessoa: a foto (se houver) ou a estrela na cor da pessoa. Sem a foto aqui, pede ao dono.
function paintAvatar(el, id) {
  const owner = !id || id === state.myId ? 'me' : id;
  el.dataset.owner = owner;
  const hash = photoHashOf(owner);
  const url = photoUrl(hash);
  el.classList.toggle('photo', !!url);
  el.classList.toggle('star', !url);
  el.style.backgroundImage = url ? `url("${url}")` : '';
  if (url) el.style.removeProperty('--star'); else el.style.setProperty('--star', starColorOf(owner));
  if (hash && !url) requestPhoto(hash, owner);
}
// Alguém entrou, saiu ou trocou de foto: a ordem das estrelas pode mudar, então repinta todas as bolinhas
function repaintAllAvatars() {
  document.querySelectorAll('.avatar[data-owner], #navProfileAvatar[data-owner]').forEach((el) => paintAvatar(el, el.dataset.owner));
}
function repaintAvatars(id) {
  const owner = !id || id === state.myId ? 'me' : id;
  document.querySelectorAll(`.avatar[data-owner="${owner}"], #navProfileAvatar[data-owner="${owner}"]`).forEach((el) => paintAvatar(el, owner));
}

function requestPhoto(hash, owner) {
  if (owner === 'me' || !state.members.has(owner)) return;
  const at = fotos.asked.get(hash);
  if (at && Date.now() - at < 20000) return;
  fotos.asked.set(hash, Date.now());
  sendSignal(owner, { side: 'foto', want: hash });
}

// Mensagens diretas de foto: alguém pede a minha, ou chega a de alguém
async function onPhotoSignal(from, data) {
  if (typeof data.want === 'string') {
    if (fotos.mine && data.want === fotos.mine.hash) sendSignal(from, { side: 'foto', hash: fotos.mine.hash, data: fotos.mine.data });
    else if (fotos.mineFull && data.want === fotos.mineFull.hash) sendSignal(from, { side: 'foto', hash: fotos.mineFull.hash, data: fotos.mineFull.data, full: true });
    return;
  }
  const { hash } = data;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || typeof data.data !== 'string') return;
  const full = fotos.fullWaiting.has(hash);
  if (data.data.length > Math.ceil((full ? FOTO_FULL_MAX : FOTO_MAX) / 3) * 4 || !fotos.asked.has(hash)) return; // só o que eu pedi
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.data)) return; // base64 puro: a foto vai parar dentro de um url("") do CSS
  let bytes;
  try { bytes = fromBase64(data.data); } catch { return; }
  if (await sha256(bytes) !== hash) return;
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: imageMime(bytes) }));
    const limit = full ? FOTO_FULL_SIDE : 512;
    const ok = bmp.width <= limit && bmp.height <= limit;
    bmp.close();
    if (!ok) return;
  } catch { return; } // não é imagem
  fotos.asked.delete(hash);
  if (full) {
    const url = `data:${imageMime(bytes)};base64,${data.data}`;
    fotos.fullUrls.set(hash, url);
    for (const done of fotos.fullWaiting.get(hash) || []) done(url);
    fotos.fullWaiting.delete(hash);
    return;
  }
  keepPhoto(hash, data.data);
  for (const [id, m] of state.members) if (m.avatar === hash) repaintAvatars(id);
}

// Alguém trocou de foto na sala
function onAvatarState(id, hash, full) {
  const mem = state.members.get(id);
  if (!mem) return;
  mem.avatar = /^[0-9a-f]{64}$/.test(hash || '') ? hash : '';
  mem.avatarFull = /^[0-9a-f]{64}$/.test(full || '') ? full : '';
  repaintAllAvatars();
  renderVoiceAvatars();
}

// Como a foto entra na bolinha: 'inteira' (a foto toda, as sobras com ela mesma desfocada) ou 'preencher'
// (corta o quadrado do meio, com zoom)
let fotoFit = load('fotoEncaixe', 'inteira') === 'preencher' ? 'preencher' : 'inteira';

// Minha foto: qualquer imagem vira um quadrado de 128x128 em WebP (sem metadados); vale na hora, na sala também
async function setMyPhoto(file) {
  const bmp = await createImageBitmap(file); // a rotação da foto de celular já vem aplicada
  fotos.mineFull = await fullPhoto(bmp);
  save('fotoPerfilInteira', JSON.stringify(fotos.mineFull));
  await setSmallPhoto(bmp);
  bmp.close();
}
// Trocou entre "Inteira" e "Preencher": refaz a bolinha a partir da foto inteira guardada
async function setPhotoFit(fit) {
  fotoFit = fit === 'preencher' ? 'preencher' : 'inteira';
  save('fotoEncaixe', fotoFit);
  if (!fotos.mineFull) return renderMyPhoto();
  const bmp = await createImageBitmap(new Blob([fromBase64(fotos.mineFull.data)], { type: 'image/webp' }));
  await setSmallPhoto(bmp);
  bmp.close();
}
async function setSmallPhoto(bmp) {
  const c = new OffscreenCanvas(FOTO_SIZE, FOTO_SIZE);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  const ratio = bmp.width / bmp.height;
  if (fotoFit === 'preencher' || Math.abs(ratio - 1) < 0.04) {
    const side = Math.min(bmp.width, bmp.height);
    g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, FOTO_SIZE, FOTO_SIZE);
  } else {
    // Fundo: a própria foto cobrindo o quadrado, desfocada e mais escura; por cima, ela inteira
    const cover = FOTO_SIZE * 1.3 / Math.min(ratio, 1 / ratio);
    const cw = ratio >= 1 ? cover : cover * ratio, ch = ratio >= 1 ? cover / ratio : cover;
    g.filter = 'blur(8px) brightness(0.65)';
    g.drawImage(bmp, (FOTO_SIZE - cw) / 2, (FOTO_SIZE - ch) / 2, cw, ch);
    g.filter = 'none';
    const w = ratio >= 1 ? FOTO_SIZE : FOTO_SIZE * ratio, h = ratio >= 1 ? FOTO_SIZE / ratio : FOTO_SIZE;
    g.drawImage(bmp, (FOTO_SIZE - w) / 2, (FOTO_SIZE - h) / 2, w, h);
  }
  let blob;
  for (const quality of [0.85, 0.7, 0.5]) {
    blob = await c.convertToBlob({ type: 'image/webp', quality });
    if (blob.size <= FOTO_MAX / 2) break;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  fotos.mine = { hash: await sha256(bytes), data: toBase64(bytes) };
  save('fotoPerfil', JSON.stringify(fotos.mine));
  send({ type: 'avatar', hash: fotos.mine.hash, full: fotos.mineFull?.hash || '' });
  renderMyPhoto();
}
// A foto inteira: sem cortar, até 1024 px no lado maior, em WebP (sem metadados), diminuindo até caber
async function fullPhoto(bmp) {
  for (const maxSide of [FOTO_FULL_SIDE, 768, 512]) {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    for (const quality of [0.85, 0.72, 0.6]) {
      const blob = await c.convertToBlob({ type: 'image/webp', quality });
      if (blob.size > FOTO_FULL_MAX) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { hash: await sha256(bytes), data: toBase64(bytes) };
    }
  }
  return null;
}
// A foto inteira de alguém (data: URL). Promessa: pede ao dono se ainda não tem; sem foto inteira (versão antiga
// ou foto de antes disso), resolve com a de 128 px.
function fullPhotoOf(id) {
  const owner = !id || id === state.myId ? 'me' : id;
  const small = photoUrl(photoHashOf(owner));
  if (owner === 'me') return Promise.resolve(fotos.mineFull ? `data:image/webp;base64,${fotos.mineFull.data}` : small);
  const hash = state.members.get(owner)?.avatarFull || '';
  if (!hash) return Promise.resolve(small);
  if (fotos.fullUrls.has(hash)) return Promise.resolve(fotos.fullUrls.get(hash));
  return new Promise((resolve) => {
    const list = fotos.fullWaiting.get(hash) || [];
    list.push(resolve);
    fotos.fullWaiting.set(hash, list);
    fotos.asked.set(hash, Date.now());
    sendSignal(owner, { side: 'foto', want: hash });
    setTimeout(() => { if (fotos.fullWaiting.get(hash)?.includes(resolve)) resolve(small); }, 8000); // não chegou: fica a pequena
  });
}
function removeMyPhoto() {
  fotos.mine = null;
  fotos.mineFull = null;
  save('fotoPerfil', 'null');
  save('fotoPerfilInteira', 'null');
  recorteApagar('fotoOrigem');
  send({ type: 'avatar', hash: '', full: '' });
  renderMyPhoto();
}
function renderMyPhoto() {
  repaintAllAvatars();
  $('profilePhotoRemove').hidden = !fotos.mine;
  $('profilePhotoPick').textContent = fotos.mine ? 'Trocar' : 'Escolher';
  $('profilePhotoFit').hidden = true; // o enquadramento agora é feito no editor de recorte (renderer/recorte.js)
  $('profilePhotoAdjust').hidden = !fotos.mine || !recorteTem('fotoOrigem');
  for (const b of $('profilePhotoFit').querySelectorAll('[data-fit]')) b.setAttribute('aria-checked', String(b.dataset.fit === fotoFit));
  // Foto escolhida antes da 1.11.19: só existe o recorte, e é ele que os outros veem no seu perfil
  $('profilePhotoOld').hidden = !fotos.mine || !!fotos.mineFull;
  if (state.myId) renderVoiceAvatars();
}
