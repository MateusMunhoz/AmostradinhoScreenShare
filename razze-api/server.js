'use strict';

// Serviço central separado do Electron. Chaves privadas WireGuard ficam nos clientes.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const dgram = require('node:dgram');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const scryptAsync = promisify(scrypt);
const { createControl } = require('./control');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function createApiServer(options = {}) {
  const dbPath = options.dbPath || process.env.RAZZE_DB_PATH || path.join(__dirname, 'data', 'razze.sqlite');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  let databaseClosed = false;
  let closePromise = null;
  const closeDatabase = () => {
    if (databaseClosed) return;
    db.close();
    databaseClosed = true;
  };
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec([
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending', 'active', 'disabled')), created_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS friend_requests (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL CHECK(status IN ('pending', 'accepted')), created_at INTEGER NOT NULL, UNIQUE(sender_id, receiver_id))",
    "CREATE TABLE IF NOT EXISTS networks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL CHECK(visibility IN ('private', 'friends', 'public')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS network_members (network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, joined_at INTEGER NOT NULL, PRIMARY KEY(network_id, user_id))",
    "CREATE TABLE IF NOT EXISTS network_subnets (network_id TEXT PRIMARY KEY REFERENCES networks(id) ON DELETE CASCADE, subnet_index INTEGER NOT NULL UNIQUE)",
    "CREATE TABLE IF NOT EXISTS wireguard_devices (network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE, device_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, public_key TEXT NOT NULL, assigned_ip TEXT NOT NULL, endpoint_host TEXT, endpoint_port INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(network_id, device_id), UNIQUE(network_id, public_key), UNIQUE(network_id, assigned_ip))",
    "CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE, created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0)",
    "CREATE INDEX IF NOT EXISTS idx_network_members_user ON network_members(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_network_owner ON networks(owner_id)",
    "CREATE INDEX IF NOT EXISTS idx_invites_network ON invites(network_id)"
  ].join(';\n') + ';');
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!userColumns.includes('status')) db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending', 'active', 'disabled'))");

  const publicUser = (id) => db.prepare('SELECT id, email, display_name AS displayName, role, created_at AS createdAt FROM users WHERE id = ?').get(id) || null;
  const newId = () => randomBytes(16).toString('hex');
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const now = options.now || (() => Date.now());
  const authAttempts = new Map();
  // Devolve a função que conta a tentativa: o cadastro conta sempre; o login só quando erra a senha
  const enforceAuthLimit = (req, route, maxAttempts, windowMs) => {
    const forwarded = process.env.RAZZE_TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const address = forwarded || req.socket.remoteAddress || 'unknown';
    const key = route + ':' + address;
    const timestamp = now();
    let record = authAttempts.get(key);
    if (!record || record.resetAt <= timestamp) record = { count: 0, resetAt: timestamp + windowMs };
    if (record.count >= maxAttempts) throw new ApiError(429, 'rate_limited', 'Muitas tentativas. Aguarde antes de tentar novamente.');
    authAttempts.set(key, record);
    if (authAttempts.size > 10_000) {
      for (const [itemKey, item] of authAttempts) if (item.resetAt <= timestamp) authAttempts.delete(itemKey);
      while (authAttempts.size > 10_000) authAttempts.delete(authAttempts.keys().next().value);
    }
    return () => { record.count++; };
  };
  const issueToken = (userId) => {
    const token = randomBytes(32).toString('base64url');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      db.prepare(
        'INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?, ?, ?)'
      ).run(
        hash(token),
        userId,
        now() + (options.tokenTtlMs || TOKEN_TTL_MS)
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return token;
  };
  const requireUser = (req) => {
    const match = /^Bearer ([A-Za-z0-9_-]{30,})$/.exec(String(req.headers.authorization || ''));
    if (!match) throw new ApiError(401, 'unauthorized', 'Faça login para continuar.');
    const tokenHash = hash(match[1]);
    const session = db.prepare('SELECT user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token_hash = ?').get(tokenHash);
    if (!session || session.expiresAt <= now()) {
      if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      throw new ApiError(401, 'unauthorized', 'Sessão inválida ou expirada.');
    }
    const account = db.prepare('SELECT status FROM users WHERE id=?').get(session.userId);
    if (account?.status !== 'active') throw new ApiError(403, 'account_disabled', 'Esta conta está desativada ou aguarda aprovação.');
    req.authSessionHash = tokenHash;
    return session.userId;
  };
  const readBody = async (req) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      req.bodyBytes = size;
      if (size > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large', 'A requisição excede o limite permitido.');
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object');
      return value;
    } catch { throw new ApiError(400, 'invalid_json', 'Envie um objeto JSON válido.'); }
  };
  const send = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  const assertText = (value, field, min, max) => {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      throw new ApiError(400, 'invalid_input', field + ' precisa ter de ' + min + ' a ' + max + ' caracteres.');
    }
    return value.trim();
  };
  const friendshipExists = (a, b) => !!db.prepare(
    "SELECT 1 AS yes FROM friend_requests WHERE status = 'accepted' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))"
  ).get(a, b, b, a);
  const networkRow = (id) => db.prepare(
    'SELECT id, owner_id AS ownerId, name, description, visibility, created_at AS createdAt, updated_at AS updatedAt FROM networks WHERE id = ?'
  ).get(id) || null;
  const isMember = (networkId, userId) => !!db.prepare('SELECT 1 AS yes FROM network_members WHERE network_id = ? AND user_id = ?').get(networkId, userId);
  const ensureSubnet = (networkId) => {
    let row = db.prepare('SELECT subnet_index AS subnetIndex FROM network_subnets WHERE network_id = ?').get(networkId);
    if (row) return row.subnetIndex;
    const used = new Set(db.prepare('SELECT subnet_index AS subnetIndex FROM network_subnets').all().map((item) => item.subnetIndex));
    let index = 0;
    while (used.has(index) && index < 16384) index++;
    if (index >= 16384) throw new ApiError(503, 'subnet_pool_full', 'O servidor esgotou os blocos de rede disponíveis.');
    db.prepare('INSERT INTO network_subnets(network_id, subnet_index) VALUES(?, ?)').run(networkId, index);
    return index;
  };
  const peerRows = (networkId) => db.prepare(
    'SELECT device_id AS deviceId, user_id AS userId, name, public_key AS publicKey, assigned_ip AS assignedIp, endpoint_host AS endpointHost, endpoint_port AS endpointPort, updated_at AS updatedAt FROM wireguard_devices WHERE network_id = ? ORDER BY created_at'
  ).all(networkId);
  const canViewNetwork = (network, userId) => network.ownerId === userId || isMember(network.id, userId)
    || network.visibility === 'public' || (network.visibility === 'friends' && friendshipExists(network.ownerId, userId));
  const requireOwner = (network, userId) => {
    if (!network) throw new ApiError(404, 'not_found', 'Rede não encontrada.');
    if (network.ownerId !== userId) throw new ApiError(403, 'forbidden', 'Somente o dono pode alterar esta rede.');
  };

  const control = createControl({ db, options, now, hash, requireUser, readBody, send, ApiError, isMember });
  const handler = async (req, res) => {
    try {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { throw new ApiError(400, 'invalid_path', 'Endereço da requisição inválido.'); }
      const method = req.method || 'GET';
      if (control.serveAdmin(req, res, pathname)) return;

      if (method === 'GET' && pathname === '/v1/health') return send(res, 200, { ok: true, service: 'razze-api', stun: stunServer?.address() ? { port: stunServer.address().port, protocol: 'udp' } : null });

      if (method === 'POST' && pathname === '/v1/auth/register') {
        if (!control.settings().registrationOpen) throw new ApiError(403, 'registration_closed', 'Novos cadastros estão desativados.');
        enforceAuthLimit(req, 'register', 20, 60 * 60 * 1000)();
        const body = await readBody(req);
        const email = assertText(body.email, 'E-mail', 3, 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'invalid_email', 'E-mail inválido.');
        const displayName = assertText(body.displayName, 'Nome', 1, 60);
        const password = assertText(body.password, 'Senha', 8, 200);
        const id = newId();
        const salt = randomBytes(16).toString('hex');
        const passwordHash = (await scryptAsync(password, salt, 64)).toString('hex');
        const requiresApproval = control.settings().requireApproval;
        try {
          db.prepare('INSERT INTO users(id, email, display_name, password_salt, password_hash, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
            .run(id, email, displayName, salt, passwordHash, requiresApproval ? 'pending' : 'active', now());
        } catch (error) {
          if (/UNIQUE constraint failed: users.email/.test(String(error))) throw new ApiError(409, 'email_exists', 'Já existe uma conta com este e-mail.');
          throw error;
        }
        const user = publicUser(id);
        if (requiresApproval) return send(res, 202, { user, status: 'pending_approval' });
        return send(res, 201, { user, status: 'active', accessToken: issueToken(id) });
      }

      if (method === 'POST' && pathname === '/v1/auth/login') {
        const failedLogin = enforceAuthLimit(req, 'login', 10, 10 * 60 * 1000);
        const body = await readBody(req);
        const email = assertText(body.email, 'E-mail', 3, 254).toLowerCase();
        const password = assertText(body.password, 'Senha', 1, 200);
        const user = db.prepare('SELECT id, status, password_salt AS salt, password_hash AS passwordHash FROM users WHERE email = ?').get(email);
        const candidate = await scryptAsync(password, user?.salt || 'razze-invalid-user-salt', 64);
        const stored = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
        if (!user || stored.length !== candidate.length || !timingSafeEqual(stored, candidate)) {
          failedLogin();
          throw new ApiError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
        }
        if (user.status === 'pending') throw new ApiError(403, 'account_pending', 'Sua conta aguarda aprovação do servidor.');
        if (user.status !== 'active') throw new ApiError(403, 'account_disabled', 'Esta conta está desativada.');
        return send(res, 200, { user: publicUser(user.id), accessToken: issueToken(user.id) });
      }

      if (pathname.startsWith('/v1/admin/')) return await control.handleAdmin(req, res, pathname);

      if (method === 'POST' && pathname === '/v1/invites/accept') {
        const userId = requireUser(req);
        const body = await readBody(req);
        const inviteToken = assertText(body.token, 'Convite', 20, 200);
        const tokenHash = hash(inviteToken);
        db.exec('BEGIN IMMEDIATE');
        try {
          const invite = db.prepare('SELECT network_id AS networkId, expires_at AS expiresAt, max_uses AS maxUses, uses FROM invites WHERE token_hash = ?').get(tokenHash);
          if (!invite || invite.expiresAt <= now()) throw new ApiError(404, 'invite_invalid', 'Este convite expirou ou não está mais disponível.');
          const alreadyMember = isMember(invite.networkId, userId);
          if (!alreadyMember) {
            if (invite.uses >= invite.maxUses) throw new ApiError(404, 'invite_invalid', 'Este convite expirou ou não está mais disponível.');
            db.prepare('INSERT INTO network_members(network_id, user_id, joined_at) VALUES(?, ?, ?)').run(invite.networkId, userId, now());
            db.prepare('UPDATE invites SET uses = uses + 1 WHERE token_hash = ?').run(tokenHash);
          }
          db.exec('COMMIT');
          return send(res, 200, { network: networkRow(invite.networkId), joined: !alreadyMember });
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }

      const userId = requireUser(req);
      if (method === 'POST' && pathname === '/v1/presence/heartbeat') return send(res, 200, await control.heartbeat(req, userId));
      if (method === 'DELETE' && pathname === '/v1/presence') { control.offline(req); return send(res, 200, { ok: true }); }
      if (method === 'GET' && pathname === '/v1/rooms') {
        const networkId = new URL(req.url, 'http://localhost').searchParams.get('networkId');
        return send(res, 200, { rooms: control.rooms(userId, networkId) });
      }
      if (method === 'GET' && pathname === '/v1/me') return send(res, 200, { user: publicUser(userId) });
      if (method === 'POST' && pathname === '/v1/auth/logout') {
        const token = /^Bearer ([A-Za-z0-9_-]{30,})$/.exec(String(req.headers.authorization || ''))?.[1];
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
        return send(res, 200, { ok: true });
      }

      if (method === 'GET' && pathname === '/v1/friends') {
        const rows = db.prepare(
          "SELECT DISTINCT u.id, u.email, u.display_name AS displayName FROM friend_requests f JOIN users u ON (u.id = f.sender_id AND f.receiver_id = ?) OR (u.id = f.receiver_id AND f.sender_id = ?) WHERE f.status = 'accepted' ORDER BY u.display_name COLLATE NOCASE"
        ).all(userId, userId);
        return send(res, 200, { friends: control.enrichUsers(rows) });
      }
      if (method === 'GET' && pathname === '/v1/friends/requests') {
        const incoming = db.prepare(
          "SELECT f.id, f.created_at AS createdAt, u.id AS userId, u.email, u.display_name AS displayName FROM friend_requests f JOIN users u ON u.id = f.sender_id WHERE f.receiver_id = ? AND f.status = 'pending' ORDER BY f.created_at"
        ).all(userId);
        const outgoing = db.prepare(
          "SELECT f.id, f.created_at AS createdAt, u.id AS userId, u.email, u.display_name AS displayName FROM friend_requests f JOIN users u ON u.id = f.receiver_id WHERE f.sender_id = ? AND f.status = 'pending' ORDER BY f.created_at"
        ).all(userId);
        return send(res, 200, { incoming, outgoing });
      }
      if (method === 'POST' && pathname === '/v1/friends/requests') {
        const body = await readBody(req);
        const email = assertText(body.email, 'E-mail', 3, 254).toLowerCase();
        const target = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (!target) throw new ApiError(404, 'user_not_found', 'Não existe uma conta com este e-mail.');
        if (target.id === userId) throw new ApiError(400, 'invalid_friend', 'Você não pode adicionar a própria conta.');
        if (friendshipExists(userId, target.id)) return send(res, 200, { status: 'accepted' });
        const reverse = db.prepare('SELECT id, status FROM friend_requests WHERE sender_id = ? AND receiver_id = ?').get(target.id, userId);
        if (reverse?.status === 'pending') {
          db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run('accepted', reverse.id);
          return send(res, 200, { status: 'accepted' });
        }
        const previous = db.prepare('SELECT id, status FROM friend_requests WHERE sender_id = ? AND receiver_id = ?').get(userId, target.id);
        if (previous) return send(res, 200, { id: previous.id, status: previous.status });
        const id = newId();
        db.prepare('INSERT INTO friend_requests(id, sender_id, receiver_id, status, created_at) VALUES(?, ?, ?, ?, ?)')
          .run(id, userId, target.id, 'pending', now());
        return send(res, 201, { id, status: 'pending' });
      }
      let match = /^\/v1\/friends\/requests\/([a-f0-9]{32})\/accept$/.exec(pathname);
      if (method === 'POST' && match) {
        const result = db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ? AND receiver_id = ? AND status = 'pending'").run(match[1], userId);
        if (!result.changes) throw new ApiError(404, 'request_not_found', 'Pedido de amizade não encontrado.');
        return send(res, 200, { status: 'accepted' });
      }
      match = /^\/v1\/friends\/([a-f0-9]{32})$/.exec(pathname);
      if (method === 'DELETE' && match) {
        db.prepare("DELETE FROM friend_requests WHERE status = 'accepted' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))")
          .run(userId, match[1], match[1], userId);
        return send(res, 200, { ok: true });
      }

      if (method === 'GET' && pathname === '/v1/networks') {
        const networks = db.prepare(
          "SELECT DISTINCT n.id, n.owner_id AS ownerId, n.name, n.description, n.visibility, CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS isMember, n.created_at AS createdAt, n.updated_at AS updatedAt FROM networks n LEFT JOIN friend_requests f1 ON f1.sender_id = n.owner_id AND f1.receiver_id = ? AND f1.status = 'accepted' LEFT JOIN friend_requests f2 ON f2.receiver_id = n.owner_id AND f2.sender_id = ? AND f2.status = 'accepted' LEFT JOIN network_members m ON m.network_id = n.id AND m.user_id = ? WHERE n.owner_id = ? OR m.user_id IS NOT NULL OR n.visibility = 'public' OR (n.visibility = 'friends' AND (f1.id IS NOT NULL OR f2.id IS NOT NULL)) ORDER BY n.updated_at DESC"
        ).all(userId, userId, userId, userId);
        return send(res, 200, { networks: control.enrichNetworks(networks, userId) });
      }
      if (method === 'POST' && pathname === '/v1/networks') {
        const body = await readBody(req);
        const name = assertText(body.name, 'Nome da rede', 1, 80);
        const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
        const visibility = ['private', 'friends', 'public'].includes(body.visibility) ? body.visibility : 'private';
        const id = newId();
        const timestamp = now();
        db.prepare('INSERT INTO networks(id, owner_id, name, description, visibility, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
          .run(id, userId, name, description, visibility, timestamp, timestamp);
        db.prepare('INSERT INTO network_members(network_id, user_id, joined_at) VALUES(?, ?, ?)').run(id, userId, timestamp);
        return send(res, 201, { network: networkRow(id) });
      }

      match = /^\/v1\/networks\/([a-f0-9]{32})$/.exec(pathname);
      if (match) {
        const network = networkRow(match[1]);
        if (method === 'GET') {
          if (!network || !canViewNetwork(network, userId)) throw new ApiError(404, 'not_found', 'Rede não encontrada.');
          return send(res, 200, { network });
        }
        if (method === 'PATCH') {
          requireOwner(network, userId);
          const body = await readBody(req);
          const name = body.name === undefined ? network.name : assertText(body.name, 'Nome da rede', 1, 80);
          let description = network.description;
          if (body.description !== undefined) {
            if (typeof body.description !== 'string') throw new ApiError(400, 'invalid_input', 'Descrição inválida.');
            description = body.description.trim().slice(0, 500);
          }
          const visibility = body.visibility === undefined ? network.visibility : body.visibility;
          if (!['private', 'friends', 'public'].includes(visibility)) throw new ApiError(400, 'invalid_input', 'Visibilidade inválida.');
          db.prepare('UPDATE networks SET name = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?')
            .run(name, description, visibility, now(), network.id);
          return send(res, 200, { network: networkRow(network.id) });
        }
        if (method === 'DELETE') {
          requireOwner(network, userId);
          db.prepare('DELETE FROM networks WHERE id = ?').run(network.id);
          return send(res, 200, { ok: true });
        }
      }

      // Sair da rede (userId "me") ou o dono tirar alguém. Os dispositivos da pessoa nessa rede saem junto.
      match = /^\/v1\/networks\/([a-f0-9]{32})\/members\/([a-f0-9]{32}|me)$/.exec(pathname);
      if (method === 'DELETE' && match) {
        const network = networkRow(match[1]);
        if (!network || (network.ownerId !== userId && !isMember(network.id, userId))) throw new ApiError(404, 'not_found', 'Rede não encontrada.');
        const target = match[2] === 'me' ? userId : match[2];
        if (target !== userId && network.ownerId !== userId) throw new ApiError(403, 'forbidden', 'Somente o dono pode remover membros.');
        if (target === network.ownerId) throw new ApiError(400, 'owner_cannot_leave', 'O dono não sai da própria rede. Para acabar com ela, exclua a rede.');
        if (!isMember(network.id, target)) throw new ApiError(404, 'member_not_found', 'Essa pessoa não está na rede.');
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM wireguard_devices WHERE network_id = ? AND user_id = ?').run(network.id, target);
          db.prepare('DELETE FROM network_members WHERE network_id = ? AND user_id = ?').run(network.id, target);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(res, 200, { ok: true });
      }

      match = /^\/v1\/networks\/([a-f0-9]{32})\/members$/.exec(pathname);
      if (method === 'GET' && match) {
        const network = networkRow(match[1]);
        if (!network || (network.ownerId !== userId && !isMember(network.id, userId))) throw new ApiError(404, 'not_found', 'Rede ou membros não encontrados.');
        const members = db.prepare(
          'SELECT u.id, u.email, u.display_name AS displayName, m.joined_at AS joinedAt FROM network_members m JOIN users u ON u.id = m.user_id WHERE m.network_id = ? ORDER BY m.joined_at'
        ).all(network.id);
        return send(res, 200, { members: control.enrichUsers(members) });
      }

      match = /^\/v1\/networks\/([a-f0-9]{32})\/devices$/.exec(pathname);
      if (match && method === 'GET') {
        const network = networkRow(match[1]);
        if (!network || !isMember(network.id, userId)) throw new ApiError(404, 'not_found', 'Rede não encontrada.');
        return send(res, 200, { peers: peerRows(network.id), subnet: '10.' + (64 + Math.floor(ensureSubnet(network.id) / 256)) + '.' + (ensureSubnet(network.id) % 256) + '.0/24' });
      }
      if (match && method === 'POST') {
        const network = networkRow(match[1]);
        if (!network || !isMember(network.id, userId)) throw new ApiError(404, 'not_found', 'Você precisa entrar na rede antes de registrar um dispositivo.');
        const body = await readBody(req);
        const deviceId = assertText(body.deviceId, 'ID do dispositivo', 16, 64);
        if (!/^[a-f0-9-]+$/i.test(deviceId)) throw new ApiError(400, 'invalid_input', 'ID de dispositivo inválido.');
        const name = assertText(body.name || 'Tela P2P', 'Nome do dispositivo', 1, 60);
        const publicKey = assertText(body.publicKey, 'Chave pública', 40, 50);
        let decodedKey;
        try { decodedKey = Buffer.from(publicKey, 'base64'); } catch {}
        if (!decodedKey || decodedKey.length !== 32 || decodedKey.toString('base64') !== publicKey) throw new ApiError(400, 'invalid_public_key', 'Chave pública WireGuard inválida.');
        const existing = db.prepare('SELECT user_id AS userId, assigned_ip AS assignedIp FROM wireguard_devices WHERE network_id = ? AND device_id = ?').get(network.id, deviceId);
        if (existing && existing.userId !== userId) throw new ApiError(409, 'device_id_in_use', 'Este ID de dispositivo já pertence a outra conta.');
        const keyOwner = db.prepare('SELECT device_id AS deviceId FROM wireguard_devices WHERE network_id = ? AND public_key = ?').get(network.id, publicKey);
        if (keyOwner && keyOwner.deviceId !== deviceId) throw new ApiError(409, 'public_key_in_use', 'Esta chave WireGuard já está registrada em outro dispositivo da rede.');
        const subnetIndex = ensureSubnet(network.id);
        let assignedIp = existing?.assignedIp || '';
        if (!assignedIp) {
          const used = new Set(peerRows(network.id).map((peer) => peer.assignedIp));
          for (let host = 2; host < 255; host++) {
            const candidate = '10.' + (64 + Math.floor(subnetIndex / 256)) + '.' + (subnetIndex % 256) + '.' + host;
            if (!used.has(candidate)) { assignedIp = candidate; break; }
          }
          if (!assignedIp) throw new ApiError(409, 'network_full', 'Esta rede já atingiu o limite de dispositivos.');
        }
        const timestamp = now();
        db.prepare('INSERT INTO wireguard_devices(network_id, device_id, user_id, name, public_key, assigned_ip, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(network_id, device_id) DO UPDATE SET name = excluded.name, public_key = excluded.public_key, updated_at = excluded.updated_at')
          .run(network.id, deviceId, userId, name, publicKey, assignedIp, timestamp, timestamp);
        return send(res, 201, { device: db.prepare('SELECT device_id AS deviceId, name, public_key AS publicKey, assigned_ip AS assignedIp FROM wireguard_devices WHERE network_id = ? AND device_id = ?').get(network.id, deviceId), subnet: '10.' + (64 + Math.floor(subnetIndex / 256)) + '.' + (subnetIndex % 256) + '.0/24' });
      }

      match = /^\/v1\/networks\/([a-f0-9]{32})\/devices\/([a-f0-9-]+)\/endpoint$/.exec(pathname);
      if (match && method === 'PATCH') {
        const network = networkRow(match[1]);
        if (!network || !isMember(network.id, userId)) throw new ApiError(404, 'not_found', 'Rede não encontrada.');
        const body = await readBody(req);
        const host = assertText(body.host, 'Endereço público', 3, 45);
        const port = Number(body.port);
        if (net.isIP(host) !== 4 || !Number.isInteger(port) || port < 1 || port > 65535) throw new ApiError(400, 'invalid_endpoint', 'Endpoint público inválido.');
        const result = db.prepare('UPDATE wireguard_devices SET endpoint_host = ?, endpoint_port = ?, updated_at = ? WHERE network_id = ? AND device_id = ? AND user_id = ?')
          .run(host, port, now(), network.id, match[2], userId);
        if (!result.changes) throw new ApiError(404, 'device_not_found', 'Dispositivo não encontrado.');
        return send(res, 200, { ok: true });
      }

      match = /^\/v1\/networks\/([a-f0-9]{32})\/devices\/([a-f0-9-]+)$/.exec(pathname);
      if (match && method === 'DELETE') {
        const result = db.prepare('DELETE FROM wireguard_devices WHERE network_id = ? AND device_id = ? AND (user_id = ? OR ? = (SELECT owner_id FROM networks WHERE id = ?))')
          .run(match[1], match[2], userId, userId, match[1]);
        if (!result.changes) throw new ApiError(404, 'device_not_found', 'Dispositivo não encontrado.');
        return send(res, 200, { ok: true });
      }

      match = /^\/v1\/networks\/([a-f0-9]{32})\/invites$/.exec(pathname);
      if (method === 'POST' && match) {
        const network = networkRow(match[1]);
        requireOwner(network, userId);
        const body = await readBody(req);
        const maxUses = Number.isInteger(body.maxUses) ? body.maxUses : 1;
        const ttlHours = Number.isInteger(body.ttlHours) ? body.ttlHours : 168;
        if (maxUses < 1 || maxUses > 1000 || ttlHours < 1 || ttlHours > 720) throw new ApiError(400, 'invalid_input', 'O convite aceita de 1 a 1000 usos e validade de 1 a 720 horas.');
        const token = randomBytes(24).toString('base64url');
        const createdAt = now();
        db.prepare('INSERT INTO invites(token_hash, network_id, created_by, created_at, expires_at, max_uses) VALUES(?, ?, ?, ?, ?, ?)')
          .run(hash(token), network.id, userId, createdAt, createdAt + ttlHours * 60 * 60 * 1000, maxUses);
        return send(res, 201, { token, networkId: network.id, expiresAt: createdAt + ttlHours * 60 * 60 * 1000, maxUses });
      }

      throw new ApiError(404, 'not_found', 'Endpoint não encontrado.');
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error instanceof ApiError ? error.status : 500;
      if (status === 500) console.error('[RazzeAPI]', error);
      send(res, status, { error: { code: error instanceof ApiError ? error.code : 'internal_error', message: error instanceof ApiError ? error.message : 'Erro interno da API.' } });
    }
  };

  const server = http.createServer((req, res) => { control.measure(req, res); void handler(req, res); });
  const stunServer = options.stun === false ? null : dgram.createSocket('udp4');
  let stunBound = false;
  let serviceStarted = false;
  server.on('error', (error) => { if (serviceStarted) console.error('[RazzeAPI] HTTP:', error); });
  if (stunServer) stunServer.on('message', (packet, remote) => {
    if (packet.length < 20 || (packet[0] & 0xc0) !== 0 || packet.readUInt16BE(0) !== 0x0001 || packet.readUInt32BE(4) !== 0x2112a442 || packet.readUInt16BE(2) !== packet.length - 20) return;
    const response = Buffer.alloc(32);
    response.writeUInt16BE(0x0101, 0);
    response.writeUInt16BE(12, 2);
    response.writeUInt32BE(0x2112a442, 4);
    packet.copy(response, 8, 8, 20);
    response.writeUInt16BE(0x0020, 20);
    response.writeUInt16BE(8, 22);
    response[24] = 0;
    response[25] = 1;
    response.writeUInt16BE(remote.port ^ 0x2112, 26);
    const octets = remote.address.split('.').map(Number);
    const cookie = Buffer.from([0x21, 0x12, 0xa4, 0x42]);
    for (let i = 0; i < 4; i++) response[28 + i] = octets[i] ^ cookie[i];
    stunServer.send(response, remote.port, remote.address);
  });
  if (stunServer) stunServer.on('error', (error) => { if (serviceStarted) console.error('[RazzeAPI] STUN UDP:', error); });
  return {
    server, db, stunServer,
    listen(port = Number(process.env.RAZZE_API_PORT || 8787), host = process.env.RAZZE_API_HOST || '127.0.0.1') {
      return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          server.removeListener('error', fail);
          stunServer?.removeListener('error', fail);
          const closing = [];
          if (server.listening) closing.push(new Promise((done) => server.close(done)));
          if (stunServer && stunBound) closing.push(new Promise((done) => stunServer.close(done)));
          Promise.allSettled(closing).then(() => reject(error));
        };
        const startHttp = () => {
          if (settled) return;
          server.once('error', fail);
          server.listen(port, host, () => {
            if (settled) return;
            settled = true;
            serviceStarted = true;
            server.removeListener('error', fail);
            resolve(stunServer ? { ...server.address(), stun: stunServer.address() } : server.address());
          });
        };
        if (!stunServer) return startHttp();
        stunServer.once('error', fail);
        stunServer.bind(options.stunPort ?? Number(process.env.RAZZE_STUN_PORT || 3478), options.stunHost || process.env.RAZZE_STUN_HOST || '0.0.0.0', () => {
          if (settled) return;
          stunBound = true;
          stunServer.removeListener('error', fail);
          startHttp();
        });
      });
    },
    close() {
      if (closePromise) return closePromise;
      closePromise = new Promise((resolve, reject) => {
        const closeHttp = (done) => server.listening ? server.close(done) : done();
        const closeStun = (done) => stunBound ? stunServer.close((error) => { if (!error) stunBound = false; done(error); }) : done();
        closeHttp(async (httpError) => {
          if (httpError) { closePromise = null; return reject(httpError); }
          closeStun((stunError) => {
            if (stunError) { closePromise = null; return reject(stunError); }
            try { closeDatabase(); resolve(); }
            catch (error) { closePromise = null; reject(error); }
          });
        });
      });
      return closePromise;
    },
  };
}

if (require.main === module) {
  const api = createApiServer();
  let shuttingDown = false;
  const shutdown = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await api.close(); }
    catch (error) { console.error('Erro ao encerrar a RazzeAPI:', error); process.exitCode = 1; }
    if (reason) console.log('RazzeAPI encerrada (' + reason + ').');
  };
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  api.listen().then((address) => console.log('RazzeAPI ouvindo em ' + address.address + ':' + address.port + (address.stun ? '; STUN UDP ' + address.stun.address + ':' + address.stun.port : '')))
    .catch(async (error) => {
      console.error('Não foi possível iniciar a RazzeAPI:', error);
      await shutdown('falha ao iniciar');
      process.exitCode = 1;
    });
}

module.exports = { createApiServer };
