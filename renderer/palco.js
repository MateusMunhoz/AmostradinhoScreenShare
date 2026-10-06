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
  tileMin: 240, // largura mínima de uma tela na grade; abaixo disso, as que sobram vão para a faixa de baixo
  strip: [], stripX: 0, stripMax: 0, stripStep: 0, stripView: 0, stripContent: 0, // faixa de baixo (rola)
};
const STAGE_GAP = 12, TILE_BAR = 42; // TILE_BAR: altura da faixa do nome (.tile-name em styles.css)

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
// Escolhe quantas linhas cobrem mais área sem nenhuma tela ficar estreita demais (palco.tileMin). Se nem
// assim couber, devolve scroll: true (layoutGrid manda as que sobram para a faixa de baixo).
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
    if (widths[widths.length - 1] * scale < palco.tileMin) continue;
    if (!best || area > best.area) best = { counts, scale, area, scroll: false };
  }
  if (best) return best;
  const perRow = Math.max(1, Math.floor((W + STAGE_GAP) / (palco.tileMin + STAGE_GAP)));
  return { counts: planRows(n, Math.ceil(n / perRow)), scale: 1, scroll: true };
}
// Faixa de baixo: quando nem todas cabem na grade sem ficar estreitas demais, as primeiras ficam na grade e
// as outras numa faixa embaixo, que rola para os lados (barra no tema, ‹ ›, rolagem lateral do touchpad ou
// Shift + roda). Quantas vão para a grade depende do tamanho da janela: tudo se refaz ao redimensionar.
function stripHeight(H) { return Math.round(Math.min(170, Math.max(110, H * 0.22))); }
function layoutGrid() {
  const tiles = $('tiles');
  const ids = stageIds().filter((id) => !state.in.get(id).tile.el.hidden);
  const n = ids.length;
  tiles.classList.add('flow');
  palco.strip = [];
  if (!n) return renderStripBar();
  const W = tiles.clientWidth, H = tiles.clientHeight;
  const put = (el, x, y, w, h) => Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, gridRow: '', gridColumn: '' });
  if (n === 1) { put(state.in.get(ids[0]).tile.el, 0, 0, W, H); return renderStripBar(); } // uma só: ocupa tudo
  let plan = planGrid(n, W, H), gridIds = ids, gridH = H;
  if (plan.scroll) {
    // A faixa ocupa a parte de baixo; na grade ficam quantas couberem acima dela
    gridH = H - stripHeight(H) - STAGE_GAP;
    let m = n - 1;
    while (m > 1 && planGrid(m, W, gridH).scroll) m--;
    gridIds = ids.slice(0, m);
    palco.strip = ids.slice(m);
    plan = m === 1 ? null : planGrid(m, W, gridH);
  }
  if (!plan) put(state.in.get(gridIds[0]).tile.el, 0, 0, W, gridH);
  else {
    const rows = plan.counts.map((k) => {
      const w = Math.floor(((W - STAGE_GAP * (k - 1)) / k) * plan.scale);
      return { k, w, h: Math.round(w * 9 / 16) + TILE_BAR };
    });
    const total = rows.reduce((s, r) => s + r.h, 0) + STAGE_GAP * (rows.length - 1);
    let y = Math.max(0, Math.round((gridH - total) / 2)), i = 0;
    for (const r of rows) {
      let x = Math.round((W - (r.w * r.k + STAGE_GAP * (r.k - 1))) / 2);
      for (let c = 0; c < r.k; c++, i++) {
        put(state.in.get(gridIds[i]).tile.el, x, y, r.w, r.h);
        x += r.w + STAGE_GAP;
      }
      y += r.h + STAGE_GAP;
    }
  }
  placeStrip();
}
// Telas da faixa: mesma altura, lado a lado, deslocadas por palco.stripX; se todas cabem, ficam centralizadas
function placeStrip() {
  const tiles = $('tiles'), W = tiles.clientWidth, H = tiles.clientHeight;
  if (!palco.strip.length) return renderStripBar();
  const S = stripHeight(H), h = S - 18, w = Math.round((h - TILE_BAR) * 16 / 9);
  const content = palco.strip.length * w + STAGE_GAP * (palco.strip.length - 1);
  palco.stripMax = Math.max(0, content - W);
  palco.stripX = Math.min(palco.stripMax, Math.max(0, palco.stripX));
  const x0 = palco.stripMax ? -palco.stripX : Math.round((W - content) / 2);
  palco.strip.forEach((id, i) => Object.assign(state.in.get(id).tile.el.style, {
    left: `${x0 + i * (w + STAGE_GAP)}px`, top: `${H - S}px`, width: `${w}px`, height: `${h}px`,
  }));
  Object.assign(palco, { stripStep: w + STAGE_GAP, stripView: W, stripContent: content });
  renderStripBar();
}
function scrollStrip(dx) {
  if (!palco.strip.length) return;
  palco.stripX = Math.min(palco.stripMax, Math.max(0, palco.stripX + dx));
  placeStrip();
}
// Barra de rolagem da faixa, logo abaixo dela: ‹, trilho com alça arrastável e ›
function renderStripBar() {
  const bar = $('stageScroll'), tiles = $('tiles');
  const on = palco.strip.length > 0 && palco.stripMax > 0 && !tiles.hidden && !tiles.classList.contains('column');
  bar.hidden = !on;
  if (!on) return;
  const area = $('streamArea').getBoundingClientRect(), t = tiles.getBoundingClientRect();
  Object.assign(bar.style, { left: `${t.left - area.left}px`, width: `${t.width}px`, top: `${t.bottom - area.top - 16}px` });
  const track = bar.querySelector('.stage-scroll-track'), thumb = bar.querySelector('.stage-scroll-thumb');
  const tw = track.clientWidth, size = Math.max(32, tw * palco.stripView / palco.stripContent);
  thumb.style.width = `${size}px`;
  thumb.style.left = `${(tw - size) * (palco.stripX / palco.stripMax)}px`;
  bar.querySelector('[data-dir="-1"]').disabled = palco.stripX <= 0;
  bar.querySelector('[data-dir="1"]').disabled = palco.stripX >= palco.stripMax;
  track.setAttribute('aria-valuenow', String(Math.round(100 * palco.stripX / palco.stripMax)));
}
function setupStrip() {
  const bar = $('stageScroll'), track = bar.querySelector('.stage-scroll-track'), thumb = bar.querySelector('.stage-scroll-thumb');
  for (const b of bar.querySelectorAll('button')) b.onclick = () => scrollStrip(Number(b.dataset.dir) * palco.stripStep);
  let grab = null;
  thumb.addEventListener('pointerdown', (e) => { grab = { x: e.clientX, start: palco.stripX }; try { thumb.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); });
  thumb.addEventListener('pointermove', (e) => {
    if (!grab) return;
    const free = track.clientWidth - thumb.offsetWidth;
    if (free > 0) { palco.stripX = grab.start + (e.clientX - grab.x) * palco.stripMax / free; placeStrip(); }
  });
  const drop = () => { grab = null; };
  thumb.addEventListener('pointerup', drop);
  thumb.addEventListener('pointercancel', drop);
  // Clicar no trilho, fora da alça, anda quase uma página
  track.addEventListener('pointerdown', (e) => {
    if (e.target !== track) return;
    scrollStrip((e.clientX < thumb.getBoundingClientRect().left ? -1 : 1) * palco.stripView * 0.8);
  });
  track.addEventListener('keydown', (e) => {
    const dx = { ArrowLeft: -palco.stripStep, ArrowRight: palco.stripStep, PageUp: -palco.stripView, PageDown: palco.stripView, Home: -palco.stripMax, End: palco.stripMax }[e.key];
    if (dx === undefined) return;
    e.preventDefault();
    scrollStrip(dx);
  });
  // A roda em cima de uma tela muda o volume; na faixa, a rolagem lateral (touchpad ou Shift + roda) anda nela
  $('tiles').addEventListener('wheel', (e) => {
    if (!palco.stripMax) return;
    const onStrip = palco.strip.some((id) => state.in.get(id)?.tile.el.contains(e.target));
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    if (!onStrip || !dx) return;
    e.preventDefault();
    e.stopPropagation();
    scrollStrip(dx);
  }, { capture: true, passive: false });
  bar.addEventListener('wheel', (e) => { e.preventDefault(); scrollStrip(e.deltaX || e.deltaY); }, { passive: false });
  // Tab até uma tela da faixa fora da vista: a faixa rola até ela
  $('tiles').addEventListener('focusin', (e) => {
    const i = palco.strip.findIndex((id) => state.in.get(id)?.tile.el.contains(e.target));
    if (i < 0) return;
    const left = i * palco.stripStep, right = left + palco.stripStep - STAGE_GAP;
    if (left < palco.stripX) scrollStrip(left - palco.stripX);
    else if (right > palco.stripX + palco.stripView) scrollStrip(right - palco.stripX - palco.stripView);
  });
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
  else {
    tiles.classList.remove('flow');
    palco.strip = [];
    renderStripBar();
    for (const [, l] of state.in) Object.assign(l.tile.el.style, { left: '', top: '', width: '', height: '' });
  }
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

// Mouse parado em cima da tela (ou fora dela): a faixa do nome e os controles da música somem (.ui-idle, CSS);
// mexer o mouse traz de volta. Com o mouse em cima de uma das faixas, elas ficam
const TILE_IDLE_MS = 2500;
// O mouse está em cima da pílula da sala, ou perto dela (a área é a da pílula mesmo escondida, mais uma folga)
function pointerNearDock(x, y, slack = 28) {
  const dock = document.getElementById('dock') || document.querySelector('.dock');
  if (!dock) return false;
  const r = dock.getBoundingClientRect();
  return x >= r.left - slack && x <= r.right + slack && y >= r.top - slack && y <= r.bottom + slack;
}
function setupTileIdle(el) {
  let timer = 0, x = 0, y = 0;
  // Pela posição do mouse (escondida, a faixa não recebe o mouse, então :hover não serve)
  const overBar = () => [...el.querySelectorAll('.tile-name, .music-controls')].some((b) => {
    const r = b.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  const idle = () => { if (!overBar()) el.classList.add('ui-idle'); };
  el.classList.add('ui-idle');
  el.addEventListener('pointermove', (e) => {
    x = e.clientX; y = e.clientY;
    el.classList.remove('ui-idle');
    clearTimeout(timer);
    timer = setTimeout(idle, TILE_IDLE_MS);
  });
  // Indo para a pílula da sala (que fica por cima das telas), a tela continua à vista: as duas somem juntas depois
  // Ir da tela até a pílula passa por um vão (a faixa 'Em pausa', a borda da grade): a pílula, escondida, não recebe
  // o mouse, então o destino se descobre pela posição (pointerNearDock) e as duas ficam à vista
  el.addEventListener('pointerleave', (e) => {
    clearTimeout(timer);
    if (e.relatedTarget?.closest?.('.dock') || pointerNearDock(e.clientX, e.clientY)) {
      timer = setTimeout(idle, TILE_IDLE_MS);
      return;
    }
    el.classList.add('ui-idle');
  });
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
    if (e.button !== 0 || e.target.closest('button, input, [data-profile]') || state.in.size < 2 || state.focus) return; // botões e o volume da faixa não arrastam
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
  setupStrip();
  setIcon($('stageScroll').querySelector('[data-dir="-1"]'), 'prev', 'Telas anteriores');
  setIcon($('stageScroll').querySelector('[data-dir="1"]'), 'next', 'Mais telas');
}
setupStage();
