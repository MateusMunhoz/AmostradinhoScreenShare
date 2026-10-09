// Início novo (docs/spec/inicio-novo.md): a rede à vista no topo e trocada ali mesmo (com o motivo quando não dá), Criar
// e Entrar sempre ligados e no mesmo lugar, a sala em que você está só na faixa de cima (fora da lista, do resumo e da
// "Última sala"), "Sala" em vez de "Sessão", e o cartão "Novo na versão" que fecha e não volta.
const { openApp, createRoom, joinRoom, check, sleep, run } = require('./ajuda');

const PORTA = 18861;
const so = (X) => X.eval(`listaSessoes().filter((s) => s.porta === ${PORTA}).map((s) => s.host)`);

run('Início novo', 150000, async () => {
  const O = await openApp('inicioO', 9791);
  await O.eval(`$('name').value = 'Olga'`);
  await O.eval('renderRadmin()'); // o openApp troca a rede direto na preferência, sem passar pela tela
  await O.waitFor(`['Radmin', 'Rede local'].includes($('radminTitle').textContent)`, 5000);
  check('Rede à vista no topo, com estado e nome', await O.eval(`!$('homeRede').hidden && ['Radmin', 'Rede local'].includes($('radminTitle').textContent) && !!$('radminDetail').textContent`));
  check('Criar e Entrar à vista e ligados', await O.eval(`!$('goQuick').disabled && !$('goJoin').disabled && !$('goJoin').hidden && $('goCreate').textContent === 'Opções da sala'`));
  check('O título das salas diz a rede', await O.eval(`/^Salas abertas na (Radmin|rede local)$/.test($('sessionsTitle').textContent)`));

  // Menu da rede: abre, mostra as três, a em uso marcada; Razze sem conta não troca e diz por quê; Esc fecha
  await O.eval(`$('homeRede').click()`);
  await O.waitFor(`!$('homeRedeMenu').hidden && $('homeRedeOpcoes').children.length === 3`, 3000);
  check('Menu da rede: três redes, a em uso marcada', await O.eval(`$('homeRedeOpcoes').querySelector('.atual')?.dataset.modo === 'radmin' && $('homeRede').getAttribute('aria-expanded') === 'true'`));
  await O.eval(`$('homeRedeOpcoes').querySelector('[data-modo="razze"]').click()`);
  await O.waitFor(`!!$('homeRedeOpcoes').querySelector('.home-rede-opcao-erro')`, 5000);
  check('Razze sem conta: não troca e mostra o motivo na linha', await O.eval(`selectedNetworkProvider() === 'radmin' && $('homeRedeOpcoes').querySelector('[data-modo="razze"] .home-rede-opcao-erro').textContent.startsWith('Não dá agora')`));
  await O.eval(`$('homeRedeMenu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Esc fecha o menu e o foco volta ao botão', await O.eval(`$('homeRedeMenu').hidden && document.activeElement === $('homeRede')`));
  // Trocar para a Internet e voltar, pelo menu
  await O.eval(`(() => { $('homeRede').click(); })()`);
  await O.eval(`$('homeRedeOpcoes').querySelector('[data-modo="internet"]').click()`);
  await O.waitFor(`selectedNetworkProvider() === 'internet' && $('radminTitle').textContent === 'Internet'`, 5000);
  check('Escolher a Internet troca na hora: botão, título e Entrar mudam', await O.eval(`$('homeRedeMenu').hidden && $('sessionsTitle').textContent === 'Salas dos seus amigos' && $('goJoinSub').textContent.includes('código')`));
  await O.eval(`(() => { $('homeRede').click(); $('homeRedeOpcoes').querySelector('[data-modo="radmin"]').click(); })()`);
  await O.waitFor(`selectedNetworkProvider() === 'radmin'`, 5000);

  // A sala da Ana aparece para a Olga; a Bia, que entra nela, não vê a própria sala na lista nem no "Última sala"
  const A = await openApp('inicioA', 9792);
  await createRoom(A, { name: 'Ana', port: PORTA });
  await O.waitFor(`listaSessoes().some((s) => s.porta === ${PORTA})`, 8000);
  check('Olga vê "Sala de Ana", sem "Sessão" em lugar nenhum', await O.eval(`$('sessionList').textContent.includes('Sala de Ana') && !$('home').textContent.includes('Sessão') && Number($('sessionsTitle').dataset.total) >= 1`));
  const B = await openApp('inicioB', 9793);
  await joinRoom(B, { name: 'Bia', addr: `127.0.0.1:${PORTA}` });
  await B.eval(`show('home')`);
  await sleep(4000); // a procura de salas da Bia termina e a lista se desenha
  check('Bia, na sala, vê a faixa de cima', await B.eval(`!$('homeCall').hidden && $('homeCallTitle').textContent === 'Sala de Ana'`));
  check('…e não vê a própria sala na lista, no resumo nem na "Última sala"', (await so(B)).length === 0
    && await B.eval(`$('lastRoom').hidden && !$('homeResumo').textContent.includes('Ana') && !$('sessionList').textContent.includes('Sala de Ana')`));
  check('Numa sala, Criar e Entrar continuam ligados', await B.eval(`!$('goQuick').disabled && !$('goJoin').disabled`));
  await B.eval(`$('goJoin').click()`);
  await B.waitFor(`!!document.querySelector('.app-confirm:not([hidden])')`, 3000);
  check('Entrar numa sala estando numa sala pergunta antes de sair', await B.eval(`document.querySelector('.app-confirm:not([hidden])').textContent.includes('sala de Ana') && !!state.myId`));
  await B.eval(`[...document.querySelectorAll('.app-confirm:not([hidden]) button')].find((b) => b.textContent === 'Cancelar').click()`);
  await sleep(300);
  check('Cancelar deixa na sala', await B.eval(`!!state.myId && !document.querySelector('.app-confirm:not([hidden])')`));
  await B.eval(`leaveRoom()`);
  await B.eval(`show('home')`);
  await B.waitFor(`listaSessoes().some((s) => s.porta === ${PORTA})`, 8000);
  await sleep(300);
  check('Fora da sala: a última sala aberta na lista vira só informação', await B.eval(`!$('lastRoom').hidden && $('rejoinBtn').hidden && $('lastRoomMeta').textContent.includes('aberta na lista')`));

  // Novo na versão: aparece com o primeiro item da versão, fecha e não volta
  await O.eval(`(() => { save('novidadesVistas', ''); NOVIDADES.unshift({ version: update.myVersion, date: '2026-10-09', items: ['Teste: primeira linha', 'outra'] }); showNewsIfNew(); })()`);
  check('"Novo na versão" na coluna da direita, com o primeiro item', await O.eval(`!$('homeNovo').hidden && $('homeNovoTitulo').textContent === 'Novo na ' + update.myVersion && $('homeNovoTexto').textContent.startsWith('Teste: Primeira linha') && $('homeNovo').closest('.home-lado') !== null`));
  await O.shot('inicio-novo.png');
  await O.eval(`$('homeNovoFechar').click()`);
  await O.eval(`showNewsIfNew()`);
  check('Fechou: não volta nesta versão', await O.eval(`$('homeNovo').hidden && load('novidadesVistas') === update.myVersion`));
});
