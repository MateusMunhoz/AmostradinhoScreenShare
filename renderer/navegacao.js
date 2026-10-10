'use strict';
// Uma barrinha fixa na borda direita (só ícones, só coisas do app). O painel da sala fica à esquerda dela, com as
// abas Voz, Chat e Pessoas e o cartão Seu sinal no pé (docs/spec/sala-nova.md).
const workspaceViews = (() => {
  let saved; try { saved = JSON.parse(load('workspaceViews.v1', '{}')); } catch {}
  return { chat: typeof saved?.chat === 'boolean' ? saved.chat : load('panelOpen', '1') !== '0',
    voice: typeof saved?.voice === 'boolean' ? saved.voice : true,
    streams: typeof saved?.streams === 'boolean' ? saved.streams : true };
})();
// Abas do painel: a aba aberta, "lado a lado" (Voz e Chat juntos, com a divisória de sempre) e recolhido (o painel
// some e a sua voz vai para a barrinha). Quem já usava o chat e a voz juntos começa lado a lado. Os painéis de chat
// e de voz são os de sempre: a aba só decide quais aparecem, por workspaceViews.chat e .voice (aplicarPainelSala).
const painelSala = (() => {
  let s; try { s = JSON.parse(load('painelSala.v1', '{}')); } catch {}
  return { aba: ['voz', 'chat', 'pessoas'].includes(s?.aba) ? s.aba : workspaceViews.voice || !workspaceViews.chat ? 'voz' : 'chat',
    juntos: typeof s?.juntos === 'boolean' ? s.juntos : workspaceViews.chat && workspaceViews.voice,
    recolhido: s?.recolhido === true };
})();
function aplicarPainelSala() {
  const { aba, juntos, recolhido } = painelSala, ambos = juntos && aba !== 'pessoas';
  workspaceViews.chat = !recolhido && (aba === 'chat' || ambos);
  workspaceViews.voice = !recolhido && (aba === 'voz' || ambos);
  workspaceViews.streams = true; // as telas ficam sempre à vista (o antigo "Esconder as telas" saiu)
}
// Muda a aba, o lado a lado ou o recolhido, e redesenha. O chat aberto e à vista marca as mensagens como lidas.
function setPainelSala(mudar = {}) {
  Object.assign(painelSala, mudar);
  save('painelSala.v1', JSON.stringify(painelSala));
  aplicarPainelSala();
  chat.open = workspaceViews.chat;
  save('panelOpen', chat.open ? '1' : '0');
  saveWorkspaceViews();
  syncWorkspace();
  if (chat.open && chatAtBottom()) markRead();
  renderUnread();
  renderVoiceAvatars();
  closePersonCard();
  if (chat.open && paneFold.which !== 'chat') requestAnimationFrame(scrollChatToEnd);
}
let workspaceReady = false;
let profileReturnFocus = null;
function setUtilityBackground(inert) {
  for (const el of [document.querySelector('main'), document.querySelector('.workspace-header'), $('workspacePanes')]) el.inert = inert;
}
function openProfilePopup() {
  renderConnectivitySettings();
  if (!$('generalSettingsDialog').hidden) closeGeneralSettings();
  profileReturnFocus = document.activeElement;
  $('profilePane').hidden = false;
  syncWorkspace();
  setUtilityBackground(true);
  // Na sala o nome está travado: o foco vai para o próprio painel (sem acender o anel no X)
  ($('profileName').disabled ? $('profilePane').querySelector('.profile-dialog') : $('profileName')).focus();
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
    if (e.key === 'Escape') { if (capturing) return; e.preventDefault(); e.stopPropagation(); close(); return; } // trocando uma tecla de atalho, o Esc é da troca
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
  const any = inCall && !painelSala.recolhido;
  const pessoas = any && painelSala.aba === 'pessoas';
  $('workspacePanes').hidden = !any;
  $('chatTab').hidden = !inCall || !workspaceViews.chat;
  $('voicePane').hidden = !inCall || !workspaceViews.voice;
  setPeopleOpen(pessoas);
  $('streamArea').hidden = inRoom && !workspaceViews.streams;
  document.body.classList.toggle('has-workspace-pane', any);
  document.body.classList.toggle('workspace-in-room', inCall);
  document.body.classList.toggle('workspace-wide', inRoom && !workspaceViews.streams && any);
  // Abas, painéis e o cartão Seu sinal formam um bloco só; o cartão fecha o bloco embaixo
  $('chatTab').classList.remove('pane-last');
  $('voicePane').classList.remove('pane-last');
  $('seuSinal').hidden = !any;
  $('workspacePanes').classList.toggle('juntos', workspaceViews.chat && workspaceViews.voice);
  $('seuSinalMini').hidden = !inCall || any;
  if (inRoom) syncIncomingVideo(); // telas escondidas não baixam vídeo (o som continua)
  if (mapFocus.on && !mapFocusFits()) setMapFocus(false); // o mapa em foco só existe com chat e voz lado a lado
  $('workspaceContext').textContent = inRoom ? 'Na sala' : 'Início';
  $('dockHome').hidden = !inRoom; // no menu, o Voltar para a sala fica no lugar do Início (renderHomeCall)
  $('navVoice').setAttribute('aria-pressed', String(workspaceViews.voice));
  $('navChat').setAttribute('aria-pressed', String(workspaceViews.chat));
  $('peopleBtn').setAttribute('aria-pressed', String(pessoas));
  $('paneJuntos').setAttribute('aria-pressed', String(painelSala.juntos));
  setIcon($('paneJuntos'), 'splitRows', painelSala.juntos ? 'Separar: uma aba de cada vez' : 'Voz e Chat lado a lado (um em cima do outro)');
  $('navSettings').setAttribute('aria-expanded', String(settings));
  $('navProfile').setAttribute('aria-expanded', String(profile));
  fitNav();
  $('profileName').disabled = !!state.myId;
  $('profileName').value = $('name').value;
  $('profileDisplayName').textContent = getName();
  paintName($('profileDisplayName'), '');
  const conta = contaSala(); // como no cartão da voz: "conta Flyleaf" embaixo do nome
  $('profileCardConta').textContent = conta ? `conta ${conta.nome}` : '';
  $('profileNameFont').value = appPreferences.nameFont;
  $('profileAvatar').textContent = $('navProfileAvatar').textContent = [...getName()][0].toUpperCase();
  paintAvatar($('profileAvatar'));
  $('homeAvatar').textContent = [...getName()][0].toUpperCase();
  paintAvatar($('homeAvatar'));
  paintAvatar($('navProfileAvatar'));
  $('navProfile').title = $('navProfile').ariaLabel = 'Perfil de ' + getName();
  $('profileHint').textContent = state.myId ? 'Só dá para trocar fora da sala.' : 'Aparece para todo mundo na sala e nas mensagens.';
  renderVoicePane();
  renderHomeCall();
  renderAmigos();
}
// ---------- Cabeçalho da sala ----------
// Em cima do palco: o nome da sala (abre o menu da sala), a rede e quantas pessoas; à direita Grade/Destaque (com
// telas), Convidar e Sair. Sem espaço, enxuga em etapas: 1) a rede e as pessoas; 2) os textos de Convidar e Sair.
const HEAD_STEPS = ['apertado-1', 'apertado-2'];
function fitRoomHead() {
  const head = $('roomHead');
  if (!head.offsetParent) return;
  head.classList.remove(...HEAD_STEPS);
  for (const step of HEAD_STEPS) {
    if (head.scrollWidth <= head.clientWidth + 1) break;
    head.classList.add(step);
  }
}
function redeDaSala() {
  if (state.cloud) return 'Internet';
  const modo = selectedNetworkProvider();
  return modo === 'razze' ? 'Razze' : modo === 'internet' ? 'Internet' : window.api.platform === 'linux' ? 'Rede local' : 'Radmin';
}
function renderRoomHead() {
  if (!state.myId) { setRoomMenuOpen(false); return; }
  const dono = state.hostId === state.myId;
  $('roomHeadTitle').textContent = dono ? 'Sua sala' : `Sala de ${nameOf(state.hostId)}`;
  const pessoas = state.members.size + 1;
  $('roomHeadMeta').textContent = `${redeDaSala()} · ${pessoas === 1 ? 'só você' : `${pessoas} pessoas`}`;
  $('roomMenuBtn').title = 'Configurações da sala: endereço, senha e quem pode entrar';
  $('dockAddr').title = state.cloud ? 'Copiar o código da sala para mandar a quem vai entrar' : 'Copiar o endereço da sala para mandar a quem vai entrar';
}
function rotuloMenu(texto) { const s = document.createElement('span'); s.textContent = texto; return s; }
function setRoomMenuOpen(open) {
  const menu = $('roomMenu');
  if (menu.hidden === !open) return;
  menu.hidden = !open;
  $('roomMenuBtn').setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button, input')?.focus();
}
function setupRoomHead() {
  $('roomMenuBtn').onclick = () => setRoomMenuOpen($('roomMenu').hidden);
  $('roomMenuLeave').onclick = () => { setRoomMenuOpen(false); $('leaveBtn').click(); };
  $('openStatsRoom').addEventListener('click', () => setRoomMenuOpen(false));
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('.room-menu-wrap')) setRoomMenuOpen(false); });
  $('roomMenu').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRoomMenuOpen(false); $('roomMenuBtn').focus(); }
  });
  let queued = false;
  const again = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fitRoomHead(); }); };
  new ResizeObserver(again).observe($('roomHead'));
  new MutationObserver(again).observe($('roomHead'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(again).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-skin'] });
  document.fonts?.addEventListener('loadingdone', again);
}

// ---------- Seu sinal ----------
// O cartão no pé do painel: em que canal você está (ou "Fora da voz"), os botões da voz e o Transmitir. Recolhido o
// painel, a coluninha da barrinha repete microfone, fone, entrar/sair da voz e transmitir (os botões de verdade são os
// do cartão: a coluninha só clica neles).
function renderSeuSinal() {
  const na = !!voice.session;
  $('ssOnde').textContent = voice.pending ? 'Entrando na voz…' : na ? `Voz conectada · ${channelName(voice.channel)}` : 'Fora da voz';
  $('seuSinal').classList.toggle('na-voz', na);
  $('seuSinal').classList.toggle('ao-vivo', !!state.sharing);
  $('miniMute').hidden = $('miniDeafen').hidden = !na;
  setIcon($('miniMute'), voice.muted ? 'micOff' : 'mic', voice.muted ? 'Ligar o microfone' : 'Desligar o microfone');
  $('miniMute').setAttribute('aria-pressed', String(voice.muted));
  setIcon($('miniDeafen'), voice.deafened ? 'headphonesOff' : 'headphones', voice.deafened ? 'Ouvir as vozes' : 'Silenciar as vozes');
  $('miniDeafen').setAttribute('aria-pressed', String(voice.deafened));
  setIcon($('miniVoice'), na || voice.pending ? 'phoneOff' : 'phone', na ? 'Sair da voz' : voice.pending ? 'Cancelar entrada na voz' : 'Entrar na voz');
  $('miniVoice').disabled = !voice.supported;
  $('miniVoice').classList.toggle('mini-sair', na || voice.pending);
  setIcon($('miniShare'), state.sharing ? 'stop' : 'monitor', state.sharing ? 'Parar de transmitir' : 'Transmitir tela');
  $('miniShare').classList.toggle('ao-vivo', !!state.sharing);
}
function setupSeuSinal() {
  setIcon($('paneExpand'), 'panelOpen', 'Abrir o painel da sala');
  setIcon($('paneRecolher'), 'panelClose', 'Recolher o painel (a sua voz fica na barrinha)');
  $('paneExpand').onclick = () => setPainelSala({ recolhido: false });
  $('paneRecolher').onclick = () => setPainelSala({ recolhido: true });
  $('paneJuntos').onclick = () => setPainelSala(painelSala.juntos ? { juntos: false } : { juntos: true, aba: painelSala.aba === 'pessoas' ? 'voz' : painelSala.aba });
  $('navVoice').onclick = () => setPainelSala({ aba: 'voz', recolhido: false });
  $('navChat').onclick = () => setPainelSala({ aba: 'chat', recolhido: false });
  $('peopleBtn').onclick = () => setPainelSala({ aba: 'pessoas', recolhido: false });
  // Setas trocam de aba (como numa lista de abas)
  $('paneTabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tabs = [$('navVoice'), $('navChat'), $('peopleBtn')], at = tabs.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus(); next.click();
  });
  $('miniMute').onclick = () => $('voiceMute').click();
  $('miniDeafen').onclick = () => $('voiceDeafen').click();
  $('miniVoice').onclick = () => $('voiceJoin').click();
  $('miniShare').onclick = () => (state.sharing ? $('stopShareBtn') : $('shareBtn')).click();
}

