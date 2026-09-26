// Sessões abertas na rede (a lista da tela inicial). Quem tem uma sala aberta anuncia a cada 3 s, por UDP
// broadcast em cada rede do PC (inclusive a da Radmin): "tem uma sessão aqui". Quem está na tela inicial
// escuta, monta a lista e ainda pergunta "quem está aí?" ao abrir, para a lista aparecer na hora.
// O anúncio não leva IP nem senha: o endereço é de onde o pacote veio, e a senha continua sendo pedida
// ao entrar. Nunca se decide nada pelo anúncio: ele só preenche a lista.
const dgram = require('dgram');
const os = require('os');

const PORTA = 47654;          // porta fixa da descoberta: nunca muda, senão versões diferentes não se enxergam
const APP = 'tela-p2p';
const V = 1;                  // versão do formato das mensagens (mudou o formato → sobe o número)
const ANUNCIO_MS = 3000;
const VALIDADE_MS = 10000;    // três anúncios perdidos seguidos: a sessão some da lista
const RECENTE_MS = 6500;      // endereço visto nos últimos 2 anúncios (depois de uma troca de host, o antigo sai)
const MAX_SESSOES = 50;
const MAX_POR_IP = 20;        // pacotes por segundo de um mesmo IP; o resto é ignorado

let ouvir = null;             // escuta os anúncios na porta fixa (várias cópias do app podem escutar juntas)
let falar = null;             // manda e recebe as respostas, numa porta só dele (a resposta chega só para quem perguntou)
let pronto = null;            // resolve quando o socket de falar pode mandar broadcast
let anuncio = null;           // () => sessão da sua sala (ou null), enquanto ela estiver aberta
let versao = '';
let meuId = '';               // a sua sessão não aparece na sua lista
let anuncioTimer = null;
let observando = null;        // a página, enquanto a tela inicial está à vista
let expiraTimer = null;
const achadas = new Map();    // id -> { id, host, porta, pessoas, senha, versao, enderecos: Map(ip -> visto), visto }
const porIp = new Map();      // ip -> { n, desde }

function abrir() {
  if (falar) return;
  falar = dgram.createSocket({ type: 'udp4' });
  falar.on('error', (e) => console.warn('Sessões: erro ao mandar', e.message));
  falar.on('message', receber);
  pronto = new Promise((resolve) => falar.bind(0, () => { try { falar.setBroadcast(true); } catch {} resolve(); }));
  ouvir = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  ouvir.on('error', (e) => {
    console.warn('Sessões: não deu para escutar a porta', PORTA, e.message);
    try { ouvir.close(); } catch {}
    ouvir = null;
  });
  ouvir.on('message', receber);
  ouvir.bind(PORTA, '0.0.0.0');
}

function fecharSeOcioso() {
  if (anuncio || observando) return;
  for (const s of [ouvir, falar]) { try { s && s.close(); } catch {} }
  ouvir = falar = pronto = null;
}

// Endereço de broadcast de cada rede do PC (ex.: 26.255.255.255 na Radmin). O 255.255.255.255 costuma sair
// só pela placa principal, então vai também, mas não sozinho.
function destinos() {
  const lista = new Set(['255.255.255.255']);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if ((n.family !== 'IPv4' && n.family !== 4) || n.internal || !n.netmask) continue;
      const ip = n.address.split('.').map(Number);
      const mask = n.netmask.split('.').map(Number);
      lista.add(ip.map((b, i) => (b | (~mask[i] & 255))).join('.'));
    }
  }
  return [...lista];
}

async function mandar(msg, para = null) {
  if (!falar) return;
  await pronto;
  if (!falar) return;
  const buf = Buffer.from(JSON.stringify({ app: APP, v: V, ...msg }));
  for (const [ip, porta] of para ? [para] : destinos().map((d) => [d, PORTA])) {
    try { falar.send(buf, porta, ip, () => {}); } catch {}
  }
}

function minhaSessao() {
  const i = anuncio && anuncio();
  if (!i) return null;
  return { tipo: 'sessao', id: i.id, host: i.host, porta: i.porta, pessoas: i.pessoas, senha: i.senha, versao };
}

// ---------- Anunciar a sua sessão ----------
function anunciar(info, appVersion) {
  anuncio = info;
  versao = appVersion || '';
  abrir();
  clearInterval(anuncioTimer);
  anuncioTimer = setInterval(anunciarAgora, ANUNCIO_MS);
  anunciarAgora();
}

// Na hora (entrou ou saiu alguém); a sala oculta, ou ainda sem o host, não anuncia
function anunciarAgora() {
  if (!anuncio) return;
  const s = minhaSessao();
  if (!s) {
    if (meuId) { mandar({ tipo: 'fechou', id: meuId }); meuId = ''; }
    return;
  }
  meuId = s.id;
  mandar(s);
}

