// Ligar pela mensagem privada, de ponta a ponta, com dois apps em janelas invisíveis (Ana liga, Beto atende).
// O modo Internet usa o servidor de verdade (servidor-internet/server.js) em 127.0.0.1, que confere a senha;
// o modo Radmin usa o signaling.js de verdade. A RazzeAPI é de mentira: a mensagem da Ana vai direto para o Beto.
// Confere a janelinha do modo, a sala escondida com senha gerada, a voz dos dois, o aviso e o cartão "está te
// ligando", o Atender trocando o modo, e mudar a senha (a antiga para de valer).
// Roda com: npx electron tests/e2e/chamada.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocket } = require('ws');
const { createInternetServer } = require('../../servidor-internet/server');
const signaling = require('../../signaling');
const APP = path.resolve(__dirname, '..', '..');
app.setPath('userData', path.join(os.tmpdir(), 'tela-p2p-e2e', 'perfil-chamada'));
console.log('\n== Chamada pela mensagem privada (janelas invisíveis)');
let ok = 0, bad = 0;
const check = (n, c, x = '') => { c ? ok++ : bad++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${x !== '' ? '  (' + x + ')' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('TEMPO ESGOTADO'); app.exit(1); }, 120000);
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Entra no servidor Internet direto, sem app (para conferir a senha)
function tentarEntrar(url, sala, password) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', room: sala, password, name: 'Teste', client: crypto.randomBytes(16).toString('hex') })));
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'welcome' || m.type === 'error') { ws.terminate(); resolve(m.type); } });
    ws.on('error', () => resolve('erro'));
  });
}

