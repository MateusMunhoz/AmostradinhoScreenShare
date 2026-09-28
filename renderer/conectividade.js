'use strict';

const NETWORK_PREF_KEY = 'connectivity.v1';
let razzeUser = null;

function networkPreferences() {
  try {
    const p = JSON.parse(localStorage.getItem(NETWORK_PREF_KEY) || '{}');
    return {
      provider: p.provider === 'razze' ? 'razze' : 'radmin',
      apiUrl: typeof p.apiUrl === 'string' ? p.apiUrl : '',
      activeNetworkId: typeof p.activeNetworkId === 'string' ? p.activeNetworkId : '',
    };
  } catch { return { provider: 'radmin', apiUrl: '', activeNetworkId: '' }; }
}

function inviteTokenFromValue(value) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{20,120}$/.test(raw)) return raw;
  try {
    const link = new URL(raw);
    if (link.protocol === 'telap2p:' && link.hostname === 'invite') {
      const token = link.pathname.replace(/^\//, '');
      if (/^[A-Za-z0-9_-]{20,120}$/.test(token)) return token;
    }
  } catch {}
  return '';
}

function saveNetworkPreferences(patch) {
  const next = { ...networkPreferences(), ...patch };
  localStorage.setItem(NETWORK_PREF_KEY, JSON.stringify(next));
  return next;
}

function selectedNetworkProvider() { return networkPreferences().provider; }

async function requireSelectedNetwork() {
  if (selectedNetworkProvider() !== 'razze') return;
  const prefs = networkPreferences();
  const state = await window.api.razzeState();
  if (!state.configured || !state.authenticated) throw new Error('Configure o servidor Razze e entre na sua conta nas configurações gerais.');
  if (!prefs.activeNetworkId) throw new Error('Entre em uma rede Razze e conecte o WireGuard nas configurações gerais.');
  const tunnel = await window.api.razzeWireGuardStatus(prefs.activeNetworkId);
  if (!tunnel.connected) throw new Error('Conecte o túnel WireGuard da rede escolhida antes de criar ou entrar numa sala.');
}

function renderConnectivitySettings() {
  const prefs = networkPreferences();
  $('networkProvider').value = prefs.provider;
  $('razzeApiUrl').value = prefs.apiUrl;
  $('razzeSettings').hidden = prefs.provider !== 'razze';
  refreshRazzeState();
}

async function refreshRazzeState() {
  const status = $('razzeStatus');
  if (!status) return;
  const state = await window.api.razzeState();
  $('razzeAuth').hidden = state.authenticated;
  $('razzeAccount').hidden = !state.authenticated;
  if (!state.configured) {
    status.textContent = 'Informe o endereço HTTPS do servidor Razze e teste a conexão.';
    return;
  }
  try {
    await window.api.razzeHealth();
    status.textContent = state.authenticated ? 'Servidor acessível; sessão iniciada.' : 'Servidor acessível. Entre ou crie sua conta.';
    if (state.authenticated) {
      const { user } = await window.api.razzeMe();
      razzeUser = user;
      $('razzeAccountName').textContent = user?.displayName || user?.email || 'Conta Razze';
      await refreshRazzeLists();
    }
  } catch (error) {
    status.textContent = 'Razze: ' + error.message;
    const current = await window.api.razzeState().catch(() => ({ authenticated: false }));
    $('razzeAuth').hidden = current.authenticated;
    $('razzeAccount').hidden = !current.authenticated;
  }
}

async function refreshRazzeLists() {
  const result = await window.api.razzeListNetworks();
  const container = $('razzeNetworks');
  container.replaceChildren(...(result.networks || []).map((network) => razzeNetworkCard(network)));
  const friends = await window.api.razzeFriends();
  const requests = await window.api.razzeFriendRequests();
  const friendBox = $('razzeFriends');
  friendBox.replaceChildren();
  for (const friend of friends.friends || []) {
    const row = document.createElement('div');
    row.className = 'razze-row';
    const label = document.createElement('span');
    label.className = 'hint';
    label.textContent = friend.displayName + ' · ' + friend.email;
    const remove = document.createElement('button');
    remove.className = 'btn small';
    remove.textContent = 'Remover';
    remove.onclick = async () => { await window.api.razzeRemoveFriend(friend.id); await refreshRazzeLists(); };
    row.append(label, remove);
    friendBox.append(row);
  }
  for (const request of requests.incoming || []) {
    const row = document.createElement('div');
    row.className = 'razze-row';
    const label = document.createElement('span');
    label.textContent = 'Pedido de ' + request.displayName + ' (' + request.email + ')';
    const accept = document.createElement('button');
    accept.className = 'btn small';
    accept.textContent = 'Aceitar';
    accept.onclick = async () => { await window.api.razzeAcceptFriend(request.id); await refreshRazzeLists(); };
    row.append(label, accept);
    friendBox.append(row);
  }
  for (const request of requests.outgoing || []) {
    const row = document.createElement('div');
    row.className = 'razze-row';
    const label = document.createElement('span');
    label.className = 'hint';
    label.textContent = 'Pedido enviado para ' + request.displayName + ' (' + request.email + ') · aguardando resposta';
    row.append(label);
    friendBox.append(row);
  }
}

