'use strict';

// Heartbeat no processo principal: continua com a janela minimizada/oculta.
function createPresence({ service, clientName = 'Tela P2P', getRoom = () => null, publish = () => {}, setInterval: schedule = setInterval, clearInterval: cancel = clearInterval }) {
  const networks = new Set();
  let timer = null, running = null, queued = false, stopped = true;
  let snapshot = { friends: [], networks: [], rooms: [], updatedAt: null, error: '' };
  const emit = value => { snapshot = value; publish(value); };
  async function tick() {
    if (stopped) return;
    if (running) { queued = true; return running; }
    running = (async () => {
      if (!service.state().authenticated) { emit({ friends: [], networks: [], rooms: [], updatedAt: null, error: snapshot.error, authenticated: false }); return; }
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
        await api.heartbeat({ clientName, connections, room });
        const [friends, listed, rooms] = await Promise.all([api.listFriends(), api.listNetworks(), api.listRooms()]);
        if (!stopped) emit({ friends: friends.friends, networks: listed.networks, rooms: rooms.rooms, updatedAt: Date.now(), error: '' });
      } catch (e) {
        if (e.status === 401 || ['account_disabled', 'account_pending'].includes(e.code)) {
          networks.clear();
          await service.wireguard.disconnectAll().catch(() => {});
          await service.logout().catch(() => {});
        }
        if (!stopped) emit({ friends: [], networks: [], rooms: [], updatedAt: null, error: e.message, authenticated: service.state().authenticated });
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
    emit({ friends: [], networks: [], rooms: [], updatedAt: null, error: '' });
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
module.exports = { createPresence };
