// Voz e atalhos na sala: painel à esquerda, do tamanho dos painéis de chat e voz (do outro lado), com a
// transmissão no meio sem nada por cima; fechar devolve o espaço. Fora da sala, continua a janela no meio.
const { openApp, createRoom, check, sleep, run } = require('./ajuda');

const R = (sel) => `(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) }; })()`;

run('Voz e atalhos como painel à esquerda', 60000, async () => {
  const A = await openApp('vozPainel', 9521, { fake: true });
  await A.eval(`openVoiceDialog()`);
  await sleep(300);
  check('Fora da sala: janela no meio da tela', await A.eval(`!document.body.classList.contains('voice-side') && getComputedStyle($('voiceDialog')).position === 'fixed'`));
  await A.eval(`closeVoiceDialog()`);

  await createRoom(A, { name: 'Ana', port: 18821 });
  const areaAntes = await A.eval(R('#streamArea'));
  await A.eval(`openVoiceDialog()`);
  await sleep(400);
  const painel = await A.eval(R('#voiceDialog .dialog'));
  const chat = await A.eval(R('#workspacePanes'));
  const area = await A.eval(R('#streamArea'));
  const dock = await A.eval(R('.dock'));
  check('Painel à esquerda, com a largura e a altura dos painéis da direita', painel.left === 16 && painel.width === chat.width && painel.top === chat.top && painel.bottom === chat.bottom, JSON.stringify({ painel, chat }));
  check('A transmissão fica no meio, sem nada por cima', area.left >= painel.right && area.right <= chat.left && area.width < areaAntes.width, JSON.stringify(area));
  check('A barra de baixo também fica no meio, livre', dock.left >= painel.right && dock.right <= chat.left, JSON.stringify(dock));
  check('Sem escurecer a tela', await A.eval(`getComputedStyle($('voiceDialog')).backgroundColor === 'rgba(0, 0, 0, 0)'`));
  await A.shot('voz-painel.png');
  await A.eval(`closeVoiceDialog()`);
  await sleep(300);
  const depois = await A.eval(R('#streamArea'));
  check('Fechar devolve o espaço para a transmissão', depois.left === areaAntes.left && depois.width === areaAntes.width, JSON.stringify(depois));
});
