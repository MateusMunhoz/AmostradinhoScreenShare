// O que a sala faz com cada mensagem, igual para os dois servidores: o que roda no PC do host (signaling.js)
// e o que roda na VPS no modo Internet (servidor-internet/server.js). Assim os dois falam exatamente a mesma língua.
const crypto = require('crypto');

// Limite total de pessoas na sala, incluindo quem a criou.
const MAX_MEMBERS = 50;
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

function cleanClient(c) { return /^[a-f0-9]{32}$/.test(String(c || '')) ? String(c) : ''; }

// Subsalas de voz: canais dentro da sala. Só quem está no mesmo canal se conecta e se ouve; '' é a Voz geral.
// Os nomes são sempre Subsala_N, com N = o maior número que existe + 1 (apagar a última libera o número dela).
const SUBSALAS_MAX = 50;
function cleanChannel(c) { return /^\d{1,6}$/.test(String(c ?? '')) ? String(c) : ''; }
function createSubsalas(seed) {
  const list = (Array.isArray(seed) ? seed : [])
    .map((x) => cleanChannel(x?.id)).filter(Boolean)
    .filter((id, i, all) => all.indexOf(id) === i).slice(0, SUBSALAS_MAX)
    .sort((a, b) => Number(a) - Number(b))
    .map((id) => ({ id, name: `Subsala_${id}` }));
  return {
    list,
    has(id) { return !!id && list.some((x) => x.id === id); },
    create() {
      if (list.length >= SUBSALAS_MAX) return null;
      const id = String(list.reduce((n, x) => Math.max(n, Number(x.id)), 0) + 1);
      const sub = { id, name: `Subsala_${id}` };
      list.push(sub);
      return sub;
    },
    remove(id) {
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    },
  };
}

// Uma pessoa nova na sala, a partir do "hello". resume: voltando para a mesma sala (mesmo número)
function newMember(ws, msg, resume, subsalas = null) {
  const shareInfo = resume && msg.sharing ? cleanShareInfo(msg.shareInfo) : null;
  // Na volta, quem estava na voz continua na mesma sessão (as conexões de voz também seguem de pé)
  const voiceSession = resume && typeof msg.voiceSession === 'string' && /^[\w-]{1,64}$/.test(msg.voiceSession) ? msg.voiceSession : '';
  const voiceChannel = voiceSession && subsalas?.has(cleanChannel(msg.voiceChannel)) ? cleanChannel(msg.voiceChannel) : '';
  return {
    ws, client: cleanClient(msg.client), name: String(msg.name || 'Anônimo').slice(0, 32), sharing: !!(resume && msg.sharing),
    version: /^\d+\.\d+\.\d+$/.test(msg.version) ? msg.version : '', addrs: cleanAddrs(msg.addrs),
    voiceSession, voiceChannel, muted: !!voiceSession && msg.muted === true, deafened: !!voiceSession && msg.deafened === true, shareInfo,
    avatar: cleanHash(msg.avatar), avatarFull: cleanHash(msg.avatarFull), nameFont: cleanNameFont(msg.nameFont),
  };
}

// O que os outros ficam sabendo de cada pessoa
function memberInfo(id, m) {
  return { id, name: m.name, sharing: m.sharing, version: m.version, addrs: m.addrs, voiceSession: m.voiceSession, voiceChannel: m.voiceChannel || '', muted: m.muted, deafened: m.deafened, shareInfo: m.shareInfo, avatar: m.avatar, avatarFull: m.avatarFull, nameFont: m.nameFont };
}

// Conversa da sala: guarda as últimas mensagens e numera as novas
function createChat(seedChat) {
  const log = (Array.isArray(seedChat) ? seedChat : []).slice(-CHAT_KEEP);
  let next = log.reduce((n, e) => Math.max(n, (Number(e.id) || 0) + 1), 1);
  return {
    log,
    add(entry) {
      const full = { id: String(next++), ...entry };
      log.push(full);
      if (log.length > CHAT_KEEP) log.shift();
      return full;
    },
  };
}

