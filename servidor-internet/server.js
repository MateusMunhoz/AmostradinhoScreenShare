#!/usr/bin/env node
// Servidor do modo Internet do Tela P2P: roda numa VPS e junta as pessoas por código de sala + senha.
// Ele só apresenta as pessoas (sinalização) e entrega a cada uma um acesso temporário ao TURN (coturn).
// Vídeo, áudio e voz vão direto entre os PCs; quando o direto não dá (CGNAT, firewall), passam pelo TURN,
// sempre criptografados de ponta a ponta (DTLS-SRTP): nem a VPS consegue ver a tela de ninguém.
//
// Mensagens: as mesmas do signaling.js (sala-protocolo.js), mais:
//   hello { create: true, password }   -> cria a sala; o welcome traz { sala: 'ABC234' }
//   hello { room: 'ABC234', password } -> entra
//   hello { room, resume: id, client }  -> volta depois de a conexão cair (dentro do tempo de espera)
//   hello { room, passe }              -> entra com o passe de convite de alguém da sala, no lugar da senha
//   passe { passe }                     -> quem entrou com a senha registra o próprio passe de convite (null tira);
//                                          o app anuncia o passe só para os amigos, pela RazzeAPI
//   senha { password }                  -> o host muda a senha; quem entrou com a senha recebe a nova, os passes caem
//                                          (e o passe da sala troca)
//   hello { create: true, amigosMembros } -> com amigosMembros !== false, a sala nasce com um passe da sala
//   amigos-membros { on }               -> o host liga ou desliga o passe da sala
//   passe-sala { passe, amigosMembros } (do servidor) -> o passe da sala mudou ou caiu (null); também vem no welcome.
//                                          Vale para todos da sala e não cai quando quem criou sai
//                                          (docs/spec/entrar-pelos-amigos.md)
//   host { id }  (do servidor)          -> o host saiu e outro assumiu (é quem pode mudar a senha)
//   info                                -> { type: 'info', app: 'tela-p2p-internet', turn, stun } (teste da aba Rede; o STUN
//                                          também serve à conexão direta das mensagens privadas)
'use strict';
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const {
  MAX_MEMBERS, send, cleanSessao, cleanClient, cleanSenha, newMember, memberInfo, createChat, createSubsalas, memberGone, createMusicas, limparMusicas, handleMemberMessage,
} = require('../sala-protocolo');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I, que confundem
const CODE_LENGTH = 6;

function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function makeCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

function cleanCode(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : '';
}

// Senha guardada só como HMAC com uma chave da própria sala; a comparação leva sempre o mesmo tempo
function passwordCheck(password) {
  const key = crypto.randomBytes(32);
  const digest = (p) => crypto.createHmac('sha256', key).update(String(p ?? '')).digest();
  const expected = digest(password);
  return (attempt) => crypto.timingSafeEqual(expected, digest(attempt));
}

// Passes de convite da sala: cada pessoa que entrou com a senha pode ter um (vale enquanto ela estiver na sala).
// Guardados só como HMAC com uma chave da própria sala, como a senha.
// Mais o passe da sala (docs/spec/entrar-pelos-amigos.md): um só, criado pelo servidor e entregue a todos da sala, que
// não cai quando alguém sai. Fica também em texto, só na memória, porque é entregue a quem entra.
const PASSE_RE = /^[A-Za-z0-9_-]{43}$/;
function createPasses() {
  const key = crypto.randomBytes(32);
  const digest = (p) => crypto.createHmac('sha256', key).update(String(p ?? '')).digest();
  const byMember = new Map(); // id -> HMAC do passe
  let sala = null; // { texto, hmac } do passe da sala, ou null
  return {
    digest,
    // Passe da sala: gera um novo (o antigo deixa de valer) ou tira (false)
    trocarSala(on = true) {
      if (!on) { sala = null; return null; }
      const texto = crypto.randomBytes(32).toString('base64url');
      sala = { texto, hmac: digest(texto) };
      return texto;
    },
    sala: () => sala?.texto || null,
    set(id, passe) { if (passe) byMember.set(id, digest(passe)); else byMember.delete(id); },
    remove(id) { byMember.delete(id); },
    clear() { byMember.clear(); }, // a senha mudou: os convites antigos caem (a chave fica: quem entrou por passe ainda volta)
    // Confere contra todos os passes (sem parar no primeiro, para levar sempre o mesmo tempo)
    check(passe) {
      if (typeof passe !== 'string' || !PASSE_RE.test(passe)) return false;
      const d = digest(passe);
      let ok = false;
      for (const v of byMember.values()) ok = crypto.timingSafeEqual(v, d) || ok;
      if (sala) ok = crypto.timingSafeEqual(sala.hmac, d) || ok;
      return ok;
    },
    size: () => byMember.size,
  };
}

