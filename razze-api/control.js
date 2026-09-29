'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');

// Administração e presença compartilham a autenticação da API, sem depender do Electron.
function createControl({ db, options, now, hash, requireUser, readBody, send, ApiError, isMember }) {
  const columns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!columns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin'))");
  if (!columns.includes('ban_reason')) db.exec("ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('PRAGMA table_info(sessions)').all().some(c => c.name === 'client_id')) db.exec('ALTER TABLE sessions ADD COLUMN client_id TEXT');
  if (!db.prepare('PRAGMA table_info(sessions)').all().some(c => c.name === 'client_name')) db.exec("ALTER TABLE sessions ADD COLUMN client_name TEXT NOT NULL DEFAULT 'Tela P2P'");
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
  // Após reiniciar, cada cliente precisa confirmar sua presença novamente.
  db.exec('DELETE FROM live_presence');
  // Mantém somente a sessão mais recente de cada conta.
  db.exec(`DELETE FROM sessions WHERE rowid NOT IN (
    SELECT MAX(rowid)
    FROM sessions
    GROUP BY user_id
  )`);
  const defaults = { requireApproval: options.requireApproval !== false, registrationOpen: true, presenceTimeoutSeconds: 70 };
  const settings = () => Object.assign({}, defaults, Object.fromEntries(db.prepare('SELECT key, value FROM server_settings').all().map(r => [r.key, JSON.parse(r.value)])));
  const tokenHash = req => hash(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const user = id => db.prepare('SELECT id, email, display_name AS displayName, status, role, ban_reason AS banReason, created_at AS createdAt FROM users WHERE id = ?').get(id);
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
      return { userId: r.user_id, displayName: r.displayName, lastSeen: r.last_seen, connections, room: r.room ? JSON.parse(r.room) : null };
    });
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
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
    db.prepare('UPDATE sessions SET client_name=? WHERE token_hash=?').run(clientName.trim(), tokenHash(req));
    db.prepare('DELETE FROM live_presence WHERE last_seen <= ?').run(now() - settings().presenceTimeoutSeconds * 1000);
    db.prepare(`INSERT INTO live_presence(session_hash, user_id, last_seen, connections, room) VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(session_hash) DO UPDATE SET last_seen=excluded.last_seen, connections=excluded.connections, room=excluded.room`)
      .run(tokenHash(req), userId, now(), JSON.stringify(cleaned), room ? JSON.stringify(room) : null);
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
    users: 'SELECT id, email, display_name, status, role, ban_reason, created_at FROM users',
    networks: 'SELECT * FROM networks', network_members: 'SELECT * FROM network_members',
    wireguard_devices: 'SELECT network_id, device_id, user_id, name, assigned_ip, updated_at FROM wireguard_devices',
    friend_requests: 'SELECT * FROM friend_requests',
    sessions: 'SELECT client_id, client_name, user_id, expires_at FROM sessions',
    invites: 'SELECT network_id, created_by, created_at, expires_at, max_uses, uses FROM invites',
    server_settings: 'SELECT * FROM server_settings', audit_log: 'SELECT * FROM audit_log',
    live_presence: 'SELECT user_id, last_seen FROM live_presence',
  };
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
    if (method === 'GET' && pathname === '/v1/admin/users') return result({ users: enrichUsers(db.prepare('SELECT id, email, display_name AS displayName, status, role, ban_reason AS banReason, created_at AS createdAt FROM users ORDER BY created_at DESC').all()) });
    const target = /^\/v1\/admin\/users\/([a-f0-9]{32})(?:\/(approve|revoke-sessions))?$/.exec(pathname);
    if (target) {
      const previous = user(target[1]);
      if (!previous) throw new ApiError(404, 'not_found', 'Usuário não encontrado.');
      if (method === 'POST' && target[2] === 'approve') {
        if (previous.status !== 'pending') throw new ApiError(404, 'pending_user_not_found', 'Conta pendente não encontrada.');
        transaction(() => { db.prepare("UPDATE users SET status='active' WHERE id=?").run(previous.id); audit(actor, 'user.approve', previous.id); });
        return result({ user: user(previous.id), status: 'active' });
      }
      if (method === 'POST' && target[2] === 'revoke-sessions') {
        transaction(() => {
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(previous.id);
          db.prepare('DELETE FROM wireguard_devices WHERE user_id=?').run(previous.id);
          audit(actor, 'user.revoke-sessions', previous.id);
        });
        return result({ ok: true });
      }
      if (method === 'PATCH' && !target[2]) {
        const body = await readBody(req);
        adminActor(req);
        if (!Object.keys(body).length || Object.keys(body).some(k => !['role', 'status', 'banReason'].includes(k))) bad('Alteração de usuário inválida.');
        const role = body.role ?? previous.role, status = body.status ?? previous.status;
        if (!['user', 'admin'].includes(role) || !['active', 'pending', 'disabled'].includes(status)) bad('Papel ou status inválido.');
        if (body.banReason !== undefined && (typeof body.banReason !== 'string' || body.banReason.length > 500)) bad('Motivo de banimento inválido.');
        if (previous.id === actor && (role !== 'admin' || status !== 'active')) bad('Use outro administrador para alterar seu próprio acesso.');
        if (previous.role === 'admin' && previous.status === 'active' && (role !== 'admin' || status !== 'active') &&
            db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'").get().n <= 1) bad('Mantenha pelo menos um administrador ativo.');
        transaction(() => {
          db.prepare('UPDATE users SET role=?, status=?, ban_reason=? WHERE id=?').run(role, status, status === 'disabled' ? (body.banReason ?? previous.banReason) : '', previous.id);
          if (status !== 'active') {
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(previous.id);
            db.prepare('DELETE FROM wireguard_devices WHERE user_id=?').run(previous.id);
          }
          audit(actor, 'user.update', previous.id, { role, status, banReason: status === 'disabled' ? (body.banReason ?? previous.banReason) : '' });
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
  return { settings, heartbeat, offline, rooms, enrichUsers, enrichNetworks, handleAdmin, serveAdmin, measure };
}

module.exports = { createControl };
