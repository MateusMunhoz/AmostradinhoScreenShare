'use strict';
// Mensagens diretas criptografadas de ponta a ponta. Fica no processo principal, entre a janela e a RazzeAPI:
// a janela manda e recebe texto normal pelo IPC; aqui o texto é cifrado antes de ir para o servidor e decifrado
// ao chegar. A chave privada nunca sai deste processo (nem para a janela, nem para o servidor).
//
// - Cada conta, em cada PC, tem um par X25519 em mensagens/<conta>/chave.json; a privada guardada com o
//   safeStorage (a proteção da conta do Windows, como o login do Razze). A pública vai para a RazzeAPI
//   (PUT /v1/me/dm-key), que entrega aos amigos em /v1/friends.
// - Mensagem: ECDH(minha privada, pública do amigo) → HKDF-SHA256 (sal aleatório, contas no "info") → AES-256-GCM.
//   Formato: "e2e1:" + base64url de [versão 1][pública de quem manda 32][pública de quem recebe 32][sal 16][iv 12]
//   [texto cifrado][tag 16]. O cabeçalho vai como dado autenticado. Quem mandou também abre a própria mensagem
//   (o mesmo segredo do ECDH), então as enviadas voltam do servidor legíveis neste PC.
// - Chave do amigo fixada na primeira vez (TOFU): se mudar (PC novo, reinstalou ou um servidor trocando chaves),
//   a mensagem vem com keyChanged e a conversa avisa.
// - Amigo sem chave (app antigo): a mensagem não sai; o erro pede para ele atualizar.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { RazzeApiError } = require('./razze-api-client');

const ID = /^[a-f0-9]{32}$/;
const PREFIX = 'e2e1:';
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const SPKI = Buffer.from('302a300506032b656e032100', 'hex'); // cabeçalho DER de uma pública X25519
const HEAD = 1 + 32 + 32 + 16 + 12;

const rawToPublic = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' });
const publicToRaw = (key) => key.export({ format: 'der', type: 'spki' }).subarray(-32);
const infoOf = (from, to) => Buffer.from(`telap2p-dm-v1|${from}|${to}`);
function aesKey(privateKey, peerRaw, salt, from, to) {
  const shared = crypto.diffieHellman({ privateKey, publicKey: rawToPublic(peerRaw) });
  return Buffer.from(crypto.hkdfSync('sha256', shared, salt, infoOf(from, to), 32));
}

// Cifra para quem recebe (myRaw: a minha pública; toRaw: a do amigo)
function seal({ privateKey, myRaw, toRaw, from, to, text }) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const head = Buffer.concat([Buffer.from([1]), myRaw, toRaw, salt, iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(privateKey, toRaw, salt, from, to), iv);
  cipher.setAAD(head);
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return PREFIX + Buffer.concat([head, body]).toString('base64url');
}

// Abre uma mensagem em que eu (me, com myRaw) sou quem recebe ou quem mandou. null se não der (outra chave, mexida)
function open({ privateKey, myRaw, me, from, to, payload }) {
  if (!String(payload).startsWith(PREFIX)) return null;
  const buf = Buffer.from(String(payload).slice(PREFIX.length), 'base64url');
  if (buf.length < HEAD + 16 || buf[0] !== 1) return null;
  const senderRaw = buf.subarray(1, 33), recipientRaw = buf.subarray(33, 65);
  const salt = buf.subarray(65, 81), iv = buf.subarray(81, HEAD);
  const mine = from === me;
  if (!(mine ? senderRaw : recipientRaw).equals(myRaw)) return { locked: true, senderRaw };
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey(privateKey, mine ? recipientRaw : senderRaw, salt, from, to), iv);
    decipher.setAAD(buf.subarray(0, HEAD));
    decipher.setAuthTag(buf.subarray(buf.length - 16));
    const text = Buffer.concat([decipher.update(buf.subarray(HEAD, buf.length - 16)), decipher.final()]).toString('utf8');
    return { text, senderRaw };
  } catch { return { locked: true, senderRaw }; }
}

