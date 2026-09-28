'use strict';
// Uma barra fixa; os botões da sala são alternadores independentes, não abas exclusivas.
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
  if (!$('generalSettingsDialog').hidden) closeGeneralSettings();
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
  const inRoom = !$('room').hidden && !!state.myId;
  const settings = !$('generalSettingsDialog').hidden, profile = !$('profilePane').hidden;
  const roomPanes = inRoom && (workspaceViews.chat || workspaceViews.voice);
  const any = roomPanes;
  $('workspacePanes').hidden = !any;
  $('chatTab').hidden = !inRoom || !workspaceViews.chat;
  $('voicePane').hidden = !inRoom || !workspaceViews.voice;
  $('streamArea').hidden = inRoom && !workspaceViews.streams;
  $('workspaceEmpty').hidden = any || workspaceViews.streams;
  document.body.classList.toggle('has-workspace-pane', any);
  document.body.classList.toggle('workspace-in-room', inRoom);
  document.body.classList.toggle('workspace-wide', inRoom && !workspaceViews.streams && any);
  if (inRoom) syncIncomingVideo(); // telas escondidas não baixam vídeo (o som continua)
  $('workspaceContext').textContent = inRoom ? 'Na sala' : 'Início';
  for (const [id, view] of [['navChat','chat'],['navVoice','voice'],['navStreams','streams']]) {
    $(id).hidden = !inRoom;
    $(id).setAttribute('aria-pressed', String(workspaceViews[view]));
  }
  $('navSettings').setAttribute('aria-expanded', String(settings));
  $('navProfile').setAttribute('aria-expanded', String(profile));
  if (!inRoom) setPeopleOpen(false);
  $('profileName').disabled = inRoom;
  $('profileName').value = $('name').value;
  $('profileDisplayName').textContent = getName();
  $('profileAvatar').textContent = $('navProfileAvatar').textContent = [...getName()][0].toUpperCase();
  paintAvatar($('profileAvatar'));
  paintAvatar($('navProfileAvatar'));
  $('navProfile').title = $('navProfile').ariaLabel = 'Perfil de ' + getName();
  $('profileHint').textContent = inRoom ? 'Este é o nome usado nesta sala. Para alterá-lo, saia da sala primeiro.' : 'Seu nome fica salvo neste dispositivo e é usado ao entrar em uma sala.';
  renderVoicePane();
}
// Barra de baixo numa linha só: sem espaço, enxuga em etapas até caber (o que some continua na tela em outro
// lugar): 1) o texto "2 assistindo" do Ao vivo; 2) os textos "Na voz" e "Convidar" (ficam os ícones);
// 3) os nomes nas bolinhas de quem está na voz (fica a foto ou a inicial); 4) as bolinhas (estão no painel Voz)
const DOCK_STEPS = ['tight-1', 'tight-2', 'tight-3', 'tight-4'];
function fitDock() {
  const dock = document.querySelector('.dock');
  if (!dock || !dock.offsetParent) return;
  dock.classList.remove(...DOCK_STEPS);
  for (const step of DOCK_STEPS) {
    if (dock.scrollWidth <= dock.clientWidth + 1) break;
    dock.classList.add(step);
  }
}
function watchDock() {
  const dock = document.querySelector('.dock');
  let queued = false;
  const again = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fitDock(); }); };
  new ResizeObserver(again).observe(dock);
  new MutationObserver(again).observe(dock, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
}

function renderVoicePane() {
  if (!workspaceReady || $('voicePane').hidden) return; // escondido, não precisa redesenhar a cada mudança da voz
  const active = !!voice.session;
  const ids = [...voice.members].filter(([id,m]) => m.session && state.members.has(id)).map(([id]) => id);
  $('voicePaneStatus').textContent = !voice.supported ? 'Voz indisponível nesta sala.' : voice.pending ? 'Aguardando o microfone…'
    : active ? `Você está na voz · ${ids.length + 1} participante(s)` : `${ids.length} participante(s). Abrir este painel não liga o microfone.`;
  $('paneVoiceJoin').textContent = voice.pending ? 'Cancelar' : active ? 'Sair da voz' : 'Entrar na voz';
  $('paneVoiceJoin').disabled = !voice.supported;
  $('paneVoiceMute').hidden = $('paneVoiceDeafen').hidden = !active;
  $('paneVoiceMute').textContent = voice.muted ? 'Ligar microfone' : 'Mutar microfone';
  $('paneVoiceMute').setAttribute('aria-pressed', String(voice.muted));
  $('paneVoiceDeafen').textContent = voice.deafened ? 'Ouvir vozes' : 'Silenciar vozes';
  $('paneVoiceDeafen').setAttribute('aria-pressed', String(voice.deafened));
  // Quem está transmitindo tem o botão Assistir na frente do nome; quem transmite fora da voz aparece embaixo
  const list = $('voicePaneMembers'); list.replaceChildren();
  const sharing = (id) => !!state.members.get(id)?.sharing;
  if (active) list.append(memberRow(null, `${getName()} (você)`, state.sharing));
  for (const id of ids) list.append(memberRow(id, nameOf(id), sharing(id)));
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
  $('navProfile').onclick = openProfilePopup;
  $('closeProfile').onclick = closeProfilePopup;
  setupUtilityPopup('profilePane', closeProfilePopup);
  setupUtilityPopup('generalSettingsDialog', closeGeneralSettings);
  $('navSettings').onclick = () => $('generalSettingsDialog').hidden ? openGeneralSettings() : closeGeneralSettings();
  $('navChat').onclick = () => setPanelOpen(!workspaceViews.chat);
  for (const [id, view] of [['navVoice','voice'],['navStreams','streams']]) $(id).onclick = () => { workspaceViews[view] = !workspaceViews[view]; saveWorkspaceViews(); syncWorkspace(); };
  $('profileName').oninput = () => { if (state.myId) return; $('name').value = $('profileName').value; save('name', $('name').value); $('profileDisplayName').textContent = getName(); $('profileAvatar').textContent = $('navProfileAvatar').textContent = [...getName()][0].toUpperCase(); $('navProfile').title = $('navProfile').ariaLabel = 'Perfil de ' + getName(); };
  $('name').addEventListener('input', syncWorkspace);
  for (const [proxy, original] of [['paneVoiceJoin','voiceJoin'],['paneVoiceMute','voiceMute'],['paneVoiceDeafen','voiceDeafen'],['paneVoiceSettings','voiceSettingsBtn']]) $(proxy).onclick = () => $(original).click();
  $('streamPeople').onclick = () => {
    if (!workspaceViews.chat) setPanelOpen(true);
    setPeopleOpen($('peoplePop').hidden);
  };
  workspaceReady = true;
  syncWorkspace();
}
