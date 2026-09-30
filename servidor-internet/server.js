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
//   info                                -> { type: 'info', app: 'tela-p2p-internet' } (teste da aba Rede)
'use strict';
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const {
  MAX_MEMBERS, send, cleanSessao, cleanClient, newMember, memberInfo, createChat, createSubsalas, handleMemberMessage,
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

  function createRoomState(password) {
    const code = (() => { for (;;) { const c = makeCode(); if (!rooms.has(c)) return c; } })();
    const room = {
      code, check: passwordCheck(password), members: new Map(), away: new Map(), hostId: null, nextId: 1,
      chat: createChat(), subsalas: createSubsalas(), sessao: cleanSessao({ oculta: true }), createdAt: cfg.now(),
    };
    room.broadcast = (msg, exceptId) => {
      for (const [mid, m] of room.members) if (mid !== exceptId && !room.away.has(mid)) send(m.ws, msg);
    };
    rooms.set(code, room);
    return room;
  }

  function removeMember(room, id) {
    clearTimeout(room.away.get(id));
    room.away.delete(id);
    if (!room.members.delete(id)) return;
    room.broadcast({ type: 'member-left', id });
    if (room.members.size === 0) {
      rooms.delete(room.code);
      cfg.log(`sala ${room.code} fechada`);
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
      if (me) return handleMemberMessage({ members: room.members, broadcast: room.broadcast, chat: room.chat, subsalas: room.subsalas }, id, me, msg);
      if (busy) return;
      if (msg.type === 'info') { send(ws, { type: 'info', app: 'tela-p2p-internet', turn: !!(cfg.turnHost && cfg.turnSecret) }); return ws.close(); }
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
        room = createRoomState(password);
        cfg.log(`sala ${room.code} criada`);
      } else {
        const code = cleanCode(msg.room);
        const found = code && rooms.get(code);
        if (!found || !found.check(msg.password)) {
          fails.hit(ip);
          return deny('Sala não encontrada ou senha incorreta.');
        }
        room = found;
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
      if (!room.hostId) room.hostId = id;
      send(ws, {
        type: 'welcome',
        id,
        hostId: room.hostId,
        sala: room.code,
        members: [...room.members].filter(([mid]) => mid !== id).map(([mid, m]) => memberInfo(mid, m)),
        features: ['chat', 'voice', 'internet', 'resume', 'subsalas'],
        chat: room.chat.log,
        subsalas: room.subsalas.list,
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
