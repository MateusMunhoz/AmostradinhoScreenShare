// Qualidade 4K (2160p 30 fps): Ana transmite a câmera falsa em 3840×2160 e Bia assiste, no modo normal (WebRTC) e
// no "uma vez só" pelo WebCodecs (H.264 nível 5.1). Depois, se o PC tiver NVENC, a tela de verdade no NVENC
// direto: sem aumentar a imagem de uma tela menor que 4K, e com a taxa proporcional ao tamanho.
const { openApp, createRoom, joinRoom, check, sleep, run } = require('./ajuda');

const PORT = 18951;
const SHARE = (mode) => `(() => {
  navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 3840, height: 2160, frameRate: 30 }, audio: false });
  onceSupportCache = Promise.resolve({ engine: 'webcodecs' });
  $('soundOn').checked = false; setRadio('quality', '2160p30'); setRadio('encodeMode', '${mode}'); state.selectedSource = 'teste'; return startSharing();
})()`;
const RX = `(() => { const v = [...state.in.values()][0].tile.video; return { w: v.videoWidth, h: v.videoHeight }; })()`;

run('Qualidade 4K', 180000, async () => {
  const A = await openApp('k4A', 9651, { fake: true });
  await createRoom(A, { name: 'Ana', port: PORT });
  check('4K aparece na janela de transmitir', await A.eval(`!!document.querySelector('input[name="quality"][value="2160p30"]') && QUALITY['2160p30'].w === 3840`));

  // 1) Modo normal: o WebRTC começa menor e sobe com a banda; 4K chega em alguns segundos
  await A.eval(SHARE('per'));
  await A.waitFor(`state.sharing`, 15000);
  const cap = await A.eval(`(() => { const s = state.stream.getVideoTracks()[0].getSettings(); return s.width + 'x' + s.height; })()`);
  const B = await openApp('k4B', 9652, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: `127.0.0.1:${PORT}` });
  await B.eval(`watch([...state.members].find(([, m]) => m.sharing)[0])`);
  await B.waitFor(`[...state.in.values()].every((l) => l.tile.video.videoWidth > 0)`, 20000);
  await B.waitFor(`[...state.in.values()][0].tile.video.videoWidth >= 3840`, 25000).catch(() => {});
  const rx1 = await B.eval(RX);
  const max = await A.eval(`[...state.out.values()][0].pc.getSenders().find((s) => s.track && s.track.kind === 'video').getParameters().encodings[0].maxBitrate`);
  check('Normal: a Bia recebe em 4K', rx1.w === 3840 && rx1.h === 2160, `captura ${cap}, recebe ${rx1.w}x${rx1.h}`);
  check('Normal: taxa de 20 Mbps numa tela 4K', max === 20_000_000, max);
  await A.eval(`stopSharing()`);
  await B.waitFor(`state.in.size === 0`, 8000);

  // 2) Uma vez só pelo WebCodecs: H.264 nível 5.1 (o 4.2 vai só até 1080p)
  await A.eval(SHARE('once'));
  await A.waitFor(`state.sharing && once.active`, 15000);
  check('Uma vez só: o codificador escolheu o nível 5.1', await A.eval(`/^avc1\\.(6400|4d00|4200)33$/.test(once.base.codec)`), await A.eval(`once.base.codec + (once.hardware ? ' (placa de vídeo)' : ' (processador)')`));
  await B.waitFor(`[...state.members.values()].some((m) => m.sharing)`, 8000);
  await B.eval(`watch([...state.members].find(([, m]) => m.sharing)[0])`);
  await B.waitFor(`[...state.in.values()][0]?.tile.video.videoWidth >= 3840`, 20000).catch(() => {});
  const rx2 = await B.eval(RX);
  check('Uma vez só: a Bia decodifica e vê em 4K', rx2.w === 3840 && rx2.h === 2160, `${rx2.w}x${rx2.h}`);
  await A.eval(`stopSharing()`);
  await B.waitFor(`state.in.size === 0`, 8000);

  // 3) NVENC direto com a tela de verdade (se este PC tiver)
  await A.eval(`onceSupportCache = null`);
  if ((await A.eval(`onceSupport().then((s) => s && s.engine)`)) !== 'nvenc') {
    console.log('      (sem NVENC neste PC: a parte do NVENC direto foi pulada)');
    return;
  }
  const scr = await A.eval(`window.api.getSources().then((l) => { state.sources = l; return (l.find((x) => x.id.startsWith('screen')) || {}).id; })`);
  await A.eval(`(() => { $('soundOn').checked = false; setRadio('quality', '2160p30'); setRadio('encodeMode', 'once'); state.selectedSource = '${scr}'; return startSharing(); })()`);
  await A.waitFor(`state.sharing`, 20000);
  const nv = await A.eval(`({ engine: once.engine, w: once.width, h: once.height, codec: once.base.codec, rate: bitrateFor(QUALITY['2160p30'], once.width, once.height) })`);
  const tela = await A.eval(`(() => ({ w: Math.round(screen.width * devicePixelRatio), h: Math.round(screen.height * devicePixelRatio) }))()`);
  check('NVENC direto: começou em 4K', nv.engine === 'nvenc', JSON.stringify(nv));
  check('NVENC direto: não aumenta uma tela menor que 4K', nv.w <= Math.max(tela.w, 3840) && (tela.w >= 3840 || nv.w <= tela.w), `tela ${tela.w}x${tela.h}, envia ${nv.w}x${nv.h}`);
  check('NVENC direto: taxa proporcional ao tamanho', nv.rate === (nv.w >= 3840 ? 20_000_000 : Math.max(4_500_000, Math.round(20_000_000 * (nv.w * nv.h) / (3840 * 2160)))), `${(nv.rate / 1e6).toFixed(1)} Mbps`);
  await B.waitFor(`[...state.members.values()].some((m) => m.sharing)`, 8000);
  await B.eval(`watch([...state.members].find(([, m]) => m.sharing)[0])`);
  await B.waitFor(`[...state.in.values()][0]?.tile.video.videoWidth > 0`, 20000);
  const rx3 = await B.eval(RX);
  check('NVENC direto: a Bia recebe na resolução da tela', rx3.w === nv.w, `${rx3.w}x${rx3.h}`);
});
