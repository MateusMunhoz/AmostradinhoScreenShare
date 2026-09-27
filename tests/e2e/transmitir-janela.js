// Janela de transmitir: o escurecido e a janela ficam dentro da área das transmissões, sem cobrir a barra
// de baixo nem o painel do lado; com o painel Transmissão desligado, abrir a janela liga ele.
const { openApp, createRoom, check, sleep, run } = require('./ajuda');

const RECTS = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
  return { area: r($('streamArea')), modal: r($('shareDialog')), dialog: r($('shareDialog').querySelector('.dialog')), dock: r(document.querySelector('.dock')) };
})()`;

run('Janela de transmitir dentro da área das transmissões', 60000, async () => {
  const A = await openApp('janelaT', 9511, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18811 });
  await A.eval(`openShareDialog()`);
  await sleep(600);
  const r = await A.eval(RECTS);
  const inside = (a, b) => a.top >= b.top - 1 && a.bottom <= b.bottom + 1 && a.left >= b.left - 1 && a.right <= b.right + 1;
  check('O escurecido cobre só a área das transmissões', inside(r.modal, r.area) && Math.abs(r.modal.top - r.area.top) < 2 && Math.abs(r.modal.bottom - r.area.bottom) < 2, JSON.stringify(r.modal));
  check('A janela fica dentro dela', inside(r.dialog, r.area), JSON.stringify(r.dialog));
  check('A barra de baixo fica de fora', r.dialog.bottom <= r.dock.top && r.modal.bottom <= r.dock.top, `janela até ${Math.round(r.dialog.bottom)}, barra em ${Math.round(r.dock.top)}`);
  check('A lista de fontes rola dentro da janela', await A.eval(`(() => { const b = $('shareDialog').querySelector('.share-body'); return getComputedStyle(b).overflowY === 'auto'; })()`));
  await A.shot('transmitir-janela.png');
  await A.eval(`closeShareDialog()`);

  await A.eval(`(() => { workspaceViews.streams = false; syncWorkspace(); })()`);
  await A.eval(`openShareDialog()`);
  await sleep(400);
  check('Com o painel Transmissão desligado, abrir a janela liga ele', await A.eval(`!$('streamArea').hidden && !$('shareDialog').hidden && $('shareDialog').getBoundingClientRect().height > 100`));
});
