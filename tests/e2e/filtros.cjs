// Microfone (IA, eco, sensibilidade, ouvir a própria voz), atenuação, apertar para falar, atalhos, painel e paleta, numa janela
// invisível: não abre nada na tela nem tira o foco (dá para rodar com um jogo aberto).
// Roda com: npx electron tests/e2e/filtros.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const APP = path.resolve(__dirname, '..', '..');
const OUT = path.join(os.tmpdir(), 'tela-p2p-e2e', 'fotos');
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', path.join(os.tmpdir(), 'tela-p2p-e2e', 'perfil-filtros'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'ChromeWideEchoCancellation');
console.log('\n== Microfone, atalhos e painel (janela invisível)');
let ok = 0, bad = 0;
const check = (n, c, x = '') => { c ? ok++ : bad++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${x !== '' ? '  (' + x + ')' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('TEMPO ESGOTADO'); app.exit(1); }, 60000);

app.whenReady().then(async () => {
  const ptt = [];
  for (const [channel, value] of Object.entries({
    'get-ips': [], 'razze-pending-invite': '', 'get-version': '1.8.6', 'github-check': { ok: false }, 'set-priority': true, 'stats-start': true, 'stats-stop': true,
    'stop-app-audio': true, 'stop-server': true, 'room-keys': true, 'sessoes-observar': true, 'capture-exclude': true,
    'get-shortcuts': { compose: 'CommandOrControl+Enter', mute: 'CommandOrControl+Shift+M', edit: 'CommandOrControl+Shift+E', hideChat: 'CommandOrControl+Shift+O' },
  })) ipcMain.handle(channel, () => value);
  ipcMain.handle('ptt', (_e, vk) => { ptt.push(vk); return true; });
  ipcMain.handle('noise-wasm', (_e, simd) => fs.readFileSync(path.join(APP, 'vendor', 'noise', simd ? 'rnnoise_simd.wasm' : 'rnnoise.wasm')));
  const win = new BrowserWindow({ show: false, width: 1200, height: 780, webPreferences: { preload: path.join(APP, 'preload.js'), backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errors.push(message); });
  const run = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.join(APP, 'index.html'));
    await run(`localStorage.removeItem('vozConfig'); Object.assign(voiceCfg, { ns: 'ia', echo: true, mode: 'voz', pttVk: 0, pttLabel: '' })`);
    // Sem vermelho na paleta
    const colors = await run(`(() => { const cs = getComputedStyle(document.documentElement); return [cs.getPropertyValue('--live').trim(), cs.getPropertyValue('--live-fill').trim()]; })()`);
    check('Tema lan house: "ao vivo" e "transmitindo" no amarelo', colors.every((c) => c.toLowerCase() === '#d6c45c'), colors.join(' '));
    const theme = await run(`({ bg: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily })`);
    check('Fundo verde-oliva e a fonte do Windows', theme.bg === 'rgb(34, 39, 30)' && theme.font.includes('Segoe UI Variable'), JSON.stringify(theme));

    await run(`enterRoom({ id: '1', features: ['chat', 'voice'], members: [{ id: '2', name: 'Ana', sharing: true, version: '1.8.6' }], chat: [] }, false, '127.0.0.1', 8765)`);
    await run(`voice.join()`);
    await run(`new Promise((r) => { const t = setInterval(() => { if (voice.session) { clearInterval(t); r(); } }, 100); })`);
    const mic = await run(`({ ia: !!(micNow && micNow.node), rate: micNow && micNow.ctx ? micNow.ctx.sampleRate : 0, echo: micNow.raw.getAudioTracks()[0].getSettings().echoCancellation, nsChrome: micNow.raw.getAudioTracks()[0].getSettings().noiseSuppression, sameAsVoice: voice.stream === micNow.out })`);
    check('Supressão com IA: o microfone passa pelo RNNoise a 48 kHz', mic.ia && mic.rate === 48000 && mic.sameAsVoice, JSON.stringify(mic));
    check('Cancelamento de eco ligado e o filtro básico desligado (a IA faz o trabalho)', mic.echo === true && mic.nsChrome === false);
    await sleep(1500);
    const lvl = await run(`mixer.localNode ? mixer.level(mixer.localNode.an) : -1`);
    check('Som sai do RNNoise (medidor recebe o microfone filtrado)', lvl >= 0, lvl.toFixed(4));
    check('Status da lista: "Transmitindo" em amarelo', await run(`(() => { const li = [...document.querySelectorAll('#members .member')].find((l) => l.dataset.person === '2'); return getComputedStyle(li.querySelector('.mstatus')).color; })()`) === 'rgb(214, 196, 92)');
    // Painel: só o chat; pessoas pelo botão
    check('Painel sem a prévia da própria tela e sem a lista à vista', await run(`!document.getElementById('myPreview') && $('peoplePop').hidden && getComputedStyle($('chatTab')).display !== 'none'`));
    check('Botão de pessoas mostra o total (2)', await run(`$('memberCount').textContent === '2' && $('peopleBtn').getAttribute('aria-expanded') === 'false'`));
    await run(`$('peopleBtn').click()`);
    check('Clicar abre a lista com as pessoas e o endereço da sala', await run(`!$('peoplePop').hidden && $('members').querySelectorAll('.member').length === 2 && $('roomAddress').textContent.includes('8765') && $('peopleBtn').getAttribute('aria-expanded') === 'true'`));
    await run(`speaking = new Set(['2']); renderSpeaking()`);
    check('Bolinha verde no botão quando alguém fala', await run(`!$('peopleSpeak').hidden`));
    await sleep(400);
    fs.writeFileSync(path.join(OUT, 'lista-de-pessoas.png'), (await win.webContents.capturePage()).toPNG());
    await run(`speaking = new Set(); renderSpeaking(); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    check('Clicar fora fecha a lista', await run(`$('peoplePop').hidden`));
    // Sensibilidade
    // Um tom contínuo (~-26 dB) entra na cadeia do microfone, no lugar da voz
    await run(`(() => { const o = micNow.ctx.createOscillator(); const g = micNow.ctx.createGain(); g.gain.value = 0.07; o.connect(g); g.connect(micNow.pre); g.connect(micNow.gate); o.start(); window.testTone = o; })()`);
    await run(`voiceCfg.gateAuto = false; voiceCfg.gateDb = 0`);
    await sleep(500);
    const g0 = await run(`({ open: micNow.gateOpen, gain: micNow.gate.gain.value, level: Math.round(micNow.level) })`);
    check('Sensibilidade no máximo (0 dB): microfone fica fechado', !g0.open && g0.gain < 0.05, JSON.stringify(g0));
    await run(`voiceCfg.gateDb = -80`);
    await sleep(1200);
    const g1 = await run(`({ open: micNow.gateOpen, gain: micNow.gate.gain.value, level: Math.round(micNow.level) })`);
    check('Sensibilidade -80 dB: com som, o microfone abre', g1.open && g1.gain > 0.9, JSON.stringify(g1));
    await run(`voiceCfg.gateDb = -10`);
    await sleep(600);
    const g2 = await run(`({ open: micNow.gateOpen, gain: micNow.gate.gain.value, level: Math.round(micNow.level) })`);
    check('Sensibilidade -10 dB: o mesmo som fica abaixo do limite e não passa', !g2.open && g2.gain < 0.05, JSON.stringify(g2));
    await run(`testTone.stop()`);
    await run(`voiceCfg.gateAuto = true`);
    await sleep(300);
    check('Automática: limite entre -72 e -30 dB', await run(`(() => { const t = gateThreshold(micNow); return t >= -72 && t <= -30; })()`), await run(`Math.round(gateThreshold(micNow))`));
    // Atenuação
    await run(`clearInterval(speakTimer); speakTimer = -1; voiceCfg.duck = 60; speaking = new Set(['2']); updateDuck()`); // medidor pausado: quem fala é só o que o teste diz
    await sleep(400);
    const d1 = await run(`duck.factor`);
    check('Atenuação 60%: com a Ana falando, o som das transmissões vai para 40%', Math.abs(d1 - 0.4) < 0.01, d1.toFixed(2));
    await run(`speaking = new Set(); updateDuck()`);
    await sleep(1600);
    const d2 = await run(`({ f: duck.factor, timer: !!duck.timer })`);
    check('Quando para de falar, volta para 100% e o relógio para', d2.f === 1 && !d2.timer, JSON.stringify(d2));
    await run(`voiceCfg.duck = 0; voiceCfg.gateAuto = true; speakTimer = null; startSpeakLoop()`);

    // Trocar para o filtro básico no meio da conversa: a faixa enviada muda, sem sair da voz
    const before = await run(`voice.stream.getAudioTracks()[0].id`);
    await run(`(() => { const r = document.querySelector('input[name="noise"][value="chrome"]'); r.checked = true; r.dispatchEvent(new Event('change')); })()`);
    await sleep(800);
    const after = await run(`({ id: voice.stream.getAudioTracks()[0].id, ia: !!micNow.node, ns: micNow.raw.getAudioTracks()[0].getSettings().noiseSuppression, session: !!voice.session })`);
    check('Trocar para "Básica" no meio da conversa troca o microfone sem sair da voz', after.id !== before && !after.ia && after.ns === true && after.session, JSON.stringify(after));

    // Apertar para falar
    await run(`(() => { const r = document.querySelector('input[name="talkMode"][value="ptt"]'); r.checked = true; r.dispatchEvent(new Event('change')); })()`);
    check('Sem tecla escolhida, já pede a tecla', await run(`!!capturing && capturing.kind === 'ptt'`));
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', keyCode: 86, bubbles: true }))`);
    await sleep(200);
    check('Tecla V escolhida e o teclas.exe pedido com o código 86', (await run(`voiceCfg.pttVk === 86 && voiceCfg.pttLabel === 'V'`)) && ptt.includes(86), JSON.stringify(ptt));
    check('Tecla solta: microfone mudo', await run(`voice.stream.getAudioTracks()[0].enabled === false`));
    check('Barra mostra "Segure V"', await run(`$('voiceMeText').textContent === 'Segure V'`));
    await run(`onPttKey(true)`);
    check('Tecla apertada: microfone abre e as barrinhas acendem', await run(`voice.stream.getAudioTracks()[0].enabled === true && $('voiceMe').classList.contains('ptt-open')`));
    await run(`onPttKey(false)`);
    await sleep(100);
    check('Soltou: continua aberto por 200 ms (não corta a última palavra)', await run(`voice.stream.getAudioTracks()[0].enabled === true`));
    await sleep(250);
    check('Depois fecha', await run(`voice.stream.getAudioTracks()[0].enabled === false`));
    await run(`onPttKey(true); voice.mute()`);
    check('Microfone desligado ganha da tecla', await run(`voice.stream.getAudioTracks()[0].enabled === false`));
    await run(`voice.mute(); onPttKey(false)`);
    // Mouse 4 como tecla de falar
    await run(`startCapture({ kind: 'ptt', btn: $('pttChange') }); window.dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true }))`);
    await sleep(100);
    check('Botão lateral do mouse (Mouse 4) como tecla de falar', (await run(`voiceCfg.pttVk === 5`)) && ptt.includes(5));

    // Janela Voz e atalhos
    await run(`openVoiceDialog()`);
    await sleep(300);
    check('Janela "Voz e atalhos" com 4 atalhos', await run(`!$('voiceDialog').hidden && $('shortcutRows').querySelectorAll('.vd-row').length === 4 && $('shortcutRows').textContent.includes('Ctrl+Enter')`));
    await sleep(1200);
    fs.writeFileSync(path.join(OUT, 'voz-e-atalhos.png'), (await win.webContents.capturePage()).toPNG());
    check('Atalho sem Ctrl/Alt é recusado', await run(`(() => { const a = accelFromEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', shiftKey: true })); return !a.strong && !a.fkey; })()`));
    check('Ctrl+Alt+K vira CommandOrControl+Alt+K', await run(`accelFromEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', ctrlKey: true, altKey: true })).accel === 'CommandOrControl+Alt+K'`));

    // Ouvir a própria voz, na voz: usa o mesmo microfone da conversa e o som chega na saída
    await run(`$('micTestBtn').click()`);
    await sleep(300);
    const t1 = await run(`({ on: micTest.on, same: micTest.mic === micNow, tap: !!micTest.tap, own: !!micTest.own, txt: $('micTestBtn').textContent, pressed: $('micTestBtn').getAttribute('aria-pressed') })`);
    check('Ouvir minha voz, na voz: toca o microfone da conversa (sem abrir outro)', t1.on && t1.same && t1.tap && !t1.own && t1.txt === 'Parar de ouvir' && t1.pressed === 'true', JSON.stringify(t1));
    // Um tom entra na cadeia; com a sensibilidade toda aberta, ele tem que sair pelo teste
    await run(`(() => { voiceCfg.gateAuto = false; voiceCfg.gateDb = -80; const o = micNow.ctx.createOscillator(); const g = micNow.ctx.createGain(); g.gain.value = 0.07; o.connect(g); g.connect(micNow.pre); g.connect(micNow.gate); o.start(); window.testTone = o; window.testAn = micNow.ctx.createAnalyser(); micTest.tap.connect(testAn); })()`);
    await sleep(1200);
    const heard = await run(`mixer.level(testAn)`);
    check('O som do microfone (depois da sensibilidade) chega na saída', heard > 0.01, heard.toFixed(4));
    await run(`testTone.stop(); voiceCfg.gateAuto = true`);
    // Trocar o filtro no meio do teste: o teste passa para o microfone novo
    await run(`(() => { const r = document.querySelector('input[name="noise"][value="ia"]'); r.checked = true; r.dispatchEvent(new Event('change')); })()`);
    await sleep(1000);
    const t2 = await run(`({ on: micTest.on, same: micTest.mic === micNow, tap: !!micTest.tap, ia: !!micNow.node })`);
    check('Trocar o filtro durante o teste: continua ouvindo, já no microfone novo', t2.on && t2.same && t2.tap && t2.ia, JSON.stringify(t2));
    await run(`closeVoiceDialog()`);
    const t3 = await run(`({ on: micTest.on, tap: !!micTest.tap, txt: $('micTestBtn').textContent, session: !!voice.session, mic: !!micNow })`);
    check('Fechar a janela para o teste e a voz continua', !t3.on && !t3.tap && t3.txt === 'Ouvir minha voz' && t3.session && t3.mic, JSON.stringify(t3));

    // Sair da voz fecha o microfone e desliga a tecla de falar
    await run(`voice.leave()`);
    await sleep(300);
    check('Sair da voz fecha o microfone e o apertar para falar', (await run(`micNow === null && !mixer.localNode`)) && ptt[ptt.length - 1] === 0, JSON.stringify(ptt));

    // Ouvir a própria voz fora da voz: abre um microfone só para o teste, sem entrar na voz
    const untilOwn = `new Promise((r) => { const t = setInterval(() => { if (micTest.own && micTest.tap) { clearInterval(t); r(); } }, 50); })`;
    await run(`openVoiceDialog()`);
    check('Fora da voz, o medidor fica escondido até testar', await run(`$('micMeterBox').hidden && $('gateHint').textContent.includes('Ouvir minha voz')`));
    await run(`$('micTestBtn').click()`);
    await run(untilOwn);
    const o1 = await run(`({ own: micTest.mic === micTest.own, voiceMic: micNow, session: voice.session, meter: !$('micMeterBox').hidden, live: micTest.own.raw.getAudioTracks()[0].readyState })`);
    check('Fora da voz: abre um microfone só do teste, sem entrar na voz, e mostra o medidor', o1.own && o1.voiceMic === null && o1.session === '' && o1.meter && o1.live === 'live', JSON.stringify(o1));
    // A IA apaga o bipe do microfone falso: um tom (~-26 dB) entra direto no medidor do microfone do teste
    await run(`(() => { const m = micTest.own; const o = m.ctx.createOscillator(); const g = m.ctx.createGain(); g.gain.value = 0.07; o.connect(g); g.connect(m.pre); o.start(); window.testTone = o; })()`);
    await sleep(800);
    const lvlOwn = await run(`Math.round(micTest.own.level)`);
    check('O medidor mexe com o microfone do teste', lvlOwn > -40, lvlOwn);
    await run(`testTone.stop()`);
    // Trocar o filtro fora da voz: o microfone do teste abre de novo com o filtro novo
    await run(`window.oldOwn = micTest.own; (() => { const r = document.querySelector('input[name="noise"][value="off"]'); r.checked = true; r.dispatchEvent(new Event('change')); })()`);
    await run(`new Promise((r) => { const t = setInterval(() => { if (micTest.own && micTest.own !== oldOwn && micTest.tap) { clearInterval(t); r(); } }, 50); })`);
    check('Trocar o filtro fora da voz reabre o microfone do teste (o antigo fecha)', await run(`!micTest.own.node && oldOwn.raw.getAudioTracks()[0].readyState === 'ended'`));
    // Entrar na voz durante o teste: passa a ouvir o microfone da conversa e fecha o do teste
    await run(`window.oldOwn = micTest.own; voice.join()`);
    await run(`new Promise((r) => { const t = setInterval(() => { if (voice.session && micTest.mic === micNow && micTest.tap) { clearInterval(t); r(); } }, 50); })`);
    check('Entrar na voz durante o teste: um microfone só (o do teste fecha)', await run(`!micTest.own && oldOwn.raw.getAudioTracks()[0].readyState === 'ended'`));
    // Sair da voz durante o teste: volta a abrir um microfone só do teste
    await run(`voice.leave()`);
    await run(untilOwn);
    check('Sair da voz durante o teste: continua ouvindo, com um microfone só do teste', await run(`micTest.on && micNow === null && micTest.mic === micTest.own`));
    await run(`window.oldOwn = micTest.own; closeVoiceDialog()`);
    check('Fechar a janela para o teste e fecha o microfone do teste', await run(`!micTest.on && !micTest.own && oldOwn.raw.getAudioTracks()[0].readyState === 'ended'`));
    await run(`(() => { const r = document.querySelector('input[name="noise"][value="ia"]'); r.checked = true; r.dispatchEvent(new Event('change')); })()`);
    await run(`leaveRoom()`);
    check('Sem erros no console', errors.filter((e) => !/Autofill|DevTools/.test(e)).length === 0, errors.join(' | ').slice(0, 300));
  } catch (err) { bad++; console.log('FALHOU:', err.message); }
  console.log(`${ok} ok, ${bad} falhas`);
  app.exit(bad ? 1 : 0);
});
