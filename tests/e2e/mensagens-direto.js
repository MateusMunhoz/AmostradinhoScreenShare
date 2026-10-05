// Conexão direta das mensagens privadas (renderer/mensagens-direto.js): dois apps de verdade, cada um com uma conta
// de mentira. Os sinais (que na vida real vão cifrados pela RazzeAPI) passam por uma ponte feita pelo teste; a
// conexão, o canal e os arquivos são os de verdade. Confere texto, imagem que chega sozinha, arquivo com Baixar e a
// queda da conexão (o clipe apaga). A rota dos sinais na RazzeAPI tem os próprios testes (razze-control.test.js).
const { openApp, check, sleep, run } = require('./ajuda');

const ANA = 'a'.repeat(32), BIA = 'b'.repeat(32);

run('Mensagens privadas pela conexão direta', 120000, async () => {
  const A = await openApp('dmDiretoA', 9498);
  const B = await openApp('dmDiretoB', 9499);
  for (const [X, me, outro, nome] of [[A, ANA, BIA, 'Bia'], [B, BIA, ANA, 'Ana']]) {
    await X.waitFor(`typeof diretoGarantir === 'function'`);
    await X.eval(`(async () => {
      window.__saida = []; window.__entrada = [];
      diretoApi.enviar = async (to, text) => { window.__saida.push({ to, text }); return { ok: true }; };
      diretoApi.buscar = async () => window.__entrada.splice(0);
      friendsData.friends = [{ id: '${outro}', displayName: '${nome}', online: true }];
      await dmStart('${me}');
    })()`);
  }
  // A ponte: o que um manda, o outro recebe (como a RazzeAPI faria)
  let ponte = true;
  (async () => {
    while (ponte) {
      for (const [de, para, id] of [[A, B, ANA], [B, A, BIA]]) {
        const saida = await de.eval(`window.__saida.splice(0)`).catch(() => []);
        if (saida.length) await para.eval(`window.__entrada.push(...${JSON.stringify(saida.map((s) => ({ from: id, text: s.text, createdAt: Date.now() })))})`).catch(() => {});
      }
      await sleep(150);
    }
  })();

  await A.eval(`openDm('${BIA}')`);
  await A.waitFor(`!!diretoAberto('${BIA}')`, 20000);
  await B.waitFor(`!!diretoAberto('${ANA}')`, 10000);
  check('Abrir a conversa liga a conexão direta (quem tem a id menor oferece)', true);
  check('A janela diz que é direto e o clipe acende', await A.eval(`(() => { const el = dm.convs.get('${BIA}').el; return el.modo.dataset.modo === 'direto' && !el.attach.disabled; })()`));

  // Texto
  await A.eval(`(() => { const el = dm.convs.get('${BIA}').el; el.input.value = 'oi pela conexão direta'; dmSend(dm.convs.get('${BIA}')); })()`);
  await B.waitFor(`dm.convs.get('${ANA}')?.messages.some((m) => m.text === 'oi pela conexão direta' && m.direto)`, 5000);
  await sleep(300);
  check('O texto chega direto e a Ana recebe a confirmação', await A.eval(`[...direto.peers.get('${BIA}').acks.keys()].length === 0`));
  check('Na Bia, a conversa entra na barra com 1 não lida', await B.eval(`dm.bar.some((b) => b.id === '${ANA}') && dm.convs.get('${ANA}').unread === 1`));

  // Imagem: chega sozinha e aparece
  await A.eval(`(async () => {
    const c = new OffscreenCanvas(64, 48); const g = c.getContext('2d'); g.fillStyle = '#39FF9F'; g.fillRect(0, 0, 64, 48);
    const file = new File([await c.convertToBlob({ type: 'image/png' })], 'quadrado.png', { type: 'image/png' });
    await diretoAnexar(dm.convs.get('${BIA}'), [file]);
  })()`);
  await B.waitFor(`[...direto.prontos.keys()].length === 1`, 10000);
  await B.eval(`openDm('${ANA}')`);
  await B.waitFor(`!!dm.convs.get('${ANA}').el.list.querySelector('img.chat-image')`, 5000);
  check('A imagem chega sozinha e aparece na conversa', true);
  check('A imagem fica guardada neste PC', await B.eval(`(async () => { const id = [...direto.prontos.keys()][0]; return !!(await window.api.dmImagemLer(dm.account, id))?.bytes?.length; })()`));

  // Arquivo comum: Baixar
  const tamanho = 300 * 1024 + 17;
  await A.eval(`diretoAnexar(dm.convs.get('${BIA}'), [new File([new Uint8Array(${tamanho}).fill(7)], 'notas.bin', { type: 'application/octet-stream' })])`);
  await B.waitFor(`[...dm.convs.get('${ANA}').el.list.querySelectorAll('.file-card button')].some((b) => b.textContent === 'Baixar')`, 5000);
  check('Arquivo comum chega com Baixar (não baixa sozinho)', await B.eval(`direto.baixando.size === 0`));
  // Guarda o tamanho de cada blob criado (a CSP do app não deixa ler um blob: com fetch)
  await B.eval(`(() => { const orig = URL.createObjectURL; window.__blobs = []; URL.createObjectURL = (b) => { window.__blobs.push(b.size); return orig(b); }; })()`);
  await B.eval(`[...dm.convs.get('${ANA}').el.list.querySelectorAll('.file-card button')].find((b) => b.textContent === 'Baixar').click()`);
  await B.waitFor(`!!dm.convs.get('${ANA}').el.list.querySelector('.file-card a[download="notas.bin"]')`, 10000);
  check('Baixar traz o arquivo inteiro, com Salvar', (await B.eval(`window.__blobs`)).includes(tamanho), JSON.stringify(await B.eval(`window.__blobs`)));

  // Queda: a Ana fecha a conversa; na Bia, o canal cai e o clipe apaga
  ponte = false;
  await A.eval(`closeDm('${BIA}')`);
  await B.waitFor(`!diretoAberto('${ANA}')`, 10000);
  await B.eval(`renderDm()`);
  check('Sem a conexão direta, o clipe apaga e o modo diz "pelo servidor"', await B.eval(`(() => { const el = dm.convs.get('${ANA}').el; return el.attach.disabled && el.modo.dataset.modo !== 'direto'; })()`));
  await B.eval(`(async () => { await diretoAnexar(dm.convs.get('${ANA}'), [new File(['x'], 'a.txt')]); })()`);
  check('Arquivo sem conexão direta não sai (e avisa)', await B.eval(`dm.convs.get('${ANA}').el.status.textContent.includes('conexão direta')`));
  await B.shot('mensagens-direto.png');
  for (const X of [A, B]) await X.eval(`dmStop()`);
});
