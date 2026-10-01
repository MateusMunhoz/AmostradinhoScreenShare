'use strict';
// Céu da voz (estilo em styles-estelar.css): cada canal (Voz geral e cada subsala) é um sol, e quem está nele orbita
// como planeta. Os sóis se espalham meio ao acaso, mas juntinhos: o segundo fica ao lado do primeiro, o terceiro
// fecha um triângulo, e os outros vão encostando no grupo onde couber. A posição de cada sol só depende dos canais
// que vêm antes dele, então criar uma subsala não mexe nas outras. Uma linha fraca liga cada sol ao vizinho mais perto.
//
// Duas visões no painel de voz (Lista | Mapa no topo, salvo neste PC):
//  - Lista: canais e pessoas em lista; o céu fica pequeno em cima, só de enfeite.
//  - Mapa: o céu grande no lugar da lista, fazendo tudo que a lista faz. Clicar num sol abre o canal (Entrar, apagar a
//    subsala e quem está nele, com volume, Assistir e perfil); clicar num planeta abre a pessoa; arrastar um planeta
//    até outro sol leva a pessoa para lá. Nova subsala e quem transmite fora da voz continuam embaixo do mapa.
// O planeta tem data-person, então voz.js acende quem fala junto com a lista.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, voz, membros, subsalas.

const SKY_NS = 'http://www.w3.org/2000/svg';
const SKY_D = 74, SKY_MIN = 64; // distância entre um sol e o vizinho, e a menor permitida entre dois sóis
const SKY_RINGS = [[13], [12, 20], [11, 18.5, 26]]; // raios das órbitas com 1, 2 ou 3 anéis

let voiceView = load('vozVisao', 'lista') === 'mapa' ? 'mapa' : 'lista';
const voiceMapOn = () => voiceView === 'mapa';
let skyPop = null; // o que está aberto no balão do mapa: { kind: 'channel', ch } ou { kind: 'person', id }

