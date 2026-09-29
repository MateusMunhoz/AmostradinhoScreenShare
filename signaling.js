// Servidor de sinalização da sala: roda no PC de quem criou a sala.
// Ele só apresenta as pessoas umas às outras. Vídeo e áudio vão direto entre os PCs (P2P).
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

let wss = null;
let pingTimer = null;
// A sala em andamento, para o anúncio das sessões abertas: { sessao, port, password, members, hostId() }
let room = null;
let roomChanged = () => {};

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

// Configuração de quem transmite (qualidade, codificação, som), para a aba Transmissão das Estatísticas
function cleanShareInfo(i) {
  if (!i || typeof i !== 'object') return null;
  const out = {};
  if (typeof i.quality === 'string' && /^\d{3,4}p\d{2,3}$/.test(i.quality)) out.quality = i.quality;
  if (i.mode === 'once' || i.mode === 'per') out.mode = i.mode;
  if (typeof i.engine === 'string' && /^[\w .-]{1,24}$/.test(i.engine)) out.engine = i.engine;
  if (typeof i.hw === 'boolean') out.hw = i.hw;
  if (typeof i.audio === 'boolean') out.audio = i.audio;
  return out;
}

// Hash (SHA-256) da foto de perfil, ou vazio
function cleanHash(h) { return typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : ''; }
// Fonte do nome: só o id da lista de fontes do app (letras); cada app confere de novo se conhece o id
function cleanNameFont(f) { return typeof f === 'string' && /^[A-Za-z]{1,32}$/.test(f) ? f : ''; }

// Endereços IPv4 que a pessoa diz ter (para os outros acharem ela se ela virar o host)
function cleanAddrs(list) {
  return (Array.isArray(list) ? list : []).map(String).filter((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)).slice(0, 8);
}

// Sessão: um id que fica o mesmo quando a sala passa para outra pessoa (a lista das sessões abertas não
// duplica) e se ela aparece para quem procura na rede
function cleanSessao(s) {
  const id = s && /^[a-f0-9]{16}$/.test(String(s.id)) ? String(s.id) : crypto.randomBytes(8).toString('hex');
  return { id, oculta: !!(s && s.oculta === true) };
}

// Avisa o anúncio das sessões quando entra ou sai alguém (o número de pessoas muda)
function onRoomChange(cb) {
  roomChanged = typeof cb === 'function' ? cb : () => {};
}

// A sessão como aparece para quem procura; null sem sala, com a sala oculta ou antes de o host entrar
function roomInfo() {
  if (!room || room.sessao.oculta) return null;
  const host = room.members.get(room.hostId());
  if (!host) return null;
  return { id: room.sessao.id, host: host.name, pessoas: room.members.size, senha: !!room.password, porta: room.port };
}

// Quantas pessoas estão na sala agora (oculta ou não), para saber se ela vai passar adiante
function roomSize() {
  return room ? room.members.size : 0;
}

// Endereços do túnel da Razze: 10.64.0.0 a 10.127.255.255 (o mesmo teste de isOverlayAddress em main/razze-wireguard.js)
function isRazzeAddress(address) {
  const m = /^(?:::ffff:)?10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(address || ''));
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127 && Number(m[2]) <= 255 && Number(m[3]) <= 255;
}

