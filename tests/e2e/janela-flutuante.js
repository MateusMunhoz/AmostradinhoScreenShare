// Janela flutuante: Ana transmite a câmera falsa, Bia abre a janela e confere os modos (ajuste, travada,
// app escondido) e o fechamento. Confere os estilos de verdade da janela no Windows.
const { openApp, createRoom, joinRoom, share, frames, winStyle, check, sleep, run } = require('./ajuda');

const TITLE = 'Ana · Tela P2P';
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

  await B.eval(`[...state.in.values()][0].tile.pipBtn.click()`);
  await B.waitFor(`state.pips.size && ${pipVideo}.videoWidth > 0`, 10000);
  const f = await frames(B, pipVideo);
  check('Janela flutuante abre com o vídeo tocando', f > 10, `${f} quadros em 1,5 s`);
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
