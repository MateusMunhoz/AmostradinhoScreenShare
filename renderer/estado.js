'use strict';
// Estado da sala e das atualizações (state, update) e as qualidades de transmissão.
// Script clássico: divide o escopo global com os outros (ordem no index.html).

const QUALITY = {
  '720p30':  { w: 1280, h: 720,  fps: 30, bitrate: 2_500_000 },
  '720p60':  { w: 1280, h: 720,  fps: 60, bitrate: 4_000_000 },
  '1080p30': { w: 1920, h: 1080, fps: 30, bitrate: 4_500_000 },
  '1080p60': { w: 1920, h: 1080, fps: 60, bitrate: 7_000_000 },
};

// Sem STUN/TURN: pela Radmin VPN os PCs se enxergam direto pelos IPs 26.x
const RTC_CONFIG = { iceServers: [] };

const state = {
  sessao: null,         // { id, oculta } da sessão (a sala como aparece na lista de sessões abertas)
  ws: null,
  myId: null,
  isOwner: false,
  host: '',
  port: 8765,
  members: new Map(),      // id -> { name, sharing, version, addrs }  (outras pessoas na sala)
  // Troca de host: quem roda o servidor, a ordem de chegada (o mais antigo assume) e a senha para voltar
  hostId: null,
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
