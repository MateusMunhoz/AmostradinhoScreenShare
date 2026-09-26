// Voz: Ana (host) e Bia entram na voz com um tom contínuo no lugar do microfone. Quem fala, volume por pessoa,
// microfone desligado, bolinhas com o painel recolhido e o chat por cima do jogo.
const { openApp, createRoom, joinRoom, attach, winStyle, check, sleep, run } = require('./ajuda');

// O microfone falso do Chrome só dá bipes (que o filtro de ruído corta); um tom contínuo faz as vezes da voz
const TONE = `(() => { window.tctx = new AudioContext(); const o = tctx.createOscillator(); const g = tctx.createGain(); g.gain.value = 0.3; const dst = tctx.createMediaStreamDestination(); o.connect(g); g.connect(dst); o.start(); voice.media = { getUserMedia: async () => dst.stream }; })()`;
const OVERLAY = 'Chat da sala · Tela P2P';

run('Voz, volume e chat por cima do jogo', 150000, async () => {
  const A = await openApp('vozA', 9481, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18798 });
  const B = await openApp('vozB', 9482, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18798' });
  await B.eval(`localStorage.removeItem('volumes'); volumes = {};`);
  const anaId = await A.eval('state.myId');

  check('Botão "Entrar na voz" na barra', await B.eval(`$('voiceJoin').textContent.includes('Entrar na voz') && !$('voiceDock').classList.contains('active')`));
  await A.eval(TONE);
  await B.eval(TONE);
  await A.eval(`$('voiceJoin').click()`);
  await B.eval(`$('voiceJoin').click()`);
  await B.waitFor(`voice.session && [...voice.peers.values()].some((p) => p.pc.connectionState === 'connected')`, 20000);
  check('Na voz: barra mostra microfone, silenciar vozes e sair', await B.eval(`$('voiceDock').classList.contains('active') && !$('voiceMute').hidden && !$('voiceDeafen').hidden && $('voiceJoin').getAttribute('aria-label') === 'Sair da voz'`));
  await B.waitFor(`mixer.nodes.has('${anaId}')`, 10000);
  check('Voz da Ana passa pelo mixer (volume próprio)', true);
  const row = `[...document.querySelectorAll('#members .member')].find((li) => li.dataset.person === '${anaId}')`;
  check('Lista mostra "na voz" e o botão de volume da Ana', await B.eval(`${row}.textContent.includes('na voz') && !!${row}.querySelector('.vol-btn')`));
  await B.waitFor(`speaking.has('${anaId}')`, 15000);
  check('Quem fala: a Ana aparece falando', await B.eval(`${row}.classList.contains('speaking')`));
  await B.waitFor(`speaking.has(state.myId)`, 15000);
  check('Meu indicador acende quando eu falo', true);

  // Cartão de volume
  await B.eval(`$('peopleBtn').click()`);
  await B.eval(`${row}.querySelector('.vol-btn').click()`);
  await sleep(200);
  check('Cartão abre com Voz (0 a 200%)', await B.eval(`!$('personCard').hidden && $('personCard').querySelector('input[type=range]').max === '200'`));
  await B.eval(`(() => { const i = $('personCard').querySelector('input[type=range]'); i.value = '150'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })()`);
  await sleep(200);
  check('Voz da Ana em 150%: ganho 1,5 e salvo pelo nome', await B.eval(`Math.abs(mixer.nodes.get('${anaId}').gain.gain.value - 1.5) < 0.01 && JSON.parse(localStorage.getItem('volumes')).Ana.voice === 150`));
  check('Botão mostra 150%', await B.eval(`${row}.querySelector('.vol-btn').textContent.includes('150%')`));
  await B.eval(`[...$('personCard').querySelectorAll('button')].find((b) => b.textContent === 'Silenciar para mim').click()`);
  await sleep(200);
  check('Silenciar para mim: ganho 0 e "mudo"', await B.eval(`mixer.nodes.get('${anaId}').gain.gain.value === 0 && ${row}.querySelector('.vol-btn').textContent.includes('mudo')`));
  await B.eval(`[...$('personCard').querySelectorAll('button')].find((b) => b.textContent === 'Voltar para 100%').click()`);
  await sleep(200);
  check('Voltar para 100%', await B.eval(`mixer.nodes.get('${anaId}').gain.gain.value === 1 && !localStorage.getItem('volumes').includes('Ana')`));
  await B.eval(`closePersonCard(); setPeopleOpen(false)`);

  // Microfone desligado
  await A.eval(`$('voiceMute').click()`);
  await B.waitFor(`voice.members.get('${anaId}').muted`, 5000);
  await sleep(600);
  check('Ana desligou o microfone: ícone e sem "falando"', await B.eval(`!!${row}.querySelector('.mic-off-icon') && !speaking.has('${anaId}')`));
  await A.eval(`$('voiceMute').click()`);

  // Painel recolhido: bolinhas de quem está na voz na barra
  await B.eval(`setPanelOpen(false)`);
  await sleep(200);
  check('Painel recolhido: a Ana aparece na barra', await B.eval(`!$('voiceAvatars').hidden && $('voiceAvatars').querySelectorAll('.voice-avatar').length === 1`));
  await B.eval(`$('voiceAvatars').querySelector('.voice-avatar').click()`);
  await sleep(200);
  check('Clicar na bolinha abre o volume', await B.eval(`!$('personCard').hidden && $('personCard').dataset.for === '${anaId}'`));
  await B.eval(`closePersonCard(); setPanelOpen(true)`);

  // Chat por cima do jogo
  await B.eval(`$('overlayToggle').click()`);
  await sleep(1200);
  let st = winStyle(OVERLAY);
  check('Chat por cima do jogo abre, por cima e no modo de ajuste', st && st.topmost && !st.transparent && (await B.eval(`overlay.edit`)));
  await A.eval(`(() => { $('chatInput').value = 'mensagem para o overlay'; sendChat(); })()`);
  await sleep(700);
  check('Mensagem nova aparece no chat por cima do jogo', await B.eval(`overlay.p.list.textContent.includes('mensagem para o overlay')`));
  const O = await attach(9482, (t) => t.type === 'page' && t.url.startsWith('about:'));
  await O.shot('chat-por-cima.png');
  await B.eval(`window.api.pipSetEdit(false)`);
  await sleep(700);
  st = winStyle(OVERLAY);
  check('Travado: clique atravessa e sem foco', st && st.transparent && st.noActivate);
  check('Travado: sem borda nem campo de texto', await B.eval(`overlay.p.form.style.display === 'none' && overlay.p.head.style.display === 'none'`));
  await B.eval(`overlay.p.input.value = 'resposta pelo overlay'; window.api.pipSetEdit(true)`);
  await sleep(500);
  await B.eval(`overlay.p.form.requestSubmit()`);
  await A.waitFor(`[...$('chatList').querySelectorAll('.msg-text')].some((p) => p.textContent === 'resposta pelo overlay')`, 5000);
  check('Responder pelo chat por cima do jogo', true);
  await B.eval(`$('overlayToggle').click()`);
  await sleep(800);
  check('Botão fecha o chat por cima do jogo', winStyle(OVERLAY) === null && (await B.eval(`!overlay.p`)));

  await B.eval(`$('voiceJoin').click()`);
  await sleep(300);
  check('Sair da voz volta ao botão "Entrar na voz"', await B.eval(`!voice.session && $('voiceJoin').textContent.includes('Entrar na voz') && !mixer.localNode`));
});
