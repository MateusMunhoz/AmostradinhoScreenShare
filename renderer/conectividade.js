'use strict';
// Rede: como os PCs se conectam (Radmin ou rede local, ou a VPN Razze com WireGuard).
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, navegacao.
//
// Fica numa janela própria (ícone de servidor na barra de cima), separada das Configurações gerais. O Razze
// aparece em passos, na ordem em que se faz: 1) servidor, 2) conta, 3) redes, 4) amigos. Redes e amigos só
// aparecem com a conta aberta. No topo, uma linha diz em que pé está a conexão.

const NETWORK_PREF_KEY = 'connectivity.v1';
let razzeUser = null;
let networkReturnFocus = null;
const VISIBILITY = { private: 'Privada', friends: 'Só amigos', public: 'Pública' };

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
  if (!state.configured || !state.authenticated) throw new Error('Configure o servidor Razze e entre na sua conta na aba Rede (ícone de servidor, no topo).');
  if (!prefs.activeNetworkId) throw new Error('Conecte uma rede Razze na aba Rede (ícone de servidor, no topo).');
  const tunnel = await window.api.razzeWireGuardStatus(prefs.activeNetworkId);
  if (!tunnel.connected) throw new Error('Conecte a rede Razze escolhida na aba Rede antes de criar ou entrar numa sala.');
}

// ---------- A janela ----------
function openNetworkDialog() {
  if (!$('profilePane').hidden) closeProfilePopup();
  if (!$('generalSettingsDialog').hidden) closeGeneralSettings();
  networkReturnFocus = document.activeElement;
  renderConnectivitySettings();
  $('networkDialog').hidden = false;
  syncWorkspace();
  setUtilityBackground(true);
  $('closeNetworkDialog').focus();
}
function closeNetworkDialog() {
  $('networkDialog').hidden = true;
  syncWorkspace();
  setUtilityBackground(false);
  (networkReturnFocus || $('navNetwork')).focus();
}

// Linha do topo: em que pé está a conexão
function setNetSummary(ok, text) {
  $('netSummaryDot').className = 'dot ' + (ok ? 'ok' : 'hollow'); // cheia: pronto; vazada: falta um passo
  $('netSummaryText').textContent = text;
}
// O número do passo vira ✓ quando ele está pronto
function setStepDone(id, done, n) {
  $(id).textContent = done ? '✓' : String(n);
  $(id).classList.toggle('done', done);
}

function renderConnectivitySettings() {
  const prefs = networkPreferences();
  document.querySelectorAll('input[name="networkProvider"]').forEach((r) => { r.checked = r.value === prefs.provider; });
  $('razzeApiUrl').value = prefs.apiUrl;
  $('razzeSettings').hidden = prefs.provider !== 'razze';
  $('networkHint').textContent = prefs.provider === 'razze'
    ? 'Uma VPN WireGuard coordenada pelo seu servidor Razze: cada um entra com a própria conta, numa rede criada por alguém do grupo.'
    : 'Como sempre foi: os amigos entram pelo seu endereço da Radmin VPN ou da rede local, e as sessões abertas aparecem sozinhas.';
  if (prefs.provider === 'radmin') { // o mesmo estado do rodapé da tela inicial (Radmin encontrada ou não)
    const ok = $('radminDot').classList.contains('ok');
    setNetSummary(ok, ok ? `${$('radminTitle').textContent} · ${$('radminDetail').textContent}. Os amigos entram pelo seu endereço.`
      : `${$('radminTitle').textContent}. Na rede local, os amigos entram pelo seu endereço do mesmo jeito.`);
  }
  refreshRazzeState();
}