function razzeNetworkCard(network) {
  const card = document.createElement('article');
  card.className = 'razze-network';
  const title = document.createElement('strong');
  title.textContent = network.name;
  const subtitle = document.createElement('span');
  subtitle.className = 'hint';
  subtitle.textContent = network.description || network.visibility || 'Rede Razze';
  const actions = document.createElement('div');
  actions.className = 'razze-row';
  const connect = document.createElement('button');
  connect.className = 'btn small primary';
  connect.textContent = network.isMember ? 'Conectar WireGuard' : 'Precisa de convite';
  connect.disabled = !network.isMember;
  if (network.isMember) window.api.razzeWireGuardStatus(network.id).then((state) => {
    if (state.connected) connect.textContent = 'Atualizar peers';
  }).catch(() => {});
  connect.onclick = async () => {
    const current = await window.api.razzeWireGuardStatus(network.id).catch(() => ({ connected: false }));
    if (current.connected && !confirm('Atualizar a lista de participantes reinicia brevemente o túnel WireGuard. Continuar?')) return;
    connect.disabled = true;
    $('razzeStatus').textContent = current.connected ? 'Atualizando a lista de peers e reiniciando o túnel…' : 'Negociando endpoint e iniciando túnel WireGuard…';
    try {
      const result = await window.api.razzeWireGuardConnect(network.id, network.name);
      saveNetworkPreferences({ activeNetworkId: network.id });
      connect.textContent = 'Atualizar peers';
      $('razzeStatus').textContent = 'VPN conectada em ' + result.overlayIp + (result.publicIp ? ' · endpoint público ' + result.publicIp : '') + '.';
      renderRadmin();
    } catch (error) { $('razzeStatus').textContent = 'Falha no WireGuard: ' + error.message; }
    finally { connect.disabled = false; }
  };
  const disconnect = document.createElement('button');
  disconnect.className = 'btn small';
  disconnect.textContent = 'Desconectar';
  disconnect.onclick = async () => {
    disconnect.disabled = true;
    try {
      const result = await window.api.razzeWireGuardDisconnect(network.id);
      if (!result.ok) throw new Error(result.error);
      if (networkPreferences().activeNetworkId === network.id) saveNetworkPreferences({ activeNetworkId: '' });
      connect.textContent = 'Conectar WireGuard';
      $('razzeStatus').textContent = 'Túnel WireGuard desconectado.';
      renderRadmin();
    } catch (error) { $('razzeStatus').textContent = 'Falha ao desconectar: ' + error.message; }
    finally { disconnect.disabled = false; }
  };
  actions.append(connect, disconnect);
  let membersBtn = null;
  // Membro: sair da rede (o túnel dela desliga antes)
  if (network.isMember && razzeUser && network.ownerId !== razzeUser.id) {
    const leave = document.createElement('button');
    leave.className = 'btn small danger';
    leave.textContent = 'Sair da rede';
    leave.onclick = async () => {
      if (!confirm('Sair da rede ' + network.name + '? Para voltar, você vai precisar de um convite novo.')) return;
      leave.disabled = true;
      try {
        const tunnel = await window.api.razzeWireGuardStatus(network.id).catch(() => ({ exists: false }));
        if (tunnel.exists) {
          const disconnected = await window.api.razzeWireGuardDisconnect(network.id);
          if (!disconnected.ok) throw new Error('não foi possível desligar o túnel: ' + disconnected.error);
        }
        if (networkPreferences().activeNetworkId === network.id) saveNetworkPreferences({ activeNetworkId: '' });
        await window.api.razzeRemoveMember(network.id, 'me');
        $('razzeStatus').textContent = 'Você saiu da rede ' + network.name + '.';
        await refreshRazzeLists();
        renderRadmin();
      } catch (error) { $('razzeStatus').textContent = 'Não foi possível sair da rede: ' + error.message; }
      finally { leave.disabled = false; }
    };
    actions.append(leave);
  }
  if (razzeUser && network.ownerId === razzeUser.id) {
    // Dono: ver quem está na rede e tirar alguém
    const membersBox = document.createElement('div');
    membersBox.className = 'razze-members';
    membersBox.hidden = true;
    const members = document.createElement('button');
    members.className = 'btn small';
    members.textContent = 'Membros';
    const renderMembersList = async () => {
      try {
        const list = (await window.api.razzeListMembers(network.id)).members || [];
        membersBox.replaceChildren(...list.map((member) => {
          const row = document.createElement('div');
          row.className = 'razze-row';
          const label = document.createElement('span');
          label.className = 'hint';
          label.textContent = member.displayName + ' · ' + member.email + (member.id === network.ownerId ? ' · dono' : '');
          row.append(label);
          if (member.id !== network.ownerId) {
            const remove = document.createElement('button');
            remove.className = 'btn small danger';
            remove.textContent = 'Remover';
            remove.onclick = async () => {
              if (!confirm('Tirar ' + member.displayName + ' da rede ' + network.name + '?')) return;
              remove.disabled = true;
              try {
                await window.api.razzeRemoveMember(network.id, member.id);
                $('razzeStatus').textContent = member.displayName + ' saiu da rede. Ela some do túnel dos outros na próxima atualização.';
                await renderMembersList();
              } catch (error) { $('razzeStatus').textContent = 'Não foi possível remover: ' + error.message; remove.disabled = false; }
            };
            row.append(remove);
          }
          return row;
        }));
      } catch (error) { $('razzeStatus').textContent = 'Não foi possível listar os membros: ' + error.message; }
    };
    members.onclick = async () => {
      membersBox.hidden = !membersBox.hidden;
      if (!membersBox.hidden) await renderMembersList();
    };
    membersBtn = members; // entra no fim da fileira, depois de Excluir
    card.append(membersBox);
  }
  if (razzeUser && network.ownerId === razzeUser.id) {
    const invite = document.createElement('button');
    invite.className = 'btn small';
    invite.textContent = 'Criar convite';
    invite.onclick = async () => {
      try {
        const created = await window.api.razzeCreateInvite(network.id, { maxUses: 10, ttlHours: 168 });
        const link = 'telap2p://invite/' + created.token;
        try { await navigator.clipboard.writeText(link); $('razzeStatus').textContent = 'Link de convite copiado. Válido por 7 dias e até 10 entradas.'; }
        catch { prompt('Copie o link de convite', link); }
      } catch (error) { $('razzeStatus').textContent = 'Não foi possível criar convite: ' + error.message; }
    };
    const edit = document.createElement('button');
    edit.className = 'btn small';
    edit.textContent = 'Editar';
    edit.onclick = async () => {
      const name = prompt('Nome da rede', network.name);
      if (!name || !name.trim()) return;
      const description = prompt('Descrição da rede', network.description || '');
      if (description === null) return;
      const visibility = prompt('Visibilidade: private, friends ou public', network.visibility || 'private');
      if (!['private', 'friends', 'public'].includes(visibility)) { $('razzeStatus').textContent = 'Use private, friends ou public.'; return; }
      try { await window.api.razzeUpdateNetwork(network.id, { name: name.trim(), description, visibility }); await refreshRazzeLists(); }
      catch (error) { $('razzeStatus').textContent = 'Não foi possível editar a rede: ' + error.message; }
    };
    const remove = document.createElement('button');
    remove.className = 'btn small danger';
    remove.textContent = 'Excluir';
    remove.onclick = async () => {
      if (!confirm('Excluir a rede ' + network.name + '?')) return;
      try {
        const tunnel = await window.api.razzeWireGuardStatus(network.id).catch(() => ({ exists: false }));
        if (tunnel.exists) {
          const disconnected = await window.api.razzeWireGuardDisconnect(network.id);
          if (!disconnected.ok) throw new Error('Não foi possível remover o túnel: ' + disconnected.error);
        }
        if (networkPreferences().activeNetworkId === network.id) saveNetworkPreferences({ activeNetworkId: '' });
        await window.api.razzeDeleteNetwork(network.id);
        await refreshRazzeLists();
        renderRadmin();
      }
      catch (error) { $('razzeStatus').textContent = 'Não foi possível excluir a rede: ' + error.message; }
    };
    actions.append(invite, edit, remove);
  }
  if (membersBtn) actions.append(membersBtn);
  const box = card.querySelector('.razze-members');
  card.replaceChildren(title, subtitle, actions, ...(box ? [box] : []));
  return card;
}