// Barrinha sem espaço (janela baixa, fonte larga): marca para o CSS apertar
function fitNav() {
  const nav = $('workspaceNav');
  nav.classList.remove('nav-tight');
  if (nav.scrollWidth > nav.clientWidth + 1) nav.classList.add('nav-tight');
}

// Seção da voz. Fora dela: Entrar como botão principal. Na voz: embaixo da lista, Voz e atalhos (só o ícone, o nome na
// dica) e a Subsala. Microfone, fone e Sair não se repetem aqui: ficam no cartão Seu sinal, logo embaixo (e na faixa
// do Início, no saguão).
function layoutVoicePane(active) {
  const pane = $('voicePane'), actions = pane.querySelector('.pane-voice-actions');
  const settings = $('paneVoiceSettings'), join = $('paneVoiceJoin');
  pane.classList.toggle('voice-in-call', active);
  settings.hidden = !active;
  if (active) { setIcon(settings, 'sliders', 'Voz e atalhos'); actions.append(settings); }
  join.disabled = !voice.supported;
  join.hidden = active;
  join.textContent = voice.pending ? 'Cancelar' : subsalasOn() ? 'Entrar na Voz geral' : 'Entrar na voz';
  join.className = 'btn small pane-join' + (voice.pending ? '' : ' primary');
  actions.append(join);
  // Nova subsala: fora da voz, ao lado do Entrar; na voz, no fim da faixa (cria e já entra: createSubsala)
  const sub = $('paneVoiceSubsala');
  sub.hidden = !subsalasOn() || !state.myId;
  sub.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  sub.append(active ? 'Subsala' : 'Nova subsala');
  sub.disabled = !voice.supported;
  actions.append(sub);
}
// ---------- Início sem sair da sala ----------
// O botão Início da barrinha troca para o saguão; a sala continua (voz, chat, telas, avisos). No saguão, uma
// faixa mostra a sala, quem está nela, a sua voz e o Voltar (com as mensagens novas).
function goHomeKeepCall() { if (state.myId) show('home'); }
function backToRoom() { if (state.myId) { show('room'); markChatSeenIfVisible(); } }
function markChatSeenIfVisible() { if (chat.open && chatAtBottom() && !mapFocus.on && paneFold.which !== 'chat') markRead(); }
function renderHomeCall() {
  const inCall = !!state.myId;
  renderRoomHead();
  renderSeuSinal();
  $('homeCall').hidden = !inCall;
  // Barrinha da direita: no menu, com a sala aberta, o botão de voltar fica no pé (com as mensagens novas)
  const back = inCall && $('room').hidden, unread = chat.unread;
  $('navBackToRoom').hidden = !back;
  $('navBackUnread').hidden = !back || !unread;
  $('navBackUnread').textContent = unread > 99 ? '99+' : String(unread);
  $('navBackToRoom').title = $('navBackToRoom').ariaLabel = unread ? `Voltar para a sala · ${unread} ${unread === 1 ? 'mensagem nova' : 'mensagens novas'}` : 'Voltar para a sala';
  // Criar e entrar continuam à vista e ligados numa sala: perguntam antes de sair dela (foraDaSala, primeira-entrada.js).
  // Abrindo uma sala, ficam travados: um segundo servidor derrubaria o primeiro (startServer fecha o que estiver aberto)
  for (const id of ['goQuick', 'goCreate', 'goJoin', 'rejoinBtn']) $(id).disabled = !!state.abrindo;
  $('goQuick').title = $('goJoin').title = $('goCreate').title = inCall ? 'Você está numa sala: o app pergunta antes de sair dela' : '';
  if (!inCall) return;
  const host = state.hostId === state.myId ? 'você' : nameOf(state.hostId);
  $('homeCallTitle').textContent = host === 'você' ? 'Sua sala' : `Sala de ${host}`;
  const people = state.members.size + 1;
  const sharing = [...state.members.values()].filter((m) => m.sharing).length + (state.sharing ? 1 : 0);
  const where = voice.session && voice.channel ? `você em ${channelName(voice.channel)}` : 'você na voz';
  $('homeCallSub').textContent = [people === 1 ? 'só você' : `${people} pessoas`, voice.session ? (voice.muted ? `${where}, microfone desligado` : where) : 'fora da voz',
    sharing ? (sharing === 1 ? '1 transmitindo' : `${sharing} transmitindo`) : ''].filter(Boolean).join(' · ');
  // No saguão a barra flutuante não aparece: aqui ficam microfone, fone e sair da voz (sair da sala é pela barrinha)
  $('homeCallMute').hidden = $('homeCallDeafen').hidden = $('homeCallLeave').hidden = !voice.session;
  setIcon($('homeCallLeave'), 'phoneOff', 'Sair da voz');
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
  $('homeCallLeave').onclick = () => $('voiceJoin').click(); // na voz, o voiceJoin é o Sair
}

