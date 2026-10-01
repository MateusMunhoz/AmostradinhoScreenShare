'use strict';
// HUB: a barra fininha na borda esquerda. Fechada, mostra "HUB" em pé (e quantos pedidos de amizade chegaram); aberta,
// "HUB" deitado e três abas:
// - Salas: a sala em que você está (em destaque), as outras salas abertas na rede e o botão do menu inicial.
// - Amigos: buscar (texto + Todos/Online/Pedidos), adicionar pelo nickname (formulário no lugar da busca), convidar
//   para a sua sala, aceitar e cancelar pedidos, remover pelo menu "⋯" (confirma na própria linha). Os dados vêm da
//   RazzeAPI (refreshRazzeLists e a presença em conectividade.js).
// - Rede: como os PCs se conectam (Radmin, Razze, Internet), servidores, redes Razze e a conta (entrar, criar, sair).
// As abas Amigos e Rede têm os ids friendsDialog e networkDialog: quem pergunta "estão à vista?" continua usando .hidden.
// Aberto, procura sessões mesmo fora da tela inicial (sessionWatchWanted em sessoes.js).
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, sessoes, navegacao.

const HUB_TABS = ['rooms', 'friends', 'network']; // as mensagens diretas ficam só na barra de baixo (mensagens.js)
const hub = { open: false, tab: HUB_TABS.includes(load('hubTab', 'rooms')) ? load('hubTab', 'rooms') : 'rooms' };
const friendsData = { friends: [], incoming: [], outgoing: [], error: '' };
const friendsFilter = { text: '', view: 'all' }; // view: all | online | requests
const friendsUi = { menu: null, confirm: null }; // id do amigo com o menu "⋯" aberto / com a remoção para confirmar

function setHubOpen(on, tab) {
  hub.open = !!on;
  if (tab) { hub.tab = tab; save('hubTab', tab); }
  $('hubRail').classList.toggle('open', hub.open);
  $('hubToggle').setAttribute('aria-expanded', String(hub.open));
  $('hubToggle').title = hub.open ? 'Fechar o HUB' : 'Abrir o HUB: salas e amigos';
  $('hubBody').hidden = !hub.open;
  setSessionWatch(sessionWatchWanted());
  renderHub();
  if (typeof syncWorkspace === 'function') syncWorkspace();
  if (hub.open && hub.tab === 'friends' && !$('razzeStepFriends').hidden) $($('friendsAddForm').hidden ? 'friendsFilter' : 'razzeFriendNickname').focus();
  else if (hub.open && hub.tab !== 'network') $('hubToggle').focus();
}
function setHubTab(tab) { setHubOpen(true, tab); }

// Os amigos agora moram no HUB: abrir e fechar "a janela de amigos" é abrir o HUB na aba Amigos
function openFriendsDialog() {
  if (!$('connectionMapDialog').hidden) closeConnectionMap();
  if (!$('profilePane').hidden) closeProfilePopup();
  if (!$('networkDialog').hidden) closeNetworkDialog();
  if (!$('generalSettingsDialog').hidden) closeGeneralSettings();
  renderConnectivitySettings();
  setHubOpen(true, 'friends');
}
function closeFriendsDialog() { if (hub.open) setHubOpen(false); }
function openNetworkDialog() {
  if (!$('connectionMapDialog').hidden) closeConnectionMap();
  if (!$('profilePane').hidden) closeProfilePopup();
  if (!$('generalSettingsDialog').hidden) closeGeneralSettings();
  renderConnectivitySettings();
  setHubOpen(true, 'network');
}
function closeNetworkDialog() { if (hub.open) setHubOpen(false); }
// "Entrar na conta" (aba Amigos, sem conta): vai para a aba Rede, no login
function openRazzeLogin() {
  openNetworkDialog();
  $('profileAccount').scrollIntoView({ block: 'start' });
  if (!$('razzeAuth').hidden) $('razzeEmail').focus();
}

