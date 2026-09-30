'use strict';
let connectionMapTimer = null;
let connectionMapBusy = false;
let connectionMapFocus = null;
let connectionMapNames = new Map();
function rememberConnectionMapNetworks(networks, baseUrl = networkPreferences().apiUrl) {
  let saved;
  try { saved = JSON.parse(load('connectionMapNetworks.v1', '{}')); } catch { saved = {}; }
  if (!saved || saved.baseUrl !== baseUrl) saved = { baseUrl, names: {} };
  if (!saved.names || typeof saved.names !== 'object') saved.names = {};
  for (const network of networks || []) {
    if (/^[a-f0-9]{32}$/.test(network.id) && typeof network.name === 'string') saved.names[network.id.slice(0, 12)] = network.name;
  }
  save('connectionMapNetworks.v1', JSON.stringify(saved));
  connectionMapNames = new Map(Object.entries(saved.names));
}
function connectionMapLocalNodes(tunnels, interfaces, selectedStatus) {
  const nodes = new Map();
  for (const tunnel of [...tunnels, ...(selectedStatus ? [selectedStatus] : [])]) {
    nodes.set(tunnel.networkPrefix, {
      name: tunnel.networkName || nodes.get(tunnel.networkPrefix)?.name || connectionMapNames.get(tunnel.networkPrefix) || 'Rede ' + tunnel.networkPrefix,
      status: tunnel.error ? 'unknown' : tunnel.connected ? 'online' : 'offline',
      detail: tunnel.error ? 'Verificação indisponível' : tunnel.connected ? 'Túnel conectado' : 'Túnel desconectado',
    });
  }
  for (const item of interfaces) {
    const prefix = /^(?:Razze|rz)([a-f0-9]{12})$/i.exec(item.name)?.[1];
    if (prefix && nodes.has(prefix)) continue;
    const key = prefix || item.name;
    if (!nodes.has(key)) nodes.set(key, {
      name: prefix ? connectionMapNames.get(prefix) || 'Rede ' + prefix : item.radmin ? 'Radmin VPN' : item.name,
      status: 'online', detail: 'Interface ativa · ' + item.address,
    });
  }
  if (state.myId && state.ws?.readyState === WebSocket.OPEN) nodes.set('room', {
    name: 'Sala atual', status: 'online', detail: state.isOwner ? 'Você está hospedando a sala' : 'Conectado · ' + state.host,
  });
  return [...nodes.values()];
}

