// Aviso de atualização: aparece na tela inicial e na sala, "Depois" esconde, textos certos para cada caso.
// Não clica em "Atualizar agora" (isso reiniciaria o app).
const { openApp, createRoom, check, sleep, run } = require('./ajuda');

run('Aviso de atualização', 90000, async () => {
  const A = await openApp('updA', 9491);
  await A.waitFor(`update.myVersion`);
  await sleep(1500);
  check('Sem versão nova: sem aviso', await A.eval(`$('updateBanner').hidden`));
  await A.eval(`update.github = { version: '9.9.9' }; renderUpdateBanner()`);
  check('Versão no GitHub: aviso com "Atualizar agora"', await A.eval(`!$('updateBanner').hidden && $('ubTitle').textContent === 'Versão 9.9.9 disponível' && $('ubGo').textContent === 'Atualizar agora'`));
  await A.shot('aviso-atualizacao.png');
  await A.eval(`$('ubLater').click()`);
  check('"Depois" esconde', await A.eval(`$('updateBanner').hidden`));
  await A.eval(`update.ready = '9.9.10'; renderUpdateBanner()`);
  check('Versão mais nova baixada pela sala aparece mesmo depois do "Depois"', await A.eval(`!$('updateBanner').hidden && $('ubTitle').textContent === 'Versão 9.9.10 pronta'`));
  await createRoom(A, { name: 'Ana', port: 18799 });
  check('Na sala: avisa que sai da sala', await A.eval(`!$('updateBanner').hidden && $('ubText').textContent.includes('sai da sala')`));
  await A.eval(`update.ready = ''; update.dismissed = ''; update.exePage = 'https://example.invalid'; renderUpdateBanner()`);
  check('Precisa do .exe novo: "Abrir no GitHub"', await A.eval(`$('ubGo').textContent === 'Abrir no GitHub'`));
});
