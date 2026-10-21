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
  'setPanelOpen', 'setPeopleOpen', 'setStatsTab', 'openStats', 'closeStats', 'showSettingsTab', 'settingsOpenOn', 'voiceSettingsOpen', 'enterRoom', 'leaveRoom', 'nameOf', 'setRadio',
  'openVoiceDialog', 'closeVoiceDialog', 'startCapture', 'accelFromEvent', 'gateThreshold', 'onPttKey', 'renderSpeaking',
  'startSpeakLoop', 'updateDuck', 'setFocus', 'setIncomingVideo', 'renderUpdateBanner', 'scrollChatToEnd', 'markRead',
  'closePersonCard', 'send', 'toast', 'show', 'personColor', 'speakBars', 'renderMembers', 'onceSupport', 'setSessionWatch', 'enterSession', 'onChatPaste', 'FileMetadata', 'withoutMetadata', 'renderMicList', 'fotos', 'paintAvatar', 'setMyPhoto', 'onPhotoSignal', 'appSounds', 'syncMuteSound',
];

app.whenReady().then(async () => {
  for (const [channel, value] of Object.entries({
    'get-ips': [], 'razze-pending-invite': '', 'razze-presence-state': { friends: [], networks: [], rooms: [], error: '' }, 'get-version': '1.9.2', 'github-check': { ok: false }, 'set-priority': true, 'stats-start': true, 'stats-stop': true,
    'stop-app-audio': true, 'stop-server': true, 'room-keys': true, 'sessoes-observar': true, 'capture-exclude': true, 'ptt': true,
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
    check('Barra da chamada: fora da voz não aparece', await run(`(() => { callbarAcordar(); return !$('callbar').classList.contains('on'); })()`));
    check('Barra da chamada: na voz aparece, com microfone, fone, transmitir e sair, e esses somem do painel; ao vivo, o monitor vira parar', await run(`(() => {
      const antes = voice.session; voice.session = 'teste';
      $('voiceMute').hidden = $('voiceDeafen').hidden = false;
      renderCallbar(); callbarAcordar();
      const r = $('callbar').classList.contains('on') && document.body.classList.contains('callbar-on')
        && ['cbMic', 'cbDeafen', 'cbShare', 'cbLeave'].every((id) => $(id).getClientRects().length > 0)
        && $('voiceMute').matches('.callbar-on .seu-sinal #voiceMute') && $('cbShare').title.includes('transmitir')
        && $('cbSwap').hidden && $('cbAudience').hidden;
      // Ao vivo: o mesmo monitor vira o Parar (com o monitor cortado para o hover) e aparecem trocar e quem pode assistir
      const sharing = state.sharing; state.sharing = state.sharing || {}; renderCallbar();
      const live = $('cbShare').classList.contains('ao-vivo') && $('cbShare').title === 'Parar de transmitir'
        && $('cbShare').querySelectorAll('svg').length === 2 && !$('cbSwap').hidden && !$('cbAudience').hidden;
      state.sharing = sharing;
      voice.session = antes; setCallbar(false); renderCallbar();
      return r && live && !$('cbShare').classList.contains('ao-vivo') && !document.body.classList.contains('callbar-on');
    })()`));
    check('Falando com o microfone desligado: aviso aparece e some ao ligar', await run(`(() => {
      const [sessao, mudo, mic] = [voice.session, voice.muted, micNow];
      voice.session = 'teste'; voice.muted = true; micNow = { porta: { open: true } };
      avisoMutado(1000); const cedo = $('mutadoAviso').hidden;
      avisoMutado(1600); const viu = !$('mutadoAviso').hidden;
      voice.muted = false; avisoMutado(1700); const sumiu = $('mutadoAviso').hidden;
      voice.muted = true; $('mutadoFechar').click(); avisoMutado(2000); avisoMutado(2600); const calado = $('mutadoAviso').hidden;
      voice.muted = false; avisoMutado(2700); voice.muted = true; avisoMutado(2800); avisoMutado(3400); const volta = !$('mutadoAviso').hidden;
      voice.session = sessao; voice.muted = mudo; micNow = mic; mutadoFala.desde = 0; mutadoFala.ate = 0; mutadoFala.calado = false;
      $('mutadoAviso').hidden = true;
      return cedo && viu && sumiu && calado && volta;
    })()`));
    await run(`(() => { openStats(); $('statsTabStream').click(); })()`);
    check('Estatísticas abrem nas configurações, nas duas abas', await run(`!$('generalSettingsDialog').hidden && settingsOpenOn('stats') && !$('settingsPanel-stats').hidden && !$('statsStream').hidden && document.querySelectorAll('#streamRows .stream-card').length === 1`));
    await run(`(() => { $('statsTabPerf').click(); openVoiceDialog(); })()`);
    check('Voz abre no mesmo lugar, sem barra de abas', await run(`voiceSettingsOpen() && !$('settingsPanel-voice').hidden && $('settingsPanel-stats').hidden && document.querySelector('.settings-tabs').hidden`));
    await run(`document.querySelector('.settings-nav [data-group=atalhos]').click()`);
    check('Atalhos é um grupo à parte', await run(`!$('settingsPanel-shortcuts').hidden && $('settingsPanel-voice').hidden && settingsOpenOn('atalhos')`));
    await run(`document.querySelector('.settings-nav [data-group=transmissao]').click()`);
    check('Transmissão tem o clipe e a prioridade', await run(`!$('settingsPanel-transmissao').hidden && !!$('settingsPanel-transmissao').querySelector('input[name=clipSeconds]') && !!$('settingsPanel-transmissao').querySelector('input[name=priority]')`));
    await run(`document.querySelector('.settings-nav [data-group=privacidade]').click()`);
    check('Privacidade junta atividade e mensagens', await run(`!$('settingsPanel-activity').hidden && $('settingsPanel-activity').contains($('atvSala')) && $('settingsPanel-activity').contains($('dmRetencaoLabel'))`));
    await run(`document.querySelector('.settings-nav [data-group=sons]').click()`);
    check('Grupo de uma aba só esconde as abas do topo', await run(`!$('settingsPanel-sounds').hidden && document.querySelector('.settings-tabs').hidden && !voiceSettingsOpen()`));
    await run(`$('generalSettingsDialog').querySelector('.dialog').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    check('Clicar dentro da janela não fecha', await run(`!$('generalSettingsDialog').hidden`));
    await run(`$('generalSettingsDialog').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    check('Clicar no fundo fecha as configurações', await run(`$('generalSettingsDialog').hidden`));
    check('Nenhum erro depois de usar', errors.length === 0, errors.join(' | '));
  } catch (e) {
    check('Sem exceção', false, e.message);
  }
  console.log(`${ok} ok, ${bad} falhas`);
  app.exit(bad ? 1 : 0);
});
