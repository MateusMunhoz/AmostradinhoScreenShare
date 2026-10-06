'use strict';
// Configurações no celular, sem interface (docs/spec/config-no-celular.md): o que vai no arquivo, a validação de cada
// item ao trazer e a cifra (PBKDF2 + AES-GCM, pela WebCrypto). A cifra é feita aqui no PC: a página do celular só
// guarda e devolve o arquivo. Usado por renderer/celular.js e pelos testes (tests/celular.test.js).
// Nunca vão no arquivo: clientId (identifica este PC na sala), conta e chaves da Razze, endereço da sala e caches.
// Opcional (Configurações › Mensagens privadas): o texto das mensagens privadas da conta Razze, no item "mensagens".

const CelularModelo = (() => {
  // Até 16 MB: o histórico das mensagens privadas (opcional) é o maior item; sem ele, o fundo do perfil (GIF de até 1 MB)
  const APP = 'tela-p2p-config', VERSAO = 1, ITER = 600000, MAX = 16 * 1024 * 1024;
  const MENSAGENS_MAX = 8 * 1024 * 1024; // o histórico, em texto, antes de cifrar (cifrado e em base64, cresce um terço)
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
  const ATALHOS = ['edit', 'hideChat', 'compose', 'mute', 'deafen', 'clip'];
  const atalhos = (o) => {
    if (!objeto(o)) return null;
    const r = {};
    for (const k of ATALHOS) if (typeof o[k] === 'string' && o[k].length <= 60 && /^[\w+]*$/.test(o[k])) r[k] = o[k];
    return r;
  };
  // Mensagens privadas: { conta, conversas: [{ friend, name, messages }] }; o processo principal limpa de novo ao juntar
  const CONTA = /^[a-f0-9]{32}$/, MSG_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const anexo = (f) => (objeto(f) && MSG_ID.test(String(f.id)) && typeof f.name === 'string' && f.name.length <= 200 && typeof f.mime === 'string' && f.mime.length <= 100
    && Number.isInteger(f.size) && f.size >= 0 ? { id: f.id, name: f.name, size: f.size, mime: f.mime } : null);
  const mensagem = (m) => {
    if (!objeto(m) || !MSG_ID.test(String(m.id)) || !CONTA.test(String(m.from)) || typeof m.text !== 'string' || m.text.length > 2000 || !Number.isFinite(m.createdAt)) return null;
    const file = m.file ? anexo(m.file) : null;
    return { id: m.id, seq: Number.isFinite(m.seq) ? m.seq : 0, from: m.from, text: m.text, createdAt: m.createdAt,
      ...['e2e', 'plain', 'locked', 'keyChanged', 'direto'].reduce((o, k) => (m[k] === true ? { ...o, [k]: true } : o), {}), ...(file ? { file } : {}) };
  };
  const mensagens = (o) => {
    if (!objeto(o) || !CONTA.test(String(o.conta)) || !Array.isArray(o.conversas)) return null;
    const conversas = [];
    for (const c of o.conversas.slice(0, 2000)) {
      if (!objeto(c) || !CONTA.test(String(c.friend)) || !Array.isArray(c.messages)) continue;
      const messages = c.messages.slice(-10000).map(mensagem).filter(Boolean);
      if (messages.length) conversas.push({ friend: c.friend, name: typeof c.name === 'string' ? c.name.slice(0, 60) : '', messages });
    }
    return { conta: o.conta, conversas };
  };
  // Monta o item com as conversas deste PC; passando do limite, vão as mensagens mais novas. Devolve quantas ficaram de fora
  function mensagensBackup(conta, conversas, limite = MENSAGENS_MAX) {
    const todas = [];
    (Array.isArray(conversas) ? conversas : []).forEach((c, i) => { for (const m of c.messages || []) todas.push({ i, m, tam: JSON.stringify(m).length + 1 }); });
    todas.sort((a, b) => b.m.createdAt - a.m.createdAt);
    let usado = 0, cabem = 0;
    while (cabem < todas.length && usado + todas[cabem].tam <= limite) usado += todas[cabem++].tam;
    const ficam = new Set(todas.slice(0, cabem).map((x) => x.m));
    const lista = conversas.map((c) => ({ friend: c.friend, name: c.name || '', messages: (c.messages || []).filter((m) => ficam.has(m)) })).filter((c) => c.messages.length);
    return { item: JSON.stringify({ conta, conversas: lista }), fora: todas.length - cabem, total: todas.length };
  }

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
    quality: texto(12, /^[0-9a-z]+$/), encodeMode: um('per', 'once'), encodeMode2: um('per', 'once'), clipSeconds: um('15', '30', '60', '120'), audioMode: um('all', 'none', 'exclude'),
    mostrarMouse: um('0', '1'), priority: texto(12, /^[a-z]+$/),
    excludeApps: json((o) => (Array.isArray(o) ? o.filter((x) => typeof x === 'string' && x.length <= 260 && /^[^\\/:*?"<>|\u0000-\u001f]+$/.test(x)).slice(0, 100) : null)),
    atalhos: json(atalhos), // não fica no localStorage: vem e vai pelo processo principal (main/atalhos.js)
    mensagens: json(mensagens), // nem este: vem e vai pelo processo principal (main/mensagens.js)
  };
  const CHAVES_LOCAIS = Object.keys(ITENS).filter((k) => k !== 'atalhos' && k !== 'mensagens');

  // As configurações deste PC, como texto, só as chaves da lista
  function juntar(storage, keys, mensagensItem = '') {
    const itens = {};
    for (const k of CHAVES_LOCAIS) {
      let v = null;
      try { v = storage.getItem(k); } catch {}
      if (typeof v === 'string') itens[k] = v;
    }
    if (objeto(keys)) itens.atalhos = JSON.stringify(atalhos(keys));
    if (mensagensItem) itens.mensagens = mensagensItem;
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
    if (texto.length > MAX) throw new Error('As configurações passaram de 16 MB.');
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
      throw erro('formato', 'Este arquivo não é uma configuração do Nebula.');
    }
    let claro;
    try {
      const k = await chave(String(senha), deBase64(o.kdf.salt), o.kdf.iterations);
      claro = await subtle().decrypt({ name: 'AES-GCM', iv: deBase64(o.cipher.iv) }, k, deBase64(o.data));
    } catch { throw erro('senha', 'Senha errada (ou o arquivo foi alterado).'); }
    let conteudo;
    try { conteudo = JSON.parse(new TextDecoder().decode(claro)); } catch { conteudo = null; }
    if (!objeto(conteudo) || !objeto(conteudo.items)) throw erro('formato', 'Este arquivo não é uma configuração do Nebula.');
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
    if (['quality', 'encodeMode', 'encodeMode2', 'clipSeconds', 'audioMode', 'excludeApps'].some((k) => itens[k])) linhas.push('Opções de transmissão');
    if (itens.atalhos) linhas.push('Atalhos de teclado');
    const conversas = ler('mensagens')?.conversas?.length || 0;
    if (conversas) linhas.push(conversas === 1 ? 'Mensagens privadas: 1 conversa' : `Mensagens privadas: ${conversas} conversas`);
    return linhas;
  }

  return { APP, VERSAO, MAX, MENSAGENS_MAX, ITENS, CHAVES_LOCAIS, ATALHOS, juntar, limpar, cifrar, decifrar, resumo, mensagensBackup };
})();
if (typeof module !== 'undefined') module.exports = CelularModelo;
