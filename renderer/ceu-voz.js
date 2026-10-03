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
//    O mapa ocupa o painel todo (os sóis se espalham conforme o formato dele), e dá para aproximar e afastar (roda do
//    mouse ou + e −) e andar arrastando o fundo: no mais perto cabe um sistema inteiro; no mais longe, todos.
// O planeta tem data-person, então voz.js acende quem fala junto com a lista.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, voz, membros, subsalas.

const SKY_NS = 'http://www.w3.org/2000/svg';
// D: distância entre um sol e o vizinho; MIN: a menor permitida entre dois sóis; rings: raios das órbitas com 1, 2 ou
// 3 anéis. No mapa tudo é mais espaçado, para o nome de cada planeta caber sem cair em cima do sol.
const SKY_GEO = {
  lista: { D: 74, MIN: 64, rings: [[13], [12, 20], [11, 18.5, 26]] },
  mapa: { D: 112, MIN: 100, rings: [[18], [17, 30], [16, 29, 42]] },
};
const skyRadii = (n, geo) => (n ? geo.rings[n <= 3 ? 0 : n <= 8 ? 1 : 2] : []);
// Zoom do mapa: o mais perto mostra um sistema inteiro (a maior órbita, os nomes e uma folga); o mais longe, todos
const SKY_SPAN = 2 * (SKY_GEO.mapa.rings[2][2] + 26);
// Ver tudo não aproxima mais que isto (unidades do desenho por pixel): com pouca gente, planetas e nomes ficam no
// tamanho de sempre (nome ~11 px) em vez de crescer até encher o mapa; a roda do mouse e o + aproximam mais
const SKY_FIT_MIN_U = 0.46;
// A câmera do mapa: centro (x, y) e u = unidades do desenho por pixel. auto: mostrando tudo (acompanha quando muda)
const skyCam = { x: 0, y: 0, u: 0, auto: true, box: null, uIn: 0, uFit: 0 };

let voiceView = load('vozVisao', 'lista') === 'mapa' ? 'mapa' : 'lista';
const voiceMapOn = () => voiceView === 'mapa';
let skyPop = null; // o que está aberto no balão do mapa: { kind: 'channel', ch } ou { kind: 'person', id }
const mapFocus = { on: false, timer: 0, blocked: false, pinned: false }; // o mapa ocupando a barra da direita (setMapFocus)
let skyFocusId = null; // perfil aberto no mapa (renderSkyProfile); state.myId = você
let skyFocusKey = '';

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
  // style pelo CSSOM: o atributo style escrito como texto é barrado pela CSP do app (style-src 'self')
  for (const [k, v] of Object.entries(attrs)) { if (k === 'style') el.style.cssText = v; else el.setAttribute(k, v); }
  return el;
}

// Onde fica cada sol. Para cada sol novo: candidatos em volta de cada sol que já existe (a uma distância de vizinho),
// sem encostar em nenhum; fica o mais perto do meio do grupo, com um pouco de acaso (o hash do canal) para não virar
// uma grade. Com 3 canais isso dá um triângulo; depois o grupo cresce para os lados, sem padrão.
// aspect: largura/altura do espaço; num espaço alto, o grupo cresce mais para cima e para baixo (e vice-versa).
function skyLayout(chs, { D, MIN }, aspect = 1) {
  const stretch = Math.min(2.5, Math.max(.4, aspect)) ** .3;
  const pts = [];
  for (const ch of chs) {
    if (!pts.length) { pts.push([0, 0]); continue; }
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let best = null;
    pts.forEach(([px, py], j) => {
      for (let k = 0; k < 24; k++) {
        const h = skyHash(`${ch}:${j}:${k}`, 11);
        const a = (k + (h % 1000) / 1000) / 24 * 2 * Math.PI;
        const d = D * (.96 + ((h >>> 10) % 100) / 100 * .14);
        const x = px + d * Math.cos(a), y = py + d * Math.sin(a);
        if (pts.some(([qx, qy]) => Math.hypot(qx - x, qy - y) < MIN)) continue;
        const st = pts.length === 2 ? 1 : stretch; // o terceiro sempre fecha o triângulo, em qualquer formato
        const score = Math.hypot((x - mx) / st, (y - my) * st) + ((h >>> 20) % 100) / 100 * 16;
        if (!best || score < best[2]) best = [x, y, score];
      }
    });
    pts.push(best ? [best[0], best[1]] : [mx + D * pts.length, my]);
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
    here: !!voice.session && voice.channel === ch, people: voiceIdsIn(ch).map(person), music: !!state.musicas?.get(ch),
  }));
}

