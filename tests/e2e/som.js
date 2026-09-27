// Som das transmissões: Ana transmite com um tom no lugar do som do PC; Bia assiste, põe no máximo e o som chega
// e toca (nível medido pelo WebRTC, depois do volume do vídeo), inclusive com a janela flutuante e o painel
// Transmissão desligado. Carla transmite sem o som do PC: a Bia vê "sem som" na tela (e o volume some), e a
// Carla vê "sem som" no Ao vivo.
const { openApp, createRoom, joinRoom, check, sleep, run } = require('./ajuda');

const PORT = 18941;
const SHARE = (withSound) => `(() => {
  navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false });
  createAppAudioTrack = async () => { const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); g.gain.value = 0.5; const d = c.createMediaStreamDestination(); o.connect(g); g.connect(d); o.start(); window.tomCtx = c; return d.stream.getAudioTracks()[0]; };
  $('soundOn').checked = ${withSound}; setRadio('encodeMode', 'per'); state.selectedSource = 'teste'; return startSharing();
})()`;
// Nível do som que toca na Bia (o WebRTC mede depois do volume do <video>: em 0% dá 0)
const LEVEL = (who) => `(async () => {
  const l = state.in.get([...state.members].find(([, m]) => m.name === '${who}')[0]);
  let lvl = 0; (await l.pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') lvl = s.audioLevel || 0; });
  return lvl;
})()`;
const TILE = (who) => `state.in.get([...state.members].find(([, m]) => m.name === '${who}')[0]).tile`;

run('Som das transmissões', 150000, async () => {
  const A = await openApp('somA', 9641, { fake: true });
  await createRoom(A, { name: 'Ana', port: PORT });
  await A.eval(SHARE(true));
  await A.waitFor(`state.sharing`, 15000);
  check('Ana transmite com som: o Ao vivo não diz "sem som"', await A.eval(`state.stream.getAudioTracks().length === 1 && !$('liveText').textContent.includes('sem som')`));

  const C = await openApp('somC', 9642, { fake: true });
  await joinRoom(C, { name: 'Carla', addr: `127.0.0.1:${PORT}` });
  await C.eval(SHARE(false));
  await C.waitFor(`state.sharing`, 15000);
  check('Carla transmite sem som: o Ao vivo diz "sem som"', await C.eval(`$('liveText').textContent.includes('sem som') && $('liveText').classList.contains('live-silent')`));

  const B = await openApp('somB', 9643, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: `127.0.0.1:${PORT}` });
  await B.waitFor(`[...state.members.values()].filter((m) => m.sharing).length === 2`, 10000);
  await B.eval(`[...state.members].filter(([, m]) => m.sharing).forEach(([id]) => watch(id))`);
  await B.waitFor(`state.in.size === 2 && [...state.in.values()].every((l) => l.tile.video.videoWidth > 0)`, 20000);
  await sleep(1500);

  check('Tela da Ana: sem o aviso "sem som", com o volume', await B.eval(`${TILE('Ana')}.el.querySelector('.tile-noaudio').hidden && getComputedStyle(${TILE('Ana')}.vol).display !== 'none'`));
  check('Tela da Carla: "sem som" e o volume some', await B.eval(`!${TILE('Carla')}.el.querySelector('.tile-noaudio').hidden && getComputedStyle(${TILE('Carla')}.vol).display === 'none'`));
  await B.eval(`(() => { const v = ${TILE('Ana')}.vol; v.value = '1'; v.dispatchEvent(new Event('input')); v.dispatchEvent(new Event('change')); })()`);
  await sleep(1500);
  const lvl = await B.eval(LEVEL('Ana'));
  check('Ana no máximo: o som chega e toca', lvl > 0.3, lvl.toFixed(2));
  await B.shot('som.png');
  await B.eval(`$('navStreams').click()`);
  await sleep(1200);
  const lvl2 = await B.eval(LEVEL('Ana'));
  check('Painel Transmissão desligado: o som continua', lvl2 > 0.3, lvl2.toFixed(2));
  await B.eval(`$('navStreams').click()`);
  await B.eval(`togglePip([...state.members].find(([, m]) => m.name === 'Ana')[0])`);
  await sleep(1500);
  const lvl3 = await B.eval(LEVEL('Ana'));
  check('Na janela flutuante: o som continua saindo pelo app', lvl3 > 0.3, lvl3.toFixed(2));
  await B.eval(`togglePip([...state.members].find(([, m]) => m.name === 'Ana')[0])`);

  // Tela silenciada pelo alto-falante continua muda quando alguém fala na voz (com e sem atenuação)
  const MUTE_BTN = `${TILE('Ana')}.el.querySelector('.tile-mute')`;
  await B.eval(`${MUTE_BTN}.click()`);
  await sleep(300);
  check('Alto-falante silencia a tela da Ana', await B.eval(`${TILE('Ana')}.video.muted`));
  for (const amount of [0, 60]) {
    await B.eval(`(() => { voiceCfg.duck = ${amount}; speaking.add('alguem-falando'); updateDuck(); })()`);
    await sleep(800);
    const falando = await B.eval(`${TILE('Ana')}.video.muted`);
    await B.eval(`(() => { speaking.delete('alguem-falando'); updateDuck(); })()`);
    await sleep(1200);
    check(`Alguém fala (atenuação ${amount}%): a tela continua muda`, falando && await B.eval(`${TILE('Ana')}.video.muted`));
  }
  const mudo = await B.eval(LEVEL('Ana'));
  check('E o som dela não toca', mudo < 0.05, mudo.toFixed(2));
  await B.eval(`${MUTE_BTN}.click()`);
  await sleep(1500);
  const volta = await B.eval(LEVEL('Ana'));
  check('Alto-falante de novo: o som volta', !(await B.eval(`${TILE('Ana')}.video.muted`)) && volta > 0.3, volta.toFixed(2));
});
