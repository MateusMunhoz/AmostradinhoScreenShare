// Barra de mensagens: o "Mensagens" abre a lista das conversas para cima, em cima da própria barra (não no HUB).
// Sem servidor Razze: a conta e as conversas são de mentira, só no app (nada é enviado).
const { openApp, check, sleep, run } = require('./ajuda');

const ME = 'a'.repeat(32), BIA = 'b'.repeat(32), CAIO = 'c'.repeat(32);
const centerOf = (app, sel) => app.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const mouse = (app, type, [x, y]) => app.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
async function clickAt(app, p) { await mouse(app, 'mouseMoved', p); await sleep(60); await mouse(app, 'mousePressed', p); await mouse(app, 'mouseReleased', p); await sleep(250); }

run('Barra de mensagens abre para cima', 90000, async () => {
  const A = await openApp('dmBarra', 9497);
  await A.waitFor(`typeof setDmPanel === 'function'`);
  await sleep(800);
  await A.eval(`(() => {
    friendsData.friends = [{ id: '${BIA}', displayName: 'Bia', online: true }, { id: '${CAIO}', displayName: 'Caio', online: false }];
    dm.account = '${ME}';
    const c = dmConv('${BIA}'); c.last = { id: 'm1', from: '${BIA}', text: 'oi, bora jogar?', createdAt: Date.now() }; c.unread = 2;
    renderDm();
  })()`);
  check('Com conta, a barra aparece', await A.eval(`!$('dmBar').hidden && $('dmPanel').hidden`));

  await clickAt(A, await centerOf(A, '#dmBarLabel'));
  const geo = await A.eval(`(() => { const p = $('dmPanel').getBoundingClientRect(), b = $('dmBar').getBoundingClientRect(), l = $('dmBarLabel').getBoundingClientRect(); return { pBottom: p.bottom, bTop: b.top, pLeft: p.left, lLeft: l.left, h: p.height }; })()`);
  check('Clicar em Mensagens abre o painel para cima, colado na barra', await A.eval(`!$('dmPanel').hidden`) && Math.abs(geo.pBottom - geo.bTop) < 2 && Math.abs(geo.pLeft - geo.lLeft) < 2 && geo.h > 150, JSON.stringify(geo));
  check('O HUB não abre', await A.eval(`!hub.open`));
  check('Lista: Bia (com a prévia e 2 não lidas) antes do Caio', await A.eval(`(() => {
    const rows = [...$('dmPanelConvList').children];
    return rows.length === 2 && rows[0].textContent.includes('Bia') && rows[0].textContent.includes('oi, bora jogar?') && rows[0].querySelector('.hub-badge')?.textContent === '2' && rows[1].textContent.includes('Caio');
  })()`));
  check('O botão fica marcado como aberto e a busca recebe o foco', await A.eval(`$('dmBarLabel').getAttribute('aria-expanded') === 'true' && document.activeElement === $('dmPanelFilter')`));
  await A.eval(`(() => { const f = $('dmPanelFilter'); f.value = 'cai'; f.dispatchEvent(new Event('input')); })()`);
  check('Buscar filtra a lista', await A.eval(`$('dmPanelConvList').children.length === 1 && $('dmPanelConvList').textContent.includes('Caio')`));
  await A.eval(`(() => { const f = $('dmPanelFilter'); f.value = ''; f.dispatchEvent(new Event('input')); })()`);
  await A.shot('mensagens-barra.png');

  await clickAt(A, await centerOf(A, '#dmBarLabel'));
  check('Clicar de novo fecha', await A.eval(`$('dmPanel').hidden && $('dmBarLabel').getAttribute('aria-expanded') === 'false'`));
  await clickAt(A, await centerOf(A, '#dmBarLabel'));
  await A.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  check('Esc fecha', await A.eval(`$('dmPanel').hidden`));
  await clickAt(A, await centerOf(A, '#dmBarLabel'));
  await clickAt(A, [400, 200]);
  check('Clicar fora fecha', await A.eval(`$('dmPanel').hidden`));

  await clickAt(A, await centerOf(A, '#dmBarLabel'));
  await clickAt(A, await centerOf(A, '#dmPanelConvList > li'));
  await A.waitFor(`dm.bar.some((b) => b.id === '${BIA}' && b.open)`, 5000);
  check('Clicar na conversa abre a janela dela na barra e fecha a lista', await A.eval(`$('dmPanel').hidden && !document.querySelector('.dm-slot.open .dm-window').hidden && dm.convs.get('${BIA}').unread === 0`));

  // Muitas conversas abertas: as que não cabem vão para o "+N", e nada passa da borda da janela
  const ids = ['d', 'e', 'f', 'g', 'h'].map((ch) => ch.repeat(32));
  await A.eval(`(() => {
    ${JSON.stringify(ids)}.forEach((id, i) => { friendsData.friends.push({ id, displayName: 'Amigo ' + (i + 1), online: i % 2 === 0 }); dmPutInBar(id, i < 3); });
    dmConv('${'h'.repeat(32)}').unread = 3;
    renderDm();
  })()`);
  await sleep(200);
  const bar = `(() => {
    const vis = [...$('dmSlots').children].filter((s) => !s.hidden);
    const right = Math.max(...vis.map((s) => s.getBoundingClientRect().right), ...vis.flatMap((s) => [...s.querySelectorAll('.dm-window:not([hidden])')].map((w) => w.getBoundingClientRect().right)));
    return { order: dm.bar.map((b) => friendName(b.id)), shown: vis.length, more: $('dmMore').hidden ? '' : $('dmMore').textContent, right, width: innerWidth, unread: $('dmMore').classList.contains('has-unread') };
  })()`;
  const b1 = await A.eval(bar);
  check('Conversas que não cabem vão para o "+N", e nada passa da borda', b1.more === '+' + (b1.order.length - b1.shown) && b1.shown < b1.order.length && b1.right <= b1.width, JSON.stringify(b1));
  check('O "+N" avisa que tem mensagem não lida escondida', b1.unread);
  await clickAt(A, await centerOf(A, '#dmMore'));
  const listed = await A.eval(`[...$('dmMoreMenu').querySelectorAll('.dm-more-item')].map((i) => i.textContent)`);
  check('Clicar no "+N" lista as escondidas, para cima', listed.length === b1.order.length - b1.shown && await A.eval(`$('dmMoreMenu').getBoundingClientRect().bottom <= $('dmBar').getBoundingClientRect().top + 1`), JSON.stringify(listed));
  await clickAt(A, await centerOf(A, '#dmMoreMenu .dm-more-item:last-child'));
  await A.waitFor(`dm.bar.find((b) => b.id === '${'h'.repeat(32)}').open && !dm.convs.get('${'h'.repeat(32)}').el.slot.hidden`, 5000);
  const b2 = await A.eval(bar);
  check('Escolher uma no "+N" traz ela para a barra, aberta, sem passar da borda', b2.right <= b2.width && b2.order.indexOf('Amigo 5') < b2.shown, JSON.stringify(b2));
  // Mudar a ordem: arrastar o primeiro chip para depois do segundo
  const order0 = (await A.eval(bar)).order;
  await A.eval(`(() => {
    const [a, b] = [...$('dmSlots').children].filter((s) => !s.hidden).map((s) => s.querySelector('.dm-chip'));
    const dt = new DataTransfer(), r = b.getBoundingClientRect(), x = r.right - 5, y = r.top + r.height / 2;
    a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  })()`);
  const order1 = (await A.eval(bar)).order;
  check('Arrastar um chip para depois de outro muda a ordem', order1[0] === order0[1] && order1[1] === order0[0], JSON.stringify(order1));
  check('A ordem fica salva', await A.eval(`JSON.parse(localStorage.getItem('dmBar.${ME}')).map((b) => friendName(b.id)).join() === ${JSON.stringify(order1.join())}`));
  await A.eval(`[...$('dmSlots').children].filter((s) => !s.hidden)[1].querySelector('.dm-chip').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }))`);
  check('Alt+← move o chip uma posição para a esquerda', (await A.eval(bar)).order.join() === order0.join());
  await A.shot('mensagens-barra-cheia.png');
  await A.eval(`dmStop()`); // não deixa a conta de mentira salva no perfil de teste
});