function renderVoiceSky() {
  const sky = $('voiceSky'), box = $('voiceSkyBox'), map = voiceMapOn(), geo = SKY_GEO[map ? 'mapa' : 'lista'];
  if (voiceDrag) return; // arrastando um planeta: o céu fica parado até soltar
  if (!map && document.body.classList.contains('app-blurred')) { skyStale = true; return; } // fora de foco: redesenha ao voltar (o Mapa segue)
  if (mapFocus.on && !mapFocusFits()) setMapFocus(false);
  else if (mapFocus.pinned && !mapFocus.on && mapFocusFits()) setMapFocus(true);
  renderMapPin();
  const systems = skySystems();
  sky.replaceChildren();
  sky.classList.toggle('map', map);
  if (map) sky.removeAttribute('aria-hidden'); else sky.setAttribute('aria-hidden', 'true');
  if (map) { sky.setAttribute('role', 'group'); sky.setAttribute('aria-label', 'Mapa da voz: canais como sóis e quem está neles como planetas. A roda do mouse aproxima e afasta; arrastar o fundo anda pelo mapa'); }
  else { sky.removeAttribute('role'); sky.removeAttribute('aria-label'); }
  // Na lista, o perfil aberto por uma linha (openSkyProfile) mora na caixa do céu: ela fica à vista enquanto ele está aberto
  // e o modo gamer (modo-gamer.js) tira o céu de cima da lista
  const show = map || !!skyFocusId || (!gamerOn() && appPreferences.appearance.voiceSky && systems.some((s) => s.people.length));
  box.hidden = !show;
  $('skyZoom').hidden = true;
  if (!show) return renderSkyPop();
  const labels = systems.length > 1 || map;
  const outer = (n) => skyRadii(n, geo).at(-1) || 9;
  // No mapa, o espaço é o painel inteiro: a disposição acompanha o formato dele
  const rect = map ? sky.getBoundingClientRect() : null;
  const aspect = map && rect.width && rect.height ? rect.width / rect.height : 1;
  const pts = skyGlide(systems.map((s) => s.ch), skyLayout(systems.map((s) => s.ch), geo, aspect), map);
  // Caixa em volta de tudo (órbitas e nomes)
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  systems.forEach((s, i) => {
    const [x, y] = pts[i], r = Math.max(outer(s.people.length), 13) + (map ? 12 : 6);
    x0 = Math.min(x0, x - r - (labels ? 14 : 0)); x1 = Math.max(x1, x + r + (labels ? 14 : 0));
    y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r + (labels ? 10 : 0) + (map && s.people.length ? 6 : 0));
  });
  let w = x1 - x0, h = y1 - y0;
  if (map) {
    skyCam.box = [x0, y0, x1, y1];
    // A poeira cobre o que aparece com tudo à vista (a câmera não sai disso)
    const u = rect.width && rect.height ? Math.max(w / rect.width, h / rect.height) : 0;
    if (u) { x0 -= (rect.width * u - w) / 2; y0 -= (rect.height * u - h) / 2; w = rect.width * u; h = rect.height * u; }
  } else {
    if (w < h * 3.4) { x0 -= (h * 3.4 - w) / 2; w = h * 3.4; } // na lista, o céu é uma faixa larga e baixa
    sky.setAttribute('viewBox', `${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  }
  drawSkyDust(sky, x0, y0, w, h, map ? 160 : 90);
  drawSkyBridges(sky, pts);
  const now = performance.now() / 1000; // a órbita continua de onde estava quando o céu é redesenhado
  systems.forEach((s, i) => drawSkySystem(sky, s, pts[i], { map, geo, labels, now, outer: outer(s.people.length) }));
  if (map) applySkyCam();
  if (map && orbitPointer) setOrbitSpeeds(orbitPointer); // redesenhou com o mouse em cima: a velocidade continua
  renderSkyPop();
}

// Órbitas no mapa: com o mouse chegando perto de um sol, a dele vai desacelerando (a partir de 3x o raio da área do
// clique) até parar na área do clique; as outras seguem girando. Muda só a velocidade das animações do CSS
let orbitPointer = null, orbitFrame = 0;
function setOrbitSpeeds(ev) {
  const sky = $('voiceSky'), m = ev && sky.classList.contains('map') ? sky.getScreenCTM() : null;
  const p = m ? new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()) : null;
  for (const g of sky.querySelectorAll('.sky-system')) {
    const r = Number(g.dataset.r), d = p ? Math.hypot(p.x - g.dataset.cx, p.y - g.dataset.cy) : Infinity;
    const rate = Math.max(0, Math.min(1, (d - r) / (r * 2)));
    // Só as órbitas (st-orbit): as transições curtas (o anel do hover, quem fala) seguem no tempo normal
    for (const a of g.getAnimations({ subtree: true })) if (a.animationName === 'st-orbit' && Math.abs(a.playbackRate - rate) > .01) a.updatePlaybackRate(rate);
  }
}
$('voiceSkyBox').addEventListener('pointermove', (e) => {
  orbitPointer = { clientX: e.clientX, clientY: e.clientY };
  if (!orbitFrame) orbitFrame = requestAnimationFrame(() => { orbitFrame = 0; if (orbitPointer) setOrbitSpeeds(orbitPointer); });
});
$('voiceSkyBox').addEventListener('pointerleave', () => { orbitPointer = null; setOrbitSpeeds(null); });

// Os sóis deslizam até o lugar novo quando a disposição muda (o mapa cresce e eles passam de lado a lado para em
// pé, ou o contrário): 600 ms, desacelerando, redesenhando a cada quadro só enquanto se movem. Canal novo já nasce
// no lugar; trocar entre Lista e Mapa não desliza (as escalas são outras).
const skyAnim = { shown: new Map(), from: null, to: null, start: 0, map: false, frame: 0 };
function skyGlide(chs, target, map) {
  const now = performance.now(), DUR = 600;
  const same = (a, b) => a && b && Math.abs(a[0] - b[0]) < .01 && Math.abs(a[1] - b[1]) < .01;
  if (map !== skyAnim.map) { skyAnim.map = map; skyAnim.shown.clear(); skyAnim.to = null; }
  const changed = !skyAnim.to || chs.some((ch, i) => !same(skyAnim.to.get(ch), target[i]));
  if (changed) {
    skyAnim.from = new Map(skyAnim.shown);
    skyAnim.to = new Map(chs.map((ch, i) => [ch, target[i]]));
    skyAnim.start = now;
  }
  const t = Math.min(1, (now - skyAnim.start) / DUR), k = 1 - (1 - t) ** 3;
  const pts = chs.map((ch, i) => {
    const a = skyAnim.from.get(ch), b = target[i];
    return a ? [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k] : b;
  });
  skyAnim.shown = new Map(chs.map((ch, i) => [ch, pts[i]]));
  if (t < 1 && !skyAnim.frame) skyAnim.frame = requestAnimationFrame(() => { skyAnim.frame = 0; if (!voiceDrag) renderVoiceSky(); });
  return pts;
}

// Poeira de fundo: sempre as mesmas estrelinhas, para o céu não mudar a cada redesenho
function drawSkyDust(sky, x0, y0, w, h, max) {
  const dust = Math.round(Math.min(max, w * h / 900));
  for (let i = 0; i < dust; i++) {
    const hh = skyHash('ceu' + i, 7);
    sky.append(skyEl('circle', { class: 'sky-dust', cx: (x0 + 3 + hh % Math.max(1, w - 6)).toFixed(1), cy: (y0 + 3 + (hh >>> 9) % Math.max(1, h - 6)).toFixed(1), r: (hh >>> 17) % 3 ? .5 : .9 }));
  }
}
// Linha fraca de cada sol até o vizinho mais perto entre os que vieram antes, de borda a borda
function drawSkyBridges(sky, pts) {
  for (let i = 1; i < pts.length; i++) {
    const [x2, y2] = pts[i];
    const [x1b, y1b] = pts.slice(0, i).reduce((a, b) => (Math.hypot(b[0] - x2, b[1] - y2) < Math.hypot(a[0] - x2, a[1] - y2) ? b : a));
    const d = Math.hypot(x2 - x1b, y2 - y1b), gap = 9;
    const [ux, uy] = [(x2 - x1b) / d, (y2 - y1b) / d];
    sky.append(skyEl('line', { class: 'sky-link sky-bridge', x1: x1b + ux * gap, y1: y1b + uy * gap, x2: x2 - ux * gap, y2: y2 - uy * gap }));
  }
}

// ---------- Zoom e andar pelo mapa ----------
// Põe a câmera no desenho: dentro dos limites de zoom, e sem sair da caixa com todos os sóis
function applySkyCam() {
  const sky = $('voiceSky');
  if (!voiceMapOn() || !skyCam.box || $('voiceSkyBox').hidden) return;
  const { width: pw, height: ph } = sky.getBoundingClientRect();
  if (!pw || !ph) return;
  const [x0, y0, x1, y1] = skyCam.box;
  skyCam.uFit = Math.max((x1 - x0) / pw, (y1 - y0) / ph, SKY_FIT_MIN_U);
  skyCam.uIn = Math.min(skyCam.uFit, SKY_SPAN / Math.min(pw, ph));
  if (skyCam.auto || !skyCam.u) { skyCam.u = skyCam.uFit; skyCam.x = (x0 + x1) / 2; skyCam.y = (y0 + y1) / 2; }
  skyCam.u = Math.min(skyCam.uFit, Math.max(skyCam.uIn, skyCam.u));
  const vw = pw * skyCam.u, vh = ph * skyCam.u;
  const keep = (c, a, b, v) => (v >= b - a ? (a + b) / 2 : Math.min(b - v / 2, Math.max(a + v / 2, c)));
  skyCam.x = keep(skyCam.x, x0, x1, vw);
  skyCam.y = keep(skyCam.y, y0, y1, vh);
  sky.setAttribute('viewBox', `${(skyCam.x - vw / 2).toFixed(1)} ${(skyCam.y - vh / 2).toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`);
  $('skyZoom').hidden = skyCam.uIn >= skyCam.uFit * .98; // tudo já cabe de perto: sem zoom
  $('skyZoomIn').disabled = skyCam.u <= skyCam.uIn * 1.001;
  $('skyZoomOut').disabled = $('skyZoomFit').disabled = skyCam.u >= skyCam.uFit * .999;
}
// Aproxima (factor < 1) ou afasta (> 1), mantendo parado o ponto (px, py) em pixels do mapa (sem ponto: o meio)
function zoomSky(factor, px, py) {
  const r = $('voiceSky').getBoundingClientRect();
  if (!skyCam.uFit || !r.width) return;
  const dx = (px ?? r.width / 2) - r.width / 2, dy = (py ?? r.height / 2) - r.height / 2;
  const u2 = Math.min(skyCam.uFit, Math.max(skyCam.uIn, skyCam.u * factor));
  skyCam.x += dx * (skyCam.u - u2);
  skyCam.y += dy * (skyCam.u - u2);
  skyCam.u = u2;
  skyCam.auto = u2 >= skyCam.uFit * .999; // afastou até o fim: mostra tudo, e acompanha quando os canais mudam
  applySkyCam();
}
function fitSky() { skyCam.auto = true; applySkyCam(); }

function setupSkyCamera() {
  const box = $('voiceSkyBox');
  box.addEventListener('wheel', (e) => {
    if (!voiceMapOn() || $('skyZoom').hidden || skyFocusId || e.target.closest('#voiceMapPop')) return; // com o perfil aberto, o mapa fica parado
    e.preventDefault();
    const r = $('voiceSky').getBoundingClientRect();
    const delta = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    zoomSky(Math.exp(delta * (e.ctrlKey ? .01 : .0015)), e.clientX - r.left, e.clientY - r.top); // ctrlKey: pinça do touchpad
  }, { passive: false });
  // Arrastar o fundo (ou um sol) anda pelo mapa; o planeta tem o arrastar dele (mudar de canal)
  box.addEventListener('pointerdown', (e) => {
    if (!voiceMapOn() || e.button !== 0 || skyFocusId || e.target.closest('.sky-star, .sky-zoom, #voiceMapPop')) return;
    const start = [e.clientX, e.clientY], from = [skyCam.x, skyCam.y];
    let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - start[0], dy = ev.clientY - start[1];
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved) { moved = true; box.classList.add('panning'); try { box.setPointerCapture(e.pointerId); } catch {} }
      skyCam.auto = false;
      skyCam.x = from[0] - dx * skyCam.u;
      skyCam.y = from[1] - dy * skyCam.u;
      applySkyCam();
    };
    const up = () => {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
      if (!moved) return;
      box.classList.remove('panning');
      if (skyCam.u >= skyCam.uFit * .999) skyCam.auto = true; // com tudo à vista, andar não muda nada
      // Soltar depois de andar não é um clique no sol embaixo do ponteiro
      const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      box.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => box.removeEventListener('click', eat, { capture: true }), 0);
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
  });
  $('skyZoomIn').onclick = () => zoomSky(1 / 1.5);
  $('skyZoomOut').onclick = () => zoomSky(1.5);
  $('skyZoomFit').onclick = fitSky;
  // O painel mudou de tamanho: a disposição acompanha o formato novo (uma vez por quadro)
  let pending = false;
  new ResizeObserver(() => {
    if (pending || !voiceMapOn() || box.hidden) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; if (!voiceDrag) renderVoiceSky(); });
  }).observe(box);
}

function drawSkySystem(sky, { ch, name, here, people, music }, [sx, sy], { map, geo, labels, now, outer }) {
  // Cada sol com os planetas num grupo: no mapa, a órbita desacelera com o mouse chegando perto (setOrbitSpeeds)
  const sys = skyEl('g', { class: 'sky-system' });
  Object.assign(sys.dataset, { cx: sx, cy: sy, r: Math.max(outer, 13) + 7 });
  sky.append(sys);
  // No mapa, a área em volta do sol inteira recebe o clique e o planeta arrastado
  if (map) {
    const hit = skyEl('circle', { class: 'sky-hit', cx: sx, cy: sy, r: Math.max(outer, 13) + 7 });
    hit.dataset.channel = ch;
    hit.onclick = (e) => openSkyPop({ kind: 'channel', ch }, e);
    sys.append(hit);
  }
  const radii = skyRadii(people.length, geo);
  radii.forEach((radius, r) => {
    const onRing = people.filter((_, j) => j % radii.length === r);
    if (!onRing.length) return;
    sys.append(skyEl('circle', { class: 'sky-path', cx: sx, cy: sy, r: radius }));
    const period = 50 + r * 30, delay = `-${(now % period).toFixed(2)}s`;
    const ring = skyEl('g', { class: 'sky-ring', style: `transform-origin: ${sx}px ${sy}px; animation-duration: ${period}s; animation-delay: ${delay}` });
    const base = (skyHash(ch + ':' + r, 5) % 360) * Math.PI / 180;
    onRing.forEach((p, k) => {
      const a = base + 2 * Math.PI * k / onRing.length;
      ring.append(skyPlanet(p, ch, sx + radius * Math.cos(a), sy + radius * Math.sin(a), { map, period, delay }));
    });
    sys.append(ring);
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
  sys.append(sun);
  // Canal com música: uma notinha ao lado do sol (no mapa)
  if (map && music) {
    const note = skyEl('text', { class: 'sky-music', x: (sx + 8).toFixed(1), y: (sy - 6).toFixed(1) });
    note.textContent = '♪';
    sys.append(note);
  }
  if (labels) {
    // No mapa, o nome do canal fica mais para baixo quando tem planeta (o nome da pessoa vai embaixo dela)
    const below = Math.max(outer, 13) + (map && people.length ? 15 : 9);
    const label = skyEl('text', { class: 'sky-label' + (here ? ' here' : ''), x: sx.toFixed(1), y: (sy + below).toFixed(1) });
    label.textContent = name;
    sys.append(label);
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
  if (what.kind === 'person') return openSkyProfile(what.id, at); // a pessoa abre o perfil no mapa
  if (!mapFocus.on) clearTimeout(mapFocus.timer); // com o balão do canal aberto, o mapa não muda de tamanho
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
  const pop = $('voiceMapPop'), pane = $('voiceSkyBox').getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.min(Math.max(8, x - pane.left - w / 2), pane.width - w - 8);
  const below = y - pane.top + 10;
  const fitsBelow = below + h < pane.height - 8;
  const top = fitsBelow ? below : Math.max(8, y - pane.top - h - 10);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  // A setinha aponta para o sol clicado (em cima do balão, ou embaixo quando ele abre para cima)
  pop.classList.toggle('above', !fitsBelow);
  pop.style.setProperty('--arrow-x', `${Math.min(Math.max(16, x - pane.left - left), w - 16)}px`);
}
// Redesenha o balão aberto (a voz mudou); fecha se o que ele mostra não existe mais
function renderSkyPop() {
  if (skyFocusId) renderSkyProfile();
  const pop = $('voiceMapPop');
  if (!skyPop || !voiceMapOn() || $('voiceSkyBox').hidden) return closeSkyPop();
  const list = pop.querySelector('.members');
  list.replaceChildren();
  pop.querySelector('.sky-card')?.remove();
  if (skyPop.kind === 'channel') {
    const sub = skyPop.ch ? state.subsalas?.find((s) => s.id === skyPop.ch) : null;
    if (skyPop.ch && !sub) return closeSkyPop();
    pop.append(skyCard(skyPop.ch, sub));
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

// Cartão do canal: o nome com a cor do sol e quantos (e quantos ao vivo), que é também o Entrar; embaixo quem está nele, enxuto (o volume
// fica no perfil: clicar na pessoa abre a órbita dela). Quem transmite tem o olho de Assistir, em amarelo
function skyCard(ch, sub) {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const button = (cls, onclick) => { const b = el('button', cls); b.type = 'button'; b.onclick = onclick; return b; };
  const ids = voiceIdsIn(ch);
  const live = (id) => (id ? !!state.members.get(id)?.sharing : state.sharing);
  const card = el('div', 'sky-card');

  // O nome do canal é o Entrar (com a seta); no canal em que você já está, é só o nome
  const head = el('div', 'sky-card-head');
  const here = !!voice.session && voice.channel === ch;
  const name = subsalasOn() ? channelName(ch) : 'Voz';
  const nLive = ids.filter(live).length;
  const info = el(here ? 'div' : 'button', 'sky-card-info');
  const text = el('span', 'sky-card-text');
  text.append(el('strong', '', name), el('span', '', (ids.length ? `${ids.length} na voz${nLive ? ` · ${nLive} ao vivo` : ''}` : 'Ninguém aqui ainda') + (here ? ' · você está aqui' : '')));
  info.append(el('span', 'sky-card-sun'), text);
  if (!here) {
    info.type = 'button';
    info.onclick = () => voice.setChannel(ch);
    info.disabled = !voice.supported || voice.pending;
    info.title = voice.session ? `Ir para ${channelName(ch)}` : `Entrar na voz, em ${channelName(ch)}`;
    const go = el('span', 'sky-card-go');
    go.innerHTML = ICON.moveTo;
    info.append(go);
  }
  head.append(info);
  if (sub) {
    const del = button('btn small icon voice-channel-delete', () => deleteSubsala(sub));
    setIcon(del, 'close', `Apagar ${sub.name}`);
    head.append(del);
  }
  card.append(head);

  // A música: tocando, a linha dela (Ouvir); sem música, no seu canal, a mesma linha tracejada com "Pôr uma"
  const song = musicRow(ch);
  if (song) { const ul = el('ul', 'members sky-card-music'); ul.append(song); card.append(ul); }
  else if (musicHeadButton(ch)) {
    const put = button('voice-music sky-card-nomusic', () => (musicPopFor?.ch === ch ? closeMusicPop() : openMusicPop(ch, put, 'por')));
    put.title = `Pôr uma música do YouTube em ${channelName(ch)} (todos ouvem junto)`;
    const icon = el('span', 'voice-music-icon');
    icon.innerHTML = ICON.music;
    put.append(icon, el('span', 'sky-card-nomusic-text', 'Sem música'), el('span', 'sky-card-nomusic-go', 'Pôr uma'));
    const wrap = el('div', 'sky-card-music');
    wrap.append(put);
    card.append(wrap);
  }

  if (ids.length) {
    const rows = el('div', 'sky-card-rows');
    for (const id of ids) {
      const who = id || state.myId;
      const full = id ? nameOf(id) : `${getName()} (você)`;
      const row = el('div', 'sky-card-row');
      const open = button('sky-card-person', (e) => { openSkyProfile(who, e.detail === 0 ? open : e); skyProfileBack = ch; });
      open.title = `${full}: volume e perfil`;
      const av = avatar(id ? full : getName(), id);
      av.dataset.person = who;
      av.classList.toggle('speaking', speaking.has(who));
      open.append(av, paintName(el('span', 'sky-card-name', full), id));
      row.append(open);
      if (id ? voice.members.get(id)?.muted : voice.muted) {
        const mic = el('span', 'sky-card-mic');
        mic.innerHTML = ICON.micOff;
        mic.title = 'Microfone desligado';
        mic.setAttribute('role', 'img');
        mic.setAttribute('aria-label', 'Microfone desligado');
        row.append(mic);
      }
      if (live(id)) row.append(el('span', 'sky-card-live', 'AO VIVO'));
      else if (who === state.hostId) row.append(el('span', 'sky-card-tag', 'Host'));
      if (id && live(id)) {
        const watching = state.in.has(id);
        const eye = button('sky-card-watch', () => { watching ? stopWatching(id) : watch(id); renderSkyPop(); });
        setIcon(eye, 'eye', watching ? `Parar de assistir ${full}` : `Assistir ${full}`);
        eye.setAttribute('aria-pressed', String(watching));
        row.append(eye);
      }
      rows.append(row);
    }
    card.append(rows);
  }
  return card;
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

setupSkyCamera();
$('voiceViewList').onclick = () => setVoiceView('lista');
$('voiceViewMap').onclick = () => setVoiceView('mapa');
syncVoiceViewButtons();
// Clicar fora do balão fecha; no mapa, só o fundo (sol e planeta abrem o balão deles). O cartão de volume e o perfil
// que o balão abre não fecham o balão
document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  if ($('voiceMapPop').hidden || t.closest?.('#voiceMapPop, #musicPop, #personCard, #profilePane, #voiceSky [data-channel], #voiceSky .sky-star')) return;
  closeSkyPop();
});

// ---------- Mapa em foco: com o mouse em cima, o mapa ocupa a barra da direita ----------
// Só com o chat e a voz juntos na barra (fora do modo largo). Espera 250 ms com o mouse no mapa (passar de raspão
// não mexe); o chat encolhe e some (CSS, 280 ms) e fica a faixa #mapChatStrip, com as mensagens novas. Volta 400 ms
// depois que o mouse sai do painel de voz, ou na hora pela faixa. Não abre digitando no chat nem arrastando planeta.
function mapFocusFits() {
  const b = document.body.classList;
  return voiceMapOn() && b.contains('workspace-in-room') && b.contains('has-workspace-pane') && !b.contains('workspace-wide')
    && !$('chatTab').hidden && !$('voicePane').hidden && !$('voiceSkyBox').hidden;
}
function setMapFocus(on) {
  clearTimeout(mapFocus.timer);
  on = !!on && mapFocusFits();
  if (on === mapFocus.on) return;
  mapFocus.on = on;
  closeSkyPop(); // o balão do canal ficaria fora do lugar com o mapa mudando de tamanho
  $('workspacePanes').classList.toggle('map-focus', on);
  $('chatTab').inert = on;
  if (!on && chat.open && chatAtBottom()) markRead();
}
$('voiceSkyBox').addEventListener('mouseenter', () => {
  if (mapFocus.on || mapFocus.blocked || voiceDrag || skyPop || $('chatTab').contains(document.activeElement) || !mapFocusFits()) return;
  clearTimeout(mapFocus.timer);
  mapFocus.timer = setTimeout(() => setMapFocus(true), 250);
});
$('voiceSkyBox').addEventListener('mouseleave', () => { if (!mapFocus.on) clearTimeout(mapFocus.timer); });
$('voicePane').addEventListener('mouseenter', () => { if (mapFocus.on) clearTimeout(mapFocus.timer); });
$('voicePane').addEventListener('mouseleave', () => {
  mapFocus.blocked = false;
  if (mapFocus.on) endMapFocusSoon();
});
$('mapChatStrip').onclick = () => {
  mapFocus.blocked = true; // só abre de novo depois que o mouse sair e voltar
  setMapPinned(false);
  closeSkyProfile();
  setMapFocus(false);
  $('chatInput').focus();
};
// O mapa continua aberto enquanto algo dele está em uso fora do painel: fixado, arrastando, o perfil aberto, o
// balão de pôr música ou o cartão da pessoa (que ficam fora do painel), ou digitando num campo do painel
function mapFocusHeld() {
  const a = document.activeElement;
  return !!(mapFocus.pinned || voiceDrag || skyFocusId || !$('musicPop').hidden || !$('personCard').hidden
    || (a?.matches?.('input, textarea') && ($('voicePane').contains(a) || $('musicPop').contains(a))));
}
// Fecha 400 ms depois; se algo ainda segura o mapa, confere de novo até soltar (e para se o mouse voltou ao painel)
function endMapFocusSoon() {
  clearTimeout(mapFocus.timer);
  mapFocus.timer = setTimeout(function check() {
    if (!mapFocus.on || $('voicePane').matches(':hover')) return;
    if (mapFocusHeld()) { mapFocus.timer = setTimeout(check, 400); return; }
    setMapFocus(false);
  }, 400);
}

// Fixar: o mapa fica aberto na barra até soltar (ou clicar na faixa do chat). Salvo neste PC
mapFocus.pinned = load('mapaFixo') === '1';
function setMapPinned(on) {
  mapFocus.pinned = !!on;
  save('mapaFixo', on ? '1' : '');
  renderMapPin();
  if (on) setMapFocus(true); else if (mapFocus.on && !$('voicePane').matches(':hover')) endMapFocusSoon();
}
function renderMapPin() {
  const b = $('mapPin');
  b.hidden = !mapFocusFits();
  setIcon(b, 'pin', mapFocus.pinned ? 'Soltar o mapa (o chat volta)' : 'Fixar o mapa aberto');
  b.setAttribute('aria-pressed', String(mapFocus.pinned));
}
$('mapPin').onclick = () => setMapPinned(!mapFocus.pinned);

// Com o Tela P2P fora de foco (no jogo, em outra janela), o céu em cima da lista não é desenhado: some e não
// redesenha; volta ao focar de novo. Na visão Mapa ele continua desenhando e girando
let skyStale = false;
window.addEventListener('blur', () => document.body.classList.add('app-blurred'));
window.addEventListener('focus', () => {
  document.body.classList.remove('app-blurred');
  if (skyStale) { skyStale = false; renderVoiceSky(); }
});

// ---------- Perfil no mapa: clicar num planeta aproxima até a pessoa ----------
// A pessoa grande no meio, numa órbita com as ações em volta, e o volume embaixo. Dos outros: Assistir, Perfil
// (o cartão com volume e amizade; na caixinha da lista, Voltar o volume ao padrão), Silenciar para mim e Mudar de canal; de você: microfone, fone e Mudar de canal.
// Só os ícones; o nome de cada ação fica na dica. Põe o mapa em foco; "‹ Mapa" ou Esc volta. Só redesenha quando algo mostrado muda (o volume
// arrastando não perde o foco); quem fala acende sozinho pelo data-person (voz.js).
let skyProfileBack = null; // o canal do cartão de onde o perfil foi aberto: sair do perfil volta para ele
function openSkyProfile(id, at) {
  closeSkyPop();
  skyProfileBack = null;
  clearTimeout(skyFocusClosing); // abriu de novo no meio da transição de fechar
  $('skyFocus').classList.remove('closing');
  $('skyFocus').hidden = true;
  skyFocusId = id;
  skyFocusKey = '';
  requestProfileBg(id); // pergunta pelo fundo do perfil dela (pode ter trocado); chega e redesenha sozinho
  setMapFocus(true);
  if (!voiceMapOn()) $('voiceSkyBox').hidden = false; // na lista, a caixa do céu pode estar escondida (renderVoiceSky)
  renderSkyProfile();
  if (at && !('clientX' in at)) $('skyFocus').querySelector('.sky-focus-back')?.focus(); // pelo teclado
}
// Na lista do painel de voz, clicar na linha de quem está na voz (a foto, o nome, o estado; os botões dela não) abre o
// mesmo perfil do mapa, por cima do painel. Antes do clique geral das fotos e nomes (voz.js), que abriria o cartão
$('voicePaneMembers').addEventListener('click', (e) => {
  const li = e.target.closest('li.member');
  if (!li || e.target.closest('button, input, a') || !inVoice(li.dataset.person)) return;
  e.stopPropagation();
  if (skyFocusId === li.dataset.person && !voiceMapOn()) return closeSkyProfile(); // a mesma linha fecha a caixinha
  openSkyProfile(li.dataset.person, e.detail === 0 ? li : e);
});
// A caixinha fecha com um clique fora dela (a linha da pessoa abre e fecha pelo clique acima; o cartão da pessoa e o
// menu de canais não a fecham)
document.addEventListener('pointerdown', (e) => {
  if (!skyFocusId || voiceMapOn() || e.target.closest?.('#skyFocus, #personCard, #voicePaneMembers li.member.in-voice')) return;
  // a linha fica embaixo da caixinha: o clique na foto dela cai na caixinha e não fecha
  closeSkyProfile();
});
$('voicePaneMembers').addEventListener('keydown', (e) => {
  const li = e.target.closest?.('li.member');
  if ((e.key !== 'Enter' && e.key !== ' ') || !li || !e.target.matches('[data-profile]') || !inVoice(li.dataset.person)) return;
  e.preventDefault();
  e.stopPropagation();
  openSkyProfile(li.dataset.person, li);
});
// Fechar tem transição (CSS .closing, 180 ms): o perfil some e encolhe; só depois sai da tela
let skyFocusClosing = 0;
function closeSkyProfile() {
  if (!skyFocusId) return;
  skyProfileBack = null;
  skyFocusId = null;
  skyFocusKey = '';
  const box = $('skyFocus');
  box.classList.add('closing');
  clearTimeout(skyFocusClosing);
  skyFocusClosing = setTimeout(() => {
    box.hidden = true; box.classList.remove('closing', 'has-bg'); box.replaceChildren();
    box.style.removeProperty('--fundo'); // o GIF para de vez com o perfil fechado
    if (!voiceMapOn()) renderVoiceSky(); // na lista, a caixa do céu volta a sumir se não tinha nada para mostrar
  }, 180);
  if (!$('voicePane').matches(':hover')) endMapFocusSoon();
}
// Sair do perfil pela setinha, Esc ou um clique fora: se ele foi aberto pelo cartão de um canal, volta para o cartão
function leaveSkyProfile() {
  const ch = skyProfileBack;
  closeSkyProfile();
  const sun = ch !== null && [...$('voiceSky').querySelectorAll('.sky-sun')].find((el) => el.dataset.channel === ch);
  if (sun) openSkyPop({ kind: 'channel', ch }, sun);
}
function renderSkyProfile() {
  const box = $('skyFocus'), id = skyFocusId, me = id === state.myId, pid = me ? null : id;
  if (!id || $('voiceSkyBox').hidden || !inVoice(id) || (!me && !state.members.has(id))) return closeSkyProfile();
  // Na lista, o perfil é uma caixinha solta na página (.sky-pop), com a foto bem em cima da foto da linha; no mapa,
  // fica dentro da caixa do céu e cobre o mapa
  const list = !voiceMapOn();
  if (list && box.parentElement !== document.body) document.body.append(box);
  if (!list && box.parentElement !== $('voiceSkyBox')) $('voiceSkyBox').insertBefore(box, $('skyZoom'));
  if (!list) { box.style.left = box.style.top = ''; } // a posição da caixinha (placeSkyProfile) não vale no mapa
  box.classList.toggle('sky-pop', list);
  // A órbita encolhe quando o espaço é baixo (sem foco, ou janela pequena); na caixinha, fica sempre menor
  const h = $('voiceSkyBox').clientHeight;
  box.style.setProperty('--orbit', list ? '0.75' : String(Math.max(0.55, Math.min(1, (h - 160) / 170))));
  const name = me ? `${getName()} (você)` : nameOf(id);
  const sharing = me ? state.sharing : !!state.members.get(id)?.sharing;
  const micOff = me ? voice.muted : !!voice.members.get(id)?.muted;
  const deafOn = me ? voice.deafened : !!voice.members.get(id)?.deafened;
  const v = me ? null : volOf(id);
  const channels = subsalasOn() ? ['', ...state.subsalas.map((s) => s.id)] : [];
  const here = voiceChannelOf(pid);
  const canMove = channels.length > 1 && canDragVoice(pid);
  const bg = profileBgOf(pid); // o fundo do perfil da pessoa (renderer/fundo-perfil.js), se já chegou
  const key = JSON.stringify([list, id, name, sharing, state.in.has(id), micOff, deafOn, v?.muted, v?.voice, v?.screen, bg.length, bg.slice(-40), here, canMove, channels.map(channelName), photoHashOf(pid)]);
  if (key === skyFocusKey && !box.hidden) return placeSkyProfile();
  skyFocusKey = key;
  box.replaceChildren();
  box.style.setProperty('--person', personColor(pid));
  // Fundo do perfil: a imagem cobrindo a caixa, com um véu por cima (CSS .has-bg); some ao fechar
  box.classList.toggle('has-bg', !!bg);
  if (bg) box.style.setProperty('--fundo', `url("${bg}")`); else box.style.removeProperty('--fundo');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn small icon sky-focus-back';
  if (list) setIcon(back, 'close', 'Fechar'); else setIcon(back, 'prev', 'Voltar para o mapa');
  back.onclick = leaveSkyProfile;

  const orbit = document.createElement('div');
  orbit.className = 'sky-orbit';
  orbit.innerHTML = '<svg viewBox="0 0 170 170" aria-hidden="true"><circle cx="85" cy="85" r="75"/></svg>';
  const av = avatar(me ? getName() : name, pid);
  av.dataset.person = id;
  av.classList.toggle('speaking', speaking.has(id));
  orbit.append(av);
  const act = (slot, icon, label, onclick, { pressed, disabled } = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `sky-act ${slot}`;
    setIcon(b, icon, label);
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    if (disabled) b.disabled = true;
    b.onclick = onclick;
    orbit.append(b);
    return b;
  };
  // Você: microfone, fone e Mudar de canal em triângulo (t, r, l)
  if (me) {
    act('t', micOff ? 'micOff' : 'mic', micOff ? 'Ligar microfone' : 'Desligar microfone', () => $('voiceMute').click(), { pressed: micOff });
    act('r', deafOn ? 'headphonesOff' : 'headphones', deafOn ? 'Ouvir vozes' : 'Silenciar vozes', () => $('voiceDeafen').click(), { pressed: deafOn });
  } else {
    // Assistir só aparece para quem está transmitindo; sem ele, os três que sobram ficam em triângulo (t, r, l)
    const watching = state.in.has(id);
    if (sharing) act('a1', 'eye', watching ? 'Parar de assistir' : 'Assistir', () => (watching ? stopWatching(id) : watch(id)));
    // No mapa, Perfil abre o cartão da pessoa (volume e amizade). Na caixinha da lista, que já é o perfil, no lugar
    // dele fica Voltar o volume ao padrão (como no cartão)
    const isDefault = v.voice === DEFAULT_VOICE && v.screen === DEFAULT_SCREEN && !v.muted;
    if (!list) act(sharing ? 'a2' : 't', 'user', 'Perfil', (e) => openPersonCard(id, e.currentTarget, e.detail === 0));
    else act(sharing ? 'a2' : 't', 'reset', isDefault ? 'O volume já está no padrão' : `Voltar ao padrão: voz em ${DEFAULT_VOICE}% e a transmissão sem som`,
      () => setVol(id, { voice: DEFAULT_VOICE, screen: DEFAULT_SCREEN, muted: false }), { disabled: isDefault });
    act(sharing ? 'a3' : 'r', v.muted ? 'muted' : 'volume', v.muted ? 'Ouvir de novo' : 'Silenciar para mim', () => setVol(id, { muted: !v.muted }), { pressed: v.muted });
  }
  const moveBtn = act(sharing && !me ? 'a4' : 'l', 'moveTo', canMove ? 'Mudar de canal' : 'Sem outro canal', () => toggleSkyMoveMenu(moveBtn, pid, channels, here), { disabled: !canMove });
  moveBtn.setAttribute('aria-haspopup', 'menu');

  const title = document.createElement('h3');
  title.id = 'skyFocusName';
  title.className = 'sky-focus-name';
  title.textContent = name;
  paintName(title, pid);
  // O estado em selos presos à bolinha (como em app de chamada), sem texto: AO VIVO embaixo, microfone e fone
  // cortados nos cantos de baixo, silenciada para você no canto de cima; o nome de cada um na dica
  av.classList.toggle('live', sharing);
  const seal = (cls, icon, label) => {
    const s = document.createElement('span');
    s.className = `sky-seal ${cls}`;
    s.innerHTML = ICON[icon];
    s.title = label;
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', label);
    orbit.append(s);
  };
  if (sharing) {
    const live = document.createElement('span');
    live.className = 'sky-live';
    live.textContent = 'AO VIVO';
    live.title = 'Transmitindo';
    orbit.append(live);
  }
  if (micOff) seal('mic', 'micOff', 'Microfone desligado');
  if (deafOn) seal('fone', 'headphonesOff', 'Fone silenciado');
  if (v?.muted) seal('mudo', 'muted', 'Silenciada para você');
  // O canal, pequeno, em cima do nome
  const where = document.createElement('span');
  where.className = 'sky-focus-where';
  where.textContent = subsalasOn() ? channelName(here) : 'Na voz';
  box.append(back, orbit, where, title);

  // Volume da voz dessa pessoa para você (como no cartão): enquanto arrasta só muda o som; ao soltar, salva
  if (v) {
    const row = document.createElement('label');
    row.className = 'sky-focus-vol';
    const icon = document.createElement('span');
    icon.innerHTML = ICON.volume;
    icon.className = 'mic-off-icon';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0'; input.max = '200'; input.step = '5';
    input.value = String(v.voice);
    input.setAttribute('aria-label', `Volume da voz de ${name}`);
    const out = document.createElement('output');
    out.textContent = v.muted ? 'mudo' : `${v.voice}%`;
    input.oninput = () => {
      out.textContent = `${input.value}%`;
      volumes[name] = { ...volOf(id), voice: Number(input.value), muted: false };
      mixer.apply(id);
    };
    input.onchange = () => setVol(id, { voice: Number(input.value), muted: false });
    row.append(icon, input, out);
    box.append(row);
  }
  box.hidden = false;
  placeSkyProfile();
}
// A caixinha da lista: a foto de dentro dela fica centrada em cima da foto da linha (sem sair da janela). As linhas são
// redesenhadas a toda hora, então acha a linha de novo pelo data-person. "fixed" conta a partir do body (que desce
// pela barra de título): mede o 0 de verdade e desconta, como o cartão da pessoa
function placeSkyProfile() {
  const box = $('skyFocus');
  if (voiceMapOn() || box.hidden) return;
  const row = $('voicePaneMembers').querySelector(`li.member[data-person="${CSS.escape(skyFocusId || '')}"]`);
  const from = row?.querySelector('.avatar')?.getBoundingClientRect(), inner = box.querySelector('.sky-orbit .avatar');
  box.style.left = box.style.top = '0px';
  const origin = box.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
  let left = (innerWidth - w) / 2, top = (innerHeight - h) / 2;
  if (from && inner) {
    const a = inner.getBoundingClientRect(); // com a caixa no 0: onde a foto de dentro fica em relação ao canto dela
    left = from.left + from.width / 2 - (a.left - origin.left + a.width / 2);
    top = from.top + from.height / 2 - (a.top - origin.top + a.height / 2);
  }
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  top = Math.max(8, Math.min(top, innerHeight - h - 8));
  box.style.left = `${left - origin.left}px`;
  box.style.top = `${top - origin.top}px`;
}
// Mudar de canal: um menu com os outros canais, ao lado do botão
function toggleSkyMoveMenu(btn, pid, channels, here) {
  const box = $('skyFocus');
  const open = box.querySelector('.sky-move-menu');
  if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const menu = document.createElement('div');
  menu.className = 'sky-move-menu';
  menu.setAttribute('role', 'menu');
  for (const ch of channels.filter((c) => c !== here)) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.textContent = channelName(ch);
    item.onclick = () => { menu.remove(); moveVoiceTo(pid, ch); };
    menu.append(item);
  }
  box.append(menu);
  const b = btn.getBoundingClientRect(), r = box.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(b.left - r.left, r.width - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.min(b.bottom - r.top + 6, r.height - menu.offsetHeight - 8)}px`;
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus();
}
// Clicar no perfil fora dos botões (e do volume) volta para o mapa; com o menu de canais aberto, só fecha o menu
// (na caixinha da lista, não: ela fecha pelo X, Esc ou um clique fora)
$('skyFocus').addEventListener('click', (e) => {
  if (e.target.closest('button, input, label, .sky-move-menu')) return;
  const menu = $('skyFocus').querySelector('.sky-move-menu');
  if (menu) return menu.remove();
  if (voiceMapOn()) leaveSkyProfile();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !skyFocusId || !$('personCard').hidden) return;
  e.stopImmediatePropagation(); // o Esc geral (inicio.js) fecharia o cartão que acabou de voltar
  const menu = $('skyFocus').querySelector('.sky-move-menu');
  if (menu) menu.remove(); else leaveSkyProfile();
});

// ---------- Tela inicial (só no tema Padrão; o CSS esconde nos outros) ----------
// Estrela cadente: uma de cada vez, em intervalo aleatório (20 a 90 s). Só com a tela inicial à vista, a janela em
// foco (com o jogo na frente, nada anima) e sem "reduzir movimento"; o desenho e o tema Padrão ficam no CSS
function homeMeteor() {
  setTimeout(homeMeteor, 20000 + Math.random() * 70000);
  const el = $('homeMeteor');
  if (document.hidden || !document.hasFocus() || $('home').hidden || document.documentElement.dataset.skin
    || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Cai em diagonal, para a direita ou para a esquerda, a partir da parte de cima da janela
  const tilt = 18 + Math.random() * 22, deg = Math.random() < .5 ? tilt : 180 - tilt;
  const dist = 220 + Math.random() * 140, rad = deg * Math.PI / 180;
  el.style.setProperty('--mx', `${10 + Math.random() * 75}vw`);
  el.style.setProperty('--my', `${4 + Math.random() * 36}vh`);
  el.style.setProperty('--ma', `${deg.toFixed(1)}deg`);
  el.style.setProperty('--mdx', `${(Math.cos(rad) * dist).toFixed(0)}px`);
  el.style.setProperty('--mdy', `${(Math.sin(rad) * dist).toFixed(0)}px`);
  el.classList.remove('falling');
  void el.offsetWidth; // recomeça a animação mesmo se a anterior não tiver terminado
  el.classList.add('falling');
}
$('homeMeteor').addEventListener('animationend', (e) => e.currentTarget.classList.remove('falling'));
setTimeout(homeMeteor, 8000 + Math.random() * 17000);
