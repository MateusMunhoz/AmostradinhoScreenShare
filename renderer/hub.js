'use strict';
// Amigos (o HUB, a barra da esquerda, saiu; o arquivo ficou com o nome). Moram no painel do envelope, na barra de
// baixo, no painel Adicionar amigo que sobe por cima das conversas (renderer/mensagens.js: setDmPanel): adicionar
// pelo nickname, Recebidos (aceitar), Enviados (cancelar) e Amigos (mandar mensagem, ligar, convidar para a sua sala,
// remover pelo menu "⋯", que confirma na própria linha). Os dados vêm da
// RazzeAPI (refreshRazzeLists e a presença em conectividade.js).
// A conta Razze fica no Perfil (openRazzeLogin) e a rede em Configurações › Rede (openNetworkDialog).
// Os ajudantes hubAvatar, hubInfo e hubButton (e as classes hub-*) servem às linhas das listas de amigos e de conversas.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, navegacao, mensagens.

const friendsData = { friends: [], incoming: [], outgoing: [], error: '' };
const friendsFilter = { view: 'in' }; // view: in (recebidos) | out (enviados) | all (amigos)
const friendsUi = { menu: null, confirm: null }; // id do amigo com o menu "⋯" aberto / com a remoção para confirmar

// "Abrir os amigos": o painel Adicionar amigo, por cima das conversas do envelope. Sem conta, o envelope não aparece: vai para o login no Perfil
function openFriendsDialog() {
  if (!$('generalSettingsDialog').hidden) closeGeneralSettings();
  if (!dm.account) { openRazzeLogin(); return false; }
  if (!$('profilePane').hidden) closeProfilePopup();
  setDmPanel(true, 'friends');
  return true;
}
// Configurações › Rede: como os PCs se conectam, servidores, redes Razze e o mapa de conexões
function openNetworkDialog() {
  if (!$('profilePane').hidden) closeProfilePopup();
  if ($('generalSettingsDialog').hidden) openGeneralSettings('network');
  else showSettingsTab('network');
}
// Entrar na conta: no Perfil, na parte Conta Razze
function openRazzeLogin() {
  if ($('profilePane').hidden) openProfilePopup();
  $('profileAccount').scrollIntoView({ block: 'start' });
  if (!$('razzeAuth').hidden && !$('razzeLogin').disabled) $('razzeEmail').focus();
}

