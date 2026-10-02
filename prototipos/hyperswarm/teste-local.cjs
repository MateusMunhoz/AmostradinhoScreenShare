// Prova local da ponte: sobe a sala de verdade (signaling.js), o host da ponte e um convidado no mesmo PC,
// entra pela porta local do convidado (como o app faria) e mede.
// Node:     node prototipos/hyperswarm/teste-local.cjs
// Electron: npx electron prototipos/hyperswarm/teste-local.cjs   (prova que os módulos nativos carregam no Electron)
const net = require('node:net');
const path = require('node:path');
const { WebSocket } = require(path.join(__dirname, '..', '..', 'node_modules', 'ws'));
const { startServer, stopServer } = require('../../signaling');
const ponte = require('./ponte');

const noElectron = !!process.versions.electron;
let ok = 0, bad = 0;
const check = (nome, cond, extra = '') => { cond ? ok++ : bad++; console.log(`${cond ? 'OK   ' : 'FALHA'} ${nome}${extra ? '  (' + extra + ')' : ''}`); };
const portaLivre = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const fim = (code) => (noElectron ? require('electron').app.exit(code) : process.exit(code));

async function cliente(porta, nome) {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}`);
  const msgs = [];
  ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const esperar = async (pred, ms = 15000) => {
    const limite = Date.now() + ms;
    while (Date.now() < limite) { const i = msgs.findIndex(pred); if (i !== -1) return msgs.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error('mensagem não chegou');
  };
  ws.send(JSON.stringify({ type: 'hello', name: nome }));
  return { ws, esperar, welcome: await esperar((m) => m.type === 'welcome') };
}

async function main() {
  console.log(`\n== Ponte HyperDHT (${noElectron ? 'Electron ' + process.versions.electron : 'Node ' + process.version})`);
  setTimeout(() => { console.log('TEMPO ESGOTADO'); fim(1); }, 90000);
  const codigo = ponte.novoCodigo();
  check('Código de convite com 16 caracteres válidos', ponte.valido(codigo) && ponte.valido(ponte.formatar(codigo).toLowerCase()), ponte.formatar(codigo));

  const portaSala = await portaLivre();
  await startServer(portaSala, '');
  const host = await ponte.abrirHost({ codigo, porta: portaSala });
  const t0 = Date.now();
  const convidado = await ponte.entrar({ codigo, aoConectar: (h, p) => console.log(`      túnel aberto até ${h}:${p}`) });

  // O próprio host entra direto (vira o host da sala); a visita entra pelo túnel
  const dono = await cliente(portaSala, 'Host');
  const visita = await cliente(convidado.porta, 'Visita');
  const tEntrar = Date.now() - t0;
  check('Visita entra na sala pelo túnel e recebe o welcome', !!visita.welcome?.id, `${tEntrar} ms até o welcome`);
  check('Host vê a visita entrar', !!(await dono.esperar((m) => m.type === 'member-joined' && m.name === 'Visita').catch(() => null)));

  // Ida e volta pelo chat: média de 20 mensagens
  const idas = [];
  for (let i = 0; i < 20; i++) {
    const t = Date.now();
    visita.ws.send(JSON.stringify({ type: 'chat', text: 'ping ' + i }));
    await visita.esperar((m) => m.type === 'chat' && m.text === 'ping ' + i);
    idas.push(Date.now() - t);
  }
  idas.sort((a, b) => a - b);
  check('Chat vai e volta pelo túnel', idas.length === 20, `mediana ${idas[10]} ms, pior ${idas[19]} ms`);

  // Segunda conexão pelo mesmo convite (outra aba/reconexão): tem que funcionar em paralelo
  const visita2 = await cliente(convidado.porta, 'Visita 2');
  check('Segunda conexão pelo mesmo convite', !!visita2.welcome?.id);

  // Código errado não chega a lugar nenhum
  const errado = await ponte.entrar({ codigo: ponte.novoCodigo() });
  const tentou = await new Promise((r) => {
    const ws = new WebSocket(`ws://127.0.0.1:${errado.porta}`);
    const t = setTimeout(() => { ws.terminate(); r('sem resposta'); }, 8000);
    ws.once('open', () => { clearTimeout(t); r('abriu'); });
    ws.once('error', () => { clearTimeout(t); r('recusado'); });
    ws.once('close', () => { clearTimeout(t); r('fechou'); });
  });
  check('Código errado não entra', tentou !== 'abriu', tentou);

  for (const c of [dono, visita, visita2]) c.ws.close();
  await errado.fechar(); await convidado.fechar(); await host.fechar(); stopServer();
  console.log(`${ok} ok, ${bad} falhas`);
  fim(bad ? 1 : 0);
}

if (noElectron) require('electron').app.whenReady().then(main);
else main().catch((e) => { console.error(e); fim(1); });
