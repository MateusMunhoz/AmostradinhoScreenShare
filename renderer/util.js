'use strict';
// Utilidades: $, telas, aviso (toast), preferências, mandar para a sala, ícones.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: estado, overlay, chat, atualizacao.

const $ = (id) => document.getElementById(id);

// ---------- Utilidades ----------
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
  if (typeof renderUpdateBanner === 'function') renderUpdateBanner();
  if (id === 'home') renderHome();
}

let toastTimer;
function toast(text, kind = 'info') {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 5000);
}

function save(key, val) { try { localStorage.setItem(key, val); } catch {} }
function load(key, def = '') { try { return localStorage.getItem(key) ?? def; } catch { return def; } }
function getName() { return $('name').value.trim() || 'Anônimo'; }
function nameOf(id) { return state.members.get(id)?.name || 'Alguém'; }
function setBusy(btn, busy, label) { btn.disabled = busy; btn.textContent = label; }

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}
function sendSignal(to, data) { send({ type: 'signal', to, data }); }

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  expand: svg('M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7'),   // setinhas para os cantos
  shrink: svg('M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7'),  // setinhas para o centro
  volume: svg('M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14'),
  muted: svg('M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6'),
  close: svg('M18 6 6 18M6 6l12 12'),
  refresh: svg('M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6'),
  leave: svg('M9 21H5V3h4M16 17l5-5-5-5M21 12H9'),
  chat: svg('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'),
  chevron: svg('M9 6l6 6-6 6'),
  doc: svg('M14 3H6v18h12V7zM14 3v4h4'),
  check: svg('M20 6 9 17l-5-5'),
  warn: svg('M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'),
  attach: svg('M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'),
  send: svg('M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z'),
  stats: svg('M22 12h-4l-3 9L9 3l-3 9H2'),                 // pulso: estatísticas
  focus: svg('M3 5h18v14H3zM7 9h10v6H7z'),
  pip: svg('M3 5h18v14H3zM12 11h7v6h-7z'),                   // janelinha no canto: janela flutuante                  // um quadro dentro do outro: destacar
  grid: svg('M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z'), // grade: mostrar todas
  mic: svg('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3'),
  micOff: svg('M2 2l20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.6M17 16.9A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.1 1.2M12 19v3'),
  headphones: svg('M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z'),
  headphonesOff: svg('M2 2l20 20M3 18v-6a9 9 0 0 1 14.5-7.1M20.4 8.4A9 9 0 0 1 21 12v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z'),
  phoneOff: svg('M3 11a15 15 0 0 1 18 0l-2 3-3-1v-2a10 10 0 0 0-8 0v2l-3 1z'),
  overlay: svg('M3 4h18v14H3zM6 12h7M6 15h5'),        // tela com linhas de texto: chat por cima da tela
  eye: svg('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'),
  sliders: svg('M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'), // controles: voz e atalhos
};

// Botão só com ícone: a dica (title) e o nome lido pelo leitor de tela são o mesmo texto
function setIcon(btn, icon, label) {
  btn.innerHTML = ICON[icon];
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

function setFsIcon(btn, full) {
  setIcon(btn, full ? 'shrink' : 'expand', full ? 'Sair da tela cheia' : 'Tela cheia');
}