// Acesso temporário ao coturn (use-auth-secret / "TURN REST API"): usuário "validade:nome", senha HMAC-SHA1
function turnCredentials(secret, name, ttlSeconds, now = Date.now()) {
  const username = `${Math.floor(now / 1000) + ttlSeconds}:${name}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

// Tentativas erradas por IP: passou do limite, fica bloqueado um tempo
function createLimiter({ max, windowMs, now }) {
  const hits = new Map();
  const prune = (list, t) => list.filter((x) => t - x < windowMs);
  return {
    blocked(ip) {
      const t = now();
      const list = prune(hits.get(ip) || [], t);
      if (list.length) hits.set(ip, list); else hits.delete(ip);
      return list.length >= max;
    },
    hit(ip) {
      const t = now();
      const list = prune(hits.get(ip) || [], t);
      list.push(t);
      hits.set(ip, list);
    },
    size: () => hits.size,
  };
}

function createInternetServer(options = {}) {
  const cfg = {
    host: options.host ?? process.env.HOST ?? '0.0.0.0',
    port: options.port ?? envInt('PORT', 8765),
    maxRooms: options.maxRooms ?? envInt('MAX_ROOMS', 200),
    createPerIpPerHour: options.createPerIpPerHour ?? envInt('CREATE_PER_IP_PER_HOUR', 20),
    failPerIp: options.failPerIp ?? envInt('FAIL_PER_IP', 10),
    failWindowMs: options.failWindowMs ?? envInt('FAIL_WINDOW_MS', 10 * 60 * 1000),
    graceMs: options.graceMs ?? envInt('RECONNECT_GRACE_MS', 20000),
    denyDelayMs: options.denyDelayMs ?? envInt('DENY_DELAY_MS', 400),
    minPassword: options.minPassword ?? envInt('MIN_PASSWORD', 4),
    trustProxy: options.trustProxy ?? process.env.TRUST_PROXY === '1',
    stunUrls: options.stunUrls ?? (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean),
    turnHost: options.turnHost ?? process.env.TURN_HOST ?? '',
    turnPort: options.turnPort ?? envInt('TURN_PORT', 3479),
    turnsUrl: options.turnsUrl ?? process.env.TURNS_URL ?? '', // opcional: turns:turn.seudominio.com:5349
    turnSecret: options.turnSecret ?? process.env.TURN_SECRET ?? '',
    turnTtl: options.turnTtl ?? envInt('TURN_TTL_SECONDS', 24 * 60 * 60),
    log: options.log ?? ((...a) => console.log(new Date().toISOString(), ...a)),
    now: options.now ?? Date.now,
  };
  if (cfg.turnHost && cfg.turnSecret.length < 16) throw new Error('TURN_SECRET precisa ter pelo menos 16 caracteres.');

  const rooms = new Map(); // código -> sala
  const fails = createLimiter({ max: cfg.failPerIp, windowMs: cfg.failWindowMs, now: cfg.now });
  const creates = createLimiter({ max: cfg.createPerIpPerHour, windowMs: 60 * 60 * 1000, now: cfg.now });

  function iceServersFor(code, id) {
    const list = [];
    const stun = [...cfg.stunUrls];
    if (cfg.turnHost) stun.push(`stun:${cfg.turnHost}:${cfg.turnPort}`);
    if (stun.length) list.push({ urls: stun });
    if (cfg.turnHost && cfg.turnSecret) {
      const urls = [`turn:${cfg.turnHost}:${cfg.turnPort}?transport=udp`, `turn:${cfg.turnHost}:${cfg.turnPort}?transport=tcp`];
      if (cfg.turnsUrl) urls.push(cfg.turnsUrl);
      list.push({ urls, ...turnCredentials(cfg.turnSecret, `${code}-${id}`, cfg.turnTtl, cfg.now()) });
    }
    return list;
  }

  function createRoomState(password, amigosMembros = true) {
    const code = (() => { for (;;) { const c = makeCode(); if (!rooms.has(c)) return c; } })();
    const room = {
      code, check: passwordCheck(password), passes: createPasses(), members: new Map(), away: new Map(), hostId: null, nextId: 1,
      chat: createChat(), subsalas: createSubsalas(), musicas: createMusicas(null, cfg.now), sessao: cleanSessao({ oculta: true }), createdAt: cfg.now(),
      amigosMembros,
    };
    if (amigosMembros) room.passes.trocarSala();
    // O passe da sala mudou ou caiu: avisa todos (quem está fora no tempo de espera recebe no welcome ao voltar)
    room.avisarPasseSala = () => room.broadcast({ type: 'passe-sala', passe: room.passes.sala(), amigosMembros: room.amigosMembros });
    room.broadcast = (msg, exceptId) => {
      for (const [mid, m] of room.members) if (mid !== exceptId && !room.away.has(mid)) send(m.ws, msg);
    };
    rooms.set(code, room);
    return room;
  }

  function removeMember(room, id) {
    clearTimeout(room.away.get(id));
    room.away.delete(id);
    room.passes.remove(id);
    if (!room.members.delete(id)) return;
    room.broadcast({ type: 'member-left', id });
    memberGone({ subsalas: room.subsalas, broadcast: room.broadcast }, id);
    if (room.members.size === 0) {
      rooms.delete(room.code);
      cfg.log(`sala ${room.code} fechada`);
      return;
    }
    // O host saiu: passa para quem está há mais tempo e entrou com a senha (senão, quem está há mais tempo).
    // É o host quem pode mudar a senha da sala
    if (room.hostId === id) {
      const all = [...room.members];
      room.hostId = (all.find(([, m]) => !m.viaPasse) || all[0])[0];
      room.broadcast({ type: 'host', id: room.hostId });
    }
  }

  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, app: 'tela-p2p-internet', salas: rooms.size, turn: !!(cfg.turnHost && cfg.turnSecret) }));
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: httpServer, maxPayload: 256 * 1024, perMessageDeflate: false });

  function clientIp(req) {
    if (cfg.trustProxy) {
      const real = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
      if (real) return real;
    }
    return req.socket.remoteAddress || '?';
  }

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    let room = null;
    let id = null;
    let me = null;
    let busy = false; // o hello está sendo conferido (espera de senha errada)
    let joinedViaPasse = false;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const deny = (message) => {
      busy = true;
      // Sala que não existe e senha errada respondem igual e no mesmo tempo: ninguém descobre códigos
      setTimeout(() => { send(ws, { type: 'error', message }); ws.close(); }, cfg.denyDelayMs + crypto.randomInt(150));
    };

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      if (me && msg.type === 'leave') { // saiu pelo botão: tira da sala na hora, sem tempo de espera
        me.ws = null;
        removeMember(room, id);
        return ws.close(1000, 'left');
      }
      if (me && msg.type === 'passe') { // só quem entrou com a senha pode convidar com um passe
        if (me.viaPasse) return;
        if (msg.passe === null || (typeof msg.passe === 'string' && PASSE_RE.test(msg.passe))) room.passes.set(id, msg.passe);
        return;
      }
      // Mudar a senha: só o host. Quem já está na sala continua. Quem entrou com a senha recebe a nova (para voltar
      // depois de a conexão cair); quem entrou por um passe só fica sabendo. Os passes antigos deixam de valer
      if (me && msg.type === 'senha') {
        if (id !== room.hostId) return send(ws, { type: 'senha-erro', message: 'Só o host da sala muda a senha.' });
        const nova = cleanSenha(msg.password, cfg.minPassword);
        if (nova === null) return send(ws, { type: 'senha-erro', message: `No modo Internet a senha precisa ter de ${cfg.minPassword} a 64 caracteres.` });
        room.check = passwordCheck(nova);
        room.passes.clear();
        for (const [mid, m] of room.members) if (!room.away.has(mid)) send(m.ws, m.viaPasse ? { type: 'senha', by: id } : { type: 'senha', password: nova, by: id });
        if (room.amigosMembros) { room.passes.trocarSala(); room.avisarPasseSala(); }
        cfg.log(`sala ${room.code}: senha mudada`);
        return;
      }
      // Amigos de quem está na sala podem entrar (passe da sala): só o host liga ou desliga. Desligar tira o passe da
      // sala na hora (quem já entrou fica); ligar cria um novo
      if (me && msg.type === 'amigos-membros') {
        if (typeof msg.on !== 'boolean') return;
        if (id !== room.hostId) return send(ws, { type: 'senha-erro', message: 'Só o host da sala muda isso.' });
        if (msg.on === room.amigosMembros) return;
        room.amigosMembros = msg.on;
        room.passes.trocarSala(msg.on);
        room.avisarPasseSala();
        cfg.log(`sala ${room.code}: amigos dos membros ${msg.on ? 'ligado' : 'desligado'}`);
        return;
      }
      if (me) return handleMemberMessage({ members: room.members, broadcast: room.broadcast, chat: room.chat, subsalas: room.subsalas, musicas: room.musicas }, id, me, msg);
      if (busy) return;
      if (msg.type === 'info') { send(ws, { type: 'info', app: 'tela-p2p-internet', turn: !!(cfg.turnHost && cfg.turnSecret), stun: [...cfg.stunUrls, ...(cfg.turnHost ? [`stun:${cfg.turnHost}:${cfg.turnPort}`] : [])] }); return ws.close(); }
      if (msg.type !== 'hello') return;

      if (fails.blocked(ip)) return deny('Muitas tentativas erradas. Espere alguns minutos e tente de novo.');

      if (msg.create === true) {
        const password = typeof msg.password === 'string' ? msg.password : '';
        if (password.length < cfg.minPassword || password.length > 64) {
          send(ws, { type: 'error', message: `No modo Internet a sala precisa de senha (${cfg.minPassword} a 64 caracteres).` });
          return ws.close();
        }
        if (rooms.size >= cfg.maxRooms) { send(ws, { type: 'error', message: 'O servidor está cheio agora. Tente daqui a pouco.' }); return ws.close(); }
        if (creates.blocked(ip)) { send(ws, { type: 'error', message: 'Muitas salas criadas daqui. Espere um pouco.' }); return ws.close(); }
        creates.hit(ip);
        room = createRoomState(password, msg.amigosMembros !== false);
        cfg.log(`sala ${room.code} criada`);
      } else {
        const code = cleanCode(msg.room);
        const found = code && rooms.get(code);
        // Com passe: um passe ativo da sala, ou (voltando depois de a conexão cair) o mesmo passe com que entrou,
        // mesmo que quem convidou já tenha saído
        const back = found && /^\d{1,6}$/.test(String(msg.resume || '')) ? found.members.get(String(msg.resume)) : null;
        const viaPasse = !!found && typeof msg.passe === 'string' && (found.passes.check(msg.passe) ||
          !!(back?.passeDigest && PASSE_RE.test(msg.passe) && crypto.timingSafeEqual(back.passeDigest, found.passes.digest(msg.passe))));
        if (!found || (!viaPasse && !found.check(msg.password))) {
          fails.hit(ip);
          return deny(typeof msg.passe === 'string' && !msg.password ? 'O convite não vale mais. Peça a senha da sala.' : 'Sala não encontrada ou senha incorreta.');
        }
        room = found;
        joinedViaPasse = viaPasse;
      }

      // Voltando depois de a conexão cair: mesmo número, se for o mesmo PC e ainda estiver no tempo de espera
      const resume = String(msg.resume || '');
      const client = cleanClient(msg.client);
      const old = /^\d{1,6}$/.test(resume) ? room.members.get(resume) : null;
      const resuming = !!(old && client && old.client === client);
      if (resuming) {
        clearTimeout(room.away.get(resume));
        room.away.delete(resume);
        const prev = old.ws;
        old.ws = null; // a conexão antiga não derruba mais ninguém ao fechar
        try { prev?.terminate(); } catch {}
        id = resume;
      } else {
        // O mesmo PC entrando de novo sem "resume": a conexão antiga era um fantasma
        if (client) for (const [oldId, m] of room.members) if (m.client === client) { try { m.ws?.terminate(); } catch {} removeMember(room, oldId); }
        if (!rooms.has(room.code)) rooms.set(room.code, room); // a sala esvaziou no passo acima
        const active = room.members.size;
        if (active >= MAX_MEMBERS) { send(ws, { type: 'error', message: 'A sala está cheia.' }); room = null; return ws.close(); }
        id = String(room.nextId++);
      }
      me = newMember(ws, msg, resuming ? resume : '', room.subsalas);
      me.addrs = []; // pela internet não tem por que espalhar os IPs de casa de ninguém
      if (joinedViaPasse) { me.viaPasse = true; me.passeDigest = room.passes.digest(msg.passe); room.passes.remove(id); }
      if (!room.hostId) room.hostId = id;
      send(ws, {
        type: 'welcome',
        id,
        hostId: room.hostId,
        sala: room.code,
        members: [...room.members].filter(([mid]) => mid !== id).map(([mid, m]) => memberInfo(mid, m)),
        features: ['chat', 'voice', 'internet', 'resume', 'subsalas', 'subsala-move', 'lider', 'musica', 'passe', 'senha', 'passe-sala'],
        passeSala: room.passes.sala(),
        amigosMembros: room.amigosMembros,
        chat: room.chat.log,
        subsalas: room.subsalas.list,
        lider: room.subsalas.liderMsg(),
        musicas: [...room.musicas.map.values()],
        now: cfg.now(),
        sessao: room.sessao,
        iceServers: iceServersFor(room.code, id),
      });
      room.members.set(id, me);
      room.broadcast({ type: 'member-joined', ...memberInfo(id, me), resumed: resuming }, id);
    });

    ws.on('close', () => {
      if (!me || !room || me.ws !== ws) return; // nunca entrou, ou já foi trocada por uma conexão nova
      me.ws = null;
      // Espera um pouco antes de tirar da sala: a internet piscou, o app volta sozinho com o mesmo número
      const r = room;
      const leftId = id;
      r.away.set(leftId, setTimeout(() => removeMember(r, leftId), cfg.graceMs));
    });
  });

  // Quem não responde ao ping em 30 s cai (e entra no tempo de espera)
  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 15000);
  // Tira as músicas esquecidas (pausadas há muito tempo, ou sem ninguém no canal nem ouvindo)
  const musicTimer = setInterval(() => {
    for (const r of rooms.values()) if (limparMusicas(r.musicas, r.members)) r.broadcast(r.musicas.msg());
  }, 15000);

  return {
    httpServer, wss, rooms, cfg,
    listen() {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(cfg.port, cfg.host, () => resolve(httpServer.address()));
      });
    },
    close() {
      clearInterval(pingTimer);
      clearInterval(musicTimer);
      for (const r of rooms.values()) for (const t of r.away.values()) clearTimeout(t);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve) => wss.close(() => httpServer.close(() => resolve())));
    },
  };
}

module.exports = { createInternetServer, turnCredentials, cleanCode, makeCode };

if (require.main === module) {
  const server = createInternetServer();
  server.listen().then((addr) => {
    const { cfg } = server;
    cfg.log(`Tela P2P Internet ouvindo em ${addr.address}:${addr.port}`);
    cfg.log(cfg.turnHost && cfg.turnSecret ? `TURN: ${cfg.turnHost}:${cfg.turnPort} (acesso temporário, ${cfg.turnTtl}s)` : 'TURN desligado (defina TURN_HOST e TURN_SECRET)');
  }).catch((err) => { console.error(err.message); process.exit(1); });
  const stop = () => server.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
