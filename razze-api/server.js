'use strict';

// Serviço central separado do Electron. Chaves privadas WireGuard ficam nos clientes.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const dgram = require('node:dgram');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const { createHash, createPublicKey, randomBytes, scrypt, timingSafeEqual, verify: verifySignature } = require('node:crypto');
const { promisify } = require('node:util');
const scryptAsync = promisify(scrypt);
const { createControl } = require('./control');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;
// Mensagens diretas entre amigos: o servidor guarda por 30 dias (para chegar a quem está offline e aos outros PCs da
// mesma conta); o histórico completo fica no PC de cada um
const DM_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const DM_MAX_TEXT = 2000;
// Mensagem criptografada de ponta a ponta (e2e1:<base64url>): 2000 caracteres viram até ~8200 depois de cifrados
const DM_MAX_E2E = 9000;
const DM_E2E_RE = /^e2e1:[A-Za-z0-9_-]+$/;
const DM_KEY_RE = /^[A-Za-z0-9+/]{43}=$/; // chave pública X25519 (32 bytes, base64)
const DM_PAGE = 200;
// Convite de amigo por link (docs/spec/convite-por-link.md): vale 7 dias e 1 pessoa, no máximo 5 ativos por conta
const FRIEND_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FRIEND_LINK_MAX_ACTIVE = 5;
const FRIEND_LINK_TOKEN_RE = /^[A-Za-z0-9_-]{20,120}$/;
const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 símbolos, sem 0/O/1/I/L
const FRIEND_CODE_LENGTH = 10;
// Senha: trocar logado (pede a atual) e redefinir com o código que o administrador gera (sem e-mail no servidor)
const BIO_MAX = 128;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
// Atividade no perfil (jogo e música): o app só manda o que a pessoa deixou ligado; some em 2 minutos sem renovar
const ACTIVITY_TTL_MS = 2 * 60 * 1000;
const ACTIVITY_FIELD_MAX = 80;
// Login com Google (docs/razze-api.md): o app abre o navegador, o Google devolve um código para o próprio PC (127.0.0.1) e o
// servidor troca o código pelo dado da conta. O e-mail só é aceito se o Google confirmou (email_verified).
const GOOGLE_REDIRECT_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}\/callback$/;
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
// Login com Google no Android (docs/razze-api.md): o Credential Manager entrega um ID token (JWT) que o servidor confere
// pela assinatura, com as chaves públicas do Google. O nonce sai daqui antes, vale 5 minutos e uma vez só (o token não
// serve de novo se alguém copiar). A conta segue a mesma lógica do login do PC (entrarPeloGoogle).
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_NONCE_TTL_MS = 5 * 60 * 1000;
const GOOGLE_NONCE_MAX = 1000;
const GOOGLE_NONCE_RE = /^[A-Za-z0-9_-]{43}$/;
const GOOGLE_ANDROID_BODY_BYTES = 8 * 1024;
const GOOGLE_CLOCK_SKEW_S = 60;
const DEFAULT_DOWNLOAD_URL = 'https://github.com/MateusMunhoz/AmostradinhoScreenShare/releases/latest';
// Sinais da conexão direta das mensagens privadas (oferta e resposta WebRTC, cifradas de ponta a ponta): só na
// memória, entregues uma vez e apagados em 2 minutos. Nunca vão para o banco nem para o histórico
const SIGNAL_TTL_MS = 2 * 60 * 1000;
const SIGNAL_MAX = 16000;
const SIGNAL_QUEUE = 50; // sinais esperando por conta
// Feedback e bugs (docs/razze-api.md): respostas curtas de escolher, textos limitados e um print opcional (JPEG ou PNG,
// já reduzido no app). Só esta rota aceita corpo maior que MAX_BODY_BYTES
const FEEDBACK_BODY_BYTES = 700 * 1024;
const FEEDBACK_IMAGE_BYTES = 450 * 1024;
const FEEDBACK_POR_HORA = 5;
const FEEDBACK_POR_DIA = 20;
const FEEDBACK_ESCOLHAS = {
  area: ['chat', 'voz', 'transmissao', 'musica', 'mapa', 'conta', 'temas', 'outro'],
  frequencia: ['sempre', 'as-vezes', 'uma-vez'],
  impacto: ['pouco', 'bastante', 'bloqueia'],
  uso: ['as-vezes', 'semana', 'dia'],
};
const FEEDBACK_USA = ['voz', 'transmissao', 'chat', 'musica', 'mapa', 'gamer'];
const FEEDBACK_TEXTOS = { titulo: 140, detalhes: 2000, passos: 2000, gosta: 500, incomoda: 500 };
// O que é obrigatório em cada tipo: bug (onde e o que deu errado), ideia (a ideia), nota (a nota de 0 a 10)
const FEEDBACK_OBRIGATORIO = { bug: ['area', 'titulo'], ideia: ['titulo'], nota: ['nota'] };

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
    "CREATE INDEX IF NOT EXISTS idx_invites_network ON invites(network_id)",
    "CREATE TABLE IF NOT EXISTS direct_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id, seq)",
    "CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id, seq)",
    "CREATE INDEX IF NOT EXISTS idx_dm_created ON direct_messages(created_at)",
    // Chave pública das mensagens criptografadas: uma por conta (a do PC que publicou por último)
    "CREATE TABLE IF NOT EXISTS dm_keys (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, public_key TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    // Links de amigo: só o hash do segredo e o do código curto ficam no banco
    "CREATE TABLE IF NOT EXISTS friend_links (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_friend_links_user ON friend_links(user_id)",
    // O que a pessoa está jogando e ouvindo agora (só os amigos veem, em /v1/friends); uma linha por conta
    "CREATE TABLE IF NOT EXISTS user_activity (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, game TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)",
    // Código de redefinição de senha gerado pelo administrador: uma linha por conta, só o hash, expira e tem limite de erros
    "CREATE TABLE IF NOT EXISTS password_resets (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)"
  ].join(';\n') + ';');
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!userColumns.includes('google_sub')) db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
  if (!userColumns.includes('password_set')) db.exec('ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 1');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL');
  // O Google confirmou que o e-mail da conta é da pessoa (o cadastro por senha não confere). A lista de convidados só
  // promove conta existente com isso. Contas antigas: vale para as criadas pelo Google (sem senha definida); as demais
  // ganham ao entrar com um Google do mesmo e-mail.
  if (!userColumns.includes('email_verificado')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verificado INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE users SET email_verificado = 1 WHERE google_sub IS NOT NULL AND password_set = 0');
  }
  // Grupo da pessoa no painel (amigo ou teste); o administrador é o papel (role), não um grupo
  if (!userColumns.includes('grupo')) db.exec("ALTER TABLE users ADD COLUMN grupo TEXT NOT NULL DEFAULT 'amigo' CHECK(grupo IN ('amigo', 'teste'))");
  // Lista de convidados: quem está aqui entra já ativo (sem esperar aprovação) e com o grupo/papel combinado
  db.exec("CREATE TABLE IF NOT EXISTS allowed_emails (email TEXT PRIMARY KEY, grupo TEXT NOT NULL CHECK(grupo IN ('amigo', 'teste', 'admin')), label TEXT NOT NULL DEFAULT '', added_by TEXT NOT NULL, created_at INTEGER NOT NULL)");
  // Para as estatísticas do painel: em que dias cada conta usou o app e o maior número de pessoas online por dia
  db.exec('CREATE TABLE IF NOT EXISTS user_days (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, PRIMARY KEY(user_id, day))');
  db.exec('CREATE TABLE IF NOT EXISTS daily_peak (day TEXT PRIMARY KEY, peak INTEGER NOT NULL)');
  // Feedback e bugs mandados pelo app: respostas e dados técnicos em JSON (já validados), print opcional
  db.exec("CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, tipo TEXT NOT NULL CHECK(tipo IN ('bug', 'ideia', 'nota')), respostas TEXT NOT NULL, tecnico TEXT NOT NULL DEFAULT '{}', contato INTEGER NOT NULL DEFAULT 0, imagem BLOB, imagem_tipo TEXT, status TEXT NOT NULL DEFAULT 'novo' CHECK(status IN ('novo', 'visto', 'resolvido')), created_at INTEGER NOT NULL)");
  db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, created_at)');
  if (!userColumns.includes('bio')) db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('status')) db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending', 'active', 'disabled'))");

  const hashPassword = async (password, salt) => (await scryptAsync(password, salt, 64)).toString('hex');
  const samePassword = async (user, password) => {
    const candidate = await scryptAsync(password, user?.salt || 'razze-invalid-user-salt', 64);
    const stored = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
    return !!user && stored.length === candidate.length && timingSafeEqual(stored, candidate);
  };
  const cleanBio = (value) => {
    if (typeof value !== 'string') throw new ApiError(400, 'invalid_input', 'A frase do perfil precisa ser um texto.');
    const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (Array.from(text).length > BIO_MAX) throw new ApiError(400, 'invalid_input', 'A frase do perfil pode ter até ' + BIO_MAX + ' caracteres.');
    return text;
  };
  const googleClientId = () => String(options.googleClientId ?? process.env.RAZZE_GOOGLE_CLIENT_ID ?? '');
  const googleClientSecret = () => String(options.googleClientSecret ?? process.env.RAZZE_GOOGLE_CLIENT_SECRET ?? '');
  // O client ID do tipo "Aplicativo da web" que o app de Android usa como serverClientId (não é secreto)
  const googleWebClientId = () => String(options.googleWebClientId ?? process.env.RAZZE_GOOGLE_WEB_CLIENT_ID ?? '');
  // Troca o código pelos tokens no Google (por TLS, direto). Nos testes entra uma função no lugar (options.googleExchange).
  const googleExchange = options.googleExchange || (async (p) => {
    const form = new URLSearchParams({ code: p.code, client_id: p.clientId, redirect_uri: p.redirectUri, grant_type: 'authorization_code', code_verifier: p.codeVerifier });
    if (p.clientSecret) form.set('client_secret', p.clientSecret);
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('google ' + response.status);
    return response.json();
  });
  // Valida o pedido e devolve a identidade confirmada pelo Google: { sub, email, name }
  const googleIdentity = async (body) => {
    const clientId = googleClientId();
    if (!clientId) throw new ApiError(503, 'google_disabled', 'Entrar com Google não está ligado neste servidor.');
    const code = assertText(body.code, 'Código', 10, 2048);
    const codeVerifier = assertText(body.codeVerifier, 'Verificador', 43, 128);
    const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : '';
    if (!GOOGLE_REDIRECT_RE.test(redirectUri)) throw new ApiError(400, 'invalid_input', 'Endereço de retorno inválido.');
    let payload;
    try {
      const tokens = await googleExchange({ code, codeVerifier, redirectUri, clientId, clientSecret: googleClientSecret() });
      payload = JSON.parse(Buffer.from(String(tokens.id_token).split('.')[1], 'base64url').toString('utf8'));
    } catch { throw new ApiError(401, 'google_failed', 'Não deu para confirmar o login com o Google. Tente de novo.'); }
    const emailOk = payload.email_verified === true || payload.email_verified === 'true';
    if (!GOOGLE_ISSUERS.includes(payload.iss) || payload.aud !== clientId || !(Number(payload.exp) * 1000 > now())
      || typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !emailOk) {
      throw new ApiError(401, 'google_failed', 'O Google não confirmou essa conta. Tente de novo.');
    }
    return { sub: payload.sub, email: payload.email.trim().toLowerCase(), name: typeof payload.name === 'string' ? payload.name : '' };
  };
  // Chaves públicas do Google (JWKS), guardadas pelo tempo que o Google diz (Cache-Control: max-age). Nos testes entra
  // uma função no lugar (options.googleJwks), que devolve { keys, maxAgeMs }.
  const googleJwks = options.googleJwks || (async () => {
    const response = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('jwks ' + response.status);
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') || '');
    return { keys: (await response.json()).keys, maxAgeMs: maxAge ? Number(maxAge[1]) * 1000 : 60 * 60 * 1000 };
  });
  let jwksCache = { keys: [], until: 0 };
  // kid desconhecido (o Google troca as chaves de tempos em tempos): busca de novo antes de recusar
  const googleKey = async (kid) => {
    const find = () => jwksCache.keys.find((k) => k && k.kid === kid && k.kty === 'RSA');
    if (jwksCache.until > now() && find()) return find();
    try {
      const fresh = await googleJwks();
      jwksCache = {
        keys: Array.isArray(fresh?.keys) ? fresh.keys.slice(0, 20) : [],
        until: now() + Math.min(Math.max(Number(fresh?.maxAgeMs) || 0, 60_000), 24 * 60 * 60 * 1000),
      };
    } catch { throw new ApiError(503, 'google_unavailable', 'Não deu para falar com o Google agora. Tente de novo em instantes.'); }
    return find();
  };
  // Nonces do login do Android: só o hash, em memória, uso único
  const googleNonces = new Map(); // hash -> expira em
  const newGoogleNonce = () => {
    const t = now();
    for (const [key, until] of googleNonces) if (until <= t) googleNonces.delete(key);
    while (googleNonces.size >= GOOGLE_NONCE_MAX) googleNonces.delete(googleNonces.keys().next().value);
    const nonce = randomBytes(32).toString('base64url');
    googleNonces.set(hash(nonce), t + GOOGLE_NONCE_TTL_MS);
    return nonce;
  };
  // Queima o nonce na hora: valendo ou não, não serve de novo
  const useGoogleNonce = (nonce) => {
    if (typeof nonce !== 'string' || !GOOGLE_NONCE_RE.test(nonce)) return false;
    const key = hash(nonce);
    const until = googleNonces.get(key);
    googleNonces.delete(key);
    return !!until && until > now();
  };
  const googleAndroidFail = () => new ApiError(401, 'google_failed', 'O Google não confirmou essa conta. Tente de novo.');
  // Confere o ID token do Android: assinatura RS256 do Google, emissor, cliente (o web client ID), validade, e-mail
  // confirmado e o nonce. Devolve a mesma identidade de googleIdentity: { sub, email, name }
  const googleAndroidIdentity = async (body) => {
    const webClientId = googleWebClientId();
    if (!webClientId) throw new ApiError(503, 'google_disabled', 'Entrar com Google no Android não está ligado neste servidor.');
    const unknown = Object.keys(body).filter((k) => k !== 'idToken' && k !== 'nonce');
    if (unknown.length) throw new ApiError(400, 'invalid_input', 'Campo desconhecido: ' + unknown[0].slice(0, 40) + '.');
    const idToken = typeof body.idToken === 'string' ? body.idToken : '';
    const parts = idToken.split('.');
    if (idToken.length > 4096 || parts.length !== 3 || parts.some((x) => !/^[A-Za-z0-9_-]+$/.test(x))) throw googleAndroidFail();
    let header, payload;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { throw googleAndroidFail(); }
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !payload || typeof payload !== 'object') throw googleAndroidFail();
    const jwk = await googleKey(header.kid);
    let valid = false;
    try {
      valid = !!jwk && verifySignature('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]),
        createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    } catch { valid = false; }
    if (!valid) throw googleAndroidFail();
    // O nonce só é conferido (e queimado) depois da assinatura: um token falso não gasta o nonce de ninguém
    const nonceOk = useGoogleNonce(body.nonce) && payload.nonce === body.nonce;
    const t = Math.floor(now() / 1000);
    const emailOk = payload.email_verified === true || payload.email_verified === 'true';
    if (!nonceOk || !GOOGLE_ISSUERS.includes(payload.iss) || payload.aud !== webClientId
      || !(Number(payload.exp) + GOOGLE_CLOCK_SKEW_S > t) || (payload.iat !== undefined && !(Number(payload.iat) - GOOGLE_CLOCK_SKEW_S <= t))
      || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 || typeof payload.email !== 'string' || !emailOk) {
      throw googleAndroidFail();
    }
    return { sub: payload.sub, email: payload.email.trim().toLowerCase(), name: typeof payload.name === 'string' ? payload.name : '' };
  };
  const activityRate = new Map(); // userId -> { count, resetAt }: no máximo 12 envios por minuto
  const cleanActivity = (value, field) => {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') throw new ApiError(400, 'invalid_input', field + ' precisa ser um texto.');
    const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (Array.from(text).length > ACTIVITY_FIELD_MAX) throw new ApiError(400, 'invalid_input', field + ' pode ter até ' + ACTIVITY_FIELD_MAX + ' caracteres.');
    return text;
  };
  const activityOf = (id) => {
    const a = db.prepare('SELECT game, artist, title, updated_at AS at FROM user_activity WHERE user_id = ?').get(id);
    if (!a || a.at <= now() - ACTIVITY_TTL_MS || (!a.game && !a.artist && !a.title)) return null;
    return { game: a.game, artist: a.artist, title: a.title };
  };
  const publicUser = (id) => {
    const u = db.prepare('SELECT id, email, display_name AS displayName, bio, role, created_at AS createdAt, google_sub AS googleSub, password_set AS passwordSet FROM users WHERE id = ?').get(id);
    if (!u) return null;
    const { googleSub, passwordSet, ...rest } = u;
    return { ...rest, googleLinked: !!googleSub, hasPassword: !!passwordSet };
  };
  const newId = () => randomBytes(16).toString('hex');
  const feedbackTexto = (value, field, max) => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') throw new ApiError(400, 'invalid_input', field + ' precisa ser um texto.');
    // Mantém as quebras de linha (passos numerados); tira os outros caracteres de controle
    const text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (Array.from(text).length > max) throw new ApiError(400, 'invalid_input', field + ' pode ter até ' + max + ' caracteres.');
    return text;
  };
  // Confere cada campo do feedback e devolve só o que vale para o tipo; campo desconhecido é recusado
  const cleanFeedback = (body) => {
    const bad = (m) => { throw new ApiError(400, 'invalid_input', m); };
    const known = ['tipo', 'contato', 'tecnico', 'imagem', 'nota', 'usa', ...Object.keys(FEEDBACK_ESCOLHAS), ...Object.keys(FEEDBACK_TEXTOS)];
    if (Object.keys(body).some((k) => !known.includes(k))) bad('Campo de feedback desconhecido.');
    const tipo = body.tipo;
    if (typeof tipo !== 'string' || !Object.hasOwn(FEEDBACK_OBRIGATORIO, tipo)) bad('Tipo de feedback inválido.');
    const respostas = {};
    for (const [campo, opcoes] of Object.entries(FEEDBACK_ESCOLHAS)) {
      if (body[campo] === undefined || body[campo] === null || body[campo] === '') continue;
      if (!opcoes.includes(body[campo])) bad('Opção inválida em ' + campo + '.');
      respostas[campo] = body[campo];
    }
    for (const [campo, max] of Object.entries(FEEDBACK_TEXTOS)) {
      const text = feedbackTexto(body[campo], campo, max);
      if (text) respostas[campo] = text;
    }
    if (body.nota !== undefined && body.nota !== null) {
      if (!Number.isInteger(body.nota) || body.nota < 0 || body.nota > 10) bad('A nota vai de 0 a 10.');
      respostas.nota = body.nota;
    }
    if (body.usa !== undefined) {
      if (!Array.isArray(body.usa) || body.usa.length > FEEDBACK_USA.length || body.usa.some((u) => !FEEDBACK_USA.includes(u))) bad('Lista do que você usa inválida.');
      if (body.usa.length) respostas.usa = [...new Set(body.usa)];
    }
    for (const campo of FEEDBACK_OBRIGATORIO[tipo]) if (respostas[campo] === undefined) bad('Falta responder ' + campo + '.');
    // Dados técnicos: só texto curto, poucas chaves conhecidas
    const tecnico = {};
    if (body.tecnico !== undefined && body.tecnico !== null) {
      if (typeof body.tecnico !== 'object' || Array.isArray(body.tecnico)) bad('Dados técnicos inválidos.');
      for (const [k, v] of Object.entries(body.tecnico)) {
        if (!['versao', 'sistema', 'tema', 'naSala'].includes(k)) bad('Dado técnico desconhecido.');
        if (k === 'naSala') { if (typeof v !== 'boolean') bad('Dado técnico inválido.'); tecnico.naSala = v; continue; }
        const text = feedbackTexto(v, k, 120).replace(/\n/g, ' ');
        if (text) tecnico[k] = text;
      }
    }
    if (body.contato !== undefined && typeof body.contato !== 'boolean') bad('Contato inválido.');
    let imagem = null, imagemTipo = null;
    if (body.imagem !== undefined && body.imagem !== null && body.imagem !== '') {
      const m = typeof body.imagem === 'string' ? /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.imagem) : null;
      if (!m) bad('O print precisa ser uma imagem JPEG ou PNG.');
      imagem = Buffer.from(m[2], 'base64');
      if (!imagem.length || imagem.length > FEEDBACK_IMAGE_BYTES) bad('O print pode ter até ' + Math.round(FEEDBACK_IMAGE_BYTES / 1024) + ' KB.');
      // Confere a assinatura do arquivo, não só o que o pedido diz
      const jpeg = imagem[0] === 0xff && imagem[1] === 0xd8 && imagem[2] === 0xff;
      const png = imagem.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if ((m[1] === 'image/jpeg' && !jpeg) || (m[1] === 'image/png' && !png)) bad('O print precisa ser uma imagem JPEG ou PNG.');
      imagemTipo = m[1];
    }
    return { tipo, respostas, tecnico, contato: body.contato === true, imagem, imagemTipo };
  };
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const now = options.now || (() => Date.now());
  const authAttempts = new Map();
  const dmRate = new Map(); // userId -> { count, resetAt }: no máximo 30 mensagens a cada 10 s por conta
  const signals = new Map(); // receiverId -> [{ id, from, text, createdAt }]
  const signalRate = new Map(); // userId -> { count, resetAt }: no máximo 30 sinais a cada 10 s por conta
  const dmRow = (r) => ({ seq: r.seq, id: r.id, from: r.senderId, to: r.receiverId, text: r.body, createdAt: r.createdAt });
  const DM_SELECT = 'SELECT seq, id, sender_id AS senderId, receiver_id AS receiverId, body, created_at AS createdAt FROM direct_messages';
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
  // Uma sessão por conta em cada tipo de aparelho: entrar no PC derruba só a sessão de PC anterior; entrar no celular,
  // só a do celular (o PC e o celular da mesma pessoa ficam logados juntos)
  const issueToken = (userId, plataforma = 'pc') => {
    const token = randomBytes(32).toString('base64url');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND plataforma = ?').run(userId, plataforma);
      db.prepare(
        'INSERT INTO sessions(token_hash, user_id, expires_at, plataforma) VALUES(?, ?, ?, ?)'
      ).run(
        hash(token),
        userId,
        now() + (options.tokenTtlMs || TOKEN_TTL_MS),
        plataforma
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return token;
  };
  // A conta de quem o Google confirmou, igual para o PC (código) e o Android (ID token): acha pelo google_sub, cria a
  // conta se o e-mail é novo (lista de convidados, aprovação) e não junta sozinho com conta de senha do mesmo e-mail
  const entrarPeloGoogle = async (identity, plataforma) => {
    let user = db.prepare('SELECT id, status FROM users WHERE google_sub = ?').get(identity.sub);
    if (!user) {
      if (db.prepare('SELECT 1 AS yes FROM users WHERE email = ?').get(identity.email)) {
        // Não junta sozinho: quem criou a conta com esse e-mail pode não ser o dono dele. Entra com a senha e vincula;
        // com a senha desligada (googleOnly sem legacyPasswordLogin) só o administrador destrava.
        const semSenha = control.settings().googleOnly && !control.settings().legacyPasswordLogin;
        throw new ApiError(409, 'account_exists', 'Já existe uma conta com o e-mail ' + identity.email + '. ' + (semSenha
          ? 'Ela ainda não foi ligada ao Google. Peça ao administrador para liberar a entrada por senha; aí você entra com ela e vincula o Google em Conta.'
          : 'Entre com a senha e vincule o Google em Conta.'));
      }
      const convidado = db.prepare('SELECT grupo FROM allowed_emails WHERE email = ?').get(identity.email);
      if (!convidado && control.settings().onlyAllowlist) throw new ApiError(403, 'not_allowed', 'Este e-mail não está na lista de convidados. Peça ao administrador para te adicionar.');
      if (!convidado && !control.settings().registrationOpen) throw new ApiError(403, 'registration_closed', 'Novos cadastros estão desativados.');
      const id = newId();
      const salt = randomBytes(16).toString('hex');
      const unusable = randomBytes(32).toString('hex'); // senha que ninguém conhece: a conta só entra pelo Google até definir uma
      const displayName = (identity.name.replace(/\s+/g, ' ').trim() || identity.email.split('@')[0]).slice(0, 60) || 'Usuário';
      const requiresApproval = control.settings().requireApproval && !convidado; // quem está na lista de convidados entra direto
      db.prepare('INSERT INTO users(id, email, display_name, password_salt, password_hash, status, google_sub, password_set, email_verificado, role, grupo, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)')
        .run(id, identity.email, displayName, salt, await hashPassword(unusable, salt), requiresApproval ? 'pending' : 'active', identity.sub,
          convidado?.grupo === 'admin' ? 'admin' : 'user', convidado && convidado.grupo !== 'admin' ? convidado.grupo : 'amigo', now());
      if (requiresApproval) return { status: 202, value: { user: publicUser(id), status: 'pending_approval' } };
      return { status: 201, value: { user: publicUser(id), status: 'active', accessToken: issueToken(id, plataforma) } };
    }
    db.prepare('UPDATE users SET email_verificado = 1 WHERE id = ? AND email = ?').run(user.id, identity.email);
    if (user.status === 'pending') throw new ApiError(403, 'account_pending', 'Sua conta aguarda aprovação do servidor.');
    if (user.status !== 'active') throw new ApiError(403, 'account_disabled', 'Esta conta está desativada.');
    return { status: 200, value: { user: publicUser(user.id), accessToken: issueToken(user.id, plataforma) } };
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
  const readBody = async (req, max = MAX_BODY_BYTES) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      req.bodyBytes = size;
      if (size > max) throw new ApiError(413, 'body_too_large', 'A requisição excede o limite permitido.');
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
  // Aceita o segredo (token) ou o código curto digitado pela pessoa (com ou sem hífen, qualquer caixa)
  const friendLinkKey = (value) => {
    const raw = String(value ?? '').trim();
    if (FRIEND_LINK_TOKEN_RE.test(raw)) return hash(raw);
    const code = raw.replace(/[\s-]/g, '').toUpperCase();
    if (code.length === FRIEND_CODE_LENGTH && [...code].every((ch) => FRIEND_CODE_ALPHABET.includes(ch))) return hash(code);
    return '';
  };
  const friendLinkRow = (key) => (key ? db.prepare('SELECT id, user_id AS userId, expires_at AS expiresAt, max_uses AS maxUses, uses, revoked FROM friend_links WHERE token_hash = ? OR code_hash = ?').get(key, key) : null);
  const newFriendCode = () => {
    let out = '';
    while (out.length < FRIEND_CODE_LENGTH) {
      const [x] = randomBytes(1);
      if (x < 248) out += FRIEND_CODE_ALPHABET[x % FRIEND_CODE_ALPHABET.length]; // 248 = 8 x 31: sem viés
    }
    return out;
  };
  const publicBase = (req) => {
    const fixed = options.publicUrl || process.env.RAZZE_PUBLIC_URL;
    if (fixed) return String(fixed).replace(/\/+$/, '');
    const host = String(req.headers.host || '');
    if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return '';
    const proto = process.env.RAZZE_TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    return proto + '://' + host;
  };
  const friendLinkPage = (token) => {
    const download = String(options.downloadUrl || process.env.RAZZE_DOWNLOAD_URL || DEFAULT_DOWNLOAD_URL).replace(/[<>"']/g, '');
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<meta name="referrer" content="no-referrer"><title>Convite de amigo · Tela P2P</title>'
      + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0D10;color:#D7DCE3;font:16px/1.5 system-ui,sans-serif}'
      + 'main{width:min(420px,90vw);padding:28px;border:1px solid #232932;border-radius:14px;background:#13161B;text-align:center}'
      + 'h1{font-size:22px;margin:0 0 8px}p{color:#9A9EA4;margin:0 0 20px}a{display:block;padding:12px;border-radius:10px;margin-top:10px;text-decoration:none;font-weight:600}'
      + '.p{background:#7FA3C7;color:#0B0D10}.s{border:1px solid #3E444D;color:#D7DCE3}</style></head><body><main>'
      + '<h1>Você recebeu um convite de amigo</h1><p>Abra no Tela P2P para aceitar.</p>'
      + '<a class="p" href="telap2p://amigo/' + token + '">Abrir no Tela P2P</a>'
      + '<a class="s" href="' + download + '">Baixar o Tela P2P</a></main></body></html>';
  };
  const canViewNetwork = (network, userId) => network.ownerId === userId || isMember(network.id, userId)
    || network.visibility === 'public' || (network.visibility === 'friends' && friendshipExists(network.ownerId, userId));
  const requireOwner = (network, userId) => {
    if (!network) throw new ApiError(404, 'not_found', 'Rede não encontrada.');
    if (network.ownerId !== userId) throw new ApiError(403, 'forbidden', 'Somente o dono pode alterar esta rede.');
  };

  const control = createControl({ db, options, now, hash, requireUser, readBody, send, ApiError, isMember, friendshipExists });
  const handler = async (req, res) => {
    try {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { throw new ApiError(400, 'invalid_path', 'Endereço da requisição inválido.'); }
      const method = req.method || 'GET';
      if (control.serveAdmin(req, res, pathname)) return;

      // Página de abertura do convite de amigo: sem login, sem consultar o banco (não confirma se o link existe) e sem script
      const linkPage = method === 'GET' ? /^\/a\/([A-Za-z0-9_-]{20,120})$/.exec(pathname) : null;
      if (linkPage) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        });
        return res.end(friendLinkPage(linkPage[1]));
      }
      if (method === 'GET' && pathname.startsWith('/a/')) throw new ApiError(404, 'not_found', 'Página não encontrada.');

      if (method === 'GET' && pathname === '/v1/health') return send(res, 200, { ok: true, service: 'razze-api', stun: stunServer?.address() ? { port: stunServer.address().port, protocol: 'udp' } : null });

      if (method === 'POST' && pathname === '/v1/auth/register') {
        if (control.settings().googleOnly) throw new ApiError(403, 'google_only', 'Este servidor só aceita conta pelo Google. Use "Entrar com Google".');
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
        const user = db.prepare('SELECT id, status, role, password_salt AS salt, password_hash AS passwordHash FROM users WHERE email = ?').get(email);
        // Só Google: a senha continua valendo para o administrador (o painel /admin/ entra por ela)
        if (control.settings().googleOnly && !control.settings().legacyPasswordLogin && user?.role !== 'admin') throw new ApiError(403, 'google_only', 'Este servidor só aceita entrar pelo Google. Use "Entrar com Google".');
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

      if (method === 'GET' && pathname === '/v1/auth/google/config') return send(res, 200, { enabled: !!googleClientId(), clientId: googleClientId(), webClientId: googleWebClientId(), googleOnly: !!control.settings().googleOnly, passwordLogin: !!control.settings().legacyPasswordLogin });
      if (method === 'POST' && pathname === '/v1/auth/google') {
        const failed = enforceAuthLimit(req, 'google', 10, 10 * 60 * 1000);
        const body = await readBody(req);
        let identity;
        try { identity = await googleIdentity(body); } catch (error) { if (error.status !== 503) failed(); throw error; }
        const result = await entrarPeloGoogle(identity, 'pc');
        return send(res, result.status, result.value);
      }
      // Android: o nonce antes de abrir a folha de contas do Google, e depois o ID token com ele
      if (method === 'GET' && pathname === '/v1/auth/google/nonce') {
        if (!googleWebClientId()) throw new ApiError(503, 'google_disabled', 'Entrar com Google no Android não está ligado neste servidor.');
        enforceAuthLimit(req, 'google-nonce', 30, 10 * 60 * 1000)();
        return send(res, 200, { nonce: newGoogleNonce() });
      }
      if (method === 'POST' && pathname === '/v1/auth/google/android') {
        const failed = enforceAuthLimit(req, 'google', 10, 10 * 60 * 1000);
        const body = await readBody(req, GOOGLE_ANDROID_BODY_BYTES);
        let identity;
        try { identity = await googleAndroidIdentity(body); } catch (error) { if (error.status !== 503) failed(); throw error; }
        const result = await entrarPeloGoogle(identity, 'android');
        return send(res, result.status, result.value);
      }

      // Esqueci a senha: o administrador gera um código de uso único (válido por 1 h) e a pessoa define a senha nova com ele
      if (method === 'POST' && pathname === '/v1/auth/reset') {
        const failed = enforceAuthLimit(req, 'reset', 10, 15 * 60 * 1000);
        const body = await readBody(req);
        const email = assertText(body.email, 'E-mail', 3, 254).toLowerCase();
        const code = String(body.code ?? '').replace(/[\s-]/g, '').toUpperCase();
        const password = assertText(body.password, 'Senha', 8, 200);
        const user = db.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").get(email);
        const row = user ? db.prepare('SELECT code_hash AS codeHash, expires_at AS expiresAt, attempts FROM password_resets WHERE user_id = ?').get(user.id) : null;
        const invalid = () => { failed(); return new ApiError(400, 'reset_invalid', 'Código inválido ou expirado. Peça outro ao administrador.'); };
        if (!row || row.expiresAt <= now() || row.attempts >= RESET_MAX_ATTEMPTS) {
          if (row) db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
          throw invalid();
        }
        const given = Buffer.from(hash(code), 'hex');
        const wanted = Buffer.from(row.codeHash, 'hex');
        if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
          db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = ?').run(user.id);
          throw invalid();
        }
        const salt = randomBytes(16).toString('hex');
        const passwordHash = await hashPassword(password, salt);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE users SET password_salt = ?, password_hash = ?, password_set = 1 WHERE id = ?').run(salt, passwordHash, user.id);
          db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(res, 200, { ok: true });
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
        return send(res, 200, { rooms: control.rooms(userId, networkId), internet: control.friendRooms(userId) });
      }
      if (method === 'GET' && pathname === '/v1/me') return send(res, 200, { user: publicUser(userId) });
      if (method === 'PATCH' && pathname === '/v1/me') {
        const body = await readBody(req);
        if (!Object.keys(body).length || Object.keys(body).some((k) => k !== 'bio')) throw new ApiError(400, 'invalid_input', 'Só a frase do perfil (bio) pode ser alterada aqui.');
        db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(cleanBio(body.bio), userId);
        return send(res, 200, { user: publicUser(userId) });
      }
      if (method === 'PUT' && pathname === '/v1/me/activity') {
        const timestamp = now();
        let rate = activityRate.get(userId);
        if (!rate || rate.resetAt <= timestamp) rate = { count: 0, resetAt: timestamp + 60_000 };
        if (++rate.count > 12) throw new ApiError(429, 'rate_limited', 'Muitas atualizações de atividade. Aguarde um pouco.');
        activityRate.set(userId, rate);
        const body = await readBody(req);
        if (Object.keys(body).some((k) => !['game', 'artist', 'title'].includes(k))) throw new ApiError(400, 'invalid_input', 'Campos de atividade inválidos.');
        const game = cleanActivity(body.game, 'Jogo');
        const artist = cleanActivity(body.artist, 'Artista');
        const title = cleanActivity(body.title, 'Faixa');
        if (!game && !artist && !title) db.prepare('DELETE FROM user_activity WHERE user_id = ?').run(userId);
        else db.prepare('INSERT INTO user_activity(user_id, game, artist, title, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET game=excluded.game, artist=excluded.artist, title=excluded.title, updated_at=excluded.updated_at').run(userId, game, artist, title, timestamp);
        return send(res, 200, { ok: true });
      }
      if (method === 'POST' && pathname === '/v1/me/google') {
        const failed = enforceAuthLimit(req, 'google', 10, 10 * 60 * 1000);
        const body = await readBody(req);
        let identity;
        try { identity = await googleIdentity(body); } catch (error) { if (error.status !== 503) failed(); throw error; }
        const other = db.prepare('SELECT id FROM users WHERE google_sub = ? AND id <> ?').get(identity.sub, userId);
        if (other) throw new ApiError(409, 'google_taken', 'Essa conta do Google já está ligada a outra conta.');
        // Vincular um Google de outro e-mail não confirma o e-mail da conta
        db.prepare('UPDATE users SET google_sub = ?, email_verificado = CASE WHEN email = ? THEN 1 ELSE email_verificado END WHERE id = ?').run(identity.sub, identity.email, userId);
        return send(res, 200, { user: publicUser(userId) });
      }
      if (method === 'DELETE' && pathname === '/v1/me/google') {
        const u = db.prepare('SELECT google_sub AS googleSub, password_set AS passwordSet FROM users WHERE id = ?').get(userId);
        if (!u.googleSub) return send(res, 200, { user: publicUser(userId) });
        if (!u.passwordSet) throw new ApiError(400, 'no_password', 'Defina uma senha antes de desvincular o Google, senão você perde o acesso.');
        db.prepare('UPDATE users SET google_sub = NULL WHERE id = ?').run(userId);
        return send(res, 200, { user: publicUser(userId) });
      }
      if (method === 'POST' && pathname === '/v1/me/password') {
        const failed = enforceAuthLimit(req, 'password', 10, 15 * 60 * 1000);
        const body = await readBody(req);
        const next = assertText(body.newPassword, 'Senha nova', 8, 200);
        const user = db.prepare('SELECT id, password_set AS passwordSet, password_salt AS salt, password_hash AS passwordHash FROM users WHERE id = ?').get(userId);
        if (user.passwordSet) { // quem só entra pelo Google (sem senha ainda) define a primeira sem a atual
          const current = assertText(body.currentPassword, 'Senha atual', 1, 200);
          if (!(await samePassword(user, current))) { failed(); throw new ApiError(401, 'invalid_credentials', 'A senha atual está incorreta.'); }
        }
        const salt = randomBytes(16).toString('hex');
        const passwordHash = await hashPassword(next, salt);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE users SET password_salt = ?, password_hash = ?, password_set = 1 WHERE id = ?').run(salt, passwordHash, userId);
          db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, req.authSessionHash);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(res, 200, { ok: true });
      }
      if (method === 'POST' && pathname === '/v1/auth/logout') {
        const token = /^Bearer ([A-Za-z0-9_-]{30,})$/.exec(String(req.headers.authorization || ''))?.[1];
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
        return send(res, 200, { ok: true });
      }

      // Feedback e bugs: precisa estar logado; até 5 por hora e 20 por dia por conta (contado no banco)
      if (method === 'POST' && pathname === '/v1/feedback') {
        const timestamp = now();
        const enviados = (desde) => db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at > ?').get(userId, timestamp - desde).n;
        if (enviados(60 * 60 * 1000) >= FEEDBACK_POR_HORA || enviados(24 * 60 * 60 * 1000) >= FEEDBACK_POR_DIA) {
          throw new ApiError(429, 'rate_limited', 'Você já mandou bastante feedback por agora. Tente de novo mais tarde.');
        }
        const f = cleanFeedback(await readBody(req, FEEDBACK_BODY_BYTES));
        const id = newId();
        db.prepare('INSERT INTO feedback(id, user_id, tipo, respostas, tecnico, contato, imagem, imagem_tipo, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, userId, f.tipo, JSON.stringify(f.respostas), JSON.stringify(f.tecnico), f.contato ? 1 : 0, f.imagem, f.imagemTipo, timestamp);
        return send(res, 201, { ok: true, id });
      }

      if (method === 'GET' && pathname === '/v1/friends') {
        const rows = db.prepare(
          "SELECT DISTINCT u.id, u.email, u.display_name AS displayName, u.bio AS bio, k.public_key AS dmKey FROM friend_requests f JOIN users u ON (u.id = f.sender_id AND f.receiver_id = ?) OR (u.id = f.receiver_id AND f.sender_id = ?) LEFT JOIN dm_keys k ON k.user_id = u.id WHERE f.status = 'accepted' ORDER BY u.display_name COLLATE NOCASE"
        ).all(userId, userId);
        const salas = control.salasAtuais(); // em que sala cada amigo online está (sem endereço; docs/spec/sala-do-amigo.md)
        return send(res, 200, { friends: control.enrichUsers(rows.map((r) => ({ ...r, dmKey: r.dmKey || null, activity: activityOf(r.id), sala: salas.get(r.id) || null }))) });
      }
      // Chave pública das mensagens criptografadas (a privada nunca sai do PC); os amigos recebem em /v1/friends
      if (method === 'PUT' && pathname === '/v1/me/dm-key') {
        const body = await readBody(req);
        const key = String(body.publicKey || '');
        if (!DM_KEY_RE.test(key) || Buffer.from(key, 'base64').length !== 32) throw new ApiError(400, 'invalid_input', 'Chave pública inválida.');
        db.prepare('INSERT INTO dm_keys(user_id, public_key, updated_at) VALUES(?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET public_key = excluded.public_key, updated_at = excluded.updated_at').run(userId, key, now());
        return send(res, 200, { ok: true });
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
        // Pela conta (userId: o Adicionar do perfil de quem está na sala), pelo nickname ou pelo e-mail
        const byId = typeof body.userId === 'string' && /^[a-f0-9]{32}$/.test(body.userId) ? body.userId : '';
        const nickname = byId ? '' : String(body.nickname || '').trim();
        const targetName = byId || (nickname
          ? assertText(nickname, 'Nickname', 1, 60)
          : assertText(body.email, 'E-mail', 3, 254).toLowerCase());
        const matches = byId
          ? [db.prepare('SELECT id FROM users WHERE id = ? AND status = \'active\'').get(byId)].filter(Boolean)
          : nickname
            ? db.prepare('SELECT id FROM users WHERE display_name = ? COLLATE NOCASE AND status = \'active\'').all(targetName)
            : [db.prepare('SELECT id FROM users WHERE email = ? AND status = \'active\'').get(targetName)].filter(Boolean);
        if (!matches.length) throw new ApiError(404, 'user_not_found', byId ? 'Essa conta não existe mais ou está desativada.' : `Não existe uma conta ativa com o nickname “${targetName}”.`);
        if (matches.length > 1) throw new ApiError(409, 'nickname_ambiguous', 'Esse nickname pertence a mais de uma conta. Peça à pessoa para escolher um nickname único.');
        const target = matches[0];
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
      match = /^\/v1\/friends\/requests\/([a-f0-9]{32})$/.exec(pathname);
      if (method === 'DELETE' && match) {
        const result = db.prepare("DELETE FROM friend_requests WHERE id = ? AND sender_id = ? AND status = 'pending'").run(match[1], userId);
        if (!result.changes) throw new ApiError(404, 'request_not_found', 'Pedido enviado não encontrado ou já respondido.');
        return send(res, 200, { ok: true });
      }
      match = /^\/v1\/friends\/([a-f0-9]{32})$/.exec(pathname);
      if (method === 'DELETE' && match) {
        db.prepare("DELETE FROM friend_requests WHERE status = 'accepted' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))")
          .run(userId, match[1], match[1], userId);
        return send(res, 200, { ok: true });
      }

      // Links de amigo: criar, listar, revogar, ver quem convidou e aceitar
      if (method === 'POST' && pathname === '/v1/friends/links') {
        db.prepare('DELETE FROM friend_links WHERE expires_at < ?').run(now() - 30 * 24 * 60 * 60 * 1000);
        const active = db.prepare('SELECT COUNT(*) AS n FROM friend_links WHERE user_id = ? AND revoked = 0 AND expires_at > ? AND uses < max_uses').get(userId, now()).n;
        if (active >= FRIEND_LINK_MAX_ACTIVE) throw new ApiError(409, 'too_many_links', 'Você já tem ' + FRIEND_LINK_MAX_ACTIVE + ' links ativos. Revogue algum antes de criar outro.');
        const token = randomBytes(24).toString('base64url');
        const code = newFriendCode();
        const id = newId();
        const createdAt = now();
        db.prepare('INSERT INTO friend_links(id, user_id, token_hash, code_hash, expires_at, max_uses, created_at) VALUES(?, ?, ?, ?, ?, 1, ?)')
          .run(id, userId, hash(token), hash(code), createdAt + FRIEND_LINK_TTL_MS, createdAt);
        const base = publicBase(req);
        return send(res, 201, {
          id, token, code: code.slice(0, 4) + '-' + code.slice(4, 8) + '-' + code.slice(8), expiresAt: createdAt + FRIEND_LINK_TTL_MS, maxUses: 1,
          url: base ? base + '/a/' + token : '', appLink: 'telap2p://amigo/' + token
        });
      }
      if (method === 'GET' && pathname === '/v1/friends/links') {
        return send(res, 200, { links: db.prepare('SELECT id, expires_at AS expiresAt, max_uses AS maxUses, uses, created_at AS createdAt FROM friend_links WHERE user_id = ? AND revoked = 0 AND expires_at > ? AND uses < max_uses ORDER BY created_at DESC').all(userId, now()) });
      }
      let linkMatch = /^\/v1\/friends\/links\/([a-f0-9]{32})$/.exec(pathname);
      if (method === 'DELETE' && linkMatch) {
        const result = db.prepare('UPDATE friend_links SET revoked = 1 WHERE id = ? AND user_id = ?').run(linkMatch[1], userId);
        if (!result.changes) throw new ApiError(404, 'link_not_found', 'Link não encontrado.');
        return send(res, 200, { ok: true });
      }
      if (method === 'GET' && pathname === '/v1/friends/links/preview') {
        const fail = enforceAuthLimit(req, 'friendlink', 30, 10 * 60 * 1000);
        const link = friendLinkRow(friendLinkKey(new URL(req.url, 'http://localhost').searchParams.get('token')));
        if (!link || link.revoked || link.expiresAt <= now()) { fail(); throw new ApiError(404, 'link_invalid', 'Este convite expirou ou não está mais disponível.'); }
        const owner = publicUser(link.userId);
        const already = friendshipExists(userId, link.userId);
        if (!already && link.uses >= link.maxUses) { fail(); throw new ApiError(404, 'link_invalid', 'Este convite expirou ou não está mais disponível.'); }
        return send(res, 200, { displayName: owner.displayName, own: link.userId === userId, alreadyFriends: already });
      }
      if (method === 'POST' && pathname === '/v1/friends/links/accept') {
        const fail = enforceAuthLimit(req, 'friendlink', 30, 10 * 60 * 1000);
        const body = await readBody(req);
        const key = friendLinkKey(body.token);
        db.exec('BEGIN IMMEDIATE');
        try {
          const link = friendLinkRow(key);
          const owner = link ? db.prepare("SELECT id, display_name AS displayName FROM users WHERE id = ? AND status = 'active'").get(link.userId) : null;
          if (!link || !owner || link.revoked || link.expiresAt <= now()) { fail(); throw new ApiError(404, 'link_invalid', 'Este convite expirou ou não está mais disponível.'); }
          if (owner.id === userId) throw new ApiError(400, 'own_link', 'Este é o seu próprio convite. Mande para um amigo.');
          if (!friendshipExists(userId, owner.id)) {
            if (link.uses >= link.maxUses) { fail(); throw new ApiError(404, 'link_invalid', 'Este convite expirou ou não está mais disponível.'); }
            db.prepare("DELETE FROM friend_requests WHERE status = 'pending' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))").run(userId, owner.id, owner.id, userId);
            db.prepare('INSERT INTO friend_requests(id, sender_id, receiver_id, status, created_at) VALUES(?, ?, ?, ?, ?)').run(newId(), owner.id, userId, 'accepted', now());
            db.prepare('UPDATE friend_links SET uses = uses + 1 WHERE id = ?').run(link.id);
          }
          db.exec('COMMIT');
          return send(res, 200, { status: 'accepted', friend: { id: owner.id, displayName: owner.displayName } });
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }

      // Mensagens diretas: mandar só para amigos; buscar as novas pelo número de sequência (after)
      if (method === 'POST' && pathname === '/v1/messages') {
        const body = await readBody(req);
        const to = String(body.to || '');
        if (!/^[a-f0-9]{32}$/.test(to)) throw new ApiError(400, 'invalid_input', 'Destinatário inválido.');
        if (to === userId || !friendshipExists(userId, to)) throw new ApiError(403, 'not_friends', 'Só dá para mandar mensagem para amigos.');
        const e2e = typeof body.text === 'string' && DM_E2E_RE.test(body.text);
        const text = assertText(body.text, 'Mensagem', 1, e2e ? DM_MAX_E2E : DM_MAX_TEXT);
        const timestamp = now();
        let rate = dmRate.get(userId);
        if (!rate || rate.resetAt <= timestamp) rate = { count: 0, resetAt: timestamp + 10_000 };
        if (rate.count >= 30) throw new ApiError(429, 'rate_limited', 'Muitas mensagens seguidas. Espere alguns segundos.');
        rate.count++;
        dmRate.set(userId, rate);
        if (dmRate.size > 10_000) for (const [key, item] of dmRate) if (item.resetAt <= timestamp) dmRate.delete(key);
        db.prepare('DELETE FROM direct_messages WHERE created_at < ?').run(timestamp - DM_KEEP_MS);
        const id = newId();
        db.prepare('INSERT INTO direct_messages(id, sender_id, receiver_id, body, created_at) VALUES(?, ?, ?, ?, ?)').run(id, userId, to, text, timestamp);
        return send(res, 201, { message: dmRow(db.prepare(DM_SELECT + ' WHERE id = ?').get(id)) });
      }
      if (method === 'GET' && pathname === '/v1/messages') {
        const after = Math.max(0, Math.floor(Number(new URL(req.url, 'http://localhost').searchParams.get('after')) || 0));
        const rows = db.prepare(DM_SELECT + ' WHERE seq > ? AND (receiver_id = ? OR sender_id = ?) AND created_at >= ? ORDER BY seq LIMIT ?')
          .all(after, userId, userId, now() - DM_KEEP_MS, DM_PAGE + 1);
        return send(res, 200, { messages: rows.slice(0, DM_PAGE).map(dmRow), more: rows.length > DM_PAGE });
      }

      // Sinais da conexão direta: só entre amigos, sempre cifrados (e2e1:), entregues uma vez
      if (method === 'POST' && pathname === '/v1/signals') {
        const body = await readBody(req);
        const to = String(body.to || '');
        if (!/^[a-f0-9]{32}$/.test(to)) throw new ApiError(400, 'invalid_input', 'Destinatário inválido.');
        if (to === userId || !friendshipExists(userId, to)) throw new ApiError(403, 'not_friends', 'Só dá para mandar sinal para amigos.');
        if (typeof body.text !== 'string' || !DM_E2E_RE.test(body.text) || body.text.length > SIGNAL_MAX) throw new ApiError(400, 'invalid_input', 'Sinal inválido.');
        const timestamp = now();
        let rate = signalRate.get(userId);
        if (!rate || rate.resetAt <= timestamp) rate = { count: 0, resetAt: timestamp + 10_000 };
        if (rate.count >= 30) throw new ApiError(429, 'rate_limited', 'Muitos sinais seguidos. Espere alguns segundos.');
        rate.count++;
        signalRate.set(userId, rate);
        if (signalRate.size > 10_000) for (const [key, item] of signalRate) if (item.resetAt <= timestamp) signalRate.delete(key);
        const queue = (signals.get(to) || []).filter((x) => x.createdAt > timestamp - SIGNAL_TTL_MS);
        if (queue.length >= SIGNAL_QUEUE) queue.shift();
        const id = newId();
        queue.push({ id, from: userId, text: body.text, createdAt: timestamp });
        signals.set(to, queue);
        if (signals.size > 10_000) for (const [key, list] of signals) if (!list.some((x) => x.createdAt > timestamp - SIGNAL_TTL_MS)) signals.delete(key);
        return send(res, 201, { id });
      }
      if (method === 'GET' && pathname === '/v1/signals') {
        const timestamp = now();
        const queue = (signals.get(userId) || []).filter((x) => x.createdAt > timestamp - SIGNAL_TTL_MS && friendshipExists(userId, x.from));
        signals.delete(userId);
        return send(res, 200, { signals: queue.map(({ id, from, text, createdAt }) => ({ id, from, to: userId, text, createdAt })) });
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
