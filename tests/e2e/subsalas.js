// Subsalas: arrastar pessoas de um canal para outro no painel de voz, e a faixa de controles (microfone, fone, Sair)
// sempre à vista embaixo, mesmo com tantas subsalas que a lista precisa rolar.
const fs = require('fs');
const path = require('path');
const { openApp, createRoom, joinRoom, check, sleep, run, FOTOS } = require('./ajuda');

// Foto só do céu da voz: copia o SVG com as cores calculadas pelo CSS e desenha num canvas, 4x maior
// (a captura da janela inteira trava com a outra cópia do app por cima)
async function skyShot(app, name) {
  const url = await app.eval(`(async () => {
    const sky = $('voiceSky'), copy = sky.cloneNode(true), box = sky.getBoundingClientRect();
    const all = [sky, ...sky.querySelectorAll('*')], copies = [copy, ...copy.querySelectorAll('*')];
    all.forEach((el, i) => { const cs = getComputedStyle(el); for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font', 'text-anchor', 'filter', 'transform', 'transform-origin']) copies[i].style.setProperty(p, cs.getPropertyValue(p)); });
    copy.setAttribute('width', box.width * 4); copy.setAttribute('height', box.height * 4);
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
    await img.decode();
    const c = document.createElement('canvas'); c.width = box.width * 4; c.height = box.height * 4;
    const ctx = c.getContext('2d'); ctx.fillStyle = getComputedStyle(document.body).backgroundColor; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  })()`);
  fs.writeFileSync(path.join(FOTOS, name), Buffer.from(url.split(',')[1], 'base64'));
}

const TONE = `(() => { window.tctx = new AudioContext(); const o = tctx.createOscillator(); const dst = tctx.createMediaStreamDestination(); o.connect(dst); o.start(); voice.media = { getUserMedia: async () => dst.stream }; })()`;
// Arrasta a linha de quem (id; null é você) e solta em cima do cabeçalho do canal ch
const drag = (who, ch) => `(() => {
  const list = $('voicePaneMembers');
  const row = [...list.querySelectorAll('.member.in-channel')].find((li) => li.dataset.person === ${JSON.stringify(who)});
  const head = list.querySelector('.voice-channel[data-channel="${ch}"]');
  if (!row || !head || !row.draggable) return false;
  const dt = new DataTransfer();
  row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  head.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const marked = head.classList.contains('drop-target');
  head.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  return marked;
})()`;

// Mouse de verdade (pelo DevTools), no ponto do meio de um elemento
const centerOf = (app, sel) => app.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const mouse = (app, type, [x, y], down = false) => app.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: down ? 1 : 0, clickCount: 1 });
async function clickAt(app, p) { await mouse(app, 'mouseMoved', p); await sleep(80); await mouse(app, 'mousePressed', p, true); await mouse(app, 'mouseReleased', p); await sleep(150); }
async function dragTo(app, from, to) {
  await mouse(app, 'mouseMoved', from); await sleep(120);
  await mouse(app, 'mousePressed', from, true);
  for (let i = 1; i <= 8; i++) { await mouse(app, 'mouseMoved', [from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8], true); await sleep(30); }
  const marked = await app.eval(`!!document.querySelector('#voiceSky .sky-sun.drop-target')`);
  await mouse(app, 'mouseReleased', to);
  return marked;
}
// Roda do mouse direto na página (pelo DevTools, a roda espera a janela desenhar, e ela pode estar atrás da outra)
const wheel = (app, [x, y], deltaY, times) => app.eval(`(() => { for (let i = 0; i < ${times}; i++) $('voiceSky').dispatchEvent(new WheelEvent('wheel', { deltaY: ${deltaY}, clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true })); })()`);
// Posição dos sóis no desenho (centro, em coordenadas do SVG)
const SPAN = 2 * (42 + 26); // SKY_SPAN: um sistema com 3 anéis, mais os nomes
const SUNS = `[...document.querySelectorAll('#voiceSky .sky-sun')].map((g) => { const m = g.transform.baseVal.consolidate().matrix; return [m.e, m.f]; })`;

