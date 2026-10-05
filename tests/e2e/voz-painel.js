// Voz e atalhos é o primeiro grupo das Configurações (abas Voz e Atalhos), na sala e fora dela; o botão de
// ajustes da voz abre direto nele e, clicado de novo, fecha. Depois, as cores automáticas.
const { openApp, createRoom, check, sleep, run } = require('./ajuda');

const R = (sel) => `(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) }; })()`;

run('Voz e atalhos nas Configurações', 60000, async () => {
  const A = await openApp('vozPainel', 9521, { fake: true });
  await A.eval(`openVoiceDialog()`);
  await sleep(300);
  check('Fora da sala: abre as Configurações em Voz e atalhos', await A.eval(`!$('generalSettingsDialog').hidden && voiceSettingsOpen() && !$('settingsPanel-voice').hidden`));
  await A.eval(`closeVoiceDialog()`);

  await createRoom(A, { name: 'Ana', port: 18821 });
  const areaAntes = await A.eval(R('#streamArea'));
  await A.eval(`$('voiceSettingsBtn').click()`);
  await sleep(400);
  check('Na sala: o botão de ajustes da voz abre o mesmo lugar', await A.eval(`voiceSettingsOpen() && document.querySelector('.settings-nav [data-group=voz]').getAttribute('aria-current') === 'true'`));
  await A.shot('voz-painel.png');
  await A.eval(`closeGeneralSettings()`);

  // Cores novas: vazias são automáticas; escolher uma muda o app na hora; apagar volta ao automático
  await A.eval(`(() => { $('hex-speaking').value = '#FF00AA'; $('hex-speaking').dispatchEvent(new Event('input')); })()`);
  check('Cor de "Quem fala" escolhida vale na hora', await A.eval(`getComputedStyle(document.documentElement).getPropertyValue('--ok').trim() === '#FF00AA'`));
  await A.eval(`(() => { $('hex-speaking').value = ''; $('hex-speaking').dispatchEvent(new Event('input')); })()`);
  check('Apagar volta ao automático (Detalhes 2)', await A.eval(`appPreferences.colors.speaking === '' && getComputedStyle(document.documentElement).getPropertyValue('--ok').trim() === appPreferences.colors.detail2 && $('hex-speaking').getAttribute('aria-invalid') !== 'true'`));
  check('No automático, o campo mostra o código da cor calculada, em cinza', await A.eval(`$('hex-speaking').value === appPreferences.colors.detail2 && $('hex-speaking').classList.contains('is-auto') && !document.querySelector('.color-auto')`));
  await A.eval(`(() => { $('hex-detail2').value = '#123456'; $('hex-detail2').dispatchEvent(new Event('input')); })()`);
  // O Cuidado do Grafite e aço é fixo (âmbar), para o verde ficar só com quem fala; o de Quem fala está no automático
  check('Mudar uma cor principal atualiza as que estão no automático', await A.eval(`$('hex-speaking').value === '#123456' && $('hex-warn').value === '#D9A66C'`));
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
  await A.eval(`$('voiceSettingsBtn').click()`);
  await sleep(300);
  check('Clicar de novo no botão de ajustes fecha', await A.eval(`$('generalSettingsDialog').hidden`));
  const depois = await A.eval(R('#streamArea'));
  check('A transmissão continua do mesmo tamanho', depois.left === areaAntes.left && depois.width === areaAntes.width, JSON.stringify(depois));
});
