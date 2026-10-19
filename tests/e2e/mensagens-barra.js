// Barra de mensagens: o envelope abre para cima, em cima da própria barra, o painel com quem está online e as conversas; Adicionar amigo sobe por cima (o HUB saiu).
// Sem servidor Razze: a conta e as conversas são de mentira, só no app (nada é enviado).
const { openApp, check, sleep, run } = require('./ajuda');

const ME = 'a'.repeat(32), BIA = 'b'.repeat(32), CAIO = 'c'.repeat(32);
const centerOf = (app, sel) => app.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const mouse = (app, type, [x, y]) => app.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
async function clickAt(app, p) { await mouse(app, 'mouseMoved', p); await sleep(60); await mouse(app, 'mousePressed', p); await mouse(app, 'mouseReleased', p); await sleep(250); }

run('Barra de mensagens abre para cima', 120000, async () => {
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
  check('Sem o HUB: a barra começa na borda esquerda da janela', await A.eval(`!$('hubRail') && $('dmBar').getBoundingClientRect().left === 0`));
  check('Abre nas conversas, sem abas e sem Adicionar amigo por cima', await A.eval(`!$('dmPanel').querySelector('.dm-panel-head [role="tablist"]') && !$('dmConvs').hidden && $('dmFriends').hidden && $('dmAddOpen').getAttribute('aria-expanded') === 'false'`));
  check('Online: a Bia, em cima das conversas', await A.eval(`!$('dmOnline').hidden && $('dmOnlineList').children.length === 1 && $('dmOnlineList').textContent.includes('Bia')`));
  check('Jogando: anel na foto e, com o mouse em cima, o cartão com o jogo', await A.eval(`(() => {
    friendsData.friends[0].activity = { game: 'Deadlock', artist: '', title: '' };
    renderDmPanel();
    const b = $('dmOnlineList').querySelector('.dm-online-person');
    b.dispatchEvent(new MouseEvent('mouseenter'));
    const ok = b.classList.contains('ativo') && !$('dmOnlinePop').hidden && $('dmOnlinePop').textContent.includes('Deadlock') && $('dmOnlinePop').textContent.includes('Jogando');
    b.dispatchEvent(new MouseEvent('mouseleave'));
    const some = $('dmOnlinePop').hidden;
    friendsData.friends[0].activity = null;
    renderDmPanel();
    return ok && some;
  })()`));
  check('Lista: Bia (com a prévia e 2 não lidas) antes do Caio', await A.eval(`(() => {
    const rows = [...$('dmPanelConvList').querySelectorAll('.hub-conv')];
    return rows.length === 2 && rows[0].textContent.includes('Bia') && rows[0].textContent.includes('oi, bora jogar?') && rows[0].querySelector('.hub-badge')?.textContent === '2' && rows[1].textContent.includes('Caio');
  })()`));
  check('O botão fica marcado como aberto e a busca recebe o foco', await A.eval(`$('dmBarLabel').getAttribute('aria-expanded') === 'true' && document.activeElement === $('dmPanelFilter')`));
  await A.eval(`(() => { const f = $('dmPanelFilter'); f.value = 'cai'; f.dispatchEvent(new Event('input')); })()`);
  check('Buscar filtra a lista', await A.eval(`$('dmPanelConvList').querySelectorAll('.hub-conv').length === 1 && $('dmPanelConvList').textContent.includes('Caio')`));
  // O X de limpar a busca: clicar um pouco fora do desenho do X (a 6 px do centro) ainda limpa
  const campo = await A.eval(`(() => { const r = $('dmPanelFilter').getBoundingClientRect(); return [r.right - 18 - 8, r.top + r.height / 2 + 6]; })()`);
  await clickAt(A, campo);
  check('O X da busca é fácil de acertar: clicar perto dele limpa o campo', await A.eval(`$('dmPanelFilter').value === ''`), await A.eval(`$('dmPanelFilter').value`));
  await A.eval(`(() => { const f = $('dmPanelFilter'); f.value = ''; f.dispatchEvent(new Event('input')); })()`);
  await A.shot('mensagens-barra.png');
  // Buscar alguém que não está na lista: depois da pausa, abre Adicionar amigo com o nome no campo
  await A.eval(`(() => { const f = $('dmPanelFilter'); f.value = 'zeca'; f.dispatchEvent(new Event('input')); })()`);
  check('Busca sem ninguém ainda não abre Adicionar amigo durante a digitação', await A.eval(`$('dmFriends').hidden`));
  await sleep(1100);
  check('Depois da pausa, abre Adicionar amigo com o nome no campo, Enviar ativo e a busca limpa', await A.eval(`!$('dmFriends').hidden && $('razzeFriendNickname').value === 'zeca' && document.activeElement === $('razzeFriendNickname') && !$('razzeAddFriend').disabled && $('dmPanelFilter').value === '' && $('dmPanelConvList').querySelectorAll('.hub-conv').length === 2`));
  const fechar = await A.eval(`(() => { const a = $('dmAddOpen').getBoundingClientRect(), b = $('dmAddClose').getBoundingClientRect(), c = $('dmPanelClose').getBoundingClientRect(); return [a.width, a.height, b.width, b.height, c.width, c.height]; })()`);
  check('Os X têm o tamanho do botão de adicionar amigo', fechar.every((v) => v === fechar[0]), JSON.stringify(fechar));
  await A.shot('mensagens-barra-busca-adicionar.png');
  await A.eval(`(() => { setFriendsAddOpen(false); setDmPanel(true, 'convs'); })()`);

  // Um pedido que chegou: número no botão de adicionar amigo e no envelope; o botão sobe Adicionar amigo em Recebidos
  await A.eval(`(() => { friendsData.incoming = [{ id: '${'1'.repeat(32)}', userId: '${'d'.repeat(32)}', displayName: 'Duda' }]; renderAmigos(); renderDmPanel(); })()`);
  check('Pedido de amizade: número no envelope (2 + 1) e no botão de adicionar amigo', await A.eval(`$('dmBarBadge').textContent === '3' && !$('dmAddBadge').hidden && $('dmAddBadge').textContent === '1'`));
  await clickAt(A, await centerOf(A, '#dmAddOpen'));
  check('Adicionar amigo sobe por cima das conversas, em Recebidos, com Aceitar e o foco no campo', await A.eval(`!$('dmPanel').hidden && !$('dmFriends').hidden && !$('dmAddBackdrop').hidden && $('dmAddOpen').getAttribute('aria-expanded') === 'true'
    && friendsFilter.view === 'in' && document.activeElement === $('razzeFriendNickname') && [...$('razzeFriends').querySelectorAll('.hub-request')].some((li) => li.textContent.includes('Duda') && li.textContent.includes('Aceitar'))`));
  await A.shot('mensagens-barra-amigos.png');
  await A.eval(`(() => { friendsFilter.view = 'all'; friendsData.incoming = []; renderAmigos(); })()`);
  await A.eval(`(() => { friendsFilter.view = 'in'; renderFriends(); })()`);
  check('Sem pedidos: o aviso fica logo embaixo das abas, não no pé do painel', await A.eval(`(() => { const t = $('friendsViews').getBoundingClientRect(), e = $('friendsEmpty').getBoundingClientRect(); return !$('friendsEmpty').hidden && e.top - t.bottom < 40; })()`));
  check('Enviar só fica ativo com algo digitado', await A.eval(`(() => { const i = $('razzeFriendNickname'); const antes = $('razzeAddFriend').disabled; i.value = 'ze'; i.dispatchEvent(new Event('input')); const depois = $('razzeAddFriend').disabled; i.value = ''; i.dispatchEvent(new Event('input')); return antes && !depois && $('razzeAddFriend').disabled; })()`));
  await A.eval(`(() => { friendsFilter.view = 'all'; renderFriends(); })()`);
  check('Amigos: Bia online com Mensagem, Caio offline', await A.eval(`(() => { const t = $('razzeFriends').textContent; return t.includes('Online · 1') && t.includes('Bia') && t.includes('Offline · 1') && !!$('razzeFriends').querySelector('[data-focus="talk:${BIA}"]'); })()`));
  // Em que sala a Bia está (presença com o resumo, docs/spec/sala-do-amigo.md): no lugar de "Online"
  await A.eval(`updateFriendsPresence({ friends: [{ id: '${BIA}', online: true, sala: { modo: 'radmin', host: 'Caio', pessoas: 3, voz: false } }, { id: '${CAIO}', online: false, sala: null }], updatedAt: Date.now(), error: '' })`);
  check('Amigo numa sala da Radmin: "Na sala de Caio · Radmin · 3 pessoas"', await A.eval(`$('razzeFriends').querySelector('[data-friend-presence="${BIA}"]').textContent === 'Na sala de Caio · Radmin · 3 pessoas'`));
  await A.eval(`(() => { const b = $('friendsViews').querySelector('[aria-selected="true"]'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); })()`);
  check('Seta troca entre Recebidos, Enviados e Amigos', await A.eval(`friendsFilter.view === 'out' && document.activeElement.dataset.view === 'out'`));
  await A.eval(`$('razzeFriendNickname').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Esc fecha Adicionar amigo e volta para as conversas (o painel fica aberto)', await A.eval(`!$('dmPanel').hidden && $('dmFriends').hidden && $('dmAddBackdrop').hidden && document.activeElement === $('dmAddOpen')`));

  await clickAt(A, await centerOf(A, '#dmBarLabel'));
  check('Clicar de novo fecha', await A.eval(`$('dmPanel').hidden && $('dmBarLabel').getAttribute('aria-expanded') === 'false'`));
  await clickAt(A, await centerOf(A, '#dmBarLabel'));
  await A.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  check('Esc fecha', await A.eval(`$('dmPanel').hidden`));
  await clickAt(A, await centerOf(A, '#dmBarLabel'));
  await clickAt(A, [400, 200]);
  check('Clicar fora fecha', await A.eval(`$('dmPanel').hidden`));

  await clickAt(A, await centerOf(A, '#dmBarLabel'));
  await clickAt(A, await centerOf(A, '#dmPanelConvList > .hub-conv'));
  await A.waitFor(`dm.bar.some((b) => b.id === '${BIA}' && b.open)`, 5000);
  check('Clicar na conversa abre a janela dela na barra e fecha a lista', await A.eval(`$('dmPanel').hidden && !document.querySelector('.dm-slot.open .dm-window').hidden && dm.convs.get('${BIA}').unread === 0`));
  await sleep(300); // o trilho sobe numa animação curta
  check('Com a janela aberta, o envelope vira um trilho colado nela, com a conversa marcada, e os dois descem até o chão, sem o envelope e sem linha no pé', await A.eval(`(() => {
    const t = $('dmTrilho').getBoundingClientRect(), w = document.querySelector('.dm-slot.open .dm-window').getBoundingClientRect();
    const f = document.querySelector('.dm-slot.open .dm-form').getBoundingClientRect(), e = $('dmTrilho').getBoundingClientRect();
    return !$('dmTrilho').hidden && Math.abs(t.right - w.left) < 2 && Math.abs(t.top - w.top) < 2 && !!$('dmTrilho').querySelector('.dm-trilho-p.ativa')
      && Math.abs(f.bottom - e.bottom) < 2 && Math.abs(w.bottom - innerHeight) < 2 && Math.abs(t.bottom - w.bottom) < 2
      && getComputedStyle($('dmBarLabel')).visibility === 'hidden' && getComputedStyle(document.querySelector('.dm-slot.open .dm-form')).boxShadow === 'none';
  })()`), await A.eval(`(() => { const r = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); };
    return JSON.stringify({ trilho: r($('dmTrilho')), janela: r(document.querySelector('.dm-slot.open .dm-window')), campo: r(document.querySelector('.dm-slot.open .dm-form')), }); })()`));
  await A.shot('mensagens-barra-trilho.png');

  // Muitas conversas na barra (uma aberta por vez): as que não cabem vão para o "+N", e nada passa da borda da janela
  const ids = ['d', 'e', 'f', 'g', 'h'].map((ch) => ch.repeat(32));
  await A.eval(`(() => {
    Array.from({ length: 30 }, (_, i) => 'x' + String(i).padStart(31, '0')).forEach((id, i) => { friendsData.friends.push({ id, displayName: 'Extra ' + (i + 1), online: false }); dmPutInBar(id, false); });
    ${JSON.stringify(ids)}.forEach((id, i) => { friendsData.friends.push({ id, displayName: 'Amigo ' + (i + 1), online: i % 2 === 0 }); dmPutInBar(id, i < 3); });
    dmConv('${'h'.repeat(32)}').unread = 3;
    dm.bar.forEach((b) => { b.open = false; }); // o "+N" é da barra sem janela aberta (com ela, as conversas ficam no trilho)
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
  // O clique fora minimiza a conversa aberta: a barra ganha espaço e o "+N" esconde menos (conta de novo)
  const b1b = await A.eval(bar);
  check('Clicar no "+N" lista as escondidas, para cima', listed.length >= 1 && listed.length === b1b.order.length - b1b.shown && await A.eval(`$('dmMoreMenu').getBoundingClientRect().bottom <= $('dmBar').getBoundingClientRect().top + 1`), JSON.stringify(listed));
  await clickAt(A, await centerOf(A, '#dmMoreMenu .dm-more-item:last-child'));
  await A.waitFor(`dm.bar.find((b) => b.id === '${'h'.repeat(32)}').open && !dm.convs.get('${'h'.repeat(32)}').el.slot.hidden`, 5000);
  const b2 = await A.eval(bar);
  check('Escolher uma no "+N" traz ela para a barra, aberta, sem passar da borda', b2.right <= b2.width && b2.order.indexOf('Amigo 5') < b2.shown, JSON.stringify(b2));
  // O trilho recebe o clique de verdade (antes o pointerdown fora da janela minimizava e o trilho sumia debaixo do mouse)
  await sleep(300);
  await clickAt(A, await centerOf(A, '#dmTrilho .dm-trilho-p:not(.ativa)'));
  check('Clicar em outra pessoa no trilho troca a conversa aberta', await A.eval(`(() => { const a = dm.bar.find((b) => b.open); return !!a && a.id !== '${'h'.repeat(32)}' && !$('dmTrilho').hidden; })()`));
  const aberta = await A.eval(`dm.bar.find((b) => b.open).id`);
  await clickAt(A, await centerOf(A, '#dmTrilho .dm-trilho-p.ativa'));
  await clickAt(A, await centerOf(A, '.dm-slot.open .dm-name'));
  check('Clicar na pessoa da conversa aberta (no trilho ou no topo) não fecha a janela', await A.eval(`dm.bar.find((b) => b.open)?.id === '${aberta}' && document.activeElement === dm.convs.get('${aberta}').el.input`));
  await clickAt(A, await centerOf(A, '#dmTrilho .dm-trilho-mais'));
  check('O + do trilho minimiza a conversa e abre o painel no lugar dela, sem os dois um por cima do outro', await A.eval(`!$('dmPanel').hidden && !dm.bar.some((b) => b.open) && $('dmTrilho').hidden`));
  await clickAt(A, await centerOf(A, '#dmBarLabel'));
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
