// Modo Líder (docs/spec/modo-lider.md): a subsala Líder fala para a sala toda. A Ana cria a Líder (escolhendo o modo no
// + Subsala) e fala nela; a Bia, na Voz geral, ouve a Ana sem a Ana ouvir a Bia; o Caio, fora da voz, ouve pelo Ouvir.
const { openApp, createRoom, joinRoom, check, sleep, run, FAKE } = require('./ajuda');
FAKE.push('--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'); // para as fotos
// Um tom no lugar do microfone: quem ouve vê a pessoa "falando"
const TONE = `(() => { window.tctx = new AudioContext(); const o = tctx.createOscillator(); const dst = tctx.createMediaStreamDestination(); o.connect(dst); o.start(); voice.media = { getUserMedia: async () => dst.stream }; })()`;
const ABA_VOZ = `setPainelSala({ aba: 'voz', juntos: false, recolhido: false })`;

run('Modo Líder: a subsala Líder fala para a sala toda', 150000, async () => {
  const A = await openApp('liderA', 9581, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18871 });
  const B = await openApp('liderB', 9582, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18871' });
  const C = await openApp('liderC', 9583, { fake: true });
  await joinRoom(C, { name: 'Caio', addr: '127.0.0.1:18871' });
  await A.waitFor(`state.members.size === 2`, 10000);
  for (const X of [A, B, C]) { await X.eval(TONE); await X.eval(ABA_VOZ); }
  const ana = await A.eval(`state.myId`), bia = await B.eval(`state.myId`);

  // Criar: o + Subsala pergunta o modo
  await A.eval(`$('paneVoiceSubsala').click()`);
  await sleep(200);
  check('O + Subsala abre a escolha do modo: Padrão e Líder', await A.eval(`(() => { const m = $('subsalaModoMenu');
    return !!m && [...m.querySelectorAll('button')].map((b) => b.dataset.modo).join() === 'padrao,lider' && $('paneVoiceSubsala').getAttribute('aria-expanded') === 'true'; })()`));
  await A.eval(`$('subsalaModoMenu').querySelector('[data-modo=lider]').click()`);
  await A.waitFor(`voice.session && voice.channel === liderChannel() && liderChannel() !== ''`, 15000);
  await B.waitFor(`liderChannel() !== ''`, 5000);
  check('A Ana cria a Líder e já entra nela', true);
  check('O canal tem o selo Líder', await B.eval(`!!$('voicePaneMembers').querySelector('.voice-channel.lider .voice-channel-selo')`));
  await B.eval(`$('paneVoiceSubsala').click()`);
  await sleep(200);
  check('Só uma Líder por sala: a opção fica desativada e explica', await B.eval(`(() => { const b = $('subsalaModoMenu').querySelector('[data-modo=lider]');
    return b.disabled && b.textContent.includes('Já existe uma subsala Líder'); })()`));
  await B.eval(`toggleSubsalaModoMenu($('paneVoiceSubsala'), false)`);

  // A Bia na Voz geral: ouve a Ana pela Líder
  check('O Entrar não leva para a Líder (lá falaria para a sala toda)', await B.eval(`voiceJoinTarget().ch === ''`));
  await B.eval(`$('voiceJoin').click()`);
  await B.waitFor(`voice.session && lider.ouve.get('${ana}')?.pc.connectionState === 'connected'`, 15000);
  check('A Bia (Voz geral) ouve a Ana pela Líder', await B.waitFor(`mixer.nodes.has('lider:${ana}') && speaking.has('${ana}')`, 8000).then(() => true, () => false));
  check('Seu sinal da Bia: "Ouvindo a Líder" com o volume', await B.eval(`!$('ssLider').hidden && $('ssLiderTexto').textContent.startsWith('Ouvindo a Líder') && !$('ssLiderVol').hidden && $('ssLiderOuvir').hidden`));
  check('A Ana não ouve a Bia (a conexão da Líder é só de ida)', await A.eval(`!mixer.nodes.has('${bia}') && !mixer.nodes.has('lider:${bia}') && lider.fala.has('${bia}')`));
  check('Seu sinal da Ana: "Você fala para a sala toda"', await A.eval(`$('ssLiderTexto').textContent === 'Você fala para a sala toda'`));
  check('Todos com o app novo: a sala avisa que conhece o Modo Líder', await A.eval(`[...state.members.values()].every((m) => m.lider === true)`));
  await A.eval(`(() => { const caio = [...state.members].find(([, m]) => m.name === 'Caio')[1]; caio.lider = false; renderLiderLinha(); })()`);
  check('App antigo na sala: quem fala para todos vê quantos não ouvem', await A.eval(`$('ssLiderTexto').textContent.endsWith('1 não ouve (app antigo)') && $('ssLider').title.includes('Caio')`));
  await A.eval(`(() => { [...state.members].find(([, m]) => m.name === 'Caio')[1].lider = true; renderLiderLinha(); })()`);
  await B.eval(`setLiderVolume(0)`);
  check('Volume da Líder em 0: a Ana não aparece falando para a Bia', await B.waitFor(`!speaking.has('${ana}')`, 5000).then(() => true, () => false));
  await B.eval(`setLiderVolume(100)`);

  // O Caio fora da voz: só ouve com o Ouvir
  check('Fora da voz, o Caio vê a Líder com o Ouvir', await C.eval(`!$('ssLider').hidden && !$('ssLiderOuvir').hidden && lider.ouve.size === 0`));
  await C.eval(`$('ssLiderOuvir').click()`);
  check('Ouvir: o Caio ouve a Ana sem entrar na voz', await C.waitFor(`!voice.session && mixer.nodes.has('lider:${ana}') && speaking.has('${ana}')`, 15000).then(() => true, () => false));
  await C.eval(`$('ssLiderOuvir').click()`);
  await sleep(300);
  check('Parar: o Caio para de ouvir, e a Ana fecha a conexão com ele', await C.eval(`lider.ouve.size === 0 && !mixer.nodes.has('lider:${ana}')`)
    && await A.waitFor(`!lider.fala.has([...state.members].find(([, m]) => m.name === 'Caio')[0])`, 5000).then(() => true, () => false));

  // A tela da Líder fica aberta para a sala toda, mesmo "só o meu canal"
  await A.eval(`(() => { navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false });
    $('soundOn').checked = false; $('shareOpenOn').checked = false; setRadio('encodeMode', 'per'); state.selectedSource = 'teste'; return startSharing(); })()`);
  await A.waitFor(`state.sharing`, 15000);
  await B.waitFor(`state.members.get('${ana}')?.sharing && state.members.get('${ana}')?.shareInfo`, 10000);
  check('Transmissão da Líder, mesmo fechada: a Bia (outro canal) pode assistir', await B.eval(`state.members.get('${ana}').shareInfo.open === false && canWatch('${ana}')`));
  check('Na Líder, o "Quem pode assistir" fica fixo no globo', await A.eval(`$('shareOpenBtn').disabled && $('shareOpenBtn').title.includes('sempre para a sala toda')`));
  check('O selo vira "Líder · ao vivo"', await B.eval(`$('voicePaneMembers').querySelector('.voice-channel-selo').textContent === 'Líder · ao vivo'`));
  await B.eval(`watch('${ana}')`);
  await B.waitFor(`state.in.size === 1`, 10000);
  check('A Bia assiste a tela da Líder', true);

  // Pedir para falar (fase 2): a Bia pede, a Ana (transmitindo na Líder) aceita, tira e recusa
  await B.eval(`$('ssLiderPedir').click()`);
  await A.waitFor(`state.liderPedidos.includes('${bia}')`, 5000);
  await sleep(200);
  check('O pedido chega à Ana: número na aba Voz e a linha com Aceitar e Recusar', await A.eval(`$('navVoicePedidos').textContent === '1' && !$('navVoicePedidos').hidden
    && [...document.querySelectorAll('#voicePaneMembers .lider-linha')].some((li) => li.dataset.person === '${bia}' && li.textContent.includes('Aceitar') && li.textContent.includes('Recusar'))`));
  check('A Bia vê "Pedido enviado" com Cancelar', await B.eval(`$('ssLiderTexto').textContent === 'Pedido enviado' && $('ssLiderPedir').textContent === 'Cancelar'`));
  await A.eval(`[...document.querySelectorAll('#voicePaneMembers .lider-linha')].find((li) => li.dataset.person === '${bia}').querySelector('.btn.primary').click()`);
  await B.waitFor(`state.liderPalavra.includes('${bia}')`, 5000);
  check('Aceito: a Bia vê que fala para a sala toda e o Devolver', await B.waitFor(`$('ssLiderTexto').textContent === 'Você está falando para a sala toda' && $('ssLiderPedir').textContent === 'Devolver'`, 3000).then(() => true, () => false));
  check('A Ana passa a ouvir a Bia (pela Líder)', await A.waitFor(`mixer.nodes.has('lider:${bia}') && speaking.has('${bia}')`, 15000).then(() => true, () => false));
  check('Com a palavra embaixo da Líder, com o Tirar para a Ana', await A.eval(`[...document.querySelectorAll('#voicePaneMembers .lider-linha')].some((li) => li.dataset.person === '${bia}' && li.textContent.includes('Tirar'))`));
  await C.eval(`$('ssLiderOuvir').click()`);
  check('O Caio (Ouvir, fora da voz) ouve a Ana e a Bia', await C.waitFor(`mixer.nodes.has('lider:${ana}') && mixer.nodes.has('lider:${bia}') && speaking.has('${bia}')`, 15000).then(() => true, () => false));
  await C.eval(`$('ssLiderOuvir').click()`);
  await A.shot('lider-palavra.png');
  await A.eval(`[...document.querySelectorAll('#voicePaneMembers .lider-linha')].find((li) => li.dataset.person === '${bia}').querySelector('button').click()`);
  check('Tirar: a Bia perde a palavra e a Ana para de ouvir', await B.waitFor(`!state.liderPalavra.length && $('ssLiderPedir').textContent.includes('Pedir')`, 5000).then(() => true, () => false)
    && await A.waitFor(`!mixer.nodes.has('lider:${bia}')`, 5000).then(() => true, () => false));
  check('A Bia recebe o aviso de que a palavra foi tirada', await B.eval(`$('toast').textContent.includes('tirou a sua palavra')`));
  await B.eval(`$('ssLiderPedir').click()`);
  await A.waitFor(`state.liderPedidos.includes('${bia}')`, 5000);
  await sleep(200);
  await A.eval(`[...document.querySelectorAll('#voicePaneMembers .lider-linha')].find((li) => li.dataset.person === '${bia}').querySelectorAll('button')[1].click()`);
  check('Recusar: a Bia é avisada e o botão volta', await B.waitFor(`$('toast').textContent.includes('recusou o pedido') && !state.liderPedidos.length`, 5000).then(() => true, () => false));
  // O Caio, fora da voz, pede: entra na voz (Voz geral) e o pedido vai
  await C.eval(`$('ssLiderPedir').click()`);
  check('Fora da voz, o Pedir entra na voz e manda o pedido', await A.waitFor(`state.liderPedidos.length === 1`, 15000).then(() => true, () => false)
    && await C.eval(`voice.session && voice.channel === ''`));
  await C.eval(`$('ssLiderPedir').click()`);
  check('Cancelar tira o pedido', await A.waitFor(`state.liderPedidos.length === 0`, 5000).then(() => true, () => false));

  // A Bia entra na Líder: passa a falar e ouvir pelo canal (a conexão da Líder fecha)
  await B.eval(`voice.setChannel(liderChannel())`);
  await B.waitFor(`voice.peers.get('${ana}')?.pc.connectionState === 'connected'`, 15000);
  check('A Bia entra na Líder: a conexão só de ida fecha e o canal liga as duas', await B.eval(`lider.ouve.size === 0`) && await A.eval(`!lider.fala.has('${bia}')`));
  await B.shot('lider.png');

  // A Líder apagada: tudo volta ao normal
  await A.eval(`send({ type: 'subsala-delete', id: liderChannel() })`);
  await C.waitFor(`liderChannel() === ''`, 5000);
  check('A Líder apagada: a linha some e ninguém ouve pela Líder', await C.eval(`$('ssLider').hidden && lider.ouve.size === 0`) && await A.eval(`lider.fala.size === 0`));
});
