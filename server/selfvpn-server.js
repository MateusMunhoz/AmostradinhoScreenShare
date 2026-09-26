'use strict';
// Controlador de uma rede privada. O tráfego da VPN passa pelo WireGuard do kernel.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { key, endpoint, NETWORK, GATEWAY } = require('../selfvpn/protocol');
const exec = promisify(execFile);
function authorized(given, expected) {
  const digest = v => crypto.createHash('sha256').update(String(v || '')).digest();
  return crypto.timingSafeEqual(digest(given), digest('Bearer ' + expected));
}
class Registry {
  constructor({ file, apply, serverKey, serverEndpoint, maxPeers = 12 }) {
    this.file = file; this.apply = apply; this.serverKey = key(serverKey);
    this.endpoint = endpoint(serverEndpoint);
    if (!Number.isInteger(maxPeers) || maxPeers < 1 || maxPeers > 253) throw new Error('maxPeers inválido');
    this.maxPeers = maxPeers; this.queue = Promise.resolve();
    this.entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    if (!Array.isArray(this.entries)) throw new Error('Registro inválido');
    const usedKeys = new Set(), usedIPs = new Set();
    for (const p of this.entries) {
      key(p.publicKey);
      if (!Number.isInteger(p.slot) || p.slot < 2 || p.slot > 254 || usedKeys.has(p.publicKey) ||
          (!p.revoked && usedIPs.has(p.slot))) throw new Error('Registro inválido');
      usedKeys.add(p.publicKey); if (!p.revoked) usedIPs.add(p.slot);
    }
  }
  locked(task) { const job = this.queue.then(task); this.queue = job.catch(() => {}); return job; }
  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.entries), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  async reconcile() { for (const p of this.entries) await this.apply(p.publicKey, p.revoked ? null : `10.77.0.${p.slot}/32`); }
  enroll(publicKey) {
    key(publicKey);
    return this.locked(async () => {
      let p = this.entries.find(e => e.publicKey === publicKey);
      if (p?.revoked) throw Object.assign(new Error('Revogado'), { status: 403 });
      if (!p) {
        const active = this.entries.filter(e => !e.revoked);
        if (active.length >= this.maxPeers) throw Object.assign(new Error('Rede cheia'), { status: 409 });
        const used = new Set(active.map(e => e.slot));
        let slot = 2; while (used.has(slot)) slot++;
        p = { publicKey, slot, revoked: false };
        this.entries.push(p);
        try { this.persist(); } catch (err) { this.entries.pop(); throw err; }
      }
      // Uma reserva persistida pode ser reaplicada depois de uma falha ou reinício.
      await this.apply(publicKey, `10.77.0.${p.slot}/32`);
      return { network: NETWORK, gateway: GATEWAY, address: `10.77.0.${p.slot}`,
        serverKey: this.serverKey, endpoint: this.endpoint };
    });
  }
  revoke(publicKey) {
    key(publicKey);
    return this.locked(async () => {
      const p = this.entries.find(e => e.publicKey === publicKey);
      if (!p) throw Object.assign(new Error('Não encontrado'), { status: 404 });
      // Primeiro retira do kernel. Se a persistência falhar, não declara sucesso.
      await this.apply(publicKey, null);
      p.revoked = true;
      this.persist();
      return { revoked: true };
    });
  }
}
async function jsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 2048) throw Object.assign(new Error('Muito grande'), { status: 413 });
  }
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
}
function createAPI({ registry, inviteToken, adminToken }) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(inviteToken) || !/^[A-Za-z0-9_-]{43}$/.test(adminToken) || inviteToken === adminToken) throw new Error('Configure tokens distintos de 32 bytes');
  let windowStart = Date.now(), requests = 0;
  const server = http.createServer(async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (Date.now() - windowStart > 60000) { requests = 0; windowStart = Date.now(); }
      if (++requests > 120) return reply(429, { error: 'Tente novamente em um minuto.' });
      const admin = req.url === '/admin/peers' || req.url === '/admin/revoke';
      if (!authorized(req.headers.authorization, admin ? adminToken : inviteToken)) return reply(401, { error: 'Não autorizado' });
      if (req.method === 'GET' && req.url === '/admin/peers') return reply(200, { peers: registry.entries });
      if (req.method !== 'POST' || !['/v1/enroll', '/admin/revoke'].includes(req.url)) return reply(404, { error: 'Não encontrado' });
      const body = await jsonBody(req);
      try { key(body?.publicKey); } catch { return reply(400, { error: 'Chave inválida' }); }
      reply(200, admin ? await registry.revoke(body.publicKey) : await registry.enroll(body.publicKey));
    } catch (err) { reply(err.status || 503, { error: 'Operação não concluída' }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  server.maxHeadersCount = 30;
  return server;
}
async function main() {
  const file = process.argv[2] || '/etc/tela-selfvpn/server.json';
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  const wg = '/usr/bin/wg', iface = 'tela0';
  const actualKey = (await exec(wg, ['show', iface, 'public-key'])).stdout.trim();
  const registry = new Registry({ file: '/var/lib/tela-selfvpn/peers.json', serverKey: actualKey,
    serverEndpoint: settings.endpoint, maxPeers: settings.maxPeers || 12,
    apply: (publicKey, cidr) => exec(wg, ['set', iface, 'peer', publicKey, ...(cidr ? ['allowed-ips', cidr] : ['remove'])]) });
  await registry.reconcile();
  const api = createAPI({ registry, inviteToken: settings.inviteToken, adminToken: settings.adminToken });
  const probe = http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: 'tela-p2p-selfvpn' }));
  });
  const listen = (s, port, host) => new Promise((resolve, reject) => { s.once('error', reject); s.listen(port, host, resolve); });
  await listen(api, 8788, '127.0.0.1');
  await listen(probe, 8789, GATEWAY);
  console.log('Controlador SelfVPN pronto.');
  const stop = () => { api.close(); probe.close(); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
if (require.main === module) main().catch(() => { console.error('Falha ao iniciar SelfVPN. Confira configuração, permissões e interface tela0.'); process.exit(1); });
module.exports = { Registry, createAPI, authorized };