function renderVoicePane() {
  if (!workspaceReady || $('voicePane').hidden) return; // escondido, não precisa redesenhar a cada mudança da voz
  if (voiceDrag) { voiceDragPending = true; return; } // arrastando alguém para outro canal: redesenha ao soltar
  const active = !!voice.session;
  const ids = [...voice.members].filter(([id,m]) => m.session && state.members.has(id)).map(([id]) => id);
  const channels = subsalasOn(); // com subsalas, a lista vem por canal (renderer/subsalas.js)
  // Só o que a lista não mostra: quem está na voz e em que canal já aparece nela
  $('voicePaneStatus').textContent = !voice.supported ? 'Voz indisponível nesta sala.' : voice.pending ? 'Aguardando o microfone…' : '';
  $('voicePaneStatus').hidden = !$('voicePaneStatus').textContent;
  layoutVoicePane(active);
  // Quem está transmitindo tem o botão Assistir na frente do nome; quem transmite fora da voz aparece embaixo
  const list = $('voicePaneMembers'); list.replaceChildren();
  const sharing = (id) => !!state.members.get(id)?.sharing;
  const map = voiceMapOn();
  $('voicePane').classList.toggle('voice-map', map);
  if (map) { /* no mapa, os canais e as pessoas estão no céu */ }
  else if (channels) renderVoiceChannels(list);
  else {
    if (active) list.append(memberRow(null, getName(), state.sharing));
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
    for (const id of outside) list.append(id ? memberRow(id, nameOf(id), true) : memberRow(null, getName(), true));
  }
}
// ---------- Divisória entre o chat e a voz ----------
// Arrastar a linha entre os dois muda quanto da coluna é da voz (o chat fica com o resto). Setas também mexem, e o
// clique duplo volta ao automático. O tamanho fica salvo neste PC (voiceSplit, fração da altura). Para cima, para quando
// o chat chega ao mínimo (título, um pouco da lista e o campo de escrever: --chat-min no styles.css).
const SPLIT_MIN = 0.15, SPLIT_MAX = 0.85, CHAT_MIN_PX = 220;
function setupPaneSplit(host) {
  const bar = document.createElement('div');
  bar.className = 'pane-split';
  bar.tabIndex = 0;
  bar.setAttribute('role', 'separator');
  bar.setAttribute('aria-orientation', 'horizontal');
  bar.setAttribute('aria-label', 'Tamanho do chat e da voz');
  bar.title = 'Arraste para redimensionar';
  bar.setAttribute('aria-valuemin', String(SPLIT_MIN * 100));
  bar.setAttribute('aria-valuemax', String(SPLIT_MAX * 100));
  host.insertBefore(bar, $('voicePane'));
  const apply = (f) => {
    if (f == null) { host.style.removeProperty('--voice-split'); host.classList.remove('voice-sized'); bar.removeAttribute('aria-valuenow'); return; }
    const max = host.clientHeight ? Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, 1 - (CHAT_MIN_PX + bar.offsetHeight) / host.clientHeight)) : SPLIT_MAX;
    f = Math.min(max, Math.max(SPLIT_MIN, f));
    host.style.setProperty('--voice-split', String(f));
    host.classList.add('voice-sized');
    bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    return f;
  };
  const saved = Number(load('voiceSplit', ''));
  apply(saved > 0 ? saved : null);
  const current = () => Number(host.style.getPropertyValue('--voice-split')) || $('voicePane').offsetHeight / host.clientHeight;
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
    const move = (ev) => { const r = host.getBoundingClientRect(); apply((r.bottom - ev.clientY) / r.height); };
    const up = () => {
      bar.classList.remove('dragging');
      bar.removeEventListener('pointermove', move);
      save('voiceSplit', host.style.getPropertyValue('--voice-split'));
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
    bar.addEventListener('pointercancel', up, { once: true });
  });
  bar.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowDown' ? -0.05 : 0;
    if (!step) return;
    e.preventDefault();
    save('voiceSplit', String(apply(current() + step)));
  });
  bar.addEventListener('dblclick', () => { apply(null); save('voiceSplit', ''); });
}