function skyHash(text, salt) {
  let h = salt;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  // Mistura final: ids que só mudam no último caractere caíam todos na mesma altura
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
function skyEl(tag, attrs = {}) {
  const el = document.createElementNS(SKY_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Onde fica cada sol. Para cada sol novo: candidatos em volta de cada sol que já existe (a uma distância de vizinho),
// sem encostar em nenhum; fica o mais perto do meio do grupo, com um pouco de acaso (o hash do canal) para não virar
// uma grade. Com 3 canais isso dá um triângulo; depois o grupo cresce para os lados, sem padrão.
function skyLayout(chs) {
  const pts = [];
  for (const ch of chs) {
    if (!pts.length) { pts.push([0, 0]); continue; }
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let best = null;
    pts.forEach(([px, py], j) => {
      for (let k = 0; k < 24; k++) {
        const h = skyHash(`${ch}:${j}:${k}`, 11);
        const a = (k + (h % 1000) / 1000) / 24 * 2 * Math.PI;
        const d = SKY_D * (.96 + ((h >>> 10) % 100) / 100 * .14);
        const x = px + d * Math.cos(a), y = py + d * Math.sin(a);
        if (pts.some(([qx, qy]) => Math.hypot(qx - x, qy - y) < SKY_MIN)) continue;
        const score = Math.hypot(x - mx, y - my) + ((h >>> 20) % 100) / 100 * 16;
        if (!best || score < best[2]) best = [x, y, score];
      }
    });
    pts.push(best ? [best[0], best[1]] : [mx + SKY_D * pts.length, my]);
  }
  return pts;
}

// Os canais e quem está em cada um. Sem subsalas, um sol só (a voz da sala)
function skySystems() {
  const channels = subsalasOn();
  const person = (id) => (id ? { id, name: nameOf(id), sharing: !!state.members.get(id)?.sharing, muted: !!voice.members.get(id)?.muted, deafened: !!voice.members.get(id)?.deafened }
    : { id: state.myId, name: `${getName()} (você)`, sharing: state.sharing, muted: voice.muted, deafened: voice.deafened, me: true });
  return (channels ? ['', ...state.subsalas.map((s) => s.id)] : ['']).map((ch) => ({
    ch, sub: channels && ch ? state.subsalas.find((s) => s.id === ch) : null, name: channels ? channelName(ch) : 'Voz',
    here: !!voice.session && voice.channel === ch, people: voiceIdsIn(ch).map(person),
  }));
}

function renderVoiceSky() {
  const sky = $('voiceSky'), map = voiceMapOn();
  if (voiceDrag) return; // arrastando um planeta: o céu fica parado até soltar
  const systems = skySystems();
  sky.replaceChildren();
  sky.classList.toggle('map', map);
  if (map) sky.removeAttribute('aria-hidden'); else sky.setAttribute('aria-hidden', 'true');
  if (map) { sky.setAttribute('role', 'group'); sky.setAttribute('aria-label', 'Mapa da voz: canais como sóis e quem está neles como planetas'); }
  else { sky.removeAttribute('role'); sky.removeAttribute('aria-label'); }
  const show = map || systems.some((s) => s.people.length);
  sky.toggleAttribute('hidden', !show); // SVG não tem a propriedade hidden
  if (!show) return renderSkyPop();
  const labels = systems.length > 1 || map;
  const outer = (n) => (n ? SKY_RINGS[n <= 3 ? 0 : n <= 8 ? 1 : 2].at(-1) : 9);
  const pts = skyLayout(systems.map((s) => s.ch));
  // Caixa em volta de tudo (órbitas e nomes); na lista, o céu é uma faixa larga e baixa
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  systems.forEach((s, i) => {
    const [x, y] = pts[i], r = Math.max(outer(s.people.length), 13) + (map ? 9 : 6);
    x0 = Math.min(x0, x - r - (labels ? 14 : 0)); x1 = Math.max(x1, x + r + (labels ? 14 : 0));
    y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r + (labels ? 10 : 0) + (map && s.people.length ? 6 : 0));
  });
  let w = x1 - x0, h = y1 - y0;
  const wide = map ? 1.1 : 3.4; // largura mínima em relação à altura
  if (w < h * wide) { x0 -= (h * wide - w) / 2; w = h * wide; }
  sky.setAttribute('viewBox', `${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  // Poeira de fundo: sempre as mesmas estrelinhas, para o céu não mudar a cada redesenho
  const dust = Math.round(Math.min(90, w * h / 900));
  for (let i = 0; i < dust; i++) {
    const hh = skyHash('ceu' + i, 7);
    sky.append(skyEl('circle', { class: 'sky-dust', cx: (x0 + 3 + hh % Math.max(1, w - 6)).toFixed(1), cy: (y0 + 3 + (hh >>> 9) % Math.max(1, h - 6)).toFixed(1), r: (hh >>> 17) % 3 ? .5 : .9 }));
  }
  // Linha fraca de cada sol até o vizinho mais perto entre os que vieram antes, de borda a borda
  for (let i = 1; i < pts.length; i++) {
    const [x2, y2] = pts[i];
    const [x1b, y1b] = pts.slice(0, i).reduce((a, b) => (Math.hypot(b[0] - x2, b[1] - y2) < Math.hypot(a[0] - x2, a[1] - y2) ? b : a));
    const d = Math.hypot(x2 - x1b, y2 - y1b), gap = 9;
    const [ux, uy] = [(x2 - x1b) / d, (y2 - y1b) / d];
    sky.append(skyEl('line', { class: 'sky-link sky-bridge', x1: x1b + ux * gap, y1: y1b + uy * gap, x2: x2 - ux * gap, y2: y2 - uy * gap }));
  }
  const now = performance.now() / 1000; // a órbita continua de onde estava quando o céu é redesenhado
  systems.forEach((s, i) => drawSkySystem(sky, s, pts[i], { map, labels, now, outer: outer(s.people.length) }));
  renderSkyPop();
}

function drawSkySystem(sky, { ch, name, here, people }, [sx, sy], { map, labels, now, outer }) {
  // No mapa, a área em volta do sol inteira recebe o clique e o planeta arrastado
  if (map) {
    const hit = skyEl('circle', { class: 'sky-hit', cx: sx, cy: sy, r: Math.max(outer, 13) + 7 });
    hit.dataset.channel = ch;
    hit.onclick = (e) => openSkyPop({ kind: 'channel', ch }, e);
    sky.append(hit);
  }
  const radii = people.length ? SKY_RINGS[people.length <= 3 ? 0 : people.length <= 8 ? 1 : 2] : [];
  radii.forEach((radius, r) => {
    const onRing = people.filter((_, j) => j % radii.length === r);
    if (!onRing.length) return;
    sky.append(skyEl('circle', { class: 'sky-path', cx: sx, cy: sy, r: radius }));
    const period = 50 + r * 30, delay = `-${(now % period).toFixed(2)}s`;
    const ring = skyEl('g', { class: 'sky-ring', style: `transform-origin: ${sx}px ${sy}px; animation-duration: ${period}s; animation-delay: ${delay}` });
    const base = (skyHash(ch + ':' + r, 5) % 360) * Math.PI / 180;
    onRing.forEach((p, k) => {
      const a = base + 2 * Math.PI * k / onRing.length;
      ring.append(skyPlanet(p, ch, sx + radius * Math.cos(a), sy + radius * Math.sin(a), { map, period, delay }));
    });
    sky.append(ring);
  });
  const sun = skyEl('g', { class: 'sky-sun' + (here ? ' here' : '') + (people.length ? '' : ' empty'), transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` });
  sun.dataset.channel = ch;
  sun.append(skyEl('circle', { class: 'sky-corona', r: 6 }), skyEl('circle', { class: 'sky-sun-core', r: 3.6 }));
  const count = people.length === 1 ? '1 pessoa' : `${people.length} pessoas`;
  const title = skyEl('title');
  title.textContent = `${name} · ${count}`;
  sun.append(title);
  if (map) {
    sun.setAttribute('tabindex', '0');
    sun.setAttribute('role', 'button');
    sun.setAttribute('aria-label', `${name}, ${count}${here ? ', você está aqui' : ''}`);
    sun.onclick = (e) => openSkyPop({ kind: 'channel', ch }, e);
    sun.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSkyPop({ kind: 'channel', ch }, sun); } };
  }
  sky.append(sun);
  if (labels) {
    // No mapa, o nome do canal fica mais para baixo quando tem planeta (o nome da pessoa vai embaixo dela)
    const below = Math.max(outer, 13) + (map && people.length ? 15 : 9);
    const label = skyEl('text', { class: 'sky-label' + (here ? ' here' : ''), x: sx.toFixed(1), y: (sy + below).toFixed(1) });
    label.textContent = name;
    sky.append(label);
  }
}

