// Espelho infinito: transmitindo a tela inteira e se vendo, a janela do app sai da captura. Pinta a janela de
// magenta, captura a tela (a miniatura do desktopCapturer usa a mesma captura do Windows) e conta o magenta:
// com a exclusão ligada, ele some da captura; desligada, volta.
const { openApp, createRoom, check, sleep, run } = require('./ajuda');

const MAGENTA = `(async () => {
  const src = (await window.api.getSources()).find((s) => s.id.startsWith('screen'));
  const img = new Image();
  img.src = src.thumbnail;
  await img.decode();
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, img.width, img.height).data;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] > 200) n++;
  return n / (px.length / 4);
})()`;

run('Espelho infinito (a janela sai da captura)', 60000, async () => {
  const A = await openApp('espelhoA', 9531, { size: false });
  await createRoom(A, { name: 'Ana', port: 18851 });
  await A.eval(`(() => { const d = document.createElement('div'); Object.assign(d.style, { position: 'fixed', inset: '0', background: '#ff00ff', zIndex: 99 }); document.body.append(d); })()`);
  await A.send('Page.bringToFront');
  await sleep(800);
  const before = await A.eval(MAGENTA);
  check('Sem exclusão: a janela do app aparece na captura', before > 0.05, `${(before * 100).toFixed(1)}% da tela`);
  await A.eval(`window.api.captureExclude(true)`);
  await sleep(800);
  const during = await A.eval(MAGENTA);
  check('Com exclusão: a janela some da captura', during < 0.005, `${(during * 100).toFixed(2)}% da tela`);
  await A.eval(`window.api.captureExclude(false)`);
  await sleep(800);
  const after = await A.eval(MAGENTA);
  check('Desligou: a janela volta para a captura', after > 0.05, `${(after * 100).toFixed(1)}% da tela`);

  // O app liga sozinho: se vendo com uma tela inteira; desliga ao parar de se ver
  await A.eval(`(() => { state.sharing = true; state.sharingSource = 'screen:0:0'; state.in.set(state.myId, { self: true }); syncCaptureExclude(); })()`);
  check('Se vendo com a tela inteira: liga', await A.eval(`captureExcluded === true`));
  await A.eval(`(() => { state.sharingSource = 'window:123:0'; syncCaptureExclude(); })()`);
  check('Transmitindo uma janela: não precisa', await A.eval(`captureExcluded === false`));
  await A.eval(`(() => { state.sharingSource = 'screen:0:0'; syncCaptureExclude(); state.in.delete(state.myId); syncCaptureExclude(); state.sharing = false; })()`);
  check('Parou de se ver: desliga', await A.eval(`captureExcluded === false`));
});
