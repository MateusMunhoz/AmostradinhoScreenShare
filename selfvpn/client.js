'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const { spawn } = require('node:child_process');
const protocol = require('./protocol');

// Não segue redirecionamentos: um convite nunca envia sua credencial para outra origem.
function request(url, body, token, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = (target.protocol === 'https:' ? https : http).request(target, {
      method: data ? 'POST' : 'GET', timeout,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, res => {
      let output = '', size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 16384) res.destroy(new Error('Resposta muito grande.')); else output += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        let value;
        try { value = JSON.parse(output); } catch { return reject(new Error('Resposta inválida do servidor.')); }
        if (res.statusCode !== 200) return reject(new Error(res.statusCode === 401 ? 'Convite recusado pelo servidor.'
          : res.statusCode === 403 ? 'Este dispositivo foi revogado.' : res.statusCode === 409 ? 'A rede está cheia.' : 'Servidor indisponível.'));
        resolve(value);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao contactar o servidor.')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
class SelfVPN {
  constructor({ directory, bin, safeStorage, run = runWindows, fetch = request, interfaces = os.networkInterfaces }) {
    Object.assign(this, { directory, bin, safeStorage, run, fetch, interfaces });
    this.busy = false;
    this.file = path.join(directory, 'selfvpn.json');
  }
  load() {
    if (!fs.existsSync(this.file)) return null;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { server: protocol.origin(saved.server), profile: protocol.profile(saved.profile),
        secret: saved.secret, publicKey: protocol.key(saved.publicKey) };
    } catch { throw new Error('Perfil da VPN inválido. Restaure o perfil ou remova selfvpn.json com a VPN desconectada.'); }
  }
  save(value) {
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  async exclusive(task) {
    if (this.busy) throw new Error('Já existe uma operação da VPN em andamento.');
    this.busy = true;
    try { return await task(); } finally { this.busy = false; }
  }
  async connect(inviteText) {
    return this.exclusive(async () => {
      const runtime = path.join(this.bin, 'selfvpn', 'wireguard.exe');
      if (!fs.existsSync(runtime)) throw new Error('Componente VPN ausente. Execute npm run vpn:prepare ou use o executável com a VPN incluída.');
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('A proteção de chaves do Windows não está disponível.');
      const saved = this.load();
      if (Object.keys(this.interfaces()).includes(protocol.INTERFACE)) throw new Error('Desconecte a VPN antes de conectá-la novamente.');
      // A faixa é fixa e nunca assume a rota padrão nem altera o DNS do Windows.
      for (const [name, addresses] of Object.entries(this.interfaces())) {
        if (name === protocol.INTERFACE) continue;
        for (const a of addresses || []) {
          if ((a.family === 'IPv4' || a.family === 4) && overlaps(a)) throw new Error(`A rede ${name} já usa a faixa 10.77.0.0/24.`);
        }
      }
      let p, pair, server;
      if (inviteText && inviteText.trim()) {
        const invite = protocol.parseInvite(inviteText);
        server = invite.server;
        pair = saved?.server === server ? { publicKey: saved.publicKey,
          privateKey: this.safeStorage.decryptString(Buffer.from(saved.secret, 'base64')) } : protocol.identity();
        // Salva a identidade antes do cadastro: uma resposta perdida não consome outro IP no retry.
        const pendingFile = this.file + '.pending';
        if (fs.existsSync(pendingFile)) {
          const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
          if (pending.server === server) pair = { publicKey: protocol.key(pending.publicKey),
            privateKey: this.safeStorage.decryptString(Buffer.from(pending.secret, 'base64')) };
        }
        const secret = this.safeStorage.encryptString(protocol.key(pair.privateKey)).toString('base64');
        fs.mkdirSync(this.directory, { recursive: true });
        fs.writeFileSync(pendingFile, JSON.stringify({ server, publicKey: pair.publicKey, secret }), { mode: 0o600 });
        p = protocol.profile(await this.fetch(server + '/v1/enroll', { publicKey: pair.publicKey }, invite.token));
        this.save({ server, profile: p, publicKey: pair.publicKey, secret });
        fs.unlinkSync(pendingFile);
      } else {
        if (!saved) throw new Error('Cole o convite da sua rede VPN.');
        server = saved.server; p = saved.profile;
        pair = { publicKey: saved.publicKey, privateKey: this.safeStorage.decryptString(Buffer.from(saved.secret, 'base64')) };
      }
      protocol.config(p, pair.privateKey); // valida também antes de atravessar o limite de privilégio
      await this.run('Connect', { profile: p, privateKey: pair.privateKey }, this.bin);
      return { ...await this.status(), busy: false };
    });
  }
  async disconnect() {
    return this.exclusive(async () => { await this.run('Disconnect', null, this.bin); return { ...await this.status(), busy: false }; });
  }
  async status() {
    const saved = this.load();
    const address = (this.interfaces()[protocol.INTERFACE] || []).find(a => a.family === 'IPv4' || a.family === 4)?.address;
    let reachable = false;
    if (address && saved && address === saved.profile.address) {
      try { const health = await this.fetch(`http://${protocol.GATEWAY}:8789/health`, null, null, 1500); reachable = health?.service === 'tela-p2p-selfvpn'; } catch {}
    }
    return { installed: fs.existsSync(path.join(this.bin, 'selfvpn', 'wireguard.exe')),
      configured: !!saved, busy: this.busy, address: address || '',
      state: address ? (reachable ? 'connected' : 'unreachable') : 'disconnected',
      server: saved?.server || '', network: protocol.NETWORK };
  }
}
function overlaps(a) {
  const num = ip => ip.split('.').reduce((n, v) => ((n << 8) | Number(v)) >>> 0, 0);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(a.netmask || '')) return a.address.startsWith('10.77.0.');
  const mask = num(a.netmask), own = num(a.address), start = num('10.77.0.0'), end = num('10.77.0.255');
  return ((own & mask) >>> 0) <= end && ((own | (~mask >>> 0)) >>> 0) >= start;
}
function runWindows(action, payload, bin) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('A VPN integrada requer Windows.'));
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(bin, 'selfvpn-launch.ps1'), '-Action', action], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    // Sem timeout que abandone um helper elevado ainda em execução: aguarda a decisão do UAC.
    child.on('error', () => reject(new Error('Não foi possível iniciar o controlador da VPN.')));
    child.stdin.on('error', () => {});
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(code === 2
      ? 'Permissão de administrador cancelada.' : 'Não foi possível alterar a VPN. Confira o componente e a permissão de administrador.')));
    child.stdin.end(JSON.stringify(payload || {}));
  });
}
module.exports = { SelfVPN, request, overlaps };
