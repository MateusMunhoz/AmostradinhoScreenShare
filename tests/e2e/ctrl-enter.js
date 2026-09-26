// Ctrl+Enter de dentro do "jogo", com teclas de verdade pelo Windows. Uma janela de teste faz o papel do jogo.
// Só digita se a janela da frente for a janela de teste ou o chat por cima do jogo (nunca em outro programa).
// Fica de fora do "npm run test:e2e" porque rouba o foco: rode com  node tests/e2e/ctrl-enter.js
const path = require('path');
const { spawn } = require('child_process');
const { openApp, createRoom, joinRoom, winStyle, foreground, keys, check, sleep, run } = require('./ajuda');

const GAME = 'Jogo de teste Tela P2P';
const CHAT = 'Chat da sala · Tela P2P';
const press = (seq) => keys(seq, [GAME, CHAT]);

run('Ctrl+Enter no jogo', 150000, async () => {
  const A = await openApp('cmpA', 9501);
  await createRoom(A, { name: 'Ana', port: 18801 });
  const B = await openApp('cmpB', 9502);
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18801' });

  // O "jogo": uma janela simples do Windows, que fecha sozinha em 2 minutos
  const game = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'jogo-de-teste.ps1')], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 20 && foreground() !== GAME; i++) await sleep(300);
    check('Janela do "jogo" em primeiro plano', foreground() === GAME, foreground());

    press('^{ENTER}');
    await B.waitFor(`overlay.p && overlay.compose`, 5000);
    await sleep(700);
    check('Ctrl+Enter abre o chat por cima já para escrever', await B.eval(`overlay.compose && !overlay.edit && overlay.p.form.style.display === 'flex'`));
    check('O campo pega o teclado', foreground() === CHAT && (await B.eval(`overlay.p.win.document.activeElement === overlay.p.input`)), foreground());
    press('gg do jogo{ENTER}');
    await A.waitFor(`[...$('chatList').querySelectorAll('.msg-text')].some((p) => p.textContent === 'gg do jogo')`, 5000);
    check('Digitar e Enter manda a mensagem', true);
    await sleep(800);
    check('O teclado volta para o "jogo"', foreground() === GAME, foreground());
    const st = winStyle(CHAT);
    check('Travado de novo: clique atravessa, sem foco', st && st.transparent && st.noActivate);

    press('^{ENTER}');
    await B.waitFor(`overlay.compose`, 5000);
    await sleep(600);
    press('rascunho');
    await sleep(300);
    press('{ESC}');
    await sleep(800);
    check('Esc cancela e devolve o teclado', !(await B.eval(`overlay.compose`)) && foreground() === GAME && !(await A.eval(`chat.log.some((m) => m.text === 'rascunho')`)));
  } finally {
    try { process.kill(game.pid); } catch {}
  }
});