run('Subsalas: arrastar pessoas e controles da voz fixos', 200000, async () => {
  const A = await openApp('subA', 9491, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18811 });
  const B = await openApp('subB', 9492, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18811' });
  const [anaId, biaId] = [await A.eval('state.myId'), await B.eval('state.myId')];
  await A.eval(`setVoiceView('lista')`); // o perfil de teste pode ter ficado no Mapa
  check('O servidor sabe mover os outros', await A.eval('state.subsalaMove') && await B.eval('state.subsalaMove'));
  await A.eval(`setPainelSala({ aba: 'voz', juntos: false, recolhido: false })`);
  await A.eval(TONE); await B.eval(TONE);
  await A.eval(`$('voiceJoin').click()`);
  await B.eval(`$('voiceJoin').click()`);
  await A.waitFor(`voice.session && voice.members.get('${biaId}')?.session`, 15000);
  await A.eval(`createSubsala(); createSubsala()`);
  await A.waitFor(`state.subsalas.length === 2 && document.querySelector('#voicePaneMembers .voice-channel[data-channel="2"]')`, 5000);

  // Ana arrasta a Bia para a Subsala_1: o app da Bia troca de canal sozinho
  check('Arrastar marca o canal de destino', await A.eval(drag(biaId, '1')));
  await B.waitFor(`voice.channel === '1'`, 5000);
  await A.waitFor(`voice.members.get('${biaId}').channel === '1'`, 5000);
  check('Bia foi para a Subsala_1 (nos dois apps)', true);
  await sleep(300);
  check('No painel da Ana, a Bia aparece embaixo da Subsala_1', await A.eval(`(() => {
    const rows = [...$('voicePaneMembers').children];
    const head = rows.findIndex((li) => li.dataset.channel === '1' && li.classList.contains('voice-channel'));
    return rows[head + 1]?.dataset.person === '${biaId}';
  })()`));
  // Ana arrasta a si mesma para a Subsala_1: as duas se conectam de novo
  check('Arrastar você mesma', await A.eval(drag(anaId, '1')));
  await A.waitFor(`voice.channel === '1' && [...voice.peers.values()].some((p) => p.pc.connectionState === 'connected')`, 20000);
  check('Ana na Subsala_1, conectada com a Bia', true);
  // De volta para a Voz geral
  await A.eval(drag(biaId, ''));
  await B.waitFor(`voice.channel === ''`, 5000);
  check('Bia arrastada de volta para a Voz geral', true);
  check('Soltar no próprio canal não marca nada', !(await A.eval(drag(anaId, '1'))));

  // Céu da voz: um sol por canal (o seu com destaque, o vazio apagado), cada pessoa orbitando o sol do canal dela
  await sleep(300);
  check('Céu: três sóis (Voz geral, Subsala_1 e a Subsala_2 vazia)', await A.eval(`(() => {
    const suns = [...document.querySelectorAll('#voiceSky .sky-sun')];
    return suns.length === 3 && suns[1].classList.contains('here') && suns[2].classList.contains('empty') && document.querySelectorAll('#voiceSky .sky-bridge').length === 2;
  })()`));
  check('Céu: Ana e Bia são planetas, cada uma no seu sistema', await A.eval(`(() => {
    const planet = (id) => document.querySelector('#voiceSky .sky-star[data-person="' + id + '"]');
    const sun = (i) => document.querySelectorAll('#voiceSky .sky-sun')[i].getBoundingClientRect();
    const near = (el, s) => { const r = el.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - s.x - s.width / 2, r.y + r.height / 2 - s.y - s.height / 2); };
    const a = planet('${anaId}'), b = planet('${biaId}');
    return !!a && !!b && near(a, sun(1)) < near(a, sun(0)) && near(b, sun(0)) < near(b, sun(1));
  })()`));
  await skyShot(A, 'subsalas-ceu.png');

  // Três sóis: um triângulo (não ficam em linha), vizinhos perto, sem encostar
  check('Disposição: três sóis em triângulo', await A.eval(`(() => {
    const [a, b, c] = ${SUNS};
    const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    return [d(a, b), d(b, c), d(a, c)].every((x) => x >= 63 && x <= 110) && area > 1500 || JSON.stringify([a, b, c, area]);
  })()`) === true, await A.eval(`JSON.stringify(${SUNS})`));

  // Visão Mapa: o céu grande no lugar da lista, com tudo que a lista faz
  await A.eval(`$('voiceViewMap').click()`);
  await sleep(300);
  check('Mapa: o céu fica grande e a lista só tem Nova subsala', await A.eval(`$('voiceSky').classList.contains('map') && $('voiceSky').getBoundingClientRect().height > 160
    && !document.querySelector('#voicePaneMembers .voice-channel, #voicePaneMembers .member') && !$('paneVoiceSubsala').hidden
    && $('voiceViewMap').getAttribute('aria-pressed') === 'true' && localStorage.getItem('vozVisao') === 'mapa'`));
  check('Mapa: nome de cada pessoa embaixo do planeta', await A.eval(`[...document.querySelectorAll('#voiceSky .sky-pname')].map((t) => t.textContent).sort().join() === 'Ana,Bia'`));
  // Clicar no sol da Subsala_2 (vazia): o balão do canal, com Entrar
  await clickAt(A, await centerOf(A, '#voiceSky .sky-sun[data-channel="2"]'));
  check('Mapa: clicar no sol abre o canal (o nome entra; apagar)', await A.eval(`!$('voiceMapPop').hidden && $('voiceMapPop').textContent.includes('Subsala_2') && !!$('voiceMapPop').querySelector('button.sky-card-info') && !!$('voiceMapPop').querySelector('.voice-channel-delete')`));
  await clickAt(A, await centerOf(A, '#voiceMapPop button.sky-card-info')); // o nome do canal é o Entrar
  await A.waitFor(`voice.channel === '2'`, 5000);
  check('Mapa: Entrar pelo balão leva você para a Subsala_2', true);
  // Clicar num planeta: o perfil na órbita (Assistir, Perfil, Silenciar para mim, Mudar de canal) e o volume
  await sleep(300);
  // Com o mouse no mapa os planetas param de girar (como quem vai clicar); o balão do canal aberto segura o foco
  { const b = await A.eval(`(() => { const r = $('voiceSkyBox').getBoundingClientRect(); return [r.left + 6, r.top + 6]; })()`); await mouse(A, 'mouseMoved', b); await sleep(100); }
  const biaAt = await centerOf(A, `#voiceSky .sky-star[data-person="${biaId}"]`);
  await clickAt(A, biaAt);
  check('Mapa: clicar na Bia abre o perfil dela na órbita, com o volume', await A.eval(`!$('skyFocus').hidden && $('skyFocusName').textContent === 'Bia' && document.querySelectorAll('#skyFocus .sky-act').length === 4 && !!$('skyFocus').querySelector('input[type=range]') && $('voiceMapPop').hidden`));
  await A.eval(`document.querySelector('#skyFocus .sky-act.a2').click()`);
  await sleep(200);
  check('Mapa: Perfil abre o cartão da Bia, e o perfil continua', await A.eval(`!$('personCard').hidden && !$('skyFocus').hidden`));
  await A.eval(`closePersonCard()`);
  await A.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  check('Mapa: Esc fecha o perfil', await A.eval(`$('skyFocus').hidden`));
  // Arrastar o planeta da Bia até o sol da Subsala_2
  await sleep(200);
  const marked = await dragTo(A, await centerOf(A, `#voiceSky .sky-star[data-person="${biaId}"]`), await centerOf(A, '#voiceSky .sky-sun[data-channel="2"]'));
  check('Mapa: arrastar o planeta marca o sol de destino', marked);
  await B.waitFor(`voice.channel === '2'`, 5000);
  check('Mapa: Bia arrastada até a Subsala_2', true);
  await A.waitFor(`document.querySelectorAll('#voiceSky .sky-sun[data-channel="2"].here').length === 1 && document.querySelectorAll('#voiceSky .sky-star').length === 2`, 5000);
  check('Mapa: depois de soltar, nenhum planeta fica apagado', await A.eval(`!document.querySelector('#voiceSky .dragging') && !document.querySelector('.sky-ghost')`));
  await skyShot(A, 'subsalas-mapa.png');

  // Zoom: a roda aproxima até caber um sistema só; afasta até ver todos; arrastar o fundo anda; Ver tudo volta
  const cam = () => A.eval(`(() => { const v = $('voiceSky').viewBox.baseVal, r = $('voiceSky').getBoundingClientRect(); return { w: v.width, h: v.height, x: v.x, y: v.y, u: skyCam.u, uIn: skyCam.uIn, uFit: skyCam.uFit, pw: r.width, ph: r.height, zoom: !$('skyZoom').hidden }; })()`);
  const fit = await cam();
  check('Mapa: preenche o painel (o desenho tem o formato do mapa)', Math.abs(fit.w / fit.h - fit.pw / fit.ph) < .02 && fit.zoom, JSON.stringify(fit));
  const mid = await centerOf(A, '#voiceSky');
  await wheel(A, mid, -400, 6);
  const zin = await cam();
  check('Zoom: a roda aproxima, até o limite de um sistema', zin.u < fit.u && Math.abs(zin.u - zin.uIn) < 1e-6 && Math.abs(Math.min(zin.w, zin.h) - SPAN) < 1, JSON.stringify(zin));
  const at = await centerOf(A, '#voiceSky');
  const p0 = [at[0] - 60, at[1] - 60];
  await mouse(A, 'mouseMoved', p0); await sleep(60);
  await mouse(A, 'mousePressed', p0, true);
  for (let i = 1; i <= 6; i++) { await mouse(A, 'mouseMoved', [p0[0] + i * 20, p0[1] + i * 20], true); await sleep(30); }
  await mouse(A, 'mouseReleased', [p0[0] + 120, p0[1] + 120]);
  await sleep(150);
  const panned = await cam();
  check('Arrastar o fundo anda pelo mapa (e não abre balão)', (panned.x !== zin.x || panned.y !== zin.y) && await A.eval(`$('voiceMapPop').hidden`), JSON.stringify(panned));
  await wheel(A, mid, 400, 12);
  const zout = await cam();
  check('Zoom: afastar para no limite de ver todas as salas', Math.abs(zout.u - zout.uFit) < 1e-6 && zout.w === fit.w && zout.x === fit.x, JSON.stringify(zout));
  await A.eval(`$('skyZoomIn').click(); $('skyZoomIn').click()`);
  await A.eval(`$('skyZoomFit').click()`);
  check('Ver tudo volta a mostrar todas as salas', (await cam()).x === fit.x && await A.eval(`$('skyZoomFit').disabled && skyCam.auto`));
  await A.eval(`$('voiceViewList').click()`);
  await sleep(200);
  check('Lista de volta', await A.eval(`!$('voiceSky').classList.contains('map') && !!document.querySelector('#voicePaneMembers .voice-channel') && localStorage.getItem('vozVisao') === 'lista'`));

  // Muitas subsalas: só a lista rola, a faixa de controles continua embaixo, à vista
  await A.eval(`for (let i = 0; i < 14; i++) createSubsala()`);
  await A.waitFor(`state.subsalas.length === 16`, 5000);
  await sleep(300);
  const geo = `(() => {
    const pane = $('voicePane').getBoundingClientRect(), bar = document.querySelector('#voicePane .pane-voice-actions').getBoundingClientRect(), list = $('voicePaneMembers');
    return { rola: list.scrollHeight > list.clientHeight + 4, barra: bar.bottom <= pane.bottom + 1 && bar.top >= pane.top, paneRola: $('voicePane').scrollHeight > $('voicePane').clientHeight + 1, bar: [bar.top, bar.bottom], pane: [pane.top, pane.bottom] };
  })()`;
  const before = await A.eval(geo);
  check('A lista rola e a barra fica dentro do painel', before.rola && before.barra && !before.paneRola, JSON.stringify(before));
  await A.eval(`$('voicePaneMembers').scrollTop = 99999`);
  await sleep(100);
  const after = await A.eval(geo);
  check('Rolando até o fim, a barra não sai do lugar', after.bar[0] === before.bar[0] && after.barra, JSON.stringify(after));
  await skyShot(A, 'subsalas-ceu-muitas.png');
  // Com 17 sóis: nenhum encosta no outro, e cada um tem um vizinho perto (o grupo não se espalha)
  check('Disposição: 17 sóis juntos, sem encostar', await A.eval(`(() => {
    const p = ${SUNS};
    const near = p.map((a, i) => Math.min(...p.filter((_, j) => j !== i).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))));
    return p.length === 17 && near.every((d) => d >= 63 && d <= 90);
  })()`));
  await A.eval(`$('voiceViewMap').click()`);
  await sleep(300);
  await skyShot(A, 'subsalas-mapa-muitas.png');
  // Foto com mais gente (pessoas de mentira, só no desenho): 4 numa subsala, 3 na outra
  await A.eval(`(() => {
    const fake = [['91', 'Xeipoto', '1'], ['92', 'Maumau', '1'], ['93', 'Naitsi', '1'], ['94', 'PGE_lover69', '1'], ['95', 'Far Dog', ''], ['96', 'DMN', ''], ['97', 'Calopsita', '']];
    for (const [id, name, ch] of fake) { state.members.set(id, { name, sharing: id === '94', addrs: [] }); voice.members.set(id, { session: 's' + id, channel: ch, muted: id === '93', deafened: id === '93' }); }
    renderVoicePane();
  })()`);
  await sleep(300);
  await skyShot(A, 'subsalas-mapa-cheio.png');
  await wheel(A, mid, -400, 6);
  await skyShot(A, 'subsalas-mapa-zoom.png');
  await A.eval(`$('voiceViewList').click()`);
  check('Microfone, fone e Sair não se repetem no painel de voz (ficam na barra flutuante)', await A.eval(`!$('voicePane').querySelector('.pane-voice-actions #voiceMute, .pane-voice-actions #voiceDeafen') && $('paneVoiceJoin').hidden && !$('voiceMute').hidden`));
});
