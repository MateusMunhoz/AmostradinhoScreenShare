'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { createApiServer } = require('../../razze-api/server');
async function main() {
  const root = path.resolve(__dirname, '../..');
  const token = crypto.randomBytes(32).toString('base64url');
  const api = createApiServer({ dbPath: ':memory:', adminToken: token, requireApproval: false, stun: false });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-admin-e2e-'));
  try {
    const address = await api.listen(0, '127.0.0.1');
    const url = 'http://127.0.0.1:' + address.port;
    const post = (p, body, accessToken) => fetch(url + '/v1/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) }, body: JSON.stringify(body) }).then(r => r.json());
    const alice = await post('auth/register', { email: 'alice@test.example', displayName: 'Alice', password: 'test-password-123' });
    await post('presence/heartbeat', {}, alice.accessToken);
    const network = await post('networks', { name: 'Rede dos amigos' }, alice.accessToken);
    const deviceId = 'a'.repeat(32);
    await post('networks/' + network.network.id + '/devices', { deviceId, name: 'Notebook da Alice', publicKey: Buffer.alloc(32,1).toString('base64') }, alice.accessToken);
    await post('presence/heartbeat', { connections: [{ networkId: network.network.id, deviceId }], room: { id: 'a'.repeat(16), networkId: network.network.id, host: 'Alice', porta: 8765, pessoas: 3 } }, alice.accessToken);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(__dirname, 'razze-admin.cjs')], { cwd: root, windowsHide: true, stdio: 'inherit',
        env: { ...process.env, RAZZE_ADMIN_TEST_URL: url, RAZZE_ADMIN_TEST_TOKEN: token, RAZZE_ADMIN_TEST_PROFILE: profile } });
      child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
    });
    process.exitCode = code;
  } finally { api.server.closeAllConnections(); await api.close(); fs.rmSync(profile, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