// O par de chaves de uma conta neste PC, e as chaves fixadas dos amigos
function createKeyStore(baseDir, storage) {
  const cache = new Map();
  const fileOf = (account) => {
    if (!ID.test(String(account))) throw new Error('Conta inválida.');
    return path.join(baseDir, account, 'chave.json');
  };
  const sealedOk = () => { try { return !!storage?.isEncryptionAvailable(); } catch { return false; } };
  function write(account, entry) {
    const file = fileOf(account);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const pkcs8 = entry.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const sealed = sealedOk();
    const data = { publicKey: entry.myRaw.toString('base64'), sealed, privateKey: sealed ? storage.encryptString(pkcs8).toString('base64') : pkcs8, amigos: entry.amigos };
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  function get(account) {
    if (cache.has(account)) return cache.get(account);
    let entry = null;
    try {
      const data = JSON.parse(fs.readFileSync(fileOf(account), 'utf8'));
      const pkcs8 = data.sealed ? storage.decryptString(Buffer.from(data.privateKey, 'base64')) : data.privateKey;
      const privateKey = crypto.createPrivateKey({ key: Buffer.from(pkcs8, 'base64'), format: 'der', type: 'pkcs8' });
      const amigos = data.amigos && typeof data.amigos === 'object' ? Object.fromEntries(Object.entries(data.amigos).filter(([k, v]) => ID.test(k) && KEY_RE.test(String(v)))) : {};
      entry = { privateKey, myRaw: publicToRaw(crypto.createPublicKey(privateKey)), amigos };
    } catch {}
    if (!entry) { // primeira vez (ou o arquivo não abre mais neste usuário do Windows): chave nova
      const { privateKey } = crypto.generateKeyPairSync('x25519');
      entry = { privateKey, myRaw: publicToRaw(crypto.createPublicKey(privateKey)), amigos: {} };
      write(account, entry);
    }
    cache.set(account, entry);
    return entry;
  }
  // Fixa a chave do amigo; true se ela mudou desde a última vez
  function pin(account, friend, keyB64) {
    const entry = get(account);
    const before = entry.amigos[friend];
    if (before === keyB64) return false;
    entry.amigos[friend] = keyB64;
    write(account, entry);
    return !!before;
  }
  return { get, pin };
}

function createDmE2E({ baseDir, storage, service }) {
  const keys = createKeyStore(baseDir, storage);
  let account = '', published = '', serverOld = false;

  async function me() {
    if (account) return account;
    const res = await service.me();
    const id = String(res?.user?.id || '');
    if (!ID.test(id)) throw new RazzeApiError(0, 'no_account', 'Entre na sua conta Razze.');
    account = id;
    return id;
  }
  // Publica a minha chave uma vez por conta (e de novo se ela mudar); servidor antigo: só lembra
  async function ensurePublished() {
    const acct = await me();
    const k = keys.get(acct);
    const tag = `${service.state?.().baseUrl || ''}|${acct}|${k.myRaw.toString('base64')}`;
    if (published === tag) return { acct, k };
    try { await service.api().setDmKey(k.myRaw.toString('base64')); serverOld = false; }
    catch (e) { if (e.status === 404) serverOld = true; else throw e; }
    published = tag;
    return { acct, k };
  }
  // A chave atual do amigo, buscada a cada envio: se ele trocou de PC, a mensagem já vai para a chave nova
  async function friendInfo(id) {
    const res = await service.listFriends();
    return (res.friends || []).find((f) => f.id === id) || null;
  }

  async function send(to, text) {
    const { acct, k } = await ensurePublished();
    const f = await friendInfo(to);
    if (!f?.dmKey || !KEY_RE.test(f.dmKey)) {
      throw new RazzeApiError(0, 'no_dm_key', serverOld
        ? 'O servidor Razze ainda não tem mensagens criptografadas. Peça para quem cuida dele atualizar.'
        : `${f?.displayName || 'Esse amigo'} precisa atualizar o Tela P2P para receber mensagens criptografadas.`);
    }
    const keyChanged = keys.pin(acct, to, f.dmKey);
    const payload = seal({ privateKey: k.privateKey, myRaw: k.myRaw, toRaw: Buffer.from(f.dmKey, 'base64'), from: acct, to, text });
    const res = await service.sendMessage(to, payload);
    return { ...res, message: res?.message ? { ...res.message, text, e2e: true, ...(keyChanged ? { keyChanged: true } : {}) } : res?.message };
  }

  function decode(acct, k, m) {
    if (!m || typeof m.text !== 'string') return m;
    if (!m.text.startsWith(PREFIX)) return { ...m, plain: true };
    const r = open({ privateKey: k.privateKey, myRaw: k.myRaw, me: acct, from: m.from, to: m.to, payload: m.text });
    if (!r || r.locked) return { ...m, text: '', locked: true };
    // Só fixa a chave de quem mandou depois de abrir (antes disso, o cabeçalho não está autenticado)
    const keyChanged = m.from !== acct && ID.test(String(m.from)) && keys.pin(acct, m.from, Buffer.from(r.senderRaw).toString('base64'));
    return { ...m, text: r.text, e2e: true, ...(keyChanged ? { keyChanged: true } : {}) };
  }

  async function messages(after) {
    const { acct, k } = await ensurePublished();
    const res = await service.messages(after);
    return { ...res, messages: (res?.messages || []).map((m) => decode(acct, k, m)) };
  }

  // Trocou de conta ou de servidor: esquece quem sou
  function reset() { account = ''; published = ''; serverOld = false; }

  return { send, messages, reset, ensurePublished };
}

module.exports = { createDmE2E, seal, open, createKeyStore };