// seed: quando a sala passa para outra pessoa, o novo servidor continua a conversa e a numeração.
// seed.onlyRazze: sala criada no modo Razze (só aceita quem vem pela VPN Razze)
function startServer(port, password = '', seed = {}) {
  stopServer();
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: 256 * 1024 });
    const onlyRazze = seed.onlyRazze === true;
    const members = new Map(); // id -> { ws, name, sharing, version, addrs }
    let nextId = Math.max(1, Math.floor(Number(seed.nextId)) || 1);
    const chatLog = (Array.isArray(seed.chat) ? seed.chat : []).slice(-CHAT_KEEP);
    let nextMsg = chatLog.reduce((n, e) => Math.max(n, (Number(e.id) || 0) + 1), 1);
    // Quem roda este servidor: numa sala nova, a primeira conexão do próprio PC; depois de uma troca,
    // já vem definido (os outros podem chegar antes do próprio novo host)
    let hostId = /^\d{1,6}$/.test(String(seed.hostId || '')) ? String(seed.hostId) : null;
    const sessao = cleanSessao(seed.sessao);

    const broadcast = (msg, exceptId) => {
      for (const [id, m] of members) if (id !== exceptId) send(m.ws, msg);
    };

    server.on('listening', () => {
      wss = server;
      room = { sessao, port, password, members, hostId: () => hostId };
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
      // Sala da rede Razze: só entra quem chega pelo túnel da Razze (ou o próprio PC). O servidor escuta em todas
      // as redes do PC, então sem isso quem estivesse no Radmin ou na mesma rede de casa entrava sem a VPN.
      if (onlyRazze && !isLocal && !isRazzeAddress(req.socket.remoteAddress)) {
        ws.once('message', (raw) => {
          let msg = null;
          try { msg = JSON.parse(raw); } catch {}
          if (msg?.type === 'hello') send(ws, { type: 'error', message: 'Esta sala é da rede Razze: conecte-se à rede Razze do host para entrar.' });
          ws.close();
        });
        return;
      }
      let me = null;
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (!msg || typeof msg !== 'object') return;

        if (!me) {
          // Quem procura sessões abertas pergunta sem entrar (e sem senha): nome do host, pessoas e se tem senha.
          // Sala oculta não responde.
          if (msg.type === 'info') {
            const i = roomInfo();
            if (i) send(ws, { type: 'info', app: 'tela-p2p', ...i });
            return ws.close();
          }
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
          // O mesmo PC entrando de novo (tentou, deu erro, tentou de novo): a conexão antiga era um fantasma que
          // continuava respondendo e aparecia repetida na lista. Sai da lista e cai antes de a nova entrar.
          const client = /^[a-f0-9]{32}$/.test(String(msg.client || '')) ? msg.client : '';
          if (client) {
            for (const [oldId, old] of members) {
              if (old.client !== client || oldId === resume) continue;
              members.delete(oldId);
              broadcast({ type: 'member-left', id: oldId });
              old.ws.terminate();
            }
          }
          if (/^\d{1,6}$/.test(resume) && !members.has(resume)) {
            id = resume;
            nextId = Math.max(nextId, Number(resume) + 1);
          } else {
            while (members.has(String(nextId))) nextId++;
            id = String(nextId++);
          }
          if (!hostId && isLocal) hostId = id;
          // Na volta, quem estava na voz continua na mesma sessão (as conexões de voz também seguem de pé)
          const shareInfo = resume && msg.sharing ? cleanShareInfo(msg.shareInfo) : null;
          const voiceSession = resume && typeof msg.voiceSession === 'string' && /^[\w-]{1,64}$/.test(msg.voiceSession) ? msg.voiceSession : '';
          me = {
            ws, client, name: String(msg.name || 'Anônimo').slice(0, 32), sharing: !!(resume && msg.sharing), version, addrs: cleanAddrs(msg.addrs),
            voiceSession, muted: !!voiceSession && msg.muted === true, deafened: !!voiceSession && msg.deafened === true, shareInfo, avatar: cleanHash(msg.avatar), nameFont: cleanNameFont(msg.nameFont),
          };
          const info = (mid, m) => ({ id: mid, name: m.name, sharing: m.sharing, version: m.version, addrs: m.addrs, voiceSession: m.voiceSession, muted: m.muted, deafened: m.deafened, shareInfo: m.shareInfo, avatar: m.avatar, nameFont: m.nameFont });
          send(ws, {
            type: 'welcome',
            id,
            hostId,
            members: [...members].map(([mid, m]) => info(mid, m)),
            features: ['chat', 'voice', 'handoff', 'sessoes'],
            chat: chatLog,
            sessao,
          });
          members.set(id, me);
          broadcast({ type: 'member-joined', ...info(id, me), resumed: !!resume }, id);
          roomChanged();
          return;
        }

        if (msg.type === 'voice-state') {
          if (typeof msg.session !== 'string' || !/^[\w-]{0,64}$/.test(msg.session)) return;
          me.voiceSession = msg.session;
          me.muted = !!msg.session && msg.muted === true;
          me.deafened = !!msg.session && msg.deafened === true; // fone silenciado: os outros veem na lista da voz
          broadcast({ type: 'voice-state', id, session: me.voiceSession, muted: me.muted, deafened: me.deafened });
        } else if (msg.type === 'avatar') {
          // Foto de perfil: só o hash passa por aqui; a foto vai direto de quem tem para quem pede
          me.avatar = cleanHash(msg.hash);
          broadcast({ type: 'avatar-state', id, hash: me.avatar }, id);
        } else if (msg.type === 'name-font') {
          me.nameFont = cleanNameFont(msg.font);
          broadcast({ type: 'name-font-state', id, font: me.nameFont }, id);
        } else if (msg.type === 'share') {
          me.sharing = !!msg.sharing;
          me.shareInfo = me.sharing ? cleanShareInfo(msg.info) : null;
          broadcast({ type: 'share-state', id, sharing: me.sharing, info: me.shareInfo }, id);
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
        if (!me || members.get(id) !== me) return; // já tinha saído (substituída pela conexão nova do mesmo PC)
        members.delete(id);
        broadcast({ type: 'member-left', id });
        roomChanged();
      });
    });
  });
}

// endRoom: o host encerrou para todos. Sem ele (saiu, fechou o app), quem ficou passa a sala adiante.
function stopServer({ endRoom = false } = {}) {
  clearInterval(pingTimer);
  pingTimer = null;
  room = null;
  if (wss) {
    for (const ws of wss.clients) {
      ws.close(1000, endRoom ? 'room-closed' : 'host-left');
      setTimeout(() => ws.terminate(), 1000);
    }
    wss.close();
    wss = null;
  }
}

module.exports = { startServer, stopServer, roomInfo, roomSize, onRoomChange, isRazzeAddress };
