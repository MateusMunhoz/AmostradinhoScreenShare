// Chat: Ana cria, Bia entra; texto, link, HTML literal, arquivo de 5 MB (SHA-256), imagem automática,
// histórico para quem entra depois e "encerrar para todos" levando o chat junto.
const { openApp, createRoom, joinRoom, check, sleep, run } = require('./ajuda');

const sha = `async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('')`;

run('Chat', 170000, async () => {
  const A = await openApp('chatA', 9421);
  await createRoom(A, { name: 'Ana', port: 18793 });
  const B = await openApp('chatB', 9422);
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18793' });
  await B.eval('setPanelOpen(false)'); // painel recolhido: mensagens contam como novas
  check('Chat disponível', await B.eval(`chat.supported && !$('chatInput').disabled`));

  await A.eval(`(() => { $('chatInput').value = 'Oi, bora jogar? https://osu.ppy.sh <b>negrito</b>'; sendChat(); })()`);
  await B.waitFor(`$('chatList').querySelectorAll('.msg').length === 1`, 5000);
  check('Bia recebe e vê o número no balão', await B.eval(`chat.unread === 1 && !$('chatUnread').hidden && $('chatUnread').textContent === '1'`));
  check('Divisor de mensagens novas', await B.eval(`$('chatList').querySelector('.new-divider')?.textContent === '1 mensagem nova'`));
  check('Texto com HTML aparece literal', await B.eval(`$('chatList').querySelector('.msg-text').textContent.includes('<b>negrito</b>') && !$('chatList').querySelector('.msg-text b')`));
  check('Link vira link', await B.eval(`$('chatList').querySelector('.msg-text a')?.textContent === 'https://osu.ppy.sh'`));
  check('Ana vê a própria mensagem com o nome dela, no formato "Nome : mensagem"', await A.eval(`$('chatList').querySelector('.msg.mine .msg-who')?.textContent === 'Ana' && $('chatList').querySelector('.msg.mine .msg-sep')?.textContent === ' : '`));
  await B.eval(`(() => { document.hasFocus = () => true; setPanelOpen(true); scrollChatToEnd(); markRead(); })()`);

  check('Abrir o painel zera as não lidas', await B.eval(`chat.unread === 0 && $('chatUnread').hidden`));

  // Arquivo de 5 MB: Bia baixa e confere o SHA-256
  const shaA = await A.eval(`(async () => {
    const bytes = new Uint8Array(5 * 1024 * 1024 + 123); crypto.getRandomValues(bytes.subarray(0, 65536));
    for (let i = 65536; i < bytes.length; i++) bytes[i] = (i * 31) & 255;
    const f = new File([bytes], 'partida.osr', { type: 'application/octet-stream' });
    attachFiles([f]);
    return (${sha})(f);
  })()`);
  await B.waitFor(`$('chatList').querySelectorAll('.file-card .btn').length === 1`, 5000);
  const t0 = Date.now();
  await B.eval(`$('chatList').querySelector('.file-card button').click()`);
  await B.waitFor(`[...chat.cards.values()].some((p) => p.blob)`, 60000);
  const secs = (Date.now() - t0) / 1000;
  const shaB = await B.eval(`(async () => (${sha})([...chat.cards.values()].find((p) => p.blob).blob))()`);
  check('Arquivo de 5 MB chega igual (SHA-256)', shaA === shaB, `${secs.toFixed(1)} s`);
  check('Botão Salvar com o nome do arquivo', await B.eval(`$('chatList').querySelector('.file-card a[download]')?.download === 'partida.osr'`));

  // Imagem pequena chega sozinha
  await A.eval(`(async () => {
    const c = new OffscreenCanvas(320, 180); const g = c.getContext('2d'); g.fillStyle = '#a3b1ff'; g.fillRect(0, 0, 320, 180);
    attachFiles([new File([await c.convertToBlob({ type: 'image/png' })], 'print.png', { type: 'image/png' })]);
  })()`);
  await B.waitFor(`[...$('chatList').querySelectorAll('.file-card img')].some((i) => i.naturalWidth === 320)`, 15000);
  check('Imagem pequena aparece sozinha', true);
  check('Ana vê a própria imagem', await A.eval(`$('chatList').querySelectorAll('.file-card img').length === 1`));
  // Imagem sem o cartão: nada de ícone, nome e tamanho; o selo "Só nesta sala" só aparece com o foco ou o mouse
  const imageOnly = `(() => { const c = $('chatList').querySelector('.file-card.image-only'); const b = c && c.querySelector('.chat-image-badge');
    return { row: c && getComputedStyle(c.querySelector('.file-row')).display, badge: b && b.textContent, op: b && getComputedStyle(b).opacity,
      described: b && c.querySelector('img').getAttribute('aria-describedby') === b.id }; })()`;
  for (const [who, X] of [['Ana', A], ['Bia', B]]) {
    const s = await X.eval(imageOnly);
    check(`${who}: imagem só com a imagem (sem nome e tamanho) e o selo escondido`, s.row === 'none' && s.badge === 'Só nesta sala' && s.op === '0' && s.described, JSON.stringify(s));
  }
  await A.eval(`$('chatList').querySelector('.file-card.image-only img').focus()`);
  await sleep(300);
  check('Com o foco na imagem, o selo "Só nesta sala" aparece', (await A.eval(imageOnly)).op === '1');
  check('Arquivo que não é imagem continua com o cartão e o nome', await B.eval(`[...$('chatList').querySelectorAll('.file-card:not(.image-only) .file-name')].some((n) => n.textContent === 'partida.osr')`));

  // Foto de celular: JPEG com EXIF de GPS e "deitada" (rotação 6). Chega sem o GPS e ainda em pé.
  await A.eval(`(async () => {
    const c = new OffscreenCanvas(320, 180); const g = c.getContext('2d'); g.fillStyle = '#ffb347'; g.fillRect(0, 0, 320, 180);
    const jpg = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer());
    const t = [...'Exif\\0\\0II*\\0'].map((ch) => ch.charCodeAt(0)).concat([8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0],
      [...'GPS -23.5505 -46.6333'].map((ch) => ch.charCodeAt(0)));
    const app1 = [0xff, 0xe1, (t.length + 2) >> 8, (t.length + 2) & 255, ...t];
    const foto = new Uint8Array([...jpg.subarray(0, 2), ...app1, ...jpg.subarray(2)]);
    attachFiles([new File([foto], 'IMG_2026.jpg', { type: 'image/jpeg' })]);
  })()`);
  await B.waitFor(`[...chat.cards.values()].some((p) => p.f.name === 'IMG_2026.jpg' && p.blob)`, 15000);
  const foto = await B.eval(`(async () => {
    const p = [...chat.cards.values()].find((x) => x.f.name === 'IMG_2026.jpg');
    const text = String.fromCharCode(...new Uint8Array(await p.blob.arrayBuffer()));
    const bmp = await createImageBitmap(p.blob);
    return { gps: text.includes('GPS -23'), w: bmp.width, h: bmp.height };
  })()`);
  check('Foto chega sem a localização', !foto.gps);
  check('E continua em pé (a rotação fica)', foto.w === 180 && foto.h === 320, `${foto.w}x${foto.h}`);

  // Carla entra depois: recebe o histórico
  const C = await openApp('chatC', 9423);
  await joinRoom(C, { name: 'Carla', addr: '127.0.0.1:18793' });
  check('Carla recebe o histórico (4 mensagens)', await C.eval(`$('chatList').querySelectorAll('.msg').length === 4`), await C.eval(`$('chatList').querySelectorAll('.msg').length`));
  await B.shot('chat.png');

  // Ana encerra para todos: a sala e o chat somem para a Carla
  // Ctrl+V: um print (imagem sem nome) e um arquivo copiado vão para o chat; texto cola normal
  const paste = (items) => `(() => {
    const dt = new DataTransfer();
    ${items}
    const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    $('chatInput').focus();
    $('chatInput').dispatchEvent(e);
    return e.defaultPrevented;
  })()`;
  const antes = await B.eval(`$('chatList').querySelectorAll('.file-card').length`);
  const png = `await (async () => { const c = new OffscreenCanvas(40, 30); const g = c.getContext('2d'); g.fillStyle = '#d6c45c'; g.fillRect(0, 0, 40, 30); return c.convertToBlob({ type: 'image/png' }); })()`;
  await A.eval(`(async () => { const blob = ${png}; window.colado = new File([blob], 'image.png', { type: 'image/png' }); })()`);
  check('Ctrl+V com imagem: não cola como texto', await A.eval(paste(`dt.items.add(colado);`)) === true);
  check('Texto colado continua normal', await A.eval(paste(`dt.setData('text/plain', 'só texto');`)) === false);
  await A.eval(paste(`dt.items.add(new File(['conteudo do relatorio'], 'relatorio.txt', { type: 'text/plain' }));`));
  // Colar põe na bandeja (preview antes de enviar): nada sai até o Enviar
  await sleep(500);
  check('Colado fica na bandeja, sem ir ainda', await A.eval(`chat.staged.length === 2 && !$('chatStaged').hidden`) && await B.eval(`$('chatList').querySelectorAll('.file-card').length === ${antes}`));
  await A.eval(`sendChat()`);
  await B.waitFor(`$('chatList').querySelectorAll('.file-card').length === ${antes} + 2`, 5000);
  const nomes = await B.eval(`[...$('chatList').querySelectorAll('.file-card .file-name')].slice(-2).map((n) => n.textContent)`);
  check('Bia recebe o print com nome da hora e o arquivo com o nome dele', /^imagem-colada-\d\d-\d\d-\d\d\.png$/.test(nomes[0]) && nomes[1] === 'relatorio.txt', nomes.join(', '));

  await A.eval(`leaveRoom(null, 'info', true)`).catch(() => {});
  await sleep(1500);
  check('Encerrar para todos leva o chat junto', await C.eval(`$('room').hidden && $('chatList').children.length === 0`));
});
