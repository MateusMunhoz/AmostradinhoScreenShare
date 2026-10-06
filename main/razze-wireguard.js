'use strict';

const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { app, safeStorage } = require('electron');

const PRIVATE_DER_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const PUBLIC_DER_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

function generateWireGuardKeys() {
  const pair = crypto.generateKeyPairSync('x25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    publicKeyEncoding: { type: 'spki', format: 'der' },
  });
  const privateRaw = pair.privateKey.subarray(-32);
  const publicRaw = pair.publicKey.subarray(-32);
  return { privateKey: privateRaw.toString('base64'), publicKey: publicRaw.toString('base64') };
}

function decodeStunResponse(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 32 || packet.readUInt16BE(0) !== 0x0101 || packet.readUInt32BE(4) !== 0x2112a442) {
    throw new Error('Resposta STUN inválida.');
  }
  const end = 20 + packet.readUInt16BE(2);
  for (let offset = 20; offset + 4 <= end;) {
    const type = packet.readUInt16BE(offset);
    const length = packet.readUInt16BE(offset + 2);
    const value = offset + 4;
    if (value + length > end) break;
    if ((type === 0x0020 || type === 0x0001) && length >= 8 && packet[value + 1] === 1) {
      const xor = type === 0x0020;
      const port = packet.readUInt16BE(value + 2) ^ (xor ? 0x2112 : 0);
      const addressBytes = Buffer.from(packet.subarray(value + 4, value + 8));
      if (xor) for (let i = 0; i < 4; i++) addressBytes[i] ^= Buffer.from([0x21, 0x12, 0xa4, 0x42])[i];
      return { host: [...addressBytes].join('.'), port };
    }
    offset = value + length + ((4 - (length % 4)) % 4);
  }
  throw new Error('A resposta STUN não trouxe um endereço IPv4.');
}

function discoverEndpoint(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      error ? reject(error) : resolve(value);
    };
    const transaction = crypto.randomBytes(12);
    const packet = Buffer.alloc(20);
    packet.writeUInt16BE(0x0001, 0);
    packet.writeUInt16BE(0, 2);
    packet.writeUInt32BE(0x2112a442, 4);
    transaction.copy(packet, 8);
    const timer = setTimeout(() => finish(new Error('O servidor STUN não respondeu.')), timeoutMs);
    socket.once('error', (error) => finish(error));
    socket.once('message', (response) => {
      if (!response.subarray(8, 20).equals(transaction)) return finish(new Error('Transação STUN não confere.'));
      try { finish(null, { ...decodeStunResponse(response), localPort: socket.address().port }); }
      catch (error) { finish(error); }
    });
    socket.bind(0, '0.0.0.0', () => socket.send(packet, port, host, (error) => { if (error) finish(error); }));
  });
}

function buildTunnelConfig({ privateKey, assignedIp, listenPort, peers }) {
  if (!isOverlayAddress(assignedIp)) throw new Error('Endereço overlay inválido.');
  if (!isWireGuardKey(privateKey)) throw new Error('Chave privada WireGuard inválida.');
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw new Error('Porta WireGuard inválida.');
  const lines = ['[Interface]', 'PrivateKey = ' + privateKey, 'Address = ' + assignedIp + '/24', 'ListenPort = ' + listenPort, 'MTU = 1380'];
  for (const peer of peers || []) {
    if (!peer || !isWireGuardKey(peer.publicKey) || !isOverlayAddress(peer.assignedIp)) throw new Error('Chave ou endereço de peer WireGuard inválido.');
    lines.push('', '[Peer]', 'PublicKey = ' + peer.publicKey, 'AllowedIPs = ' + peer.assignedIp + '/32');
    if (peer.endpointHost && Number.isInteger(peer.endpointPort) && netIsIPv4(peer.endpointHost)) lines.push('Endpoint = ' + peer.endpointHost + ':' + peer.endpointPort);
    lines.push('PersistentKeepalive = 20');
  }
  return lines.join('\r\n') + '\r\n';
}

