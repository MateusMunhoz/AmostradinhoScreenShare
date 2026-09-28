// Barra de baixo numa linha só: Transmitir, a voz (com as pessoas), e à direita Convidar, estatísticas, chat
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
  check('Ordem: Transmitir, voz, ..., Convidar, estatísticas, chat, Sair', /^shareBtn voiceDock .*dockAddr openStatsRoom chatToggle leaveBtn$/.test(ordem.replace(/ dock-spacer/, '')), ordem);
  check('Convidar mostra o endereço ao passar o mouse', await A.eval(`$('dockAddr').title.includes(state.roomAddr) && $('dockAddr').textContent.trim() === 'Convidar'`));
  await A.eval(`(() => { window.copiado = null; navigator.clipboard.writeText = async (t) => { copiado = t; }; $('dockAddr').click(); })()`);
  await sleep(200);
  check('Convidar copia o endereço', await A.eval(`copiado === state.roomAddr`));

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
  check('Os botões de sair, chat e microfone continuam à vista', await A.eval(`['leaveBtn', 'chatToggle', 'voiceMute', 'voiceDeafen', 'stopShareBtn'].every((id) => { const e = $(id); const r = e.getBoundingClientRect(); const d = document.querySelector('.dock').getBoundingClientRect(); return r.width > 0 && r.right <= d.right + 1; })`));
  await A.shot('barra.png');

  // Barra de cima + painéis: um bloco só, sem espaço entre eles
  const bloco = await A.eval(`(() => { const n = $('workspaceNav').getBoundingClientRect(), p = $('workspacePanes').getBoundingClientRect(); return { nav: Math.round(n.bottom), paineis: Math.round(p.top), gap: getComputedStyle($('workspacePanes')).rowGap }; })()`);
  check('Barra de cima e painéis formam um bloco (sem espaço)', Math.abs(bloco.paineis - bloco.nav) <= 1 && bloco.gap === '0px', JSON.stringify(bloco));

  // Todos os painéis fechados: a barra começa recolhida numa aba na borda, e as telas usam a altura toda
  await A.eval(`(() => { localStorage.removeItem('barraRecolhida'); navCollapsed = true; workspaceViews.chat = false; workspaceViews.voice = false; saveWorkspaceViews(); syncWorkspace(); })()`);
  await sleep(300);
  const T = `(() => { const a = $('streamArea').getBoundingClientRect(); return { telas: Math.round(a.top), nav: getComputedStyle($('workspaceNav')).display, aba: !$('navExpand').hidden }; })()`;
  let t = await A.eval(T);
  check('Painéis fechados: a barra recolhe numa aba, e as telas começam no topo', t.nav === 'none' && t.aba && t.telas <= 20, JSON.stringify(t));
  await A.shot('barra-recolhida.png');
  // Clique de mouse de verdade (o .click() por código passa até por cima do que não recebe clique)
  const mouse = async (sel) => {
    const c = await A.eval(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await A.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 });
  };
  await mouse('#navExpand');
  await sleep(300);
  t = await A.eval(T);
  const navBottom = await A.eval(`Math.round($('workspaceNav').getBoundingClientRect().bottom)`);
  check('A aba mostra a barra, e as telas descem para baixo dela', t.nav !== 'none' && !t.aba && t.telas >= navBottom && await A.eval(`!$('navCollapse').hidden && localStorage.getItem('barraRecolhida') === '0'`), JSON.stringify({ ...t, navBottom }));
  await A.shot('barra-aberta.png');
  await mouse('#navCollapse');
  await sleep(300);
  check('A setinha na barra recolhe de novo (e fica salvo)', (await A.eval(T)).nav === 'none' && await A.eval(`localStorage.getItem('barraRecolhida') === '1'`));
  await A.eval(`(() => { workspaceViews.chat = true; workspaceViews.voice = true; saveWorkspaceViews(); syncWorkspace(); })()`);
  await sleep(200);
  check('Abrindo o chat de novo, a barra volta junto', await A.eval(`getComputedStyle($('workspaceNav')).display !== 'none' && $('navExpand').hidden && $('navCollapse').hidden`));

  // O › ao lado do contador de pessoas esconde tudo da direita; a setinha traz de volta os mesmos painéis
  await mouse('#chatCollapse');
  await sleep(300);
  t = await A.eval(T);
  check('O › do painel da sala esconde chat, voz e a barra (tela na janela toda)', t.nav === 'none' && t.aba && t.telas <= 20 && await A.eval(`$('workspacePanes').hidden && Math.round($('streamArea').getBoundingClientRect().right) > 1100`), JSON.stringify(t));
  await mouse('#navExpand');
  await sleep(300);
  check('A setinha abre de volta o chat e a voz', await A.eval(`workspaceViews.chat && workspaceViews.voice && !$('workspacePanes').hidden && getComputedStyle($('workspaceNav')).display !== 'none' && $('navExpand').hidden`));

  // Tela larga (1920): tudo aparece, com os textos
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1040, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  f = await A.eval(FITS);
  check('Tela de 1920: cabe tudo, com "ninguém assistindo", "Na voz" e "Convidar"', f.cabe && f.etapas === 'nenhuma' && await A.eval(`$('liveText').offsetWidth > 0 && $('voiceMeText').offsetWidth > 0`), `etapas: ${f.etapas}`);
  await A.shot('barra-larga.png');
});
