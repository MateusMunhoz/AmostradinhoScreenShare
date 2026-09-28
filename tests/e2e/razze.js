// API SQLite/STUN no processo Node do runner; Electron exercita o renderer/preload real.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiServer } = require('../../razze-api/server');

async function approve(apiUrl, adminToken, email, displayName) {
  const registered = await fetch(apiUrl + '/v1/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'senha-e2e-456', displayName }),
  });
  if (registered.status !== 202) throw new Error('Cadastro de preparação inesperado: HTTP ' + registered.status);
  const { user } = await registered.json();
  const approved = await fetch(apiUrl + '/v1/admin/users/' + user.id + '/approve', {
    method: 'POST', headers: { Authorization: 'Bearer ' + adminToken },
  });
  if (!approved.ok) throw new Error('Não foi possível aprovar conta de preparação: HTTP ' + approved.status);
}

async function runElectron(appDir, apiUrl, adminToken, profile) {
  const executable = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  const testFile = path.join(appDir, 'tests', 'e2e', 'razze.cjs');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [testFile], {
      cwd: appDir,
      env: { ...process.env, RAZZE_E2E_API_URL: apiUrl, RAZZE_E2E_ADMIN_TOKEN: adminToken, RAZZE_E2E_PROFILE: profile },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main() {
  const appDir = path.resolve(__dirname, '..', '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-p2p-e2e-razze-'));
  const profile = path.join(tempDir, 'profile');
  const adminToken = crypto.randomBytes(36).toString('base64');
  const api = createApiServer({ dbPath: path.join(tempDir, 'razze.sqlite'), adminToken, stunHost: '127.0.0.1', stunPort: 0 });
  let status = 1;
  try {
    const address = await api.listen(0, '127.0.0.1');
    const apiUrl = 'http://127.0.0.1:' + address.port;
    await approve(apiUrl, adminToken, 'bob@example.test', 'Bob');
    status = await runElectron(appDir, apiUrl, adminToken, profile);
  } catch (error) {
    console.error('Não foi possível preparar o e2e Razze:', error.stack || error.message);
  } finally {
    await api.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  process.exitCode = status;
}

void main();