function renderHub() {
  const rail = $('hubRail');
  if (!rail) return;
  const inRoom = !!state.myId;
  const pending = friendsData.incoming.length;
  $('hubRailBadge').hidden = !pending; // mensagens novas aparecem no "Mensagens" da barra de baixo
  $('hubRailBadge').textContent = pending > 9 ? '9+' : String(pending);
  $('hubRailBadge').title = `${pending} ${pending === 1 ? 'pedido' : 'pedidos'} de amizade`;
  $('hubFriendsBadge').hidden = !pending;
  $('hubFriendsBadge').textContent = String(pending);
  $('hubTabRooms').setAttribute('aria-selected', String(hub.tab === 'rooms'));
  $('hubTabFriends').setAttribute('aria-selected', String(hub.tab === 'friends'));
  $('hubTabNetwork').setAttribute('aria-selected', String(hub.tab === 'network'));
  $('networkDialog').hidden = !hub.open || hub.tab !== 'network';
  $('hubRooms').hidden = !hub.open || hub.tab !== 'rooms';
  $('friendsDialog').hidden = !hub.open || hub.tab !== 'friends';
  if (!hub.open) return;
  if (hub.tab === 'friends') { renderFriends(); return; }
  // A sala em que você está
  $('hubCurrentBox').hidden = !inRoom;
  $('hubHome').hidden = !inRoom || !$('home').hidden;
  if (inRoom) {
    const host = state.hostId === state.myId ? 'você' : nameOf(state.hostId);
    const people = state.members.size + 1;
    $('hubCurrentName').textContent = host === 'você' ? 'Sua sala' : `Sala de ${host}`;
    $('hubCurrentMeta').textContent = [people === 1 ? 'só você' : `${people} pessoas`,
      state.cloud ? `código ${state.cloud.code}` : state.isOwner ? `porta ${state.port}` : `${state.host}:${state.port}`].join(' · ');
  }
  // As outras salas abertas (a sua some da lista pelo id da sessão ou pelo endereço)
  const myId = state.sessao?.id;
  const mine = (s) => inRoom && ((myId && s.id === myId) || (!state.cloud && s.endereco === state.host && s.porta === state.port));
  const others = sessoes.observando ? listaSessoes().filter((s) => !mine(s)) : [];
  $('hubList').replaceChildren(...others.map(hubRow));
  $('hubEmpty').hidden = others.length > 0;
  $('hubEmpty').textContent = sessoes.procurando ? 'Procurando salas abertas na rede…'
    : state.cloud || selectedNetworkProvider() === 'internet' ? 'No modo Internet as salas não aparecem aqui: entre pelo código.'
    : inRoom ? 'Nenhuma outra sala aberta na rede agora.' : 'Nenhuma sala aberta na rede agora.';
}

function hubAvatar(name, online) {
  const dot = document.createElement('span');
  dot.className = 'avatar';
  dot.textContent = (String(name).trim()[0] || '?').toUpperCase();
  dot.style.setProperty('--person', personColor(name));
  dot.setAttribute('aria-hidden', 'true');
  if (online === undefined) return dot;
  const wrap = document.createElement('span');
  wrap.className = 'hub-avatar' + (online ? ' on' : '');
  wrap.append(dot);
  return wrap;
}
function hubInfo(title, subtitle) {
  const info = document.createElement('div');
  info.className = 'hub-room-info';
  const name = document.createElement('strong');
  name.textContent = title;
  const meta = document.createElement('span');
  meta.className = 'hub-room-meta';
  meta.textContent = subtitle;
  info.append(name, meta);
  return info;
}
function hubButton(text, onclick, cls = 'btn small', title = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  if (title) b.title = title;
  b.onclick = onclick;
  return b;
}

function hubRow(s) {
  const li = document.createElement('li');
  li.className = 'hub-room';
  const info = hubInfo(`Sala de ${s.host}`, `${s.pessoas} ${s.pessoas === 1 ? 'pessoa' : 'pessoas'}${s.senha ? ', com senha' : ''}`);
  if (s.senha) info.lastChild.insertAdjacentHTML('afterbegin', ICON.lock);
  const inRoom = !!state.myId;
  li.append(hubAvatar(s.host), info, hubButton(inRoom ? 'Trocar' : 'Entrar', () => (inRoom ? switchToSession(s) : (setHubOpen(false), enterSession(s))),
    inRoom ? 'btn small' : 'btn small primary', inRoom ? `Sair desta sala e entrar na sala de ${s.host}` : `Entrar na sala de ${s.host}`));
  return li;
}

