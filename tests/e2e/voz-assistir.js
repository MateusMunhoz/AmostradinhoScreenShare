// Painel Voz: quem está transmitindo tem o botão Assistir na frente do nome (na voz ou numa seção
// "Transmitindo, fora da voz"); clicar começa a assistir e o botão vira Parar.
const { openApp, createRoom, joinRoom, check, sleep, run, FAKE } = require('./ajuda');
FAKE.push('--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'); // para a foto

const SHARE = `(() => {
  navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false });
  $('soundOn').checked = false; setRadio('encodeMode', 'per'); state.selectedSource = 'teste'; return startSharing();
})()`;
const TONE = `(() => { window.tctx = new AudioContext(); const o = tctx.createOscillator(); const dst = tctx.createMediaStreamDestination(); o.connect(dst); o.start(); voice.media = { getUserMedia: async () => dst.stream }; })()`;
const ROW = (id) => `document.querySelector('#voicePaneMembers .member[data-person="${id}"]')`;

run('Assistir pelo painel Voz', 90000, async () => {
  const A = await openApp('vaA', 9541, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18831 });
  await A.eval(SHARE);
  await A.waitFor(`state.sharing`, 15000);
  const anaId = await A.eval('state.myId');
  const B = await openApp('vaB', 9542, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18831' });
  await B.eval(`setPainelSala({ aba: 'voz', juntos: false, recolhido: false })`);
  await B.waitFor(`!!${ROW(anaId)}`, 5000);
  check('Ana transmite fora da voz: aparece em "Transmitindo, fora da voz"', await B.eval(`$('voicePaneMembers').querySelector('.members-sub')?.textContent === 'Transmitindo, fora da voz'`));
  const btn = `[...${ROW(anaId)}.querySelectorAll('button')].find((b) => /Assistir|Parar/.test(b.textContent))`;
  check('Botão Assistir na frente do nome', await B.eval(`${btn}?.textContent === 'Assistir'`));
  await B.eval(`${btn}.click()`);
  await B.waitFor(`state.in.size === 1 && [...state.in.values()][0].tile.video.videoWidth > 0`, 20000);
  check('Clicar começa a assistir, e o botão vira Parar', await B.eval(`${btn}?.textContent === 'Parar'`));

  await A.eval(TONE);
  await A.eval(`$('voiceJoin').click()`);
  await B.waitFor(`voice.members.get('${anaId}')?.session`, 10000);
  await sleep(300);
  check('Ana entra na voz: continua com o botão, agora na lista da voz', await B.eval(`!$('voicePaneMembers').querySelector('.members-sub') && ${btn}?.textContent === 'Parar'`));
  await B.eval(`${btn}.click()`);
  await sleep(500);
  check('Parar tira a tela e volta o Assistir', await B.eval(`state.in.size === 0 && ${btn}?.textContent === 'Assistir'`));
  await B.shot('voz-assistir.png');
});
