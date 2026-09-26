'use strict';
// Janelas flutuantes (picture in picture).
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, tema, voz, membros, assistir.

// ---------- Janela flutuante ----------
// A página abre a janela (about:blank, mesmo processo) e monta nela um <video> com o mesmo MediaStream do
// tile: nada é decodificado de novo. O processo principal cuida de deixar a janela por cima, sem foco e,
// travada, com o clique atravessando.
// Cada transmissão pode ter a sua janela; o nome da janela leva o id para o processo principal saber de quem é
function togglePip(id) {
  if (state.pips.has(id)) return closePip(id);
  const win = window.open('', `tela-pip-${id}`);
  if (!win) return toast('Não foi possível abrir a janela flutuante.', 'error');
  const p = buildPip(win, id);
  state.pips.set(id, p);
  setPipStream(id);
}

function pipButton(d, text, onClick, primary) {
  const b = d.createElement('button');
  b.type = 'button';
  b.textContent = text;
  Object.assign(b.style, {
    font: 'inherit', fontSize: '12px', fontWeight: '600', height: '28px', padding: '0 10px', borderRadius: '6px', cursor: 'pointer',
    border: '1px solid ' + (primary ? THEME.primary : THEME.line), background: primary ? THEME.primary : THEME.card, color: primary ? THEME.onPrimary : THEME.text,
  });
  b.style.setProperty('-webkit-app-region', 'no-drag');
  b.onclick = onClick;
  return b;
}

