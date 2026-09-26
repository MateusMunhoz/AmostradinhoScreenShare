// Carga do app numa janela invisível: nenhum erro ao abrir, os nomes globais que os testes e os scripts
// usam continuam existindo, e dá para entrar numa sala de mentira e sair. Rápido (uns 5 s) e sem abrir
// nada na tela: serve para conferir cada passo quando o renderer é dividido em vários arquivos.
// Roda com: npx electron tests/e2e/carga.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('node:os');
const path = require('node:path');
const APP = path.resolve(__dirname, '..', '..');
app.setPath('userData', path.join(os.tmpdir(), 'tela-p2p-e2e', 'perfil-carga'));
console.log('\n== Carga do app (janela invisível)');
let ok = 0, bad = 0;
const check = (n, c, x = '') => { c ? ok++ : bad++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${x !== '' ? '  (' + x + ')' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('TEMPO ESGOTADO'); app.exit(1); }, 30000);

// Tudo que os testes de ponta a ponta e os scripts separados chamam pelo nome
const GLOBALS = [
  '$', 'state', 'update', 'QUALITY', 'chat', 'voice', 'mixer', 'once', 'onceSupportCache', 'speaking', 'speakTimer', 'volumes',
  'voiceCfg', 'perf', 'overlay', 'THEME', 'ICON', 'VoiceChat', 'watch', 'watchSelf', 'stopWatching', 'togglePip', 'closePip',
  'setVol', 'sendChat', 'attachFiles', 'startSharing', 'stopSharing', 'switchSource', 'openShareDialog', 'closeShareDialog',
  'setPanelOpen', 'setPeopleOpen', 'setStatsTab', 'openStats', 'closeStats', 'enterRoom', 'leaveRoom', 'nameOf', 'setRadio',
  'openVoiceDialog', 'closeVoiceDialog', 'startCapture', 'accelFromEvent', 'gateThreshold', 'onPttKey', 'renderSpeaking',
  'startSpeakLoop', 'updateDuck', 'setFocus', 'setIncomingVideo', 'renderUpdateBanner', 'scrollChatToEnd', 'markRead',
  'closePersonCard', 'send', 'toast', 'show', 'personColor', 'speakBars', 'renderMembers', 'onceSupport',
];

app.whenReady().then(async () => {
  for (const [channel, value] of Object.entries({
    'get-ips': [], 'get-version': '1.9.2', 'github-check': { ok: false }, 'set-priority': true, 'stats-start': true, 'stats-stop': true,
    'stop-app-audio': true, 'stop-server': true, 'room-keys': true, 'ptt': true,
    'get-shortcuts': { compose: 'CommandOrControl+Enter', mute: 'CommandOrControl+Shift+M', edit: 'CommandOrControl+Shift+E', hideChat: 'CommandOrControl+Shift+O' },
  })) ipcMain.handle(channel, () => value);
  const win = new BrowserWindow({ show: false, width: 1200, height: 780, webPreferences: { preload: path.join(APP, 'preload.js') } });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  const run = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.join(APP, 'index.html'));
    await sleep(800);
    check('Abre sem erro no console', errors.length === 0, errors.join(' | '));
    // typeof escrito direto (a regra de segurança do app não deixa usar eval dentro da página)
    const missing = await run(`[${GLOBALS.map((n) => `typeof ${n} === 'undefined' ? '${n}' : ''`).join(', ')}].filter(Boolean)`);
    check('Nomes globais existem', missing.length === 0, missing.join(', '));
    check('Tela inicial à vista, com os botões ligados', await run(`!$('home').hidden && typeof $('goCreate').onclick === 'function' && typeof $('chatForm').onsubmit === 'function'`));
    check('Ícones colocados na carga', await run(`$('chatSend').innerHTML.includes('<svg') && $('openStatsRoom').innerHTML.includes('<svg')`));
    await run(`enterRoom({ id: '1', features: ['chat', 'voice', 'handoff'], members: [{ id: '2', name: 'Ana', sharing: true, version: '1.9.2' }], chat: [{ id: '1', from: '2', name: 'Ana', ts: Date.now(), text: 'oi' }] }, false, '127.0.0.1', 8765)`);
    await sleep(300);
    check('Entra na sala de mentira: lista e chat', await run(`!$('room').hidden && document.querySelectorAll('#members .member').length === 2 && $('chatList').querySelectorAll('.msg').length === 1`));
    await run(`(() => { openStats(); setStatsTab('stream'); })()`);
    check('Estatísticas abrem nas duas abas', await run(`!$('statsDialog').hidden && document.querySelectorAll('#streamRows .stream-card').length === 1`));
    await run(`(() => { setStatsTab('perf'); closeStats(); openVoiceDialog(); })()`);
    check('Voz e atalhos abre', await run(`!$('voiceDialog').hidden`));
    await run(`closeVoiceDialog()`);
    check('Nenhum erro depois de usar', errors.length === 0, errors.join(' | '));
  } catch (e) {
    check('Sem exceção', false, e.message);
  }
  console.log(`${ok} ok, ${bad} falhas`);
  app.exit(bad ? 1 : 0);
});