function setupConnectivitySettings() {
  $('networkProvider').onchange = () => {
    saveNetworkPreferences({ provider: $('networkProvider').value });
    renderConnectivitySettings();
    renderRadmin();
    setSessionWatch(!$('home').hidden);
  };
  $('razzeSaveServer').onclick = async () => {
    try {
      const url = $('razzeApiUrl').value.trim();
      const before = networkPreferences();
      const state = await window.api.razzeConfigure(url);
      if (before.apiUrl && before.apiUrl !== state.baseUrl) {
        const disconnected = await window.api.razzeWireGuardDisconnectAll();
        if (!disconnected.ok) throw new Error('O endereço foi salvo, mas não foi possível encerrar todos os túneis: ' + disconnected.errors.join('; '));
      }
      saveNetworkPreferences({ apiUrl: state.baseUrl, activeNetworkId: before.apiUrl === state.baseUrl ? before.activeNetworkId : '' });
      await refreshRazzeState();
    } catch (error) { $('razzeStatus').textContent = 'Servidor inválido: ' + error.message; }
  };
  $('razzeLogin').onclick = async () => {
    $('razzeLogin').disabled = true;
    try {
      const result = await window.api.razzeLogin($('razzeEmail').value.trim(), $('razzePassword').value);
      razzeUser = result.user;
      $('razzePassword').value = '';
      await refreshRazzeState();
    } catch (error) { $('razzeStatus').textContent = 'Não foi possível entrar: ' + error.message; }
    finally { $('razzeLogin').disabled = false; }
  };
  $('razzeRegister').onclick = async () => {
    $('razzeRegister').disabled = true;
    try {
      const result = await window.api.razzeRegister($('razzeEmail').value.trim(), $('razzePassword').value, $('razzeDisplayName').value.trim());
      $('razzePassword').value = '';
      $('razzeStatus').textContent = result.status === 'pending_approval' ? 'Cadastro enviado. Aguarde a aprovação do administrador do servidor.' : 'Conta criada.';
    } catch (error) { $('razzeStatus').textContent = 'Não foi possível criar a conta: ' + error.message; }
    finally { $('razzeRegister').disabled = false; }
  };
  $('razzeLogout').onclick = async () => {
    const disconnected = await window.api.razzeWireGuardDisconnectAll();
    if (!disconnected.ok) {
      $('razzeStatus').textContent = 'Saia de todas as redes WireGuard antes de encerrar a conta: ' + disconnected.errors.join('; ');
      return;
    }
    saveNetworkPreferences({ activeNetworkId: '' });
    await window.api.razzeLogout();
    razzeUser = null;
    renderConnectivitySettings();
  };
  $('razzeCreateNetwork').onclick = async () => {
    const name = $('razzeNetworkName').value.trim();
    if (!name) return;
    try {
      await window.api.razzeCreateNetwork({ name, visibility: 'private' });
      $('razzeNetworkName').value = '';
      await refreshRazzeLists();
    } catch (error) { $('razzeStatus').textContent = 'Não foi possível criar a rede: ' + error.message; }
  };
  $('razzeJoinInvite').onclick = async () => {
    try {
      const token = inviteTokenFromValue($('razzeInviteToken').value);
      if (!token) throw new Error('Cole um token ou link telap2p://invite/... válido.');
      await window.api.razzeAcceptInvite(token);
      $('razzeInviteToken').value = '';
      await refreshRazzeLists();
      $('razzeStatus').textContent = 'Você entrou na rede.';
    } catch (error) { $('razzeStatus').textContent = 'Convite inválido: ' + error.message; }
  };
  $('razzeAddFriend').onclick = async () => {
    try {
      const result = await window.api.razzeRequestFriend($('razzeFriendEmail').value.trim());
      $('razzeFriendEmail').value = '';
      $('razzeStatus').textContent = result.status === 'accepted' ? 'Amizade aceita.' : 'Pedido de amizade enviado.';
      await refreshRazzeLists();
    } catch (error) { $('razzeStatus').textContent = 'Não foi possível adicionar amigo: ' + error.message; }
  };
  const acceptInviteLink = async (token) => {
    $('razzeInviteToken').value = token;
    if ($('generalSettingsDialog').hidden) $('navSettings').click();
    const state = await window.api.razzeState();
    if (!state.authenticated) {
      $('razzeStatus').textContent = 'Entre na sua conta Razze para aceitar o convite que chegou pelo link.';
      return;
    }
    try {
      await window.api.razzeAcceptInvite(token);
      $('razzeInviteToken').value = '';
      await refreshRazzeLists();
      $('razzeStatus').textContent = 'Convite aceito. Você entrou na rede.';
    } catch (error) { $('razzeStatus').textContent = 'Não foi possível aceitar o convite: ' + error.message; }
  };
  window.api.onRazzeInvite((token) => { void acceptInviteLink(token); });
  window.api.razzePendingInvite().then((token) => { if (token) void acceptInviteLink(token); }).catch(() => {});
}
