// Entrar pelos amigos (docs/spec/entrar-pelos-amigos.md), no modo Internet com um servidor local e sem a RazzeAPI.
// Ana cria a sala; Bia entra com a senha e recebe o passe da sala; o anúncio que iria para a RazzeAPI é conferido no
// app (salasAmigos.enviado) e entregue ao Caio, amigo só da Bia, como a API entregaria. Ana sai, a Bia vira host e o
// Caio entra pelo Entrar da aba Amigos, sem código nem senha. Depois: "Deixar meus amigos entrarem" desligado tira o
// anúncio e mantém o "Na sala de"; o host desliga e religa "Amigos de quem está na sala podem entrar".
const { WebSocket } = require('ws');
const { openApp, createRoom, joinRoom, check, run } = require('./ajuda');
const { createInternetServer } = require('../../servidor-internet/server');

const PORT = 18871;
const SERVIDOR = `ws://127.0.0.1:${PORT}`;
const useInternet = `(() => { saveNetworkPreferences({ provider: 'internet', internetUrl: '${SERVIDOR}' }); renderConnectivitySettings(); })()`;
const anuncio = (X) => X.eval(`salasAmigos.enviado ? JSON.parse(salasAmigos.enviado) : null`);
const BIA = { id: 'u-bia', displayName: 'Bia', online: true };
// O que a RazzeAPI entregaria ao Caio: a sala anunciada pela Bia, com ela na lista de amigos
const entregar = (C, sala) => C.eval(`(() => {
  receberSalasAmigos([${JSON.stringify({ ...sala, userId: BIA.id, amigos: [{ userId: BIA.id, displayName: 'Bia' }] })}]);
  renderSessoes();
})()`);
// Entrar direto no servidor com um passe, sem o app: a primeira resposta ('welcome' ou 'error')
function tentarPasse(codigo, passe) {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVIDOR);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', room: codigo, passe, name: 'Teste' })));
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'welcome' || m.type === 'error') { ws.terminate(); resolve(m.type); } });
    ws.on('error', () => resolve('erro'));
  });
}

