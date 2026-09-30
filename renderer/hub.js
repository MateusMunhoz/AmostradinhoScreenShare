'use strict';
// HUB: a barra fininha na borda esquerda. Fechada, mostra "HUB" em pé (e quantos pedidos de amizade chegaram); aberta,
// "HUB" deitado e três abas:
// - Salas: a sala em que você está (em destaque), as outras salas abertas na rede e o botão do menu inicial.
// - Amigos: adicionar pelo nickname, filtrar (texto + Todos/Online/Pedidos), convidar para a sua sala, aceitar e
//   cancelar pedidos. Os dados vêm da RazzeAPI (refreshRazzeLists e a presença em conectividade.js).
// - Mensagens: conversas diretas com os amigos (renderer/mensagens.js), que abrem na barra de conversas, embaixo.
// - Rede: como os PCs se conectam (Radmin, Razze, Internet), servidores, redes Razze e a conta (entrar, criar, sair).
// As abas Amigos e Rede têm os ids friendsDialog e networkDialog: quem pergunta "estão à vista?" continua usando .hidden.
// Aberto, procura sessões mesmo fora da tela inicial (sessionWatchWanted em sessoes.js).
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, sessoes, navegacao.

const HUB_TABS = ['rooms', 'friends', 'messages', 'network'];
const hub = { open: false, tab: HUB_TABS.includes(load('hubTab', 'rooms')) ? load('hubTab', 'rooms') : 'rooms' };
const friendsData = { friends: [], incoming: [], outgoing: [], error: '' };
const friendsFilter = { text: '', view: 'all' }; // view: all | online | requests

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
  if (hub.open && hub.tab === 'friends' && !$('razzeStepFriends').hidden) $('razzeFriendNickname').focus();
  else if (hub.open && hub.tab === 'messages') $('dmFilter').focus();
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
  const unread = typeof dmUnreadTotal === 'function' ? dmUnreadTotal() : 0;
  $('hubRailBadge').hidden = !(pending + unread);
  $('hubRailBadge').textContent = pending + unread > 9 ? '9+' : String(pending + unread);
  $('hubRailBadge').title = [pending && `${pending} ${pending === 1 ? 'pedido' : 'pedidos'} de amizade`, unread && `${unread} ${unread === 1 ? 'mensagem nova' : 'mensagens novas'}`].filter(Boolean).join(' · ');
  $('hubMessagesBadge').hidden = !unread;
  $('hubMessagesBadge').textContent = unread > 99 ? '99+' : String(unread);
  $('hubFriendsBadge').hidden = !pending;
  $('hubFriendsBadge').textContent = String(pending);
  $('hubTabRooms').setAttribute('aria-selected', String(hub.tab === 'rooms'));
  $('hubTabFriends').setAttribute('aria-selected', String(hub.tab === 'friends'));
  $('hubTabNetwork').setAttribute('aria-selected', String(hub.tab === 'network'));
  $('hubTabMessages').setAttribute('aria-selected', String(hub.tab === 'messages'));
  $('hubMessages').hidden = !hub.open || hub.tab !== 'messages';
  $('networkDialog').hidden = !hub.open || hub.tab !== 'network';
  $('hubRooms').hidden = !hub.open || hub.tab !== 'rooms';
  $('friendsDialog').hidden = !hub.open || hub.tab !== 'friends';
  if (!hub.open) return;
  if (hub.tab === 'friends') { renderFriends(); return; }
  if (hub.tab === 'messages') { renderDmList(); return; }
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

