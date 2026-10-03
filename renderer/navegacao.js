'use strict';
// Uma barrinha fixa na borda direita (só ícones); os botões da sala são alternadores independentes, não abas
// exclusivas. Chat e voz abrem à esquerda dela, no mesmo lugar de sempre.
const workspaceViews = (() => {
  let saved; try { saved = JSON.parse(load('workspaceViews.v1', '{}')); } catch {}
  return { chat: typeof saved?.chat === 'boolean' ? saved.chat : load('panelOpen', '1') !== '0',
    voice: typeof saved?.voice === 'boolean' ? saved.voice : true,
    streams: typeof saved?.streams === 'boolean' ? saved.streams : true };
})();
let workspaceReady = false;
let profileReturnFocus = null;
function setUtilityBackground(inert) {
  for (const el of [document.querySelector('main'), document.querySelector('.workspace-header'), $('workspacePanes')]) el.inert = inert;
}
function openProfilePopup() {
  if (!$('friendsDialog').hidden) closeFriendsDialog();
  renderConnectivitySettings();
  if (!$('generalSettingsDialog').hidden) closeGeneralSettings();
  if (!$('networkDialog').hidden) closeNetworkDialog();
  profileReturnFocus = document.activeElement;
  $('profilePane').hidden = false;
  syncWorkspace();
  setUtilityBackground(true);
  ($('profileName').disabled ? $('closeProfile') : $('profileName')).focus();
}
function closeProfilePopup() {
  $('profilePane').hidden = true;
  setUtilityBackground(false);
  syncWorkspace();
  (profileReturnFocus || $('navProfile')).focus();
}
// Fonte do nome (perfil): cada opção aparece na própria fonte; a escolha vale na hora e, na sala, vai para todos
function setupNameFont() {
  const select = $('profileNameFont');
  const none = document.createElement('option'); none.value = ''; none.textContent = 'Padrão do app';
  select.append(none);
  const groups = new Map();
  for (const f of AppPreferences.fonts.filter((x) => x.id !== 'system')) {
    if (!groups.has(f.group)) { const g = document.createElement('optgroup'); g.label = f.group; groups.set(f.group, g); select.append(g); }
    const o = document.createElement('option'); o.value = f.id; o.textContent = f.label;
    o.style.fontFamily = AppPreferences.nameFontStack(f.id);
    groups.get(f.group).append(o);
  }
  select.value = appPreferences.nameFont;
  select.listSample = () => getName(); // na lista, cada fonte mostra também o seu nome escrito nela
  select.onchange = () => {
    appPreferences.nameFont = AppPreferences.cleanNameFont(select.value);
    saveAppPreferences();
    repaintNames('');
    if (state.myId) send({ type: 'name-font', font: appPreferences.nameFont });
  };
}
function setupUtilityPopup(id, close) {
  closeOnBackdrop(id, close);
  $(id).addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...$(id).querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
function saveWorkspaceViews() { save('workspaceViews.v1', JSON.stringify(workspaceViews)); }
function syncWorkspace() {
  if (!workspaceReady) return;
  // inCall: numa sala, mesmo no menu inicial; inRoom: com a tela da sala à vista. No menu, a barrinha e os painéis de
  // chat e voz continuam (dá para conversar e mexer na voz sem voltar); só as telas ficam na sala.
  const inCall = !!state.myId, inRoom = !$('room').hidden && inCall;
  const settings = !$('generalSettingsDialog').hidden, profile = !$('profilePane').hidden;
  const roomPanes = inCall && (workspaceViews.chat || workspaceViews.voice);
  const any = roomPanes;
  $('workspacePanes').hidden = !any;
  $('chatTab').hidden = !inCall || !workspaceViews.chat;
  $('voicePane').hidden = !inCall || !workspaceViews.voice;
  $('streamArea').hidden = inRoom && !workspaceViews.streams;
  $('workspaceEmpty').hidden = any || workspaceViews.streams;
  document.body.classList.toggle('has-workspace-pane', any);
  document.body.classList.toggle('workspace-in-room', inCall);
  document.body.classList.toggle('workspace-wide', inRoom && !workspaceViews.streams && any);
  // Barra e painéis formam um bloco só: o último painel aberto fecha o bloco com os cantos de baixo
  $('chatTab').classList.toggle('pane-last', !workspaceViews.voice);
  $('voicePane').classList.toggle('pane-last', workspaceViews.voice);
  if (inRoom) syncIncomingVideo(); // telas escondidas não baixam vídeo (o som continua)
  if (mapFocus.on && !mapFocusFits()) setMapFocus(false); // o mapa em foco só existe com chat e voz na barra
  $('workspaceContext').textContent = inRoom ? 'Na sala' : 'Início';
  $('leaveBtn').hidden = $('peopleBtn').hidden = !inCall; // Sair e as pessoas: na sala e no menu
  $('dockHome').hidden = !inRoom; // no menu, o Voltar para a sala fica no lugar do Início (renderHomeCall)
  for (const [id, view] of [['navChat','chat'],['navVoice','voice'],['navStreams','streams']]) {
    $(id).hidden = !inCall;
    $(id).setAttribute('aria-pressed', String(workspaceViews[view]));
  }
  $('navSettings').setAttribute('aria-expanded', String(settings));
  $('navProfile').setAttribute('aria-expanded', String(profile));
  if (!inCall) setPeopleOpen(false);
  fitNav();
  $('profileName').disabled = !!state.myId;
  $('profileName').value = $('name').value;
  $('profileDisplayName').textContent = getName();
  paintName($('profileDisplayName'), '');
  $('profileNameFont').value = appPreferences.nameFont;
  $('profileAvatar').textContent = $('navProfileAvatar').textContent = [...getName()][0].toUpperCase();
  paintAvatar($('profileAvatar'));
  $('homeAvatar').textContent = [...getName()][0].toUpperCase();
  paintAvatar($('homeAvatar'));
  paintAvatar($('navProfileAvatar'));
  $('navProfile').title = $('navProfile').ariaLabel = 'Perfil de ' + getName();
  $('profileHint').textContent = state.myId ? 'Para trocar o nome, saia da sala.' : '';
  renderVoicePane();
  renderHomeCall();
  renderHub();
}
// Barra de baixo numa linha só: sem espaço, enxuga em etapas até caber (o que some continua na tela em outro
// lugar): 1) o texto "2 assistindo" do Ao vivo; 2) os textos "Na voz" e "Convidar" (ficam os ícones);
// 3) os nomes nas bolinhas de quem está na voz (fica a foto ou a inicial); 4) as bolinhas (estão no painel Voz)
const DOCK_STEPS = ['tight-1', 'tight-2', 'tight-3', 'tight-4'];
// 5) ainda sem espaço: os botões saem da barra para o menu da setinha ^, nesta ordem (os mais usados por último).
// stageLayout é o grupo Grade/Destaque: no menu vira os dois itens.
const DOCK_OVERFLOW = ['openStatsRoom', 'overlayToggle', 'stageLayout', 'dockAddr', 'voiceSettingsBtn', 'chatToggle',
  'voiceDeafen', 'selfViewBtn', 'switchShareBtn', 'voiceMute', 'voiceJoin'];
function fitDock() {
  const dock = document.querySelector('.dock');
  if (!dock || !dock.offsetParent) return;
  const fits = () => dock.scrollWidth <= dock.clientWidth + 1;
  dock.classList.remove(...DOCK_STEPS);
  for (const el of dock.querySelectorAll('.dock-overflow')) el.classList.remove('dock-overflow');
  $('dockMoreWrap').hidden = true;
  for (const step of DOCK_STEPS) {
    if (fits()) break;
    dock.classList.add(step);
  }
  if (!fits()) {
    $('dockMoreWrap').hidden = false;
    for (const id of DOCK_OVERFLOW) {
      if (fits()) break;
      if ($(id).getClientRects().length) $(id).classList.add('dock-overflow');
    }
  }
  const moved = DOCK_OVERFLOW.filter((id) => $(id).classList.contains('dock-overflow'));
  if (!moved.length) closeDockMore();
  else if (!$('dockMoreMenu').hidden) buildDockMore();
  // Mensagem nova com o botão do chat dentro do menu: a bolinha aparece na setinha
  $('dockMore').classList.toggle('has-unread', moved.includes('chatToggle') && !$('chatUnread').hidden);
}
function buildDockMore() {
  const menu = $('dockMoreMenu');
  menu.replaceChildren();
  for (const id of DOCK_OVERFLOW) {
    const box = $(id);
    if (!box.classList.contains('dock-overflow')) continue;
    for (const original of box.matches('button') ? [box] : box.querySelectorAll('button')) {
      const full = original.getAttribute('aria-label') || original.title || original.textContent.trim();
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dock-more-item';
      item.setAttribute('role', 'menuitem');
      item.title = full;
      item.disabled = original.disabled;
      const icon = original.querySelector('svg');
      if (icon) item.append(icon.cloneNode(true));
      const label = document.createElement('span');
      // O nome curto: o texto que o botão mostra na barra ("Convidar", "Grade") ou a dica até os dois-pontos
      // ("Estatísticas: desempenho do PC…" vira "Estatísticas")
      label.textContent = original.querySelector('.dock-label')?.textContent || (original.getAttribute('aria-label') ? full.split(':')[0] : original.textContent.trim() || full.split(':')[0]);
      item.append(label);
      if (original.getAttribute('aria-pressed') === 'true') item.classList.add('on');
      if (id === 'chatToggle' && !$('chatUnread').hidden) item.append($('chatUnread').cloneNode(true));
      item.onclick = () => { closeDockMore(); original.click(); };
      menu.append(item);
    }
  }
}
function openDockMore() {
  buildDockMore();
  $('dockMoreMenu').hidden = false;
  $('dockMore').setAttribute('aria-expanded', 'true');
  $('dockMoreMenu').querySelector('button:not(:disabled)')?.focus();
}
function closeDockMore(focusButton = false) {
  if ($('dockMoreMenu').hidden) return;
  $('dockMoreMenu').hidden = true;
  $('dockMore').setAttribute('aria-expanded', 'false');
  if (focusButton) $('dockMore').focus();
}
function watchDock() {
  const dock = document.querySelector('.dock');
  setIcon($('dockMore'), 'chevronUp', 'Mais controles (não couberam na barra)');
  $('dockMore').onclick = () => ($('dockMoreMenu').hidden ? openDockMore() : closeDockMore(true));
  $('dockMoreMenu').addEventListener('keydown', (e) => {
    const items = [...$('dockMoreMenu').querySelectorAll('button:not(:disabled)')];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDockMore(true); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === 'Tab') closeDockMore();
  });
  document.addEventListener('mousedown', (e) => { if (!$('dockMoreWrap').contains(e.target)) closeDockMore(); });
  let queued = false;
  const again = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fitDock(); }); };
  new ResizeObserver(again).observe(dock);
  // O próprio menu muda ao medir e ao abrir: mudanças dentro dele não medem de novo (senão mede sem parar)
  new MutationObserver((records) => { if (records.some((r) => !$('dockMoreWrap').contains(r.target))) again(); })
    .observe(dock, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  // Trocar a fonte ou o tema muda a largura dos botões sem mudar a da barra: mede de novo (as fontes do app
  // chegam depois, por isso também quando uma termina de carregar)
  new MutationObserver(again).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-skin'] });
  document.fonts?.addEventListener('loadingdone', again);
}
// Barra sem espaço (janela estreita, fonte larga): Chat, Voz e Transmissão ficam só com o ícone. Na barrinha da
// direita eles já são só ícone; continua aqui para quem mede a barra.
function fitNav() {
  const nav = $('workspaceNav');
  nav.classList.remove('nav-tight');
  if (nav.scrollWidth > nav.clientWidth + 1) nav.classList.add('nav-tight');
}