// Trocar de sala: sai desta (passando a sala adiante, se você for o host) e entra na outra
async function switchToSession(s) {
  if (!(await appConfirm(`Sair desta sala e entrar na sala de ${s.host}?`, { title: 'Trocar de sala', ok: 'Trocar' }))) return;
  setHubOpen(false);
  leaveRoom();
  enterSession(s);
}

// ---------- Amigos ----------
function setFriendsData(value) {
  friendsData.friends = value.friends || [];
  friendsData.incoming = value.incoming || [];
  friendsData.outgoing = value.outgoing || [];
  renderHub();
}
// A presença chega a cada poucos segundos (conectividade.js): só troca o online de quem já está na lista
function updateFriendsPresence(live) {
  const byId = new Map((live.friends || []).map((f) => [f.id, f]));
  friendsData.error = live.error || '';
  for (const f of friendsData.friends) if (byId.has(f.id)) f.online = !!byId.get(f.id).online;
  renderHub();
}
function friendsStatus(text) { $('razzeFriendsStatus').textContent = text; }
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Adicionar amigo: o formulário toma o lugar da busca enquanto está aberto
function setFriendsAddOpen(on) {
  $('friendsAddForm').hidden = !on;
  $('friendsSearchRow').hidden = !!on;
  $('friendsAddOpen').setAttribute('aria-expanded', String(!!on));
  showFriendsAddError('');
  if (on) $('razzeFriendNickname').focus();
  else { $('razzeFriendNickname').value = ''; $('friendsAddOpen').focus(); }
}
// Erro do envio aparece embaixo do campo (vazio = sem erro)
function showFriendsAddError(text) {
  const hint = $('friendsAddHint');
  hint.textContent = text || 'Digite o nickname exato. A pessoa recebe um pedido e aparece aqui quando aceitar.';
  hint.classList.toggle('erro', !!text);
  hint.setAttribute('role', text ? 'alert' : 'note');
  $('razzeFriendNickname').setAttribute('aria-invalid', String(!!text));
}
function setFriendMenu(id, confirm = null) {
  friendsUi.menu = id;
  friendsUi.confirm = confirm;
  renderFriends();
}
function focusFriendControl(key) { $('razzeFriends').querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus(); }

function renderFriends() {
  const box = $('razzeFriends');
  if (!box) return;
  // A presença redesenha a lista a cada poucos segundos: o foco volta para o mesmo botão
  const keep = box.contains(document.activeElement) ? document.activeElement.dataset.focus : '';
  const needle = semAcento(friendsFilter.text.trim());
  const match = (x) => !needle || semAcento(x.displayName).includes(needle);
  const online = (f) => !friendsData.error && !!f.online;
  const requests = friendsData.incoming.length + friendsData.outgoing.length;
  for (const b of $('friendsViews').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.view === friendsFilter.view));
  $('friendsRequestsBadge').hidden = !requests;
  $('friendsRequestsBadge').textContent = String(requests);

  const groups = [];
  const view = friendsFilter.view;
  const incoming = friendsData.incoming.filter(match), outgoing = friendsData.outgoing.filter(match);
  const on = friendsData.friends.filter((f) => online(f) && match(f)), off = friendsData.friends.filter((f) => !online(f) && match(f));
  if (view !== 'online' && incoming.length) groups.push([`Pedidos recebidos · ${incoming.length}`, incoming.map(incomingRow)]);
  if (view !== 'requests' && on.length) groups.push([`Online · ${on.length}`, on.map((f) => friendRow(f, true))]);
  else if (view === 'all' && !needle && off.length) groups.push(['Online · 0', [friendsEmptyRow('Ninguém online agora. Crie uma sala em Salas e convide quando alguém chegar.')]]);
  if (view === 'all' && off.length) groups.push([`Offline · ${off.length}`, off.map((f) => friendRow(f, false))]);
  if (view !== 'online' && outgoing.length) groups.push([`Pedidos enviados · ${outgoing.length}`, outgoing.map(outgoingRow)]);
  box.replaceChildren();
  for (const [title, rows] of groups) {
    const h = document.createElement('h3');
    h.className = 'hub-section';
    h.textContent = title;
    const ul = document.createElement('ul');
    ul.className = 'hub-list';
    ul.append(...rows);
    box.append(h, ul);
  }
  const empty = $('friendsEmpty');
  empty.hidden = groups.length > 0;
  empty.textContent = needle ? `Ninguém com “${friendsFilter.text.trim()}” por aqui.`
    : view === 'online' ? 'Nenhum amigo online agora.'
    : view === 'requests' ? 'Nenhum pedido de amizade pendente.'
    : 'Você ainda não tem amigos. Clique em Adicionar e digite o nickname de alguém.';
  if (keep) focusFriendControl(keep);
}