// ---------- Recolher o chat ou a voz ----------
// A seta no título recolhe o painel numa faixa (só o título; o chat mostra as mensagens novas) e o outro ocupa a
// coluna. Um recolhido de cada vez; fica salvo neste PC. Só vale com os dois abertos juntos (CSS).
const paneFold = { which: ['chat', 'voice'].includes(load('paneFold', '')) ? load('paneFold', '') : '' };
function setPaneFold(which) {
  paneFold.which = which;
  save('paneFold', which);
  const host = $('workspacePanes');
  host.classList.toggle('fold-chat', which === 'chat');
  host.classList.toggle('fold-voice', which === 'voice');
  for (const [pane, btn] of [['chat', $('chatFold')], ['voice', $('voiceFold')]]) {
    const folded = which === pane, name = pane === 'chat' ? 'o chat' : 'a voz';
    btn.setAttribute('aria-expanded', String(!folded));
    btn.title = btn.ariaLabel = folded ? `Abrir ${name}` : `Recolher ${name}`;
  }
  if (which !== 'chat') { scrollChatToEnd(); markChatSeenIfVisible(); }
}
function setupPaneFold() {
  const make = (id, pane, head) => {
    const b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.className = 'pane-fold';
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    b.onclick = () => setPaneFold(paneFold.which === pane ? '' : pane);
    head.prepend(b);
  };
  make('chatFold', 'chat', $('chatTab').querySelector('.chat-head'));
  make('voiceFold', 'voice', $('voicePane').querySelector('.pane-head'));
  // Clicar no título recolhido também abre
  $('chatTab').querySelector('.chat-head').addEventListener('click', (e) => { if (paneFold.which === 'chat' && !e.target.closest('button')) setPaneFold(''); });
  $('voicePane').querySelector('.pane-head').addEventListener('click', (e) => { if (paneFold.which === 'voice' && !e.target.closest('button')) setPaneFold(''); });
  setPaneFold(paneFold.which);
}

