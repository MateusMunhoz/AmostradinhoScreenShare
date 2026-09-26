// Servidor de sinalização da sala: roda no PC de quem criou a sala.
// Ele só apresenta as pessoas umas às outras. Vídeo e áudio vão direto entre os PCs (P2P).
const { WebSocketServer } = require('ws');

let wss = null;
let pingTimer = null;

const LOCAL = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const MAX_MEMBERS = 12;
const CHAT_KEEP = 100;                        // mensagens que quem entra depois recebe
const CHAT_MAX_FILE = 200 * 1024 * 1024;      // o arquivo vai de quem mandou direto para quem baixar

// Cartão de arquivo do chat: só os dados para mostrar e pedir (o arquivo nunca passa pelo servidor inteiro)
function chatFile(f) {
  if (!f || typeof f !== 'object' || !/^[\w-]{8,64}$/.test(String(f.id))) return null;
  const size = Math.floor(Number(f.size));
  if (!(size > 0 && size <= CHAT_MAX_FILE)) return null;
  const name = String(f.name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^[.\s]+/, '').slice(0, 120) || 'arquivo';
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(f.mime || '')) ? String(f.mime) : '';
  return { id: String(f.id), name, size, mime };
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function startServer(port, password = '') {
  stopServer();
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: 256 * 1024 });
    const members = new Map(); // id -> { ws, name, sharing }
    let nextId = 1;
    const chatLog = [];
    let nextMsg = 1;

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
        if (!msg || typeof msg !== 'object') return;

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
          me = { ws, name: String(msg.name || 'Anônimo').slice(0, 32), sharing: false, version, voiceSession: '', muted: false };
          send(ws, {
            type: 'welcome',
            id,
            members: [...members].map(([mid, m]) => ({ id: mid, name: m.name, sharing: m.sharing, version: m.version, voiceSession: m.voiceSession, muted: m.muted })),
            features: ['chat', 'voice'],
            chat: chatLog,
          });
          members.set(id, me);
          broadcast({ type: 'member-joined', id, name: me.name, version }, id);
          return;
        }

        if (msg.type === 'voice-state') {
          if (typeof msg.session !== 'string' || !/^[\w-]{0,64}$/.test(msg.session)) return;
          me.voiceSession = msg.session;
          me.muted = !!msg.session && msg.muted === true;
          broadcast({ type: 'voice-state', id, session: me.voiceSession, muted: me.muted });
        } else if (msg.type === 'share') {
          me.sharing = !!msg.sharing;
          broadcast({ type: 'share-state', id, sharing: me.sharing }, id);
        } else if (msg.type === 'chat') {
          const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 2000) : '';
          const file = chatFile(msg.file);
          if (!text && !file) return;
          const entry = { id: String(nextMsg++), from: id, name: me.name, ts: Date.now() };
          if (text) entry.text = text;
          if (file) entry.file = file;
          chatLog.push(entry);
          if (chatLog.length > CHAT_KEEP) chatLog.shift();
          broadcast({ type: 'chat', ...entry }); // para todos, inclusive quem mandou
        } else if (msg.type === 'signal' && msg.to !== id && members.has(msg.to)) {
          if (msg.data?.side === 'voice' && (!me.voiceSession ||
              msg.data.session !== me.voiceSession || msg.data.targetSession !== members.get(msg.to).voiceSession ||
              !members.get(msg.to).voiceSession)) return;
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
