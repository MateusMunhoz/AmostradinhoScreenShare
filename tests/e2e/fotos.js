// Foto de perfil sem servidor: a Ana escolhe uma foto; a Bia entra e vê a foto na lista e no chat (pedida
// direto à Ana pelo hash); a Ana troca e tira a foto com a sala aberta; foto já guardada não é pedida de novo;
// foto que não bate com o hash, ou que ninguém pediu, é jogada fora.
const { openApp, createRoom, joinRoom, check, sleep, run, FAKE } = require('./ajuda');
FAKE.push('--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion');

// Uma "foto" 300x200 de uma cor, como se viesse do PC
const PICK = (color) => `(async () => {
  const c = new OffscreenCanvas(300, 200); const g = c.getContext('2d'); g.fillStyle = '${color}'; g.fillRect(0, 0, 300, 200);
  await setMyPhoto(new File([await c.convertToBlob({ type: 'image/jpeg' })], 'eu.jpg', { type: 'image/jpeg' }));
  return fotos.mine.hash;
})()`;
const ANA_ROW = (anaId) => `document.querySelector('#members .member[data-person="${anaId}"] .avatar')`;
// Cor do meio da foto pintada numa bolinha
const COLOR = (sel) => `(async () => {
  const el = ${sel}; if (!el || !el.classList.contains('photo')) return 'sem foto';
  const url = el.style.backgroundImage.slice(5, -2); const img = new Image(); img.src = url; await img.decode();
  const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const [r, gr, b] = g.getImageData(img.width / 2, img.height / 2, 1, 1).data; return r > 200 && gr < 60 ? 'vermelha' : b > 200 && r < 60 ? 'azul' : 'outra';
})()`;

run('Foto de perfil', 120000, async () => {
  const A = await openApp('fotoA', 9501, { fake: true });
  const hashRed = await A.eval(PICK('#ff0000'));
  const mine = await A.eval(`(() => { const b = atob(fotos.mine.data); return { bytes: b.length, webp: b.slice(8, 12) === 'WEBP' }; })()`);
  check('A foto vira uma WebP pequena', mine.webp && mine.bytes < 32 * 1024, `${mine.bytes} bytes`);
  check('Perfil e botão do perfil mostram a foto', await A.eval(`$('profileAvatar').classList.contains('photo') && $('navProfileAvatar').classList.contains('photo') && !$('profilePhotoRemove').hidden`));
  await A.eval(`openProfilePopup()`);
  await sleep(300);
  await A.shot('foto-perfil.png');
  await A.eval(`closeProfilePopup()`);
  await createRoom(A, { name: 'Ana', port: 18801 });
  const anaId = await A.eval('state.myId');

  const B = await openApp('fotoB', 9502, { fake: true });
  await B.eval(`(() => { window.pedidos = 0; const s = sendSignal; sendSignal = (to, d) => { if (d.side === 'foto') pedidos++; return s(to, d); }; })()`);
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18801' });
  check('O hash da foto da Ana chega pela sala', await B.eval(`state.members.get('${anaId}').avatar === '${hashRed}'`));
  await B.eval(`setPeopleOpen(true)`);
  await B.waitFor(`${ANA_ROW(anaId)}?.classList.contains('photo')`, 8000);
  check('A Bia vê a foto da Ana na lista (pedida direto à Ana)', await B.eval(COLOR(ANA_ROW(anaId))) === 'vermelha');
  check('Pediu uma vez só e guardou no PC', await B.eval(`pedidos === 1 && !!localStorage.getItem('foto:${hashRed}')`), await B.eval('pedidos'));

  await A.eval(`(() => { $('chatInput').value = 'oi com foto'; sendChat(); })()`);
  await B.waitFor(`[...document.querySelectorAll('#chatList .msg')].some((li) => li.textContent.includes('oi com foto'))`, 5000);
  check('No chat, a foto vem antes do nome', await B.eval(COLOR(`[...document.querySelectorAll('#chatList .msg')].find((li) => li.textContent.includes('oi com foto')).querySelector('.avatar')`)) === 'vermelha');
  check('Quem não tem foto continua só com o nome no chat', await (async () => {
    await B.eval(`(() => { $('chatInput').value = 'eu sem foto'; sendChat(); })()`);
    await A.waitFor(`[...document.querySelectorAll('#chatList .msg')].some((li) => li.textContent.includes('eu sem foto'))`, 5000);
    return A.eval(`![...document.querySelectorAll('#chatList .msg')].find((li) => li.textContent.includes('eu sem foto')).querySelector('.avatar')`);
  })());
  await B.shot('foto-de-perfil.png');

  // Troca com a sala aberta: a Bia vê a nova
  const hashBlue = await A.eval(PICK('#0000ff'));
  await B.waitFor(`state.members.get('${anaId}').avatar === '${hashBlue}'`, 5000);
  await B.waitFor(`${ANA_ROW(anaId)}.style.backgroundImage.length > 0 && fotos.urls.has('${hashBlue}')`, 8000);
  check('Ana troca de foto na sala: a Bia vê a nova na lista e no chat', await B.eval(COLOR(ANA_ROW(anaId))) === 'azul'
    && await B.eval(COLOR(`[...document.querySelectorAll('#chatList .msg')].find((li) => li.textContent.includes('oi com foto')).querySelector('.avatar')`)) === 'azul');

  // Tira a foto: volta a inicial
  await A.eval(`removeMyPhoto()`);
  await B.waitFor(`state.members.get('${anaId}').avatar === ''`, 5000);
  check('Ana tira a foto: volta a bolinha sem foto', await B.eval(`!${ANA_ROW(anaId)}.classList.contains('photo')`));

  // Foto que já está no PC não é pedida de novo
  await A.eval(PICK('#ff0000'));
  await B.waitFor(`${ANA_ROW(anaId)}?.classList.contains('photo')`, 5000);
  check('A mesma foto de antes aparece sem pedir de novo', await B.eval(`pedidos`) === 2 && await B.eval(COLOR(ANA_ROW(anaId))) === 'vermelha', `pedidos: ${await B.eval('pedidos')}`);

  // Foto que não bate com o hash, ou que ninguém pediu, não entra
  const fake = await B.eval(`(async () => {
    const h = '${'ab'.repeat(32)}';
    fotos.asked.set(h, Date.now());
    await onPhotoSignal('${anaId}', { side: 'foto', hash: h, data: fotos.urls.get('${hashRed}').split(',')[1] });
    const naoPedida = '${'cd'.repeat(32)}';
    await onPhotoSignal('${anaId}', { side: 'foto', hash: naoPedida, data: 'AAAA' });
    return !localStorage.getItem('foto:' + h) && !localStorage.getItem('foto:' + naoPedida);
  })()`);
  check('Foto que não bate com o hash, ou não pedida, é jogada fora', fake);
});