async function refreshRazzeState() {
  if (selectedNetworkProvider() !== 'razze') return;
  const state = await window.api.razzeState();
  const account = (on) => {
    $('razzeAuth').hidden = on;
    $('razzeAccount').hidden = !on;
    $('razzeStepNetworks').hidden = !on;
    $('razzeStepFriends').hidden = !on;
  };
  account(state.authenticated);
  setStepDone('razzeStepAccountNum', state.authenticated, 2);
  if (!state.configured) {
    setStepDone('razzeStepServerNum', false, 1);
    setNetSummary(false, 'Razze: falta o endereço do servidor (passo 1).');
    return;
  }
  try {
    await window.api.razzeHealth();
    setStepDone('razzeStepServerNum', true, 1);
    if (!state.authenticated) { setNetSummary(false, 'Razze: servidor ok. Entre ou crie sua conta (passo 2).'); return; }
    const { user } = await window.api.razzeMe();
    razzeUser = user;
    $('razzeAccountName').textContent = user?.displayName || user?.email || 'Conta Razze';
    $('razzeAccountEmail').textContent = user?.displayName ? user.email || '' : '';
    $('razzeAccountAvatar').textContent = ((user?.displayName || user?.email || '?').trim()[0] || '?').toUpperCase();
    await refreshRazzeLists();
  } catch (error) {
    setStepDone('razzeStepServerNum', false, 1);
    setNetSummary(false, 'Razze: ' + error.message);
    const current = await window.api.razzeState().catch(() => ({ authenticated: false }));
    account(current.authenticated);
  }
}

// Linha do topo com a rede conectada (ou o que falta)
async function renderRazzeSummary(networks) {
  const active = networkPreferences().activeNetworkId;
  const net = networks.find((n) => n.id === active);
  const tunnel = net ? await window.api.razzeWireGuardStatus(net.id).catch(() => ({ connected: false })) : { connected: false };
  setStepDone('razzeStepNetworksNum', !!tunnel.connected, 3);
  if (net && tunnel.connected) setNetSummary(true, `Razze: conectado na rede ${net.name}${tunnel.overlayIp ? ' · ' + tunnel.overlayIp : ''}.`);
  else setNetSummary(false, networks.length ? 'Razze: conecte uma das suas redes (passo 3).' : 'Razze: crie uma rede ou entre com um convite (passo 3).');
}

async function refreshRazzeLists() {
  const result = await window.api.razzeListNetworks();
  const networks = result.networks || [];
  $('razzeNetworks').replaceChildren(...networks.map((network) => razzeNetworkCard(network)));
  $('razzeNetworksEmpty').hidden = networks.length > 0;
  void renderRazzeSummary(networks);
  const friends = await window.api.razzeFriends();
  const requests = await window.api.razzeFriendRequests();
  const friendBox = $('razzeFriends');
  friendBox.replaceChildren();
  const row = (text, hint, button) => {
    const r = document.createElement('div');
    r.className = 'razze-row';
    const label = document.createElement('span');
    if (hint) label.className = 'hint';
    label.textContent = text;
    r.append(label);
    if (button) r.append(button);
    friendBox.append(r);
  };
  const btn = (text, onclick, cls = 'btn small') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.onclick = onclick; return b; };
  for (const request of requests.incoming || []) {
    row('Pedido de ' + request.displayName + ' (' + request.email + ')', false,
      btn('Aceitar', async () => { await window.api.razzeAcceptFriend(request.id); await refreshRazzeLists(); }, 'btn small primary'));
  }
  for (const friend of friends.friends || []) {
    row(friend.displayName + ' · ' + friend.email, false,
      btn('Remover', async () => { await window.api.razzeRemoveFriend(friend.id); await refreshRazzeLists(); }));
  }
  for (const request of requests.outgoing || []) {
    row('Pedido enviado para ' + request.displayName + ' (' + request.email + ') · aguardando resposta', true);
  }
}

