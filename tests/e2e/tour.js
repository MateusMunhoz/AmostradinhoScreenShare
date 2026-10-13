// Passo a passo guiado (docs/spec/tour-entrar-na-sala.md), com um servidor do modo Internet local. Ana faz o roteiro
// "Criar sala" de verdade; Bia faz "Entrar com código e senha" em ensaio (o Entrar não entra) e depois com o código da
// Ana (entra de fato). Também: clique fora do alvo não chega no app, Esc sai, alvo que some oferece Recomeçar.
const { openApp, check, sleep, run } = require('./ajuda');
const { createInternetServer } = require('../../servidor-internet/server');

const PORT = 18877;
const useInternet = `(() => { saveNetworkPreferences({ provider: 'internet', internetUrl: 'ws://127.0.0.1:${PORT}' }); renderConnectivitySettings(); renderRadmin(); })()`;
const passo = (X) => X.eval(`tour.id ? (tour.final ? 'fim:' + $('tourTitulo').textContent : tour.id + ':' + tour.i) : ''`);
// Espera o passo chegar (o passo a passo confere a cada 150 ms) e o anel se mover para o alvo novo
const noPasso = async (X, alvo) => { await X.waitFor(`(tour.id ? (tour.final ? 'fim:' + $('tourTitulo').textContent : tour.id + ':' + tour.i) : '').startsWith(${JSON.stringify(alvo)})`, 6000).catch(() => {}); await sleep(350); };
const clicarAcao = (X, rotulo) => X.eval(`[...$('tourAcoes').children].find((b) => b.textContent === ${JSON.stringify(rotulo)}).click()`);
// O anel em volta do alvo: o retângulo do anel contém o do elemento
const anelEm = (X, sel) => X.eval(`(() => {
  const a = document.querySelector('.tour-anel').getBoundingClientRect(), e = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
  return a.left <= e.left + 1 && a.top <= e.top + 1 && a.right >= e.right - 1 && a.bottom >= e.bottom - 1 && a.width > 0;
})()`);