// ---------- Largura do chat e da voz ----------
// Uma alça na borda do painel que dá para o vídeo (a esquerda; com a interface espelhada, a direita). Arrastar muda a
// largura e o vídeo se ajusta; fica salva em appPreferences.appearance.paneWidth. Dois cliques voltam à automática.
// Nunca passa de 55% da janela, para sobrar palco.
function savePaneWidth(px) {
  appPreferences.appearance = { ...appPreferences.appearance, paneWidth: AppPreferences.paneWidth(px) };
  saveAppPreferences();
}
function setupPaneResize(host) {
  const grip = document.createElement('div');
  grip.className = 'pane-resize';
  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', 'Largura do chat e da voz');
  grip.title = 'Arraste para mudar a largura. Dois cliques voltam ao normal.';
  host.append(grip);
  const { min, max } = AppPreferences.paneLimits;
  const limit = (px) => Math.max(min, Math.min(max, innerWidth * 0.55, Math.round(px)));
  const mirrored = () => document.documentElement.dataset.mirror === 'on';
  let drag = null;
  grip.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = host.getBoundingClientRect();
    drag = { edge: mirrored() ? r.left : r.right, width: r.width, moved: false };
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('pane-resizing');
  };
  grip.onpointermove = (e) => {
    if (!drag) return;
    drag.width = limit(mirrored() ? e.clientX - drag.edge : drag.edge - e.clientX);
    drag.moved = true;
    applyPaneWidth(drag.width);
  };
  const end = () => {
    if (!drag) return;
    if (drag.moved) savePaneWidth(drag.width); // só clicar não fixa a largura automática
    drag = null;
    document.body.classList.remove('pane-resizing');
  };
  grip.onpointerup = end;
  grip.onpointercancel = end;
  grip.ondblclick = () => savePaneWidth(0);
  // Teclado: setas mudam de 20 em 20 px (a seta aponta para onde a borda vai)
  grip.onkeydown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const grow = (e.key === 'ArrowLeft') !== mirrored();
    savePaneWidth(limit(host.getBoundingClientRect().width + (grow ? 20 : -20)));
  };
}

