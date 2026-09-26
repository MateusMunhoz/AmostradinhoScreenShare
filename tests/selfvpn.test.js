const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const protocol = require('../selfvpn/protocol');
const { SelfVPN, request, overlaps } = require('../selfvpn/client');
const { Registry, createAPI } = require('../server/selfvpn-server');

const token = () => crypto.randomBytes(32).toString('base64url');
const invite = (server = 'https://vpn.example.com') => 'selfvpn:' + Buffer.from(JSON.stringify({ v: 1, server, token: token() })).toString('base64url');
const profile = () => ({ network: protocol.NETWORK, gateway: protocol.GATEWAY, address: '10.77.0.2', serverKey: protocol.identity().publicKey, endpoint: 'vpn.example.com:51820' });
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-selfvpn-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('convites só aceitam HTTPS e configurações não podem injetar rotas/comandos', () => {
  assert.equal(protocol.parseInvite(invite()).server, 'https://vpn.example.com');
  for (const server of ['http://vpn.example.com', 'https://x:secret@example.com', 'https://example.com/path', 'https://example.com/#token']) assert.throws(() => protocol.parseInvite(invite(server)));
  assert.throws(() => protocol.parseInvite('selfvpn:abc'));
  const p = profile(), pair = protocol.identity();
  assert.match(protocol.config(p, pair.privateKey), /AllowedIPs = 10\.77\.0\.0\/24/);
  assert.doesNotMatch(protocol.config(p, pair.privateKey), /DNS|0\.0\.0\.0\/0|PostUp/);
  for (const patch of [{ network: '0.0.0.0/0' }, { endpoint: 'host:51820\nPostUp=evil' }, { address: '10.77.0.1' }, { address: '10.77.0.255' }, { serverKey: 'A'.repeat(43) + '=' }]) assert.throws(() => protocol.profile({ ...p, ...patch }));
  // Compatibilidade matemática das chaves geradas com Curve25519/RFC 7748.
  const privateKey = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(pair.publicKey, 'base64').toString('base64url'), d: Buffer.from(pair.privateKey, 'base64').toString('base64url') }, format: 'jwk' });
  assert.equal(crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x, Buffer.from(pair.publicKey, 'base64').toString('base64url'));
});
test('detecta redes sobrepostas, inclusive máscaras mais amplas', () => {
  assert.ok(overlaps({ address: '10.1.2.3', netmask: '255.0.0.0' }));
  assert.ok(overlaps({ address: '10.77.0.50', netmask: '255.255.255.0' }));
  assert.ok(!overlaps({ address: '192.168.0.5', netmask: '255.255.255.0' }));
});
test('cadastros concorrentes são idempotentes, persistentes, limitados e revogáveis', async t => {
  const file = path.join(temporary(t), 'peers.json'), calls = [];
  const opts = { file, apply: async (...args) => calls.push(args), serverKey: protocol.identity().publicKey, serverEndpoint: 'vpn.example.com:51820', maxPeers: 2 };
  const r = new Registry(opts), a = protocol.identity().publicKey, b = protocol.identity().publicKey;
  const [one, two, again] = await Promise.all([r.enroll(a), r.enroll(b), r.enroll(a)]);
  assert.equal(one.address, again.address); assert.notEqual(one.address, two.address);
  await assert.rejects(r.enroll(protocol.identity().publicKey), e => e.status === 409);
  const restored = new Registry(opts); await restored.reconcile();
  assert.equal((await restored.enroll(a)).address, one.address);
  await restored.revoke(a);
  await assert.rejects(restored.enroll(a), e => e.status === 403);
  assert.ok(calls.some(c => c[0] === a && c[1] === null));
  assert.equal((await restored.enroll(protocol.identity().publicKey)).address, one.address);
});
test('API autentica convites e separa administração', async t => {
  const r = new Registry({ file: path.join(temporary(t), 'peers.json'), apply: async () => {}, serverKey: protocol.identity().publicKey, serverEndpoint: 'vpn.example.com:51820' });
  const inviteToken = token(), adminToken = token();
  const api = createAPI({ registry: r, inviteToken, adminToken });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => api.close(resolve)));
  const url = `http://127.0.0.1:${api.address().port}`;
  const pub = protocol.identity().publicKey;
  await assert.rejects(request(url + '/v1/enroll', { publicKey: pub }, token()), /recusado/);
  const enrolled = await request(url + '/v1/enroll', { publicKey: pub }, inviteToken);
  assert.equal(enrolled.address, '10.77.0.2');
  await assert.rejects(request(url + '/admin/revoke', { publicKey: pub }, inviteToken), /recusado/);
  assert.equal((await request(url + '/admin/revoke', { publicKey: pub }, adminToken)).revoked, true);
  await assert.rejects(request(url + '/v1/enroll', { publicKey: pub }, inviteToken), /revogado/);
});
test('cliente protege identidade, reutiliza cadastro após falha e distingue túnel sem servidor', async t => {
  const dir = temporary(t); fs.mkdirSync(path.join(dir, 'selfvpn')); fs.writeFileSync(path.join(dir, 'selfvpn', 'wireguard.exe'), 'fixture');
  const encryptionKey = crypto.randomBytes(32);
  const vault = {
    isEncryptionAvailable: () => true,
    encryptString: text => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv); const data = Buffer.concat([c.update(text), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]); },
    decryptString: b => { const d = crypto.createDecipheriv('aes-256-gcm', encryptionKey, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(); },
  };
  const keys = [], actions = []; let adapter = false, reachable = false, fail = true;
  const p = profile();
  const client = new SelfVPN({ directory: dir, bin: dir, safeStorage: vault,
    interfaces: () => adapter ? { [protocol.INTERFACE]: [{ address: p.address, family: 'IPv4' }] } : {},
    fetch: async (_url, body) => { if (!body) { if (!reachable) throw new Error('offline'); return { service: 'tela-p2p-selfvpn' }; } keys.push(body.publicKey); if (fail) { fail = false; throw new Error('response lost'); } return p; },
    run: async (action, data) => { actions.push(action); if (action === 'Connect') { assert.ok(data.privateKey); adapter = true; } else adapter = false; },
  });
  const invitation = invite();
  await assert.rejects(client.connect(invitation), /response lost/);
  const result = await client.connect(invitation);
  assert.equal(keys[0], keys[1]); assert.equal(result.state, 'unreachable');
  const saved = JSON.parse(fs.readFileSync(client.file));
  assert.doesNotMatch(JSON.stringify(saved), /privateKey|inviteToken/);
  assert.ok(!JSON.stringify(saved).includes(vault.decryptString(Buffer.from(saved.secret, 'base64'))));
  reachable = true; assert.equal((await client.status()).state, 'connected');
  assert.equal((await client.disconnect()).state, 'disconnected');
  await client.connect(''); assert.equal(keys.length, 2);
  assert.deepEqual(actions, ['Connect', 'Disconnect', 'Connect']);
});
test('controlador privilegiado valida configuração sem instalar túnel', { skip: process.platform !== 'win32' }, () => {
  const script = path.join(__dirname, '..', 'bin', 'selfvpn-control.ps1');
  const validate = body => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Validate'], { input: JSON.stringify(body), encoding: 'utf8', windowsHide: true });
  const body = { profile: profile(), privateKey: protocol.identity().privateKey };
  const good = validate(body); assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).valid, true);
  assert.equal(validate({ ...body, profile: { ...body.profile, network: '0.0.0.0/0' } }).status, 1);
  assert.equal(validate({ ...body, profile: { ...body.profile, endpoint: 'example.com:51820\nPostUp = whoami' } }).status, 1);
});
