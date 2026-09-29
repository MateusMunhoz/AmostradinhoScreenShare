// Arrumação com várias telas: Ana, Carla e Dani transmitem; Bia assiste as três.
// Uma grande e as outras numa coluna ao lado; clicar numa pequena troca o destaque.
const { openApp, createRoom, joinRoom, share, check, sleep, run } = require('./ajuda');

const PORT = 18795;

run('Várias telas (destaque com coluna)', 200000, async () => {
  const A = await openApp('telasA', 9451, { fake: true });
  await createRoom(A, { name: 'Ana', port: PORT });
  await share(A);
  for (const [tag, port, name] of [['telasC', 9452, 'Carla'], ['telasD', 9453, 'Dani']]) {
    const X = await openApp(tag, port, { fake: true });
    await joinRoom(X, { name, addr: `127.0.0.1:${PORT}` });
    await share(X);
  }
  const B = await openApp('telasB', 9454);
  await joinRoom(B, { name: 'Bia', addr: `127.0.0.1:${PORT}` });
  await B.waitFor(`[...state.members.values()].filter((m) => m.sharing).length === 3`);
  await B.eval(`[...state.members].filter(([, m]) => m.sharing).forEach(([id]) => watch(id))`);
  await B.waitFor(`state.in.size === 3 && [...state.in.values()].every((l) => l.tile.video.videoWidth > 0)`, 30000);
  await sleep(800);
  // Grade (padrão): todas do mesmo tamanho, o seletor aparece com 2 ou mais
  const grid = () => B.eval(`stageIds().map((id) => { const r = state.in.get(id).tile.el.getBoundingClientRect(); return { id, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; })`);
  let g = await grid();
  check('Grade: começa na grade, com o seletor Grade | Destaque', await B.eval(`palco.layout === 'grid' && $('tiles').classList.contains('grid') && !$('stageLayout').hidden`));
  const [top, ...bottom] = [...g].sort((a, b) => a.y - b.y || a.x - b.x);
  check('Grade: 3 telas = 1 maior em cima e 2 iguais embaixo, lado a lado', top.w > bottom[0].w + 50 && bottom.length === 2 && bottom[0].y === bottom[1].y && Math.abs(bottom[0].w - bottom[1].w) <= 2 && bottom[0].y >= top.y + top.h, JSON.stringify(g));
  check('Grade: vídeo em 16:9 e tudo dentro do palco, sem rolar', await B.eval(`[...state.in.values()].every((l) => { const b = l.tile.el.querySelector('.tile-body').getBoundingClientRect(); return Math.abs(b.width / b.height - 16 / 9) < 0.06; }) && $('tiles').scrollHeight <= $('tiles').clientHeight + 1 && !$('tiles').classList.contains('scroll')`));
  check('Grade: linhas de cima com menos telas; com telas demais, rola', await B.eval(`JSON.stringify(planGrid(5, 1200, 700).counts) === '[2,3]' && planGrid(20, 800, 450).scroll && !planGrid(4, 1200, 700).scroll`));
  // Telas que não cabem sem ficar estreitas vão para a faixa de baixo (simulado com uma largura mínima alta)
  await B.eval(`palco.tileMin = 520; layoutStage(); 0`);
  await sleep(200);
  check('Faixa de baixo: uma na grade e as outras embaixo, lado a lado e do mesmo tamanho', await B.eval(`(() => {
    const [g] = stageIds().filter((id) => !palco.strip.includes(id)).map((id) => state.in.get(id).tile.el.getBoundingClientRect());
    const s = palco.strip.map((id) => state.in.get(id).tile.el.getBoundingClientRect());
    return palco.strip.length === 2 && s.every((r) => r.top >= g.bottom && Math.abs(r.height - s[0].height) < 1 && r.top === s[0].top) && s[1].left > s[0].right;
  })()`));
  await B.shot('varias-telas-faixa.png');
  await B.eval(`palco.tileMin = 240; layoutStage(); 0`);
  await sleep(200);
  check('Faixa de baixo some quando todas cabem de novo', await B.eval(`palco.strip.length === 0 && $('stageScroll').hidden`));
  await B.shot('varias-telas-grade.png');
  // Arrastar a primeira pela faixa do nome e soltar em cima da última troca as duas de lugar
  const [first, , lastOne] = g;
  await B.eval(`(() => { const h = state.in.get('${first.id}').tile.el.querySelector('.tile-name'); const at = (type, x, y) => h.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
    at('pointerdown', ${first.x + 20}, ${first.y + 10}); at('pointermove', ${first.x + 40}, ${first.y + 30}); at('pointermove', ${lastOne.x + lastOne.w / 2}, ${lastOne.y + lastOne.h / 2}); at('pointerup', ${lastOne.x + lastOne.w / 2}, ${lastOne.y + lastOne.h / 2}); })()`);
  await sleep(300);
  const g2 = await grid();
  check('Grade: arrastar uma tela sobre outra troca as duas', g2.find((x) => x.id === first.id).x === lastOne.x && g2.find((x) => x.id === first.id).y === lastOne.y && g2.find((x) => x.id === lastOne.id).x === first.x);
  await B.eval(`$('stageLayout').querySelector('[data-layout=spotlight]').click()`);
  await sleep(400);
  check('Destaque: divisa arrastável aparece entre a grande e a coluna', await B.eval(`!$('stageSplitter').hidden && $('stageSplitter').getBoundingClientRect().height > 100`));
  const before = await B.eval(`[...state.in.values()].find((l) => l.tile.el.classList.contains('small')).tile.el.getBoundingClientRect().width`);
  await B.eval(`for (let i = 0; i < 5; i++) $('stageSplitter').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
  await sleep(300);
  check('Destaque: mover a divisa alarga a coluna e fica salvo', await B.eval(`[...state.in.values()].find((l) => l.tile.el.classList.contains('small')).tile.el.getBoundingClientRect().width > ${before} + 20 && Number(localStorage.getItem('stageSide')) > 0.3`));

  // O tamanho é o da área do vídeo (a faixa com o nome fica em cima dela)
  const info = () => B.eval(`[...state.in].map(([id, l]) => { const r = l.tile.el.querySelector('.tile-body').getBoundingClientRect(); return { id, name: l.tile.name, small: l.tile.el.classList.contains('small'), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), playing: !l.tile.video.paused, videoOn: l.videoOn }; })`);
  let t = await info();
  const big = t.filter((x) => !x.small);
  check('Uma grande e duas pequenas', big.length === 1 && t.filter((x) => x.small).length === 2, t.map((x) => x.name + (x.small ? ':p' : ':G')).join(' '));
  check('Pequenas à direita da grande', t.filter((x) => x.small).every((x) => x.x > big[0].x + big[0].w - 2));
  check('Pequenas em 16:9', t.filter((x) => x.small).every((x) => Math.abs(x.w / x.h - 16 / 9) < 0.05));
  check('Todas tocando e recebendo vídeo', t.every((x) => x.playing && x.videoOn));
  await B.shot('varias-telas.png');
  // Com tela sendo assistida, as telas vão até o topo: sem o nome do app nem o título "Transmissões"
  check('Telas até o topo, sem os títulos', await B.eval(`getComputedStyle(document.querySelector('.stream-pane-head')).display === 'none' && getComputedStyle(document.querySelector('.workspace-brand')).display === 'none' && $('tiles').getBoundingClientRect().top - $('titlebar').offsetHeight < 40`));

  // Painel "Transmissão" desligado: as telas ficam escondidas, então quem transmite para de mandar o vídeo
  // para a Bia (o som continua); ligado de novo, o vídeo volta
  await B.eval(`$('navStreams').click()`);
  await sleep(300);
  check('Transmissão desligada: vídeo das telas pausado', await B.eval(`$('streamArea').hidden && [...state.in.values()].every((l) => !l.videoOn)`));
  await B.eval(`$('navStreams').click()`);
  await sleep(300);
  check('Transmissão ligada de novo: vídeo volta', await B.eval(`!$('streamArea').hidden && [...state.in.values()].every((l) => l.videoOn)`));

  const target = t.find((x) => x.small);
  await B.eval(`state.in.get('${target.id}').tile.el.click()`);
  await sleep(400);
  t = await info();
  check('Clicar numa pequena põe ela em destaque', !t.find((x) => x.id === target.id).small && t.filter((x) => x.small).length === 2);
  await B.eval(`setFocus('${target.id}')`);
  await sleep(300);
  check('Modo "só esta" continua funcionando', await B.eval(`$('tiles').classList.contains('focused') && !$('tiles').classList.contains('column') && [...state.in.values()].filter((l) => !l.tile.el.hidden).length === 1`));
  await B.eval(`setFocus(null)`);
  await sleep(300);
  check('Ao sair do "só esta", a mesma continua grande', await B.eval(`state.main === '${target.id}' && $('tiles').classList.contains('column')`));
  await B.eval(`stopWatching('${target.id}')`);
  await sleep(400);
  t = await info();
  check('Parar de assistir a grande: outra assume', t.length === 2 && t.filter((x) => !x.small).length === 1);
  await B.eval(`stopWatching(state.main)`);
  await sleep(400);
  check('Com uma só, volta a ocupar tudo', await B.eval(`!$('tiles').classList.contains('column') && ![...state.in.values()][0].tile.el.classList.contains('small')`));
  await B.eval(`stopWatching(state.main)`);
  await sleep(300);
  check('Sem tela nenhuma: a faixa de cima continua sem aparecer', await B.eval(`getComputedStyle(document.querySelector('.stream-pane-head')).display === 'none' && $('emptyStage').getBoundingClientRect().top - $('titlebar').offsetHeight < 40`));
});
