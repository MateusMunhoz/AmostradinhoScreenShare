// Barra de baixo numa linha só: Transmitir, a voz (com as pessoas), e à direita Convidar
// e Sair (separado). Convidar copia o endereço da sala.
const { openApp, createRoom, joinRoom, check, sleep, run, FAKE } = require('./ajuda');
FAKE.push('--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'); // para a foto
const TONE = `(() => { window.tctx = new AudioContext(); const o = tctx.createOscillator(); const dst = tctx.createMediaStreamDestination(); o.connect(dst); o.start(); voice.media = { getUserMedia: async () => dst.stream }; })()`;
const ROW = `(() => { const d = document.querySelector('.dock'); const vis = [...d.children].filter((e) => !e.hidden && e.offsetParent && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
  const tops = new Set(vis.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)));
  return { height: Math.round(d.getBoundingClientRect().height), linhas: tops.size, ordem: vis.map((e) => e.id || e.className.split(' ')[0]) }; })()`;

run('Barra de baixo numa linha', 90000, async () => {
  const A = await openApp('barraA', 9551, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18841 });
  const B = await openApp('barraB', 9552, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18841' });
  let r = await A.eval(ROW);
  check('Fora da voz: uma linha só', r.linhas === 1 && r.height <= 62, JSON.stringify(r));
  const ordem = r.ordem.join(' ');
  check('Ordem: Transmitir e a voz (Convidar, chat e estatísticas fora da barra)', /^shareBtn voiceDock/.test(ordem) && !ordem.includes('dockAddr'), ordem);

  await A.eval(TONE); await B.eval(TONE);
  await A.eval(`$('voiceJoin').click()`); await B.eval(`$('voiceJoin').click()`);
  await A.waitFor(`voice.session && voice.members.get([...state.members.keys()][0])?.session`, 15000);
  await A.eval(`setPanelOpen(false)`);
  await sleep(500);
  r = await A.eval(ROW);
  check('Na voz, com as pessoas na barra: continua numa linha', r.linhas === 1 && r.height <= 62 && await A.eval(`!$('voiceAvatars').hidden`), JSON.stringify(r));
  await A.eval(`(() => { navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false });
    $('soundOn').checked = false; setRadio('encodeMode', 'per'); state.selectedSource = 'teste'; return startSharing(); })()`);
  await A.waitFor(`state.sharing && !$('liveChip').hidden`, 15000);
  await sleep(500);
  r = await A.eval(ROW);
  const FITS = `(() => { const d = document.querySelector('.dock'); const b = d.getBoundingClientRect();
    const blocos = [...d.children].filter((x) => x.offsetParent && !x.matches('.dock-spacer') && x.getBoundingClientRect().width > 0).map((x) => x.getBoundingClientRect());
    const dentro = blocos.every((r) => r.right <= b.right + 1 && r.left >= b.left - 1);
    const sobrepoe = blocos.some((r, i) => blocos.some((q, j) => j > i && r.left < q.right - 1 && q.left < r.right - 1));
    return { cabe: dentro && !sobrepoe, etapas: [...d.classList].filter((c) => c.startsWith('tight')).join(' ') || 'nenhuma' }; })()`;
  let f = await A.eval(FITS);
  check('Transmitindo e na voz: numa linha, nada vaza nem fica por cima', r.linhas === 1 && f.cabe, `etapas: ${f.etapas}`);
  check('Os botões de microfone continuam à vista', await A.eval(`['voiceMute', 'voiceDeafen', 'stopShareBtn'].every((id) => { const e = $(id); const r = e.getBoundingClientRect(); const d = document.querySelector('.dock').getBoundingClientRect(); return r.width > 0 && r.right <= d.right + 1; })`));
  await A.shot('barra.png');

  // Barrinha da direita: em pé na borda, só com os ícones; chat e voz ficam ao lado dela, num bloco só
  const rail = await A.eval(`(() => { const n = $('workspaceNav').getBoundingClientRect(), p = $('workspacePanes').getBoundingClientRect();
    return { direita: Math.round(innerWidth - n.right), largura: Math.round(n.width), alto: Math.round(n.height), folga: Math.round(n.left - p.right),
      gap: getComputedStyle($('workspacePanes')).rowGap, texto: $('navChat').querySelector('.nav-icon + span').offsetWidth }; })()`);
  check('Barrinha na borda direita, só com os ícones, e os painéis ao lado dela num bloco', rail.direita === 0 && rail.largura <= 56 && rail.alto > rail.largura * 5
    && rail.folga >= 8 && rail.folga <= 24 && rail.gap === '0px' && rail.texto === 0, JSON.stringify(rail));
  const ordemRail = await A.eval(`[...$('workspaceNav').children].filter((e) => e.getClientRects().length).map((e) => e.id || e.className)`);
  check('Barrinha: perfil em cima; pessoas, Chat, Voz e Transmissão separados; Início, o chat por cima do jogo, o modo gamer, Voz e atalhos, a engrenagem e, por último, Sair no pé', ordemRail.join(' ') === 'navProfile nav-sep peopleBtn navChat navVoice navStreams nav-space dockHome nav-sep overlayToggle navGamer voiceSettingsBtn navSettings nav-sep rail-leave-sep leaveBtn'
    && await A.eval(`$('leaveBtn').getBoundingClientRect().bottom >= $('workspaceNav').getBoundingClientRect().bottom - 20`), ordemRail.join(' '));
  const alturaInicio = await A.eval(`Math.round($('dockHome').getBoundingClientRect().top)`);
  await A.eval(`$('dockHome').click()`);
  await sleep(300);
  check('No menu, com a sala aberta: os botões da sala continuam, e o Voltar fica na altura do Início', await A.eval(`!$('navBackToRoom').hidden && $('dockHome').hidden && !$('leaveBtn').hidden && !$('navChat').hidden && !$('peopleBtn').hidden && !$('chatTab').hidden && Math.round($('navBackToRoom').getBoundingClientRect().top) === ${alturaInicio}`)
    && await A.eval(`(() => { $('navBackToRoom').click(); return !$('room').hidden && $('navBackToRoom').hidden && !$('dockHome').hidden; })()`));
  check('O mapa de conexões saiu da barra (mora em Configurações › Rede)', await A.eval(`!$('navConnectionMap') && $('settingsPanel-network').contains($('connectionMap'))`));

  // Clique de mouse de verdade (o .click() por código passa até por cima do que não recebe clique)
  const mouse = async (sel) => {
    const c = await A.eval(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await A.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 });
  };
  // Todos os painéis fechados: a barrinha continua, e as telas vão até ela
  await A.eval(`(() => { workspaceViews.voice = false; saveWorkspaceViews(); setPanelOpen(false); })()`);
  await sleep(300);
  const T = `(() => { const a = $('streamArea').getBoundingClientRect(); return { sobra: Math.round(innerWidth - a.right), nav: getComputedStyle($('workspaceNav')).display, paineis: !$('workspacePanes').hidden }; })()`;
  let t = await A.eval(T);
  check('Painéis fechados: a barrinha continua, e as telas vão até ela', t.nav !== 'none' && !t.paineis && t.sobra <= 100, JSON.stringify(t));
  await A.shot('barra-recolhida.png');
  await mouse('#navVoice');
  await sleep(400);
  check('O ícone da voz abre o painel ao lado da barrinha, se desdobrando', await A.eval(`workspaceViews.voice && !$('voicePane').hidden && getComputedStyle($('voicePane')).animationName === 'pane-expand'`));
  await mouse('#navChat');
  await sleep(400);
  check('O ícone do chat abre o chat em cima da voz', await A.eval(`workspaceViews.chat && !$('chatTab').hidden && $('chatTab').getBoundingClientRect().bottom <= $('voicePane').getBoundingClientRect().top + 1`));
  await A.shot('barra-aberta.png');

  // Tela larga (1920): tudo aparece, com os textos
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1040, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  f = await A.eval(FITS);
  check('Tela de 1920: cabe tudo, com "ninguém assistindo", "Na voz" e "Convidar"', f.cabe && f.etapas === 'nenhuma' && await A.eval(`$('liveText').offsetWidth > 0 && $('voiceMeText').offsetWidth > 0`), `etapas: ${f.etapas}`);
  await A.shot('barra-larga.png');

  // Janela no tamanho mínimo (820 x 560), transmitindo e na voz, com chat e voz abertos: o que não cabe vai
  // para o menu da setinha ^, e cada item do menu aperta o botão de verdade
  await A.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 560, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  f = await A.eval(FITS);
  const menu = await A.eval(`(() => { $('dockMore').click(); return [...$('dockMoreMenu').children].map((b) => b.textContent); })()`);
  check('Janela mínima: nada vaza da barra, e o que sobra está no menu', f.cabe && !(await A.eval(`$('dockMoreWrap').hidden`)) && menu.length > 0, `menu: ${menu.join(' | ')}`);
  await A.shot('barra-minima-menu.png');
  const statsItem = await A.eval(`[...$('dockMoreMenu').children].findIndex((b) => b.textContent === 'Estatísticas')`);
  if (statsItem >= 0) {
    await A.eval(`$('dockMoreMenu').children[${statsItem}].click()`);
    await sleep(300);
    check('O item do menu abre as estatísticas e fecha o menu', await A.eval(`settingsOpenOn('stats') && $('dockMoreMenu').hidden`));
    await A.eval(`closeGeneralSettings()`);
  }
  // Com as fontes mais largas (Cascadia Code, monoespaçada, e Verdana), a barrinha da direita continua com o perfil
  // e a engrenagem dentro
  for (const font of [null, 'cascadia', 'verdana']) {
    if (font) {
      await A.eval(`(() => { appPreferences.font = { ...appPreferences.font, family: '${font}' }; applyAppTheme(); })()`);
      await sleep(400);
    }
    const nav = await A.eval(`(() => { const n = $('workspaceNav'), b = n.getBoundingClientRect(); return { cabe: n.scrollWidth <= n.clientWidth + 1, dentro: ['navProfile', 'navSettings'].every((id) => { const r = $(id).getBoundingClientRect(); return r.right <= b.right && r.bottom <= b.bottom; }) }; })()`);
    check(`Janela mínima${font ? `, fonte ${font}` : ''}: a barrinha cabe, com o perfil e a engrenagem dentro`, nav.cabe && nav.dentro, JSON.stringify(nav));
    f = await A.eval(FITS);
    check(`Janela mínima${font ? `, fonte ${font}` : ''}: nada vaza da barra de baixo`, f.cabe, `etapas: ${f.etapas}`);
  }
  await A.shot('barra-minima-mono.png');
});
