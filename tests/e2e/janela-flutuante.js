// Janela flutuante: Ana transmite a câmera falsa, Bia abre a janela e confere os modos (ajuste, travada,
// app escondido) e o fechamento. Confere os estilos de verdade da janela no Windows.
const { openApp, createRoom, joinRoom, share, frames, winStyle, check, sleep, run } = require('./ajuda');

const TITLE = 'Ana · Nebula';
const pipVideo = '[...state.pips.values()][0].video';

run('Janela flutuante', 150000, async () => {
  const A = await openApp('pipA', 9411, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18792 });
  await share(A);
  const B = await openApp('pipB', 9412);
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18792' });
  await B.waitFor(`[...state.members.values()].some((m) => m.sharing)`);
  await B.eval(`watch([...state.members].find(([, m]) => m.sharing)[0])`);
  await B.waitFor(`[...state.in.values()].every((l) => l.tile.video.videoWidth > 0)`, 20000);

  // O som da transmissão começa em 0%; a roda do mouse em cima da tela aumenta, e fica guardado
  const t0 = `[...state.in.values()][0].tile`;
  check('Som da tela começa em 0%', await B.eval(`${t0}.video.volume === 0 && ${t0}.vol.value === '0'`));
  await B.eval(`(() => { const el = ${t0}.el; const r = el.getBoundingClientRect(); for (let i = 0; i < 3; i++) el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: r.x + 50, clientY: r.y + 50, bubbles: true, cancelable: true })); })()`);
  check('Roda para cima na tela: 15%, guardado pelo nome', await B.eval(`Math.abs(${t0}.video.volume - 0.15) < 0.001 && JSON.parse(localStorage.getItem('volumes')).Ana.screen === 15`));
  await B.eval(`(() => { setVol([...state.in.keys()][0], { screen: 0 }); ${t0}.el.querySelector('.tile-bar .btn.icon').click(); })()`);
  check('Em 0%, o alto-falante liga o som em 100%', await B.eval(`${t0}.video.volume === 1 && !${t0}.video.muted`));
  await B.eval(`setVol([...state.in.keys()][0], { screen: 0 })`);

  await B.eval(`[...state.in.values()][0].tile.pipBtn.click()`);
  await B.waitFor(`state.pips.size && ${pipVideo}.videoWidth > 0`, 10000);
  const f = await frames(B, pipVideo);
  check('Janela flutuante abre com o vídeo tocando', f > 10, `${f} quadros em 1,5 s`);
  await B.eval(`(() => { const p = [...state.pips.values()][0]; p.win.document.dispatchEvent(new p.win.WheelEvent('wheel', { deltaY: -100, clientX: 40, clientY: 40, bubbles: true, cancelable: true })); })()`);
  check('Roda do mouse na janela flutuante: som da tela 5%', await B.eval(`volOf([...state.pips.keys()][0]).screen === 5 && [...state.pips.values()][0].win.document.getElementById('volBubble')?.textContent === 'Som da tela de Ana: 5%'`));
  await B.eval(`setVol([...state.pips.keys()][0], { screen: 0 })`);
  const tile = await B.eval(`(() => { const t = [...state.in.values()][0].tile; return { videoTracks: t.video.srcObject.getVideoTracks().length, note: !t.pipNote.hidden, text: t.pipNote.textContent }; })()`);
  check('No app: sem vídeo, com o aviso de PiP', tile.videoTracks === 0 && tile.note && /Picture in picture ativado, transmissão pausada/.test(tile.text));
  await sleep(500);
  let st = winStyle(TITLE);
  check('Sempre por cima e sem pegar o foco', st && st.topmost && st.noActivate, st && st.hex);
  check('Abre no modo de ajuste (clique não atravessa)', st && !st.transparent && (await B.eval(`[...state.pips.values()][0].edit.style.display !== 'none'`)));

  await B.eval(`window.api.pipSetEdit(false)`);
  await sleep(600);
  st = winStyle(TITLE);
  check('Travar: clique atravessa, sem foco, por cima', st && st.transparent && st.noActivate && st.topmost, st && st.hex);
  check('Travada: sem borda nem botões', await B.eval(`[...state.pips.values()][0].edit.style.display === 'none'`));

  // App escondido (jogando): a janela flutuante continua recebendo vídeo
  await B.eval(`setIncomingVideo(false)`);
  await sleep(1500);
  const f2 = await frames(B, pipVideo);
  check('App escondido: janela flutuante continua com vídeo', f2 > 10 && (await A.eval(`[...state.out.values()].every((l) => !l.videoOff)`)), `${f2} quadros em 1,5 s`);
  await B.eval(`setIncomingVideo(true)`);

  await B.eval(`window.api.pipSetEdit(true)`);
  await sleep(500);
  st = winStyle(TITLE);
  check('Destravar de novo: clique não atravessa', st && !st.transparent);

  await B.eval(`[...state.in.values()][0].tile.pipBtn.click()`);
  await sleep(800);
  check('Fechar pelo botão do vídeo', (await B.eval(`!state.pips.size`)) && winStyle(TITLE) === null);
  check('Vídeo volta para o app e o aviso some', await B.eval(`(() => { const t = [...state.in.values()][0].tile; return t.video.srcObject.getVideoTracks().length === 1 && t.pipNote.hidden; })()`));

  await B.eval(`[...state.in.values()][0].tile.pipBtn.click()`);
  await B.waitFor(`state.pips.size && ${pipVideo}.videoWidth > 0`, 10000);
  await A.eval(`stopSharing()`);
  await B.waitFor(`!state.pips.size`, 8000);
  await sleep(500);
  check('Quem transmite para: a janela flutuante fecha', winStyle(TITLE) === null);
});