// Seção da voz. Fora dela: "Voz e atalhos" no título e Entrar como botão principal. Na voz: embaixo da lista, uma
// faixa com microfone, fone e Voz e atalhos (só o ícone, o nome na dica) e, à direita, Sair da voz.
function layoutVoicePane(active) {
  const pane = $('voicePane'), head = pane.querySelector('.pane-head'), actions = pane.querySelector('.pane-voice-actions');
  const settings = $('paneVoiceSettings'), join = $('paneVoiceJoin');
  pane.classList.toggle('voice-in-call', active);
  if (active) { setIcon(settings, 'sliders', 'Voz e atalhos'); settings.className = 'btn small icon'; actions.append(settings); }
  else { settings.textContent = 'Voz e atalhos'; settings.className = 'btn small'; settings.removeAttribute('title'); settings.removeAttribute('aria-label'); head.append(settings); }
  join.disabled = !voice.supported;
  if (active) { join.innerHTML = ICON.phoneOff; join.append('Sair da voz'); join.className = 'btn small danger pane-leave'; }
  else { join.textContent = voice.pending ? 'Cancelar' : subsalasOn() ? 'Entrar na Voz geral' : 'Entrar na voz'; join.className = 'btn small pane-join' + (voice.pending ? '' : ' primary'); }
  actions.append(join);
  // Nova subsala: fora da voz, ao lado do Entrar; na voz, na faixa, antes do Sair (cria e já entra: createSubsala)
  const sub = $('paneVoiceSubsala');
  sub.hidden = !subsalasOn() || !state.myId;
  sub.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  sub.append(active ? 'Subsala' : 'Nova subsala');
  sub.disabled = !voice.supported;
  if (active) actions.insertBefore(sub, join); else actions.append(sub);
  $('paneVoiceMute').hidden = $('paneVoiceDeafen').hidden = !active;
  const toggle = (btn, on, iconOn, iconOff, textOn, textOff) => {
    setIcon(btn, on ? iconOn : iconOff, on ? textOn : textOff);
    btn.setAttribute('aria-pressed', String(on));
  };
  toggle($('paneVoiceMute'), voice.muted, 'micOff', 'mic', 'Ligar microfone', 'Desligar microfone');
  toggle($('paneVoiceDeafen'), voice.deafened, 'headphonesOff', 'headphones', 'Ouvir vozes', 'Silenciar vozes');
  actions.prepend($('paneVoiceMute'), $('paneVoiceDeafen'));
}
// ---------- Início sem sair da sala ----------
// O botão Início da barra de baixo troca para o saguão; a sala continua (voz, chat, telas, avisos). No saguão, uma
// faixa mostra a sala, quem está nela, a sua voz e o Voltar (com as mensagens novas).
function goHomeKeepCall() { if (state.myId) show('home'); }
function backToRoom() { if (state.myId) { show('room'); markChatSeenIfVisible(); } }
function markChatSeenIfVisible() { if (chat.open && chatAtBottom() && !mapFocus.on) markRead(); }
function renderHomeCall() {
  const inCall = !!state.myId;
  $('homeCall').hidden = !inCall;
  // Barrinha da direita: no menu, com a sala aberta, o botão de voltar fica no pé (com as mensagens novas)
  const back = inCall && $('room').hidden, unread = chat.unread;
  $('navBackToRoom').hidden = !back;
  $('navBackUnread').hidden = !back || !unread;
  $('navBackUnread').textContent = unread > 99 ? '99+' : String(unread);
  $('navBackToRoom').title = $('navBackToRoom').ariaLabel = unread ? `Voltar para a sala · ${unread} ${unread === 1 ? 'mensagem nova' : 'mensagens novas'}` : 'Voltar para a sala';
  // Numa sala: criar ou entrar em outra fica bloqueado (sairia desta sem querer)
  for (const id of ['goCreate', 'goJoin', 'rejoinBtn']) $(id).disabled = inCall;
  $('goCreate').title = $('goJoin').title = inCall ? 'Você já está numa sala: volte para ela e saia antes' : '';
  if (!inCall) return;
  const host = state.hostId === state.myId ? 'você' : nameOf(state.hostId);
  $('homeCallTitle').textContent = host === 'você' ? 'Sua sala' : `Sala de ${host}`;
  const people = state.members.size + 1;
  const sharing = [...state.members.values()].filter((m) => m.sharing).length + (state.sharing ? 1 : 0);
  const where = voice.session && voice.channel ? `você em ${channelName(voice.channel)}` : 'você na voz';
  $('homeCallSub').textContent = [people === 1 ? 'só você' : `${people} pessoas`, voice.session ? (voice.muted ? `${where}, microfone desligado` : where) : 'fora da voz',
    sharing ? (sharing === 1 ? '1 transmitindo' : `${sharing} transmitindo`) : ''].filter(Boolean).join(' · ');
  $('homeCallMute').hidden = $('homeCallDeafen').hidden = !voice.session;
  setIcon($('homeCallMute'), voice.muted ? 'micOff' : 'mic', voice.muted ? 'Ligar o microfone' : 'Desligar o microfone');
  $('homeCallMute').setAttribute('aria-pressed', String(voice.muted));
  setIcon($('homeCallDeafen'), voice.deafened ? 'headphonesOff' : 'headphones', voice.deafened ? 'Ouvir as vozes' : 'Silenciar as vozes');
  $('homeCallDeafen').setAttribute('aria-pressed', String(voice.deafened));
  const n = chat.unread;
  $('homeCallBack').textContent = n ? `Voltar para a sala · ${n > 99 ? '99+' : n} ${n === 1 ? 'nova' : 'novas'}` : 'Voltar para a sala';
}
function setupHomeCall() {
  $('dockHome').onclick = goHomeKeepCall;
  $('homeCallBack').onclick = $('navBackToRoom').onclick = backToRoom;
  $('homeCallMute').onclick = () => $('voiceMute').click();
  $('homeCallDeafen').onclick = () => $('voiceDeafen').click();
}

