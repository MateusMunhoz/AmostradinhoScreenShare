// Troca de host: Ana cria (com senha); Bia entra e assiste a Carla, que transmite. Ana sai: Bia vira host
// sem a tela da Carla cair. Dani entra na sala nova. O app da Bia é derrubado: Carla assume sozinha.
const { execFileSync } = require('child_process');
const { openApp, createRoom, joinRoom, share, frames, check, sleep, run, profileDir } = require('./ajuda');

const PORT = 18797;
const firstVideo = '[...state.in.values()][0].tile.video';

// Derruba o app de uma "pessoa" de repente (como se o PC dela travasse)
function crash(tag) {
  const dir = profileDir(tag).replace(/'/g, "''");
  execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*${dir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
}

run('Troca de host', 240000, async () => {
  const A = await openApp('hostA', 9471);
  await createRoom(A, { name: 'Ana', port: PORT, password: 'segredo' });
  const B = await openApp('hostB', 9472);
  await joinRoom(B, { name: 'Bia', addr: `127.0.0.1:${PORT}`, password: 'segredo' });
  const C = await openApp('hostC', 9473, { fake: true });
  await joinRoom(C, { name: 'Carla', addr: `127.0.0.1:${PORT}`, password: 'segredo' });
  await share(C);
  await B.waitFor(`[...state.members.values()].some((m) => m.sharing)`);
  await B.eval(`watch([...state.members].find(([, m]) => m.sharing)[0])`);
  await B.waitFor(`[...state.in.values()].every((l) => l.tile.video.videoWidth > 0)`, 20000);
  await A.eval(`(() => { $('chatInput').value = 'mensagem antes da troca'; sendChat(); })()`);
  await sleep(500);
  const ids = { B: await B.eval('state.myId'), C: await C.eval('state.myId') };
  const f0 = await frames(B, firstVideo);
  check('Todos sabem quem é o host (Ana)', (await B.eval(`nameOf(state.hostId)`)) === 'Ana' && (await C.eval(`nameOf(state.hostId)`)) === 'Ana');

  // 1) Ana sai pelo botão: o diálogo oferece passar a sala
  await A.eval(`$('leaveBtn').click()`);
  await sleep(300);
  check('Diálogo do host diz quem assume', await A.eval(`!$('handoffLeave').hidden && $('closeText').textContent.includes('Bia vira o host')`));
  await A.eval(`$('handoffLeave').click()`);
  await B.waitFor(`state.isOwner && !state.migrating && state.ws`, 20000);
  await C.waitFor(`state.hostId === '${ids.B}' && !state.migrating && state.ws`, 25000);
  check('Bia virou host; Carla reconectou nela', true);
  check('Mesmos números depois da troca', (await B.eval('state.myId')) === ids.B && (await C.eval('state.myId')) === ids.C);
  const f1 = await frames(B, firstVideo);
  check('A tela da Carla não caiu para a Bia (mesma conexão)', f1 >= f0 * 0.6 && f1 > 3 && (await B.eval(`[...state.in.values()][0].pc.connectionState`)) === 'connected', `${f1} quadros em 1,5 s, antes ${f0}`);
  check('Ana saiu da lista', (await C.eval(`[...state.members.values()].map((m) => m.name).join(',')`)) === 'Bia');
  check('Carla continua transmitindo na lista da Bia', await B.eval(`[...state.members.values()].find((m) => m.name === 'Carla').sharing === true`));
  check('Conversa continua no servidor novo', await B.eval(`chat.log.some((e) => e.text === 'mensagem antes da troca')`));
  await C.eval(`(() => { $('chatInput').value = 'depois da troca'; sendChat(); })()`);
  await B.waitFor(`[...$('chatList').querySelectorAll('.msg-text')].some((p) => p.textContent === 'depois da troca')`, 5000);
  check('Chat funciona depois da troca', true);
  check('Lista mostra "Host" na Bia', await C.eval(`[...document.querySelectorAll('.member')].some((li) => li.textContent.includes('Bia') && li.textContent.includes('Host'))`));

  // 2) Uma pessoa nova entra na sala da Bia com a senha de antes
  const D = await openApp('hostD', 9474);
  await joinRoom(D, { name: 'Dani', addr: `127.0.0.1:${PORT}`, password: 'segredo' });
  check('Dani entra na sala nova com a mesma senha', (await D.eval(`nameOf(state.hostId)`)) === 'Bia');

  // 3) O app da Bia cai de repente: Carla (a mais antiga depois dela) assume
  crash('hostB');
  await C.waitFor(`state.isOwner && !state.migrating && state.ws`, 30000);
  await D.waitFor(`state.hostId === '${ids.C}' && !state.migrating && state.ws`, 35000);
  check('App do host fechou de repente: Carla assumiu, Dani reconectou', true);
  check('Carla continua transmitindo', (await C.eval(`state.sharing`)) && (await D.eval(`[...state.members.values()].find((m) => m.name === 'Carla').sharing`)));
  await D.eval(`watch([...state.members].find(([, m]) => m.sharing)[0])`);
  await D.waitFor(`[...state.in.values()].every((l) => l.tile.video.videoWidth > 0)`, 20000);
  const fd = await frames(D, firstVideo);
  check('Dani consegue assistir depois da segunda troca', fd > 10, `${fd} quadros`);

  // 4) Encerrar para todos continua existindo
  await C.eval(`$('leaveBtn').click()`);
  await sleep(300);
  await C.eval(`$('confirmClose').click()`);
  await D.waitFor(`$('room').hidden`, 8000);
  check('Encerrar para todos derruba a sala', true);
});
