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

// O mapa mora na aba Rede do HUB: enquanto ela está à vista, atualiza a cada 5 segundos
function connectionMapVisible() { return !$('networkDialog').hidden; }
function syncConnectionMap() {
  const on = connectionMapVisible();
  if (on === !!connectionMapTimer) return;
  clearInterval(connectionMapTimer);
  connectionMapTimer = on ? setInterval(refreshConnectionMap, 5000) : null;
  syncCaptureExclude(); // transmitindo: o mapa (endereços e redes) não vai para quem assiste
  if (on) void refreshConnectionMap();
}
function graphElement(tag, attributes, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
// Em pé, na largura do HUB: este PC em cima e, embaixo, o servidor e cada rede, presos a um tronco à esquerda
function renderConnectionGraph(server, networks) {
  const svg = $('connectionGraph');
  svg.replaceChildren();
  const items = [{ name: 'Servidor Razze', ...server }, ...networks];
  const top = 32, step = 64, first = 104;
  const height = first + (items.length - 1) * step + 34;
  svg.setAttribute('viewBox', `0 0 280 ${height}`);
  svg.append(graphElement('title', {}, 'Conexões deste PC com o servidor Razze e os túneis de rede'));
  const cut = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
  const node = (x, y, title, detail, status, width) => {
    const group = graphElement('g', { class: 'connection-node ' + status });
    group.append(graphElement('title', {}, title + ': ' + detail));
    group.append(graphElement('rect', { x, y: y - 26, width, height: 52, rx: 12 }));
    group.append(graphElement('circle', { cx: x + 16, cy: y, r: 5 }));
    group.append(graphElement('text', { x: x + 30, y: y - 4, class: 'connection-name' }, cut(title, 24)));
    group.append(graphElement('text', { x: x + 30, y: y + 14, class: 'connection-detail' }, cut(detail, 30)));
    svg.append(group);
  };
  // Do último para o primeiro: cada trecho do tronco fica com a cor do nó logo abaixo dele
  [...items.keys()].reverse().forEach((i) => {
    const y = first + i * step, item = items[i];
    svg.append(graphElement('path', { d: `M 18 ${top + 26} V ${y - 12} Q 18 ${y} 30 ${y} H 40`, class: 'connection-edge ' + item.status }));
  });
  node(2, top, 'Este PC', 'Suas conexões', 'local', 276);
  items.forEach((item, i) => node(40, first + i * step, item.name, item.detail, item.status, 238));
  $('connectionMapEmpty').hidden = networks.length > 0;
  const list = $('connectionMapDetails');
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('li');
    row.textContent = item.name + ' — ' + item.detail;
    list.append(row);
  }
}
async function refreshConnectionMap() {
  if (connectionMapBusy || !connectionMapVisible()) return;
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
    $('connectionMapServer').textContent = account?.baseUrl || 'Servidor Razze ainda não configurado.';
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
    if (connectionMapVisible()) {
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
  $('refreshConnectionMap').onclick = refreshConnectionMap;
}
