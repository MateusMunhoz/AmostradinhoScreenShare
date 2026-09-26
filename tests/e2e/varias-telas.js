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

  const info = () => B.eval(`[...state.in].map(([id, l]) => { const r = l.tile.el.getBoundingClientRect(); return { id, name: l.tile.name, small: l.tile.el.classList.contains('small'), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), playing: !l.tile.video.paused, videoOn: l.videoOn }; })`);
  let t = await info();
  const big = t.filter((x) => !x.small);
  check('Uma grande e duas pequenas', big.length === 1 && t.filter((x) => x.small).length === 2, t.map((x) => x.name + (x.small ? ':p' : ':G')).join(' '));
  check('Pequenas à direita da grande', t.filter((x) => x.small).every((x) => x.x > big[0].x + big[0].w - 2));
  check('Pequenas em 16:9', t.filter((x) => x.small).every((x) => Math.abs(x.w / x.h - 16 / 9) < 0.05));
  check('Todas tocando e recebendo vídeo', t.every((x) => x.playing && x.videoOn));
  await B.shot('varias-telas.png');

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
});
