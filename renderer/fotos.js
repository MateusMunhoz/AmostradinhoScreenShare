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
const fotos = {
  mine: null,                    // { hash, data (base64) }
  urls: new Map(),               // hash -> data: URL, já lidas
  asked: new Map(),              // hash -> quando pedi (não pede de novo antes de 20 s)
};
try { const m = JSON.parse(load('fotoPerfil', 'null')); if (m && /^[0-9a-f]{64}$/.test(m.hash) && typeof m.data === 'string') fotos.mine = m; } catch {}

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

// Pinta uma bolinha de pessoa: a foto (se houver) ou a inicial que já está nela. Sem a foto aqui, pede ao dono.
function paintAvatar(el, id) {
  const owner = !id || id === state.myId ? 'me' : id;
  el.dataset.owner = owner;
  const hash = photoHashOf(owner);
  const url = photoUrl(hash);
  el.classList.toggle('photo', !!url);
  el.style.backgroundImage = url ? `url("${url}")` : '';
  if (hash && !url) requestPhoto(hash, owner);
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
    return;
  }
  const { hash } = data;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || typeof data.data !== 'string') return;
  if (data.data.length > Math.ceil(FOTO_MAX / 3) * 4 || !fotos.asked.has(hash)) return; // só o que eu pedi
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.data)) return; // base64 puro: a foto vai parar dentro de um url("") do CSS
  let bytes;
  try { bytes = fromBase64(data.data); } catch { return; }
  if (await sha256(bytes) !== hash) return;
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: imageMime(bytes) }));
    const ok = bmp.width <= 512 && bmp.height <= 512;
    bmp.close();
    if (!ok) return;
  } catch { return; } // não é imagem
  fotos.asked.delete(hash);
  keepPhoto(hash, data.data);
  for (const [id, m] of state.members) if (m.avatar === hash) repaintAvatars(id);
}

// Alguém trocou de foto na sala
function onAvatarState(id, hash) {
  const mem = state.members.get(id);
  if (!mem) return;
  mem.avatar = /^[0-9a-f]{64}$/.test(hash || '') ? hash : '';
  repaintAvatars(id);
  renderVoiceAvatars();
}

// Minha foto: qualquer imagem vira um quadrado de 128x128 em WebP (sem metadados); vale na hora, na sala também
async function setMyPhoto(file) {
  const bmp = await createImageBitmap(file); // a rotação da foto de celular já vem aplicada
  const side = Math.min(bmp.width, bmp.height);
  const c = new OffscreenCanvas(FOTO_SIZE, FOTO_SIZE);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, FOTO_SIZE, FOTO_SIZE);
  bmp.close();
  let blob;
  for (const quality of [0.85, 0.7, 0.5]) {
    blob = await c.convertToBlob({ type: 'image/webp', quality });
    if (blob.size <= FOTO_MAX / 2) break;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  fotos.mine = { hash: await sha256(bytes), data: toBase64(bytes) };
  save('fotoPerfil', JSON.stringify(fotos.mine));
  send({ type: 'avatar', hash: fotos.mine.hash });
  renderMyPhoto();
}
function removeMyPhoto() {
  fotos.mine = null;
  save('fotoPerfil', 'null');
  send({ type: 'avatar', hash: '' });
  renderMyPhoto();
}
function renderMyPhoto() {
  repaintAvatars('me');
  $('profilePhotoRemove').hidden = !fotos.mine;
  $('profilePhotoPick').textContent = fotos.mine ? 'Trocar foto' : 'Escolher foto';
  if (state.myId) renderVoiceAvatars();
}
