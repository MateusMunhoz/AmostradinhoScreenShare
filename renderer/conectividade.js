'use strict';
// Rede: como os PCs se conectam (Radmin ou rede local, a VPN Razze com WireGuard, ou pela Internet com o servidor
// da VPS: salas por código + senha, STUN e TURN, sem VPN nenhuma).
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, navegacao.
//
// Fica no HUB, aba Rede (renderer/hub.js), separada das Configurações. O Razze
// reúne servidor e redes. A conta fica no Perfil e os amigos na aba Amigos.

const NETWORK_PREF_KEY = 'connectivity.v1';
// Servidor do modo Internet da equipe: quem instala agora já entra pela internet, sem configurar nada.
// A RazzeAPI padrão (conta e amigos) fica no processo principal (main/razze-service.js).
const INTERNET_URL_PADRAO = 'ws://2.25.253.140:8765';
let razzeUser = null;
let networkReturnFocus = null;
let razzeLive = { friends: [], networks: [], rooms: [], updatedAt: null, error: '' };
const VISIBILITY = { private: 'Privada', friends: 'Só amigos', public: 'Pública' };

// O padrão é o modo Internet. Quem já usava o app antes (sem ter escolhido nada) continua na Radmin, como estava:
// o clientId e o último endereço só existem depois de entrar numa sala.
function networkPreferences() {
  try {
    if (!localStorage.getItem(NETWORK_PREF_KEY) && (localStorage.getItem('clientId') || localStorage.getItem('roomAddr'))) {
      localStorage.setItem(NETWORK_PREF_KEY, JSON.stringify({ provider: 'radmin' }));
    }
    const p = JSON.parse(localStorage.getItem(NETWORK_PREF_KEY) || '{}');
    return {
      provider: ['razze', 'radmin'].includes(p.provider) ? p.provider : 'internet',
      apiUrl: typeof p.apiUrl === 'string' ? p.apiUrl : '',
      activeNetworkId: typeof p.activeNetworkId === 'string' ? p.activeNetworkId : '',
      internetUrl: typeof p.internetUrl === 'string' && p.internetUrl.trim() ? p.internetUrl : INTERNET_URL_PADRAO,
    };
  } catch { return { provider: 'internet', apiUrl: '', activeNetworkId: '', internetUrl: INTERNET_URL_PADRAO }; }
}

// Endereço do servidor do modo Internet, como o WebSocket precisa: "1.2.3.4:8765" vira ws://1.2.3.4:8765 e um
// domínio sem porta vira wss:// (atrás do HTTPS). Vazio se não der para entender.
function normalizeInternetUrl(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  raw = raw.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
  if (!/^wss?:\/\//i.test(raw)) raw = (/:\d+(\/|$)/.test(raw) || /^\d{1,3}(\.\d{1,3}){3}$/.test(raw) ? 'ws://' : 'wss://') + raw;
  try {
    const u = new URL(raw);
    if (!['ws:', 'wss:'].includes(u.protocol) || !u.hostname) return '';
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')}`;
  } catch { return ''; }
}

function internetServerUrl() { return normalizeInternetUrl(networkPreferences().internetUrl); }

// Pergunta ao servidor se ele é mesmo o do modo Internet (sem entrar em sala nenhuma)
function testInternetServer(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); } catch { return reject(new Error('Endereço inválido.')); }
    const timer = setTimeout(() => { ws.close(); reject(new Error('Sem resposta. Confira o endereço, a porta e o firewall da VPS.')); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'info' }));
    ws.onmessage = (e) => {
      let m = null;
      try { m = JSON.parse(e.data); } catch {}
      clearTimeout(timer);
      ws.close();
      if (m?.type === 'info' && m.app === 'tela-p2p-internet') resolve({ turn: !!m.turn, stun: (Array.isArray(m.stun) ? m.stun : []).filter((u) => typeof u === 'string' && /^stuns?:[^\s]{1,200}$/.test(u)).slice(0, 5) });
      else reject(new Error('Esse endereço respondeu, mas não é um servidor do modo Internet.'));
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('Não foi possível conectar. Confira o endereço, a porta e o firewall da VPS.')); };
  });
}

