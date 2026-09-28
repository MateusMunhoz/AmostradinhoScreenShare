'use strict';
// Palco: como as telas assistidas se arrumam.
// "grid": grade automática no estilo do Google Meet. Cada tela é um vídeo 16:9 o maior possível; as linhas
//   de cima têm menos telas (maiores) e as de baixo dividem o espaço entre mais. Muda sozinha quando alguém
//   entra, sai ou a janela muda de tamanho; com telas demais, elas param no tamanho mínimo e o palco rola.
// "spotlight": uma grande e as outras numa coluna ao lado (renderFocus, em assistir.js); a divisa entre as duas
//   é arrastável e a largura fica salva.
// Arrastar uma tela pela faixa do nome troca ela de lugar com a que estiver embaixo; soltar em cima da grande
// faz ela virar a grande. Pelo teclado: foco na faixa do nome e Alt + setas.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, assistir.

const palco = {
  layout: load('stageLayout') === 'spotlight' ? 'spotlight' : 'grid',
  order: [],                                                   // ordem das telas (ids), só nesta sala
  side: Math.min(0.5, Math.max(0.15, Number(load('stageSide')) || 0.26)), // largura da coluna no Destaque
  drag: null,
  justDragged: false,
};
const STAGE_GAP = 12, TILE_BAR = 34, TILE_MIN = 240; // TILE_MIN: largura mínima de uma tela na grade

// Ids na ordem do palco: os que já tinham lugar, depois os novos
function stageIds() {
  palco.order = palco.order.filter((id) => state.in.has(id));
  for (const id of state.in.keys()) if (!palco.order.includes(id)) palco.order.push(id);
  return palco.order;
}

function setStageLayout(layout) {
  palco.layout = layout === 'spotlight' ? 'spotlight' : 'grid';
  save('stageLayout', palco.layout);
  renderFocus();
}

// Linhas com números diferentes de telas: as de cima têm menos (e maiores), as de baixo dividem o espaço entre
// mais. Ex.: 3 = 1 em cima e 2 embaixo; 5 = 2 e 3. Cada tela é um vídeo 16:9 mais a faixa do nome.
function planRows(n, rows) {
  const base = Math.floor(n / rows), extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i >= rows - extra ? 1 : 0));
}
// Escolhe quantas linhas cobrem mais área sem nenhuma tela ficar estreita demais (TILE_MIN). Se nem assim
// couber, as telas ficam no tamanho mínimo e o palco rola.
function planGrid(n, W, H) {
  let best = null;
  for (let rows = 1; rows <= n; rows++) {
    const counts = planRows(n, rows);
    if (counts[0] < 1) break;
    const widths = counts.map((k) => (W - STAGE_GAP * (k - 1)) / k);
    const video = widths.reduce((s, w) => s + w * 9 / 16, 0);
    const room = H - STAGE_GAP * (rows - 1) - TILE_BAR * rows;
    const scale = Math.min(1, room / video);
    const area = counts.reduce((s, k, i) => s + k * (widths[i] * scale) ** 2, 0);
    if (widths[widths.length - 1] * scale < TILE_MIN) continue;
    if (!best || area > best.area) best = { counts, scale, area, scroll: false };
  }
  if (best) return best;
  const perRow = Math.max(1, Math.floor((W + STAGE_GAP) / (TILE_MIN + STAGE_GAP)));
  return { counts: planRows(n, Math.ceil(n / perRow)), scale: 1, scroll: true };
}
function layoutGrid() {
  const tiles = $('tiles');
  const ids = stageIds().filter((id) => !state.in.get(id).tile.el.hidden);
  const n = ids.length;
  tiles.classList.add('flow');
  if (!n) return;
  const W = tiles.clientWidth, H = tiles.clientHeight;
  const plan = n === 1 ? null : planGrid(n, W, H);
  tiles.classList.toggle('scroll', !!plan?.scroll);
  const put = (el, x, y, w, h) => Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, gridRow: '', gridColumn: '' });
  if (!plan) return put(state.in.get(ids[0]).tile.el, 0, 0, W, H); // uma só: ocupa tudo
  const rows = plan.counts.map((k) => {
    const w = Math.floor(((W - STAGE_GAP * (k - 1)) / k) * plan.scale);
    return { k, w, h: Math.round(w * 9 / 16) + TILE_BAR };
  });
  const total = rows.reduce((s, r) => s + r.h, 0) + STAGE_GAP * (rows.length - 1);
  let y = plan.scroll ? 0 : Math.max(0, Math.round((H - total) / 2));
  let i = 0;
  for (const r of rows) {
    let x = Math.round((W - (r.w * r.k + STAGE_GAP * (r.k - 1))) / 2);
    for (let c = 0; c < r.k; c++, i++) {
      put(state.in.get(ids[i]).tile.el, x, y, r.w, r.h);
      x += r.w + STAGE_GAP;
    }
    y += r.h + STAGE_GAP;
  }
}
// Divisa do Destaque: fica no vão entre a tela grande e a coluna
function placeSplitter() {
  const split = $('stageSplitter');
  const tiles = $('tiles');
  const main = state.in.get(state.main)?.tile.el;
  split.hidden = !tiles.classList.contains('column') || !main || tiles.hidden;
  if (split.hidden) return;
  tiles.style.setProperty('--stage-side', `${(palco.side * 100).toFixed(1)}%`);
  const area = $('streamArea').getBoundingClientRect(), t = tiles.getBoundingClientRect(), m = main.getBoundingClientRect();
  split.style.left = `${m.right - area.left}px`;
  split.style.top = `${t.top - area.top}px`;
  split.style.height = `${t.height}px`;
  split.setAttribute('aria-valuenow', String(Math.round(palco.side * 100)));
}