function openConnectionMap() {
  for (const [id, close] of [['profilePane', closeProfilePopup], ['networkDialog', closeNetworkDialog], ['friendsDialog', closeFriendsDialog], ['generalSettingsDialog', closeGeneralSettings]]) {
    if (!$(id).hidden) close();
  }
  connectionMapFocus = document.activeElement;
  $('connectionMapDialog').hidden = false;
  syncWorkspace();
  setUtilityBackground(true);
  syncCaptureExclude(); // transmitindo: o mapa (endereços e redes) não vai para quem assiste
  $('closeConnectionMap').focus();
  void refreshConnectionMap();
  clearInterval(connectionMapTimer);
  connectionMapTimer = setInterval(refreshConnectionMap, 5000);
}
function closeConnectionMap() {
  clearInterval(connectionMapTimer);
  connectionMapTimer = null;
  $('connectionMapDialog').hidden = true;
  syncCaptureExclude();
  setUtilityBackground(false);
  syncWorkspace();
  (connectionMapFocus || $('navConnectionMap')).focus();
}
function graphElement(tag, attributes, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderConnectionGraph(server, networks) {
  const svg = $('connectionGraph');
  svg.replaceChildren();
  const height = Math.max(300, 100 + networks.length * 100);
  svg.setAttribute('viewBox', `0 0 760 ${height}`);
  svg.append(graphElement('title', {}, 'Conexões deste PC com o servidor Razze e os túneis de rede'));
  const center = height / 2;
  const link = (x, y, status) => svg.append(graphElement('path', {
    d: `M 176 ${center} C 290 ${center}, ${x - 140} ${y}, ${x} ${y}`,
    class: 'connection-edge ' + status,
  }));
  const node = (x, y, title, detail, status, width = 238) => {
    const group = graphElement('g', { class: 'connection-node ' + status });
    group.append(graphElement('title', {}, title + ': ' + detail));
    group.append(graphElement('rect', { x, y: y - 34, width, height: 68, rx: 14 }));
    group.append(graphElement('circle', { cx: x + 19, cy: y, r: 6 }));
    const label = graphElement('text', { x: x + 36, y: y - 5, class: 'connection-name' }, title.length > 24 ? title.slice(0, 23) + '…' : title);
    group.append(label, graphElement('text', { x: x + 36, y: y + 16, class: 'connection-detail' }, detail));
    svg.append(group);
  };
  link(350, 52, server.status);
  networks.forEach((network, i) => link(490, 150 + i * 100, network.status));
  node(16, center, 'Este PC', 'Suas conexões', 'local', 160);
  node(350, 52, 'Servidor Razze', server.detail, server.status);
  networks.forEach((network, i) => node(490, 150 + i * 100, network.name, network.detail, network.status));
  $('connectionMapEmpty').hidden = networks.length > 0;
  const list = $('connectionMapDetails');
  list.replaceChildren();
  for (const item of [{ name: 'Servidor Razze', ...server }, ...networks]) {
    const row = document.createElement('li');
    row.textContent = item.name + ' — ' + item.detail;
    list.append(row);
  }
}
async function refreshConnectionMap() {
  if (connectionMapBusy || $('connectionMapDialog').hidden) return;
  connectionMapBusy = true;
  $('refreshConnectionMap').disabled = true;
  $('connectionMapStatus').textContent = 'Verificando conexões…';
  try {
    const prefs = networkPreferences();
    rememberConnectionMapNetworks([]);
    const [stateResult, tunnelsResult, interfacesResult, selectedResult] = await Promise.allSettled([
      window.api.razzeState(), window.api.razzeWireGuardConnections(), window.api.getIps(),
      prefs.activeNetworkId ? window.api.razzeWireGuardStatus(prefs.activeNetworkId) : Promise.resolve(null),
    ]);
    const account = stateResult.status === 'fulfilled' ? stateResult.value : null;
    let server = { status: 'offline', detail: account?.configured ? 'Sem conexão' : account ? 'Servidor não configurado' : 'Não foi possível verificar' };
    if (account?.configured) {
      try { await window.api.razzeHealth(); server = { status: 'online', detail: 'Conectado' }; }
      catch { server = { status: 'offline', detail: 'Sem conexão' }; }
    }
    $('connectionMapServer').textContent = account?.baseUrl || 'Configure o servidor na área de Rede.';
    if (account?.authenticated && server.status === 'online') {
      try {
        const result = await window.api.razzeListNetworks();
        rememberConnectionMapNetworks(result.networks, account.baseUrl);
      } catch { /* Os túneis locais continuam visíveis se a sessão da API expirar. */ }
    }
    const selectedStatus = prefs.activeNetworkId ? {
      ...(selectedResult.status === 'fulfilled' && selectedResult.value ? selectedResult.value : { error: 'Verificação indisponível' }),
      networkPrefix: prefs.activeNetworkId.slice(0, 12),
    } : null;
    const networks = connectionMapLocalNodes(
      tunnelsResult.status === 'fulfilled' ? tunnelsResult.value : [],
      interfacesResult.status === 'fulfilled' ? interfacesResult.value : [], selectedStatus,
    );
    if (!$('connectionMapDialog').hidden) {
      renderConnectionGraph(server, networks);
      $('connectionMapStatus').textContent = tunnelsResult.status === 'rejected'
        ? 'Não foi possível verificar os túneis locais. Tente atualizar.'
        : 'Atualizado agora · atualização automática a cada 5 segundos.';
    }
  } catch (error) {
    $('connectionMapStatus').textContent = 'Não foi possível atualizar: ' + error.message;
  } finally {
    connectionMapBusy = false;
    $('refreshConnectionMap').disabled = false;
  }
}
function setupConnectionMap() {
  $('navConnectionMap').querySelector('.nav-icon').innerHTML = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><path d="m8 11 8-5M8 13l8 5"/></svg>';
  $('navConnectionMap').onclick = openConnectionMap;
  $('closeConnectionMap').onclick = closeConnectionMap;
  $('refreshConnectionMap').onclick = refreshConnectionMap;
  setIcon($('closeConnectionMap'), 'close', 'Fechar');
  setupUtilityPopup('connectionMapDialog', closeConnectionMap);
}