// Tela inicial e Criar sala mudam de texto no modo Internet (código em vez de endereço, senha obrigatória)
function renderHomeForNetwork() {
  const internet = selectedNetworkProvider() === 'internet';
  // Pela internet, a lista é a das salas dos amigos do Razze (salas-amigos.js)
  $('sessionsTitle').textContent = internet ? 'Salas dos seus amigos' : 'Sessões abertas na sua rede';
  $('goJoin').textContent = internet ? 'Entrar com código' : 'Entrar com endereço';
  $('joinPanelTitle').textContent = internet ? 'Entrar com código' : 'Entrar com endereço';
  $('roomAddrLabel').textContent = internet ? 'Código da sala' : 'Endereço de quem criou';
  $('roomAddr').placeholder = internet ? 'ABC234' : '26.123.45.67:8765';
  $('joinPassword').placeholder = internet ? 'A senha que quem criou passou' : 'Só se a sala tiver uma';
  $('createBlockHint').textContent = internet ? 'Os amigos entram pelo código da sala' : 'Os amigos entram pelo seu endereço';
  $('roomPortField').hidden = internet;
  const visible = internet ? 'Mostrar esta sala para meus amigos do Razze' : 'Mostrar esta sessão para quem está na rede';
  const tip = internet ? 'Aparece na tela inicial dos seus amigos do Razze, que entram com um clique enquanto você estiver na sala.'
    : 'Aparece na tela inicial dos outros. A senha continua sendo pedida.';
  $('roomVisibleText').textContent = visible;
  $('roomVisibleTip').dataset.tip = tip;
  $('roomVisibleTip').setAttribute('aria-label', tip);
  $('roomPasswordLabel').textContent = internet ? 'Senha (obrigatória)' : 'Senha (opcional)';
  $('roomPassword').placeholder = internet ? 'Mínimo 4 caracteres; use uma forte' : 'Vazio = sem senha';
  $('createHint').textContent = internet
    ? 'Mande o código e a senha, ou deixe a caixinha marcada: os amigos do Razze entram pela lista, com um clique.'
    : 'A sala fecha quando todos saírem.';
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
  if (selectedNetworkProvider() === 'internet') {
    if (!internetServerUrl()) throw new Error('Coloque o endereço do servidor na aba Rede (no HUB, à esquerda).');
    return;
  }
  if (selectedNetworkProvider() !== 'razze') return;
  const prefs = networkPreferences();
  const state = await window.api.razzeState();
  if (!state.configured || !state.authenticated) throw new Error('Configure o servidor Razze e entre na sua conta na aba Rede do HUB.');
  if (!prefs.activeNetworkId) throw new Error('Conecte uma rede Razze na aba Rede (no HUB, à esquerda).');
  const tunnel = await window.api.razzeWireGuardStatus(prefs.activeNetworkId);
  if (!tunnel.connected) throw new Error('Conecte a rede Razze escolhida na aba Rede antes de criar ou entrar numa sala.');
}

// ---------- A janela ----------
// Rede e conta: moram no HUB, aba Rede (renderer/hub.js: openNetworkDialog, closeNetworkDialog)
// Amigos: moram no HUB (renderer/hub.js: openFriendsDialog, closeFriendsDialog, renderFriends)
function setRazzeStatus(text) {
  for (const id of ['razzeStatus', 'razzeAccountStatus', 'razzeFriendsStatus']) $(id).textContent = text;
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
  $('internetSettings').hidden = prefs.provider !== 'internet';
  $('internetUrl').value = prefs.internetUrl;
  $('networkHint').textContent = prefs.provider === 'razze'
    ? 'Uma VPN WireGuard coordenada pelo seu servidor Razze: cada um entra com a própria conta, numa rede criada por alguém do grupo.'
    : prefs.provider === 'internet'
      ? 'Sem VPN: a sala fica no seu servidor (VPS) e os amigos entram com código e senha. O vídeo vai direto entre os PCs; quando a internet de alguém não deixa (CGNAT, firewall), passa pelo TURN do servidor, sempre criptografado.'
      : 'Como sempre foi: os amigos entram pelo seu endereço da Radmin VPN ou da rede local, e as sessões abertas aparecem sozinhas.';
  if (prefs.provider === 'internet') {
    const url = normalizeInternetUrl(prefs.internetUrl);
    setNetSummary(!!url, url ? `Internet · servidor ${url}` : 'Internet: falta o endereço do servidor.');
  }
  renderHomeForNetwork();
  if (prefs.provider === 'radmin') { // o mesmo estado do rodapé da tela inicial (Radmin encontrada ou não)
    const ok = $('radminDot').classList.contains('ok');
    setNetSummary(ok, ok ? `${$('radminTitle').textContent} · ${$('radminDetail').textContent}. Os amigos entram pelo seu endereço.`
      : `${$('radminTitle').textContent}. Na rede local, os amigos entram pelo seu endereço do mesmo jeito.`);
  }
  refreshRazzeState();
}