app.whenReady().then(async () => {
  const internet = createInternetServer({ host: '127.0.0.1', port: 0, denyDelayMs: 5, log: () => {} });
  const URL_INTERNET = `ws://127.0.0.1:${(await internet.listen()).port}`;
  const enviadas = []; // as mensagens privadas que a Ana mandou
  for (const [channel, value] of Object.entries({
    'razze-pending-invite': '', 'razze-presence-state': { friends: [], networks: [], rooms: [], error: '' }, 'get-version': '1.9.2', 'github-check': { ok: false },
    'set-priority': true, 'stats-start': true, 'stats-stop': true, 'stop-app-audio': true, 'room-keys': true, 'sessoes-observar': true, 'capture-exclude': true,
    'ptt': true, 'get-shortcuts': {}, 'pip-edit': true, 'pip-size': true, 'pip-opacity': true, 'razze-state': { configured: false, authenticated: false },
    'get-ips': [{ address: '127.0.0.1', radmin: true }], 'dm-load': { name: '', messages: [] }, 'dm-save': true, 'razze-internet-room': true,
    'voz-cmd-estado': { programa: false, modelos: {} }, 'voz-ia-estado': { temChave: false, nuvem: false }, 'voz-cmd-tecla': true,
  })) ipcMain.handle(channel, () => value);
  ipcMain.handle('start-server', (_e, port, password, seed, provider) => signaling.startServer(port, password, { ...(seed || {}), onlyRazze: provider === 'razze' }));
  ipcMain.handle('stop-server', () => { signaling.stopServer(); return true; });
  ipcMain.handle('razze-send-message', (_e, to, text) => {
    const message = { id: `m${enviadas.length + 1}`, seq: enviadas.length + 1, from: 'ana', to, text, createdAt: Date.now(), e2e: true };
    enviadas.push(message);
    return { message };
  });
  ipcMain.handle('razze-messages', (_e, after) => ({ messages: enviadas.filter((m) => m.seq > after), more: false }));

  const errors = [];
  const abrir = async (nome, parte) => {
    const win = new BrowserWindow({ show: false, width: 1200, height: 780, webPreferences: { preload: path.join(APP, 'preload.js'), partition: parte } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) errors.push(`${nome}: ${message} @${src}:${line}`); });
    await win.webContents.session.clearStorageData({ storages: ['localstorage'] });
    await win.loadFile(path.join(APP, 'index.html'));
    await sleep(800);
    const run = (code) => win.webContents.executeJavaScript(code);
    const until = async (code, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await run(code)) return true; await sleep(150); } return false; };
    return { win, run, until };
  };
  try {
    const ana = await abrir('Ana', 'chamada-ana');
    const beto = await abrir('Beto', 'chamada-beto');
    check('Os dois apps abrem sem erro', errors.length === 0, errors.join(' | '));
    // Os dois no modo Radmin, com o servidor Internet configurado; cada um é amigo do outro
    for (const [p, eu, outro] of [[ana, 'ana', ['beto', 'Beto']], [beto, 'beto', ['ana', 'Ana']]]) {
      await p.run(`(() => { $('name').value = '${eu === 'ana' ? 'Ana' : 'Beto'}'; saveNetworkPreferences({ provider: 'radmin', internetUrl: '${URL_INTERNET}' });
        renderConnectivitySettings(); dm.account = '${eu}'; friendsData.friends = [{ id: '${outro[0]}', displayName: '${outro[1]}', online: true }]; })()`);
    }

    // ---------- A Ana liga pelo modo Internet ----------
    await ana.run("dm.account = 'ana'; void ligarPara('beto')");
    check('A janelinha pergunta só o modo de rede', await ana.until(`!!document.querySelector('.chamada-dialogo input[name=chamadaModo]')`));
    const modos = await ana.run(`[...document.querySelectorAll('.chamada-dialogo input[name=chamadaModo]')].map((i) => i.value + (i.disabled ? ':off' : '') + (i.checked ? ':on' : '')).join(' ')`);
    check('Vem marcado o modo atual; o Razze (sem conta) fica desativado com o motivo', modos === 'internet radmin:on razze:off'
      && /conta Razze/.test(await ana.run(`document.querySelector('.chamada-dialogo').textContent`)), modos);
    await ana.run(`(() => { document.querySelector('.chamada-dialogo input[value=internet]').checked = true; document.querySelector('.chamada-dialogo .btn.primary').click(); })()`);
    check('A Ana entra na sala e na voz', await ana.until('!!state.myId && !!voice.session && state.cloud?.code', 10000));
    check('A Ana passou para o modo Internet', await ana.run('selectedNetworkProvider()') === 'internet');
    const senha = await ana.run('state.password');
    check('Senha gerada, legível', /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(senha), senha);
    check('Sala escondida: não vai para a lista dos amigos', await ana.run('state.cloud.amigos') === false);
    await ana.until('!chamada.ligando');
    const msg = enviadas.at(-1);
    check('A chamada foi pela mensagem privada para o Beto', msg?.to === 'beto' && msg.text.includes(senha) && /telap2p:\/\/sala\?d=/.test(msg.text), msg?.text.split('\n')[0]);
    const cv = await ana.run(`lerConvite(${JSON.stringify(msg.text)})`);
    check('O convite traz chamada, código e a senha', cv?.chamada === true && cv.chave === senha && cv.codigo === await ana.run('state.cloud.code'));

    // ---------- O Beto recebe ----------
    await beto.run("dm.account = 'beto'; friendsData.friends = [{ id: 'ana', displayName: 'Ana', online: true }]; dmPoll()");
    check('Aviso "Ana está te ligando" com Atender', await beto.until(`$('toast').classList.contains('show') && /Ana está te ligando/.test($('toast').textContent) && !!$('toast').querySelector('.toast-action')`));
    const cartao = await beto.run(`(() => { const cv = lerConvite(${JSON.stringify(msg.text)}); const a = cartaoConvite(cv, false, 'Ana', Date.now()); const b = cartaoConvite(cv, false, 'Ana', Date.now() - 20 * 60000);
      return [a.querySelector('strong').textContent, a.querySelector('button').textContent, b.querySelector('strong').textContent, b.querySelector('button').textContent].join(' | '); })()`);
    check('Cartão: "está te ligando" com Atender; depois de um tempo, "Chamada de" com Entrar', cartao === 'Ana está te ligando | Atender | Chamada de Ana | Entrar', cartao);
    await beto.run(`$('toast').querySelector('.toast-action').click()`);
    check('Atender pergunta antes de trocar o modo', await beto.until(`!!document.querySelector('.app-confirm') && /modo Internet/.test(document.querySelector('.app-confirm').textContent)`));
    await beto.run(`document.querySelector('.app-confirm .btn.primary').click()`);
    check('O Beto entra na sala e na voz', await beto.until('!!state.myId && !!voice.session', 10000));
    check('O Beto tem a senha e está no modo Internet', await beto.run('state.password') === senha && await beto.run('selectedNetworkProvider()') === 'internet');
    check('Os dois se veem na sala', await ana.until(`[...state.members.values()].some((m) => m.name === 'Beto')`) && await beto.until(`[...state.members.values()].some((m) => m.name === 'Ana')`));

    // ---------- Senha no Painel da sala ----------
    await ana.run('renderSenhaSala()');
    await beto.run('renderSenhaSala()');
    check('Painel: a Ana (host) vê a senha escondida e pode mudar', await ana.run(`!$('roomSenha').hidden && $('roomSenha').querySelector('code').textContent.startsWith('•') && !$('roomSenhaMudar').disabled`));
    check('Painel: o Beto vê a senha, mas não muda', await beto.run(`!$('roomSenha').hidden && $('roomSenhaMudar').disabled && /host/.test($('roomSenhaMudar').title)`));
    await ana.run(`$('roomSenha').querySelector('.btn.icon').click()`);
    check('Mostrar a senha', await ana.run(`$('roomSenha').querySelector('code').textContent`) === senha);

    await ana.run('void mudarSenhaSala()');
    await ana.until(`!!document.querySelector('.chamada-dialogo input[type=text]')`);
    await ana.run(`(() => { const i = document.querySelector('.chamada-dialogo input[type=text]'); i.value = 'ab'; document.querySelector('.chamada-dialogo .btn.primary').click(); })()`);
    check('Senha curta demais no modo Internet: explica e não fecha', await ana.run(`!!document.querySelector('.chamada-dialogo .warn:not([hidden])')`));
    await ana.run(`(() => { const i = document.querySelector('.chamada-dialogo input[type=text]'); i.value = 'nova-senha-123'; document.querySelector('.chamada-dialogo .btn.primary').click(); })()`);
    check('O Beto recebe a senha nova', await beto.until(`state.password === 'nova-senha-123'`));
    check('A Ana também', await ana.until(`state.password === 'nova-senha-123'`));
    const sala = await ana.run('state.cloud.code');
    check('A senha antiga não entra mais', await tentarEntrar(URL_INTERNET, sala, senha) === 'error');
    check('A nova entra', await tentarEntrar(URL_INTERNET, sala, 'nova-senha-123') === 'welcome');

    // ---------- Convites que não valem ----------
    const ruins = await beto.run(`(() => { const t = (o) => 'x\\ntelap2p://sala?d=' + b64url(JSON.stringify(o));
      const base = { v: 1, modo: 'internet', servidor: 'ws://127.0.0.1:1', codigo: 'ABCDEF', pessoas: 1, chamada: true };
      return [lerConvite(t({ ...base, chave: 'a\\nb12' })).chamada, lerConvite(t({ ...base, chave: 'abc' })).chamada, lerConvite(t({ ...base, chave: 'x'.repeat(65) })).chamada, lerConvite(t({ ...base, chamada: 'sim', chave: 'abcd' })).chamada]; })()`);
    check('Chamada com senha inválida vira convite comum', ruins.every((x) => !x), JSON.stringify(ruins));

    // ---------- Pelo modo Radmin ----------
    await beto.run('leaveRoom()');
    await ana.run('leaveRoom()');
    await sleep(300);
    await ana.run("dm.account = 'ana'; void ligarPara('beto')");
    await ana.until(`!!document.querySelector('.chamada-dialogo input[name=chamadaModo]')`);
    await ana.run(`(() => { document.querySelector('.chamada-dialogo input[value=radmin]').checked = true; document.querySelector('.chamada-dialogo .btn.primary').click(); })()`);
    check('Radmin: a Ana abre a sala no PC dela e entra na voz', await ana.until('!!state.myId && state.isOwner && !!voice.session', 10000));
    await ana.until('!chamada.ligando');
    check('Radmin: a sala não aparece na lista de sessões', signaling.roomInfo() === null);
    const cvR = await ana.run(`lerConvite(${JSON.stringify(enviadas.at(-1).text)})`);
    check('Radmin: o convite traz o endereço e a senha', cvR?.modo === 'radmin' && /^127\.0\.0\.1:\d+$/.test(cvR.endereco) && cvR.chave === await ana.run('state.password'), cvR?.endereco);
    await beto.run(`void atenderChamada(lerConvite(${JSON.stringify(enviadas.at(-1).text)}), 'Ana')`);
    await beto.until(`!!document.querySelector('.app-confirm')`, 3000) && await beto.run(`document.querySelector('.app-confirm .btn.primary').click()`);
    check('Radmin: o Beto atende e entra na voz', await beto.until('!!state.myId && !!voice.session', 10000));
    await ana.run('void mudarSenhaSala()');
    await ana.until(`!!document.querySelector('.chamada-dialogo input[type=text]')`);
    await ana.run(`(() => { document.querySelector('.chamada-dialogo input[type=text]').value = ''; document.querySelector('.chamada-dialogo .btn.primary').click(); })()`);
    check('Radmin: senha vazia deixa a sala sem senha', await beto.until(`state.password === ''`) && await ana.until(`$('roomSenha').querySelector('code')?.textContent === 'sem senha'`));

    await sleep(500);
    check('Nenhum erro depois de usar', errors.length === 0, errors.join(' | '));
  } catch (e) {
    check('Sem exceção', false, e.stack || e.message);
  }
  console.log(`${ok} ok, ${bad} falhas`);
  signaling.stopServer();
  await internet.close();
  app.exit(bad ? 1 : 0);
});
