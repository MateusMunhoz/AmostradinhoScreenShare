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

// Endereços IPv4 que a pessoa diz ter (para os outros acharem ela se ela virar o host)
function cleanAddrs(list) {
  return (Array.isArray(list) ? list : []).map(String).filter((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)).slice(0, 8);
}

// seed: quando a sala passa para outra pessoa, o novo servidor continua a conversa e a numeração
function startServer(port, password = '', seed = {}) {
  stopServer();
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: 256 * 1024 });
    const members = new Map(); // id -> { ws, name, sharing, version, addrs }
    let nextId = Math.max(1, Math.floor(Number(seed.nextId)) || 1);
    const chatLog = (Array.isArray(seed.chat) ? seed.chat : []).slice(-CHAT_KEEP);
    let nextMsg = chatLog.reduce((n, e) => Math.max(n, (Number(e.id) || 0) + 1), 1);
    // Quem roda este servidor: numa sala nova, a primeira conexão do próprio PC; depois de uma troca,
    // já vem definido (os outros podem chegar antes do próprio novo host)
    let hostId = /^\d{1,6}$/.test(String(seed.hostId || '')) ? String(seed.hostId) : null;

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
      let id = null;
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
          // Voltando depois da troca de host: fica com o mesmo número, e as conexões diretas continuam valendo
          const resume = String(msg.resume || '');
          if (/^\d{1,6}$/.test(resume) && !members.has(resume)) {
            id = resume;
            nextId = Math.max(nextId, Number(resume) + 1);
          } else {
            while (members.has(String(nextId))) nextId++;
            id = String(nextId++);
          }
          if (!hostId && isLocal) hostId = id;
          me = { ws, name: String(msg.name || 'Anônimo').slice(0, 32), sharing: !!(resume && msg.sharing), version, addrs: cleanAddrs(msg.addrs) };
          const info = (mid, m) => ({ id: mid, name: m.name, sharing: m.sharing, version: m.version, addrs: m.addrs });
          send(ws, {
            type: 'welcome',
            id,
            hostId,
            members: [...members].map(([mid, m]) => info(mid, m)),
            features: ['chat', 'handoff'],
            chat: chatLog,
          });
          members.set(id, me);
          broadcast({ type: 'member-joined', ...info(id, me), resumed: !!resume }, id);
          return;
        }

        if (msg.type === 'share') {
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

// endRoom: o host encerrou para todos. Sem ele (saiu, fechou o app), quem ficou passa a sala adiante.
function stopServer({ endRoom = false } = {}) {
  clearInterval(pingTimer);
  pingTimer = null;
  if (wss) {
    for (const ws of wss.clients) {
      ws.close(1000, endRoom ? 'room-closed' : 'host-left');
      setTimeout(() => ws.terminate(), 1000);
    }
    wss.close();
    wss = null;
  }
}

module.exports = { startServer, stopServer };