// Uma carga por vez: quem pede durante uma carga espera ela e mais uma rodada (o login pode ter mudado no meio)
let razzeStateRun = null, razzeStateAgain = false;
function refreshRazzeState() {
  if (razzeStateRun) { razzeStateAgain = true; return razzeStateRun; }
  razzeStateRun = (async () => {
    do { razzeStateAgain = false; await loadRazzeState(); } while (razzeStateAgain);
  })().finally(() => { razzeStateRun = null; });
  return razzeStateRun;
}

async function loadRazzeState() {
  const state = await window.api.razzeState();
  if (!$('razzeApiUrl').value) $('razzeApiUrl').value = state.baseUrl; // o servidor padrão, se ninguém trocou
  const account = (on) => {
    $('razzeAuth').hidden = on;
    $('razzeAccount').hidden = !on;
    $('razzeStepNetworks').hidden = !on;
    $('razzeStepFriends').hidden = !on;
    $('friendsSignedOut').hidden = on;
    if (!on) { setFriendsData({}); dmStop(); }
  };
  account(state.authenticated);
  $('profileAccountHint').textContent = state.configured ? 'Entre na sua conta para gerenciar redes e amigos.' : 'Para entrar, escolha Razze (WireGuard) em "Como os PCs se conectam", logo abaixo, e salve o endereço do servidor.';
  $('friendsHint').textContent = state.configured ? 'Entre na sua conta Razze para ver quem está online, adicionar amigos e convidar para a sua sala.' : 'Os amigos usam uma conta Razze: configure o servidor e entre na conta na aba Rede.';
  $('razzeLogin').disabled = $('razzeRegister').disabled = !state.configured;
  if (!state.configured) {
    setStepDone('razzeStepServerNum', false, 1);
    if (selectedNetworkProvider() === 'razze') setNetSummary(false, 'Razze: falta o endereço do servidor (passo 1).');
    return;
  }
  try {
    await window.api.razzeHealth();
    setStepDone('razzeStepServerNum', true, 1);
    if (!state.authenticated) { if (selectedNetworkProvider() === 'razze') setNetSummary(false, 'Razze: servidor ok. Entre ou crie sua conta logo abaixo.'); return; }
    const { user } = await window.api.razzeMe();
    razzeUser = user;
    if (user?.id) void dmStart(user.id); // mensagens diretas desta conta (renderer/mensagens.js)
    $('razzeAccountName').textContent = user?.displayName || user?.email || 'Conta Razze';
    $('razzeAccountEmail').textContent = user?.displayName ? user.email || '' : '';
    $('razzeAccountAvatar').textContent = ((user?.displayName || user?.email || '?').trim()[0] || '?').toUpperCase();
    await refreshRazzeLists();
  } catch (error) {
    setStepDone('razzeStepServerNum', false, 1);
    if (selectedNetworkProvider() === 'razze') setNetSummary(false, 'Razze: ' + error.message);
    setRazzeStatus(error.message);
    const current = await window.api.razzeState().catch(() => ({ authenticated: false }));
    account(current.authenticated);
  }
}

// Linha do topo com a rede conectada (ou o que falta)
async function renderRazzeSummary(networks) {
  if (selectedNetworkProvider() !== 'razze') return;
  const active = networkPreferences().activeNetworkId;
  const net = networks.find((n) => n.id === active);
  const tunnel = net ? await window.api.razzeWireGuardStatus(net.id).catch(() => ({ connected: false })) : { connected: false };
  setStepDone('razzeStepNetworksNum', !!tunnel.connected, 2);
  if (net && tunnel.connected) setNetSummary(true, `Razze: conectado na rede ${net.name}${tunnel.overlayIp ? ' · ' + tunnel.overlayIp : ''}.`);
  else setNetSummary(false, networks.length ? 'Razze: conecte uma das suas redes (passo 2).' : 'Razze: crie uma rede ou entre com um convite (passo 2).');
}

