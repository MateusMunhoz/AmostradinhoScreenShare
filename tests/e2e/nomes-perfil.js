const { openApp, sleep, run, check, createRoom, joinRoom } = require('./ajuda');
// Os nomes da pessoa no perfil: o da sala e o da conta Razze, que vem pela sala; o Adicionar usa o nome do servidor.
// O volume de cada pessoa fica guardado pela conta (o de antes, pelo nome da sala, passa para ela).
// Contas de mentira (razzeUser) nos dois apps: nada vai para a RazzeAPI.
run('Nomes no perfil: o da sala e o da conta', 90000, async () => {
  const A = await openApp('nomesA', 9504), B = await openApp('nomesB', 9505);
  for (const [X, id, nome] of [[A, 'a'.repeat(32), 'Naitsi'], [B, 'b'.repeat(32), 'Bia Razze']]) {
    await X.eval(`localStorage.setItem('primeiraEntrada','1'); localStorage.setItem('modoUso','rapida'); localStorage.setItem('volumes', JSON.stringify({ Cris: { voice: 40, screen: 0, muted: false } }))`); // o volume de antes, pelo nome
    await X.send('Page.reload'); await sleep(2000);
    await X.eval(`razzeUser = { id: '${id}', displayName: '${nome}' }`);
  }
  await createRoom(A, { name: 'Cris', port: 47811 });
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:47811' });
  await B.waitFor(`[...state.members.values()].some((m) => m.razze?.nome === 'Naitsi')`, 8000);
  check('A conta Razze de quem criou chega a quem entrou', true);
  const idA = await B.eval(`[...state.members.entries()].find(([, m]) => m.name === 'Cris')[0]`);
  await B.eval(`openPersonCard('${idA}', document.querySelector('#room') || document.body)`);
  await sleep(400);
  const texto = await B.eval(`$('personCard').innerText`);
  check('O perfil mostra o nome da sala e o da conta', texto.includes('Na sala') && texto.includes('Cris') && texto.includes('Nome da conta') && texto.includes('Naitsi') && texto.includes('informado pelo app da pessoa'), JSON.stringify(texto));
  check('Adicionar usa o nome do servidor', await B.eval(`$('personCard').querySelector('.pc-friend').title`) === 'Adicionar Naitsi como amigo');
  await B.shot('nomes-perfil.png');
  // Volume: o de antes (pelo nome "Cris") vale e, ao mexer, passa a ficar pela conta
  check('O volume guardado pelo nome de antes continua valendo', await B.eval(`volOf('${idA}').voice`) === 40);
  await B.eval(`setVol('${idA}', { voice: 150 })`);
  const vols = await B.eval(`JSON.parse(localStorage.getItem('volumes'))`);
  check('Mexer no volume guarda pela conta, não pelo nome da sala', vols['razze:' + 'a'.repeat(32)]?.voice === 150 && !vols.Cris, JSON.stringify(vols));
  // A sai da conta no meio da sala
  await A.eval(`razzeUser = null; anunciarContaNaSala()`);
  await B.waitFor(`state.members.get('${idA}').razze === null`, 5000);
  check('Sair da conta no meio da sala chega aos outros', true);
});
