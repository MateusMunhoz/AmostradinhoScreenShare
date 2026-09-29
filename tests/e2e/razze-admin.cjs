'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
app.setPath('userData', process.env.RAZZE_ADMIN_TEST_PROFILE);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1360, height: 900, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const run = code => win.webContents.executeJavaScript(code);
  const wait = async (expression, name) => {
    for (let i = 0; i < 80; i++) { if (await run(expression)) { console.log('OK ' + name); return; } await new Promise(r => setTimeout(r, 50)); }
    throw new Error(name + ' não confirmou. ' + await run("document.getElementById('message').textContent"));
  };
  try {
    await win.loadURL(process.env.RAZZE_ADMIN_TEST_URL + '/admin/');
    await wait("!document.getElementById('login').hidden", 'Painel abre sem sessão');
    await run(`document.querySelector('details').open = true; document.getElementById('token').value = ${JSON.stringify(process.env.RAZZE_ADMIN_TEST_TOKEN)}; document.getElementById('tokenForm').requestSubmit();`);
    await wait("!document.getElementById('workspace').hidden && document.getElementById('content').textContent.includes('Salas anunciadas')", 'Login de primeiro acesso e resumo');
    await wait("document.querySelector('.stat strong').textContent === '1' && document.getElementById('content').textContent.includes('Alice')", 'Presença e sala real no resumo');
    const screenshotDir = path.join(os.tmpdir(), 'tela-p2p-e2e', 'fotos'); fs.mkdirSync(screenshotDir, { recursive: true });
    fs.writeFileSync(path.join(screenshotDir, 'razze-admin.png'), (await win.webContents.capturePage()).toPNG());
    await run("document.querySelector('[data-view=clients]').click()");
    await wait("document.getElementById('content').textContent.includes('1 conectados') && document.getElementById('content').textContent.includes('Forçar desconexão')", 'Clientes e consumo por sessão');
    await run("window.confirm = () => true; [...document.querySelectorAll('#content button')].find(b => b.textContent === 'Forçar desconexão').click()");
    await wait("document.getElementById('content').textContent.includes('0 conectados')", 'Força desconexão pela interface');
    await run("document.querySelector('[data-view=users]').click()");
    await wait("document.getElementById('content').textContent.includes('Tornar administrador')", 'Lista de usuários e papéis');
    await run("[...document.querySelectorAll('#content button')].find(b => b.textContent === 'Tornar administrador').click()");
    await wait("document.getElementById('content').textContent.includes('Remover administração')", 'Promove conta via painel');
    await run("document.querySelector('[data-view=settings]').click()");
    await wait("!!document.querySelector('#content form')", 'Configurações carregadas');
    await run("document.querySelectorAll('#content input[type=checkbox]')[1].checked = true; document.querySelector('#content form').requestSubmit()");
    await wait("document.getElementById('message').textContent.includes('Configurações salvas')", 'Salva aprovação manual');
    await run("document.querySelector('[data-view=database]').click()");
    await wait("!!document.querySelector('#content table') && document.getElementById('content').textContent.includes('alice@test.example')", 'Consulta de banco renderizada');
    if (await run("document.getElementById('content').textContent.includes('password_hash')")) throw new Error('Hash exposto');
    await run("document.querySelector('[data-view=audit]').click()");
    await wait("document.getElementById('content').textContent.includes('client.disconnect')", 'Auditoria registra desconexão');
    await run("document.getElementById('logout').click()");
    await wait("!document.getElementById('login').hidden", 'Logout limpa sessão');
    await run("document.getElementById('email').value = 'alice@test.example'; document.getElementById('password').value = 'test-password-123'; document.getElementById('loginForm').requestSubmit()");
    await wait("!document.getElementById('workspace').hidden", 'Administrador entra com a própria senha');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('Painel administrativo: todas as verificações passaram.'); app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