run('Entrar pelos amigos (passe da sala)', 150000, async () => {
  const server = createInternetServer({ host: '127.0.0.1', port: PORT, log: () => {}, stunUrls: [], turnHost: '' });
  await server.listen();
  try {
    const A = await openApp('amigosA', 9761);
    await A.eval(useInternet);
    await A.eval(`$('goCreate').click()`);
    check('Criar sala: "Amigos de quem estiver na sala" à vista e marcada', await A.eval(`!$('roomAmigosMembrosLine').hidden && $('roomAmigosMembros').checked`));
    await createRoom(A, { name: 'Ana', port: 0, password: 'pizza-azul-marte' });
    const code = await A.eval('state.cloud.code');
    const passe = await A.eval('state.cloud.passeSala');
    check('A sala nasce com o passe da sala', /^[A-Za-z0-9_-]{43}$/.test(passe || ''), passe);
    check('Painel da sala: o host vê o interruptor, ligado', await A.eval(`!$('roomAmigosAberta').hidden && $('roomAmigosAbertaOn').checked`));
    const a1 = await anuncio(A);
    check('Ana anuncia com o passe da sala e o nome dela como host', a1?.passe === passe && a1?.host === 'Ana' && a1?.codigo === code, JSON.stringify(a1));

    const B = await openApp('amigosB', 9762);
    await B.eval(useInternet);
    await joinRoom(B, { name: 'Bia', addr: code, password: 'pizza-azul-marte' });
    check('Bia, que entrou com a senha, recebe o mesmo passe', await B.eval(`state.cloud.passeSala === '${passe}' && state.cloud.amigosMembros === true`));
    await B.waitFor(`!!salasAmigos.enviado`, 5000);
    const b1 = await anuncio(B);
    check('Bia, convidada, também anuncia: host Ana, 2 pessoas, o passe da sala', b1?.host === 'Ana' && b1?.pessoas === 2 && b1?.passe === passe, JSON.stringify(b1));
    check('"Na sala de Ana · Internet" vai aos amigos (a sala pela internet não fica escondida)',
      await B.eval(`(() => { const s = JSON.parse(salaAtualEnviada || 'null'); return s?.modo === 'internet' && s.host === 'Ana' && s.pessoas === 2; })()`));
    check('Bia não vê o interruptor do host', await B.eval(`$('roomAmigosAberta').hidden`));
    check('A sala da chamada não aparece', await B.eval(`(() => { state.cloud.chamada = true; const r = salaAtualResumo(); state.cloud.chamada = false; return r === null; })()`));

    // Caio, amigo só da Bia: vê a sala da Ana pela Bia
    const C = await openApp('amigosC', 9763);
    await C.eval(useInternet);
    await C.eval(`$('name').value = 'Caio'`);
    await entregar(C, b1);
    check('Cartão da sala: "Sala de Ana" com a Bia', await C.eval(`(() => { const t = sessionRow(sessoes.amigos[0]).textContent; return t.includes('Sala de Ana') && t.includes('com Bia') && !t.includes('com senha'); })()`));
    check('Aba Amigos: Entrar ao lado da Bia', await C.eval(`!!friendRow(${JSON.stringify(BIA)}, true).querySelector('.hub-entrar')`));
    check('Fora do modo Internet, sem Entrar', await C.eval(`(() => {
      saveNetworkPreferences({ provider: 'radmin' }); const sem = salaDoAmigo(${JSON.stringify(BIA)}) === null;
      saveNetworkPreferences({ provider: 'internet', internetUrl: '${SERVIDOR}' }); return sem && !!salaDoAmigo(${JSON.stringify(BIA)});
    })()`));

    // Quem criou sai: a Bia vira host, o passe continua, o anúncio passa a dizer "Bia"
    await A.eval('leaveRoom()');
    check('Ana saiu e tirou o anúncio dela', await A.eval(`salasAmigos.enviado === ''`));
    await B.waitFor(`state.hostId === state.myId && JSON.parse(salasAmigos.enviado || 'null')?.host === 'Bia'`, 8000);
    const b2 = await anuncio(B);
    check('Bia é a host e anuncia com o mesmo passe', b2?.passe === passe && b2?.pessoas === 1, JSON.stringify(b2));
    check('Agora a Bia vê o interruptor do host', await B.eval(`!$('roomAmigosAberta').hidden`));

    // Caio entra pelo Entrar da aba Amigos: sem código e sem senha
    await entregar(C, b2);
    await C.eval(`friendRow(${JSON.stringify(BIA)}, true).querySelector('.hub-entrar').click()`);
    await C.waitFor(`!$('room').hidden && state.myId`, 10000);
    check('Caio entrou sem senha, pelo passe da sala', await C.eval(`state.cloud.code === '${code}' && state.cloud.passe === '${passe}' && state.password === '' && state.members.size === 1`));
    await B.waitFor(`state.members.size === 1`, 5000);
    check('Na própria sala, a Bia não tem mais Entrar', await C.eval(`salaDoAmigo(${JSON.stringify(BIA)}) === null && !friendRow(${JSON.stringify(BIA)}, true).querySelector('.hub-entrar')`));
    check('Caio também recebeu o passe e anuncia aos amigos dele', await C.eval(`state.cloud.passeSala === '${passe}' && JSON.parse(salasAmigos.enviado || 'null')?.passe === '${passe}'`));

    // "Deixar meus amigos entrarem" desligado: sai o anúncio com o passe, fica o "Na sala de"
    await B.eval(`(() => { $('atvSalaEntrar').checked = false; $('atvSalaEntrar').onchange(); })()`);
    check('Deixar entrar desligado: sem anúncio, com "Na sala de Bia"', await B.eval(`salasAmigos.enviado === '' && JSON.parse(salaAtualEnviada || 'null')?.host === 'Bia' && localStorage.getItem('atividadeSalaEntrar') === '0'`));
    await B.eval(`(() => { $('atvSalaEntrar').checked = true; $('atvSalaEntrar').onchange(); })()`);
    check('Religar anuncia de novo na hora', await B.eval(`JSON.parse(salasAmigos.enviado || 'null')?.passe === '${passe}'`));
    await B.eval(`(() => { $('atvSala').checked = false; $('atvSala').onchange(); })()`);
    check('Mostrar desligado: nada vai e o "Deixar entrar" fica apagado', await B.eval(`salasAmigos.enviado === '' && salaAtualEnviada === '' && $('atvSalaEntrar').disabled`));
    await B.eval(`(() => { $('atvSala').checked = true; $('atvSala').onchange(); })()`);
    check('Mostrar religado: volta tudo', await B.eval(`!!salasAmigos.enviado && !!salaAtualEnviada && !$('atvSalaEntrar').disabled`));

    // O host desliga "Amigos de quem está na sala podem entrar": o passe cai para todos, ninguém sai
    await B.eval(`(() => { $('roomAmigosAbertaOn').checked = false; $('roomAmigosAbertaOn').onchange(); })()`);
    await C.waitFor(`state.cloud.amigosMembros === false`, 5000);
    check('Desligado: o passe some de todos e os anúncios saem', await C.eval(`state.cloud.passeSala === '' && salasAmigos.enviado === ''`)
      && await B.eval(`salasAmigos.enviado === ''`));
    check('O passe antigo não entra mais', (await tentarPasse(code, passe)) === 'error');
    check('Quem já estava continua', await C.eval(`!!state.myId && state.members.size === 1`));
    await B.eval(`(() => { $('roomAmigosAbertaOn').checked = true; $('roomAmigosAbertaOn').onchange(); })()`);
    await C.waitFor(`state.cloud.amigosMembros === true && !!state.cloud.passeSala`, 5000);
    const novo = await C.eval('state.cloud.passeSala');
    check('Religado: um passe novo, que entra', novo !== passe && (await tentarPasse(code, novo)) === 'welcome');
    check('E os anúncios voltam com o passe novo', await B.eval(`JSON.parse(salasAmigos.enviado || 'null')?.passe === '${novo}'`));
  } finally {
    await server.close();
  }
});