// passaAdiante: a sala vai continuar no PC de outra pessoa (troca de host), então não avisa que fechou:
// o novo host anuncia com o mesmo id e a lista só troca o endereço
function pararAnuncio({ passaAdiante = false } = {}) {
  if (!anuncio) return;
  clearInterval(anuncioTimer);
  anuncioTimer = null;
  anuncio = null;
  const id = meuId;
  meuId = '';
  if (id && !passaAdiante) {
    // UDP pode perder pacote: repete
    for (const ms of [0, 150, 300]) setTimeout(() => mandar({ tipo: 'fechou', id }), ms);
    setTimeout(fecharSeOcioso, 450);
  } else {
    fecharSeOcioso();
  }
}

// ---------- Procurar sessões ----------
function observar(on, sender) {
  observando = on ? sender : null;
  clearInterval(expiraTimer);
  expiraTimer = null;
  if (!on) {
    achadas.clear(); // na próxima vez, a lista começa do zero (nada velho piscando)
    ultimo = '';
    return fecharSeOcioso();
  }
  abrir();
  expiraTimer = setInterval(expirar, 1000);
  mandar({ tipo: 'procura' });
  setTimeout(() => { if (observando) mandar({ tipo: 'procura' }); }, 1200); // UDP pode perder o primeiro
  avisar();
}

function expirar() {
  const agora = Date.now();
  let mudou = false;
  for (const [id, s] of achadas) if (agora - s.visto > VALIDADE_MS) { achadas.delete(id); mudou = true; }
  if (mudou) avisar();
}

// O endereço para entrar: dos vistos há pouco, o da Radmin (26.x); senão, o mais recente
function endereco(s) {
  const agora = Date.now();
  const vistos = [...s.enderecos].sort((a, b) => b[1] - a[1]);
  const recentes = vistos.filter(([, t]) => agora - t < RECENTE_MS);
  return ((recentes.find(([ip]) => ip.startsWith('26.')) || recentes[0] || vistos[0]) || [''])[0];
}

function lista() {
  return [...achadas.values()]
    .map((s) => ({ id: s.id, host: s.host, porta: s.porta, pessoas: s.pessoas, senha: s.senha, versao: s.versao, endereco: endereco(s) }))
    .sort((a, b) => a.host.localeCompare(b.host, 'pt-BR'));
}

let ultimo = '';
function avisar() {
  if (!observando || observando.isDestroyed()) return;
  const l = lista();
  const chave = JSON.stringify(l);
  if (chave === ultimo) return;
  ultimo = chave;
  observando.send('sessoes', l);
}

// ---------- Mensagens que chegam ----------
function limite(ip) {
  const agora = Date.now();
  const c = porIp.get(ip);
  if (!c || agora - c.desde > 1000) { porIp.set(ip, { n: 1, desde: agora }); return true; }
  c.n++;
  if (porIp.size > 500) porIp.clear();
  return c.n <= MAX_POR_IP;
}

// Confere cada campo; qualquer coisa estranha descarta o pacote inteiro
function sessaoValida(m) {
  const id = /^[a-f0-9]{16}$/.test(String(m.id)) ? String(m.id) : null;
  const host = typeof m.host === 'string' ? m.host.replace(/[\x00-\x1f]/g, '').trim().slice(0, 32) : '';
  const porta = Number.isInteger(m.porta) && m.porta >= 1024 && m.porta <= 65535 ? m.porta : null;
  const pessoas = Number.isInteger(m.pessoas) && m.pessoas >= 0 && m.pessoas <= 99 ? m.pessoas : null;
  if (!id || !host || porta === null || pessoas === null || typeof m.senha !== 'boolean') return null;
  const v = typeof m.versao === 'string' && /^\d+\.\d+\.\d+$/.test(m.versao) ? m.versao : '';
  return { id, host, porta, pessoas, senha: m.senha, versao: v };
}

function receber(buf, rinfo) {
  if (buf.length > 1024 || !limite(rinfo.address)) return;
  let m;
  try { m = JSON.parse(buf.toString('utf8')); } catch { return; }
  if (!m || typeof m !== 'object' || m.app !== APP || m.v !== V) return;

  if (m.tipo === 'procura') {
    const s = minhaSessao();
    if (s) mandar(s, [rinfo.address, rinfo.port]); // só para quem perguntou
    return;
  }
  if (!observando) return;
  if (m.tipo === 'fechou') {
    if (achadas.delete(String(m.id))) avisar();
    return;
  }
  if (m.tipo !== 'sessao') return;
  const s = sessaoValida(m);
  if (!s || s.id === meuId) return;
  const antes = achadas.get(s.id);
  if (!antes && achadas.size >= MAX_SESSOES) return;
  const enderecos = antes ? antes.enderecos : new Map();
  enderecos.set(rinfo.address, Date.now());
  achadas.set(s.id, { ...s, enderecos, visto: Date.now() });
  avisar();
}

module.exports = { anunciar, anunciarAgora, pararAnuncio, observar, PORTA };