function renderVoicePane() {
  if (!workspaceReady || $('voicePane').hidden) return; // escondido, não precisa redesenhar a cada mudança da voz
  if (voiceDrag) { voiceDragPending = true; return; } // arrastando alguém para outro canal: redesenha ao soltar
  const active = !!voice.session;
  const ids = [...voice.members].filter(([id,m]) => m.session && state.members.has(id)).map(([id]) => id);
  const people = (n) => (n === 1 ? '1 pessoa' : `${n} pessoas`);
  const channels = subsalasOn(); // com subsalas, a lista vem por canal (renderer/subsalas.js)
  $('voicePaneStatus').textContent = !voice.supported ? 'Voz indisponível nesta sala.' : voice.pending ? 'Aguardando o microfone…'
    : active ? (channels && voice.channel ? `Você está em ${channelName(voice.channel)} · ${people(ids.length + 1)} na voz` : `Você está na voz · ${people(ids.length + 1)}`)
    : `${people(ids.length)} na voz.`;
  layoutVoicePane(active);
  // Quem está transmitindo tem o botão Assistir na frente do nome; quem transmite fora da voz aparece embaixo
  const list = $('voicePaneMembers'); list.replaceChildren();
  const sharing = (id) => !!state.members.get(id)?.sharing;
  const map = voiceMapOn();
  $('voicePane').classList.toggle('voice-map', map);
  if (map) { /* no mapa, os canais e as pessoas estão no céu */ }
  else if (channels) renderVoiceChannels(list);
  else {
    if (active) list.append(memberRow(null, `${getName()} (você)`, state.sharing));
    for (const id of ids) list.append(memberRow(id, nameOf(id), sharing(id)));
  }
  renderVoiceSky(); // o céu (pequeno, em cima da lista) ou o mapa (no lugar da lista): renderer/ceu-voz.js
  const outside = [...state.members.keys()].filter((id) => sharing(id) && !ids.includes(id));
  if (!active && state.sharing) outside.unshift(null);
  if (outside.length) {
    const head = document.createElement('li');
    head.className = 'members-sub';
    head.textContent = 'Transmitindo, fora da voz';
    list.append(head);
    for (const id of outside) list.append(id ? memberRow(id, nameOf(id), true) : memberRow(null, `${getName()} (você)`, true));
  }
}
function setupWorkspace() {
  setupConnectionMap();
  const host = $('workspacePanes');
  host.insertBefore($('chatTab'), $('voicePane'));
  $('chatTab').classList.add('workspace-pane');
  host.append($('peoplePop'));
  document.body.append($('profilePane'), $('generalSettingsDialog'));
  $('sidePanel').hidden = true;
  $('generalSettingsDialog').setAttribute('aria-labelledby', 'generalSettingsTitle');
  const icons = {navSettings: '<svg viewBox="0 0 24 24"><path d="m9 3 1-2h4l1 2 2 1 2 0 2 3-1 2v3l1 2-2 3h-2l-2 1-1 3h-4l-1-3-2-1H5l-2-3 1-2V9L3 7l2-3h2z"/><circle cx="12" cy="11" r="3"/></svg>',
    navChat: ICON.chat, navVoice: ICON.mic, navStreams: '<svg viewBox="0 0 24 24"><path d="M3 4h18v13H3zM8 21h8M12 17v4"/></svg>'};
  for (const [id, icon] of Object.entries(icons)) $(id).querySelector('.nav-icon').innerHTML = icon;
  // Só com o ícone (barra apertada), o nome da aba continua na dica e no leitor de tela
  for (const id of ['navChat', 'navVoice', 'navStreams']) {
    const name = $(id).querySelector('.nav-icon + span').textContent;
    $(id).title = name;
    $(id).setAttribute('aria-label', name);
  }
  new ResizeObserver(() => fitNav()).observe($('workspaceNav'));
  $('navProfile').onclick = openProfilePopup;
  $('closeProfile').onclick = closeProfilePopup;
  setupUtilityPopup('profilePane', closeProfilePopup);
  setupUtilityPopup('generalSettingsDialog', closeGeneralSettings);
  $('navSettings').onclick = () => $('generalSettingsDialog').hidden ? openGeneralSettings() : closeGeneralSettings();
  $('navChat').onclick = () => setPanelOpen(!workspaceViews.chat);
  $('navVoice').onclick = () => { workspaceViews.voice = !workspaceViews.voice; saveWorkspaceViews(); syncWorkspace(); };
  // As telas só existem na sala: no menu, Transmissão volta para ela (com as telas à vista)
  $('navStreams').onclick = () => {
    if ($('room').hidden) { if (!workspaceViews.streams) { workspaceViews.streams = true; saveWorkspaceViews(); } backToRoom(); return; }
    workspaceViews.streams = !workspaceViews.streams; saveWorkspaceViews(); syncWorkspace();
  };
  $('profileName').oninput = () => { if (state.myId) return; $('name').value = $('profileName').value; save('name', $('name').value); $('profileDisplayName').textContent = getName(); $('profileAvatar').textContent = $('navProfileAvatar').textContent = [...getName()][0].toUpperCase(); $('navProfile').title = $('navProfile').ariaLabel = 'Perfil de ' + getName(); };
  $('name').addEventListener('input', syncWorkspace);
  setupNameFont();
  setupHomeCall();
  for (const [proxy, original] of [['paneVoiceJoin','voiceJoin'],['paneVoiceMute','voiceMute'],['paneVoiceDeafen','voiceDeafen'],['paneVoiceSettings','voiceSettingsBtn']]) $(proxy).onclick = () => $(original).click();
  $('streamPeople').onclick = () => {
    if (!workspaceViews.chat) setPanelOpen(true);
    setPeopleOpen($('peoplePop').hidden);
  };
  workspaceReady = true;
  syncWorkspace();
}
