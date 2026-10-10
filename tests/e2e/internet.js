// Modo Internet: a sala fica no servidor da VPS (aqui, um servidor local), com código + senha, e o vídeo
// passa pelo TURN quando o direto não dá. Ana cria, Bia entra pelo código, Bia assiste a Ana; a conexão da
// Bia com o servidor cai e volta sozinha (mesmo número, a tela continua); Bia sai e a Ana vê na hora.
//
// Para provar o TURN, rode com um coturn local (use-auth-secret) e diga onde ele está:
//   TELA_E2E_TURN_HOST=127.0.0.1 TELA_E2E_TURN_PORT=3479 TELA_E2E_TURN_SECRET=... node tests/e2e/internet.js
// Aí as duas cópias do app só podem usar o relay (iceTransportPolicy 'relay'): se a tela chegar, o TURN funciona.
const { openApp, createRoom, joinRoom, share, frames, check, sleep, run } = require('./ajuda');
const { createInternetServer } = require('../../servidor-internet/server');

const PORT = 18830;
const TURN = process.env.TELA_E2E_TURN_HOST ? {
  turnHost: process.env.TELA_E2E_TURN_HOST, turnPort: Number(process.env.TELA_E2E_TURN_PORT || 3479), turnSecret: process.env.TELA_E2E_TURN_SECRET,
} : { turnHost: '' };
const firstVideo = '[...state.in.values()][0].tile.video';
const useInternet = `(() => { saveNetworkPreferences({ provider: 'internet', internetUrl: 'ws://127.0.0.1:${PORT}' }); renderConnectivitySettings(); })()`;
const pairType = (X, id) => X.eval(`(async () => {
  const link = state.in.get('${id}'); if (!link) return '';
  const stats = await link.pc.getStats(); let pair = null; const cands = {};
  stats.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; if (s.type === 'local-candidate' || s.type === 'remote-candidate') cands[s.id] = s; });
  return pair ? cands[pair.localCandidateId]?.candidateType + '/' + cands[pair.remoteCandidateId]?.candidateType : '';
})()`);

run('Modo Internet (código + senha, TURN, reconexão)', 180000, async () => {
  const server = createInternetServer({ host: '127.0.0.1', port: PORT, graceMs: 15000, log: () => {}, stunUrls: [], ...TURN });
  await server.listen();
  try {
    const A = await openApp('netA', 9731, { fake: true });
    await A.eval(useInternet);
    check('Tela inicial pede código', await A.eval(`$('goJoinSub').textContent.includes('código') && $('roomPortField').hidden && $('radminTitle').textContent === 'Internet'`));
    await A.eval(`(async () => { try { return await testInternetServer('ws://127.0.0.1:${PORT}'); } catch (e) { return e.message; } })()`)
      .then((r) => check('Aba Rede reconhece o servidor', typeof r === 'object', JSON.stringify(r)));

    await A.eval(`(() => { $('name').value = 'Ana'; $('goCreate').click(); $('roomPassword').value = '12'; $('createBtn').click(); })()`);
    await sleep(500);
    check('Sala sem senha forte é recusada', await A.eval(`$('room').hidden`));
    await createRoom(A, { name: 'Ana', port: 0, password: 'pizza-azul-marte' });
    const code = await A.eval('state.cloud?.code');
    check('Sala criada com código', /^[A-Z2-9]{6}$/.test(code || ''), code);
    check('Endereço da sala mostra o código', await A.eval(`$('roomAddress').textContent.includes('${code}') && state.roomAddr === '${code}'`));
    check('STUN/TURN vieram do servidor', await A.eval(`RTC_CONFIG.iceServers.length > 0 || ${!TURN.turnHost}`));
    check('Ana é o host', await A.eval('state.hostId === state.myId && !state.isOwner'));

    const B = await openApp('netB', 9732, { fake: true });
    await B.eval(useInternet);
    await B.eval(`(() => { $('name').value = 'Bia'; $('goJoin').click(); $('roomAddr').value = '${code}'; $('joinPassword').value = 'errada'; $('joinBtn').click(); })()`);
    await sleep(1500);
    check('Senha errada não entra', await B.eval(`$('room').hidden`));
    await joinRoom(B, { name: 'Bia', addr: code.toLowerCase(), password: 'pizza-azul-marte' });
    check('Bia entra pelo código', await B.eval(`state.cloud?.code === '${code}' && state.members.size === 1`));
    const idA = await A.eval('state.myId');
    const idB = await B.eval('state.myId');

    if (TURN.turnHost) {
      check('Acesso ao TURN chegou', await B.eval(`RTC_CONFIG.iceServers.some((s) => [].concat(s.urls).some((u) => u.startsWith('turn:')) && s.username && s.credential)`));
      await A.eval(`RTC_CONFIG.iceTransportPolicy = 'relay'`);
      await B.eval(`RTC_CONFIG.iceTransportPolicy = 'relay'`);
    }
    await share(A);
    await B.waitFor(`state.members.get('${idA}')?.sharing`, 10000);
    await B.eval(`watch('${idA}')`);
    await B.waitFor(`${firstVideo}?.videoWidth > 0`, 30000);
    check('Bia vê a tela da Ana', (await frames(B, firstVideo)) > 5);
    const type = await pairType(B, idA);
    check(TURN.turnHost ? 'O vídeo passa pelo TURN (relay)' : 'Conexão direta', TURN.turnHost ? type.includes('relay') : !!type, type);

    // Voz pelo mesmo caminho (STUN/TURN do servidor)
    await A.eval(`$('voiceJoin').click()`);
    await B.eval(`$('voiceJoin').click()`);
    await B.waitFor(`voice.session && [...voice.peers.values()].some((p) => p.pc.connectionState === 'connected')`, 30000);
    const voiceRelay = await B.eval(`(async () => { const p = [...voice.peers.values()][0]; let t = ''; const st = await p.pc.getStats(); const c = {};
      st.forEach((s) => { if (s.type === 'local-candidate') c[s.id] = s.candidateType; });
      st.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') t = c[s.localCandidateId]; }); return t; })()`);
    check(TURN.turnHost ? 'Voz conectada pelo TURN' : 'Voz conectada', TURN.turnHost ? voiceRelay === 'relay' : !!voiceRelay, voiceRelay);

    // A internet da Bia pisca: a conexão com o servidor cai; o app volta sozinho com o mesmo número
    await B.eval(`state.ws.close()`);
    await B.waitFor(`state.ws && state.ws.readyState === 1 && !state.migrating`, 20000);
    check('Bia volta para a sala com o mesmo número', await B.eval(`state.myId === '${idB}' && state.cloud?.code === '${code}'`));
    check('Ana nem viu a Bia sair', await A.eval(`state.members.has('${idB}')`));
    check('A tela continua depois da reconexão', (await frames(B, firstVideo)) > 5);

    await B.eval(`leaveRoom()`);
    await A.waitFor(`!state.members.has('${idB}')`, 4000);
    check('Bia saiu pelo botão e a Ana viu na hora', true);
  } finally {
    await server.close();
  }
});
