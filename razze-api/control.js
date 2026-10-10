'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');

// Administração e presença compartilham a autenticação da API, sem depender do Electron.
function createControl({ db, options, now, hash, requireUser, readBody, send, ApiError, isMember, friendshipExists = () => false }) {
  const columns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!columns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin'))");
  if (!columns.includes('ban_reason')) db.exec("ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('PRAGMA table_info(sessions)').all().some(c => c.name === 'client_id')) db.exec('ALTER TABLE sessions ADD COLUMN client_id TEXT');
  if (!db.prepare('PRAGMA table_info(sessions)').all().some(c => c.name === 'app_version')) db.exec("ALTER TABLE sessions ADD COLUMN app_version TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('PRAGMA table_info(sessions)').all().some(c => c.name === 'client_name')) db.exec("ALTER TABLE sessions ADD COLUMN client_name TEXT NOT NULL DEFAULT 'Tela P2P'");
  // De que tipo de aparelho é a sessão: uma de PC e uma de Android por conta (issueToken em server.js)
  if (!db.prepare('PRAGMA table_info(sessions)').all().some(c => c.name === 'plataforma')) db.exec("ALTER TABLE sessions ADD COLUMN plataforma TEXT NOT NULL DEFAULT 'pc'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS live_presence (
      session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_seen INTEGER NOT NULL, connections TEXT NOT NULL, room TEXT);
    CREATE INDEX IF NOT EXISTS presence_seen ON live_presence(last_seen);
    CREATE TABLE IF NOT EXISTS client_usage (session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
      requests INTEGER NOT NULL DEFAULT 0, received INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL, last_request INTEGER NOT NULL);
  `);
  // Sala do modo Internet anunciada para os amigos (servidor, código e o passe de convite)
  if (!db.prepare('PRAGMA table_info(live_presence)').all().some(c => c.name === 'internet_room')) db.exec('ALTER TABLE live_presence ADD COLUMN internet_room TEXT');
  // Em que sala a pessoa está (qualquer modo, sem endereço): só os amigos veem, em /v1/friends (docs/spec/sala-do-amigo.md)
  if (!db.prepare('PRAGMA table_info(live_presence)').all().some(c => c.name === 'sala_atual')) db.exec('ALTER TABLE live_presence ADD COLUMN sala_atual TEXT');
  // Após reiniciar, cada cliente precisa confirmar sua presença novamente.
  db.exec('DELETE FROM live_presence');
  // Mantém somente a sessão mais recente de cada conta em cada tipo de aparelho (PC e Android).
  db.exec(`DELETE FROM sessions WHERE rowid NOT IN (
    SELECT MAX(rowid)
    FROM sessions
    GROUP BY user_id, plataforma
  )`);
  // googleOnly: só entra e cria conta pelo Google (o administrador continua podendo entrar com senha).
  // legacyPasswordLogin: com googleOnly ligado, quem já tinha conta com senha ainda entra por ela (desligue quando todos tiverem vinculado o Google).
  // onlyAllowlist: só e-mails da lista de convidados criam conta; quem está na lista entra já ativo.
  const defaults = { requireApproval: options.requireApproval !== false, registrationOpen: true, presenceTimeoutSeconds: 70, googleOnly: false, onlyAllowlist: false, legacyPasswordLogin: true };
  const settings = () => Object.assign({}, defaults, Object.fromEntries(db.prepare('SELECT key, value FROM server_settings').all().map(r => [r.key, JSON.parse(r.value)])));
  const tokenHash = req => hash(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const user = id => db.prepare('SELECT id, email, display_name AS displayName, status, role, grupo, ban_reason AS banReason, created_at AS createdAt FROM users WHERE id = ?').get(id);
  const DAY_OFFSET_MS = 3 * 60 * 60 * 1000; // o dia das estatísticas vira à meia-noite de Brasília
  const dayOf = t => new Date(t - DAY_OFFSET_MS).toISOString().slice(0, 10);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const audit = (actor, action, target, detail = {}) => db.prepare('INSERT INTO audit_log(actor, action, target, detail, created_at) VALUES(?, ?, ?, ?, ?)').run(actor, action, target, JSON.stringify(detail), now());
  const bad = message => { throw new ApiError(400, 'invalid_input', message); };
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  function adminActor(req) {
    const configured = options.adminToken || process.env.RAZZE_ADMIN_TOKEN || '';
    const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (configured && supplied === configured && (configured.length < 30 || /\s/.test(configured))) throw new ApiError(503, 'admin_token_weak', 'RAZZE_ADMIN_TOKEN deve ter pelo menos 30 caracteres e não conter espaços.');
    if (configured.length >= 30 && !/\s/.test(configured) && Buffer.byteLength(supplied) === Buffer.byteLength(configured) &&
        timingSafeEqual(Buffer.from(supplied), Buffer.from(configured))) return 'bootstrap';
    const id = requireUser(req);
    if (user(id)?.role !== 'admin') throw new ApiError(403, 'admin_required', 'Esta conta não é administradora.');
    return id;
  }
  function presence() {
    const cutoff = now() - settings().presenceTimeoutSeconds * 1000;
    const rows = db.prepare(`SELECT p.*, u.display_name AS displayName FROM live_presence p
      JOIN sessions s ON s.token_hash = p.session_hash JOIN users u ON u.id = p.user_id
      WHERE p.last_seen > ? AND s.expires_at > ? AND u.status = 'active' ORDER BY p.last_seen DESC`).all(cutoff, now());
    return rows.map(r => {
      const connections = JSON.parse(r.connections).filter(c => isMember(c.networkId, r.user_id)).map(c => {
        const device = db.prepare('SELECT assigned_ip AS address FROM wireguard_devices WHERE network_id = ? AND device_id = ? AND user_id = ?').get(c.networkId, c.deviceId, r.user_id);
        return device ? { ...c, ...device } : null;
      }).filter(Boolean);
      return { userId: r.user_id, displayName: r.displayName, lastSeen: r.last_seen, connections, room: r.room ? JSON.parse(r.room) : null,
        internetRoom: r.internet_room ? JSON.parse(r.internet_room) : null, salaAtual: r.sala_atual ? JSON.parse(r.sala_atual) : null };
    });
  }
  // A sala de cada conta online (a da sessão mais recente que anunciou uma). Só para a lista de amigos: os membros das
  // redes e a administração não recebem
  function salasAtuais(snapshot = presence()) {
    const salas = new Map();
    for (const p of snapshot) if (p.salaAtual && !salas.has(p.userId)) salas.set(p.userId, p.salaAtual);
    return salas;
  }
  function rooms(viewerId, networkId, snapshot = presence()) {
    const listed = new Map();
    for (const p of snapshot) {
      const r = p.room;
      if (!r || (networkId && r.networkId !== networkId) || (viewerId && !isMember(r.networkId, viewerId))) continue;
      const connection = p.connections.find(c => c.networkId === r.networkId);
      const key = r.networkId + ':' + r.id;
      if (!connection || listed.has(key)) continue;
      const network = db.prepare('SELECT name FROM networks WHERE id=?').get(r.networkId);
      listed.set(key, { ...r, networkName: network?.name || '', userId: p.userId, endereco: connection.address, lastSeen: p.lastSeen });
    }
    return [...listed.values()];
  }
  // Salas do modo Internet dos amigos aceitos (não precisam de rede Razze nem de VPN). A sala do próprio
  // usuário não aparece; a mesma sala anunciada por várias sessões ou pessoas aparece uma vez só, com os amigos de quem
  // vê que estão nela (docs/spec/entrar-pelos-amigos.md). host: o host anunciado; sem ele (app antigo), quem anunciou
  function friendRooms(viewerId, snapshot = presence()) {
    const listed = new Map();
    for (const p of snapshot) {
      const r = p.internetRoom;
      if (!r || p.userId === viewerId || !friendshipExists(viewerId, p.userId)) continue;
      const key = r.servidor + '#' + r.codigo;
      let sala = listed.get(key);
      if (!sala) {
        sala = { servidor: r.servidor, codigo: r.codigo, pessoas: r.pessoas, passe: r.passe || null, host: r.host || p.displayName,
          userId: p.userId, lastSeen: p.lastSeen, amigos: [], hostAnunciado: !!r.host };
        listed.set(key, sala);
      } else {
        sala.pessoas = Math.max(sala.pessoas, r.pessoas);
        if (!sala.passe && r.passe) sala.passe = r.passe;
        if (!sala.hostAnunciado && r.host) { sala.host = r.host; sala.hostAnunciado = true; }
      }
      if (sala.amigos.length < 10 && !sala.amigos.some(f => f.userId === p.userId)) sala.amigos.push({ userId: p.userId, displayName: p.displayName });
    }
    return [...listed.values()].map(({ hostAnunciado, ...sala }) => sala);
  }
  function enrichUsers(rows) {
    const online = new Map(presence().map(p => [p.userId, p.lastSeen]));
    return rows.map(r => ({ ...r, online: online.has(r.id), lastSeen: online.get(r.id) || null }));
  }
  function enrichNetworks(rows, viewerId) {
    const snapshot = presence();
    return rows.map(r => ({ ...r,
      onlineCount: !viewerId || isMember(r.id, viewerId) ? new Set(snapshot.filter(p => p.connections.some(c => c.networkId === r.id)).map(p => p.userId)).size : null,
      roomCount: !viewerId || isMember(r.id, viewerId) ? rooms(viewerId, r.id, snapshot).length : null,
    }));
  }
  async function heartbeat(req, userId) {
    const body = await readBody(req);
    const clientName = body.clientName ?? 'Tela P2P';
    if (typeof clientName !== 'string' || !clientName.trim() || clientName.length > 80) bad('Nome do cliente inválido.');
    const connections = body.connections || [];
    if (!Array.isArray(connections) || connections.length > 16) bad('Lista de conexões inválida.');
    const cleaned = [];
    for (const c of connections) {
      if (!c || typeof c.networkId !== 'string' || typeof c.deviceId !== 'string') bad('Conexão inválida.');
      if (!isMember(c.networkId, userId) || !db.prepare('SELECT 1 FROM wireguard_devices WHERE network_id = ? AND device_id = ? AND user_id = ?').get(c.networkId, c.deviceId, userId)) {
        throw new ApiError(403, 'network_forbidden', 'O dispositivo não pertence a essa rede.');
      }
      if (!cleaned.some(n => n.networkId === c.networkId)) cleaned.push({ networkId: c.networkId, deviceId: c.deviceId });
    }
    let room = null;
    if (body.room) {
      const r = body.room;
      if (!cleaned.some(c => c.networkId === r.networkId) || typeof r.id !== 'string' || !/^[a-f0-9]{16}$/.test(r.id) ||
          typeof r.host !== 'string' || r.host.length > 60 || !Number.isInteger(r.porta) || r.porta < 1 || r.porta > 65535 ||
          !Number.isInteger(r.pessoas) || r.pessoas < 1 || r.pessoas > 1000) bad('Anúncio de sala inválido.');
      room = { id: r.id, networkId: r.networkId, host: r.host, porta: r.porta, pessoas: r.pessoas, senha: !!r.senha };
    }
    let internetRoom = null;
    if (body.internetRoom) {
      const r = body.internetRoom;
      let url = null;
      try { url = new URL(String(r.servidor)); } catch {}
      // ws:// também vale: é o endereço padrão da VPS (servidor-internet/README.md), sem TLS
      if (typeof r.servidor !== 'string' || r.servidor.length > 200 || !url || !['ws:', 'wss:'].includes(url.protocol) || !url.hostname ||
          url.username || url.password || url.search || url.hash ||
          typeof r.codigo !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(r.codigo) || !Number.isInteger(r.pessoas) || r.pessoas < 1 || r.pessoas > 1000 ||
          (r.passe !== undefined && r.passe !== null && (typeof r.passe !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(r.passe)))) bad('Anúncio de sala inválido.');
      // host (opcional): o nome do host da sala, quando quem anuncia não é o host (docs/spec/entrar-pelos-amigos.md)
      const host = typeof r.host === 'string' ? r.host.trim() : '';
      if ((r.host !== undefined && r.host !== null && typeof r.host !== 'string') || (r.host != null && (!host || host.length > 32 || /[\u0000-\u001f\u007f]/.test(host)))) bad('Anúncio de sala inválido.');
      internetRoom = { servidor: r.servidor, codigo: r.codigo, pessoas: r.pessoas, passe: r.passe || null, ...(host ? { host } : {}) };
    }
    let salaAtual = null;
    if (body.salaAtual) {
      const r = body.salaAtual;
      const host = typeof r.host === 'string' ? r.host.trim() : '';
      if (typeof r !== 'object' || Object.keys(r).some(k => !['modo', 'host', 'pessoas', 'voz'].includes(k)) ||
          !['radmin', 'razze', 'internet'].includes(r.modo) || !host || host.length > 32 || /[\u0000-\u001f\u007f]/.test(host) ||
          !Number.isInteger(r.pessoas) || r.pessoas < 1 || r.pessoas > 1000 || typeof r.voz !== 'boolean') bad('Anúncio de sala inválido.');
      salaAtual = { modo: r.modo, host, pessoas: r.pessoas, voz: r.voz };
    }
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
    const appVersion = typeof body.appVersion === 'string' && /^\d{1,3}(\.\d{1,3}){1,3}$/.test(body.appVersion) ? body.appVersion : '';
    db.prepare('UPDATE sessions SET client_name=?, app_version=CASE WHEN length(?) > 0 THEN ? ELSE app_version END WHERE token_hash=?').run(clientName.trim(), appVersion, appVersion, tokenHash(req));
    db.prepare('DELETE FROM live_presence WHERE last_seen <= ?').run(now() - settings().presenceTimeoutSeconds * 1000);
    db.prepare(`INSERT INTO live_presence(session_hash, user_id, last_seen, connections, room, internet_room, sala_atual) VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_hash) DO UPDATE SET last_seen=excluded.last_seen, connections=excluded.connections, room=excluded.room, internet_room=excluded.internet_room, sala_atual=excluded.sala_atual`)
      .run(tokenHash(req), userId, now(), JSON.stringify(cleaned), room ? JSON.stringify(room) : null, internetRoom ? JSON.stringify(internetRoom) : null, salaAtual ? JSON.stringify(salaAtual) : null);
    const today = dayOf(now());
    db.prepare('INSERT OR IGNORE INTO user_days(user_id, day) VALUES(?, ?)').run(userId, today);
    const onlineNow = db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM live_presence WHERE last_seen > ?').get(now() - settings().presenceTimeoutSeconds * 1000).n;
    db.prepare('INSERT INTO daily_peak(day, peak) VALUES(?, ?) ON CONFLICT(day) DO UPDATE SET peak = MAX(peak, excluded.peak)').run(today, onlineNow);
    return { ok: true, heartbeatSeconds: 20, timeoutSeconds: settings().presenceTimeoutSeconds };
  }
  function offline(req) { db.prepare('DELETE FROM live_presence WHERE session_hash = ?').run(tokenHash(req)); }

  function measure(req, res) {
    let sent = 0;
    for (const name of ['write', 'end']) {
      const original = res[name];
      res[name] = function(chunk, ...args) {
        if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) sent += Buffer.byteLength(chunk);
        return original.call(this, chunk, ...args);
      };
    }
    res.once('finish', () => {
      const session = req.authSessionHash;
      if (!session) return;
      // Logout/revogação podem ter apagado a sessão durante a própria requisição.
      if (!db.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(session)) return;
      db.prepare('UPDATE sessions SET client_id=lower(hex(randomblob(16))) WHERE token_hash=? AND client_id IS NULL').run(session);
      db.prepare(`INSERT INTO client_usage(session_hash, requests, received, sent, started_at, last_request) VALUES(?,1,?,?,?,?)
        ON CONFLICT(session_hash) DO UPDATE SET requests=requests+1, received=received+excluded.received, sent=sent+excluded.sent, last_request=excluded.last_request`)
        .run(session, req.bodyBytes || 0, sent, now(), now());
    });
  }
  function clients() {
    return db.prepare(`SELECT s.client_id AS id, s.client_name AS clientName, s.user_id AS userId, u.display_name AS displayName,
      p.last_seen AS lastSeen, p.connections, c.requests, c.received AS receivedBytes, c.sent AS sentBytes,
      c.started_at AS startedAt, c.last_request AS lastRequest
      FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN live_presence p ON p.session_hash=s.token_hash
      LEFT JOIN client_usage c ON c.session_hash=s.token_hash
      WHERE u.status='active' AND s.expires_at > ? AND s.client_id IS NOT NULL ORDER BY c.last_request DESC`).all(now()).map(c => ({
        ...c, connections: c.connections ? JSON.parse(c.connections) : [],
        online: !!c.lastSeen && c.lastSeen > now() - settings().presenceTimeoutSeconds * 1000,
      }));
  }

  // Consultas fixas: nunca expõem hashes de senhas/tokens nem executam SQL recebido pela API.
  const views = {
    users: 'SELECT id, email, display_name, status, role, grupo, ban_reason, created_at FROM users',
    allowed_emails: 'SELECT email, grupo, label, added_by, created_at FROM allowed_emails',
    networks: 'SELECT * FROM networks', network_members: 'SELECT * FROM network_members',
    wireguard_devices: 'SELECT network_id, device_id, user_id, name, assigned_ip, updated_at FROM wireguard_devices',
    friend_requests: 'SELECT * FROM friend_requests',
    sessions: 'SELECT client_id, client_name, user_id, expires_at FROM sessions',
    invites: 'SELECT network_id, created_by, created_at, expires_at, max_uses, uses FROM invites',
    server_settings: 'SELECT * FROM server_settings', audit_log: 'SELECT * FROM audit_log',
    live_presence: 'SELECT user_id, last_seen FROM live_presence',
    feedback: 'SELECT id, user_id, tipo, status, respostas, tecnico, contato, imagem IS NOT NULL AS tem_imagem, created_at FROM feedback',
  };
  // Números do painel. Só contagens: nada de e-mail, mensagem ou nome de sala.
  function analytics() {
    const t = now(), today = dayOf(t), DAY = 86_400_000;
    const range = Array.from({ length: 14 }, (_, i) => dayOf(t - (13 - i) * DAY));
    const one = (sql, ...a) => db.prepare(sql).get(...a).n;
    const activeByDay = new Map(db.prepare('SELECT day, COUNT(*) AS n FROM user_days WHERE day >= ? GROUP BY day').all(range[0]).map(r => [r.day, r.n]));
    const peakByDay = new Map(db.prepare('SELECT day, peak FROM daily_peak WHERE day >= ?').all(range[0]).map(r => [r.day, r.peak]));
    const signups = new Map();
    for (const r of db.prepare('SELECT created_at AS at FROM users WHERE created_at >= ?').all(t - 15 * DAY)) signups.set(dayOf(r.at), (signups.get(dayOf(r.at)) || 0) + 1);
    const since = n => dayOf(t - (n - 1) * DAY);
    const online = new Set(presence().map(p => p.userId)).size;
    const grupos = Object.fromEntries(db.prepare("SELECT grupo, COUNT(*) AS n FROM users WHERE status = 'active' AND role <> 'admin' GROUP BY grupo").all().map(r => [r.grupo, r.n]));
    return {
      generatedAt: t,
      accounts: {
        total: one('SELECT COUNT(*) AS n FROM users'), active: one("SELECT COUNT(*) AS n FROM users WHERE status = 'active'"),
        pending: one("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'"), disabled: one("SELECT COUNT(*) AS n FROM users WHERE status = 'disabled'"),
        admins: one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"), amigos: grupos.amigo || 0, teste: grupos.teste || 0,
        withGoogle: one('SELECT COUNT(*) AS n FROM users WHERE google_sub IS NOT NULL'), allowlist: one('SELECT COUNT(*) AS n FROM allowed_emails'),
        allowlistJoined: one('SELECT COUNT(*) AS n FROM allowed_emails a JOIN users u ON u.email = a.email'),
      },
      usage: {
        online, today: one('SELECT COUNT(*) AS n FROM user_days WHERE day = ?', today),
        last7: one('SELECT COUNT(DISTINCT user_id) AS n FROM user_days WHERE day >= ?', since(7)),
        last30: one('SELECT COUNT(DISTINCT user_id) AS n FROM user_days WHERE day >= ?', since(30)),
        peakToday: peakByDay.get(today) || 0, newLast7: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', t - 7 * DAY),
        // Voltaram nesta semana contas criadas há mais de 7 dias: o sinal de que o app virou hábito
        returning: one('SELECT COUNT(DISTINCT d.user_id) AS n FROM user_days d JOIN users u ON u.id = d.user_id WHERE d.day >= ? AND u.created_at < ?', since(7), t - 7 * DAY),
        neverUsed: one("SELECT COUNT(*) AS n FROM users u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_days d WHERE d.user_id = u.id)"),
      },
      social: {
        friendships: one("SELECT COUNT(*) AS n FROM friend_requests WHERE status = 'accepted'"),
        withoutFriends: one("SELECT COUNT(*) AS n FROM users u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM friend_requests f WHERE f.status = 'accepted' AND (f.sender_id = u.id OR f.receiver_id = u.id))"),
        messagesLast7: one('SELECT COUNT(*) AS n FROM direct_messages WHERE created_at >= ?', t - 7 * DAY),
        openRooms: rooms(null).length + friendRooms(null).length, networks: one('SELECT COUNT(*) AS n FROM networks'),
      },
      versions: db.prepare("SELECT app_version AS version, COUNT(*) AS n FROM sessions WHERE expires_at > ? AND app_version <> '' GROUP BY app_version ORDER BY n DESC LIMIT 12").all(t),
      daily: range.map(day => ({ day, active: activeByDay.get(day) || 0, peak: peakByDay.get(day) || 0, signups: signups.get(day) || 0 })),
    };
  }
  async function handleAdmin(req, res, pathname) {
    const actor = adminActor(req);
    const method = req.method;
    const result = value => send(res, 200, value);
    if (method === 'GET' && pathname === '/v1/admin/me') return result({ actor, user: actor === 'bootstrap' ? null : user(actor) });
    if (method === 'GET' && pathname === '/v1/admin/clients') return result({ clients: clients(), measuredTraffic: 'HTTP JSON payloads; excludes headers, TLS, STUN and peer-to-peer media' });
    const client = /^\/v1\/admin\/clients\/([a-f0-9]{32})$/.exec(pathname);
    if (method === 'DELETE' && client) {
      const session = db.prepare('SELECT token_hash, user_id FROM sessions WHERE client_id=?').get(client[1]);
      if (!session) throw new ApiError(404, 'not_found', 'Cliente não encontrado.');
      transaction(() => {
        const row = db.prepare('SELECT connections FROM live_presence WHERE session_hash=?').get(session.token_hash);
        for (const c of row ? JSON.parse(row.connections) : []) db.prepare('DELETE FROM wireguard_devices WHERE network_id=? AND device_id=? AND user_id=?').run(c.networkId, c.deviceId, session.user_id);
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
        audit(actor, 'client.disconnect', client[1], { userId: session.user_id });
      });
      return result({ ok: true });
    }
    if (method === 'GET' && pathname === '/v1/admin/overview') return result({
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      pending: db.prepare("SELECT COUNT(*) AS n FROM users WHERE status='pending'").get().n,
      online: new Set(presence().map(p => p.userId)).size,
      connectedClients: clients().filter(c => c.online).length,
      server: { uptimeSeconds: Math.floor(process.uptime()), memoryBytes: process.memoryUsage().rss },
      networks: db.prepare('SELECT COUNT(*) AS n FROM networks').get().n,
      rooms: rooms(null), settings: settings(),
    });
    if (pathname === '/v1/admin/settings') {
      if (method === 'GET') return result({ settings: settings() });
      if (method === 'PATCH') {
        const body = await readBody(req);
        adminActor(req);
        if (!Object.keys(body).length || Object.keys(body).some(k => !Object.hasOwn(defaults, k))) bad('Configuração desconhecida.');
        for (const [k, v] of Object.entries(body)) {
          if (k === 'presenceTimeoutSeconds' ? (!Number.isInteger(v) || v < 45 || v > 300) : typeof v !== 'boolean') bad('Valor de configuração inválido.');
        }
        transaction(() => {
          for (const [k, v] of Object.entries(body)) db.prepare('INSERT INTO server_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));
          audit(actor, 'settings.update', 'server', body);
        });
        return result({ settings: settings() });
      }
    }
    // googleLinked: para saber quem ainda precisa vincular o Google antes de desligar legacyPasswordLogin
    if (method === 'GET' && pathname === '/v1/admin/users') return result({ users: enrichUsers(db.prepare('SELECT id, email, display_name AS displayName, status, role, grupo, ban_reason AS banReason, created_at AS createdAt, google_sub IS NOT NULL AS googleLinked FROM users ORDER BY created_at DESC').all().map(u => ({ ...u, googleLinked: !!u.googleLinked }))) });
    const target = /^\/v1\/admin\/users\/([a-f0-9]{32})(?:\/(approve|revoke-sessions|reset-code))?$/.exec(pathname);
    if (target) {
      const previous = user(target[1]);
      if (!previous) throw new ApiError(404, 'not_found', 'Usuário não encontrado.');
      if (method === 'POST' && target[2] === 'approve') {
        if (previous.status !== 'pending') throw new ApiError(404, 'pending_user_not_found', 'Conta pendente não encontrada.');
        transaction(() => { db.prepare("UPDATE users SET status='active' WHERE id=?").run(previous.id); audit(actor, 'user.approve', previous.id); });
        return result({ user: user(previous.id), status: 'active' });
      }
      if (method === 'POST' && target[2] === 'reset-code') {
        if (previous.status !== 'active') throw new ApiError(400, 'invalid_user', 'Só contas ativas podem redefinir a senha.');
        const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 símbolos, sem 0/O/1/I/L
        let code = '';
        while (code.length < 8) { const [x] = randomBytes(1); if (x < 248) code += alphabet[x % alphabet.length]; }
        const expiresAt = now() + 60 * 60 * 1000;
        transaction(() => {
          db.prepare('INSERT INTO password_resets(user_id, code_hash, expires_at, attempts) VALUES(?, ?, ?, 0) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0').run(previous.id, hash(code), expiresAt);
          audit(actor, 'user.reset-code', previous.id);
        });
        return result({ code: code.slice(0, 4) + '-' + code.slice(4), expiresAt });
      }
      if (method === 'POST' && target[2] === 'revoke-sessions') {
        transaction(() => {
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(previous.id);
          db.prepare('DELETE FROM wireguard_devices WHERE user_id=?').run(previous.id);
          audit(actor, 'user.revoke-sessions', previous.id);
        });
        return result({ ok: true });
      }
      // Excluir conta: só depois de desativar (dois passos de propósito). O banco apaga em cascata sessões, amizades, mensagens,
      // chaves, feedback e as redes que a pessoa criou. O e-mail continua na lista de convidados (quem decide é o administrador).
      if (method === 'DELETE' && !target[2]) {
        if (previous.id === actor) bad('Você não pode excluir a própria conta.');
        if (previous.status !== 'disabled') throw new ApiError(409, 'user_not_disabled', 'Desative a conta antes de excluir.');
        transaction(() => {
          db.prepare('DELETE FROM users WHERE id=?').run(previous.id);
          audit(actor, 'user.delete', previous.id, { email: previous.email, displayName: previous.displayName, role: previous.role });
        });
        return result({ ok: true });
      }
      if (method === 'PATCH' && !target[2]) {
        const body = await readBody(req);
        adminActor(req);
        if (!Object.keys(body).length || Object.keys(body).some(k => !['role', 'status', 'banReason', 'grupo'].includes(k))) bad('Alteração de usuário inválida.');
        const role = body.role ?? previous.role, status = body.status ?? previous.status, grupo = body.grupo ?? previous.grupo;
        if (!['user', 'admin'].includes(role) || !['active', 'pending', 'disabled'].includes(status) || !['amigo', 'teste'].includes(grupo)) bad('Papel, grupo ou status inválido.');
        if (body.banReason !== undefined && (typeof body.banReason !== 'string' || body.banReason.length > 500)) bad('Motivo de banimento inválido.');
        if (previous.id === actor && (role !== 'admin' || status !== 'active')) bad('Use outro administrador para alterar seu próprio acesso.');
        if (previous.role === 'admin' && previous.status === 'active' && (role !== 'admin' || status !== 'active') &&
            db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'").get().n <= 1) bad('Mantenha pelo menos um administrador ativo.');
        transaction(() => {
          db.prepare('UPDATE users SET role=?, status=?, grupo=?, ban_reason=? WHERE id=?').run(role, status, grupo, status === 'disabled' ? (body.banReason ?? previous.banReason) : '', previous.id);
          if (status !== 'active') {
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(previous.id);
            db.prepare('DELETE FROM wireguard_devices WHERE user_id=?').run(previous.id);
          }
          audit(actor, 'user.update', previous.id, { role, status, grupo, banReason: status === 'disabled' ? (body.banReason ?? previous.banReason) : '' });
        });
        return result({ user: user(previous.id) });
      }
    }
    if (method === 'GET' && pathname === '/v1/admin/networks') return result({ networks: enrichNetworks(db.prepare('SELECT n.id, n.owner_id AS ownerId, u.display_name AS ownerName, u.email AS ownerEmail, n.name, n.visibility, n.created_at AS createdAt FROM networks n JOIN users u ON u.id=n.owner_id ORDER BY n.created_at DESC').all()) });
    const network = /^\/v1\/admin\/networks\/([a-f0-9]{32})(\/invites)?$/.exec(pathname);
    if (method === 'DELETE' && network) {
      transaction(() => {
        if (!db.prepare('SELECT 1 FROM networks WHERE id=?').get(network[1])) throw new ApiError(404, 'not_found', 'Rede não encontrada.');
        db.prepare(network[2] ? 'DELETE FROM invites WHERE network_id=?' : 'DELETE FROM networks WHERE id=?').run(network[1]);
        audit(actor, network[2] ? 'network.revoke-invites' : 'network.delete', network[1]);
      });
      return result({ ok: true });
    }
    // Lista de convidados: e-mails que entram direto (sem esperar aprovação) com o grupo ou papel combinado
    if (pathname === '/v1/admin/allowlist') {
      if (method === 'GET') {
        return result({ allowlist: db.prepare('SELECT a.email, a.grupo, a.label, a.created_at AS createdAt, u.id IS NOT NULL AS joined FROM allowed_emails a LEFT JOIN users u ON u.email = a.email ORDER BY a.created_at DESC')
          .all().map(r => ({ ...r, joined: !!r.joined })) });
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const grupo = body.grupo ?? 'amigo';
        const label = body.label === undefined ? '' : body.label;
        if (!EMAIL_RE.test(email) || email.length > 254) bad('E-mail inválido.');
        if (!['amigo', 'teste', 'admin'].includes(grupo)) bad('Grupo inválido.');
        if (typeof label !== 'string' || label.length > 60 || /[\u0000-\u001f\u007f]/.test(label)) bad('Nome ou observação inválido (até 60 caracteres).');
        if (db.prepare('SELECT COUNT(*) AS n FROM allowed_emails').get().n >= 500 && !db.prepare('SELECT 1 FROM allowed_emails WHERE email = ?').get(email)) bad('A lista de convidados chegou ao limite de 500.');
        const semGoogle = transaction(() => {
          db.prepare('INSERT INTO allowed_emails(email, grupo, label, added_by, created_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET grupo=excluded.grupo, label=excluded.label')
            .run(email, grupo, label.trim(), actor, now());
          // Quem já criou a conta (pendente ou não) passa a valer como convidado, mas só se o Google confirmou o e-mail:
          // o cadastro por senha não confere o dono do e-mail, e qualquer um poderia registrar o de um convidado antes
          // dele e herdar o grupo ou o papel de administrador. Essa conta fica como está até entrar com o Google desse e-mail.
          const existing = db.prepare('SELECT id, status, email_verificado AS verificado FROM users WHERE email = ?').get(email);
          if (existing?.verificado) {
            db.prepare('UPDATE users SET role=?, grupo=?, status=? WHERE id=?')
              .run(grupo === 'admin' ? 'admin' : 'user', grupo === 'admin' ? 'amigo' : grupo, existing.status === 'pending' ? 'active' : existing.status, existing.id);
          }
          audit(actor, 'allowlist.add', email, { grupo, ...(existing && !existing.verificado ? { contaSemGoogle: existing.id } : {}) });
          return !!existing && !existing.verificado;
        });
        return result(semGoogle ? { ok: true, semGoogle: true } : { ok: true });
      }
    }
    const allowed = /^\/v1\/admin\/allowlist\/([^/]{3,254})$/.exec(pathname);
    if (method === 'DELETE' && allowed) {
      let email = '';
      try { email = decodeURIComponent(allowed[1]).toLowerCase(); } catch { bad('E-mail inválido.'); }
      transaction(() => {
        if (!db.prepare('DELETE FROM allowed_emails WHERE email = ?').run(email).changes) throw new ApiError(404, 'not_found', 'E-mail não está na lista.');
        audit(actor, 'allowlist.remove', email);
      });
      return result({ ok: true });
    }
    // Feedback e bugs mandados pelo app: a lista vem sem o print (que vem à parte, um por vez)
    if (method === 'GET' && pathname === '/v1/admin/feedback') {
      const rows = db.prepare('SELECT f.id, f.tipo, f.respostas, f.tecnico, f.contato, f.status, f.created_at AS createdAt, f.imagem IS NOT NULL AS temImagem, u.id AS userId, u.display_name AS nome, u.email FROM feedback f JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT 300').all();
      return result({ feedback: rows.map(r => ({ ...r, respostas: JSON.parse(r.respostas), tecnico: JSON.parse(r.tecnico), contato: !!r.contato, temImagem: !!r.temImagem })) });
    }
    const feedback = /^\/v1\/admin\/feedback\/([a-f0-9]{32})(\/imagem)?$/.exec(pathname);
    if (feedback) {
      const row = db.prepare('SELECT id, imagem, imagem_tipo AS imagemTipo FROM feedback WHERE id=?').get(feedback[1]);
      if (!row) throw new ApiError(404, 'not_found', 'Feedback não encontrado.');
      if (feedback[2]) {
        if (method !== 'GET' || !row.imagem) throw new ApiError(404, 'not_found', 'Este feedback não tem print.');
        return result({ tipo: row.imagemTipo, dados: Buffer.from(row.imagem).toString('base64') });
      }
      if (method === 'PATCH') {
        const body = await readBody(req);
        if (Object.keys(body).some(k => k !== 'status') || !['novo', 'visto', 'resolvido'].includes(body.status)) bad('Situação do feedback inválida.');
        db.prepare('UPDATE feedback SET status=? WHERE id=?').run(body.status, row.id);
        return result({ ok: true });
      }
      if (method === 'DELETE') {
        transaction(() => { db.prepare('DELETE FROM feedback WHERE id=?').run(row.id); audit(actor, 'feedback.delete', row.id); });
        return result({ ok: true });
      }
    }
    if (method === 'GET' && pathname === '/v1/admin/analytics') return result(analytics());
    if (method === 'GET' && pathname === '/v1/admin/database') return result({ tables: Object.keys(views) });
    const table = /^\/v1\/admin\/database\/([a-z_]+)$/.exec(pathname);
    if (method === 'GET' && table && Object.hasOwn(views, table[1])) {
      const query = new URL(req.url, 'http://localhost').searchParams;
      const offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || 50);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) bad('Paginação inválida.');
      const sql = views[table[1]];
      const total = db.prepare('SELECT COUNT(*) AS n FROM (' + sql + ')').get().n;
      return result({ table: table[1], total, offset, limit, rows: db.prepare(sql + ' ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit, offset) });
    }
    throw new ApiError(404, 'not_found', 'Endpoint administrativo não encontrado.');
  }
  function serveAdmin(req, res, pathname) {
    const files = { '/admin/': ['index.html', 'text/html'], '/admin/app.js': ['app.js', 'text/javascript'], '/admin/style.css': ['style.css', 'text/css'] };
    if (pathname === '/admin') { res.writeHead(302, { Location: '/admin/' }); res.end(); return true; }
    if (req.method !== 'GET' || !files[pathname]) return false;
    const [file, type] = files[pathname];
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(fs.readFileSync(path.join(__dirname, 'admin', file)));
    return true;
  }
  return { settings, heartbeat, offline, rooms, friendRooms, salasAtuais, enrichUsers, enrichNetworks, handleAdmin, serveAdmin, measure };
}

module.exports = { createControl };