function setupWorkspace() {
  setupConnectionMap();
  const host = $('workspacePanes');
  host.insertBefore($('chatTab'), $('voicePane'));
  $('chatTab').classList.add('workspace-pane');
  setupPaneSplit(host);
  setupPaneFold();
  host.append($('peoplePop'));
  setupPaneResize(host);
  host.append($('seuSinal')); // o cartão fecha o bloco embaixo, em qualquer aba
  document.body.append($('profilePane'), $('generalSettingsDialog'));
  $('sidePanel').hidden = true;
  $('generalSettingsDialog').setAttribute('aria-labelledby', 'generalSettingsTitle');
  $('navSettings').querySelector('.nav-icon').innerHTML = '<svg viewBox="0 0 24 24"><path d="m9 3 1-2h4l1 2 2 1 2 0 2 3-1 2v3l1 2-2 3h-2l-2 1-1 3h-4l-1-3-2-1H5l-2-3 1-2V9L3 7l2-3h2z"/><circle cx="12" cy="11" r="3"/></svg>';
  new ResizeObserver(() => fitNav()).observe($('workspaceNav'));
  $('navProfile').onclick = openProfilePopup;
  $('closeProfile').onclick = closeProfilePopup;
  setupUtilityPopup('profilePane', closeProfilePopup);
  setupUtilityPopup('generalSettingsDialog', closeGeneralSettings);
  $('navSettings').onclick = () => $('generalSettingsDialog').hidden ? openGeneralSettings() : closeGeneralSettings();
  setupRoomHead();
  setupSeuSinal();
  $('profileName').oninput = () => { if (state.myId) return; $('name').value = $('profileName').value; save('name', $('name').value); $('profileDisplayName').textContent = getName(); $('profileAvatar').textContent = $('navProfileAvatar').textContent = [...getName()][0].toUpperCase(); $('navProfile').title = $('navProfile').ariaLabel = 'Perfil de ' + getName(); };
  $('name').addEventListener('input', syncWorkspace);
  setupNameFont();
  setupHomeCall();
  for (const [proxy, original] of [['paneVoiceJoin','voiceJoin'],['paneVoiceSettings','voiceSettingsBtn']]) $(proxy).onclick = () => $(original).click();
  $('streamPeople').onclick = () => setPainelSala({ aba: 'pessoas', recolhido: false });
  aplicarPainelSala();
  chat.open = workspaceViews.chat;
  workspaceReady = true;
  syncWorkspace();
}
