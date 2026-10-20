'use strict';
// Prévia dos vídeos do YouTube no chat (renderer/chat.js): título e canal pelo oEmbed e a capa pequena, buscados aqui
// no processo principal. A página continua sem falar com a internet (CSP do index.html): a capa volta como data: URL.
// Só o id do vídeo (11 caracteres) sai daqui; nada da mensagem nem de quem mandou.

const YOUTUBE = 'https://www.youtube.com';
const CAPAS = 'https://i.ytimg.com';
const ID = /^[\w-]{11}$/;
const LIMITE_JSON = 64 * 1024;
const LIMITE_CAPA = 200 * 1024; // a mqdefault (320x180) tem uns 15 KB
const GUARDADOS = 200;
const cache = new Map(); // id -> Promise<prévia | null>; a mais antiga sai primeiro

const limpar = (s, max) => (typeof s === 'string' ? s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

async function lerAte(r, max) {
  if (Number(r.headers.get('content-length')) > max) throw new Error('grande demais');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > max) throw new Error('grande demais');
  return buf;
}

async function buscar(id, { youtube, capas }) {
  const opts = { redirect: 'error', signal: AbortSignal.timeout(8000) };
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const [info, capa] = await Promise.all([
    fetch(`${youtube}/oembed?format=json&url=${encodeURIComponent(watch)}`, opts),
    fetch(`${capas}/vi/${id}/mqdefault.jpg`, opts),
  ]);
  if (!info.ok) return null; // privado, removido ou sem incorporar: fica só o link
  const json = JSON.parse((await lerAte(info, LIMITE_JSON)).toString('utf8'));
  const titulo = limpar(json?.title, 150);
  if (!titulo) return null;
  let imagem = '';
  if (capa.ok && /^image\/jpeg\b/i.test(capa.headers.get('content-type') || '')) {
    imagem = `data:image/jpeg;base64,${(await lerAte(capa, LIMITE_CAPA)).toString('base64')}`;
  }
  return { id, titulo, canal: limpar(json?.author_name, 80), capa: imagem };
}

// null quando não dá (id inválido, sem internet, vídeo privado). Repetir o mesmo vídeo não busca de novo.
function previaYoutube(id, { youtube = YOUTUBE, capas = CAPAS } = {}) {
  if (typeof id !== 'string' || !ID.test(id)) return Promise.resolve(null);
  if (cache.has(id)) return cache.get(id);
  const p = buscar(id, { youtube, capas }).catch(() => null);
  cache.set(id, p);
  p.then((r) => { if (!r) cache.delete(id); }); // falhou: tenta de novo da próxima vez que o vídeo aparecer
  while (cache.size > GUARDADOS) cache.delete(cache.keys().next().value);
  return p;
}

module.exports = { previaYoutube };
