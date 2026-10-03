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

test('sala do modo Internet vai na batida e as salas dos amigos voltam na presença', async () => {
  const { cleanInternetRoom } = require('../main/razze-presence');
  const passe = 'A'.repeat(43);
  assert.deepEqual(cleanInternetRoom({ servidor: 'ws://1.2.3.4:8765', codigo: 'ABC234', pessoas: 2, passe }), { servidor: 'ws://1.2.3.4:8765', codigo: 'ABC234', pessoas: 2, passe });
  assert.equal(cleanInternetRoom({ servidor: 'https://x.com', codigo: 'ABC234' }), null);
  assert.equal(cleanInternetRoom({ servidor: 'wss://x.com/?a=1', codigo: 'ABC234' }), null);
  assert.equal(cleanInternetRoom({ servidor: 'wss://x.com', codigo: 'ABC10O' }), null);
  assert.equal(cleanInternetRoom({ servidor: 'wss://x.com', codigo: 'ABC234', passe: 'curto' }).passe, null);
  const sent = [];
  const api = {
    heartbeat: async body => { sent.push(body); },
    listFriends: async () => ({ friends: [] }), listNetworks: async () => ({ networks: [] }),
    listRooms: async () => ({ rooms: [], internet: [{ servidor: 'wss://x.com', codigo: 'XYZ789', pessoas: 3, passe, host: 'Bia' }] }),
    offline: async () => {},
  };
  const service = { state: () => ({ authenticated: true }), api: () => api, wireguard: { identity: () => ({ deviceId: 'd' }) } };
  let internetRoom = { servidor: 'wss://x.com', codigo: 'ABC234', pessoas: 1, passe };
  const presence = createPresence({ service, getInternetRoom: () => internetRoom, setInterval: () => ({ unref() {} }), clearInterval: () => {} });
  presence.start(); await presence.tick();
  assert.equal(sent.at(-1).internetRoom.codigo, 'ABC234');
  assert.equal(presence.snapshot().internetRooms[0].host, 'Bia');
  internetRoom = null; await presence.tick();
  assert.equal('internetRoom' in sent.at(-1), false);
  await presence.stop();
});
