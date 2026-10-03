'use strict';
// Configurações no celular, sem interface (docs/spec/config-no-celular.md): o que vai no arquivo, a validação de cada
// item ao trazer e a cifra (PBKDF2 + AES-GCM, pela WebCrypto). A cifra é feita aqui no PC: a página do celular só
// guarda e devolve o arquivo. Usado por renderer/celular.js e pelos testes (tests/celular.test.js).
// Nunca vão no arquivo: clientId (identifica este PC na sala), conta e chaves da Razze, endereço da sala e caches.

const CelularModelo = (() => {
  const APP = 'tela-p2p-config', VERSAO = 1, ITER = 600000, MAX = 4 * 1024 * 1024; // o fundo do perfil (GIF de até 1 MB) é o maior item
  const Prefs = typeof AppPreferences !== 'undefined' ? AppPreferences : require('./preferencias-modelo');

  // ---------- Validação: cada item chega como texto (como no localStorage) e sai limpo, ou null ----------
  const um = (...opcoes) => (v) => (opcoes.includes(v) ? v : null);
  const numero = (min, max) => (v) => {
    const n = Number(v);
    return typeof v === 'string' && v.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? String(n) : null;
  };
  const texto = (max, re) => (v) => (typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) && (!re || re.test(v)) ? v : null);
  const json = (limpa) => (v) => {
    if (typeof v !== 'string' || v.length > MAX) return null;
    let o;
    try { o = JSON.parse(v); } catch { return null; }
    const r = limpa(o);
    return r == null ? null : JSON.stringify(r);
  };
  const objeto = (o) => o && typeof o === 'object' && !Array.isArray(o);
  const FOTO_B64 = 240000; // a foto inteira tem até 170 KB (renderer/fotos.js), em base64
  const foto = (o) => (objeto(o) && /^[0-9a-f]{64}$/.test(o.hash) && typeof o.data === 'string' && o.data.length <= FOTO_B64
    && /^[A-Za-z0-9+/]+={0,2}$/.test(o.data) ? { hash: o.hash, data: o.data } : null);
  // Fundo do perfil (renderer/fundo-perfil.js): GIF ou WebP de até 1 MB, em base64
  const FUNDO_B64 = Math.ceil(1024 * 1024 / 3) * 4;
  const fundo = (o) => (objeto(o) && /^[0-9a-f]{64}$/.test(o.hash) && ['image/gif', 'image/webp'].includes(o.mime)
    && typeof o.data === 'string' && o.data.length <= FUNDO_B64 && /^[A-Za-z0-9+/]+={0,2}$/.test(o.data) ? { hash: o.hash, mime: o.mime, data: o.data } : null);
  // vozConfig: só os campos conhecidos, cada um no tipo e na faixa certos (renderer/microfone.js › voiceCfg)
  const VOZ = {
    micId: texto(300), micLabel: texto(300), ns: texto(20, /^[a-z]+$/), mode: texto(20, /^[a-z]+$/), pttLabel: texto(60),
    echo: 'b', gateAuto: 'b', duckSelf: 'b', pttVk: [0, 255], gateDb: [-100, 0], duck: [0, 100],
  };
  const voz = (o) => {
    if (!objeto(o)) return null;
    const r = {};
    for (const [k, regra] of Object.entries(VOZ)) {
      const v = o[k];
      if (regra === 'b') { if (typeof v === 'boolean') r[k] = v; }
      else if (Array.isArray(regra)) { if (typeof v === 'number' && Number.isFinite(v) && v >= regra[0] && v <= regra[1]) r[k] = v; }
      else if (regra(v) !== null) r[k] = v;
    }
    return r;
  };
  // Volume de cada pessoa, pelo nome (renderer/voz.js)
  const volumes = (o) => {
    if (!objeto(o)) return null;
    const r = {};
    for (const [nome, v] of Object.entries(o).slice(0, 500)) {
      if (!nome || nome.length > 64 || !objeto(v)) continue;
      const voice = Number(v.voice), screen = Number(v.screen);
      if (!Number.isFinite(voice) || !Number.isFinite(screen) || voice < 0 || voice > 300 || screen < 0 || screen > 300) continue;
      r[nome] = { voice, screen, muted: v.muted === true };
    }
    return r;
  };
  const ATALHOS = ['edit', 'hideChat', 'compose', 'mute', 'deafen'];
  const atalhos = (o) => {
    if (!objeto(o)) return null;
    const r = {};
    for (const k of ATALHOS) if (typeof o[k] === 'string' && o[k].length <= 60 && /^[\w+]*$/.test(o[k])) r[k] = o[k];
    return r;
  };
  const ITENS = {
    'appPreferences.v1': json((o) => (objeto(o) ? Prefs.normalize(o) : null)),
    tema: (v) => (typeof v === 'string' && Prefs.cleanSkin(v) === v ? v : null),
    name: (v) => { const t = texto(32)(v); return t === null ? null : t.trim(); },
    fotoPerfil: json(foto), fotoPerfilInteira: json(foto), fotoEncaixe: um('inteira', 'preencher'), fundoPerfil: json(fundo),
    vozConfig: json(voz), volumes: json(volumes), musicaVolume: numero(0, 100),
    'workspaceViews.v1': json((o) => (objeto(o) && ['chat', 'voice', 'streams'].every((k) => typeof o[k] === 'boolean')
      ? { chat: o.chat, voice: o.voice, streams: o.streams } : null)),
    stageLayout: um('grid', 'spotlight'), stageSide: numero(0.15, 0.5), vozVisao: um('lista', 'mapa'),
    mapaFixo: um('0', '1'), panelOpen: um('0', '1'),
    quality: texto(12, /^[0-9a-z]+$/), encodeMode: um('per', 'once'), audioMode: um('all', 'none', 'exclude'),
    mostrarMouse: um('0', '1'), priority: texto(12, /^[a-z]+$/),
    excludeApps: json((o) => (Array.isArray(o) ? o.filter((x) => typeof x === 'string' && x.length <= 260 && /^[^\\/:*?"<>|\u0000-\u001f]+$/.test(x)).slice(0, 100) : null)),
    atalhos: json(atalhos), // não fica no localStorage: vem e vai pelo processo principal (main/atalhos.js)
  };
  const CHAVES_LOCAIS = Object.keys(ITENS).filter((k) => k !== 'atalhos');

  // As configurações deste PC, como texto, só as chaves da lista
  function juntar(storage, keys) {
    const itens = {};
    for (const k of CHAVES_LOCAIS) {
      let v = null;
      try { v = storage.getItem(k); } catch {}
      if (typeof v === 'string') itens[k] = v;
    }
    if (objeto(keys)) itens.atalhos = JSON.stringify(atalhos(keys));
    return itens;
  }
  // Valida o que veio do arquivo: chave desconhecida ou valor inválido fica de fora. A foto tem de bater com o hash.
  async function limpar(itens) {
    const ok = {}, fora = [];
    if (!objeto(itens)) return { itens: ok, fora };
    for (const [k, v] of Object.entries(itens)) {
      const regra = Object.prototype.hasOwnProperty.call(ITENS, k) ? ITENS[k] : null;
      const limpo = regra ? regra(v) : null;
      if (limpo === null) { fora.push(k); continue; }
      ok[k] = limpo;
    }
    for (const k of ['fotoPerfil', 'fotoPerfilInteira', 'fundoPerfil']) {
      if (!ok[k]) continue;
      const f = JSON.parse(ok[k]);
      if (await sha256Hex(deBase64(f.data)) !== f.hash) { delete ok[k]; fora.push(k); }
    }
    return { itens: ok, fora };
  }

  // ---------- Cifra ----------
  const subtle = () => globalThis.crypto.subtle;
  function emBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function deBase64(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function sha256Hex(bytes) {
    return [...new Uint8Array(await subtle().digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function chave(senha, salt, iteracoes) {
    const base = await subtle().importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iteracoes }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // Devolve o texto do arquivo .tp2p
  async function cifrar(itens, senha, { appVersion = '' } = {}) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16)), iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const conteudo = new TextEncoder().encode(JSON.stringify({ created: new Date().toISOString(), appVersion: String(appVersion), items: itens }));
    const dados = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await chave(senha, salt, ITER), conteudo));
    const texto = JSON.stringify({ app: APP, v: VERSAO, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITER, salt: emBase64(salt) },
      cipher: { name: 'AES-GCM', iv: emBase64(iv) }, data: emBase64(dados) });
    if (texto.length > MAX) throw new Error('As configurações passaram de 4 MB.');
    return texto;
  }
  // Erros com código: 'formato' (não é um arquivo do app) ou 'senha' (senha errada ou arquivo alterado)
  const erro = (code, msg) => Object.assign(new Error(msg), { code });
  async function decifrar(texto, senha) {
    let o;
    try { o = typeof texto === 'string' && texto.length <= MAX ? JSON.parse(texto) : null; } catch { o = null; }
    const b64 = (s, max) => typeof s === 'string' && s.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
    if (!objeto(o) || o.app !== APP || !Number.isInteger(o.v) || o.v < 1 || !objeto(o.kdf) || !objeto(o.cipher)
      || o.kdf.name !== 'PBKDF2' || o.kdf.hash !== 'SHA-256' || o.cipher.name !== 'AES-GCM'
      || !Number.isInteger(o.kdf.iterations) || o.kdf.iterations < 100000 || o.kdf.iterations > 5000000
      || !b64(o.kdf.salt, 64) || !b64(o.cipher.iv, 64) || !b64(o.data, MAX)) {
      throw erro('formato', 'Este arquivo não é uma configuração do Tela P2P.');
    }
    let claro;
    try {
      const k = await chave(String(senha), deBase64(o.kdf.salt), o.kdf.iterations);
      claro = await subtle().decrypt({ name: 'AES-GCM', iv: deBase64(o.cipher.iv) }, k, deBase64(o.data));
    } catch { throw erro('senha', 'Senha errada (ou o arquivo foi alterado).'); }
    let conteudo;
    try { conteudo = JSON.parse(new TextDecoder().decode(claro)); } catch { conteudo = null; }
    if (!objeto(conteudo) || !objeto(conteudo.items)) throw erro('formato', 'Este arquivo não é uma configuração do Tela P2P.');
    return { items: conteudo.items, created: String(conteudo.created || ''), appVersion: String(conteudo.appVersion || ''), novo: o.v > VERSAO };
  }

  // O que o arquivo traz, em linhas curtas, para conferir antes de aplicar
  function resumo(itens) {
    const linhas = [];
    const ler = (k) => { try { return JSON.parse(itens[k]); } catch { return null; } };
    if (itens['appPreferences.v1'] || itens.tema) {
      const p = ler('appPreferences.v1'), skin = Prefs.skins.find((s) => s.id && s.id === itens.tema);
      const t = p ? Prefs.themes.find((x) => x.id === Prefs.currentTheme(p)) : null;
      linhas.push(`Aparência: ${[skin?.label || 'tema Padrão', t ? `cores ${t.label}` : 'cores personalizadas'].join(', ')}`);
    }
    if (itens.name) linhas.push(`Nome: ${itens.name}`);
    if (itens.fotoPerfil) linhas.push('Foto de perfil');
    if (itens.fundoPerfil) linhas.push('Fundo do perfil');
    if (itens.vozConfig) linhas.push('Microfone e voz');
    const n = Object.keys(ler('volumes') || {}).length;
    if (n) linhas.push(n === 1 ? 'Volume de 1 pessoa' : `Volume de ${n} pessoas`);
    if (['workspaceViews.v1', 'stageLayout', 'vozVisao'].some((k) => itens[k])) linhas.push('Painéis e palco');
    if (['quality', 'encodeMode', 'audioMode', 'excludeApps'].some((k) => itens[k])) linhas.push('Opções de transmissão');
    if (itens.atalhos) linhas.push('Atalhos de teclado');
    return linhas;
  }

  return { APP, VERSAO, MAX, ITENS, CHAVES_LOCAIS, ATALHOS, juntar, limpar, cifrar, decifrar, resumo };
})();
if (typeof module !== 'undefined') module.exports = CelularModelo;