function friendsEmptyRow(text) {
  const li = document.createElement('li');
  li.className = 'hub-empty-row';
  li.textContent = text;
  return li;
}
function hubIconButton(icon, label, onclick, cls, focusKey) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small icon ' + cls;
  b.innerHTML = icon;
  b.title = b.ariaLabel = label;
  b.dataset.focus = focusKey;
  b.onclick = onclick;
  return b;
}

function friendRow(f, isOnline) {
  const li = document.createElement('li');
  li.className = 'hub-room hub-friend';
  // Remover: a própria linha vira a pergunta, com o nome à vista
  if (friendsUi.confirm === f.id) {
    li.classList.add('hub-confirm');
    li.setAttribute('role', 'group');
    li.ariaLabel = `Remover ${f.displayName}`;
    const no = hubButton('Não', () => { setFriendMenu(null); focusFriendControl('more:' + f.id); }, 'btn small');
    no.dataset.focus = 'no:' + f.id;
    const yes = hubButton('Remover', () => removeFriend(f), 'btn small hub-danger');
    yes.dataset.focus = 'yes:' + f.id;
    li.append(hubInfo(`Remover ${f.displayName}?`, 'Precisa de um novo pedido para voltar.'), no, yes);
    return li;
  }
  const info = hubInfo(f.displayName, isOnline ? 'Online' : friendsData.error ? 'Indisponível' : 'Offline');
  info.lastChild.dataset.friendPresence = f.id; // o teste da Razze confere o texto por aqui
  info.lastChild.classList.toggle('on', isOnline);
  li.append(hubAvatar(f.displayName, isOnline), info,
    hubIconButton(ICON.chat, `Mandar mensagem para ${f.displayName}`, () => openDm(f.id), 'hub-talk', 'talk:' + f.id));
  // Convidar só faz sentido para quem está online
  if (isOnline) {
    const inRoom = !!state.myId && !!state.roomAddr;
    const invite = hubButton('Convidar', () => inviteFriend(f), 'btn small' + (inRoom ? ' primary' : ''),
      inRoom ? `Copiar o ${state.cloud ? 'código' : 'endereço'} da sua sala para mandar para ${f.displayName}` : 'Entre numa sala para convidar');
    invite.disabled = !inRoom;
    li.append(invite);
  }
  const open = friendsUi.menu === f.id;
  const more = hubIconButton(ICON.more, `Mais opções para ${f.displayName}`, () => {
    setFriendMenu(open ? null : f.id);
    focusFriendControl((open ? 'more:' : 'remove:') + f.id);
  }, 'hub-more', 'more:' + f.id);
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', String(open));
  li.append(more);
  if (open) {
    const menu = document.createElement('div');
    menu.className = 'hub-menu';
    menu.setAttribute('role', 'menu');
    menu.ariaLabel = `Opções para ${f.displayName}`;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'hub-menu-item hub-danger-text';
    item.setAttribute('role', 'menuitem');
    item.dataset.focus = 'remove:' + f.id;
    item.innerHTML = ICON.userMinus;
    item.append(`Remover ${f.displayName}`);
    item.onclick = () => { setFriendMenu(null, f.id); focusFriendControl('no:' + f.id); };
    menu.append(item);
    li.append(menu);
  }
  return li;
}
function incomingRow(r) {
  const li = document.createElement('li');
  li.className = 'hub-room hub-request';
  li.append(hubAvatar(r.displayName), hubInfo(r.displayName, 'Quer ser seu amigo'),
    hubButton('Aceitar', () => acceptFriend(r), 'btn small primary', `Aceitar o pedido de ${r.displayName}`));
  return li;
}
function outgoingRow(r) {
  const li = document.createElement('li');
  li.className = 'hub-room hub-request';
  li.append(hubAvatar(r.displayName), hubInfo(r.displayName, 'Aguardando resposta'),
    hubButton('Cancelar pedido', () => cancelFriendRequest(r), 'btn small', `Cancelar o pedido para ${r.displayName}`));
  return li;
}