// Depois de renderFocus: arruma a grade (ou a divisa) e o seletor de layout
function layoutStage() {
  const tiles = $('tiles');
  const many = state.in.size > 1 && !state.focus;
  $('stageLayout').hidden = !many;
  for (const b of $('stageLayout').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.layout === palco.layout));
  if (!tiles.classList.contains('column')) layoutGrid();
  else { tiles.classList.remove('flow', 'scroll'); for (const [, l] of state.in) Object.assign(l.tile.el.style, { left: '', top: '', width: '', height: '' }); }
  placeSplitter();
}

function moveTile(id, delta) {
  const ids = stageIds(), i = ids.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  renderFocus();
  state.in.get(id)?.tile.el.querySelector('.tile-name').focus();
}

// Troca duas telas: no Destaque, se uma delas é a grande, a outra vira a grande
function swapTiles(a, b) {
  const ids = stageIds(), i = ids.indexOf(a), j = ids.indexOf(b);
  if (i < 0 || j < 0 || a === b) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  if ($('tiles').classList.contains('column') && (state.main === a || state.main === b)) state.main = state.main === a ? b : a;
  renderFocus();
}

// Arrastar pela faixa do nome (os botões dela continuam funcionando normalmente)
function setupTileDrag(id, el) {
  const handle = el.querySelector('.tile-name');
  handle.tabIndex = 0;
  handle.title = 'Arraste para trocar de lugar (ou Alt + setas)';
  handle.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    moveTile(id, delta);
  });
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || state.in.size < 2 || state.focus) return;
    palco.drag = { id, el, x: e.clientX, y: e.clientY, on: false, target: null };
    try { handle.setPointerCapture(e.pointerId); } catch {}
  });
  handle.addEventListener('pointermove', (e) => {
    const d = palco.drag;
    if (!d || d.el !== el) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.on && Math.hypot(dx, dy) < 6) return; // pequeno tremor não é arrasto
    d.on = true;
    el.classList.add('dragging');
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    const under = document.elementsFromPoint(e.clientX, e.clientY).map((x) => x.closest('.tile')).find((t) => t && t !== el && $('tiles').contains(t));
    if (under !== d.target) {
      d.target?.classList.remove('drop-target');
      d.target = under || null;
      d.target?.classList.add('drop-target');
    }
  });
  const end = () => {
    const d = palco.drag;
    if (!d || d.el !== el) return;
    palco.drag = null;
    el.classList.remove('dragging');
    el.style.transform = '';
    d.target?.classList.remove('drop-target');
    if (!d.on) return;
    palco.justDragged = true; // o clique que vem junto com o soltar não conta
    setTimeout(() => { palco.justDragged = false; });
    if (d.target) swapTiles(id, d.target.dataset.person);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function setupStage() {
  for (const b of $('stageLayout').querySelectorAll('button')) {
    // Ícone e texto; com a barra apertada fica só o ícone (fitDock, em navegacao.js)
    const text = b.textContent;
    b.innerHTML = ICON[b.dataset.layout === 'grid' ? 'grid' : 'focus'];
    const label = document.createElement('span');
    label.className = 'dock-label';
    label.textContent = text;
    b.append(label);
    b.setAttribute('aria-label', text);
    b.onclick = () => setStageLayout(b.dataset.layout);
  }
  const split = $('stageSplitter');
  const setSide = (side, keep) => {
    palco.side = Math.min(0.5, Math.max(0.15, side));
    placeSplitter();
    if (keep) save('stageSide', palco.side.toFixed(3));
  };
  split.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    split.setPointerCapture(e.pointerId);
    split.classList.add('active');
  });
  split.addEventListener('pointermove', (e) => {
    if (!split.hasPointerCapture(e.pointerId)) return;
    const t = $('tiles').getBoundingClientRect();
    setSide((t.right - e.clientX - STAGE_GAP / 2) / t.width, false);
  });
  const done = (e) => {
    if (!split.hasPointerCapture(e.pointerId)) return;
    split.releasePointerCapture(e.pointerId);
    split.classList.remove('active');
    setSide(palco.side, true);
  };
  split.addEventListener('pointerup', done);
  split.addEventListener('pointercancel', done);
  split.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: 0.02, ArrowRight: -0.02 }[e.key]; // a coluna fica à direita: seta para a esquerda a alarga
    if (!step) return;
    e.preventDefault();
    setSide(palco.side + step, true);
  });
  // Só reage quando o tamanho muda de verdade (janela, painel lateral); nada roda parado
  new ResizeObserver(() => { if (state.in.size) layoutStage(); }).observe($('tiles'));
}
setupStage();
