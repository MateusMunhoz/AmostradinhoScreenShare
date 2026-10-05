'use strict';
// Editor de recorte da foto e do fundo do perfil: mostra a imagem num quadrado, dá para arrastar e dar zoom (roda do
// mouse, controle, setas e + / -) e o resultado é um quadrado. A imagem original (até 1280 px) fica guardada junto do
// enquadramento, para ajustar de novo depois sem escolher a imagem outra vez.
// Script clássico: só declara; quem liga é renderer/inicio.js (setupRecorte). Usa: util ($, load, save, toast).

const RECORTE_VISTA = 360;       // lado do quadrado na tela (px do canvas)
const RECORTE_ORIGEM_LADO = 1280; // lado maior da original guardada
const RECORTE_ZOOM_MAX = 4;
const recorte = { bmp: null, forma: 'circulo', zoom: 1, cx: 0.5, cy: 0.5, saidaLado: 1024, resolver: null, arrasto: null, origem: null };

// ---------- Geometria (funções puras, testadas em tests/recorte.test.js) ----------
// O quadrado de corte, em pixels da imagem: lado, canto esquerdo e topo, dentro da imagem
function recorteCaixa(w, h, zoom, cx, cy) {
  const z = Math.min(RECORTE_ZOOM_MAX, Math.max(1, Number(zoom) || 1));
  const lado = Math.min(w, h) / z;
  const x = Math.min(w - lado, Math.max(0, (Number.isFinite(cx) ? cx : 0.5) * w - lado / 2));
  const y = Math.min(h - lado, Math.max(0, (Number.isFinite(cy) ? cy : 0.5) * h - lado / 2));
  return { lado, x, y };
}
// Arrastou dx, dy pixels da tela: o centro anda ao contrário, na escala da imagem; devolve o centro novo, já dentro
function recorteArrastar(w, h, zoom, cx, cy, dx, dy) {
  const { lado } = recorteCaixa(w, h, zoom, cx, cy);
  const escala = lado / RECORTE_VISTA;
  const novoCx = (cx * w - dx * escala) / w;
  const novoCy = (cy * h - dy * escala) / h;
  const c = recorteCaixa(w, h, zoom, novoCx, novoCy);
  return { cx: (c.x + c.lado / 2) / w, cy: (c.y + c.lado / 2) / h };
}
if (typeof module !== 'undefined') module.exports = { recorteCaixa, recorteArrastar };

// ---------- Desenho ----------
function recorteDesenhar() {
  const c = $('recorteCanvas');
  const g = c.getContext('2d');
  const R = RECORTE_VISTA;
  g.clearRect(0, 0, R, R);
  if (!recorte.bmp) return;
  const { lado, x, y } = recorteCaixa(recorte.bmp.width, recorte.bmp.height, recorte.zoom, recorte.cx, recorte.cy);
  g.imageSmoothingQuality = 'high';
  g.drawImage(recorte.bmp, x, y, lado, lado, 0, 0, R, R);
  g.save();
  g.fillStyle = 'rgba(0, 0, 0, 0.55)';
  g.beginPath();
  g.rect(0, 0, R, R);
  if (recorte.forma === 'circulo') g.arc(R / 2, R / 2, R / 2 - 1, 0, Math.PI * 2);
  else g.rect(0, R / 2 - R / 6, R, R / 3); // a faixa que mais aparece no cartão do perfil (3 por 1)
  g.fill('evenodd');
  g.restore();
  g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  g.lineWidth = 1.5;
  g.setLineDash(recorte.forma === 'circulo' ? [] : [6, 4]);
  g.beginPath();
  if (recorte.forma === 'circulo') g.arc(R / 2, R / 2, R / 2 - 1, 0, Math.PI * 2);
  else g.rect(0.75, R / 2 - R / 6, R - 1.5, R / 3);
  g.stroke();
  $('recorteZoom').value = String(recorte.zoom);
}

// ---------- Abrir ----------
// blob: a imagem; forma: 'circulo' (foto) ou 'faixa' (fundo); quadro: { zoom, cx, cy } de uma vez anterior.
// Devolve { saida: Blob WebP quadrado, origem: Blob WebP (original reduzida), quadro } ou null se cancelou.
async function abrirRecorte({ blob, forma, titulo, dica, saidaLado = 1024, quadro = null }) {
  const bmp = await createImageBitmap(blob); // a rotação da foto de celular já vem aplicada
  recorte.bmp = bmp;
  recorte.forma = forma;
  recorte.saidaLado = saidaLado;
  recorte.zoom = quadro?.zoom || 1;
  recorte.cx = quadro?.cx ?? 0.5;
  recorte.cy = quadro?.cy ?? 0.5;
  recorte.origem = blob;
  $('recorteTitulo').textContent = titulo;
  $('recorteDica').textContent = dica;
  $('recorteZoom').max = String(RECORTE_ZOOM_MAX);
  $('recorteDialog').hidden = false;
  recorteDesenhar();
  $('recorteArea').focus();
  return new Promise((resolver) => { recorte.resolver = resolver; });
}

function recorteFechar(resultado) {
  $('recorteDialog').hidden = true;
  recorte.bmp?.close?.();
  recorte.bmp = null;
  const r = recorte.resolver;
  recorte.resolver = null;
  if (r) r(resultado);
}