async function refreshRazzeLists() {
  const result = await window.api.razzeListNetworks();
  const networks = result.networks || [];
  rememberConnectionMapNetworks(networks);
  $('razzeNetworks').replaceChildren(...networks.map((network) => razzeNetworkCard(network)));
  $('razzeNetworksEmpty').hidden = networks.length > 0;
  void renderRazzeSummary(networks);
  const friends = await window.api.razzeFriends();
  const requests = await window.api.razzeFriendRequests();
  setFriendsData({ friends: friends.friends || [], incoming: requests.incoming || [], outgoing: requests.outgoing || [] });
}

// Cartão de uma rede: nome e se está conectada; um botão principal (Conectar ou Atualizar participantes),
// Desconectar só quando conectada; o resto (convite, membros, editar, excluir, sair) atrás de "Gerenciar"
function razzeNetworkCard(network) {
  const card = document.createElement('article');
  card.className = 'razze-network';
  const btn = (text, cls = 'btn small') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; return b; };
  const status = (text) => { setRazzeStatus(text); };

  const head = document.createElement('div');
  head.className = 'razze-network-head';
  const titles = document.createElement('div');
  titles.className = 'razze-network-titles';
  const title = document.createElement('strong');
  title.textContent = network.name;
  const subtitle = document.createElement('span');
  subtitle.className = 'hint';
  subtitle.textContent = [network.description, VISIBILITY[network.visibility]].filter(Boolean).join(' · ') || 'Rede Razze';
  const online = document.createElement('span');
  online.className = 'hint'; online.dataset.networkPresence = network.id;
  online.textContent = network.onlineCount === null ? 'Entre na rede para ver a presença.' : (network.onlineCount || 0) + ' online · ' + (network.roomCount || 0) + ' salas abertas';
  titles.append(title, subtitle, online);
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
    if (current.connected && !(await appConfirm('Atualizar a lista de participantes agora? Se o Windows não deixar atualizar com o túnel ligado, ele reinicia por alguns segundos.', { title: 'Atualizar participantes', ok: 'Atualizar' }))) return;
    connect.disabled = true;
    status(current.connected ? 'Atualizando os participantes e reiniciando o túnel…' : 'Negociando o endereço e ligando o túnel WireGuard…');
    try {
      const result = await window.api.razzeWireGuardConnect(network.id, network.name);
      saveNetworkPreferences({ activeNetworkId: network.id });
      rememberConnectionMapNetworks([network]);
      renderSessoes();
      showTunnel(true, result.overlayIp);
      status('VPN conectada em ' + result.overlayIp + (result.publicIp ? ' · endpoint público ' + result.publicIp : '') + '.');
      setNetSummary(true, `Razze: conectado na rede ${network.name} · ${result.overlayIp}.`);
      setStepDone('razzeStepNetworksNum', true, 2);
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
      setNetSummary(false, 'Razze: conecte uma das suas redes (passo 2).');
      setStepDone('razzeStepNetworksNum', false, 2);
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
        // O link fica à vista no cartão, com Copiar (se a cópia automática falhar, dá para selecionar e copiar)
        const field = document.createElement('input');
        field.className = 'razze-invite-link mono';
        field.readOnly = true;
        field.value = link;
        field.onfocus = () => field.select();
        const copy = btn('Copiar', 'btn small primary');
        copy.onclick = async () => {
          try { await copiar(link); copy.textContent = 'Copiado'; setTimeout(() => { copy.textContent = 'Copiar'; }, 1500); }
          catch { field.focus(); status('Selecione o link e use Ctrl+C.'); }
        };
        const row = document.createElement('div');
        row.className = 'razze-row razze-invite';
        row.append(field, copy);
        card.querySelector('.razze-invite')?.remove();
        card.append(row);
        try { await copiar(link); status('Convite criado e copiado. Mande o link para quem vai entrar: vale por 7 dias e até 10 entradas.'); }
        catch { status('Convite criado. Copie o link abaixo e mande para quem vai entrar: vale por 7 dias e até 10 entradas.'); }
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
          label.textContent = member.displayName + ' · ' + member.email + (member.id === network.ownerId ? ' · dono' : '') + (member.online ? ' · Online' : ' · Offline');
          row.append(label);
          if (member.id !== network.ownerId) {
            const remove = btn('Remover', 'btn small danger');
            remove.onclick = async () => {
              if (!(await appConfirm('Tirar ' + member.displayName + ' da rede ' + network.name + '?', { title: 'Remover da rede', ok: 'Remover', danger: true }))) return;
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
      if (!(await appConfirm('Excluir a rede ' + network.name + '? Todo mundo sai dela.', { title: 'Excluir rede', ok: 'Excluir', danger: true }))) return;
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
      if (!(await appConfirm('Sair da rede ' + network.name + '? Para voltar, você vai precisar de um convite novo.', { title: 'Sair da rede', ok: 'Sair', danger: true }))) return;
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

function receiveRazzePresence(value) {
  razzeLive = value || { friends: [], networks: [], rooms: [], error: '' };
  updateFriendsPresence(razzeLive);
  const networks = new Map((razzeLive.networks || []).map(n => [n.id, n]));
  document.querySelectorAll('[data-network-presence]').forEach(node => {
    const network = networks.get(node.dataset.networkPresence);
    node.textContent = razzeLive.error ? 'Presença indisponível' : !network || network.onlineCount === null ? 'Entre na rede para ver a presença.' : network.onlineCount + ' online · ' + network.roomCount + ' salas abertas';
  });
  sessoes.razze = razzeLive.rooms || [];
  receberSalasAmigos(razzeLive.internetRooms);
  renderSessoes();
  if (razzeLive.authenticated === false && selectedNetworkProvider() === 'razze') {
    razzeUser = null;
    setRazzeStatus(razzeLive.error || 'Entre novamente na sua conta.');
    void refreshRazzeState();
  }
}

function setupConnectivitySettings() {
  window.api.onRazzePresence(receiveRazzePresence);
  window.api.razzePresence().then(receiveRazzePresence).catch(() => {});
  $('friendsOpenProfile').onclick = openRazzeLogin;
  document.querySelectorAll('input[name="networkProvider"]').forEach((r) => {
    r.onchange = () => {
      saveNetworkPreferences({ provider: r.value });
      renderConnectivitySettings();
      renderRadmin();
      setSessionWatch(sessionWatchWanted());
    };
  });
  $('internetSaveServer').onclick = async () => {
    const url = normalizeInternetUrl($('internetUrl').value);
    if (!url) { $('internetStatus').textContent = 'Endereço inválido. Exemplo: ws://203.0.113.10:8765'; return; }
    $('internetSaveServer').disabled = true;
    $('internetStatus').textContent = 'Testando…';
    try {
      const info = await testInternetServer(url);
      saveNetworkPreferences({ internetUrl: url });
      renderConnectivitySettings();
      $('internetStatus').textContent = info.turn
        ? 'Servidor ok, com TURN: funciona até para quem está atrás de CGNAT.'
        : 'Servidor ok, mas sem TURN: quem estiver atrás de CGNAT pode não conseguir ver a tela.';
    } catch (error) {
      $('internetStatus').textContent = error.message;
    } finally { $('internetSaveServer').disabled = false; }
  };
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
      setRazzeStatus('Servidor acessível.');
      await refreshRazzeState();
    } catch (error) { setRazzeStatus('Servidor inválido: ' + error.message); setStepDone('razzeStepServerNum', false, 1); }
  };
  $('razzeLogin').onclick = async () => {
    $('razzeLogin').disabled = true;
    try {
      const result = await window.api.razzeLogin($('razzeEmail').value.trim(), $('razzePassword').value);
      razzeUser = result.user;
      $('razzePassword').value = '';
      setRazzeStatus('Você entrou na sua conta.');
      await refreshRazzeState();
    } catch (error) { setRazzeStatus('Não foi possível entrar: ' + error.message); }
    finally { $('razzeLogin').disabled = false; }
  };
  $('razzeRegister').onclick = async () => {
    $('razzeRegister').disabled = true;
    try {
      const result = await window.api.razzeRegister($('razzeEmail').value.trim(), $('razzePassword').value, $('razzeDisplayName').value.trim());
      $('razzePassword').value = '';
      setRazzeStatus(result.status === 'pending_approval' ? 'Cadastro enviado. Aguarde a aprovação do administrador do servidor e depois entre.' : 'Conta criada. Agora é só entrar.');
      setRazzeAuthTab(false);
    } catch (error) { setRazzeStatus('Não foi possível criar a conta: ' + error.message); }
    finally { $('razzeRegister').disabled = false; }
  };
  $('razzeLogout').onclick = async () => {
    const disconnected = await window.api.razzeWireGuardDisconnectAll();
    if (!disconnected.ok) {
      setRazzeStatus('Desconecte todas as redes antes de sair da conta: ' + disconnected.errors.join('; '));
      return;
    }
    saveNetworkPreferences({ activeNetworkId: '' });
    await window.api.razzeLogout();
    razzeUser = null;
    setRazzeStatus('Você saiu da conta.');
    renderConnectivitySettings();
  };
  $('razzeCreateNetwork').onclick = async () => {
    const name = $('razzeNetworkName').value.trim();
    if (!name) { $('razzeNetworkName').focus(); return; }
    try {
      await window.api.razzeCreateNetwork({ name, visibility: 'private' });
      $('razzeNetworkName').value = '';
      setRazzeStatus(`Rede ${name} criada. Clique em Conectar e mande um convite para os amigos (em Gerenciar).`);
      await refreshRazzeLists();
    } catch (error) { setRazzeStatus('Não foi possível criar a rede: ' + error.message); }
  };
  $('razzeJoinInvite').onclick = async () => {
    try {
      const token = inviteTokenFromValue($('razzeInviteToken').value);
      if (!token) throw new Error('Cole um link telap2p://invite/… ou o código do convite.');
      await window.api.razzeAcceptInvite(token);
      $('razzeInviteToken').value = '';
      await refreshRazzeLists();
      setRazzeStatus('Você entrou na rede.');
    } catch (error) { setRazzeStatus('Convite inválido: ' + error.message); }
  };
  const addFriendByNickname = async (nickname) => {
    if (!nickname.trim()) { $('razzeFriendNickname').focus(); return; }
    try {
      const result = await window.api.razzeRequestFriend(nickname.trim());
      setFriendsAddOpen(false);
      $('razzeFriendsStatus').textContent = result.status === 'accepted' ? `Agora você e ${nickname.trim()} são amigos.` : `Pedido enviado para ${nickname.trim()}.`;
      await refreshRazzeLists();
    } catch (error) {
      // O Electron põe "Error invoking remote method '…': Error:" na frente da mensagem do serviço
      showFriendsAddError('Não foi possível adicionar: ' + String(error.message).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ''));
      $('razzeFriendNickname').focus();
    }
  };
  $('razzeAddFriend').onclick = () => addFriendByNickname($('razzeFriendNickname').value);
  // Enter nos campos de uma linha faz o mesmo que o botão ao lado
  for (const [input, button] of [['internetUrl', 'internetSaveServer'], ['razzeApiUrl', 'razzeSaveServer'], ['razzeNetworkName', 'razzeCreateNetwork'], ['razzeInviteToken', 'razzeJoinInvite'], ['razzeFriendNickname', 'razzeAddFriend']]) {
    $(input).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $(button).click(); } });
  }
  document.addEventListener('contextmenu', async (event) => {
    const profile = event.target.closest('[data-person]');
    const id = profile?.dataset.person;
    if (!id || id === state.myId || !state.members.has(id)) return;
    event.preventDefault();
    if ($('friendsDialog').hidden) openFriendsDialog();
    await addFriendByNickname(nameOf(id));
  });
  $('razzePassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ($('razzeLogin').hidden ? $('razzeRegister') : $('razzeLogin')).click(); } });
  const acceptInviteLink = async (token) => {
    $('razzeInviteToken').value = token;
    saveNetworkPreferences({ provider: 'razze' });
    if ($('networkDialog').hidden) openNetworkDialog();
    const state = await window.api.razzeState();
    if (!state.authenticated) {
      setRazzeStatus('Entre na sua conta Razze para aceitar o convite que chegou pelo link.');
      return;
    }
    try {
      await window.api.razzeAcceptInvite(token);
      $('razzeInviteToken').value = '';
      await refreshRazzeLists();
      setRazzeStatus('Convite aceito. Você entrou na rede.');
    } catch (error) { setRazzeStatus('Não foi possível aceitar o convite: ' + error.message); }
  };
  window.api.onRazzeInvite((token) => { void acceptInviteLink(token); });
  // Abriu o app com o túnel da rede ligado: volta a buscar quem entrou na rede (sem clicar em Atualizar)
  const prefs = networkPreferences();
  if (prefs.provider === 'razze' && prefs.activeNetworkId) window.api.razzeWireGuardResume(prefs.activeNetworkId).catch(() => {});
  // Abriu o app já com conta: carrega amigos, mensagens diretas e redes sem esperar a aba Rede ou Amigos
  window.api.razzeState().then((s) => { if (s.configured && s.authenticated) return refreshRazzeState(); }).catch(() => {});
  window.api.razzePendingInvite().then((token) => { if (token) void acceptInviteLink(token); }).catch(() => {});
}