function renderFriends() {
  const box = $('razzeFriends');
  if (!box) return;
  const needle = semAcento(friendsFilter.text.trim());
  const match = (x) => !needle || semAcento(x.displayName).includes(needle);
  const online = (f) => !friendsData.error && !!f.online;
  const requests = friendsData.incoming.length + friendsData.outgoing.length;
  const onlineCount = friendsData.friends.filter(online).length;
  $('friendsSummary').textContent = friendsData.friends.length
    ? `${onlineCount} online · ${friendsData.friends.length} ${friendsData.friends.length === 1 ? 'amigo' : 'amigos'}` : '';
  for (const b of $('friendsViews').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.view === friendsFilter.view));
  $('friendsViewRequests').textContent = requests ? `Pedidos · ${requests}` : 'Pedidos';
  $('friendsViewOnline').textContent = `Online · ${onlineCount}`;

  const groups = [];
  const view = friendsFilter.view;
  const incoming = friendsData.incoming.filter(match), outgoing = friendsData.outgoing.filter(match);
  const on = friendsData.friends.filter((f) => online(f) && match(f)), off = friendsData.friends.filter((f) => !online(f) && match(f));
  if (view !== 'online' && incoming.length) groups.push(['Pedidos recebidos', incoming.map(incomingRow)]);
  if (view !== 'requests' && on.length) groups.push([`Online · ${on.length}`, on.map((f) => friendRow(f, true))]);
  if (view === 'all' && off.length) groups.push([`Offline · ${off.length}`, off.map((f) => friendRow(f, false))]);
  if (view !== 'online' && outgoing.length) groups.push(['Pedidos enviados', outgoing.map(outgoingRow)]);
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
    : 'Você ainda não tem amigos. Digite o nickname de alguém acima e clique em +.';
}

function friendRow(f, isOnline) {
  const li = document.createElement('li');
  li.className = 'hub-room hub-friend';
  const info = hubInfo(f.displayName, isOnline ? 'Online' : friendsData.error ? 'Indisponível' : 'Offline');
  info.lastChild.dataset.friendPresence = f.id; // o teste da Razze confere o texto por aqui
  info.lastChild.classList.toggle('on', isOnline);
  const inRoom = !!state.myId && !!state.roomAddr;
  const invite = hubButton('Convidar', () => inviteFriend(f), 'btn small' + (inRoom && isOnline ? ' primary' : ''),
    inRoom ? `Copiar o ${state.cloud ? 'código' : 'endereço'} da sua sala para mandar para ${f.displayName}` : 'Entre numa sala para convidar');
  invite.disabled = !inRoom;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn small icon hub-remove';
  remove.innerHTML = ICON.close;
  remove.title = remove.ariaLabel = `Remover ${f.displayName} dos amigos`;
  remove.onclick = () => removeFriend(f);
  const talk = document.createElement('button');
  talk.type = 'button';
  talk.className = 'btn small icon hub-talk';
  talk.innerHTML = ICON.chat;
  talk.title = talk.ariaLabel = `Mandar mensagem para ${f.displayName}`;
  talk.onclick = () => openDm(f.id);
  li.append(hubAvatar(f.displayName, isOnline), info, talk, invite, remove);
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
    hubButton('Cancelar', () => cancelFriendRequest(r), 'btn small', `Cancelar o pedido para ${r.displayName}`));
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
async function removeFriend(f) {
  if (!(await appConfirm(`Remover ${f.displayName} dos seus amigos?`, { title: 'Remover amigo', ok: 'Remover', danger: true }))) return;
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
  $('hubTabMessages').onclick = () => setHubTab('messages');
  $('friendsFilter').oninput = () => { friendsFilter.text = $('friendsFilter').value; renderFriends(); };
  for (const b of $('friendsViews').querySelectorAll('button')) b.onclick = () => { friendsFilter.view = b.dataset.view; renderFriends(); };
  $('hubRail').addEventListener('keydown', (e) => { if (e.key === 'Escape' && hub.open) { e.stopPropagation(); setHubOpen(false); } });
  // Clique fora do HUB aberto fecha (ele fica por cima das telas)
  document.addEventListener('mousedown', (e) => { if (hub.open && !$('hubRail').contains(e.target) && !e.target.closest('.app-confirm, #dmBar')) setHubOpen(false); });
}