async function recorteConfirmar() {
  if (!recorte.bmp) return;
  const bmp = recorte.bmp;
  const { lado, x, y } = recorteCaixa(bmp.width, bmp.height, recorte.zoom, recorte.cx, recorte.cy);
  const L = Math.min(recorte.saidaLado, Math.round(lado));
  const out = new OffscreenCanvas(L, L);
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, x, y, lado, lado, 0, 0, L, L);
  const saida = await out.convertToBlob({ type: 'image/webp', quality: 0.92 });
  // A original reduzida: para ajustar de novo depois
  const escala = Math.min(1, RECORTE_ORIGEM_LADO / Math.max(bmp.width, bmp.height));
  const o = new OffscreenCanvas(Math.round(bmp.width * escala), Math.round(bmp.height * escala));
  o.getContext('2d').drawImage(bmp, 0, 0, o.width, o.height);
  const origem = await o.convertToBlob({ type: 'image/webp', quality: 0.85 });
  recorteFechar({ saida, origem, quadro: { zoom: recorte.zoom, cx: recorte.cx, cy: recorte.cy } });
}

// ---------- A original e o enquadramento ficam guardados (localStorage) ----------
async function recorteGuardar(chave, r) {
  try {
    const bytes = new Uint8Array(await r.origem.arrayBuffer());
    save(chave, JSON.stringify({ data: toBase64(bytes), quadro: r.quadro }));
  } catch { /* sem espaço: só não dá para ajustar depois */ }
}
function recorteGuardado(chave) {
  try {
    const m = JSON.parse(load(chave, 'null'));
    if (!m || typeof m.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.data)) return null;
    return { blob: new Blob([fromBase64(m.data)], { type: 'image/webp' }), quadro: m.quadro || null };
  } catch { return null; }
}
const recorteApagar = (chave) => save(chave, 'null');

const recorteTem = (chave) => load(chave, 'null').startsWith('{');

// A foto: arrasta e dá zoom na bolinha; o resultado entra no mesmo caminho de antes (renderer/fotos.js › setMyPhoto)
async function ajustarFoto(blob, quadro = null) {
  const r = await abrirRecorte({ blob, forma: 'circulo', titulo: 'Ajustar a foto', dica: 'Arraste para enquadrar e use o zoom. A bolinha mostra como os outros te veem.', saidaLado: 1024, quadro });
  if (!r) return;
  await setMyPhoto(r.saida);
  await recorteGuardar('fotoOrigem', r);
  renderMyPhoto();
}
// O fundo: GIF não corta (fica animado, como estava); imagem parada abre o editor
async function ajustarFundo(blob, quadro = null) {
  const r = await abrirRecorte({ blob, forma: 'faixa', titulo: 'Ajustar o fundo', dica: 'Arraste e use o zoom. A faixa tracejada é a parte que mais aparece no seu cartão do perfil.', saidaLado: 768, quadro });
  if (!r) return;
  await setMyProfileBg(r.saida);
  await recorteGuardar('fundoOrigem', r);
  renderMyProfileBg();
}

// ---------- Eventos ----------
function setupRecorte() {
  $('profilePhotoAdjust').onclick = () => { const g = recorteGuardado('fotoOrigem'); if (g) void ajustarFoto(g.blob, g.quadro).catch(() => toast('Não deu para abrir a foto.', 'error')); };
  $('profileBgAdjust').onclick = () => { const g = recorteGuardado('fundoOrigem'); if (g) void ajustarFundo(g.blob, g.quadro).catch(() => toast('Não deu para abrir o fundo.', 'error')); };
  const area = $('recorteArea');
  const zoom = (v) => { recorte.zoom = Math.min(RECORTE_ZOOM_MAX, Math.max(1, v)); recorteArrumar(0, 0); };
  area.addEventListener('pointerdown', (e) => {
    recorte.arrasto = { x: e.clientX, y: e.clientY };
    area.setPointerCapture(e.pointerId);
  });
  area.addEventListener('pointermove', (e) => {
    if (!recorte.arrasto || !recorte.bmp) return;
    const k = RECORTE_VISTA / area.getBoundingClientRect().width; // a tela pode escalar o canvas
    recorteArrumar((e.clientX - recorte.arrasto.x) * k, (e.clientY - recorte.arrasto.y) * k);
    recorte.arrasto = { x: e.clientX, y: e.clientY };
  });
  const solta = () => { recorte.arrasto = null; };
  area.addEventListener('pointerup', solta);
  area.addEventListener('pointercancel', solta);
  area.addEventListener('wheel', (e) => { e.preventDefault(); zoom(recorte.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
  area.addEventListener('keydown', (e) => {
    const passo = e.shiftKey ? 30 : 10;
    const mapa = { ArrowLeft: [passo, 0], ArrowRight: [-passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo] };
    if (mapa[e.key]) { e.preventDefault(); recorteArrumar(...mapa[e.key]); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(recorte.zoom * 1.1); }
    else if (e.key === '-') { e.preventDefault(); zoom(recorte.zoom / 1.1); }
  });
  $('recorteZoom').oninput = () => zoom(Number($('recorteZoom').value));
  $('recorteOk').onclick = () => void recorteConfirmar();
  $('recorteCancel').onclick = () => recorteFechar(null);
  $('recorteDialog').addEventListener('keydown', (e) => { if (e.key === 'Escape') recorteFechar(null); });
}
// Anda o centro por (dx, dy) pixels da tela e redesenha
function recorteArrumar(dx, dy) {
  if (!recorte.bmp) return;
  const c = recorteArrastar(recorte.bmp.width, recorte.bmp.height, recorte.zoom, recorte.cx, recorte.cy, dx, dy);
  recorte.cx = c.cx;
  recorte.cy = c.cy;
  recorteDesenhar();
}
