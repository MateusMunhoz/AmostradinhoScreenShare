'use strict';
// Ajudante com permissão de administrador (roda como Node, com ELECTRON_RUN_AS_NODE). O app abre ele uma vez
// por sessão, com a janela de permissão do Windows, quando precisa mexer no túnel WireGuard. Assim o app
// continua sem administrador (arrastar arquivos para o chat e o resto funcionam normal).
//
// Ele é o cliente: conecta no pipe que o app abriu e só obedece a essa conexão. Quando o app fecha, o pipe
// fecha e o ajudante termina junto.
//   razze-ajudante.js <pipe> <wireguard.exe> <wg.exe> <pasta dos túneis>
const net = require('node:net');
const { createPrivileged } = require('./razze-privilegiado');

const [pipe, wireguard, wg, tunnels] = process.argv.slice(2);
if (!/^\\\\\.\\pipe\\tela-p2p-razze-[a-f0-9]{32}$/.test(String(pipe || '')) || !wireguard || !wg || !tunnels) process.exit(2);

const privileged = createPrivileged({ wireguard, wg, tunnels });
const socket = net.connect(pipe);
let buffer = '';
socket.setEncoding('utf8');
socket.on('data', (chunk) => {
  buffer += chunk;
  if (buffer.length > 64 * 1024) return socket.destroy();
  let end;
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const op = { install: () => privileged.install(msg.config), uninstall: () => privileged.uninstall(msg.tunnel), syncconf: () => privileged.syncconf(msg.tunnel, msg.config) }[msg.op];
    Promise.resolve().then(() => { if (!op) throw new Error('Operação desconhecida.'); return op(); })
      .then((output) => socket.write(JSON.stringify({ id: msg.id, ok: true, output }) + '\n'))
      .catch((error) => socket.write(JSON.stringify({ id: msg.id, ok: false, error: error.message }) + '\n'));
  }
});
socket.on('close', () => process.exit(0));
socket.on('error', () => process.exit(1));