function netIsIPv4(value) { return require('node:net').isIP(value) === 4; }
function isWireGuardKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value;
}
function isOverlayAddress(value) {
  if (!netIsIPv4(value)) return false;
  const octets = value.split('.').map(Number);
  return octets[0] === 10 && octets[1] >= 64 && octets[1] <= 127;
}

function pingPeer(assignedIp, peerIp) {
  if (process.platform === 'linux') {
    return new Promise((resolve, reject) => execFile('ping', ['-c', '1', '-W', '2', '-I', assignedIp, peerIp], {
      timeout: 3000, maxBuffer: 64 * 1024, encoding: 'utf8',
    }, (error) => error ? reject(error) : resolve()));
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return new Promise((resolve, reject) => execFile(path.join(systemRoot, 'System32', 'PING.EXE'), ['-n', '1', '-w', '1200', '-S', assignedIp, peerIp], {
    windowsHide: true, timeout: 2500, maxBuffer: 64 * 1024, encoding: 'utf8',
  }, (error) => error ? reject(error) : resolve()));
}

function wireguardExecutable(options = {}) {
  const electronApp = options.app || app;
  const exists = options.exists || fs.existsSync;
  // Linux: o túnel é do kernel; o app só precisa do wg (pacote wireguard-tools)
  if ((options.platform || process.platform) === 'linux') return ['/usr/bin/wg', '/usr/local/bin/wg', '/bin/wg', '/usr/sbin/wg'].find(exists) || null;
  const candidates = [
    path.join(options.moduleDir || __dirname, '..', 'bin', 'selfvpn', 'wireguard.exe'),
    electronApp.isPackaged ? path.join(options.resourcesPath || process.resourcesPath, 'bin', 'selfvpn', 'wireguard.exe') : '',
    !electronApp.isPackaged ? path.join(electronApp.getAppPath(), 'bin', 'selfvpn', 'wireguard.exe') : '',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WireGuard', 'wireguard.exe'),
  ].filter(Boolean);
  return candidates.find(exists) || null;
}

// wg.exe (troca a lista de pessoas com o túnel ligado). Numa atualização pela sala ele vem no pacote,
// ao lado deste arquivo; no .exe, em resources.
function wgExecutable() {
  const candidates = [
    path.join(__dirname, '..', 'bin', 'selfvpn', 'wg.exe'),
    app.isPackaged ? path.join(process.resourcesPath, 'bin', 'selfvpn', 'wg.exe') : '',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WireGuard', 'wg.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

// A configuração do wg (syncconf) não aceita os campos do wg-quick (Address, MTU, DNS)
function wgSyncConfig(config) {
  return config.split(/\r?\n/).filter((line) => !/^\s*(Address|MTU|DNS|Table|PreUp|PostUp|PreDown|PostDown)\s*=/i.test(line)).join('\r\n');
}

function exec(file, args, timeout = 120_000) {
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
    const output = (String(stdout || '') + String(stderr || '')).trim();
    if (error) return reject(new Error(output || (error.killed ? 'O WireGuard excedeu o tempo limite.' : 'O WireGuard terminou com erro (' + (error.code ?? 'desconhecido') + ').')));
    resolve(output);
  }));
}

