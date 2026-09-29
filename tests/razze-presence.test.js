'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPresence } = require('../main/razze-presence');

test('presença publica salas e amigos, limpa anúncios e reage à revogação sem parar nas falhas temporárias', async () => {
  let authenticated = true, room = { id: 'a'.repeat(16), networkId: 'net', host: 'Ana', porta: 8765, pessoas: 1 }, failure = null;
  const sent = [], published = [];
  let disconnected = 0, offline = 0, callback;
  const api = {
    listDevices: async () => ({ peers: [{ deviceId: 'device' }] }),
    heartbeat: async body => { if (failure) throw failure; sent.push(body); },
    listFriends: async () => ({ friends: [{ id: 'friend', online: true }] }),
    listNetworks: async () => ({ networks: [{ id: 'net', onlineCount: 1 }] }),
    listRooms: async () => ({ rooms: room ? [room] : [] }),
    offline: async () => { offline++; },
  };
  const service = { state: () => ({ authenticated }), api: () => api, logout: async () => { authenticated = false; },
    wireguard: { identity: () => ({ deviceId: 'device' }), status: async () => ({ connected: true }), disconnectAll: async () => { disconnected++; } } };
  const presence = createPresence({ service, getRoom: () => room, publish: value => published.push(value), setInterval: fn => { callback = fn; return { unref() {} }; }, clearInterval: () => {} });
  presence.track('net'); presence.start(); await presence.tick();
  assert.equal(presence.snapshot().friends[0].online, true);
  assert.deepEqual(sent.at(-1).connections, [{ networkId: 'net', deviceId: 'device' }]);
  assert.equal(sent.at(-1).room.host, 'Ana');
  room = null; await presence.tick();
  assert.equal(sent.at(-1).room, null);
  failure = new Error('Servidor indisponível'); await presence.tick();
  assert.match(presence.snapshot().error, /indisponível/); assert.equal(authenticated, true);
  failure = null; callback(); await presence.tick(); assert.equal(presence.snapshot().error, '');
  failure = Object.assign(new Error('Sessão revogada'), { status: 401 }); await presence.tick();
  assert.equal(authenticated, false); assert.ok(disconnected > 0);
  assert.equal(presence.snapshot().authenticated, false);
  await presence.stop();
  assert.ok(published.length > 3);
});

test('remover dispositivo/rede encerra túnel e retira anúncio antes da próxima batida', async () => {
  let disconnected = false, received;
  const service = { state: () => ({ authenticated: true }), wireguard: {
    status: async () => ({ connected: true }), identity: () => ({ deviceId: 'old' }), disconnect: async () => { disconnected = true; return { ok: true }; },
  }, api: () => ({ listDevices: async () => ({ peers: [] }), heartbeat: async body => { received = body; },
    listFriends: async () => ({ friends: [] }), listNetworks: async () => ({ networks: [] }), listRooms: async () => ({ rooms: [] }), offline: async () => {},
  }) };
  const presence = createPresence({ service, getRoom: () => ({ networkId: 'network' }), setInterval: () => ({ unref() {} }), clearInterval: () => {} });
  presence.track('network'); presence.start(); await presence.tick();
  assert.equal(disconnected, true); assert.deepEqual(received, { clientName: 'Tela P2P', connections: [], room: null });
  await presence.stop();
});
