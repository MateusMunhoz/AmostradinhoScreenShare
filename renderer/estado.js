'use strict';
// Estado da sala e das atualizações (state, update) e as qualidades de transmissão.
// Script clássico: divide o escopo global com os outros (ordem no index.html).

const QUALITY = {
  '720p30':  { w: 1280, h: 720,  fps: 30, bitrate: 2_500_000 },
  '720p60':  { w: 1280, h: 720,  fps: 60, bitrate: 4_000_000 },
  '1080p30': { w: 1920, h: 1080, fps: 30, bitrate: 4_500_000 },
  '1080p60': { w: 1920, h: 1080, fps: 60, bitrate: 7_000_000 },
  // 4K: só faz diferença numa tela 4K (menor que isso, vai na resolução dela); pesa na internet de quem transmite
  '2160p30': { w: 3840, h: 2160, fps: 30, bitrate: 20_000_000 },
};
// Taxa de vídeo para o tamanho que está saindo de verdade: no 4K, uma tela menor (1440p, 1080p) não precisa dos
// 20 Mbps (vai proporcional aos pixels). As outras qualidades ficam como sempre foram.
function bitrateFor(q, w, h) {
  if (q.w <= 1920 || !w || !h) return q.bitrate;
  return Math.max(QUALITY['1080p30'].bitrate, Math.round(q.bitrate * Math.min(1, (w * h) / (q.w * q.h))));
}

// Radmin, Razze e rede local: sem STUN/TURN, os PCs se enxergam direto pelos IPs da VPN ou de casa.
// Modo Internet: o servidor da VPS manda, ao entrar na sala, os servidores STUN e um acesso temporário ao TURN.
// O ICE tenta primeiro o caminho direto e só passa pelo TURN quando não tem jeito (CGNAT, firewall).
// O objeto é o mesmo o tempo todo (quem cria conexão lê na hora); só a lista muda ao entrar e sair da sala.
const RTC_CONFIG = { iceServers: [] };

const state = {
  sessao: null,         // { id, oculta } da sessão (a sala como aparece na lista de sessões abertas)
  ws: null,
  myId: null,
  isOwner: false,
  host: '',
  port: 8765,
  cloud: null,             // modo Internet: { url, code } do servidor da VPS e o código da sala
  members: new Map(),      // id -> { name, sharing, version, addrs }  (outras pessoas na sala)
  // Troca de host: quem roda o servidor, a ordem de chegada (o mais antigo assume) e a senha para voltar
  hostId: null,
  subsalas: null,          // subsalas de voz da sala [{ id, name }]; null: o servidor da sala não tem subsalas
  subsalaMove: false,      // o servidor da sala sabe mover os outros de canal (arrastar no painel de voz)
  handoff: false,          // o servidor da sala sabe passar a sala adiante
  order: [],               // ids na ordem em que entraram, inclusive o meu
  password: '',
  migrating: false,

  // Minha transmissão
  stream: null,
  sharing: false,
  quality: '1080p30',
  selectedSource: null,
  sharingSource: null,     // a tela ou janela que está sendo transmitida agora
  shareSwitching: false,   // a janela de escolher está aberta para trocar, no meio da transmissão
  sources: [],             // telas e janelas da última busca
  sourceTab: 'screens',    // aba aberta na janela de transmitir: 'screens' ou 'windows'
  appAudio: null,
  out: new Map(),          // id de quem me assiste -> { pc, chain }

  // O que eu estou assistindo
  in: new Map(),           // id de quem transmite -> { pc, chain, tile, lastBytes, lastTs }
  rewatch: new Map(),      // id de quem eu assistia e caiu da sala -> quando caiu (volta a assistir sozinho)
  focus: null,             // id da transmissão em destaque (as outras ficam pausadas para mim)
  main: null,              // id da tela grande quando há 2 ou mais abertas (as outras ficam na coluna)
  pips: new Map(),         // id da transmissão -> a janela flutuante dela (pode haver várias)
  statsTimer: null,
  outStatsTimer: null,
};

// Atualizações pela sala: quem tem uma versão mais nova manda o pacote assinado para quem pedir
const update = {
  myVersion: '',
  ready: '',            // versão já baixada, que vale depois de reiniciar
  busy: null,           // download em andamento: { from, version, parts, total, sig, timer }
  tried: new Set(),     // "id@versão" já tentados nesta sala
  sending: new Set(),   // ids para quem estou mandando agora
};
