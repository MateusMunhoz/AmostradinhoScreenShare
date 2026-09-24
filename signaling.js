// Servidor de sinalização da sala: roda no PC de quem criou a sala.
// Ele só apresenta as pessoas umas às outras. Vídeo e áudio vão direto entre os PCs (P2P).
const { WebSocketServer } = require('ws');

let wss = null;
let pingTimer = null;

const LOCAL = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const MAX_MEMBERS = 12;

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function startServer(port, password = '') {
  stopServer();
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: 256 * 1024 });
    const members = new Map(); // id -> { ws, name, sharing }
    let nextId = 1;

    const broadcast = (msg, exceptId) => {
      for (const [id, m] of members) if (id !== exceptId) send(m.ws, msg);
    };

    server.on('listening', () => {
      wss = server;
      pingTimer = setInterval(() => {
        for (const ws of server.clients) {
          if (ws.isAlive === false) { ws.terminate(); continue; }
          ws.isAlive = false;
          ws.ping();
        }
      }, 10000);
      resolve({ ok: true });
    });

    server.on('error', (err) => {
      if (wss === server) return console.error(err);
      resolve({
        ok: false,
        error: err.code === 'EADDRINUSE'
          ? `A porta ${port} já está em uso. Escolha outra.`
          : `Não foi possível abrir a sala: ${err.message}`,
      });
    });

    server.on('connection', (ws, req) => {
      const id = String(nextId++);
      const isLocal = LOCAL.includes(req.socket.remoteAddress);
      let me = null;
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        if (!me) {
          if (msg.type !== 'hello') return;
          if (password && !isLocal && msg.password !== password) {
            send(ws, { type: 'error', message: 'Senha incorreta.' });
            return ws.close();
          }
          if (members.size >= MAX_MEMBERS) {
            send(ws, { type: 'error', message: 'A sala está cheia.' });
            return ws.close();
          }
          // A versão de cada um serve para os apps baixarem atualizações uns dos outros
          const version = /^\d+\.\d+\.\d+$/.test(msg.version) ? msg.version : '';
          me = { ws, name: String(msg.name || 'Anônimo').slice(0, 32), sharing: false, version };
          send(ws, {
            type: 'welcome',
            id,
            members: [...members].map(([mid, m]) => ({ id: mid, name: m.name, sharing: m.sharing, version: m.version })),
          });
          members.set(id, me);
          broadcast({ type: 'member-joined', id, name: me.name, version }, id);
          return;
        }

        if (msg.type === 'share') {
          me.sharing = !!msg.sharing;
          broadcast({ type: 'share-state', id, sharing: me.sharing }, id);
        } else if (msg.type === 'signal' && msg.to !== id && members.has(msg.to)) {
          send(members.get(msg.to).ws, { type: 'signal', from: id, data: msg.data });
        }
      });

      ws.on('close', () => {
        if (!me) return;
        members.delete(id);
        broadcast({ type: 'member-left', id });
      });
    });
  });
}

function stopServer() {
  clearInterval(pingTimer);
  pingTimer = null;
  if (wss) {
    for (const ws of wss.clients) {
      ws.close(1000, 'room-closed');
      setTimeout(() => ws.terminate(), 1000);
    }
    wss.close();
    wss = null;
  }
}

module.exports = { startServer, stopServer };
