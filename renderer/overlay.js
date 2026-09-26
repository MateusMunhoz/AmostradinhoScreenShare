'use strict';
// Chat por cima do jogo.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, tema, pip, chat.

// ---------- Chat por cima do jogo ----------
// Uma janela transparente, sempre por cima, com as últimas mensagens (somem depois de 20 s) e quem está
// falando na voz. Travada, o clique atravessa para o jogo. No modo de ajuste (Ctrl+Shift+E, o mesmo da
// janela flutuante) dá para mover, redimensionar e responder. Ctrl+Shift+O esconde e mostra de novo.
const OVERLAY_SHOW_MS = 20000;
const overlay = { p: null, edit: false, compose: false, timer: null };

// Ctrl+Enter no jogo: abre o chat por cima do jogo (se estiver fechado) já com o campo de escrever
async function onComposeKey() {
  if (!state.myId || !chat.supported) return;
  if (overlay.compose) return endCompose();
  if (!overlay.p || overlay.p.win.closed) {
    await window.api.chatCompose(true, true);
    toggleChatOverlay();
    return;
  }
  window.api.chatCompose(true);
}
function endCompose() {
  if (!overlay.compose) return;
  window.api.chatCompose(false);
}

function toggleChatOverlay() {
  if (overlay.p && !overlay.p.win.closed) return closeChatOverlay();
  const win = window.open('', 'tela-chat');
  if (!win) return toast('Não foi possível abrir o chat por cima do jogo.', 'error');
  overlay.p = buildChatOverlay(win);
  renderChatOverlay();
  renderOverlayButton();
}

function closeChatOverlay() {
  const p = overlay.p;
  overlay.p = null;
  clearTimeout(overlay.timer);
  if (p && !p.win.closed) p.win.close();
  renderOverlayButton();
}

function renderOverlayButton() {
  const on = !!overlay.p;
  setIcon($('overlayToggle'), 'overlay', on
    ? 'Fechar o chat por cima do jogo (Ctrl+Shift+O esconde e mostra)'
    : 'Chat por cima do jogo: as mensagens aparecem sobre a tela. Ctrl+Enter escreve, Ctrl+Shift+O esconde');
  $('overlayToggle').setAttribute('aria-pressed', String(on));
  $('overlayToggle').classList.toggle('on', on);
}