run('Passo a passo guiado', 240000, async () => {
  const server = createInternetServer({ host: '127.0.0.1', port: PORT, log: () => {}, stunUrls: [], turnHost: '' });
  await server.listen();
  try {
    const A = await openApp('tourA', 9791);
    await A.eval(useInternet);
    await A.eval(`(() => { $('name').value = 'Ana'; })()`);
    await A.eval(`$('tourAbrir').click()`);
    check('Início: "Como entrar numa sala?" abre os quatro roteiros', await A.eval(`!$('tourLista').hidden && $('tourLista').children.length === 4 && $('tourLista').textContent.includes('Criar sala e chamar os amigos')`));

    // ---------- Criar sala (Ana, de verdade) ----------
    await A.eval(`[...$('tourLista').children].find((b) => b.textContent.includes('Criar sala')).click()`);
    await sleep(400);
    check('Roteiro começa: camada à vista, lista fechada, anel em Opções da sala', await A.eval(`!$('tour').hidden && $('tourLista').hidden`) && await anelEm(A, '#goCreate'));
    // Clique fora do alvo cai na faixa escura: o app não recebe
    const fora = await A.eval(`(() => { const r = $('goJoin').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await A.send('Input.dispatchMouseEvent', { type, x: fora[0], y: fora[1], button: 'left', clickCount: 1 });
    await sleep(300);
    check('Clique fora do alvo não chega no app', await A.eval(`$('joinPanel').hidden`) && (await passo(A)) === 'host:0');
    await A.eval(`$('goCreate').click()`);
    await noPasso(A, 'host:1');
    check('Opções da sala abre a tela e o passo segue para a senha', (await passo(A)) === 'host:1' && await anelEm(A, '#roomPassword'));
    await clicarAcao(A, 'Gerar uma senha');
    await noPasso(A, 'host:2');
    check('Gerar uma senha preenche e segue para as caixinhas', (await passo(A)) === 'host:2' && (await A.eval(`$('roomPassword').value.length`)) >= 4 && await anelEm(A, '#roomAmigosMembrosLine'));
    await clicarAcao(A, 'Entendi');
    await sleep(300);
    check('Criar sala: o balão avisa que a sala é de verdade', (await passo(A)) === 'host:3' && /de verdade/.test(await A.eval(`$('tourTexto').textContent`)));
    await A.eval(`$('createBtn').click()`);
    await A.waitFor(`tour.i === 4`, 15000);
    check('Sala criada: o passo acende o nome da sala', await anelEm(A, '#roomMenuBtn'));
    await A.eval(`$('roomMenuBtn').click()`);
    await noPasso(A, 'host:5');
    check('Menu aberto: o passo explica código e senha', (await passo(A)) === 'host:5' && await anelEm(A, '#roomMenu'));
    await A.shot('tour-menu-da-sala.png');
    await clicarAcao(A, 'Entendi');
    await noPasso(A, 'host:7'); // sem conta, o Convidar da aba Amigos (host:6) fica de fora
    check('Entendi fecha o menu e acende o Convidar da barrinha', (await passo(A)) === 'host:7' && await A.eval(`$('roomMenu').hidden`) && await anelEm(A, '#dockAddr'));
    await A.eval(`$('dockAddr').click()`);
    await sleep(400);
    check('Fim: ficar na sala ou encerrar', (await passo(A)) === 'fim:Sua sala está aberta');
    await A.shot('tour-fim-host.png');
    const codigo = await A.eval('state.cloud.code');
    const senha = await A.eval(`$('roomPassword').value`);
    await clicarAcao(A, 'Ficar na sala');
    check('Ficar na sala fecha o passo a passo e mantém a sala', await A.eval(`$('tour').hidden && !!state.myId`));

    // ---------- Código e senha (Bia): ensaio ----------
    const B = await openApp('tourB', 9792);
    await B.eval(useInternet);
    await B.eval(`(() => { $('name').value = 'Bia'; iniciarTour('codigo'); })()`);
    await sleep(400);
    check('Rede já em Internet: primeiro passo só com Entendi', (await passo(B)) === 'codigo:0' && await anelEm(B, '#homeRede') && /já mostra/.test(await B.eval(`$('tourTexto').textContent`)));
    await B.shot('tour-rede.png');
    await clicarAcao(B, 'Entendi');
    await sleep(300);
    await B.eval(`$('goJoin').click()`);
    await noPasso(B, 'codigo:2');
    check('Entrar numa sala abre os campos e o passo acende código e senha', (await passo(B)) === 'codigo:2' && await anelEm(B, '#roomAddr') && await anelEm(B, '#joinPassword'));
    await clicarAcao(B, 'Preencher exemplo');
    await noPasso(B, 'codigo:3');
    check('Exemplo preenchido: passo do Entrar em ensaio', (await passo(B)) === 'codigo:3' && /ensaio/.test(await B.eval(`$('tourTitulo').textContent`)));
    await B.eval(`$('joinBtn').click()`);
    await sleep(800);
    check('Ensaio: o Entrar não entra e o passo a passo termina', (await passo(B)) === 'fim:Pronto, você ensaiou' && await B.eval(`$('room').hidden && !state.myId && $('joinPanel').hidden`));
    await clicarAcao(B, 'Fechar');

    // Esc no meio
    await B.eval(`iniciarTour('codigo')`);
    await sleep(300);
    await B.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    check('Esc sai do passo a passo', await B.eval(`$('tour').hidden && !tour.id`));

    // Alvo que some
    await B.eval(`(() => { iniciarTour('codigo'); $('tourAcoes').firstElementChild.click(); $('homeCard').hidden = true; })()`);
    await noPasso(B, 'fim:Esse passo');
    check('Alvo sumiu: oferece Recomeçar', (await passo(B)).startsWith('fim:Esse passo saiu') && await B.eval(`[...$('tourAcoes').children].some((b) => b.textContent === 'Recomeçar')`));
    await B.eval(`(() => { $('homeCard').hidden = false; [...$('tourAcoes').children].find((b) => b.textContent === 'Sair').click(); })()`);

    // ---------- Código e senha (Bia): de verdade, na sala da Ana ----------
    await B.eval(`iniciarTour('codigo')`);
    await sleep(300);
    await clicarAcao(B, 'Entendi');
    await noPasso(B, 'codigo:1');
    await B.eval(`$('goJoin').click()`);
    await noPasso(B, 'codigo:2');
    await B.eval(`(() => { $('roomAddr').value = ${JSON.stringify(codigo)}; $('joinPassword').value = ${JSON.stringify(senha)}; })()`);
    await noPasso(B, 'codigo:3');
    check('Código de verdade: o Entrar não é ensaio', (await passo(B)) === 'codigo:3' && !/ensaio/.test(await B.eval(`$('tourTitulo').textContent`)), await passo(B));
    await B.eval(`$('joinBtn').click()`);
    await B.waitFor(`tour.i === 4 && !$('room').hidden`, 15000);
    await sleep(400);
    check('Entrou na sala da Ana: o passo acende Entrar na voz', await B.eval(`state.cloud?.code === ${JSON.stringify(codigo)} && !$('tour').classList.contains('pausado')`) && await B.eval(`(() => { const b = tourPorTexto('Entrar na voz'); const a = document.querySelector('.tour-anel').getBoundingClientRect(), e = b.getBoundingClientRect(); return a.left <= e.left + 1 && a.right >= e.right - 1; })()`));
    await B.shot('tour-entrar-na-voz.png');
    await clicarAcao(B, 'Concluir');
    await sleep(300);
    check('Concluir termina', (await passo(B)) === 'fim:Pronto');
    await clicarAcao(B, 'Fechar');

    // ---------- Lista de amigos e convite, sem conta: os exemplos (Caio) ----------
    const C = await openApp('tourC', 9793);
    await C.eval(useInternet);
    await C.eval(`(() => { $('name').value = 'Caio'; iniciarTour('amigos'); })()`);
    await noPasso(C, 'amigos:0');
    await clicarAcao(C, 'Entendi');
    await noPasso(C, 'amigos:1');
    check('Sem conta: o passo abre Perfil › Conta e acende o formulário', await C.eval(`!$('profilePane').hidden && !$('profilePanelConta').hidden`) && await anelEm(C, '#razzeAuth'));
    await clicarAcao(C, 'Pular e ver com um exemplo');
    await noPasso(C, 'amigos:3');
    check('Pulou a conta e os amigos: a sala de exemplo na lista, com a etiqueta e o anel no Entrar', await C.eval(`$('profilePane').hidden && !!$('sessionList').querySelector('.session-exemplo') && $('sessionList').textContent.includes('Exemplo do passo a passo')`) && await anelEm(C, '.session-exemplo .session-entrar'));
    check('O resumo do topo não conta a sala de exemplo', !(await C.eval(`$('homeResumo').textContent`)).includes('Exemplo'));
    await C.shot('tour-sala-exemplo.png');
    await C.eval(`$('sessionList').querySelector('.session-exemplo .session-entrar').click()`);
    await noPasso(C, 'fim:');
    check('Entrar no exemplo explica e não entra', (await passo(C)) === 'fim:Assim se entra pela lista' && await C.eval(`!state.myId`));
    await clicarAcao(C, 'Fechar');
    check('Ao sair, a sala de exemplo some', await C.eval(`!$('sessionList').querySelector('.session-exemplo') && !sessoes.exemplo && sessoes.amigos.every((s) => !s.exemplo)`));

    await C.eval(`iniciarTour('convite')`);
    await noPasso(C, 'convite:0');
    await clicarAcao(C, 'Entendi');
    await noPasso(C, 'convite:4');
    check('Sem convite: o cartão de exemplo no balão, no meio da tela', await C.eval(`$('tour').classList.contains('sem-alvo') && !!$('tourConteudo').querySelector('.dm-invite button')`));
    await C.shot('tour-convite-exemplo.png');
    await C.eval(`$('tourConteudo').querySelector('.dm-invite button').click()`);
    await noPasso(C, 'fim:');
    check('Entrar no convite de exemplo explica e não entra', (await passo(C)) === 'fim:Assim se entra por um convite' && await C.eval(`!state.myId`));
    await clicarAcao(C, 'Fechar');

    // ---------- Com conta (de mentira, só no app) e a Ana de verdade numa sala ----------
    const ANA = 'a'.repeat(32), CAIO = 'c'.repeat(32);
    const anuncio = await A.eval(`JSON.parse(salasAmigos.enviado || 'null')`);
    await C.eval(`(() => {
      razzeUser = { id: '${CAIO}', displayName: 'Caio', handle: 'Caio#0001', email: 'caio@example.com', handleChosen: true, emailVerified: true };
      dm.account = '${CAIO}';
      friendsData.friends = [{ id: '${ANA}', displayName: 'Ana', online: true }];
      renderAmigos(); renderDm();
      receberSalasAmigos([${JSON.stringify({ ...anuncio, userId: ANA, amigos: [{ userId: ANA, displayName: 'Ana' }] })}]);
      renderSessoes();
      iniciarTour('amigos');
    })()`);
    await noPasso(C, 'amigos:0');
    await clicarAcao(C, 'Entendi');
    await noPasso(C, 'amigos:3');
    check('Com conta e amigo: pula conta e amigos e acende o Entrar da sala da Ana', await C.eval(`!$('sessionList').querySelector('.session-exemplo') && /Ana/.test($('tourTitulo').textContent)`));
    await C.eval(`[...$('sessionList').querySelectorAll('.session-entrar')].find((b) => !b.closest('.session-exemplo')).click()`);
    await C.waitFor(`tour.i === 4 && !$('room').hidden`, 15000).catch(() => {});
    check('Entrou na sala da Ana pela lista, sem senha', await C.eval(`state.cloud?.code === ${JSON.stringify(codigo)}`) && (await passo(C)) === 'amigos:4');
    await clicarAcao(C, 'Concluir');
    await sleep(200);
    await clicarAcao(C, 'Fechar');
    await C.eval('leaveRoom()');
    await sleep(800);

    // Convite de verdade nas mensagens: o texto que o app da Ana manda
    const convite = await A.eval(`textoConvite(conviteDaSala())`);
    await C.eval(`(() => {
      const c = dmConv('${ANA}'); c.name = 'Ana';
      const m = { id: 'm1', seq: 1, from: '${ANA}', to: '${CAIO}', text: ${JSON.stringify(convite)}, createdAt: Date.now() };
      c.messages = [m]; c.last = m; c.unread = 1; c.loaded = true;
      renderDm();
      iniciarTour('convite');
    })()`);
    await noPasso(C, 'convite:0');
    await clicarAcao(C, 'Entendi');
    await noPasso(C, 'convite:1');
    check('Convite de verdade: acende o envelope', await anelEm(C, '#dmBarLabel'));
    await C.eval(`$('dmBarLabel').click()`);
    await noPasso(C, 'convite:2');
    await C.eval(`$('dmPanelConvList').firstElementChild.click()`);
    await noPasso(C, 'convite:3');
    check('Conversa aberta: acende o Entrar do cartão', await anelEm(C, '.dm-slot.open .dm-invite button'));
    await C.shot('tour-convite-real.png');
    await C.eval(`document.querySelector('.dm-slot.open .dm-invite button').click()`);
    await C.waitFor(`tour.i === 5 && !$('room').hidden`, 15000).catch(() => {});
    check('Entrou na sala da Ana pelo convite', await C.eval(`state.cloud?.code === ${JSON.stringify(codigo)}`) && (await passo(C)) === 'convite:5');
  } finally {
    await server.close?.();
  }
});
