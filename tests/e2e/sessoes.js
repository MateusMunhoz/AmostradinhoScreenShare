// Sessões abertas na rede: Ana cria uma sessão com senha e Olga, na tela inicial, vê ela aparecer, com o
// número de pessoas atualizado. A sessão oculta da Carla nunca aparece. Bia entra pelo botão da lista (com a
// senha). Na troca de host a sessão continua uma só, com o mesmo id; encerrada, some. Plano B: a pergunta
// direta a um endereço conhecido acha a sessão da Eva. Tudo no mesmo PC (o broadcast volta para ele mesmo).
const dgram = require('dgram');
const { openApp, createRoom, joinRoom, check, sleep, run } = require('./ajuda');

const P = { ana: 18821, carla: 18822, eva: 18823 };
const lista = (X) => X.eval(`listaSessoes().map((s) => ({ id: s.id, host: s.host, pessoas: s.pessoas, senha: s.senha, porta: s.porta }))`);

run('Sessões abertas na rede', 150000, async () => {
  const O = await openApp('sessO', 9511);
  await O.eval(`$('name').value = 'Olga'`);
  check('Tela inicial mostra a lista de sessões', await O.eval(`!$('sessionsEmpty').hidden && sessoes.observando`));

  const A = await openApp('sessA', 9512);
  await createRoom(A, { name: 'Ana', port: P.ana, password: 'abc' });
  await O.waitFor(`listaSessoes().some((s) => s.host === 'Ana')`, 8000);
  let l = await lista(O);
  const ana = l.find((s) => s.host === 'Ana');
  check('A sessão da Ana aparece, com senha e 1 pessoa', ana && ana.senha === true && ana.pessoas === 1 && ana.porta === P.ana, JSON.stringify(ana));
  check('Na tela: "Sessão de Ana", cadeado e Entrar', await O.eval(`(() => { const li = $('sessionList').querySelector('.session'); return li && li.textContent.includes('Sessão de Ana') && !!li.querySelector('.session-meta svg') && li.querySelector('button').textContent === 'Entrar'; })()`));
  check('Quem está na sala não procura sessões', await A.eval(`!sessoes.observando`));

  const C = await openApp('sessC', 9513);
  await C.eval(`$('roomVisible').checked = false`);
  await createRoom(C, { name: 'Carla', port: P.carla });
  const D = await openApp('sessD', 9514);
  await joinRoom(D, { name: 'Dani', addr: `127.0.0.1:${P.ana}`, password: 'abc' });
  await O.waitFor(`listaSessoes().find((s) => s.host === 'Ana')?.pessoas === 2`, 8000);
  check('Dani entrou: a lista mostra 2 pessoas', true);
  await sleep(3500);
  check('A sessão oculta da Carla não aparece', !(await lista(O)).some((s) => s.host === 'Carla'));

  // Bia entra pelo botão da lista: tem senha, então abre o "Entrar numa sala" com o endereço preenchido
  const B = await openApp('sessB', 9515);
  await B.eval(`$('name').value = 'Bia'`);
  await B.waitFor(`listaSessoes().some((s) => s.host === 'Ana')`, 8000);
  await B.eval(`$('sessionList').querySelector('.session button').click()`);
  check('Com senha: abre o painel de entrar com o endereço', await B.eval(`!$('joinPanel').hidden && $('roomAddr').value.endsWith(':${P.ana}')`));
  await B.eval(`(() => { $('joinPassword').value = 'abc'; $('joinBtn').click(); })()`);
  await B.waitFor(`!$('room').hidden`, 8000);
  check('Bia entrou na sessão da Ana pela lista', await B.eval(`[...state.members.values()].some((m) => m.name === 'Ana')`));
  await O.waitFor(`listaSessoes().find((s) => s.host === 'Ana')?.pessoas === 3`, 8000);
  check('Lista mostra 3 pessoas', true);

  // Troca de host: Ana sai sem encerrar; Dani (a mais antiga) vira o host; a sessão continua uma só
  await A.eval(`leaveRoom('Você saiu.')`);
  await D.waitFor(`state.isOwner`, 30000);
  await O.waitFor(`(() => { const l = listaSessoes(); return l.length >= 1 && l.some((s) => s.id === '${ana.id}' && s.host === 'Dani'); })()`, 15000);
  l = await lista(O);
  check('Depois da troca de host: a mesma sessão (mesmo id), agora da Dani', l.filter((s) => s.id === ana.id).length === 1 && l.filter((s) => s.host !== 'Carla').length === 1, JSON.stringify(l));

  // Encerrar para todos: some da lista em menos de 2 s
  await D.eval(`leaveRoom('Sala encerrada.', 'info', true)`);
  const t0 = Date.now();
  await O.waitFor(`!listaSessoes().some((s) => s.id === '${ana.id}')`, 5000);
  check('Encerrada: some da lista na hora', Date.now() - t0 < 2000, `${Date.now() - t0} ms`);

  // Plano B: sem o anúncio, a pergunta direta a um endereço conhecido acha a sessão
  const E = await openApp('sessE', 9516);
  await createRoom(E, { name: 'Eva', port: P.eva });
  await O.eval(`(() => { save('sessoesConhecidas', JSON.stringify(['127.0.0.1:${P.eva}', '127.0.0.1:1'])); sessoes.diretas.clear(); sondar(); })()`);
  await O.waitFor(`[...sessoes.diretas.values()].some((s) => s.host === 'Eva')`, 5000);
  check('Plano B: a pergunta direta acha a sessão da Eva', true);
  await O.eval(`(() => { save('sessoesConhecidas', JSON.stringify(['127.0.0.1:${P.carla}'])); sessoes.diretas.clear(); sondar(); })()`);
  await sleep(2500);
  check('Plano B: a sessão oculta não responde', !(await O.eval(`[...sessoes.diretas.values()].some((s) => s.host === 'Carla')`)));

  // Pacotes estranhos na porta da descoberta são ignorados; um anúncio certo entra e o "fechou" tira
  // Por broadcast, como o app: um pacote direto para a porta iria só para uma das cópias abertas
  const sock = dgram.createSocket('udp4');
  await new Promise((r) => sock.bind(0, r));
  sock.setBroadcast(true);
  const mandar = (m) => new Promise((r) => sock.send(Buffer.from(typeof m === 'string' ? m : JSON.stringify(m)), 47654, '255.255.255.255', r));
  const base = { app: 'tela-p2p', v: 1, tipo: 'sessao', id: 'abcdefabcdef0123', host: 'Teste', porta: 18830, pessoas: 1, senha: false };
  for (const m of ['{quebrado', 'x'.repeat(2000), { ...base, app: 'outro' }, { ...base, v: 9 }, { ...base, id: 'curto' },
    { ...base, porta: '18830' }, { ...base, pessoas: 999 }, { ...base, senha: 'sim' }, { ...base, host: '' }]) await mandar(m);
  await sleep(800);
  check('Pacotes inválidos não entram na lista', !(await lista(O)).some((s) => s.host === 'Teste'));
  await mandar(base);
  await O.waitFor(`listaSessoes().some((s) => s.host === 'Teste')`, 3000);
  await mandar({ app: 'tela-p2p', v: 1, tipo: 'fechou', id: base.id });
  await O.waitFor(`!listaSessoes().some((s) => s.host === 'Teste')`, 3000);
  check('Anúncio válido entra e o "fechou" tira', true);
  sock.close();
});
