'use strict';
// Cores do tema para as janelas montadas por código, cor de cada pessoa e as barrinhas de quem fala.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado.

// Cada pessoa tem uma cor (a mesma no chat e na lista); você é sempre o amarelo
// Cores do tema lan house usadas nas janelas que o app monta por código (flutuantes e chat por cima do jogo)
const THEME = {
  bg: '#22271E', sunken: '#1B1F17', card: '#2D3327', raised: '#3A4232', line: '#434C3A', field: '#6B7560',
  text: '#E4E9DD', muted: '#A9B29C', primary: '#D6C45C', onPrimary: '#221E06', accent: '#D6C45C',
  accentSoft: 'rgba(214, 196, 92, .16)', ok: '#A6D089', ink: '#1B1F17', glass: 'rgba(27, 31, 23, .9)',
  font: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
};
// Longe do amarelo (você) e do verde (quem fala), e legíveis sobre o oliva
const PERSON_COLORS = ['#E3A76F', '#8FC1E3', '#D59BD0', '#7FD1C1', '#B9C7F2', '#E6C3A0'];
function personColor(id) {
  if (!id || id === state.myId) return 'var(--accent)';
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}

function avatar(name) {
  const el = document.createElement('span');
  el.className = 'avatar';
  el.textContent = (name.trim()[0] || '?').toUpperCase();
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// As 3 barrinhas de quem fala (aparecem pelo CSS quando o elemento de cima está .speaking)
function speakBars() {
  const eq = document.createElement('span');
  eq.className = 'eq';
  eq.setAttribute('role', 'img');
  eq.setAttribute('aria-label', 'Falando');
  eq.innerHTML = '<span></span><span></span><span></span>';
  return eq;
}

// O mesmo gráfico nas janelas que o app monta por código (flutuante e chat por cima do jogo)
function speakBarsIn(d) {
  const eq = d.createElement('span');
  eq.setAttribute('role', 'img');
  eq.setAttribute('aria-label', 'Falando');
  Object.assign(eq.style, { display: 'inline-flex', alignItems: 'flex-end', gap: '2px', height: '11px' });
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (let i = 0; i < 3; i++) {
    const b = d.createElement('span');
    Object.assign(b.style, { width: '3px', height: '100%', borderRadius: '1px', background: THEME.ok, transformOrigin: 'bottom', transform: 'scaleY(.6)' });
    if (!still) b.animate([{ transform: 'scaleY(.3)' }, { transform: 'scaleY(1)' }, { transform: 'scaleY(.3)' }], { duration: 900, delay: i * 250, iterations: Infinity, easing: 'ease-in-out' });
    eq.append(b);
  }
  return eq;
}

// Nome de quem fala, com as barrinhas, para as janelas montadas por código
function talkerChip(d, id) {
  const el = d.createElement('span');
  Object.assign(el.style, {
    display: 'inline-flex', alignItems: 'center', gap: '7px', height: '24px', padding: '0 9px', borderRadius: '5px',
    background: 'rgba(20, 23, 17, .82)', border: `1px solid ${THEME.ok}`, color: THEME.text, fontSize: '12px', fontWeight: '600',
  });
  const dot = d.createElement('span');
  Object.assign(dot.style, { width: '8px', height: '8px', borderRadius: '2px', background: personColor(id) });
  el.append(dot, nameOf(id), speakBarsIn(d));
  el.title = `${nameOf(id)} está falando`;
  return el;
}
