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
  const nav = await A.eval(R('#workspaceNav'));
  check('Painel à esquerda, com a largura dos painéis da direita, do topo da barra de atalhos até embaixo', painel.left === 16 && painel.width === chat.width && painel.top === nav.top && painel.bottom === chat.bottom, JSON.stringify({ painel, chat, nav }));
  check('A transmissão fica no meio, sem nada por cima', area.left >= painel.right && area.right <= chat.left && area.width < areaAntes.width, JSON.stringify(area));
  check('A barra de baixo também fica no meio, livre', dock.left >= painel.right && dock.right <= chat.left, JSON.stringify(dock));
  check('Sem escurecer a tela', await A.eval(`getComputedStyle($('voiceDialog')).backgroundColor === 'rgba(0, 0, 0, 0)'`));
  await A.shot('voz-painel.png');

  // Cores novas: vazias são automáticas; escolher uma muda o app na hora; apagar volta ao automático
  await A.eval(`(() => { $('hex-speaking').value = '#FF00AA'; $('hex-speaking').dispatchEvent(new Event('input')); })()`);
  check('Cor de "Quem fala" escolhida vale na hora', await A.eval(`getComputedStyle(document.documentElement).getPropertyValue('--ok').trim() === '#FF00AA'`));
  await A.eval(`(() => { $('hex-speaking').value = ''; $('hex-speaking').dispatchEvent(new Event('input')); })()`);
  check('Apagar volta ao automático (Detalhes 2)', await A.eval(`appPreferences.colors.speaking === '' && getComputedStyle(document.documentElement).getPropertyValue('--ok').trim() === appPreferences.colors.detail2 && $('hex-speaking').getAttribute('aria-invalid') !== 'true'`));
  check('No automático, o campo mostra o código da cor calculada, em cinza', await A.eval(`$('hex-speaking').value === appPreferences.colors.detail2 && $('hex-speaking').classList.contains('is-auto') && !document.querySelector('.color-auto')`));
  await A.eval(`(() => { $('hex-detail2').value = '#123456'; $('hex-detail2').dispatchEvent(new Event('input')); })()`);
  check('Mudar uma cor principal atualiza as que estão no automático', await A.eval(`$('hex-speaking').value === '#123456' && $('hex-warn').value === '#123456'`));
  await A.eval(`(() => { $('color-speaking').value = '#ff00aa'; $('color-speaking').dispatchEvent(new Event('input')); })()`);
  check('Escolher pela amostra usa a sua cor (código normal, não cinza)', await A.eval(`appPreferences.colors.speaking === '#FF00AA' && !$('hex-speaking').classList.contains('is-auto')`));
  await A.eval(`(() => { $('hex-speaking').value = ''; $('hex-speaking').dispatchEvent(new Event('input')); })()`);
  check('Apagar o código volta ao automático', await A.eval(`appPreferences.colors.speaking === '' && $('hex-speaking').classList.contains('is-auto') && $('hex-speaking').value === '#123456'`));
  await A.eval(`(() => { openGeneralSettings(); document.querySelector('.settings-colors-sub').scrollIntoView(); })()`);
  await sleep(400);
  await A.shot('cores-auto.png');
  await A.eval(`closeGeneralSettings()`);
  await A.eval(`(() => { $('hex-text').value = '#00FF00'; $('hex-text').dispatchEvent(new Event('input')); })()`);
  check('Cor do texto escolhida vale nos painéis também', await A.eval(`getComputedStyle(document.documentElement).getPropertyValue('--surface-text').trim() === '#00FF00'`));
  await A.eval(`(() => { $('hex-text').value = ''; $('hex-text').dispatchEvent(new Event('input')); })()`);
  await A.eval(`$('voiceSettingsBtn').click()`);
  await sleep(300);
  check('Clicar de novo no botão de ajustes fecha o painel', await A.eval(`$('voiceDialog').hidden && !document.body.classList.contains('voice-side')`));
  const depois = await A.eval(R('#streamArea'));
  check('Fechar devolve o espaço para a transmissão', depois.left === areaAntes.left && depois.width === areaAntes.width, JSON.stringify(depois));
});
