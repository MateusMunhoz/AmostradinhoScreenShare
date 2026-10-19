// Sala nova (docs/spec/sala-nova.md): nome da sala no topo do painel (com o menu da sala),
// abas Voz, Chat e Pessoas no painel, o cartão Seu sinal fixo embaixo dele (e na barrinha com o painel recolhido) e a
// barrinha da direita com as coisas do app, Convidar e Sair.
const { openApp, createRoom, joinRoom, check, sleep, run, FAKE } = require('./ajuda');
FAKE.push('--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'); // para a foto
const TONE = `(() => { window.tctx = new AudioContext(); const o = tctx.createOscillator(); const dst = tctx.createMediaStreamDestination(); o.connect(dst); o.start(); voice.media = { getUserMedia: async () => dst.stream }; })()`;
const visivel = (id) => `(() => { const e = $('${id}'); return !!e && e.getClientRects().length > 0; })()`;
// Os botões de ids, à vista e dentro da caixa box
const dentro = (ids, box) => `${JSON.stringify([].concat(ids))}.every((id) => { const a = $(id).getBoundingClientRect(), b = $('${box}').getBoundingClientRect();
  return a.width > 0 && a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1; })`;

run('Sala: cabeçalho, abas e Seu sinal', 120000, async () => {
  const A = await openApp('barraA', 9551, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18841 });
  const B = await openApp('barraB', 9552, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18841' });
  await A.waitFor(`state.members.size === 1`, 10000);

  // Cabeçalho
  check('Cabeçalho: "Sua sala" para quem criou, "Sala de Ana" para quem entrou, sem repetir quantas pessoas (está na aba)',
    await A.eval(`$('roomHeadTitle').textContent === 'Sua sala' && !$('roomHead').textContent.includes('pessoas') && !!$('roomMenuRede').textContent`)
    && await B.eval(`$('roomHeadTitle').textContent === 'Sala de Ana'`));
  check('Convidar e Sair na barrinha, à vista', await B.eval(dentro(['dockAddr', 'leaveBtn'], 'workspaceNav')));
  check('O nome da sala fica no topo do painel, em cima das abas, e o palco começa no topo',
    await B.eval(`${dentro('roomMenuBtn', 'workspacePanes')} && $('roomHead').getBoundingClientRect().bottom <= $('paneTabs').getBoundingClientRect().top + 1
      && $('streamArea').getBoundingClientRect().top - $('workspacePanes').getBoundingClientRect().top < 20`));
  await B.eval(`$('roomMenuBtn').click()`);
  await sleep(200);
  check('O nome abre o menu da sala, com o endereço, desempenho e sair',
    await B.eval(`!$('roomMenu').hidden && $('roomMenuBtn').getAttribute('aria-expanded') === 'true' && $('roomAddress').textContent.includes('18841')
      && !$('navStreams') && ['openStatsRoom', 'roomMenuLeave'].every((id) => $('roomMenu').contains($(id)))`));
  await B.eval(`$('roomMenu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Esc fecha o menu da sala', await B.eval(`$('roomMenu').hidden && document.activeElement === $('roomMenuBtn')`));
  await B.eval(`$('roomMenuBtn').click()`);
  await B.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 400, button: 'left', clickCount: 1 });
  await B.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 400, button: 'left', clickCount: 1 });
  check('Clicar fora fecha o menu da sala', await B.eval(`$('roomMenu').hidden`));

  // Barrinha: as coisas do app, Convidar e, por último, Sair
  const rail = await B.eval(`[...$('workspaceNav').children].filter((e) => e.getClientRects().length).map((e) => e.id || e.className)`);
  check('Barrinha: perfil, Início, Convidar, chat por cima do jogo, modo gamer, feedback, engrenagem e Sair',
    rail.join(' ') === 'navProfile nav-sep nav-space dockHome dockAddr nav-sep overlayToggle navGamer navFeedback navSettings nav-sep rail-leave-sep leaveBtn', rail.join(' '));

  // Abas: com uma aberta, clicar na outra abre as duas; com as duas, clicar numa fecha essa
  await B.eval(`setPainelSala({ aba: 'voz', juntos: false, recolhido: false })`);
  await sleep(200);
  check('Aba Voz: só a voz', await B.eval(`!$('voicePane').hidden && $('chatTab').hidden && $('peoplePop').hidden && $('navVoice').getAttribute('aria-pressed') === 'true'`));
  await B.eval(`$('navChat').click()`);
  await sleep(300);
  check('Voz aberta + clicar em Chat: os dois lado a lado, com a divisória', await B.eval(`!$('voicePane').hidden && !$('chatTab').hidden && getComputedStyle(document.querySelector('.pane-split')).display !== 'none'`));
  await B.eval(`$('navVoice').click()`);
  await sleep(200);
  check('Clicar em Voz de novo fecha a Voz: só o chat', await B.eval(`$('voicePane').hidden && !$('chatTab').hidden && $('peoplePop').hidden && $('navChat').getAttribute('aria-pressed') === 'true'`));
  await B.eval(`$('peopleBtn').click()`);
  await sleep(200);
  check('Aba Pessoas: a lista no lugar do chat e da voz', await B.eval(`$('voicePane').hidden && $('chatTab').hidden && !$('peoplePop').hidden && $('members').querySelectorAll('.member').length === 2`));
  check('Seu sinal fica embaixo em qualquer aba, com Entrar na voz e Transmitir', await B.eval(`${visivel('seuSinal')} && ${dentro(['voiceJoin', 'shareBtn'], 'seuSinal')}`));
  await B.eval(`$('navChat').click()`);
  await sleep(200);
  check('De Pessoas, clicar em Chat abre só o chat', await B.eval(`$('voicePane').hidden && !$('chatTab').hidden && $('peoplePop').hidden`));
  await B.eval(`(() => { $('navVoice').focus(); $('paneTabs').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); })()`);
  check('Setas levam o foco para a outra aba', await B.eval(`document.activeElement === $('navChat')`));
  await B.shot('sala-abas.png');

  // Voz pelo cartão
  await A.eval(TONE); await B.eval(TONE);
  await A.eval(`$('voiceJoin').click()`); await B.eval(`$('voiceJoin').click()`);
  await B.waitFor(`voice.session && voice.members.get([...state.members.keys()][0])?.session`, 15000);
  await sleep(300);
  check('Na voz: microfone, fone, sair e Voz e atalhos no cartão, e em que canal você está',
    await B.eval(`${dentro(['voiceMute', 'voiceDeafen', 'voiceJoin', 'voiceSettingsBtn'], 'seuSinal')}`));
  await B.shot('sala-na-voz.png');

  // Recolhido: a voz vai para a barrinha
  await B.eval(`$('paneRecolher').click()`);
  await sleep(300);
  check('Painel recolhido: o palco vai até a barrinha e a voz fica nela', await B.eval(`$('workspacePanes').hidden && ${visivel('seuSinalMini')} && ${visivel('miniMute')} && ${visivel('miniDeafen')}
    && innerWidth - $('streamArea').getBoundingClientRect().right < 100`));
  await B.eval(`$('miniMute').click()`);
  await sleep(200);
  check('O microfone da barrinha desliga o microfone de verdade', await B.eval(`voice.muted && $('miniMute').getAttribute('aria-pressed') === 'true'`));
  await B.eval(`$('miniMute').click()`);
  await B.shot('sala-recolhida.png');
  await B.eval(`$('paneExpand').click()`);
  await sleep(200);
  check('Abrir de novo pela barrinha', await B.eval(`!$('workspacePanes').hidden && $('seuSinalMini').hidden`));
  await B.eval(`$('dockHome').click()`);
  await sleep(200);
  check('No Início, o painel vai sozinho para a barrinha', await B.eval(`$('workspacePanes').hidden && ${visivel('seuSinalMini')} && ${visivel('leaveBtn')}`));
  await B.eval(`$('navBackToRoom').click()`);
  await sleep(200);
  check('De volta à sala, o painel volta aberto', await B.eval(`!$('room').hidden && !$('workspacePanes').hidden && $('seuSinalMini').hidden`));

  // Palco vazio: quem transmite, com o Assistir
  await A.eval(`(() => { navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false });
    $('soundOn').checked = false; setRadio('encodeMode', 'per'); state.selectedSource = 'teste'; return startSharing(); })()`);
  await A.waitFor(`state.sharing && !$('liveChip').hidden`, 15000);
  check('Transmitindo: o bloco Ao vivo fica no cartão, no lugar do Transmitir', await A.eval(`${dentro('liveChip', 'seuSinal')} && $('shareBtn').getClientRects().length === 0`));
  await B.waitFor(`!$('emptyLive').hidden`, 10000);
  check('Palco vazio mostra "Assistir Ana"', await B.eval(`[...$('emptyLive').children].some((b) => b.textContent === 'Assistir Ana')`));
  await B.eval(`$('emptyLive').querySelector('button').click()`);
  await B.waitFor(`state.in.size === 1`, 10000);
  check('O Assistir do palco abre a tela', true);

  // Janela mínima e fontes largas: nada vaza do cabeçalho nem do cartão, e a barrinha cabe
  await A.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 560, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  for (const font of [null, 'cascadia', 'verdana']) {
    if (font) {
      await A.eval(`(() => { appPreferences.font = { ...appPreferences.font, family: '${font}' }; applyAppTheme(); })()`);
      await sleep(400);
    }
    const r = await A.eval(`(() => { const h = $('roomHead'), s = $('seuSinal'), n = $('workspaceNav');
      return { cabecalho: h.scrollWidth <= h.clientWidth + 1, cartao: s.scrollWidth <= s.clientWidth + 1, barrinha: n.scrollWidth <= n.clientWidth + 1,
        nome: $('roomHeadTitle').getBoundingClientRect().width > 20, etapas: h.className }; })()`);
    check(`Janela mínima${font ? `, fonte ${font}` : ''}: cabeçalho, cartão e barrinha cabem, e o nome da sala aparece`, r.cabecalho && r.cartao && r.barrinha && r.nome, JSON.stringify(r));
  }
  await A.shot('sala-minima.png');
});