function createWireGuardManager(options = {}) {
  const electronApp = options.app || app;
  const platform = options.platform || process.platform;
  const storePath = path.join(electronApp.getPath('userData'), 'razze', 'identity.json');
  const binary = options.binary || wireguardExecutable({ app: electronApp, platform });
  const run = options.exec || exec;
  const stun = options.discoverEndpoint || discoverEndpoint;
  const scheduleInterval = options.setInterval || setInterval;
  const cancelInterval = options.clearInterval || clearInterval;
  const probePeer = options.probePeer || pingPeer;
  const peerRefreshIntervalMs = options.peerRefreshIntervalMs || 30_000;
  const activeTunnels = new Map();
  const refreshTimers = new Map();
  const tunnelsDir = path.join(electronApp.getPath('userData'), 'razze', 'tunnels');
  const linux = platform === 'linux';
  const nameFor = (networkId) => tunnelNameFor(networkId, platform);
  const TUNNEL_NAME = linux ? /^rz[a-f0-9]{12}$/ : /^Razze[a-f0-9]{12}$/;
  const semWireGuard = linux
    ? 'O WireGuard não está instalado. No terminal: sudo apt install wireguard-tools'
    : 'WireGuard não foi encontrado no pacote do Nebula.';
  // Instalar, remover e atualizar o túnel precisam de administrador: direto, se o app já estiver como
  // administrador, ou pelo ajudante que pede a permissão do Windows (main/razze-elevacao.js). Nos testes,
  // options.exec simula os comandos.
  const privileged = options.privileged || (options.exec
    ? {
      install: (config) => run(binary, ['/installtunnelservice', config]),
      uninstall: (tunnel) => run(binary, ['/uninstalltunnelservice', tunnel]),
      syncconf: (tunnel, config) => run(options.wgBinary || 'wg.exe', ['syncconf', tunnel, config]),
    }
    : linux
      ? require('./razze-elevacao').createElevationLinux({ tunnels: tunnelsDir })
      : require('./razze-elevacao').createElevation({ wireguard: binary, wg: wgExecutable(), tunnels: tunnelsDir }));
  const refreshTasks = new Map();

  function stopPeerRefresh(networkId) {
    const timer = refreshTimers.get(networkId);
    if (timer) cancelInterval(timer);
    refreshTimers.delete(networkId);
    activeTunnels.delete(networkId);
    return refreshTasks.get(networkId)?.catch(() => {}) || Promise.resolve();
  }

  function startPeerRefresh(networkId, tunnel) {
    void stopPeerRefresh(networkId);
    activeTunnels.set(networkId, tunnel);
    const timer = scheduleInterval(() => {
      void refreshPeers(networkId).catch((error) => console.warn('[Razze WireGuard] Não foi possível atualizar peers:', error.message));
    }, peerRefreshIntervalMs);
    timer?.unref?.();
    refreshTimers.set(networkId, timer);
    void refreshPeers(networkId).catch((error) => console.warn('[Razze WireGuard] Não foi possível iniciar a descoberta dos peers:', error.message));
  }

  function identity() {
    const storage = options.safeStorage || safeStorage;
    if (!storage.isEncryptionAvailable()) throw new Error('O Windows não disponibilizou armazenamento protegido para as chaves WireGuard.');
    try {
      const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const secret = JSON.parse(storage.decryptString(Buffer.from(saved.secret, 'base64')));
      if (secret.deviceId && secret.privateKey && secret.publicKey) return secret;
    } catch {}
    const keys = (options.generateKeys || generateWireGuardKeys)();
    const secret = { deviceId: crypto.randomUUID().replaceAll('-', ''), ...keys };
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const encrypted = storage.encryptString(JSON.stringify(secret));
    fs.writeFileSync(storePath, JSON.stringify({ secret: encrypted.toString('base64') }), { mode: 0o600 });
    return secret;
  }

  function assertNetworkId(networkId) {
    const id = String(networkId || '');
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('ID de rede inválido.');
    return id;
  }

  async function status(networkId) {
    return tunnelStatus(nameFor(assertNetworkId(networkId)));
  }

  async function tunnelStatus(tunnelName) {
    if (!binary) return { installed: false, connected: false, error: semWireGuard };
    if (linux) {
      // Linux: a interface existe? Com UP nas marcas, está ligada
      try {
        const output = await run('ip', ['-o', 'link', 'show', 'dev', tunnelName], 10_000);
        return { installed: true, exists: true, connected: /<[^>]*\bUP\b[^>]*>/.test(output), tunnelName };
      } catch (error) {
        if (/does not exist|não existe|Cannot find device/i.test(error.message)) return { installed: true, exists: false, connected: false, tunnelName };
        return { installed: true, exists: true, connected: false, tunnelName, error: error.message };
      }
    }
    try {
      const output = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'sc.exe'), ['query', 'WireGuardTunnel$' + tunnelName], 10_000);
      // O sc.exe traduz o rótulo (STATE em inglês, ESTADO em português), mas não o "4 RUNNING"
      return { installed: true, exists: true, connected: /:\s*4\s+RUNNING\b/i.test(output), tunnelName };
    } catch (error) {
      if (/1060|does not exist|não existe/i.test(error.message)) return { installed: true, exists: false, connected: false, tunnelName };
      return { installed: true, exists: true, connected: false, tunnelName, error: error.message };
    }
  }

  // Inventário local: funciona mesmo quando o servidor está inacessível.
  async function connections() {
    let files;
    try { files = fs.readdirSync(tunnelsDir); }
    catch (error) { if (error.code === 'ENOENT') files = []; else throw error; }
    const names = files.filter(file => /^(Razze|rz)[a-f0-9]{12}\.conf$/i.test(file) && TUNNEL_NAME.test(file.slice(0, -5))).map(file => file.slice(0, -5));
    const interfaces = (options.networkInterfaces || os.networkInterfaces)();
    const tracked = [...activeTunnels.values()].map(tunnel => tunnel.tunnelName);
    const allNames = new Set([...names, ...tracked, ...Object.keys(interfaces).filter(name => TUNNEL_NAME.test(name))]);
    return Promise.all([...allNames].map(async tunnelName => ({
      ...await tunnelStatus(tunnelName),
      networkName: [...activeTunnels.values()].find(tunnel => tunnel.tunnelName === tunnelName)?.networkName || '',
      networkPrefix: tunnelName.replace(/^(Razze|rz)/i, ''),
      tunnelName,
    })));
  }

  async function connect(api, networkId, networkName = 'Razze') {
    if (platform !== 'win32' && !linux) throw new Error('A VPN Razze funciona no Windows e no Linux.');
    if (!binary) throw new Error(linux ? semWireGuard : 'WireGuard não foi encontrado. Confira bin/selfvpn/wireguard.exe no pacote.');
    networkId = assertNetworkId(networkId);
    await stopPeerRefresh(networkId);
    const current = await status(networkId);
    const health = await api.health();
    if (!health.stun || health.stun.protocol !== 'udp') throw new Error('O servidor Razze não publicou o endpoint STUN UDP.');
    const base = new URL(api.baseUrl);
    const keys = identity();
    const registered = await api.registerDevice(networkId, { deviceId: keys.deviceId, name: electronApp.getName(), publicKey: keys.publicKey });
    const publicEndpoint = await stun(base.hostname, health.stun.port);
    await api.updateDeviceEndpoint(networkId, keys.deviceId, { host: publicEndpoint.host, port: publicEndpoint.port });
    const directory = path.join(electronApp.getPath('userData'), 'razze', 'tunnels');
    fs.mkdirSync(directory, { recursive: true });
    const tunnelName = nameFor(networkId);
    const configPath = path.join(directory, tunnelName + '.conf');
    const peersResult = await api.listDevices(networkId);
    const config = buildTunnelConfig({ privateKey: keys.privateKey, assignedIp: registered.device.assignedIp, listenPort: publicEndpoint.localPort, peers: peersResult.peers.filter((peer) => peer.deviceId !== keys.deviceId) });
    if (current.exists) {
      await privileged.uninstall(tunnelName);
      let removed = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const previous = await status(networkId);
        if (!previous.exists) { removed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!removed) throw new Error('O serviço WireGuard anterior ainda está encerrando. Tente novamente em alguns segundos.');
    }
    fs.writeFileSync(configPath, config, { mode: 0o600 });
    try {
      await privileged.install(configPath, { tunnel: tunnelName, address: registered.device.assignedIp + '/24' });
    } catch (error) {
      if (linux) throw new Error('Não foi possível ligar o túnel WireGuard: ' + error.message);
      throw new Error(/access is denied|acesso negado|administrator|administrador|elevat/i.test(error.message)
        ? 'O Windows exige permissão de administrador para criar a interface VPN. Execute o Nebula como administrador e tente novamente.'
        : 'Não foi possível iniciar o túnel WireGuard: ' + error.message);
    }
    let tunnelStatus = await status(networkId);
    for (let attempt = 0; attempt < 10 && !tunnelStatus.connected; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      tunnelStatus = await status(networkId);
    }
    if (!tunnelStatus.connected) throw new Error(tunnelStatus.error || 'O serviço WireGuard foi instalado, mas não confirmou que o túnel está ativo.');
    startPeerRefresh(networkId, { api, networkId, networkName, tunnelName, configPath, privateKey: keys.privateKey, assignedIp: registered.device.assignedIp, listenPort: publicEndpoint.localPort });
    return { ...tunnelStatus, publicIp: publicEndpoint.host, overlayIp: registered.device.assignedIp, tunnelName, networkName };
  }

  async function refreshPeers(networkId) {
    networkId = assertNetworkId(networkId);
    if (refreshTasks.has(networkId)) return refreshTasks.get(networkId);
    const tunnel = activeTunnels.get(networkId);
    if (!tunnel) return false;
    const task = (async () => {
      const current = await status(networkId);
      if (activeTunnels.get(networkId) !== tunnel || !current.connected) return false;
      const listed = await tunnel.api.listDevices(networkId);
      if (activeTunnels.get(networkId) !== tunnel) return false;
      const deviceId = identity().deviceId;
      const peers = listed.peers.filter((peer) => peer.deviceId !== deviceId);
      const config = buildTunnelConfig({
        privateKey: tunnel.privateKey,
        assignedIp: tunnel.assignedIp,
        listenPort: tunnel.listenPort,
        peers,
      });
      let previous = '';
      try { previous = fs.readFileSync(tunnel.configPath, 'utf8'); } catch {}
      const changed = previous !== config;
      let synced = false;
      if (changed) {
        if (activeTunnels.get(networkId) !== tunnel) return false;
        // Com o túnel ligado: só a lista de pessoas muda, e as conexões de quem já estava não caem
        fs.writeFileSync(tunnel.configPath, config, { mode: 0o600 });
        const syncPath = tunnel.configPath.replace(/\.conf$/, '.wg.conf');
        fs.writeFileSync(syncPath, wgSyncConfig(config), { mode: 0o600 });
        try { await privileged.syncconf(tunnel.tunnelName, syncPath); synced = true; }
        catch (error) { console.warn('[Razze WireGuard] Não deu para atualizar sem reiniciar o túnel:', error.message); }
        finally { fs.rmSync(syncPath, { force: true }); }
      }
      if (changed && !synced) {
        if (activeTunnels.get(networkId) !== tunnel) return false;
        await privileged.uninstall(tunnel.tunnelName);
        let removed = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          const state = await status(networkId);
          if (!state.exists) { removed = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!removed) throw new Error('O serviço WireGuard anterior ainda está encerrando.');
        if (activeTunnels.get(networkId) !== tunnel) return false;
        fs.writeFileSync(tunnel.configPath, config, { mode: 0o600 });
        await privileged.install(tunnel.configPath, { tunnel: tunnel.tunnelName, address: tunnel.assignedIp + '/24' });
        if (activeTunnels.get(networkId) !== tunnel) return false;
        let next = await status(networkId);
        for (let attempt = 0; attempt < 10 && !next.connected; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          next = await status(networkId);
        }
        if (!next.connected) throw new Error(next.error || 'O túnel WireGuard não voltou após atualizar os peers.');
      }
      for (let offset = 0; offset < peers.length; offset += 16) {
        await Promise.allSettled(peers.slice(offset, offset + 16).map((peer) => probePeer(tunnel.assignedIp, peer.assignedIp)));
      }
      return changed;
    })();
    refreshTasks.set(networkId, task);
    try { return await task; }
    finally { if (refreshTasks.get(networkId) === task) refreshTasks.delete(networkId); }
  }

  async function disconnect(networkId) {
    if (!binary) return { ok: false, error: 'WireGuard não foi encontrado.' };
    let tunnelName;
    try { tunnelName = nameFor(assertNetworkId(networkId)); }
    catch (error) { return { ok: false, error: error.message }; }
    await stopPeerRefresh(String(networkId));
    return disconnectTunnel(tunnelName);
  }

  async function disconnectTunnel(tunnelName) {
    if (!TUNNEL_NAME.test(tunnelName)) return { ok: false, error: 'Nome de túnel inválido.' };
    try {
      const current = linux
        ? await run('ip', ['-o', 'link', 'show', 'dev', tunnelName], 10_000)
          .then((output) => ({ exists: true, output }), (error) => /does not exist|Cannot find device/i.test(error.message) ? ({ exists: false }) : Promise.reject(error))
        : await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'sc.exe'), ['query', 'WireGuardTunnel$' + tunnelName], 10_000)
        .then((output) => ({ exists: true, output }), (error) => /1060|does not exist|não existe/i.test(error.message) ? ({ exists: false }) : Promise.reject(error));
      if (!current.exists) {
        fs.rmSync(path.join(electronApp.getPath('userData'), 'razze', 'tunnels', tunnelName + '.conf'), { force: true });
        return { ok: true };
      }
      await privileged.uninstall(tunnelName);
      fs.rmSync(path.join(electronApp.getPath('userData'), 'razze', 'tunnels', tunnelName + '.conf'), { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function disconnectAll() {
    await Promise.all([...refreshTimers.keys()].map((networkId) => stopPeerRefresh(networkId)));
    const directory = path.join(electronApp.getPath('userData'), 'razze', 'tunnels');
    let names = [];
    try {
      names = fs.readdirSync(directory)
        .filter((file) => /^(Razze|rz)[a-f0-9]{12}\.conf$/i.test(file) && TUNNEL_NAME.test(file.slice(0, -5)))
        .map((file) => file.slice(0, -5));
    } catch (error) {
      if (error.code !== 'ENOENT') return { ok: false, disconnected: 0, errors: [error.message] };
    }
    const results = await Promise.all(names.map((name) => disconnectTunnel(name)));
    const errors = results.filter((result) => !result.ok).map((result) => result.error);
    return { ok: errors.length === 0, disconnected: results.length - errors.length, errors };
  }

  // O app abriu de novo com o túnel ligado: volta a buscar quem entrou na rede (sem reinstalar nada)
  async function resume(api, networkId) {
    networkId = assertNetworkId(networkId);
    if (activeTunnels.has(networkId)) return { resumed: false, connected: true };
    const current = await status(networkId);
    if (!current.connected) return { resumed: false, connected: false };
    const tunnelName = nameFor(networkId);
    const configPath = path.join(tunnelsDir, tunnelName + '.conf');
    let text = '';
    try { text = fs.readFileSync(configPath, 'utf8'); } catch { return { resumed: false, connected: true }; }
    const assignedIp = /^\s*Address\s*=\s*([\d.]+)/mi.exec(text)?.[1];
    const listenPort = Number(/^\s*ListenPort\s*=\s*(\d+)/mi.exec(text)?.[1]);
    if (!isOverlayAddress(assignedIp) || !Number.isInteger(listenPort)) return { resumed: false, connected: true };
    startPeerRefresh(networkId, { api, networkId, networkName: 'Razze', tunnelName, configPath, privateKey: identity().privateKey, assignedIp, listenPort });
    return { resumed: true, connected: true, overlayIp: assignedIp };
  }

  return { status, connections, connect, refreshPeers, disconnect, disconnectAll, identity, resume };
}

// No Linux, nome de interface tem no máximo 15 letras: "rz" + 12
function tunnelNameFor(networkId, platform = process.platform) {
  const id = String(networkId || '');
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('ID de rede inválido.');
  return (platform === 'linux' ? 'rz' : 'Razze') + id.slice(0, 12);
}

module.exports = { wireguardExecutable, generateWireGuardKeys, decodeStunResponse, discoverEndpoint, buildTunnelConfig, wgSyncConfig, createWireGuardManager, tunnelNameFor, isOverlayAddress, isWireGuardKey };
