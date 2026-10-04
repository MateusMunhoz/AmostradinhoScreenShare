// Servidor de sinalização da sala: roda no PC de quem criou a sala.
// Ele só apresenta as pessoas umas às outras. Vídeo e áudio vão direto entre os PCs (P2P).
const { WebSocketServer } = require('ws');

let wss = null;
let pingTimer = null;
let musicTimer = null; // tira as músicas esquecidas (limparMusicas)
// A sala em andamento, para o anúncio das sessões abertas: { sessao, port, password, members, hostId() }
let room = null;
let roomChanged = () => {};

const {
  MAX_MEMBERS, send, cleanSessao, cleanSenha, newMember, memberInfo, createChat, createSubsalas, createMusicas, limparMusicas, handleMemberMessage,
} = require('./sala-protocolo');

const LOCAL = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

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
function startServer(port, password = '', seed = {}) { // a senha pode mudar depois (mensagem "senha" do host)
  stopServer();
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: 256 * 1024 });
    const onlyRazze = seed.onlyRazze === true;
    const members = new Map(); // id -> { ws, name, sharing, version, addrs }
    let nextId = Math.max(1, Math.floor(Number(seed.nextId)) || 1);
    const chat = createChat(seed.chat);
    const subsalas = createSubsalas(seed.subsalas); // as subsalas de voz continuam depois da troca de host
    const musicas = createMusicas(seed.musicas); // e as músicas de cada canal, de onde estavam
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
      musicTimer = setInterval(() => { if (limparMusicas(musicas, members)) broadcast(musicas.msg()); }, 15000);
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
          // A versão de cada um serve para os apps baixarem atualizações uns dos outros
          me = newMember(ws, msg, resume, subsalas);
          send(ws, {
            type: 'welcome',
            id,
            hostId,
            members: [...members].map(([mid, m]) => memberInfo(mid, m)),
            features: ['chat', 'voice', 'handoff', 'sessoes', 'subsalas', 'subsala-move', 'musica', 'senha'],
            chat: chat.log,
            subsalas: subsalas.list,
            musicas: [...musicas.map.values()],
            now: Date.now(),
            sessao,
          });
          members.set(id, me);
          broadcast({ type: 'member-joined', ...memberInfo(id, me), resumed: !!resume }, id);
          roomChanged();
          return;
        }

        // Mudar a senha: só o host. Quem já está na sala continua; todos recebem a nova (a troca de host e a volta
        // depois de a conexão cair entram com ela). Vazia: a sala fica sem senha
        if (msg.type === 'senha') {
          if (id !== hostId) return send(ws, { type: 'senha-erro', message: 'Só o host da sala muda a senha.' });
          const nova = cleanSenha(msg.password);
          if (nova === null) return send(ws, { type: 'senha-erro', message: 'Senha inválida (até 64 caracteres).' });
          password = nova;
          if (room) room.password = nova;
          broadcast({ type: 'senha', password: nova, by: id });
          roomChanged();
          return;
        }
        handleMemberMessage({ members, broadcast, chat, subsalas, musicas }, id, me, msg);
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
  clearInterval(musicTimer);
  musicTimer = null;
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

module.exports = { startServer, stopServer, roomInfo, roomSize, onRoomChange, isRazzeAddress, MAX_MEMBERS };
