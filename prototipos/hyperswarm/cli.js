// Teste entre dois PCs em redes diferentes (ex.: casa e 4G), sem Radmin.
// PC 1 (host):      node prototipos/hyperswarm/cli.js host
//                   → sobe uma sala de verdade e mostra o código de convite
// PC 2 (convidado): node prototipos/hyperswarm/cli.js entrar XXXX-XXXX-XXXX-XXXX
//                   → entra pela ponte, mede o tempo até entrar e a ida e volta do chat
// Os dois precisam do repositório com `npm ci` na raiz e em prototipos/hyperswarm.
const net = require('node:net');
const path = require('node:path');
const { WebSocket } = require(path.join(__dirname, '..', '..', 'node_modules', 'ws'));
const ponte = require('./ponte');

const [modo, codigoArg] = process.argv.slice(2);
const portaLivre = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function host() {
  const { startServer } = require('../../signaling');
  const porta = await portaLivre();
  await startServer(porta, '');
  const codigo = ponte.novoCodigo();
  await ponte.abrirHost({ codigo, porta, aoConectar: (quem, ip) => console.log(`${new Date().toLocaleTimeString()}  conexão de ${ip || '?'} (${quem})`) });
  // O próprio host fica na sala, para o convidado ter com quem falar
  const ws = new WebSocket(`ws://127.0.0.1:${porta}`);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', name: 'Host' })));
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'member-joined') console.log(`${new Date().toLocaleTimeString()}  ${m.name} entrou na sala`); });
  console.log(`\nSala aberta. Código de convite:\n\n    ${ponte.formatar(codigo)}\n\nNo outro PC: node prototipos/hyperswarm/cli.js entrar ${ponte.formatar(codigo)}\nCtrl+C para fechar.\n`);
}

async function entrar(codigo) {
  if (!ponte.valido(codigo)) { console.error('Código inválido (16 caracteres).'); process.exit(1); }
  const t0 = Date.now();
  const tunel = await ponte.entrar({ codigo, aoConectar: (h, p) => console.log(`túnel aberto até ${h}:${p} em ${Date.now() - t0} ms`) });
  const ws = new WebSocket(`ws://127.0.0.1:${tunel.porta}`);
  const msgs = [];
  ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
  ws.on('error', (e) => { console.error('Não conectou:', e.message); process.exit(1); });
  await new Promise((r) => ws.once('open', r));
  const esperar = async (pred, ms = 20000) => {
    const limite = Date.now() + ms;
    while (Date.now() < limite) { const i = msgs.findIndex(pred); if (i !== -1) return msgs.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 2)); }
    throw new Error('mensagem não chegou');
  };
  ws.send(JSON.stringify({ type: 'hello', name: 'Convidado' }));
  await esperar((m) => m.type === 'welcome');
  console.log(`entrou na sala em ${Date.now() - t0} ms`);
  const idas = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    ws.send(JSON.stringify({ type: 'chat', text: 'ping ' + i }));
    await esperar((m) => m.type === 'chat' && m.text === 'ping ' + i);
    idas.push(performance.now() - t);
  }
  idas.sort((a, b) => a - b);
  console.log(`chat ida e volta: mediana ${idas[15].toFixed(0)} ms, melhor ${idas[0].toFixed(0)} ms, pior ${idas[29].toFixed(0)} ms`);
  ws.close(); await tunel.fechar();
  process.exit(0);
}

if (modo === 'host') host();
else if (modo === 'entrar') entrar(codigoArg);
else console.log('Uso: node prototipos/hyperswarm/cli.js host | entrar <código>');
