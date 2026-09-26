// Ver a própria transmissão: Ana transmite e se vê como um quadro na sala (sem som), abre na janela
// flutuante, e o quadro some quando ela para de transmitir. Bia continua assistindo normalmente.
const { openApp, createRoom, joinRoom, share, check, sleep, run } = require('./ajuda');

run('Ver a própria transmissão', 120000, async () => {
  const A = await openApp('proprioA', 9491, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18801 });
  check('Sem transmitir, não tem o botão de se ver', await A.eval(`$('liveChip').hidden`));
  await share(A);
  const B = await openApp('proprioB', 9492);
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18801' });
  await B.waitFor(`[...state.members.values()].some((m) => m.sharing)`);
  await B.eval(`watch([...state.members].find(([, m]) => m.sharing)[0])`);
  await B.waitFor(`[...state.in.values()].every((l) => l.tile.video.videoWidth > 0)`, 20000);

  const me = await A.eval('state.myId');
  const myRow = `[...document.querySelectorAll('#members .member')].find((li) => li.dataset.person === '${me}')`;
  check('Minha linha na lista tem "Ver"', await A.eval(`[...${myRow}.querySelectorAll('button')].some((b) => b.textContent === 'Ver')`));
  await A.eval(`$('selfViewBtn').click()`);
  await A.waitFor(`state.in.get('${me}')?.tile.video.videoWidth > 0`, 10000);
  check('Ana se vê: um quadro com o vídeo da própria captura', await A.eval(`state.in.get('${me}').self && !$('tiles').hidden`));
  check('Quadro sem som e sem o controle de volume', await A.eval(`(() => { const t = state.in.get('${me}').tile; return t.video.muted && t.vol.hidden && !t.video.srcObject.getAudioTracks().length; })()`));
  check('Botão do olho marcado e a linha diz "Parar de ver"', await A.eval(`$('selfViewBtn').getAttribute('aria-pressed') === 'true' && [...${myRow}.querySelectorAll('button')].some((b) => b.textContent === 'Parar de ver')`));
  check('Nenhum pedido de vídeo foi para a sala (sem conexão consigo mesma)', await A.eval(`state.out.size === 1`));

  await A.eval(`togglePip('${me}')`);
  await sleep(800);
  check('Janela flutuante com a própria tela', await A.eval(`state.pips.has('${me}') && state.pips.get('${me}').video.srcObject.getVideoTracks().length === 1`));
  await A.eval(`closePip('${me}')`);
  await sleep(300);
  check('Fechou a janela: o vídeo volta para o quadro', await A.eval(`state.in.get('${me}').tile.video.srcObject.getVideoTracks().length === 1`));

  await A.eval(`$('selfViewBtn').click()`);
  await sleep(300);
  check('Clicar de novo tira o quadro, e a transmissão continua', await A.eval(`!state.in.has('${me}') && state.sharing`));
  check('Bia continua recebendo', await B.eval(`[...state.in.values()][0].tile.video.videoWidth > 0`));

  await A.eval(`$('selfViewBtn').click()`);
  await A.waitFor(`state.in.has('${me}')`, 5000);
  await A.eval(`stopSharing()`);
  await sleep(300);
  check('Parar de transmitir tira o quadro', await A.eval(`!state.in.has('${me}') && $('tiles').hidden`));
});