// Tudo por CSSOM, como a janela flutuante (a regra de segurança do app não deixa estilo escrito em HTML)
function buildChatOverlay(win) {
  const d = win.document;
  Object.assign(d.documentElement.style, { height: '100%', background: 'transparent' });
  Object.assign(d.body.style, {
    margin: '0', height: '100%', overflow: 'hidden', background: 'transparent', color: THEME.text,
    fontFamily: THEME.font, fontSize: '14px',
  });
  d.title = 'Chat da sala · Tela P2P';
  const frame = d.createElement('div');
  Object.assign(frame.style, {
    position: 'fixed', inset: '0', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px',
  });
  // Cabeçalho do modo de ajuste: arrasta a janela, trava e fecha
  const head = d.createElement('div');
  Object.assign(head.style, {
    display: 'none', alignItems: 'center', gap: '6px', padding: '6px 6px 6px 10px', borderRadius: '8px',
    background: THEME.glass, fontSize: '12px', cursor: 'move',
  });
  head.style.setProperty('-webkit-app-region', 'drag');
  const title = d.createElement('span');
  title.textContent = 'Chat da sala · arraste para mover';
  Object.assign(title.style, { flex: '1', fontWeight: '600' });
  head.append(title, pipButton(d, 'Travar', () => window.api.pipSetEdit(false), true), pipButton(d, 'Fechar', () => closeChatOverlay(), false));
  // Quem está falando agora
  const talkers = d.createElement('div');
  Object.assign(talkers.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
  // Mensagens: as mais novas embaixo
  const list = d.createElement('div');
  Object.assign(list.style, { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '4px', overflow: 'hidden' });
  // Responder (só no modo de ajuste, quando a janela pode receber o teclado)
  const form = d.createElement('form');
  Object.assign(form.style, { display: 'none', gap: '6px' });
  const input = d.createElement('input');
  input.type = 'text';
  input.maxLength = 2000;
  input.placeholder = 'Mensagem para a sala (Enter manda)';
  input.setAttribute('aria-label', 'Mensagem para a sala');
  Object.assign(input.style, {
    flex: '1', minWidth: '0', height: '34px', boxSizing: 'border-box', padding: '0 10px', borderRadius: '8px',
    border: `1px solid ${THEME.field}`, background: 'rgba(27, 31, 23, .92)', color: THEME.text, font: 'inherit', fontSize: '13px', outline: 'none',
  });
  input.onfocus = () => { input.style.borderColor = THEME.accent; };
  input.onblur = () => { input.style.borderColor = THEME.field; };
  form.style.setProperty('-webkit-app-region', 'no-drag');
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !chat.supported) return;
    send({ type: 'chat', text });
    input.value = '';
    endCompose();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); input.value = ''; endCompose(); }
  };
  input.addEventListener('blur', () => setTimeout(() => { if (overlay.compose && d.activeElement !== input) endCompose(); }, 150));
  form.append(input);
  const hint = d.createElement('span');
  hint.textContent = 'Ctrl+Shift+E trava · Ctrl+Shift+O esconde';
  Object.assign(hint.style, { display: 'none', fontSize: '11px', color: '#d0d0d0', textShadow: '0 1px 2px #000' });
  frame.append(head, talkers, list, form, hint);
  d.body.append(frame);
  return { win, frame, head, talkers, list, form, input, hint };
}

function renderChatOverlay() {
  const p = overlay.p;
  if (!p || p.win.closed) return;
  const d = p.win.document;
  const edit = overlay.edit;
  const open = edit || overlay.compose;
  p.frame.style.border = open ? `2px solid ${THEME.accent}` : '2px solid transparent';
  p.frame.style.background = open ? 'rgba(0, 0, 0, .35)' : 'transparent';
  p.head.style.display = edit ? 'flex' : 'none';
  p.form.style.display = open ? 'flex' : 'none';
  p.hint.style.display = open ? 'block' : 'none';
  p.hint.textContent = overlay.compose && !edit ? 'Enter manda · Esc volta para o jogo' : 'Ctrl+Shift+E trava · Ctrl+Shift+O esconde · Ctrl+Enter escreve';

  p.talkers.replaceChildren(...[...speaking].filter((id) => id !== state.myId && state.members.has(id)).map((id) => talkerChip(d, id)));

  // As últimas 6; travada, cada uma some 20 s depois de chegar
  const now = Date.now();
  const recent = chat.log.slice(-6).filter((m) => open || now - m.ts < OVERLAY_SHOW_MS);
  p.list.replaceChildren(...recent.map((m) => {
    const row = d.createElement('div');
    Object.assign(row.style, {
      alignSelf: 'flex-start', maxWidth: '100%', boxSizing: 'border-box', padding: '5px 9px', borderRadius: '8px',
      background: 'rgba(0, 0, 0, .66)', lineHeight: '1.35', overflowWrap: 'anywhere', fontSize: '13px',
    });
    const who = d.createElement('strong');
    who.textContent = m.from === state.myId ? 'Você' : m.name;
    who.style.color = m.from === state.myId ? THEME.accent : personColor(m.from);
    who.style.marginRight = '6px';
    row.append(who, m.text || `mandou ${m.file ? m.file.name : 'um arquivo'}`);
    return row;
  }));
  // Acorda quando a próxima mensagem visível tiver que sumir
  clearTimeout(overlay.timer);
  if (!open && recent.length) {
    const next = Math.min(...recent.map((m) => m.ts + OVERLAY_SHOW_MS - now));
    overlay.timer = setTimeout(renderChatOverlay, Math.max(200, next + 50));
  }
}
