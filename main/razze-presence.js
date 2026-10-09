'use strict';

// Sala do modo Internet que o app anuncia aos amigos: confere o que vem da janela antes de mandar à RazzeAPI
function cleanInternetRoom(v) {
  if (!v || typeof v !== 'object') return null;
  let url = null;
  try { url = new URL(String(v.servidor)); } catch { return null; }
  if (String(v.servidor).length > 200 || !['ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) return null;
  if (typeof v.codigo !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(v.codigo)) return null;
  const pessoas = Number.isInteger(v.pessoas) ? Math.min(1000, Math.max(1, v.pessoas)) : 1;
  const passe = typeof v.passe === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v.passe) ? v.passe : null;
  // host: o nome do host da sala, quando quem anuncia é um convidado (docs/spec/entrar-pelos-amigos.md)
  const host = typeof v.host === 'string' ? v.host.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) : '';
  return { servidor: String(v.servidor), codigo: v.codigo, pessoas, passe, ...(host ? { host } : {}) };
}

// Em que sala estou, para os amigos (docs/spec/sala-do-amigo.md): o modo, o nome do host, quantas pessoas e se estou na
// voz. Nada de endereço, código ou senha: confere o que vem da janela e corta o resto
function cleanSalaAtual(v) {
  if (!v || typeof v !== 'object' || !['radmin', 'razze', 'internet'].includes(v.modo)) return null;
  const host = String(v.host ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  if (!host) return null;
  const pessoas = Number.isInteger(v.pessoas) ? Math.min(1000, Math.max(1, v.pessoas)) : 1;
  return { modo: v.modo, host, pessoas, voz: v.voz === true };
}

// Heartbeat no processo principal: continua com a janela minimizada/oculta.
function createPresence({ service, clientName = 'Tela P2P', getAppVersion = () => '', getRoom = () => null, getInternetRoom = () => null, getSalaAtual = () => null, publish = () => {}, setInterval: schedule = setInterval, clearInterval: cancel = clearInterval }) {
  const networks = new Set();
  let timer = null, running = null, queued = false, stopped = true;
  let snapshot = { friends: [], networks: [], rooms: [], internetRooms: [], updatedAt: null, error: '' };
  const emit = value => { snapshot = value; publish(value); };
  async function tick() {
    if (stopped) return;
    if (running) { queued = true; return running; }
    running = (async () => {
      if (!service.state().authenticated) { emit({ friends: [], networks: [], rooms: [], internetRooms: [], updatedAt: null, error: snapshot.error, authenticated: false }); return; }
      try {
        const api = service.api();
        const connections = [];
        for (const networkId of [...networks]) {
          const state = await service.wireguard.status(networkId);
          if (!state.connected) { networks.delete(networkId); continue; }
          const deviceId = service.wireguard.identity().deviceId;
          let devices;
          try { devices = await api.listDevices(networkId); }
          catch (e) { if (e.status !== 404) throw e; devices = { peers: [] }; }
          if (!devices.peers.some(p => p.deviceId === deviceId)) {
            networks.delete(networkId);
            await service.wireguard.disconnect(networkId);
            continue;
          }
          connections.push({ networkId, deviceId });
        }
        const advertised = getRoom();
        const room = advertised && connections.some(c => c.networkId === advertised.networkId) ? advertised : null;
        // Sala do modo Internet: vai para os amigos, sem precisar de rede Razze nem de VPN
        const internetRoom = getInternetRoom() || undefined;
        // Em que sala estou (qualquer modo): só os amigos veem; servidor antigo ignora o campo
        const appVersion = String(getAppVersion() || '');
        const salaAtual = getSalaAtual() || undefined;
        await api.heartbeat({ clientName, connections, room, ...(internetRoom ? { internetRoom } : {}), ...(salaAtual ? { salaAtual } : {}), ...(appVersion ? { appVersion } : {}) });
        const [friends, listed, rooms] = await Promise.all([api.listFriends(), api.listNetworks(), api.listRooms()]);
        if (!stopped) emit({ friends: friends.friends, networks: listed.networks, rooms: rooms.rooms, internetRooms: Array.isArray(rooms.internet) ? rooms.internet : [], updatedAt: Date.now(), error: '' });
      } catch (e) {
        if (e.status === 401 || ['account_disabled', 'account_pending'].includes(e.code)) {
          networks.clear();
          await service.wireguard.disconnectAll().catch(() => {});
          await service.logout().catch(() => {});
        }
        if (!stopped) emit({ friends: [], networks: [], rooms: [], internetRooms: [], updatedAt: null, error: e.message, authenticated: service.state().authenticated });
      }
    })();
    try { await running; }
    finally { running = null; if (queued && !stopped) { queued = false; void tick(); } }
  }
  async function reset() {
    const wasStopped = stopped;
    stopped = true; queued = false;
    if (running) await running;
    if (service.state().authenticated) await service.api().offline().catch(() => {});
    networks.clear();
    emit({ friends: [], networks: [], rooms: [], internetRooms: [], updatedAt: null, error: '' });
    stopped = wasStopped;
  }
  return {
    snapshot: () => snapshot,
    track: id => { networks.add(id); void tick(); },
    untrack: id => { networks.delete(id); void tick(); },
    tick, reset,
    start() { if (timer) return; stopped = false; timer = schedule(() => { void tick(); }, 20_000); timer?.unref?.(); void tick(); },
    async stop() { stopped = true; queued = false; if (timer) cancel(timer); timer = null; await reset(); },
  };
}
module.exports = { createPresence, cleanInternetRoom, cleanSalaAtual };
