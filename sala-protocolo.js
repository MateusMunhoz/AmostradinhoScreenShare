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
  if (typeof i.open === 'boolean') out.open = i.open; // false: só quem está no mesmo canal assiste
  return out;
}

// Hash (SHA-256) da foto de perfil, ou vazio
function cleanHash(h) { return typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : ''; }
// Fonte do nome: só o id da lista de fontes do app (letras); cada app confere de novo se conhece o id
function cleanNameFont(f) { return typeof f === 'string' && /^[A-Za-z]{1,32}$/.test(f) ? f : ''; }
// Conta Razze que a pessoa diz ter (o nome do servidor e a id), para o perfil e o Adicionar. Declarada pelo app dela:
// quem recebe confere pela própria lista de amigos. Sem conta: null
function cleanRazze(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !/^[a-f0-9]{32}$/.test(c.id)) return null;
  const nome = typeof c.nome === 'string' ? c.nome.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '';
  return nome ? { id: c.id, nome } : null;
}

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

// Senha nova da sala (mensagem "senha", só do host): até 64 caracteres, sem caracteres de controle; null se não vale
function cleanSenha(p, min = 0) {
  if (typeof p !== 'string' || p.length < min || p.length > 64 || /[\u0000-\u001f\u007f]/.test(p)) return null;
  return p;
}

// Subsalas de voz: canais dentro da sala. Só quem está no mesmo canal se conecta e se ouve; '' é a Voz geral.
// Os nomes são sempre Subsala_N, com N = o maior número que existe + 1 (apagar a última libera o número dela).
// Modo Líder (docs/spec/modo-lider.md): no máximo uma subsala por sala fala para a sala toda; ela leva modo: 'lider'
// (a Padrão não leva o campo, e os apps antigos a veem como uma subsala comum).
// Junto ficam os pedidos para falar (na ordem em que chegaram) e quem tem a palavra: quem está fora da Líder e fala
// para a sala toda. A semente lider ({ pedidos, palavra }) vem da troca de host.
const SUBSALAS_MAX = 50;
function cleanChannel(c) { return /^\d{1,6}$/.test(String(c ?? '')) ? String(c) : ''; }
const cleanIds = (l) => (Array.isArray(l) ? l : []).map(String).filter((x, i, all) => /^\d{1,6}$/.test(x) && all.indexOf(x) === i).slice(0, MAX_MEMBERS);
function createSubsalas(seed, liderSeed) {
  const list = [];
  for (const x of Array.isArray(seed) ? seed : []) {
    const id = cleanChannel(x?.id);
    if (!id || list.some((s) => s.id === id) || list.length >= SUBSALAS_MAX) continue;
    const sub = { id, name: `Subsala_${id}` };
    if (x.modo === 'lider' && !list.some((s) => s.modo === 'lider')) sub.modo = 'lider';
    list.push(sub);
  }
  list.sort((a, b) => Number(a.id) - Number(b.id));
  const temLider = list.some((s) => s.modo === 'lider');
  const palavra = temLider ? cleanIds(liderSeed?.palavra) : [];
  return {
    list,
    pedidos: temLider ? cleanIds(liderSeed?.pedidos).filter((x) => !palavra.includes(x)) : [],
    palavra,
    has(id) { return !!id && list.some((x) => x.id === id); },
    // O canal da subsala Líder ('' sem ela)
    lider() { return list.find((x) => x.modo === 'lider')?.id || ''; },
    create(modo = 'padrao') {
      if (list.length >= SUBSALAS_MAX || (modo === 'lider' && this.lider())) return null;
      const id = String(list.reduce((n, x) => Math.max(n, Number(x.id)), 0) + 1);
      const sub = { id, name: `Subsala_${id}` };
      if (modo === 'lider') sub.modo = 'lider';
      list.push(sub);
      return sub;
    },
    remove(id) {
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return false;
      if (list[i].modo === 'lider') { this.pedidos.length = 0; this.palavra.length = 0; } // sem Líder, sem pedidos
      list.splice(i, 1);
      return true;
    },
    liderMsg() { return { type: 'lider', pedidos: [...this.pedidos], palavra: [...this.palavra] }; },
    // Tira alguém dos pedidos e da palavra (saiu da sala ou da voz, ou entrou na Líder); true se mudou
    liderSai(id) {
      let mudou = false;
      for (const l of [this.pedidos, this.palavra]) { const i = l.indexOf(id); if (i >= 0) { l.splice(i, 1); mudou = true; } }
      return mudou;
    },
  };
}

