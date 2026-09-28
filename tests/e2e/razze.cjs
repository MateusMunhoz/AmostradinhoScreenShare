// Renderer/preload reais, RazzeAPI local real e comandos do serviço WireGuard simulados.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRazzeService } = require('../../main/razze-service');
const { createWireGuardManager } = require('../../main/razze-wireguard');
const APP = path.resolve(__dirname, '..', '..');
const profile = process.env.RAZZE_E2E_PROFILE || path.join(os.tmpdir(), 'tela-p2p-e2e', 'perfil-razze');
app.setPath('userData', profile);
console.log('\n== Conta, rede e WireGuard Razze (API real)');
let ok = 0, bad = 0;
let disconnectAllCount = 0;
const overlayByNetwork = new Map();
const installed = new Set();
const check = (name, condition, detail = '') => {
  condition ? ok++ : bad++;
  console.log(`${condition ? 'OK   ' : 'FALHA'} ${name}${detail ? '  (' + detail + ')' : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fakeApp = { isPackaged: false, getPath: () => profile, getAppPath: () => APP, getName: () => 'Tela P2P E2E' };
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8'),
};
const wireguard = createWireGuardManager({
  app: fakeApp, safeStorage, platform: 'win32', binary: path.join(profile, 'wireguard.exe'),
  probePeer: async () => {}, setInterval: () => ({ unref() {} }), clearInterval: () => {},
  discoverEndpoint: async (host, port) => {
    const { discoverEndpoint } = require('../../main/razze-wireguard');
    return discoverEndpoint(host, port);
  },
  exec: async (_file, args) => {
    if (args[0] === 'query') {
      const name = args[1].replace(/^WireGuardTunnel\$/, '');
      if (!installed.has(name)) throw new Error('OpenService FAILED 1060');
      return 'STATE : 4 RUNNING';
    }
    if (args[0] === '/installtunnelservice') installed.add(path.basename(args[1], '.conf'));
    if (args[0] === '/uninstalltunnelservice') installed.delete(args[1]);
    return '';
  },
});
const service = createRazzeService({ app: fakeApp, safeStorage, wireguard });
const handlers = {
  'get-ips': async (_event, provider) => provider === 'razze'
    ? [...overlayByNetwork.values()].map((address) => ({ name: 'WireGuardTunnel$Razze', address, radmin: false, razze: true }))
    : [],
  'razze-pending-invite': () => '',
  'get-version': () => '1.11.8',
  'github-check': () => ({ ok: false }),
  'set-priority': () => true,
  'stats-start': () => true,
  'stats-stop': () => true,
  'stop-app-audio': () => true,
  'stop-server': () => true,
  'room-keys': () => true,
  'sessoes-observar': () => true,
  'capture-exclude': () => true,
  'ptt': () => true,
  'get-shortcuts': () => ({ compose: 'CommandOrControl+Enter', mute: 'CommandOrControl+Shift+M', edit: 'CommandOrControl+Shift+E', hideChat: 'CommandOrControl+Shift+O' }),
  'razze-state': () => service.state(),
  'razze-configure': (_event, url) => service.configure(url),
  'razze-health': () => service.health(),
  'razze-register': async (_event, email, password, displayName) => {
    const result = await service.register(email, password, displayName);
    if (result.status === 'pending_approval') {
      const response = await fetch(process.env.RAZZE_E2E_API_URL + '/v1/admin/users/' + result.user.id + '/approve', {
        method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RAZZE_E2E_ADMIN_TOKEN },
      });
      if (!response.ok) throw new Error('Falha ao aprovar conta de teste: ' + response.status);
    }
    return result;
  },
  'razze-login': (_event, email, password) => service.login(email, password),
  'razze-logout': () => service.logout(),
  'razze-me': () => service.me(),
  'razze-list-networks': () => service.listNetworks(),
  'razze-create-network': (_event, value) => service.createNetwork(value),
  'razze-update-network': (_event, id, patch) => service.updateNetwork(id, patch),
  'razze-delete-network': (_event, id) => service.deleteNetwork(id),
  'razze-accept-invite': (_event, token) => service.acceptInvite(token),
  'razze-list-members': (_event, id) => service.listMembers(id),
  'razze-remove-member': (_event, id, userId) => service.removeMember(id, userId),
  'razze-create-invite': (_event, id, options) => service.createInvite(id, options),
  'razze-friends': () => service.listFriends(),
  'razze-friend-requests': () => service.friendRequests(),
  'razze-request-friend': (_event, email) => service.requestFriend(email),
  'razze-accept-friend': (_event, id) => service.acceptFriendRequest(id),
  'razze-remove-friend': (_event, id) => service.removeFriend(id),
  'razze-wg-status': (_event, networkId) => wireguard.status(networkId),
  'razze-wg-connect': async (_event, networkId, name) => {
    const result = await wireguard.connect(service.api(), networkId, name);
    overlayByNetwork.set(networkId, result.overlayIp);
    return result;
  },
  'razze-wg-disconnect': async (_event, networkId) => {
    const result = await wireguard.disconnect(networkId);
    if (result.ok) overlayByNetwork.delete(networkId);
    return result;
  },
  'razze-wg-disconnect-all': async () => {
    disconnectAllCount++;
    const result = await wireguard.disconnectAll();
    if (result.ok) overlayByNetwork.clear();
    return result;
  },
};

app.whenReady().then(async () => {
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  const win = new BrowserWindow({ show: false, width: 1200, height: 780, webPreferences: { preload: path.join(APP, 'preload.js'), backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const run = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.join(APP, 'index.html'));
    await sleep(500);
    await run(`$('navSettings').click()`);
    check('Abre configurações gerais', await run(`!$('generalSettingsDialog').hidden`));
    await run(`$('networkProvider').value = 'razze'; $('networkProvider').dispatchEvent(new Event('change', { bubbles: true }))`);
    check('Seleciona VPN Razze e mostra campos do servidor', await run(`$('networkProvider').value === 'razze' && !$('razzeSettings').hidden`));
    await run(`$('razzeApiUrl').value = '${process.env.RAZZE_E2E_API_URL}'; $('razzeSaveServer').click()`);
    await sleep(100);
    check('Salva e testa API HTTP local real', await run(`$('razzeStatus').textContent.includes('Servidor acessível')`));
    await run(`$('razzeEmail').value = 'alice@example.test'; $('razzePassword').value = 'senha-e2e-123'; $('razzeDisplayName').value = 'Alice'; $('razzeRegister').click()`);
    await sleep(180);
    check('Cadastro pendente é aprovado pelo administrador de teste', await run(`$('razzeStatus').textContent.includes('Aguarde a aprovação')`));
    await run(`$('razzeEmail').value = 'alice@example.test'; $('razzePassword').value = 'senha-e2e-123'; $('razzeLogin').click()`);
    await sleep(200);
    check('Login real e sessão persistida pelo service', await run(`$('razzeAccountName').textContent === 'Alice' && !$('razzeAccount').hidden`) && service.state().authenticated);
    await run(`$('razzeNetworkName').value = 'Rede de teste'; $('razzeCreateNetwork').click()`);
    await sleep(120);
    check('Cria rede pela API e mostra cartão', await run(`document.querySelector('#razzeNetworks .razze-network strong')?.textContent === 'Rede de teste'`));
    await run(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__razzeCopied = value; } } })`);
    await run(`document.querySelector('#razzeNetworks .razze-network button:nth-of-type(3)').click()`);
    await sleep(120);
    const inviteLink = await run(`window.__razzeCopied || ''`);
    const inviteToken = inviteLink.split('/').pop();
    check('Gera link de convite pela API', inviteLink.startsWith('telap2p://invite/') && /^[A-Za-z0-9_-]{20,120}$/.test(inviteToken), inviteLink);
    await run(`$('razzeInviteToken').value = '${inviteLink}'; $('razzeJoinInvite').click()`);
    await sleep(120);
    check('Aceita o link de convite pela API', await run(`$('razzeStatus').textContent === 'Você entrou na rede.'`));
    // Bob entra pelo convite (pela API) e a dona tira ele pela lista de Membros
    const post = (p, body, token) => fetch(process.env.RAZZE_E2E_API_URL + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
    const bob = await post('/v1/auth/login', { email: 'bob@example.test', password: 'senha-e2e-456' });
    await post('/v1/invites/accept', { token: inviteToken }, bob.accessToken);
    check('Dona não tem "Sair da rede" na própria rede', await run(`![...document.querySelectorAll('#razzeNetworks .razze-network button')].some((b) => b.textContent === 'Sair da rede')`));
    await run(`[...document.querySelectorAll('#razzeNetworks .razze-network button')].find((b) => b.textContent === 'Membros').click()`);
    await sleep(200);
    check('Membros: mostra a dona e o Bob', await run(`(() => { const t = document.querySelector('.razze-members').textContent; return t.includes('Alice') && t.includes('dono') && t.includes('Bob'); })()`));
    await run(`window.confirm = () => true; [...document.querySelectorAll('.razze-members button')].find((b) => b.textContent === 'Remover').click()`);
    await sleep(250);
    const networkBob = (await service.listNetworks()).networks.find((item) => item.name === 'Rede de teste').id;
    check('Remover tira o Bob da rede', !(await service.listMembers(networkBob)).members.some((m) => m.email === 'bob@example.test') && await run(`!document.querySelector('.razze-members').textContent.includes('Bob')`));
    await run(`$('razzeFriendEmail').value = 'bob@example.test'; $('razzeAddFriend').click()`);
    await sleep(120);
    check('Pedido de amizade pendente aparece na lista', await run(`$('razzeFriends').textContent.includes('bob@example.test')`));
    await run(`document.querySelector('#razzeNetworks .razze-network button').click()`);
    await sleep(250);
    const networkId = (await service.listNetworks()).networks.find((item) => item.name === 'Rede de teste').id;
    const tunnelUi = await run(`({ status: $('razzeStatus').textContent, button: document.querySelector('#razzeNetworks .razze-network button').textContent })`);
    check('Registra chave, consulta STUN real e instala túnel simulado', tunnelUi.status.includes('VPN conectada em 10.64.0.2') && tunnelUi.button === 'Atualizar peers' && (await service.listDevices(networkId)).peers.length === 1, JSON.stringify(tunnelUi));
    await run(`document.querySelector('#razzeNetworks .razze-network button:nth-of-type(2)').click()`);
    await sleep(150);
    check('Desconecta túnel e restaura o rótulo', !(await wireguard.status(networkId)).connected && await run(`document.querySelector('#razzeNetworks .razze-network button').textContent === 'Conectar WireGuard'`));
    await run(`document.querySelector('#razzeNetworks .razze-network button').click()`);
    await sleep(180);
    await run(`$('razzeLogout').click()`);
    await sleep(150);
    check('Logout encerra todos os serviços e a sessão', disconnectAllCount === 1 && !service.state().authenticated && await run(`$('razzeAuth').hidden === false`));
    check('Sem erros no console do renderer', errors.length === 0, errors.join(' | '));
  } catch (error) {
    check('Fluxo Razze sem exceção', false, error.stack || error.message);
    try { await wireguard.disconnectAll(); } catch {}
  }
  console.log(`${ok} ok, ${bad} falhas`);
  app.exit(bad ? 1 : 0);
});