const voiceStateOf = (id, m) => ({ type: 'voice-state', id, session: m.voiceSession, channel: m.voiceChannel || '', muted: m.muted, deafened: m.deafened });

// Mensagem de quem já está na sala. members: Map id -> pessoa; broadcast(msg, exceptId).
// subsalas (opcional): sem ele, a sala não tem subsalas e todo mundo fica na Voz geral.
function handleMemberMessage({ members, broadcast, chat, subsalas = null }, id, me, msg) {
  if (msg.type === 'voice-state') {
    if (typeof msg.session !== 'string' || !/^[\w-]{0,64}$/.test(msg.session)) return;
    me.voiceSession = msg.session;
    me.voiceChannel = msg.session && subsalas?.has(cleanChannel(msg.channel)) ? cleanChannel(msg.channel) : '';
    me.muted = !!msg.session && msg.muted === true;
    me.deafened = !!msg.session && msg.deafened === true; // fone silenciado: os outros veem na lista da voz
    broadcast(voiceStateOf(id, me));
  } else if (msg.type === 'subsala-create' && subsalas) {
    if (subsalas.create()) broadcast({ type: 'subsalas', list: subsalas.list });
  } else if (msg.type === 'subsala-delete' && subsalas) {
    const sub = cleanChannel(msg.id);
    if (!subsalas.remove(sub)) return;
    // Quem estava nela volta para a Voz geral (todo mundo fica sabendo, inclusive a própria pessoa)
    for (const [mid, m] of members) {
      if (m.voiceChannel !== sub) continue;
      m.voiceChannel = '';
      broadcast(voiceStateOf(mid, m));
    }
    broadcast({ type: 'subsalas', list: subsalas.list });
  } else if (msg.type === 'subsala-move' && subsalas) {
    // Arrastar alguém para outro canal no painel de voz: só quem está na voz, para a Voz geral ou uma subsala que
    // existe. Todo mundo fica sabendo, inclusive a pessoa movida (o app dela troca de canal sozinho)
    const target = members.get(String(msg.id));
    const ch = cleanChannel(msg.channel);
    if (!target?.voiceSession || (ch && !subsalas.has(ch)) || (target.voiceChannel || '') === ch) return;
    target.voiceChannel = ch;
    broadcast(voiceStateOf(String(msg.id), target));
  } else if (msg.type === 'avatar') {
    // Foto de perfil: só o hash passa por aqui; a foto vai direto de quem tem para quem pede
    me.avatar = cleanHash(msg.hash);
    me.avatarFull = me.avatar ? cleanHash(msg.full) : ''; // a foto inteira (sem o corte), para o perfil
    broadcast({ type: 'avatar-state', id, hash: me.avatar, full: me.avatarFull }, id);
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
    const entry = { from: id, name: me.name, ts: Date.now() };
    if (text) entry.text = text;
    if (file) entry.file = file;
    broadcast({ type: 'chat', ...chat.add(entry) }); // para todos, inclusive quem mandou
  } else if (msg.type === 'signal' && msg.to !== id && members.has(msg.to)) {
    const target = members.get(msg.to);
    if (msg.data?.side === 'voice' && (!me.voiceSession ||
        msg.data.session !== me.voiceSession || msg.data.targetSession !== target.voiceSession ||
        !target.voiceSession || (me.voiceChannel || '') !== (target.voiceChannel || ''))) return; // canais diferentes não se ouvem
    send(target.ws, { type: 'signal', from: id, data: msg.data });
  }
}

module.exports = {
  MAX_MEMBERS, CHAT_KEEP, SUBSALAS_MAX, send, cleanShareInfo, cleanHash, cleanNameFont, cleanAddrs, cleanSessao, cleanClient,
  cleanChannel, createSubsalas, newMember, memberInfo, createChat, handleMemberMessage,
};
