// Host sozinho na sala: clicar duas vezes em Abrir minha sala não derruba a sala (o segundo servidor fechava o
// primeiro e a troca de host desistia: "Não foi possível continuar a sala depois que o host saiu."); se a conexão
// com o próprio servidor cai, o host volta para ele; se o servidor parou, abre de novo.
const { openApp, check, sleep, run } = require('./ajuda');

run('Host sozinho: a sala não cai', 90000, async () => {
  const A = await openApp('hostSozinho', 9512);
  await A.waitFor(`typeof createRoom === 'function'`);
  await sleep(800);
  await A.eval(`(() => {
    window.__erros = [];
    const t = toast;
    toast = (m, k) => { if (k === 'error') window.__erros.push(m); return t(m, k); };
    $('roomPort').value = '8792';
    $('roomPassword').value = '';
    void createRoom();
    void createRoom();
  })()`);
  check('Abrindo: os botões do Início ficam desativados', await A.eval(`state.abrindo && $('goQuick').disabled`));
  await A.waitFor(`!!state.myId && !state.abrindo`, 10000);
  await sleep(3000);
  const id = await A.eval(`state.myId`);
  check('Clique duplo em Abrir minha sala: entra na sala, sem erro', await A.eval(`!!state.myId && state.isOwner && window.__erros.length === 0`), await A.eval(`JSON.stringify(window.__erros)`));

  // A conexão com o próprio servidor cai (o servidor continua de pé): volta para ele com o mesmo número
  await A.eval(`state.ws.close()`);
  await A.waitFor(`!state.migrating && !!state.ws && state.ws.readyState === 1`, 10000);
  check('Conexão com o próprio servidor caiu: volta para ele, com o mesmo número', await A.eval(`state.myId === ${JSON.stringify(id)} && state.isOwner && window.__erros.length === 0`), await A.eval(`JSON.stringify(window.__erros)`));

  // O servidor parou sem o host sair: sozinho, o host abre de novo
  await A.eval(`void window.api.stopServer()`);
  await sleep(500);
  await A.waitFor(`!state.migrating && !!state.ws && state.ws.readyState === 1`, 15000);
  check('Servidor parou com o host sozinho: abre de novo e continua na sala', await A.eval(`state.myId === ${JSON.stringify(id)} && state.isOwner && window.__erros.length === 0`), await A.eval(`JSON.stringify(window.__erros)`));

  await A.eval(`leaveRoom()`);
});