// Cartão de uma rede: nome e se está conectada; um botão principal (Conectar ou Atualizar participantes),
// Desconectar só quando conectada; o resto (convite, membros, editar, excluir, sair) atrás de "Gerenciar"
function razzeNetworkCard(network) {
  const card = document.createElement('article');
  card.className = 'razze-network';
  const btn = (text, cls = 'btn small') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; return b; };
  const status = (text) => { $('razzeStatus').textContent = text; };

  const head = document.createElement('div');
  head.className = 'razze-network-head';
  const titles = document.createElement('div');
  titles.className = 'razze-network-titles';
  const title = document.createElement('strong');
  title.textContent = network.name;
  const subtitle = document.createElement('span');
  subtitle.className = 'hint';
  subtitle.textContent = [network.description, VISIBILITY[network.visibility]].filter(Boolean).join(' · ') || 'Rede Razze';
  titles.append(title, subtitle);
  const badge = document.createElement('span');
  badge.className = 'net-badge';
  badge.textContent = network.isMember ? 'Desconectada' : 'Precisa de convite';
  head.append(titles, badge);

  const actions = document.createElement('div');
  actions.className = 'razze-row razze-actions';
  const connect = btn(network.isMember ? 'Conectar' : 'Precisa de convite', 'btn small primary');
  connect.disabled = !network.isMember;
  const disconnect = btn('Desconectar');
  disconnect.hidden = true;
  const showTunnel = (on, ip) => {
    connect.textContent = on ? 'Atualizar participantes' : 'Conectar';
    connect.title = on ? 'Busca quem entrou ou saiu da rede e atualiza o túnel' : 'Liga o túnel WireGuard desta rede';
    disconnect.hidden = !on;
    badge.textContent = on ? 'Conectada' + (ip ? ' · ' + ip : '') : 'Desconectada';
    badge.classList.toggle('on', on);
  };
  if (network.isMember) window.api.razzeWireGuardStatus(network.id).then((s) => showTunnel(!!s.connected, s.overlayIp)).catch(() => {});
  connect.onclick = async () => {
    const current = await window.api.razzeWireGuardStatus(network.id).catch(() => ({ connected: false }));
    if (current.connected && !confirm('Atualizar a lista de participantes agora? Se o Windows não deixar atualizar com o túnel ligado, ele reinicia por alguns segundos.')) return;
    connect.disabled = true;
    status(current.connected ? 'Atualizando os participantes e reiniciando o túnel…' : 'Negociando o endereço e ligando o túnel WireGuard…');
    try {
      const result = await window.api.razzeWireGuardConnect(network.id, network.name);
      saveNetworkPreferences({ activeNetworkId: network.id });
      showTunnel(true, result.overlayIp);
      status('VPN conectada em ' + result.overlayIp + (result.publicIp ? ' · endpoint público ' + result.publicIp : '') + '.');
      setNetSummary(true, `Razze: conectado na rede ${network.name} · ${result.overlayIp}.`);
      setStepDone('razzeStepNetworksNum', true, 3);
      renderRadmin();
    } catch (error) { status('Falha no WireGuard: ' + error.message); }
    finally { connect.disabled = false; }
  };
  disconnect.onclick = async () => {
    disconnect.disabled = true;
    try {
      const result = await window.api.razzeWireGuardDisconnect(network.id);
      if (!result.ok) throw new Error(result.error);
      if (networkPreferences().activeNetworkId === network.id) saveNetworkPreferences({ activeNetworkId: '' });
      showTunnel(false);
      status('Túnel WireGuard desconectado.');
      setNetSummary(false, 'Razze: conecte uma das suas redes (passo 3).');
      setStepDone('razzeStepNetworksNum', false, 3);
      renderRadmin();
    } catch (error) { status('Falha ao desconectar: ' + error.message); }
    finally { disconnect.disabled = false; }
  };
  actions.append(connect, disconnect);

  // Gerenciar: o que não se usa toda hora
  const owner = razzeUser && network.ownerId === razzeUser.id;
  const manage = document.createElement('div');
  manage.className = 'razze-manage';
  manage.hidden = true;
  const manageRow = document.createElement('div');
  manageRow.className = 'razze-row';
  manage.append(manageRow);
  if (network.isMember || owner) {
    const toggle = btn('Gerenciar', 'btn small ghost razze-manage-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.onclick = () => { manage.hidden = !manage.hidden; toggle.setAttribute('aria-expanded', String(!manage.hidden)); };
    actions.append(toggle);
  }

  if (owner) {
    const invite = btn('Criar convite');
    invite.onclick = async () => {
      try {
        const created = await window.api.razzeCreateInvite(network.id, { maxUses: 10, ttlHours: 168 });
        const link = 'telap2p://invite/' + created.token;
        try { await navigator.clipboard.writeText(link); status('Link de convite copiado. Vale por 7 dias e até 10 entradas.'); }
        catch { prompt('Copie o link de convite', link); }
      } catch (error) { status('Não foi possível criar convite: ' + error.message); }
    };
    // Membros: quem está na rede, e tirar alguém
    const membersBox = document.createElement('div');
    membersBox.className = 'razze-members';
    membersBox.hidden = true;
    const members = btn('Membros');
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
            const remove = btn('Remover', 'btn small danger');
            remove.onclick = async () => {
              if (!confirm('Tirar ' + member.displayName + ' da rede ' + network.name + '?')) return;
              remove.disabled = true;
              try {
                await window.api.razzeRemoveMember(network.id, member.id);
                status(member.displayName + ' saiu da rede. Ele some do túnel dos outros na próxima atualização.');
                await renderMembersList();
              } catch (error) { status('Não foi possível remover: ' + error.message); remove.disabled = false; }
            };
            row.append(remove);
          }
          return row;
        }));
      } catch (error) { status('Não foi possível listar os membros: ' + error.message); }
    };
    members.onclick = async () => {
      membersBox.hidden = !membersBox.hidden;
      if (!membersBox.hidden) await renderMembersList();
    };
    // Editar: formulário no próprio cartão (nome, descrição, visibilidade)
    const form = document.createElement('div');
    form.className = 'razze-edit';
    form.hidden = true;
    const nameIn = Object.assign(document.createElement('input'), { type: 'text', maxLength: 80, value: network.name });
    nameIn.setAttribute('aria-label', 'Nome da rede');
    const descIn = Object.assign(document.createElement('input'), { type: 'text', maxLength: 200, value: network.description || '', placeholder: 'Descrição (opcional)' });
    descIn.setAttribute('aria-label', 'Descrição da rede');
    const visIn = document.createElement('select');
    visIn.setAttribute('aria-label', 'Quem pode ver a rede');
    for (const [value, label] of Object.entries(VISIBILITY)) visIn.append(Object.assign(document.createElement('option'), { value, textContent: label }));
    visIn.value = network.visibility || 'private';
    const save = btn('Salvar', 'btn small primary');
    const cancel = btn('Cancelar', 'btn small ghost');
    const formRow = document.createElement('div');
    formRow.className = 'razze-row';
    formRow.append(save, cancel);
    form.append(nameIn, descIn, visIn, formRow);
    const edit = btn('Editar');
    edit.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) nameIn.focus(); };
    cancel.onclick = () => { form.hidden = true; };
    save.onclick = async () => {
      if (!nameIn.value.trim()) { nameIn.focus(); return; }
      try { await window.api.razzeUpdateNetwork(network.id, { name: nameIn.value.trim(), description: descIn.value.trim(), visibility: visIn.value }); await refreshRazzeLists(); }
      catch (error) { status('Não foi possível editar a rede: ' + error.message); }
    };
    const remove = btn('Excluir rede', 'btn small danger');
    remove.onclick = async () => {
      if (!confirm('Excluir a rede ' + network.name + '? Todo mundo sai dela.')) return;
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
      } catch (error) { status('Não foi possível excluir a rede: ' + error.message); }
    };
    manageRow.append(invite, members, edit, remove);
    manage.append(form, membersBox);
  } else if (network.isMember && razzeUser) {
    // Membro: sair da rede (o túnel dela desliga antes)
    const leave = btn('Sair da rede', 'btn small danger');
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
        status('Você saiu da rede ' + network.name + '.');
        await refreshRazzeLists();
        renderRadmin();
      } catch (error) { status('Não foi possível sair da rede: ' + error.message); }
      finally { leave.disabled = false; }
    };
    manageRow.append(leave);
  }
  card.append(head, actions, manage);
  return card;
}

