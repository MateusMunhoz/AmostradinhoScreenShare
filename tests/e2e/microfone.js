// Escolha do microfone (Voz e atalhos): a lista mostra o padrão do Windows e cada microfone; trocar no meio da
// voz troca na hora sem cair; o escolhido fica salvo; se ele sumir do PC, o app usa o padrão.
// Usa os microfones falsos do Chrome ("Fake Audio Input 1", "2"...), com a supressão de ruído desligada.
const { openApp, createRoom, joinRoom, check, sleep, run, FAKE } = require('./ajuda');
// Janela encoberta continua desenhando, para as fotos da janela da Ana
FAKE.push('--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion');

const OPTIONS = `[...$('micSelect').options].map((o) => ({ value: o.value, text: o.textContent }))`;
const RAW = `micNow && micNow.raw.getAudioTracks()[0].getSettings().deviceId`;

run('Escolher o microfone', 120000, async () => {
  const A = await openApp('micA', 9491, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18799 });
  await A.eval(`(() => { voiceCfg.ns = 'off'; voiceCfg.micId = ''; saveVoiceCfg(); })()`);
  const B = await openApp('micB', 9492, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18799' });
  const anaId = await A.eval('state.myId');

  await A.eval(`openVoiceDialog()`);
  await A.waitFor(`$('micSelect').options.length > 1`, 5000);
  const opts = await A.eval(OPTIONS);
  check('Lista: primeiro o padrão do Windows, com o nome dele', opts[0].value === '' && /^Padrão do Windows \(.+\)$/.test(opts[0].text), opts[0].text);
  check('Lista: cada microfone do PC, sem repetir o padrão', opts.length >= 3 && opts.slice(1).every((o) => o.value && o.value !== 'default' && o.value !== 'communications'), opts.map((o) => o.text).join(' | '));
  check('Começa no padrão', await A.eval(`$('micSelect').value === ''`));
  await A.shot('microfone-lista.png');

  // Na voz, com a Bia ouvindo
  await A.eval(`$('voiceJoin').click()`);
  await B.eval(`$('voiceJoin').click()`);
  await A.waitFor(`voice.session && [...voice.peers.values()].some((p) => p.pc.connectionState === 'connected')`, 20000);
  await B.waitFor(`mixer.nodes.has('${anaId}')`, 10000);
  const before = await A.eval(`voice.stream.getAudioTracks()[0].id`);

  const pick = opts[opts.length - 1];
  await A.eval(`(() => { $('micSelect').value = ${JSON.stringify(pick.value)}; $('micSelect').dispatchEvent(new Event('change')); })()`);
  await A.waitFor(`voice.stream.getAudioTracks()[0].id !== ${JSON.stringify(before)}`, 8000);
  check('Trocar no meio da voz abre o microfone escolhido', await A.eval(RAW) === pick.value, `${await A.eval(RAW)} (queria ${pick.value})`);
  check('A conexão manda o microfone novo, sem cair', await A.eval(`[...voice.peers.values()].every((p) => p.pc.connectionState === 'connected' && p.pc.getSenders().some((s) => s.track === voice.stream.getAudioTracks()[0]))`));
  check('A Bia continua recebendo a voz da Ana', await B.eval(`mixer.nodes.has('${anaId}') && [...voice.peers.values()].some((p) => p.pc.getReceivers().some((r) => r.track.kind === 'audio' && r.track.readyState === 'live'))`));
  check('Fica salvo', await A.eval(`JSON.parse(localStorage.getItem('vozConfig')).micId === ${JSON.stringify(pick.value)} && voiceCfg.micLabel === ${JSON.stringify(pick.text)}`));

  // O microfone escolhido saiu do PC: abre o padrão e a lista mostra o que aconteceu
  await A.eval(`(() => { voiceCfg.micId = 'microfone-que-nao-existe'; voiceCfg.micLabel = 'Headset USB'; saveVoiceCfg(); })()`);
  const before2 = await A.eval(`voice.stream.getAudioTracks()[0].id`);
  await A.eval(`restartMic()`);
  await A.waitFor(`voice.stream.getAudioTracks()[0].id !== ${JSON.stringify(before2)}`, 8000);
  check('Microfone desconectado: abre o padrão e a voz segue', await A.eval(`voice.session && ${RAW} === 'default'`), await A.eval(RAW));
  await A.eval(`renderMicList()`);
  await sleep(300);
  check('A lista mostra "Headset USB (desconectado, usando o padrão)"', await A.eval(`$('micSelect').selectedOptions[0].textContent === 'Headset USB (desconectado, usando o padrão)'`), await A.eval(`$('micSelect').selectedOptions[0]?.textContent`));
  await A.shot('microfone-desconectado.png');

  await A.eval(`(() => { $('micSelect').value = ''; $('micSelect').dispatchEvent(new Event('change')); })()`);
  await sleep(1500);
  check('Voltar ao padrão do Windows', await A.eval(`voiceCfg.micId === '' && voiceCfg.micLabel === '' && ${RAW} === 'default'`));
});
