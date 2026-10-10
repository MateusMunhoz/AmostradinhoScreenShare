// Janela de transmitir: o escurecido e a janela ficam dentro da área das transmissões, sem cobrir o cabeçalho
// da sala nem o painel do lado (com o cartão Seu sinal); com as telas escondidas, abrir a janela mostra elas.
const { openApp, createRoom, check, sleep, run } = require('./ajuda');

const RECTS = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
  return { area: r($('streamArea')), modal: r($('shareDialog')), dialog: r($('shareDialog').querySelector('.dialog')), head: r($('roomHead')), sinal: r($('seuSinal')) };
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
  check('O cabeçalho da sala e o cartão Seu sinal ficam de fora', r.modal.top >= r.head.bottom - 1 && r.modal.right <= r.sinal.left + 1, `janela de ${Math.round(r.modal.top)} a ${Math.round(r.modal.right)}, cabeçalho até ${Math.round(r.head.bottom)}, cartão em ${Math.round(r.sinal.left)}`);
  check('A lista de fontes rola dentro da janela', await A.eval(`(() => { const b = $('shareDialog').querySelector('.share-body'); return getComputedStyle(b).overflowY === 'auto'; })()`));
  await A.shot('transmitir-janela.png');
  await A.eval(`closeShareDialog()`);
});