// Música (YouTube) por canal: no máximo uma em cada um (Voz geral ou subsala). O servidor guarda só o que tocar e
// de onde: o vídeo, se está tocando, e a posição num instante (pos, em segundos, no momento at do relógio do
// servidor). Cada pessoa toca no próprio player oficial do YouTube; a sala só sincroniza os comandos (nenhum áudio
// passa por aqui).
const MUSICA_MAX_POS = 24 * 3600;
function cleanVideoId(v) { return /^[\w-]{11}$/.test(String(v || '')) ? String(v) : ''; }
function cleanTitle(t) { return typeof t === 'string' ? t.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 200) : ''; }
function cleanPos(p) { return Math.max(0, Math.min(MUSICA_MAX_POS, Number(p) || 0)); }
function createMusicas(seed, now = Date.now) {
  const map = new Map();
  for (const m of Array.isArray(seed) ? seed : []) {
    const ch = cleanChannel(m?.ch), videoId = cleanVideoId(m?.videoId);
    if (!videoId || map.has(ch)) continue;
    map.set(ch, { ch, videoId, title: cleanTitle(m.title), by: /^\d{1,6}$/.test(String(m.by || '')) ? String(m.by) : '', playing: m.playing !== false, pos: cleanPos(m.pos), at: now() });
  }
  // sozinha: canal -> desde quando a música está sem ninguém no canal e sem ninguém ouvindo (limparMusicas)
  return { map, now, sozinha: new Map(), msg: () => ({ type: 'musicas', list: [...map.values()], now: now() }) };
}
// Tira sozinho as músicas esquecidas: pausada há mais de 4 min, ou 1 min sem ninguém no canal e sem ninguém ouvindo
// (tocando ou não). Pausada, "at" é o instante da pausa. Os servidores chamam de tempos em tempos; true se tirou alguma.
const MUSICA_PAUSADA_MS = 4 * 60 * 1000, MUSICA_SOZINHA_MS = 60 * 1000;
function limparMusicas(musicas, members) {
  const t = musicas.now();
  let changed = false;
  for (const [ch, m] of musicas.map) {
    let gente = false;
    for (const x of members.values()) if ((x.voiceSession && channelOf(x) === ch) || x.ouvindo?.has(ch)) { gente = true; break; }
    if (gente) musicas.sozinha.delete(ch);
    else if (!musicas.sozinha.has(ch)) musicas.sozinha.set(ch, t);
    if ((!m.playing && t - m.at >= MUSICA_PAUSADA_MS) || (!gente && t - musicas.sozinha.get(ch) >= MUSICA_SOZINHA_MS)) {
      musicas.map.delete(ch);
      musicas.sozinha.delete(ch);
      changed = true;
    }
  }
  return changed;
}
// O canal de alguém: o da voz; fora da voz, a Voz geral
const channelOf = (m) => (m.voiceSession ? m.voiceChannel || '' : '');
const channelLabel = (ch) => (ch ? `Subsala_${ch}` : 'Voz geral');

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
    avatar: cleanHash(msg.avatar), avatarFull: cleanHash(msg.avatarFull), nameFont: cleanNameFont(msg.nameFont), razze: cleanRazze(msg.razze),
  };
}

