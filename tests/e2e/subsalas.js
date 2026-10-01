// Subsalas: arrastar pessoas de um canal para outro no painel de voz, e a faixa de controles (microfone, fone, Sair)
// sempre à vista embaixo, mesmo com tantas subsalas que a lista precisa rolar.
const { openApp, createRoom, joinRoom, check, sleep, run } = require('./ajuda');

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

run('Subsalas: arrastar pessoas e controles da voz fixos', 120000, async () => {
  const A = await openApp('subA', 9491, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18811 });
  const B = await openApp('subB', 9492, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18811' });
  const [anaId, biaId] = [await A.eval('state.myId'), await B.eval('state.myId')];
  check('O servidor sabe mover os outros', await A.eval('state.subsalaMove') && await B.eval('state.subsalaMove'));
  await A.eval(`(() => { workspaceViews.voice = true; saveWorkspaceViews(); syncWorkspace(); })()`);
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
  check('Microfone e fone na barra', await A.eval(`!$('paneVoiceMute').hidden && !$('paneVoiceDeafen').hidden`));
});
