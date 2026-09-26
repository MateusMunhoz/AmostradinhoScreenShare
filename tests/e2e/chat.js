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
  check('Ana vê a própria mensagem como "Você", no formato "Nome : mensagem"', await A.eval(`$('chatList').querySelector('.msg.mine .msg-who')?.textContent === 'Você' && $('chatList').querySelector('.msg.mine .msg-sep')?.textContent === ' : '`));
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

  // Carla entra depois: recebe o histórico
  const C = await openApp('chatC', 9423);
  await joinRoom(C, { name: 'Carla', addr: '127.0.0.1:18793' });
  check('Carla recebe o histórico (3 mensagens)', await C.eval(`$('chatList').querySelectorAll('.msg').length === 3`), await C.eval(`$('chatList').querySelectorAll('.msg').length`));
  await B.shot('chat.png');

  // Ana encerra para todos: a sala e o chat somem para a Carla
  await A.eval(`leaveRoom(null, 'info', true)`).catch(() => {});
  await sleep(1500);
  check('Encerrar para todos leva o chat junto', await C.eval(`$('room').hidden && $('chatList').children.length === 0`));
});