async function acceptFriend(r) {
  try { await window.api.razzeAcceptFriend(r.id); friendsStatus(`Agora você e ${r.displayName} são amigos.`); await refreshRazzeLists(); }
  catch (error) { friendsStatus('Não foi possível aceitar: ' + error.message); }
}
async function cancelFriendRequest(r) {
  try { await window.api.razzeCancelFriendRequest(r.id); friendsStatus('Pedido cancelado.'); await refreshRazzeLists(); }
  catch (error) { friendsStatus('Não foi possível cancelar o pedido: ' + error.message); }
}
// A confirmação já aconteceu na própria linha (friendRow)
async function removeFriend(f) {
  friendsUi.confirm = null;
  try { await window.api.razzeRemoveFriend(f.id); friendsStatus(`${f.displayName} saiu da sua lista de amigos.`); await refreshRazzeLists(); }
  catch (error) { friendsStatus('Não foi possível remover: ' + error.message); }
}
async function inviteFriend(f) {
  const address = state.roomAddr || (state.host ? `${state.host}:${state.port}` : '');
  if (!address) { friendsStatus(`Entre numa sala primeiro para convidar ${f.displayName}.`); return; }
  try {
    await copiar(address);
    friendsStatus(state.cloud ? `Código copiado: ${address}. Mande para ${f.displayName} junto com a senha.` : `Endereço copiado: ${address}. Mande para ${f.displayName}.`);
  } catch { friendsStatus('Não foi possível copiar o endereço da sala.'); }
}

function setupHub() {
  $('hubToggle').onclick = () => setHubOpen(!hub.open);
  $('hubHome').onclick = () => { setHubOpen(false); goHomeKeepCall(); };
  $('hubTabRooms').onclick = () => setHubTab('rooms');
  $('hubTabFriends').onclick = () => setHubTab('friends');
  $('hubTabNetwork').onclick = () => { renderConnectivitySettings(); setHubTab('network'); };
  $('friendsFilter').oninput = () => { friendsFilter.text = $('friendsFilter').value; renderFriends(); };
  for (const b of $('friendsViews').querySelectorAll('button')) b.onclick = () => { friendsFilter.view = b.dataset.view; renderFriends(); };
  $('friendsAddOpen').onclick = () => setFriendsAddOpen(true);
  $('friendsAddCancel').onclick = () => setFriendsAddOpen(false);
  $('razzeFriendNickname').addEventListener('input', () => { if ($('friendsAddHint').classList.contains('erro')) showFriendsAddError(''); });
  // Esc fecha primeiro o que estiver aberto dentro do HUB (menu, pergunta, formulário), depois o HUB
  $('hubRail').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !hub.open) return;
    e.stopPropagation();
    const id = friendsUi.menu || friendsUi.confirm;
    if (id) { setFriendMenu(null); focusFriendControl('more:' + id); }
    else if (!$('friendsAddForm').hidden && $('friendsAddForm').contains(e.target)) setFriendsAddOpen(false);
    else setHubOpen(false);
  });
  // Clique fora do HUB aberto fecha (ele fica por cima das telas); clique fora do menu "⋯" fecha o menu
  document.addEventListener('mousedown', (e) => {
    if (hub.open && !$('hubRail').contains(e.target) && !e.target.closest('.app-confirm, #dmBar')) setHubOpen(false);
    else if (friendsUi.menu && !e.target.closest('.hub-menu, .hub-more')) closeFriendMenuQuietly();
  });
}
// Fecha o menu sem redesenhar a lista: o clique que fechou pode ser num botão de outra linha e precisa chegar nele
function closeFriendMenuQuietly() {
  friendsUi.menu = null;
  $('razzeFriends').querySelector('.hub-menu')?.remove();
  $('razzeFriends').querySelector('.hub-more[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
}