// Um planeta: a pessoa. Gira com o anel; no mapa, o nome vai junto, de pé (gira para o outro lado na mesma velocidade)
function skyPlanet(p, ch, x, y, { map, period, delay }) {
  const g = skyEl('g', { class: 'sky-star' + (p.sharing ? ' live' : '') + (p.muted ? ' muted' : '') + (p.deafened ? ' deafened' : ''), transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
  g.dataset.person = p.id;
  g.classList.toggle('speaking', speaking.has(p.id));
  const up = skyEl('g', { class: 'sky-upright', style: `animation-duration: ${period}s; animation-delay: ${delay}` });
  if (map) up.append(skyEl('circle', { class: 'sky-phit', r: 7 }));
  if (p.sharing) up.append(skyEl('circle', { class: 'sky-orbit', r: 5.5 }));
  if (p.deafened) up.append(skyEl('circle', { class: 'sky-deaf', r: 4 }));
  up.append(skyEl('circle', { class: 'sky-halo', r: 4.5 }), skyEl('circle', { class: 'sky-core', r: p.me ? 2.4 : 1.9 }));
  const status = [p.muted && 'microfone desligado', p.deafened && 'fone silenciado', p.sharing && 'transmitindo'].filter(Boolean).join(', ');
  const title = skyEl('title');
  title.textContent = p.name + (status ? ` (${status})` : '');
  up.append(title);
  if (map) {
    const label = skyEl('text', { class: 'sky-pname', y: 9 });
    label.textContent = p.me ? getName() : p.name;
    up.append(label);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', title.textContent);
    g.onpointerdown = (e) => skyPointerDown(e, g, p, ch);
    g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSkyPop({ kind: 'person', id: p.id }, g); } };
  }
  g.append(up);
  return g;
}

// ---------- Arrastar um planeta até outro sol ----------
// Ponteiro em vez do arrastar do HTML (que não vale para desenhos SVG). Sem mexer (menos de 5px), é um clique e abre
// a pessoa. Usa voiceDrag de subsalas.js, então nada é redesenhado enquanto ela está sendo arrastada.
function skyPointerDown(e, g, p, from) {
  if (e.button !== 0) return;
  e.preventDefault();
  const id = p.me ? null : p.id, sky = $('voiceSky'), start = [e.clientX, e.clientY];
  let ghost = null, target = null;
  try { g.setPointerCapture(e.pointerId); } catch {}
  const mark = (ch) => { for (const el of sky.querySelectorAll('.sky-sun')) el.classList.toggle('drop-target', el.dataset.channel === ch); };
  const move = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 5 || !canDragVoice(id)) return;
      voiceDrag = { id, from };
      closeSkyPop();
      ghost = document.createElement('div');
      ghost.className = 'sky-ghost';
      ghost.textContent = p.me ? getName() : p.name;
      document.body.append(ghost);
      // "fixed" aqui conta a partir do body (que desce pela barra de título): mede o 0 de verdade e desconta
      ghost.style.left = ghost.style.top = '0px';
      const o = ghost.getBoundingClientRect();
      ghost.origin = [o.left - 12, o.top - 10]; // sem o deslocamento (translate) do CSS
      sky.classList.add('dragging');
      g.classList.add('dragging');
    }
    ghost.style.left = `${ev.clientX - ghost.origin[0]}px`;
    ghost.style.top = `${ev.clientY - ghost.origin[1]}px`;
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-channel]');
    target = over && sky.contains(over) && over.dataset.channel !== from ? over.dataset.channel : null;
    mark(target);
  };
  const done = (ev, cancel) => {
    g.removeEventListener('pointermove', move);
    g.removeEventListener('pointerup', up);
    g.removeEventListener('pointercancel', cancelled);
    if (!ghost) { if (!cancel) openSkyPop({ kind: 'person', id: p.id }, ev); return; }
    ghost.remove();
    sky.classList.remove('dragging');
    mark(null);
    const ch = cancel ? null : target;
    voiceDragPending = true; // redesenha ao soltar: o planeta volta ao lugar (ou vai para o outro sol)
    endVoiceDrag();
    if (ch !== null) moveVoiceTo(id, ch);
  };
  const up = (ev) => done(ev, false), cancelled = (ev) => done(ev, true);
  g.addEventListener('pointermove', move);
  g.addEventListener('pointerup', up);
  g.addEventListener('pointercancel', cancelled);
}

