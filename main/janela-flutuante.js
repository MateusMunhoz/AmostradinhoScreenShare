// Janelas flutuantes (picture in picture): posição e tamanho de cada vaga, arrumação em fila, transparência,
// modo de ajuste. Usa o estado dividido (contexto.js) e os atalhos, que ficam ligados enquanto há janela.
const { app, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { janelas, sendMain } = require('./contexto');

// ---------- Janela flutuante (picture in picture) ----------
// Cada transmissão pode ir para a sua janela pequena, sempre por cima (inclusive de jogo em tela cheia sem
// bordas). Travadas, o mouse passa por elas (o clique vai para o jogo) e elas nunca pegam o foco. No modo de
// ajuste dá para arrastar e redimensionar. Ctrl+Shift+E troca todas entre os dois, de dentro do jogo.
// Cada vaga (1ª, 2ª, 3ª janela aberta...) lembra a própria posição, tamanho e transparência.
const pips = new Map(); // id da transmissão -> { win, slot, opacity }
const pipFile = () => path.join(app.getPath('userData'), 'janela-flutuante.json');

// Arquivo: { slots: [{ x, y, width, height, opacity }, ...], group }. O formato antigo (uma janela só) vira a vaga 0.
// group: linked = todas do mesmo tamanho (mexer numa muda todas e reorganiza); layout 'coluna' ou 'linha';
// corner = canto da tela onde a fila começa (tl, tr, bl, br).
function readPipFile() {
  try {
    const data = JSON.parse(fs.readFileSync(pipFile(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}
let pipSlots = null;
const slots = () => (pipSlots ??= (() => { const d = readPipFile(); return Array.isArray(d.slots) ? d.slots : d.width ? [d] : []; })());
let pipGroup = null;
const group = () => (pipGroup ??= (() => {
  const g = readPipFile().group || {};
  return {
    linked: !!g.linked,
    layout: g.layout === 'linha' ? 'linha' : 'coluna',
    corner: ['tl', 'tr', 'bl', 'br'].includes(g.corner) ? g.corner : 'br',
  };
})());

// Última posição e tamanho da vaga, se ainda couber numa das telas; senão, empilhadas a partir do canto de
// baixo à direita (subindo, e depois numa coluna mais à esquerda)
function pipBounds(slot) {
  const b = slots()[slot];
  const ok = b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) && b.width >= 192 && b.height >= 108;
  const visible = ok && screen.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width - 40 && b.x + b.width > w.x + 40 && b.y < w.y + w.height - 40 && b.y + b.height > w.y + 40);
  if (visible) return { x: b.x, y: b.y, width: b.width, height: b.height };
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 480, height = 270, gap = 12;
  const perCol = Math.max(1, Math.floor((wa.height - 24) / (height + gap)));
  const col = Math.floor(slot / perCol), row = slot % perCol;
  return {
    width, height,
    x: Math.max(wa.x, wa.x + wa.width - 24 - width - col * (width + gap)),
    y: wa.y + wa.height - 24 - height - row * (height + gap),
  };
}

function freeSlot() {
  const used = new Set([...pips.values()].map((p) => p.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  return slot;
}

const livePip = (id) => { const p = pips.get(String(id)); return p && !p.win.isDestroyed() ? p : null; };

// Tamanhos rápidos (P, M, G) mantendo o canto de baixo à direita no lugar
const PIP_SIZES = { P: 320, M: 480, G: 640 };
function setPipSize(id, key) {
  const p = livePip(id);
  if (!p || !PIP_SIZES[key]) return;
  const b = p.win.getBounds();
  const width = PIP_SIZES[key];
  const height = Math.round(width * 9 / 16);
  markArranging();
  p.win.setBounds({ x: b.x + b.width - width, y: b.y + b.height - height, width, height });
  if (group().linked) arrangePips(id);
}

// Mudanças feitas pelo app (não pelo mouse) não disparam uma nova arrumação
let arrangingUntil = 0;
const markArranging = () => { arrangingUntil = Date.now() + 500; };

// Enfileira as janelas a partir do canto escolhido, em coluna ou em linha, sem uma cobrir a outra.
// Quando a fila não cabe na tela, continua numa coluna (ou linha) ao lado. Com "todas do mesmo tamanho",
// todas ficam do tamanho da janela que você mexeu.
function arrangePips(anchorId) {
  const list = [...pips.values()].filter((p) => !p.win.isDestroyed()).sort((a, b) => a.slot - b.slot);
  if (!list.length) return;
  const anchor = livePip(anchorId) || list[0];
  const g = group();
  const ab = anchor.win.getBounds();
  const wa = screen.getDisplayMatching(ab).workArea;
  const margin = 24, gap = 12;
  const right = g.corner.endsWith('r'), bottom = g.corner.startsWith('b');
  let along = 0, across = 0, acrossMax = 0;
  markArranging();
  for (const p of list) {
    const own = p.win.getBounds();
    const w = g.linked ? ab.width : own.width;
    const h = g.linked ? ab.height : own.height;
    let dx, dy;
    if (g.layout === 'coluna') {
      if (along > 0 && along + h > wa.height - 2 * margin) { across += acrossMax + gap; along = 0; acrossMax = 0; }
      dx = across; dy = along; along += h + gap; acrossMax = Math.max(acrossMax, w);
    } else {
      if (along > 0 && along + w > wa.width - 2 * margin) { across += acrossMax + gap; along = 0; acrossMax = 0; }
      dx = along; dy = across; along += w + gap; acrossMax = Math.max(acrossMax, h);
    }
    p.win.setBounds({
      width: w, height: h,
      x: right ? wa.x + wa.width - margin - w - dx : wa.x + margin + dx,
      y: bottom ? wa.y + wa.height - margin - h - dy : wa.y + margin + dy,
    });
  }
  for (const p of list) savePip(p);
}

function setPipGroup(id, patch) {
  const g = group();
  if (patch && typeof patch === 'object') {
    if (typeof patch.linked === 'boolean') g.linked = patch.linked;
    if (patch.layout === 'coluna' || patch.layout === 'linha') g.layout = patch.layout;
    if (['tl', 'tr', 'bl', 'br'].includes(patch.corner)) g.corner = patch.corner;
  }
  // Ligar "mesmo tamanho" ou escolher arrumação/canto já arruma na hora
  if (patch && (patch.linked === true || patch.layout || patch.corner)) arrangePips(id);
  else savePipFile();
  sendMain({ type: 'group', group: g });
}

function setPipOpacity(id, v) {
  const p = livePip(id);
  if (!p) return;
  p.opacity = Math.min(1, Math.max(0.4, Number(v) || 1));
  p.win.setOpacity(p.opacity);
  savePip(p);
}

function savePip(p) {
  if (p.win.isDestroyed()) return;
  const list = slots();
  list[p.slot] = { ...p.win.getBounds(), opacity: p.opacity };
  for (let i = 0; i < list.length; i++) list[i] ??= {};
  savePipFile();
}

let pipSaveTimer = null;
function savePipFile() {
  clearTimeout(pipSaveTimer);
  pipSaveTimer = setTimeout(() => fs.writeFile(pipFile(), JSON.stringify({ slots: slots(), group: group() }), () => {}), 50);
}

function pipOpacities() {
  const out = {};
  for (const [id, p] of pips) out[id] = p.opacity;
  return out;
}

function setPipEdit(on) {
  janelas.pipEdit = !!on;
  for (const p of pips.values()) {
    if (!p.win.isDestroyed()) p.win.setIgnoreMouseEvents(!janelas.pipEdit); // travada: o clique atravessa
  }
  // O chat por cima do jogo entra e sai do modo de ajuste junto; só nele recebe o teclado (para responder)
  if (janelas.chat && !janelas.chat.isDestroyed()) {
    janelas.chat.setIgnoreMouseEvents(!janelas.pipEdit && !janelas.chatCompose);
    janelas.chat.setFocusable(janelas.pipEdit || janelas.chatCompose);
  }
  sendMain({ type: 'edit', on: janelas.pipEdit, opacity: pipOpacities(), group: group() });
}

function setupPip(child, id, slot) {
  const saved = slots()[slot];
  const p = { win: child, slot, opacity: Math.min(1, Math.max(0.4, Number(saved && saved.opacity) || 1)) };
  pips.set(id, p);
  child.setAlwaysOnTop(true, 'screen-saver');
  child.setAspectRatio(16 / 9);
  child.setOpacity(p.opacity);
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePip(p), 400);
  };
  child.on('moved', save);
  child.on('resized', () => {
    save();
    // Com "todas do mesmo tamanho", redimensionar uma com o mouse muda todas e reorganiza a fila
    if (group().linked && Date.now() > arrangingUntil) arrangePips(id);
  });
  // Nova janela com "todas do mesmo tamanho": entra na fila com o tamanho das outras
  if (group().linked && pips.size > 1) {
    const other = [...pips.values()].find((o) => o !== p && !o.win.isDestroyed());
    if (other) arrangePips([...pips].find(([, o]) => o === other)[0]);
  }
  syncShortcuts();
  child.on('closed', () => {
    if (pips.get(id) === p) pips.delete(id);
    syncShortcuts();
    sendMain({ type: 'closed', id });
  });
  setPipEdit(true); // abre no modo de ajuste (todas juntas): posicione e trave
}

// Exportado antes dos require de baixo: atalhos.js e chat-jogo.js também usam este arquivo (um usa o outro)
Object.assign(module.exports, { pips, livePip, freeSlot, pipBounds, setPipSize, setPipGroup, setPipOpacity, setPipEdit, setupPip });
const { syncShortcuts } = require('./atalhos');
