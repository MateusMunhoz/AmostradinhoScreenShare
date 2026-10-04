'use strict';
// Clipes: os últimos segundos de uma transmissão viram um MP4 em Vídeos\Tela P2P\Clipes.
// Só no modo "uma vez só" (encode-once.js): os pedaços H.264 que já chegam ficam guardados (ClipBuffer, em
// renderer/clipe-mp4.js) e, ao salvar, viram o arquivo sem recodificar. Atalho (Ctrl+Shift+C, em Voz e atalhos),
// tesoura em cada transmissão e item no ícone da bandeja.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, clipe-mp4.

const CLIP_SECONDS = 30;
const CLIP_KEY_EVERY = 8; // s: quem transmite pelo NVENC só manda quadro-chave quando pedem
const CLIP_OWN_NVENC = true; // o NVENC não pausa sem ninguém assistindo: dá para clipar a própria tela sozinho (encode-once.js)
const clipState = { saving: false };

// Chamado pelo encode-once.js a cada quadro inteiro. target: o link de quem transmite, ou `once` (a sua transmissão).
function clipFeed(target, key, ts, data, askKey) {
  const b = target.clip || (target.clip = new ClipMp4.ClipBuffer({ seconds: CLIP_SECONDS + 1 }));
  b.push({ key, ts, data });
  const now = performance.now();
  if (b.sinceKey() > CLIP_KEY_EVERY && now - (target.clipAsked || 0) > CLIP_KEY_EVERY * 1000) {
    target.clipAsked = now;
    askKey();
  }
}
// Perdeu um pedaço: até o próximo quadro-chave os seguintes não servem (dependem do que faltou)
function clipGap(target) { target.clip?.gap(); }
function clipDrop(target) { if (target) target.clip = null; }

// De onde sai o clipe de uma pessoa: a sua transmissão (once; vale mesmo sem a sua tela aberta) ou o link de quem
// você assiste
function clipSource(id) {
  if (id && id === state.myId) return once.active && once.clip ? { buffer: once.clip, width: once.width, height: once.height } : null;
  const link = state.in.get(id);
  if (!link) return null;
  const r = link.once;
  if (!r || !link.clip) return null;
  return { buffer: link.clip, width: r.width || 1280, height: r.height || 720 };
}
function clipReady(id) { return (clipSource(id)?.buffer.duration() || 0) >= 1; }

// Quem o atalho salva: a transmissão em destaque; sem destaque, a única aberta; senão a principal
function clipTargetId() {
  if (state.focus && clipReady(state.focus)) return state.focus;
  const ready = [...new Set([...state.in.keys(), state.myId])].filter((id) => id && clipReady(id));
  if (ready.length === 1) return ready[0];
  if (state.main && ready.includes(state.main)) return state.main;
  return ready.find((id) => id !== state.myId) || ready[0] || null;
}

const pad2 = (n) => String(n).padStart(2, '0');
function clipLabel(id) {
  const d = new Date();
  const who = id === state.myId ? 'Minha tela' : nameOf(id);
  return `Clipe - ${who} - ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

async function saveClip(id = clipTargetId()) {
  if (clipState.saving) return;
  const src = id ? clipSource(id) : null;
  if (!src || src.buffer.duration() < 1) {
    return toast('Nada para clipar agora. O clipe funciona com transmissões no modo "uma vez só" (Estatísticas › Transmissão mostra o modo).', 'error');
  }
  clipState.saving = true;
  try {
    const { bytes, seconds } = ClipMp4.buildMp4(src.buffer.take(CLIP_SECONDS), src, Mp4Muxer);
    const res = await window.api.clipSave(bytes, clipLabel(id));
    if (!res.ok) return toast(res.error, 'error');
    toast(`Clipe salvo (${Math.round(seconds)} s): ${res.name}`, 'info', { label: 'Mostrar na pasta', run: () => window.api.clipShow(res.id) });
  } catch (e) {
    console.warn('[clipe]', e);
    toast(`Não deu para montar o clipe: ${e.message}`, 'error');
  } finally {
    clipState.saving = false;
  }
}
