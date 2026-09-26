// Trocar o que transmitir no meio da transmissão, nos três modos, sem quem assiste reconectar.
// No lugar da tela, a Ana transmite um quadro colorido: vermelho antes da troca, azul depois. A Bia confere
// a cor do vídeo que chega. Por último, o NVENC direto (se o PC tiver) troca entre duas fontes de verdade.
const { openApp, createRoom, joinRoom, frames, check, sleep, run } = require('./ajuda');

const PORT = 18802;
const video = '[...state.in.values()][0].tile.video';

// A "tela" é um canvas pintado com a cor de window.corDaTela no momento em que é capturado
const FAKE_SCREEN = `(() => {
  window.corDaTela = 'red';
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); const cor = window.corDaTela;
    setInterval(() => { g.fillStyle = cor; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.fillRect(Math.random() * 600, 10, 20, 20); }, 33);
    return c.captureStream(30);
  };
})()`;

// Cor do meio do vídeo que a Bia está vendo
const colorSeen = (B) => B.eval(`(() => {
  const v = ${video}; const c = document.createElement('canvas'); c.width = 64; c.height = 36;
  c.getContext('2d').drawImage(v, 0, 0, 64, 36);
  const [r, g, b] = c.getContext('2d').getImageData(32, 30, 1, 1).data;
  return r > 150 && b < 100 ? 'vermelho' : b > 150 && r < 100 ? 'azul' : \`outra (\${r},\${g},\${b})\`;
})()`);

async function startShare(A, mode) {
  await A.eval(`(() => { $('soundOn').checked = false; setRadio('encodeMode', '${mode}'); state.selectedSource = 'fonte-1'; return startSharing(); })()`);
  await A.waitFor(`state.sharing`, 20000);
}

async function switchTo(A, id, cor) {
  await A.eval(`(() => { window.corDaTela = '${cor}'; openShareDialog(true); state.selectedSource = '${id}'; return switchSource(); })()`);
  await A.waitFor(`!state.shareSwitching && state.sharingSource === '${id}'`, 20000);
}

