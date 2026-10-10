// Aviso de atualização (docs/spec/inicio-novo.md): sem cartão flutuante. No Início, o botão "Nova versão" no topo e
// "x.y.z disponível" no rodapé abrem o painel; fora do Início, o botão da barra da direita leva a ele. "Depois" esconde
// o botão, textos certos para cada caso. Não clica em "Atualizar e reiniciar" (isso reiniciaria o app).
const { openApp, createRoom, check, sleep, run } = require('./ajuda');

run('Aviso de atualização', 90000, async () => {
  const A = await openApp('updA', 9491);
  await A.waitFor(`update.myVersion`);
  await sleep(1500);
  check('Sem versão nova: sem botão, rodapé "atualizado"', await A.eval(`$('homeVersaoNova').hidden && $('navUpdate').hidden && $('homeVersaoEstado').textContent === 'atualizado' && $('homeVersaoEstado').disabled`));
  check('Nada flutua por cima das telas', await A.eval(`!document.getElementById('updateBanner')`));
  await A.eval(`update.github = { version: '9.9.9', page: 'https://github.com/x' }; renderUpdateBanner()`);
  check('Versão no GitHub: botão no topo e aviso no rodapé', await A.eval(`!$('homeVersaoNova').hidden && $('homeVersaoEstado').textContent === '9.9.9 disponível' && $('navUpdate').hidden`));
  await A.eval(`$('homeVersaoNova').click()`);
  check('O painel abre com a versão e "Atualizar e reiniciar"', await A.eval(`!$('homeVersaoPainel').hidden && $('hvTitulo').textContent === 'Nebula 9.9.9' && $('hvKicker').textContent === 'Nova versão disponível' && $('hvGo').textContent === 'Atualizar e reiniciar' && $('hvSub').textContent.includes(update.myVersion)`));
  await A.shot('aviso-atualizacao.png');
  await A.eval(`$('hvDepois').click()`);
  check('"Depois" fecha e esconde o botão; o rodapé continua avisando', await A.eval(`$('homeVersaoPainel').hidden && $('homeVersaoNova').hidden && $('homeVersaoEstado').textContent === '9.9.9 disponível'`));
  await A.eval(`$('homeVersaoEstado').click()`);
  check('O rodapé abre o painel de novo', await A.eval(`!$('homeVersaoPainel').hidden`));
  await A.eval(`$('homeVersaoPainel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Esc fecha o painel', await A.eval(`$('homeVersaoPainel').hidden`));
  await A.eval(`update.ready = '9.9.10'; renderUpdateBanner()`);
  check('Versão mais nova baixada pela sala aparece mesmo depois do "Depois"', await A.eval(`!$('homeVersaoNova').hidden && $('homeVersaoEstado').textContent === '9.9.10 pronta'`));
  await createRoom(A, { name: 'Ana', port: 18799 });
  check('Na sala: o botão da barra da direita aparece', await A.eval(`!$('navUpdate').hidden`));
  await A.eval(`$('navUpdate').click()`);
  check('Ele leva ao Início com o painel aberto, avisando que sai da sala', await A.eval(`!$('home').hidden && !$('homeVersaoPainel').hidden && $('hvKicker').textContent === 'Nova versão pronta' && $('hvAviso').textContent.includes('sai da sala')`));
  await A.eval(`update.ready = ''; update.dismissed = ''; update.exePage = 'https://example.invalid'; renderUpdateBanner(); renderVersaoPainel()`);
  check('Precisa do .exe novo: "Abrir no GitHub"', await A.eval(`$('hvGo').textContent === 'Abrir no GitHub'`));
});
