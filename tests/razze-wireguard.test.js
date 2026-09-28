'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { generateWireGuardKeys, decodeStunResponse, discoverEndpoint, buildTunnelConfig, wgSyncConfig, createWireGuardManager, tunnelNameFor } = require('../main/razze-wireguard');

test('gera chaves WireGuard X25519 de 32 bytes em base64', () => {
  const keys = generateWireGuardKeys();
  assert.equal(Buffer.from(keys.privateKey, 'base64').length, 32);
  assert.equal(Buffer.from(keys.publicKey, 'base64').length, 32);
  const privateDer = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(keys.privateKey, 'base64')]);
  const publicDer = crypto.createPublicKey(crypto.createPrivateKey({ key: privateDer, format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' });
  assert.equal(publicDer.subarray(-32).toString('base64'), keys.publicKey);
});

test('converte resposta STUN XOR-MAPPED-ADDRESS', () => {
  const packet = Buffer.alloc(32);
  packet.writeUInt16BE(0x0101, 0);
  packet.writeUInt16BE(12, 2);
  packet.writeUInt32BE(0x2112a442, 4);
  packet.writeUInt16BE(0x0020, 20);
  packet.writeUInt16BE(8, 22);
  packet[25] = 1;
  packet.writeUInt16BE(50000 ^ 0x2112, 26);
  const ip = [203, 0, 113, 9];
  const cookie = [0x21, 0x12, 0xa4, 0x42];
  ip.forEach((octet, index) => { packet[28 + index] = octet ^ cookie[index]; });
  assert.deepEqual(decodeStunResponse(packet), { host: '203.0.113.9', port: 50000 });
});

test('descobre endpoint no STUN integrado ao servidor', async () => {
  const { createApiServer } = require('../razze-api/server');
  const api = createApiServer({ dbPath: ':memory:', stunPort: 0 });
  try {
    const address = await api.listen(0, '127.0.0.1');
    const endpoint = await discoverEndpoint('127.0.0.1', address.stun.port);
    assert.equal(net.isIP(endpoint.host), 4);
    assert.ok(endpoint.port > 0);
    assert.equal(endpoint.port, endpoint.localPort);
  } finally { await api.close(); }
});

test('gera configuração por peer, limitando AllowedIPs ao IP overlay', () => {
  const ownKey = Buffer.alloc(32, 3).toString('base64');
  const peerKey = Buffer.alloc(32, 4).toString('base64');
  const config = buildTunnelConfig({
    privateKey: ownKey, assignedIp: '10.64.2.3', listenPort: 51820,
    peers: [{ publicKey: peerKey, assignedIp: '10.64.2.4', endpointHost: '198.51.100.4', endpointPort: 41000 }],
  });
  assert.match(config, /PrivateKey = /);
  assert.match(config, /Address = 10\.64\.2\.3\/24/);
  assert.match(config, /AllowedIPs = 10\.64\.2\.4\/32/);
  assert.match(config, /PersistentKeepalive = 20/);
  assert.throws(() => buildTunnelConfig({ privateKey: ownKey, assignedIp: '10.64.2.3', listenPort: 51820, peers: [{ publicKey: 'invalid', assignedIp: '10.64.2.4' }] }), /Chave ou endereço/);
  assert.throws(() => buildTunnelConfig({ privateKey: ownKey, assignedIp: '10.64.256.3', listenPort: 51820, peers: [] }), /Endereço overlay inválido/);
  assert.equal(tunnelNameFor('a'.repeat(32), 'win32'), 'Razze' + 'a'.repeat(12));
  assert.throws(() => tunnelNameFor('../invalid'), /ID de rede inválido/);
});

test('orquestra registro de dispositivo, STUN e instalação do túnel', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-wg-'));
  let installed = false;
  const commands = [];
  let refreshCallback = null;
  let peers = [{ deviceId: 'd'.repeat(32), publicKey: Buffer.alloc(32, 4).toString('base64'), assignedIp: '10.64.3.3', endpointHost: '198.51.100.21', endpointPort: 41001 }];
  const probedPeers = [];
  let gate;
  let gateResolve;
  let startedResolve;
  const manager = createWireGuardManager({
    app: { isPackaged: false, getPath: () => profile, getAppPath: () => profile, getName: () => 'Tela P2P' },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
    binary: path.join(profile, 'wireguard.exe'), platform: 'win32',
    discoverEndpoint: async () => ({ host: '198.51.100.20', port: 41000, localPort: 41000 }),
    probePeer: async (_source, destination) => { probedPeers.push(destination); },
    setInterval: (callback) => { refreshCallback = callback; return { unref() {} }; },
    clearInterval: () => { refreshCallback = null; },
    exec: async (_file, args) => {
      commands.push(args);
      if (args[0] === 'query') {
        if (!installed) throw new Error('OpenService FAILED 1060');
        return 'STATE : 4 RUNNING';
      }
      if (args[0] === '/installtunnelservice') installed = true;
      if (args[0] === '/uninstalltunnelservice') installed = false;
      return '';
    },
  });
  const networkId = 'c'.repeat(32);
  const api = {
    baseUrl: 'https://api.example.test',
    health: async () => ({ stun: { port: 3478, protocol: 'udp' } }),
    registerDevice: async (_id, device) => ({ device: { ...device, assignedIp: '10.64.3.2' } }),
    updateDeviceEndpoint: async () => ({ ok: true }),
    listDevices: async () => {
      if (!gate) return { peers };
      startedResolve();
      return gate;
    },
  };
  try {
    const result = await manager.connect(api, networkId, 'Sala de teste');
    assert.equal(result.connected, true);
    assert.equal(result.overlayIp, '10.64.3.2');
    assert.ok(commands.some((args) => args[0] === '/installtunnelservice'));
    assert.equal(typeof refreshCallback, 'function');
    const confPath = path.join(profile, 'razze', 'tunnels', tunnelNameFor(networkId, 'win32') + '.conf');
    assert.match(fs.readFileSync(confPath, 'utf8'), /Endpoint = 198\.51\.100\.21:41001/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(probedPeers.includes('10.64.3.3'));
    peers = [...peers, { deviceId: 'e'.repeat(32), publicKey: Buffer.alloc(32, 5).toString('base64'), assignedIp: '10.64.3.4', endpointHost: '198.51.100.22', endpointPort: 41002 }];
    assert.equal(await manager.refreshPeers(networkId), true);
    assert.match(fs.readFileSync(confPath, 'utf8'), /Endpoint = 198\.51\.100\.22:41002/);
    assert.ok(probedPeers.includes('10.64.3.4'));
    // Peer novo: a lista muda com o túnel ligado (wg syncconf), sem reinstalar o serviço
    assert.equal(commands.filter((args) => args[0] === '/installtunnelservice').length, 1);
    assert.equal(commands.filter((args) => args[0] === 'syncconf').length, 1);
    assert.ok(!fs.existsSync(confPath.replace(/\.conf$/, '.wg.conf')), 'o arquivo do syncconf é apagado depois');
    assert.equal(await manager.refreshPeers(networkId), false);
    const started = new Promise((resolve) => { startedResolve = resolve; });
    gate = new Promise((resolve) => { gateResolve = resolve; });
    const pendingRefresh = manager.refreshPeers(networkId);
    await started;
    const pendingDisconnect = manager.disconnect(networkId);
    gateResolve({ peers: [...peers, { deviceId: 'f'.repeat(32), publicKey: Buffer.alloc(32, 6).toString('base64'), assignedIp: '10.64.3.5' }] });
    await Promise.all([pendingRefresh, pendingDisconnect]);
    assert.equal(commands.filter((args) => args[0] === '/installtunnelservice').length, 1, 'refresh iniciado antes do logout não reinstala o túnel');
    assert.equal(commands.filter((args) => args[0] === 'syncconf').length, 1, 'nem atualiza a lista');
    assert.equal((await manager.disconnect(networkId)).ok, true);
    assert.equal(refreshCallback, null);
    assert.equal(fs.existsSync(confPath), false);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('desconecta todos os serviços persistidos do perfil sem depender da rede selecionada', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-wg-all-'));
  const names = ['Razze' + 'a'.repeat(12), 'Razze' + 'b'.repeat(12)];
  const removed = [];
  const directory = path.join(profile, 'razze', 'tunnels');
  fs.mkdirSync(directory, { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(directory, name + '.conf'), '[Interface]\r\n');
  const manager = createWireGuardManager({
    app: { isPackaged: false, getPath: () => profile, getAppPath: () => profile, getName: () => 'Tela P2P' },
    safeStorage: { isEncryptionAvailable: () => true },
    binary: path.join(profile, 'wireguard.exe'), platform: 'win32',
    exec: async (_file, args) => {
      if (args[0] === 'query') return 'ESTADO             : 4  RUNNING'; // Windows em português
      if (args[0] === '/uninstalltunnelservice') removed.push(args[1]);
      return '';
    },
  });
  try {
    assert.deepEqual(await manager.disconnectAll(), { ok: true, disconnected: 2, errors: [] });
    assert.deepEqual(removed.sort(), names.sort());
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('dois clientes obtêm peers pela RazzeAPI e sincronizam a configuração WireGuard', async () => {
  const { createApiServer } = require('../razze-api/server');
  const { RazzeApiClient } = require('../main/razze-api-client');
  const apiServer = createApiServer({ dbPath: ':memory:', requireApproval: false, stunPort: 0 });
  const profiles = [fs.mkdtempSync(path.join(os.tmpdir(), 'razze-peer-a-')), fs.mkdtempSync(path.join(os.tmpdir(), 'razze-peer-b-'))];
  const managers = [];
  try {
    const address = await apiServer.listen(0, '127.0.0.1');
    const apiUrl = 'http://127.0.0.1:' + address.port;
    const aliceApi = new RazzeApiClient(apiUrl);
    const alice = await aliceApi.register('alice-integration@example.test', 'password-123', 'Alice');
    aliceApi.setAccessToken(alice.accessToken);
    const network = (await aliceApi.createNetwork({ name: 'Integração P2P' })).network;
    const invitation = await aliceApi.createInvite(network.id, { maxUses: 1, ttlHours: 1 });
    const bobApi = new RazzeApiClient(apiUrl);
    const bob = await bobApi.register('bob-integration@example.test', 'password-456', 'Bob');
    bobApi.setAccessToken(bob.accessToken);
    await bobApi.acceptInvite(invitation.token);

    const makeManager = (profile, host, localPort) => {
      let installed = false;
      const manager = createWireGuardManager({
        app: { isPackaged: false, getPath: () => profile, getAppPath: () => profile, getName: () => 'Tela P2P' },
        safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
        binary: path.join(profile, 'wireguard.exe'), platform: 'win32',
        discoverEndpoint: async () => ({ host, port: localPort, localPort }),
        probePeer: async () => {}, setInterval: () => ({ unref() {} }), clearInterval: () => {},
        exec: async (_file, args) => {
          if (args[0] === 'query') {
            if (!installed) throw new Error('OpenService FAILED 1060');
            return 'STATE : 4 RUNNING';
          }
          if (args[0] === '/installtunnelservice') installed = true;
          if (args[0] === '/uninstalltunnelservice') installed = false;
          return '';
        },
      });
      managers.push(manager);
      return manager;
    };
    const managerA = makeManager(profiles[0], '198.51.100.31', 41031);
    const managerB = makeManager(profiles[1], '198.51.100.32', 41032);
    await managerA.connect(aliceApi, network.id, 'Integração P2P');
    await new Promise((resolve) => setImmediate(resolve));
    await managerB.connect(bobApi, network.id, 'Integração P2P');
    const configA = path.join(profiles[0], 'razze', 'tunnels', tunnelNameFor(network.id, 'win32') + '.conf');
    const configB = path.join(profiles[1], 'razze', 'tunnels', tunnelNameFor(network.id, 'win32') + '.conf');
    const bobDevice = await aliceApi.listDevices(network.id);
    const bobPeer = bobDevice.peers.find((peer) => peer.userId !== alice.user.id);
    const alicePeer = bobDevice.peers.find((peer) => peer.userId === alice.user.id);
    assert.ok(alicePeer);
    assert.ok(fs.readFileSync(configB, 'utf8').includes('PublicKey = ' + alicePeer.publicKey));
    assert.equal(await managerA.refreshPeers(network.id), true);
    assert.ok(fs.readFileSync(configA, 'utf8').includes('PublicKey = ' + bobPeer.publicKey));
    assert.match(fs.readFileSync(configA, 'utf8'), new RegExp('Endpoint = 198\\.51\\.100\\.32:41032'));
  } finally {
    await Promise.all(managers.map((manager) => manager.disconnectAll()));
    await apiServer.close();
    for (const profile of profiles) fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('syncconf recebe só os campos do wg (sem Address e MTU do wg-quick)', () => {
  const config = buildTunnelConfig({ privateKey: Buffer.alloc(32, 1).toString('base64'), assignedIp: '10.64.0.2', listenPort: 41000, peers: [{ publicKey: Buffer.alloc(32, 2).toString('base64'), assignedIp: '10.64.0.3' }] });
  const sync = wgSyncConfig(config);
  assert.doesNotMatch(sync, /Address|MTU/);
  assert.match(sync, /PrivateKey = /);
  assert.match(sync, /ListenPort = 41000/);
  assert.match(sync, /AllowedIPs = 10\.64\.0\.3\/32/);
});

test('operações de administrador: copia para a pasta protegida e só aceita os túneis do app', async () => {
  const { createPrivileged } = require('../main/razze-privilegiado');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-priv-'));
  const origem = path.join(root, 'origem');
  const tunnels = path.join(root, 'tunnels');
  const destino = path.join(root, 'Program Files');
  fs.mkdirSync(origem); fs.mkdirSync(tunnels);
  fs.writeFileSync(path.join(origem, 'wireguard.exe'), 'wireguard');
  fs.writeFileSync(path.join(origem, 'wg.exe'), 'wg');
  const calls = [];
  const privileged = createPrivileged({ wireguard: path.join(origem, 'wireguard.exe'), wg: path.join(origem, 'wg.exe'), tunnels, destino, run: async (file, args) => { calls.push([file, ...args]); return ''; } });
  try {
    const conf = path.join(tunnels, 'Razze' + 'a'.repeat(12) + '.conf');
    await privileged.install(conf);
    await privileged.syncconf('Razze' + 'a'.repeat(12), conf.replace(/\.conf$/, '.wg.conf'));
    await privileged.uninstall('Razze' + 'a'.repeat(12));
    assert.deepEqual(calls, [
      [path.join(destino, 'wireguard.exe'), '/installtunnelservice', conf],
      [path.join(destino, 'wg.exe'), 'syncconf', 'Razze' + 'a'.repeat(12), conf.replace(/\.conf$/, '.wg.conf')],
      [path.join(destino, 'wireguard.exe'), '/uninstalltunnelservice', 'Razze' + 'a'.repeat(12)],
    ]);
    assert.equal(fs.readFileSync(path.join(destino, 'wireguard.exe'), 'utf8'), 'wireguard');
    // Nada fora da pasta dos túneis, nem com outro nome, nem túnel com nome estranho
    await assert.rejects(privileged.install(path.join(root, 'Razze' + 'a'.repeat(12) + '.conf')), /inválida/);
    await assert.rejects(privileged.install(path.join(tunnels, '..', 'x.conf')), /inválida/);
    await assert.rejects(privileged.install(path.join(tunnels, 'outro.conf')), /inválida/);
    await assert.rejects(privileged.uninstall('Razze; del C:'), /inválido/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ajudante: o app manda os pedidos pelo pipe e o ajudante obedece só a essa conexão', async () => {
  const { spawn } = require('node:child_process');
  const { createElevation } = require('../main/razze-elevacao');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-ajud-'));
  const tunnels = path.join(root, 'tunnels');
  fs.mkdirSync(tunnels);
  fs.writeFileSync(path.join(root, 'wireguard.exe'), 'x');
  let child;
  // Aqui o ajudante roda sem administrador: ele recebe o pedido, valida e esbarra na cópia para o Program Files
  const elevation = createElevation({
    wireguard: path.join(root, 'wireguard.exe'), wg: path.join(root, 'wg.exe'), tunnels, elevado: () => false,
    launch: (_exe, args, fim) => { child = spawn(process.execPath, args, { stdio: 'ignore' }); child.on('exit', (code) => fim(new Error('saiu ' + code))); },
  });
  try {
    await assert.rejects(elevation.install(path.join(root, 'fora.conf')), /Configuração de túnel inválida|Não foi possível copiar/);
    await assert.rejects(elevation.uninstall('nome ruim'), /Nome de túnel inválido|Não foi possível copiar/);
    await assert.rejects(elevation.syncconf('Razze' + 'a'.repeat(12), path.join(tunnels, 'Razze' + 'a'.repeat(12) + '.wg.conf')), /wg\.exe não foi encontrado/);
  } finally {
    elevation.close();
    await new Promise((resolve) => child ? child.once('exit', resolve) : resolve());
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Linux: túnel rz + 12 letras (limite de 15 do kernel) e estado pelo "ip link"', async () => {
  assert.equal(tunnelNameFor('ab'.repeat(16), 'linux'), 'rzabababababab');
  assert.equal(tunnelNameFor('ab'.repeat(16), 'win32'), 'Razzeabababababab');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-linux-'));
  let up = null;
  const manager = createWireGuardManager({
    app: { isPackaged: false, getPath: () => profile, getAppPath: () => profile, getName: () => 'Tela P2P' },
    safeStorage: { isEncryptionAvailable: () => true }, platform: 'linux', binary: '/usr/bin/wg', privileged: {},
    exec: async (file, args) => {
      assert.deepEqual([file, ...args.slice(0, 4)], ['ip', '-o', 'link', 'show', 'dev']);
      if (up === null) throw new Error('Device "rzabababababab" does not exist.');
      return `9: rzabababababab: <POINTOPOINT,NOARP${up ? ',UP,LOWER_UP' : ''}> mtu 1380 qdisc noqueue state UNKNOWN`;
    },
  });
  try {
    assert.deepEqual(await manager.status('ab'.repeat(16)), { installed: true, exists: false, connected: false, tunnelName: 'rzabababababab' });
    up = false;
    assert.equal((await manager.status('ab'.repeat(16))).connected, false);
    up = true;
    assert.equal((await manager.status('ab'.repeat(16))).connected, true);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('Linux: o ajudante (shell como root) recusa pedido fora do padrão e responde na ordem', async (t) => {
  const { spawn, spawnSync } = require('node:child_process');
  if (spawnSync('sh', ['-c', 'true'], { stdio: 'ignore' }).status !== 0) return t.skip('sem sh neste PC');
  const { createElevationLinux } = require('../main/razze-elevacao');
  const tunnels = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-sh-')).split(path.sep).join('/');
  const conf = tunnels + '/rzabababababab.conf';
  fs.writeFileSync(conf, buildTunnelConfig({ privateKey: Buffer.alloc(32, 1).toString('base64'), assignedIp: '10.64.0.2', listenPort: 41000, peers: [] }));
  // Aqui sem root, sem ip e sem wg: o que passa na validação chega a tentar o comando e volta com o erro dele
  const elevation = createElevationLinux({ tunnels, spawnHelper: (args) => spawn('sh', args.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] }) });
  try {
    await assert.rejects(elevation.uninstall('rz; reboot'), /Nome de túnel inválido/);
    await assert.rejects(elevation.syncconf('rzabababababab', '/etc/shadow'), /Pedido inválido/);
    await assert.rejects(elevation.syncconf('rzabababababab', tunnels + '/../rzabababababab.wg.conf'), /Pedido inválido/);
    const ordem = await Promise.allSettled([elevation.uninstall('rz?'), elevation.install(conf, { tunnel: 'rzabababababab', address: '10.64.0.2/24' })]);
    assert.match(ordem[0].reason.message, /Nome de túnel inválido/);
    assert.doesNotMatch(ordem[1].reason.message, /inválid/); // passou na validação (falhou só por não ter ip/wg aqui)
    assert.equal(fs.existsSync(conf.replace(/\.conf$/, '.wg.conf')), false, 'o arquivo sem os campos do wg-quick é apagado');
  } finally {
    elevation.close();
    fs.rmSync(tunnels, { recursive: true, force: true });
  }
});

test('Linux: apertar para falar mapeia a tecla do Windows para o keycode do X', () => {
  const { xinputAlvo } = require('../main/linux');
  assert.deepEqual(xinputAlvo('V'.charCodeAt(0)), { tipo: 'key', codes: [55] });  // V = evdev 47 + 8
  assert.deepEqual(xinputAlvo(20), { tipo: 'key', codes: [66] });                  // Caps Lock
  assert.deepEqual(xinputAlvo(17), { tipo: 'key', codes: [37, 105] });             // Ctrl esquerdo e direito
  assert.deepEqual(xinputAlvo(112), { tipo: 'key', codes: [67] });                 // F1
  assert.deepEqual(xinputAlvo(5), { tipo: 'button', codes: [8] });                 // Mouse 4
  assert.equal(xinputAlvo(250), null);
});