run('Trocar o que transmitir', 200000, async () => {
  const A = await openApp('trocaA', 9511);
  await A.eval(FAKE_SCREEN);
  await createRoom(A, { name: 'Ana', port: PORT });
  const B = await openApp('trocaB', 9512);
  await joinRoom(B, { name: 'Bia', addr: `127.0.0.1:${PORT}` });

  // 1) Modo normal (uma codificação por pessoa)
  await startShare(A, 'per');
  await B.waitFor(`[...state.members.values()].some((m) => m.sharing)`);
  await B.eval(`watch([...state.members].find(([, m]) => m.sharing)[0])`);
  await B.waitFor(`${video}.videoWidth > 0`, 20000);
  await sleep(800);
  check('Antes: a Bia vê a primeira fonte (vermelho)', (await colorSeen(B)) === 'vermelho', await colorSeen(B));
  await A.eval(`$('switchShareBtn').click()`);
  await sleep(300);
  check('"Trocar" abre a janela no modo de troca', await A.eval(`!$('shareDialog').hidden && $('shareDialog').classList.contains('switching') && $('shareTitle').textContent === 'Trocar o que transmitir' && $('startBtn').textContent === 'Trocar para esta' && $('startBtn').disabled`));
  check('No modo de troca, qualidade e som ficam escondidos', await A.eval(`getComputedStyle(document.querySelector('.share-settings')).display === 'none'`));
  await A.eval(`closeShareDialog()`);
  const f0 = await frames(B, video);
  await B.eval(`window.pcAntes = [...state.in.values()][0].pc`);
  await switchTo(A, 'fonte-2', 'blue');
  await sleep(1500);
  check('Modo normal: depois da troca a Bia vê a fonte nova (azul)', (await colorSeen(B)) === 'azul', await colorSeen(B));
  check('Modo normal: a mesma conexão, sem reconectar', await B.eval(`[...state.in.values()][0].pc === window.pcAntes && window.pcAntes.connectionState === 'connected'`));
  const f1 = await frames(B, video);
  check('Modo normal: o vídeo continua andando como antes', f1 >= Math.min(10, f0 * 0.6), `${f1} quadros em 1,5 s (antes ${f0})`);
  check('A transmissão não parou', await A.eval(`state.sharing && state.stream.getVideoTracks().length === 1`));

  // 2) Uma vez só (WebCodecs com a "tela" de teste; o NVENC não consegue capturar um canvas)
  await A.eval(`stopSharing()`);
  await B.waitFor(`state.in.size === 0`, 8000);
  // Força o WebCodecs (com NVENC no PC, o 'uma vez só' iria para o NVENC, que captura a tela de verdade)
  await A.eval(`window.corDaTela = 'red'; onceSupportCache = Promise.resolve({ engine: 'webcodecs', hardware: true })`);
  await startShare(A, 'once');
  check('Uma vez só começou pelo WebCodecs', await A.eval(`once.active && once.engine === 'webcodecs'`), await A.eval(`once.engine`));
  await B.waitFor(`[...state.members.values()].some((m) => m.sharing)`);
  await B.eval(`watch([...state.members].find(([, m]) => m.sharing)[0])`);
  await B.waitFor(`${video}.videoWidth > 0`, 20000);
  await sleep(800);
  check('WebCodecs, antes: vermelho', (await colorSeen(B)) === 'vermelho', await colorSeen(B));
  await B.eval(`window.pcAntes = [...state.in.values()][0].pc`);
  await switchTo(A, 'fonte-2', 'blue');
  await sleep(1500);
  check('WebCodecs: depois da troca, azul', (await colorSeen(B)) === 'azul', await colorSeen(B));
  check('WebCodecs: a mesma conexão e ainda uma vez só', (await B.eval(`[...state.in.values()][0].pc === window.pcAntes && !![...state.in.values()][0].once`)) && (await A.eval(`once.active && once.engine === 'webcodecs'`)));

  // 3) NVENC direto, se este PC tiver: troca entre duas fontes de verdade (telas ou janelas)
  await A.eval(`stopSharing()`);
  await B.waitFor(`state.in.size === 0`, 8000);
  await A.eval(`onceSupportCache = null`);
  const support = await A.eval(`onceSupport().then((s) => s && s.engine)`);
  if (support !== 'nvenc') {
    console.log('      (sem NVENC neste PC: a parte do NVENC direto foi pulada)');
    return;
  }
  const ids = await A.eval(`window.api.getSources().then((l) => { state.sources = l; const s = l.filter((x) => x.id.startsWith('screen')); const w = l.filter((x) => !x.id.startsWith('screen') && !x.dark && /Tela P2P/.test(x.name)); return [s[0] && s[0].id, (w[0] || s[1] || {}).id]; })`);
  if (!ids[0] || !ids[1]) {
    console.log('      (não achei duas fontes de verdade: a parte do NVENC direto foi pulada)');
    return;
  }
  await A.eval(`(() => { $('soundOn').checked = false; setRadio('encodeMode', 'once'); state.selectedSource = '${ids[0]}'; return startSharing(); })()`);
  await A.waitFor(`state.sharing`, 20000);
  check('NVENC direto começou', await A.eval(`once.active && once.engine === 'nvenc'`), await A.eval(`once.engine`));
  await B.waitFor(`[...state.members.values()].some((m) => m.sharing)`);
  await B.eval(`watch([...state.members].find(([, m]) => m.sharing)[0])`);
  await B.waitFor(`${video}.videoWidth > 0`, 20000);
  const size0 = await B.eval(`${video}.videoWidth + 'x' + ${video}.videoHeight`);
  await B.eval(`window.pcAntes = [...state.in.values()][0].pc`);
  await A.eval(`(() => { openShareDialog(true); state.selectedSource = '${ids[1]}'; return switchSource(); })()`);
  await A.waitFor(`state.sharingSource === '${ids[1]}'`, 20000);
  await sleep(2000);
  const size1 = await B.eval(`${video}.videoWidth + 'x' + ${video}.videoHeight`);
  const f3 = await frames(B, video);
  check('NVENC direto: continua no NVENC depois da troca', await A.eval(`once.active && once.engine === 'nvenc'`), await A.eval(`once.engine`));
  check('NVENC direto: o vídeo continua chegando, na mesma conexão', f3 > 5 && (await B.eval(`[...state.in.values()][0].pc === window.pcAntes`)), `${f3} quadros; ${size0} -> ${size1}`);

  // Ver a própria transmissão no NVENC direto: uma captura leve só para ver, sem mexer no que a Bia recebe
  await A.eval(`watchSelf()`);
  await A.waitFor(`state.in.get(state.myId)?.tile.video.videoWidth > 0`, 15000);
  check('NVENC direto: dá para se ver (captura só para ver)', await A.eval(`!!state.in.get(state.myId).ownTrack && once.engine === 'nvenc'`));
  check('NVENC direto: a Bia continua recebendo enquanto a Ana se vê', (await frames(B, video)) > 5);
  await A.eval(`stopWatching(state.myId, false)`);
  check('Parar de se ver fecha a captura extra', await A.eval(`!state.in.has(state.myId)`));
});