// Tudo por CSSOM: a página herda a regra de segurança do app, que não deixa estilo escrito em HTML
function buildPip(win, id) {
  const d = win.document;
  d.documentElement.style.height = '100%';
  Object.assign(d.body.style, {
    margin: '0', height: '100%', overflow: 'hidden', background: '#000000', color: THEME.text, userSelect: 'none',
    fontFamily: THEME.font,
  });
  const video = d.createElement('video');
  video.autoplay = true;
  video.muted = true; // o som continua saindo pelo app, com o volume de cada tela
  video.playsInline = true;
  Object.assign(video.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', objectFit: 'contain' });

  // Modo de ajuste: borda, nome, botões e a dica; a janela inteira arrasta
  const edit = d.createElement('div');
  Object.assign(edit.style, {
    position: 'fixed', inset: '0', boxSizing: 'border-box', border: `2px solid ${THEME.accent}`, padding: '8px',
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '8px',
    background: 'rgba(0, 0, 0, .35)', fontSize: '12px', cursor: 'move',
  });
  edit.style.setProperty('-webkit-app-region', 'drag');
  const top = d.createElement('div');
  Object.assign(top.style, { display: 'flex', alignItems: 'center', gap: '6px' });
  const name = d.createElement('span');
  Object.assign(name.style, { flex: '1', fontSize: '13px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 2px #000' });
  Object.assign(top.style, { background: 'rgba(0, 0, 0, .72)', margin: '-8px -8px 0', padding: '8px' });
  const sizes = d.createElement('div');
  Object.assign(sizes.style, { display: 'flex', gap: '2px', padding: '2px', background: THEME.sunken, borderRadius: '6px' });
  sizes.style.setProperty('-webkit-app-region', 'no-drag');
  for (const key of ['P', 'M', 'G']) {
    const b = pipButton(d, key, () => window.api.pipSize(id, key), false);
    Object.assign(b.style, { width: '28px', height: '24px', padding: '0', border: '0', borderRadius: '4px', background: 'transparent', color: THEME.muted });
    b.title = { P: 'Pequena', M: 'Média', G: 'Grande' }[key];
    sizes.append(b);
  }
  top.append(name, sizes, pipButton(d, 'Travar', () => window.api.pipSetEdit(false), true), pipButton(d, 'Fechar', () => closePip(id), false));
  const bottom = d.createElement('div');
  Object.assign(bottom.style, { display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(0, 0, 0, .72)', margin: '0 -8px -8px', padding: '8px 10px' });
  const opacityRow = d.createElement('label');
  Object.assign(opacityRow.style, { display: 'flex', alignItems: 'center', gap: '8px', color: '#d0d0d0' });
  opacityRow.style.setProperty('-webkit-app-region', 'no-drag');
  const opacity = d.createElement('input');
  opacity.type = 'range';
  opacity.min = '40';
  opacity.max = '100';
  opacity.value = '100';
  Object.assign(opacity.style, { flex: '1', accentColor: THEME.accent });
  opacity.oninput = () => window.api.pipOpacity(id, Number(opacity.value) / 100);
  opacityRow.append('Transparência', opacity);

  // Com 2 ou mais janelas: mesmo tamanho para todas e como enfileirar (coluna ou linha, a partir de qual canto)
  const groupRow = d.createElement('div');
  Object.assign(groupRow.style, { display: 'none', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', color: '#d0d0d0' });
  groupRow.style.setProperty('-webkit-app-region', 'no-drag');
  const linkedLabel = d.createElement('label');
  Object.assign(linkedLabel.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' });
  const linked = d.createElement('input');
  linked.type = 'checkbox';
  linked.style.accentColor = THEME.accent;
  linked.onchange = () => window.api.pipGroup(id, { linked: linked.checked });
  linkedLabel.append(linked, 'Todas do mesmo tamanho');
  const seg = (items, onPick) => {
    const box = d.createElement('div');
    Object.assign(box.style, { display: 'flex', gap: '2px', padding: '2px', background: THEME.sunken, borderRadius: '6px' });
    const btns = {};
    for (const [key, text, title] of items) {
      const b = pipButton(d, text, () => onPick(key), false);
      Object.assign(b.style, { minWidth: '26px', height: '24px', padding: '0 7px', border: '0', borderRadius: '4px' });
      b.title = title;
      b.setAttribute('aria-label', title);
      btns[key] = b;
      box.append(b);
    }
    return { box, btns };
  };
  const layoutSeg = seg([['coluna', 'Coluna', 'Enfileirar em coluna'], ['linha', 'Linha', 'Enfileirar em linha']],
    (layout) => window.api.pipGroup(id, { layout }));
  const cornerSeg = seg([['tl', '↖', 'Começar no canto de cima à esquerda'], ['tr', '↗', 'Começar no canto de cima à direita'],
    ['bl', '↙', 'Começar no canto de baixo à esquerda'], ['br', '↘', 'Começar no canto de baixo à direita']],
    (corner) => window.api.pipGroup(id, { corner }));
  groupRow.append(linkedLabel, layoutSeg.box, cornerSeg.box);

  const hint = d.createElement('span');
  hint.textContent = 'Arraste para mover · puxe um canto para redimensionar · Ctrl+Shift+E trava todas';
  Object.assign(hint.style, { lineHeight: '1.35', color: '#d0d0d0' });
  bottom.append(groupRow, opacityRow, hint);
  // Janela baixa (tamanho P): a dica sai para caber o resto
  const fitHint = () => { hint.style.display = win.innerHeight < 230 ? 'none' : ''; };
  win.addEventListener('resize', fitHint);
  fitHint();
  edit.append(top, bottom);

  // Travada: só uma etiqueta pequena com o nome; ao travar, um aviso rápido
  const lockTag = d.createElement('span');
  Object.assign(lockTag.style, {
    position: 'fixed', top: '8px', left: '8px', display: 'none', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: '600',
    padding: '3px 7px', borderRadius: '5px', background: 'rgba(0, 0, 0, .55)', color: 'rgba(237, 237, 237, .85)',
  });
  const notice = d.createElement('span');
  notice.textContent = 'Janela travada: o clique vai para o jogo · Ctrl+Shift+E para ajustar';
  Object.assign(notice.style, {
    position: 'fixed', left: '50%', bottom: '10px', transform: 'translateX(-50%)', display: 'none', whiteSpace: 'nowrap',
    fontSize: '12px', padding: '6px 10px', borderRadius: '8px', background: THEME.glass, border: `1px solid ${THEME.line}`,
  });
  // Borda verde quando a pessoa desta janela fala; embaixo, quem mais está falando na voz
  const speakRing = d.createElement('div');
  Object.assign(speakRing.style, { position: 'fixed', inset: '0', border: `2px solid ${THEME.ok}`, display: 'none', pointerEvents: 'none' });
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    speakRing.animate([{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], { duration: 1100, iterations: Infinity, easing: 'ease-in-out' });
  }
  const talkers = d.createElement('div');
  Object.assign(talkers.style, { position: 'fixed', left: '8px', bottom: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px', pointerEvents: 'none' });
  d.body.append(video, speakRing, talkers, edit, lockTag, notice);
  const p = { win, id, video, edit, name, opacity, lockTag, notice, noticeTimer: null, groupRow, linked, layoutSeg, cornerSeg, speakRing, talkers };
  requestAnimationFrame(() => renderPipSpeaking());
  return p;
}

function renderPipSpeaking() {
  for (const p of state.pips.values()) {
    if (p.win.closed) continue;
    const d = p.win.document;
    p.speakRing.style.display = speaking.has(p.id) ? 'block' : 'none';
    const others = [...speaking].filter((id) => id !== p.id && id !== state.myId && state.members.has(id));
    p.talkers.replaceChildren(...others.map((id) => talkerChip(d, id)));
  }
}

// Os controles de grupo aparecem só com 2 ou mais janelas, e mostram a escolha atual em todas
let pipGroupState = { linked: false, layout: 'coluna', corner: 'br' };
function renderPipGroup() {
  const many = state.pips.size > 1;
  const g = pipGroupState;
  for (const p of state.pips.values()) {
    if (p.win.closed) continue;
    p.groupRow.style.display = many ? 'flex' : 'none';
    p.linked.checked = g.linked;
    for (const [segKey, seg] of [['layout', p.layoutSeg], ['corner', p.cornerSeg]]) {
      for (const [key, b] of Object.entries(seg.btns)) {
        const on = g[segKey] === key;
        b.style.background = on ? THEME.accentSoft : 'transparent';
        b.style.color = on ? THEME.accent : THEME.muted;
        b.setAttribute('aria-pressed', String(on));
      }
    }
  }
}

function setPipStream(id) {
  const link = state.in.get(id);
  const p = state.pips.get(id);
  if (!link || !p || p.win.closed) return;
  refreshTileStream(link);
  p.name.textContent = link.tile.name;
  p.lockTag.textContent = link.tile.name;
  p.win.document.title = `${link.tile.name} · Tela P2P`;
  syncIncomingVideo();
  renderPipButtons();
}

function closePip(id) {
  const p = state.pips.get(id);
  state.pips.delete(id);
  if (p && !p.win.closed) p.win.close();
  pipClosed(p);
}

// O vídeo volta para o quadro no app
function pipClosed(p) {
  const link = p && state.in.get(p.id);
  if (link) refreshTileStream(link);
  syncIncomingVideo();
  renderPipButtons();
}

function renderPipButtons() {
  for (const [id, link] of state.in) {
    const on = state.pips.has(id);
    setIcon(link.tile.pipBtn, 'pip', on ? 'Fechar a janela flutuante' : 'Abrir em janela flutuante (fica por cima do jogo)');
    link.tile.pipBtn.classList.toggle('on', on);
    link.tile.pipNote.hidden = !on;
  }
  // Barra: quais transmissões estão em janela flutuante, com o atalho e o X (fecha todas)
  renderPipGroup();
  const names = [...state.pips.keys()].filter((id) => state.in.has(id)).map((id) => state.in.get(id).tile.name);
  $('pipChip').hidden = !names.length;
  $('pipChipText').textContent = names.length === 1 ? `Janela flutuante: ${names[0]}` : `Janelas flutuantes: ${names.join(', ')}`;
  setIcon($('pipChipClose'), 'close', names.length > 1 ? 'Fechar as janelas flutuantes' : 'Fechar a janela flutuante');
  if (state.myId) renderMembers();
}

function setPipLocked(p, locked) {
  p.edit.style.display = locked ? 'none' : 'flex';
  p.lockTag.style.display = locked ? 'inline-flex' : 'none';
  clearTimeout(p.noticeTimer);
  p.notice.style.display = locked ? 'block' : 'none';
  if (locked) p.noticeTimer = setTimeout(() => { p.notice.style.display = 'none'; }, 3000);
}