// Os números de pedidos (botão de adicionar amigo e envelope) e o painel aberto (Adicionar amigo, ou as conversas
// com quem está online)
function renderAmigos() {
  const pending = friendsData.incoming.length;
  $('dmAddBadge').hidden = !pending;
  $('dmAddBadge').textContent = String(pending);
  $('dmAddOpen').title = 'Adicionar amigo e pedidos' + (pending ? ` · ${pending} ${pending === 1 ? 'pedido' : 'pedidos'} de amizade` : '');
  if (typeof renderDmBadge === 'function') renderDmBadge();
  if (typeof renderDmPanel === 'function') renderDmPanel();
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

// ---------- Amigos ----------
function setFriendsData(value) {
  friendsData.friends = value.friends || [];
  friendsData.incoming = value.incoming || [];
  friendsData.outgoing = value.outgoing || [];
  if (typeof diretoSoAmigos === 'function') diretoSoAmigos(); // quem deixou de ser amigo perde a conexão direta das mensagens
  renderAmigos();
  if (typeof renderHomeAmigos === 'function') renderHomeAmigos();
}
// A presença chega a cada poucos segundos (conectividade.js) com a lista de amigos do servidor: troca o online
// de quem está na lista e, se a lista mudou (o amigo desfez a amizade, ou aceitou um pedido seu), recarrega tudo.
// Desfazer a amizade vale para os dois lados: some daqui também, sem precisar reabrir o app.
function updateFriendsPresence(live) {
  const byId = new Map((live.friends || []).map((f) => [f.id, f]));
  friendsData.error = live.error || '';
  const mudou = !live.error && !!live.updatedAt && Array.isArray(live.friends)
    && (live.friends.length !== friendsData.friends.length || friendsData.friends.some((f) => !byId.has(f.id)));
  if (mudou && typeof razzeUser !== 'undefined' && razzeUser) {
    setFriendsData({ ...friendsData, friends: friendsData.friends.filter((f) => byId.has(f.id)) });
    void refreshRazzeLists().catch(() => {}); // quem entrou na lista e os pedidos
  }
  let salaMudou = false;
  for (const f of friendsData.friends) {
    if (!byId.has(f.id)) continue;
    const vivo = byId.get(f.id);
    f.online = !!vivo.online;
    const sala = vivo.sala || null; // em que sala o amigo está (salas-amigos.js: textoSalaDoAmigo)
    if (JSON.stringify(sala) !== JSON.stringify(f.sala || null)) { f.sala = sala; salaMudou = true; }
  }
  renderAmigos();
  if (salaMudou && typeof renderHomeAmigos === 'function') renderHomeAmigos();
}
function friendsStatus(text) { $('razzeFriendsStatus').textContent = text; }
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Adicionar amigo: true abre o painel com o foco no campo; false limpa o campo (o pedido saiu) e o painel fica aberto
function setFriendsAddOpen(on) {
  showFriendsAddError('');
  if (on) {
    if ($('dmFriends').hidden) setDmPanel(true, 'friends');
    $('razzeFriendNickname').focus();
    if (typeof renderLinksAmigo === 'function') void renderLinksAmigo();
  } else { $('razzeFriendNickname').value = ''; syncFriendsAddButton(); }
}
// Enviar só fica ativo com algo digitado
function syncFriendsAddButton() { $('razzeAddFriend').disabled = !$('razzeFriendNickname').value.trim(); }
// Erro do envio aparece embaixo do campo (vazio = sem erro)
function showFriendsAddError(text) {
  const hint = $('friendsAddHint');
  hint.textContent = text || 'Nickname exato, link ou código de convite (ABCD-EFGH-JK).';
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
  const online = (f) => !friendsData.error && !!f.online;
  const counts = { in: friendsData.incoming.length, out: friendsData.outgoing.length, all: friendsData.friends.length };
  const labels = { in: 'Recebidos', out: 'Enviados', all: 'Amigos' };
  for (const b of $('friendsViews').querySelectorAll('button')) {
    const v = b.dataset.view, sel = v === friendsFilter.view;
    b.textContent = counts[v] ? `${labels[v]} · ${counts[v]}` : labels[v];
    b.setAttribute('aria-selected', String(sel));
    b.tabIndex = sel ? 0 : -1;
  }

  const groups = [];
  const view = friendsFilter.view;
  const on = friendsData.friends.filter(online), off = friendsData.friends.filter((f) => !online(f));
  if (view === 'in' && counts.in) groups.push(['', friendsData.incoming.map(incomingRow)]);
  if (view === 'out' && counts.out) groups.push(['', friendsData.outgoing.map(outgoingRow)]);
  if (view === 'all' && on.length) groups.push([`Online · ${on.length}`, on.map((f) => friendRow(f, true))]);
  if (view === 'all' && off.length) groups.push([`Offline · ${off.length}`, off.map((f) => friendRow(f, false))]);
  box.replaceChildren();
  for (const [title, rows] of groups) {
    if (title) {
      const h = document.createElement('h3');
      h.className = 'hub-section';
      h.textContent = title;
      box.append(h);
    }
    const ul = document.createElement('ul');
    ul.className = 'hub-list';
    ul.append(...rows);
    box.append(ul);
  }
  const empty = $('friendsEmpty');
  empty.hidden = groups.length > 0;
  empty.textContent = view === 'in' ? 'Nenhum pedido de amizade chegou.'
    : view === 'out' ? 'Nenhum pedido esperando resposta. Digite um nickname acima para enviar.'
    : 'Você ainda não tem amigos. Digite o nickname de alguém acima.';
  if (keep) focusFriendControl(keep);
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
  // Online: em que sala o amigo está, se ele anunciou (salas-amigos.js: textoSalaDoAmigo)
  const naSala = isOnline && typeof textoSalaDoAmigo === 'function' ? textoSalaDoAmigo(f) : '';
  const info = hubInfo(f.displayName, naSala || (isOnline ? 'Online' : friendsData.error ? 'Indisponível' : 'Offline'));
  if (naSala) info.lastChild.title = naSala; // cortado com "…" quando não cabe
  info.lastChild.dataset.friendPresence = f.id; // o teste da Razze confere o texto por aqui
  info.lastChild.classList.toggle('on', isOnline);
  li.append(hubAvatar(f.displayName, isOnline), info,
    hubIconButton(ICON.chat, `Mandar mensagem para ${f.displayName}`, () => openDm(f.id), 'hub-talk', 'talk:' + f.id),
    hubIconButton(ICON.phone, `Ligar para ${f.displayName} (cria uma sala só para vocês e entra na voz)`, () => void ligarPara(f.id), 'hub-talk hub-call', 'call:' + f.id));
  // Convidar só faz sentido para quem está online
  if (isOnline) {
    // A sala pela internet em que o amigo está e que ele deixa entrar: Entrar, sem código nem senha (salas-amigos.js)
    const salaDele = typeof salaDoAmigo === 'function' ? salaDoAmigo(f) : null;
    if (salaDele) li.append(hubButton('Entrar', () => void entrarPeloAmigo(f), 'btn small primary hub-entrar', `Entrar na sala de ${salaDele.host}, onde ${f.displayName} está`));
    const inRoom = !!state.myId && !!state.roomAddr;
    const invite = hubButton('Convidar', () => convidarPorMensagem(f), 'btn small' + (inRoom ? ' primary' : ''),
      inRoom ? `Mandar um convite para a sua sala nas mensagens de ${f.displayName}` : 'Entre numa sala para convidar');
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
// A confirmação já aconteceu na própria linha (friendRow)
async function removeFriend(f) {
  friendsUi.confirm = null;
  try { await window.api.razzeRemoveFriend(f.id); friendsStatus(`${f.displayName} saiu da sua lista de amigos.`); await refreshRazzeLists(); }
  catch (error) { friendsStatus('Não foi possível remover: ' + error.message); }
}

function setupAmigos() {
  const views = [...$('friendsViews').querySelectorAll('button')];
  for (const b of views) b.onclick = () => { friendsFilter.view = b.dataset.view; renderFriends(); };
  // Setas trocam entre Recebidos, Enviados e Amigos
  $('friendsViews').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = views.findIndex((b) => b.dataset.view === friendsFilter.view);
    const next = views[(i + (e.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length];
    friendsFilter.view = next.dataset.view;
    renderFriends();
    next.focus();
  });
  $('razzeFriendNickname').addEventListener('input', () => { syncFriendsAddButton(); if ($('friendsAddHint').classList.contains('erro')) showFriendsAddError(''); });
  // Esc fecha primeiro o menu "⋯" ou a pergunta; sem nada, fecha o painel Adicionar amigo (mensagens.js)
  $('dmFriends').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const id = friendsUi.menu || friendsUi.confirm;
    if (id) { e.stopPropagation(); setFriendMenu(null); focusFriendControl('more:' + id); }
  });
  // Clique fora do menu "⋯" fecha o menu
  document.addEventListener('mousedown', (e) => {
    if (friendsUi.menu && !e.target.closest('.hub-menu, .hub-more')) closeFriendMenuQuietly();
  });
}
// Fecha o menu sem redesenhar a lista: o clique que fechou pode ser num botão de outra linha e precisa chegar nele
function closeFriendMenuQuietly() {
  friendsUi.menu = null;
  $('razzeFriends').querySelector('.hub-menu')?.remove();
  $('razzeFriends').querySelector('.hub-more[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
}