// Entrar ou criar conta: duas abas; o nome só aparece em Criar conta
function setRazzeAuthTab(register) {
  $('razzeTabLogin').setAttribute('aria-selected', String(!register));
  $('razzeTabRegister').setAttribute('aria-selected', String(register));
  $('razzeNameField').hidden = !register;
  $('razzeLogin').hidden = register;
  $('razzeRegister').hidden = !register;
  $('razzePassword').autocomplete = register ? 'new-password' : 'current-password';
}

function setupConnectivitySettings() {
  setIcon($('closeNetworkDialog'), 'close', 'Fechar');
  setupUtilityPopup('networkDialog', closeNetworkDialog);
  $('navNetwork').onclick = () => ($('networkDialog').hidden ? openNetworkDialog() : closeNetworkDialog());
  $('closeNetworkDialog').onclick = closeNetworkDialog;
  document.querySelectorAll('input[name="networkProvider"]').forEach((r) => {
    r.onchange = () => {
      saveNetworkPreferences({ provider: r.value });
      renderConnectivitySettings();
      renderRadmin();
      setSessionWatch(!$('home').hidden);
    };
  });
  $('razzeTabLogin').onclick = () => setRazzeAuthTab(false);
  $('razzeTabRegister').onclick = () => setRazzeAuthTab(true);
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
      await window.api.razzeHealth();
      $('razzeStatus').textContent = 'Servidor acessível.';
      await refreshRazzeState();
    } catch (error) { $('razzeStatus').textContent = 'Servidor inválido: ' + error.message; setStepDone('razzeStepServerNum', false, 1); }
  };
  $('razzeLogin').onclick = async () => {
    $('razzeLogin').disabled = true;
    try {
      const result = await window.api.razzeLogin($('razzeEmail').value.trim(), $('razzePassword').value);
      razzeUser = result.user;
      $('razzePassword').value = '';
      $('razzeStatus').textContent = 'Você entrou na sua conta.';
      await refreshRazzeState();
    } catch (error) { $('razzeStatus').textContent = 'Não foi possível entrar: ' + error.message; }
    finally { $('razzeLogin').disabled = false; }
  };
  $('razzeRegister').onclick = async () => {
    $('razzeRegister').disabled = true;
    try {
      const result = await window.api.razzeRegister($('razzeEmail').value.trim(), $('razzePassword').value, $('razzeDisplayName').value.trim());
      $('razzePassword').value = '';
      $('razzeStatus').textContent = result.status === 'pending_approval' ? 'Cadastro enviado. Aguarde a aprovação do administrador do servidor e depois entre.' : 'Conta criada. Agora é só entrar.';
      setRazzeAuthTab(false);
    } catch (error) { $('razzeStatus').textContent = 'Não foi possível criar a conta: ' + error.message; }
    finally { $('razzeRegister').disabled = false; }
  };
  $('razzeLogout').onclick = async () => {
    const disconnected = await window.api.razzeWireGuardDisconnectAll();
    if (!disconnected.ok) {
      $('razzeStatus').textContent = 'Desconecte todas as redes antes de sair da conta: ' + disconnected.errors.join('; ');
      return;
    }
    saveNetworkPreferences({ activeNetworkId: '' });
    await window.api.razzeLogout();
    razzeUser = null;
    $('razzeStatus').textContent = 'Você saiu da conta.';
    renderConnectivitySettings();
  };
  $('razzeCreateNetwork').onclick = async () => {
    const name = $('razzeNetworkName').value.trim();
    if (!name) { $('razzeNetworkName').focus(); return; }
    try {
      await window.api.razzeCreateNetwork({ name, visibility: 'private' });
      $('razzeNetworkName').value = '';
      $('razzeStatus').textContent = `Rede ${name} criada. Clique em Conectar e mande um convite para os amigos (em Gerenciar).`;
      await refreshRazzeLists();
    } catch (error) { $('razzeStatus').textContent = 'Não foi possível criar a rede: ' + error.message; }
  };
  $('razzeJoinInvite').onclick = async () => {
    try {
      const token = inviteTokenFromValue($('razzeInviteToken').value);
      if (!token) throw new Error('Cole um link telap2p://invite/… ou o código do convite.');
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
  // Enter nos campos de uma linha faz o mesmo que o botão ao lado
  for (const [input, button] of [['razzeApiUrl', 'razzeSaveServer'], ['razzeNetworkName', 'razzeCreateNetwork'], ['razzeInviteToken', 'razzeJoinInvite'], ['razzeFriendEmail', 'razzeAddFriend']]) {
    $(input).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $(button).click(); } });
  }
  $('razzePassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ($('razzeLogin').hidden ? $('razzeRegister') : $('razzeLogin')).click(); } });
  const acceptInviteLink = async (token) => {
    $('razzeInviteToken').value = token;
    saveNetworkPreferences({ provider: 'razze' });
    if ($('networkDialog').hidden) openNetworkDialog();
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
  // Abriu o app com o túnel da rede ligado: volta a buscar quem entrou na rede (sem clicar em Atualizar)
  const prefs = networkPreferences();
  if (prefs.provider === 'razze' && prefs.activeNetworkId) window.api.razzeWireGuardResume(prefs.activeNetworkId).catch(() => {});
  window.api.razzePendingInvite().then((token) => { if (token) void acceptInviteLink(token); }).catch(() => {});
}