// O que os outros ficam sabendo de cada pessoa
function memberInfo(id, m) {
  return { id, name: m.name, sharing: m.sharing, version: m.version, addrs: m.addrs, voiceSession: m.voiceSession, voiceChannel: m.voiceChannel || '', muted: m.muted, deafened: m.deafened, shareInfo: m.shareInfo, avatar: m.avatar, avatarFull: m.avatarFull, nameFont: m.nameFont, razze: m.razze || null };
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

// Modo Líder: quem fala para a sala toda (está na voz, dentro da Líder ou com a palavra) e quem decide os pedidos
// (transmitindo dentro da Líder)
function liderFonte(subsalas, id, m) {
  const ch = subsalas?.lider();
  return !!ch && !!m?.voiceSession && (m.voiceChannel === ch || subsalas.palavra.includes(id));
}
function liderLider(subsalas, m) { const ch = subsalas?.lider(); return !!ch && !!m?.voiceSession && m.voiceChannel === ch && !!m.sharing; }
// Saiu da voz ou entrou na Líder: o pedido e a palavra somem
function liderConfere(subsalas, broadcast, id, m) {
  const ch = subsalas?.lider();
  if (ch && (!m.voiceSession || m.voiceChannel === ch) && subsalas.liderSai(id)) broadcast(subsalas.liderMsg());
}
// Alguém saiu da sala (os dois servidores chamam)
function memberGone({ subsalas, broadcast }, id) {
  if (subsalas?.liderSai(id)) broadcast(subsalas.liderMsg());
}

// Mensagem de quem já está na sala. members: Map id -> pessoa; broadcast(msg, exceptId).
// subsalas (opcional): sem ele, a sala não tem subsalas e todo mundo fica na Voz geral.
function handleMemberMessage({ members, broadcast, chat, subsalas = null, musicas = null }, id, me, msg) {
  if (msg.type === 'voice-state') {
    if (typeof msg.session !== 'string' || !/^[\w-]{0,64}$/.test(msg.session)) return;
    me.voiceSession = msg.session;
    me.voiceChannel = msg.session && subsalas?.has(cleanChannel(msg.channel)) ? cleanChannel(msg.channel) : '';
    me.muted = !!msg.session && msg.muted === true;
    me.deafened = !!msg.session && msg.deafened === true; // fone silenciado: os outros veem na lista da voz
    broadcast(voiceStateOf(id, me));
    liderConfere(subsalas, broadcast, id, me);
  } else if (msg.type === 'subsala-create' && subsalas) {
    const modo = msg.modo === 'lider' ? 'lider' : 'padrao';
    if (subsalas.create(modo)) broadcast({ type: 'subsalas', list: subsalas.list });
    else if (modo === 'lider' && subsalas.lider()) send(me.ws, { type: 'subsala-erro', text: `Já existe uma subsala Líder (Subsala_${subsalas.lider()}).` });
  } else if (msg.type === 'subsala-delete' && subsalas) {
    const sub = cleanChannel(msg.id);
    if (!subsalas.remove(sub)) return;
    // Quem estava nela volta para a Voz geral (todo mundo fica sabendo, inclusive a própria pessoa)
    for (const [mid, m] of members) {
      if (m.voiceChannel !== sub) continue;
      m.voiceChannel = '';
      broadcast(voiceStateOf(mid, m));
    }
    if (musicas?.map.delete(sub)) broadcast(musicas.msg()); // a música da subsala apagada para
    broadcast({ type: 'subsalas', list: subsalas.list });
    broadcast(subsalas.liderMsg());
  } else if (msg.type === 'subsala-move' && subsalas) {
    // Arrastar alguém para outro canal no painel de voz: só quem está na voz, para a Voz geral ou uma subsala que
    // existe. Todo mundo fica sabendo, inclusive a pessoa movida (o app dela troca de canal sozinho)
    const target = members.get(String(msg.id));
    const ch = cleanChannel(msg.channel);
    if (!target?.voiceSession || (ch && !subsalas.has(ch)) || (target.voiceChannel || '') === ch) return;
    target.voiceChannel = ch;
    broadcast(voiceStateOf(String(msg.id), target));
    liderConfere(subsalas, broadcast, String(msg.id), target);
  } else if (msg.type === 'lider-pedir' && subsalas) {
    // Pedir para falar: na voz, fora da Líder, sem pedido nem palavra
    const ch = subsalas.lider();
    if (!ch || !me.voiceSession || me.voiceChannel === ch || subsalas.pedidos.includes(id) || subsalas.palavra.includes(id)) return;
    subsalas.pedidos.push(id);
    broadcast(subsalas.liderMsg());
  } else if (msg.type === 'lider-cancelar' && subsalas) {
    const i = subsalas.pedidos.indexOf(id);
    if (i < 0) return;
    subsalas.pedidos.splice(i, 1);
    broadcast(subsalas.liderMsg());
  } else if (msg.type === 'lider-devolver' && subsalas) {
    const i = subsalas.palavra.indexOf(id);
    if (i < 0) return;
    subsalas.palavra.splice(i, 1);
    broadcast(subsalas.liderMsg());
  } else if ((msg.type === 'lider-responder' || msg.type === 'lider-tirar') && subsalas) {
    // Aceitar, recusar e tirar a palavra: só quem está transmitindo dentro da Líder
    const alvo = String(msg.id);
    if (!liderLider(subsalas, me)) return send(me.ws, { type: 'subsala-erro', text: 'Só quem está transmitindo na subsala Líder decide quem fala.' });
    if (msg.type === 'lider-tirar') {
      const i = subsalas.palavra.indexOf(alvo);
      if (i < 0) return;
      subsalas.palavra.splice(i, 1);
      send(members.get(alvo)?.ws, { type: 'lider-aviso', aviso: 'tirada', by: id });
    } else {
      const i = subsalas.pedidos.indexOf(alvo);
      if (i < 0) return;
      subsalas.pedidos.splice(i, 1);
      if (msg.ok === true) subsalas.palavra.push(alvo);
      send(members.get(alvo)?.ws, { type: 'lider-aviso', aviso: msg.ok === true ? 'aceito' : 'recusado', by: id });
    }
    broadcast(subsalas.liderMsg());
  } else if (msg.type === 'musica-set' && musicas) {
    // Pôr uma música: vai para o canal de quem pôs. Só uma por canal (para trocar, use "trocar")
    const videoId = cleanVideoId(msg.videoId), ch = channelOf(me);
    if (!videoId) return;
    if (musicas.map.has(ch)) return send(me.ws, { type: 'musica-erro', text: `Já tem uma música em ${channelLabel(ch)}. Troque ou pare a que está tocando.` });
    musicas.map.set(ch, { ch, videoId, title: cleanTitle(msg.title), by: id, playing: true, pos: 0, at: musicas.now() });
    broadcast(musicas.msg());
  } else if (msg.type === 'musica-ouvindo' && musicas) {
    // Abriu ou fechou a tela da música (Ouvir): conta como gente para limparMusicas, mesmo fora do canal
    const ch = cleanChannel(msg.ch);
    me.ouvindo ??= new Set();
    if (msg.on === true && musicas.map.has(ch) && me.ouvindo.size <= SUBSALAS_MAX) me.ouvindo.add(ch);
    else if (msg.on !== true) me.ouvindo.delete(ch);
  } else if (msg.type === 'musica-ctl' && musicas) {
    const ch = cleanChannel(msg.ch), m = musicas.map.get(ch);
    if (!m) return;
    // O título vem do player de quem ouve (o servidor não fala com o YouTube); vale o primeiro que chegar
    if (msg.action === 'titulo') {
      const title = cleanTitle(msg.title);
      if (!m.title && title) { m.title = title; broadcast(musicas.msg()); }
      return;
    }
    // Controla quem está no canal da música, ou quem pôs ela
    if (channelOf(me) !== ch && m.by !== id) return send(me.ws, { type: 'musica-erro', text: `Só quem está em ${channelLabel(ch)} controla a música de lá.` });
    const t = musicas.now();
    if (msg.action === 'stop') musicas.map.delete(ch);
    else if (msg.action === 'play' || msg.action === 'pause' || msg.action === 'seek') {
      m.pos = cleanPos(msg.pos);
      m.at = t;
      if (msg.action !== 'seek') m.playing = msg.action === 'play';
    } else if (msg.action === 'trocar') {
      const videoId = cleanVideoId(msg.videoId);
      if (!videoId) return;
      Object.assign(m, { videoId, title: cleanTitle(msg.title), by: id, playing: true, pos: 0, at: t });
    } else return;
    broadcast(musicas.msg());
  } else if (msg.type === 'avatar') {
    // Foto de perfil: só o hash passa por aqui; a foto vai direto de quem tem para quem pede
    me.avatar = cleanHash(msg.hash);
    me.avatarFull = me.avatar ? cleanHash(msg.full) : ''; // a foto inteira (sem o corte), para o perfil
    broadcast({ type: 'avatar-state', id, hash: me.avatar, full: me.avatarFull }, id);
  } else if (msg.type === 'razze') {
    // Entrou ou saiu da conta Razze no meio da sala
    me.razze = cleanRazze(msg.conta);
    broadcast({ type: 'razze-state', id, conta: me.razze }, id);
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
    // A voz da Líder (voice.js › LiderAudio): só entre quem fala para a sala toda (na voz, dentro da subsala Líder) e
    // quem ouve; quem ouve não precisa estar na voz (Ouvir a Líder, sem microfone)
    if (msg.data?.side === 'lider') {
      if (!(msg.data.role === 'ouvir' ? liderFonte(subsalas, String(msg.to), target) : msg.data.role === 'falar' && liderFonte(subsalas, id, me))) return;
    }
    send(target.ws, { type: 'signal', from: id, data: msg.data });
  }
}

module.exports = {
  MAX_MEMBERS, CHAT_KEEP, SUBSALAS_MAX, send, cleanShareInfo, cleanHash, cleanNameFont, cleanRazze, cleanAddrs, cleanSessao, cleanClient, cleanSenha,
  cleanChannel, createSubsalas, memberGone, cleanVideoId, createMusicas, limparMusicas, newMember, memberInfo, createChat, handleMemberMessage,
};
