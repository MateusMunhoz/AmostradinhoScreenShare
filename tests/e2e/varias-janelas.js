// Várias janelas flutuantes: Ana, Carla e Dani transmitem; Bia abre as três ao mesmo tempo.
// Posições, travar todas, transparência salva por vaga, fechar uma, reabrir na mesma vaga e a arrumação
// em grupo (mesmo tamanho, coluna ou linha, canto da tela).
const fs = require('fs');
const path = require('path');
const { openApp, createRoom, joinRoom, share, frames, winStyle, winRect, overlap, check, sleep, run, profileDir } = require('./ajuda');

const PORT = 18796;
const NAMES = ['Ana', 'Carla', 'Dani'];
const title = (n) => `${n} · Tela P2P`;
const all = () => NAMES.map((n) => winRect(title(n)));
const noOverlap = (r) => r.every(Boolean) && !overlap(r[0], r[1]) && !overlap(r[0], r[2]) && !overlap(r[1], r[2]);

run('Várias janelas flutuantes', 220000, async () => {
  const A = await openApp('janA', 9461, { fake: true });
  await createRoom(A, { name: 'Ana', port: PORT });
  await share(A);
  for (const [tag, port, name] of [['janC', 9462, 'Carla'], ['janD', 9463, 'Dani']]) {
    const X = await openApp(tag, port, { fake: true });
    await joinRoom(X, { name, addr: `127.0.0.1:${PORT}` });
    await share(X);
  }
  const B = await openApp('janB', 9464);
  await joinRoom(B, { name: 'Bia', addr: `127.0.0.1:${PORT}` });
  await B.waitFor(`[...state.members.values()].filter((m) => m.sharing).length === 3`);
  await B.eval(`[...state.members].filter(([, m]) => m.sharing).forEach(([id]) => watch(id))`);
  await B.waitFor(`state.in.size === 3 && [...state.in.values()].every((l) => l.tile.video.videoWidth > 0)`, 30000);

  for (let i = 0; i < 3; i++) { await B.eval(`[...state.in.values()][${i}].tile.pipBtn.click()`); await sleep(500); }
  await B.waitFor(`state.pips.size === 3 && [...state.pips.values()].every((p) => p.video.videoWidth > 0)`, 15000);
  check('Três janelas flutuantes abertas', (await B.eval(`state.pips.size`)) === 3);
  const f = [];
  for (let i = 0; i < 3; i++) f.push(await frames(B, `[...state.pips.values()][${i}].video`));
  check('As três com vídeo tocando', f.every((n) => n > 10), f.join(' / '));
  const rects = all();
  check('Nenhuma janela em cima da outra', noOverlap(rects));
  check('Todas por cima e sem pegar o foco', NAMES.map((n) => winStyle(title(n))).every((s) => s && s.topmost && s.noActivate));
  check('Barra mostra os três nomes', (await B.eval(`$('pipChipText').textContent`)) === 'Janelas flutuantes: Ana, Carla, Dani');

  await B.eval(`window.api.pipSetEdit(false)`);
  await sleep(700);
  check('Travar trava todas (clique atravessa)', NAMES.map((n) => winStyle(title(n))).every((s) => s && s.transparent));
  await B.eval(`window.api.pipOpacity([...state.pips.keys()][1], 0.6)`);
  await sleep(600);
  const saved = JSON.parse(fs.readFileSync(path.join(profileDir('janB'), 'janela-flutuante.json'), 'utf8'));
  check('Cada janela guarda a própria transparência', saved.slots[1].opacity === 0.6 && (saved.slots[0].opacity ?? 1) === 1);

  await B.eval(`[...state.in.values()][1].tile.pipBtn.click()`);
  await sleep(800);
  check('Fechar uma: as outras continuam', (await B.eval(`state.pips.size`)) === 2 && winRect(title('Carla')) === null && !!winRect(title('Ana')));
  check('Barra atualiza', (await B.eval(`$('pipChipText').textContent`)) === 'Janelas flutuantes: Ana, Dani');
  await B.eval(`[...state.in.values()][1].tile.pipBtn.click()`);
  await B.waitFor(`state.pips.size === 3`, 8000);
  await sleep(700);
  const back = winRect(title('Carla'));
  check('Reabrir volta para a mesma vaga', back && back.l === rects[1].l && back.t === rects[1].t);

  // Arrumação em grupo
  check('Controles de grupo aparecem com 2+ janelas', await B.eval(`[...state.pips.values()].every((p) => p.groupRow.style.display === 'flex')`));
  const id0 = await B.eval(`[...state.pips.keys()][0]`);
  await B.eval(`window.api.pipGroup('${id0}', { layout: 'linha', corner: 'tl' })`);
  await sleep(800);
  let r = all();
  check('Linha a partir de cima à esquerda', noOverlap(r) && r[0].t === r[1].t && r[1].t === r[2].t && r[0].l < r[1].l && r[1].l < r[2].l);
  await B.eval(`window.api.pipSize('${id0}', 'P')`);
  await sleep(800);
  r = all();
  check('Sem "mesmo tamanho": mudar uma não muda as outras', (r[0].r - r[0].l) !== (r[1].r - r[1].l));
  await B.eval(`[...state.pips.values()][0].linked.click()`);
  await sleep(900);
  r = all();
  const w = r.map((x) => x.r - x.l);
  check('Ligar "mesmo tamanho": todas iguais e reorganizadas', w[0] === w[1] && w[1] === w[2] && noOverlap(r));
  await B.eval(`window.api.pipSize([...state.pips.keys()][2], 'G')`);
  await sleep(900);
  r = all();
  const w2 = r.map((x) => x.r - x.l);
  check('Com "mesmo tamanho": G numa muda todas', w2.every((x) => x === w2[0]) && w2[0] > w[0] && noOverlap(r));
  await B.eval(`window.api.pipGroup('${id0}', { layout: 'coluna', corner: 'br' })`);
  await sleep(900);
  check('Coluna a partir de baixo à direita', noOverlap(all()));

  await B.eval(`$('pipChipClose').click()`);
  await sleep(900);
  check('X da barra fecha todas', (await B.eval(`state.pips.size`)) === 0 && NAMES.every((n) => winRect(title(n)) === null));
});
