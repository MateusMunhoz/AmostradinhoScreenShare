'use strict';
// Utilidades: $, telas, aviso (toast), preferências, mandar para a sala, ícones.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: estado, overlay, chat, atualizacao.

const $ = (id) => document.getElementById(id);

// ---------- Utilidades ----------
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
  if (typeof renderUpdateBanner === 'function') renderUpdateBanner();
  if (id === 'home') renderHome();
  syncWorkspace();
  if (typeof setSessionWatch === 'function') setSessionWatch(sessionWatchWanted()); // procura sessões só no início (ou com o HUB aberto)
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

// Copia para a área de transferência (pelo processo principal; a da página falha sem foco)
async function copiar(text) {
  try { return await window.api.copyText(text); }
  catch { await navigator.clipboard.writeText(text); return true; }
}

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
  crown: svg('M12 6l4 6 5-4-2 10H5L3 8l5 4z'), // host da sala
  prev: svg('M15 18l-6-6 6-6'),
  next: svg('M9 18l6-6-6-6'),
  refresh: svg('M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6'),
  reset: svg('M3 12a9 9 0 1 0 2.64-6.36M3 3v6h6'), // seta voltando: voltar ao padrão
  info: svg('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01'),
  userPlus: svg('M15 20a6 6 0 0 0-12 0M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M16 11h6'),
  userMinus: svg('M15 20a6 6 0 0 0-12 0M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 11h6'),
  more: svg('M5 12h.01M12 12h.01M19 12h.01'), // "⋯": três pontos (traço redondo)
  userCheck: svg('M15 20a6 6 0 0 0-12 0M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 11l2 2 4-4'),
  leave: svg('M9 21H5V3h4M16 17l5-5-5-5M21 12H9'),
  chat: svg('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'),
  chevron: svg('M9 6l6 6-6 6'),
  chevronUp: svg('M6 15l6-6 6 6'),
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
  overlay: svg('M3 4h18v14H3zM6 12h7M6 15h5'),
  captions: svg('M3 5h18v14H3zM10.5 10a2 2 0 0 0 0 4M16.5 10a2 2 0 0 0 0 4'), // CC: legendas        // tela com linhas de texto: chat por cima da tela
  eye: svg('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'),
  lock: svg('M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4'),
  sliders: svg('M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'), // controles: voz e atalhos
  music: svg('M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'), // nota: música junto
  play: svg('M7 4v16l13-8z'),
  user: svg('M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z'),      // pessoa: perfil
  moveTo: svg('M5 12h14M13 6l6 6-6 6'),
  pin: svg('M12 17v5M9 3h6l-1 6 4 4H6l4-4z'),                                         // alfinete: fixar                                            // seta: mudar de canal
  pause: svg('M7 4h4v16H7zM13 4h4v16h-4z'),
  swap: svg('M4 7h13l-3-3M20 17H7l3 3'),
  stop: svg('M7 7h10v10H7z'),
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

// ---------- Formatação (números com vírgula, como no Brasil) ----------
const two = (n) => String(n).padStart(2, '0');
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
const pct = (v) => `${(v || 0).toFixed(1).replace('.', ',')}%`;
const fpsText = (v) => `${Math.round(v || 0)} fps`;
const mbpsText = (v) => `${(v || 0).toFixed(1).replace('.', ',')} Mbps`;

// Fecha o diálogo quando o clique começa no fundo escuro, fora do cartão. mousedown (e não click):
// arrastar um controle deslizante e soltar fora do cartão não conta como clique fora.
function closeOnBackdrop(id, close) {
  $(id).addEventListener('mousedown', (e) => { if (e.target === $(id)) close(); });
}

// Confirmação no tema do app (o confirm() do navegador abre a caixa do Windows, que não segue as cores).
// Promessa: true no botão de confirmar ou Enter; false em Cancelar, Esc ou clique no fundo.
function appConfirm(text, { ok = 'Confirmar', cancel = 'Cancelar', danger = false, title = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const modal = document.createElement('div');
    modal.className = 'modal global app-confirm';
    const box = document.createElement('div');
    box.className = 'dialog narrow';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.className = 'app-confirm-text';
    p.textContent = text;
    const row = document.createElement('div');
    row.className = 'app-confirm-actions';
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'btn small'; no.textContent = cancel;
    const yes = document.createElement('button');
    yes.type = 'button'; yes.className = 'btn small ' + (danger ? 'danger' : 'primary'); yes.textContent = ok;
    row.append(no, yes);
    box.append(h, p, row);
    modal.append(box);
    const done = (value) => { modal.remove(); back?.focus?.(); resolve(value); };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) done(false); });
    modal.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === yes ? no : yes).focus(); }
    });
    document.body.append(modal);
    yes.focus();
  });
}

// ---------- Dicas (o "i") ----------
// Explicações que não precisam ficar escritas na tela: um "i" ao lado do que explica, e o texto aparece num
// balão ao passar o mouse (ou com o foco do teclado). Configurações › Aparência liga e desliga todas (html[data-tips]).
// No HTML: <button type="button" class="tip" data-tip="texto" aria-label="texto"></button>; por código, tipButton().
function tipButton(text) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tip';
  setTip(b, text);
  return b;
}
function setTip(b, text) {
  b.dataset.tip = text;
  b.setAttribute('aria-label', text);
}
document.documentElement.dataset.tips = load('dicas', '1') === '0' ? 'off' : 'on';
(() => {
  // O balão fica no <html> (fora do body, que desce pela barra de título e conta o "fixed" a partir dele)
  const bubble = document.createElement('div');
  bubble.id = 'tipBubble';
  bubble.setAttribute('role', 'tooltip');
  bubble.hidden = true;
  document.documentElement.append(bubble);
  let current = null;
  const show = (el) => {
    current = el;
    bubble.textContent = el.dataset.tip;
    bubble.hidden = false;
    const r = el.getBoundingClientRect(), b = bubble.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), innerWidth - b.width - 8);
    const top = r.top - b.height - 8 >= 8 ? r.top - b.height - 8 : r.bottom + 8;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  };
  const hide = () => { current = null; bubble.hidden = true; };
  document.addEventListener('pointerover', (e) => { const t = e.target.closest?.('.tip[data-tip]'); if (t && t !== current) show(t); });
  document.addEventListener('pointerout', (e) => { if (current && !current.contains(e.relatedTarget)) hide(); });
  document.addEventListener('focusin', (e) => { if (e.target.matches?.('.tip[data-tip]')) show(e.target); });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) hide(); });
  // Clicar no "i" não faz nada além de mostrar (não envia formulário, não fecha menu)
  document.addEventListener('click', (e) => { const t = e.target.closest?.('.tip[data-tip]'); if (t) { e.preventDefault(); e.stopPropagation(); show(t); } }, true);
})();
