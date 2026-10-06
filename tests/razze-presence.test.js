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

test('sala do modo Internet e em que sala estou vão na batida; as salas dos amigos voltam na presença', async () => {
  const { cleanInternetRoom } = require('../main/razze-presence');
  const passe = 'A'.repeat(43);
  assert.deepEqual(cleanInternetRoom({ servidor: 'ws://1.2.3.4:8765', codigo: 'ABC234', pessoas: 2, passe }), { servidor: 'ws://1.2.3.4:8765', codigo: 'ABC234', pessoas: 2, passe });
  assert.equal(cleanInternetRoom({ servidor: 'https://x.com', codigo: 'ABC234' }), null);
  // Em que sala estou: só modo, host, pessoas e voz; o resto (endereço, senha) fica de fora
  const { cleanSalaAtual } = require('../main/razze-presence');
  assert.deepEqual(cleanSalaAtual({ modo: 'radmin', host: '  Caio\n ', pessoas: 4, voz: true, endereco: '26.1.2.3', senha: 'x' }), { modo: 'radmin', host: 'Caio', pessoas: 4, voz: true });
  assert.deepEqual(cleanSalaAtual({ modo: 'internet', host: 'x'.repeat(40), pessoas: 5000 }), { modo: 'internet', host: 'x'.repeat(32), pessoas: 1000, voz: false });
  assert.equal(cleanSalaAtual({ modo: 'lan', host: 'Caio', pessoas: 1 }), null);
  assert.equal(cleanSalaAtual({ modo: 'radmin', host: '   ', pessoas: 1 }), null);
  assert.equal(cleanSalaAtual(null), null);
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
  let salaAtual = { modo: 'radmin', host: 'Caio', pessoas: 3, voz: false };
  const presence = createPresence({ service, getInternetRoom: () => internetRoom, getSalaAtual: () => salaAtual, setInterval: () => ({ unref() {} }), clearInterval: () => {} });
  presence.start(); await presence.tick();
  assert.equal(sent.at(-1).internetRoom.codigo, 'ABC234');
  assert.deepEqual(sent.at(-1).salaAtual, salaAtual);
  assert.equal(presence.snapshot().internetRooms[0].host, 'Bia');
  internetRoom = null; salaAtual = null; await presence.tick();
  assert.equal('internetRoom' in sent.at(-1), false);
  assert.equal('salaAtual' in sent.at(-1), false);
  await presence.stop();
});