// ---------- Balão do mapa: o canal ou a pessoa, com os mesmos controles da lista ----------
// at: o evento do clique (abre onde clicou) ou o elemento (pelo teclado, abre embaixo dele)
function openSkyPop(what, at) {
  if (voiceDrag) return;
  if (skyPop && skyPop.kind === what.kind && skyPop.ch === what.ch && skyPop.id === what.id && !$('voiceMapPop').hidden) return closeSkyPop();
  skyPop = what;
  const r = at.getBoundingClientRect?.();
  const [x, y] = r ? [r.left + r.width / 2, r.bottom] : [at.clientX, at.clientY];
  renderSkyPop();
  placeSkyPop(x, y);
  if (!r) return;
  $('voiceMapPop').querySelector('button, [tabindex="0"]')?.focus();
}
function closeSkyPop() {
  skyPop = null;
  $('voiceMapPop').hidden = true;
}
function placeSkyPop(x, y) {
  const pop = $('voiceMapPop'), pane = $('voicePane').getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.min(Math.max(8, x - pane.left - w / 2), pane.width - w - 8);
  const below = y - pane.top + 10;
  const top = below + h < pane.height - 8 ? below : Math.max(8, y - pane.top - h - 10);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}
// Redesenha o balão aberto (a voz mudou); fecha se o que ele mostra não existe mais
function renderSkyPop() {
  const pop = $('voiceMapPop');
  if (!skyPop || !voiceMapOn() || $('voiceSky').hasAttribute('hidden')) return closeSkyPop();
  const list = pop.querySelector('.members');
  list.replaceChildren();
  if (skyPop.kind === 'channel') {
    const sub = skyPop.ch ? state.subsalas?.find((s) => s.id === skyPop.ch) : null;
    if (skyPop.ch && !sub) return closeSkyPop();
    const head = channelHead(skyPop.ch, sub);
    if (!subsalasOn()) head.querySelector('strong').textContent = 'Voz';
    list.append(head);
    const ids = voiceIdsIn(skyPop.ch);
    for (const id of ids) list.append(voiceRow(id));
    if (!ids.length) {
      const empty = document.createElement('li');
      empty.className = 'hint voice-map-empty';
      empty.textContent = 'Ninguém aqui ainda.';
      list.append(empty);
    }
  } else {
    const id = skyPop.id === state.myId ? null : skyPop.id;
    if (!inVoice(skyPop.id) || (id && !state.members.has(id))) return closeSkyPop();
    list.append(voiceRow(id));
    const where = document.createElement('li');
    where.className = 'hint voice-map-where';
    where.textContent = (subsalasOn() ? `Em ${channelName(voiceChannelOf(id))}. ` : '')
      + (subsalasOn() && canDragVoice(id) ? 'Arraste o planeta até outro sol para mudar de canal.' : '');
    if (where.textContent) list.append(where);
  }
  pop.hidden = false;
}

function setVoiceView(view) {
  voiceView = view === 'mapa' ? 'mapa' : 'lista';
  save('vozVisao', voiceView);
  closeSkyPop();
  syncVoiceViewButtons();
  renderVoicePane();
}
function syncVoiceViewButtons() {
  $('voiceViewList').setAttribute('aria-pressed', String(!voiceMapOn()));
  $('voiceViewMap').setAttribute('aria-pressed', String(voiceMapOn()));
}

$('voiceViewList').onclick = () => setVoiceView('lista');
$('voiceViewMap').onclick = () => setVoiceView('mapa');
syncVoiceViewButtons();
// Clicar fora do balão fecha; no mapa, só o fundo (sol e planeta abrem o balão deles). O cartão de volume e o perfil
// que o balão abre não fecham o balão
document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  if ($('voiceMapPop').hidden || t.closest?.('#voiceMapPop, #personCard, #profilePane, #voiceSky [data-channel], #voiceSky .sky-star')) return;
  closeSkyPop();
});
