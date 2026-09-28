'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiServer } = require('../razze-api/server');
const { createRazzeService } = require('../main/razze-service');

test('Electron service configura a API, persiste token protegido e expõe redes', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-service-'));
  const server = createApiServer({ dbPath: ':memory:', requireApproval: false, stun: false });
  const address = await server.listen(0, '127.0.0.1');
  const app = { getPath: () => profile };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from('sealed:' + value),
    decryptString: (value) => value.toString().slice('sealed:'.length),
  };
  const wireguard = {};
  try {
    const first = createRazzeService({ app, safeStorage, wireguard });
    first.configure('http://127.0.0.1:' + address.port);
    const created = await first.register('gui@example.com', 'senha-1234', 'GUI Teste');
    assert.equal(created.status, 'active');
    const login = await first.login('gui@example.com', 'senha-1234');
    assert.equal(login.user.displayName, 'GUI Teste');
    assert.equal(first.state().authenticated, true);

    const second = createRazzeService({ app, safeStorage, wireguard });
    assert.equal(second.state().authenticated, true);
    assert.equal((await second.me()).user.email, 'gui@example.com');
    const network = await second.createNetwork({ name: 'Rede via Electron', visibility: 'private' });
    assert.equal((await second.listNetworks()).networks[0].id, network.network.id);
    await second.logout();
    assert.equal(second.state().authenticated, false);
  } finally {
    await server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
