'use strict';
// Histórico das mensagens diretas neste PC: um arquivo por amigo, em %APPDATA%\Tela P2P\mensagens\<conta>\<amigo>.json.
// Fechar a conversa na barra não apaga nada: ao abrir de novo, ela volta daqui. O servidor Razze só guarda 30 dias.
// Com o safeStorage (a proteção da conta do Windows), o arquivo fica cifrado: { v: 2, sealed }. Arquivo antigo, em
// texto, ainda abre e passa a ser cifrado na próxima gravação.
// Prazo (Configurações › Mensagens privadas): para sempre (0) ou 30 dias; o que passa do prazo sai ao ler e ao gravar.
// Imagens que chegaram pela conexão direta ficam em <conta>/anexos/<id>, também cifradas, e seguem o mesmo prazo.
// Backup no celular: exportar devolve o texto das conversas; importar junta pela id (nada é apagado).
const fs = require('node:fs');
const path = require('node:path');

const ID = /^[a-f0-9]{32}$/;
const MSG_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEEP = 10000; // mensagens por conversa guardadas no PC
const DAY = 24 * 60 * 60 * 1000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const IMAGE_MAX = 8 * 1024 * 1024;
const IMPORT_MAX = 2000; // conversas num backup

function cleanFile(f) {
  if (!f || typeof f !== 'object' || !MSG_ID.test(String(f.id))) return null;
  const size = Number(f.size);
  if (!Number.isFinite(size) || size < 0 || size > 1024 * 1024 * 1024) return null;
  return { id: String(f.id), name: String(f.name || 'arquivo').replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'arquivo', size, mime: String(f.mime || '').slice(0, 100) };
}

function createDmStore(baseDir, { storage = null, now = () => Date.now() } = {}) {
  let retentionDays = 0;
  const sealedOk = () => { try { return !!storage?.isEncryptionAvailable(); } catch { return false; } };
  const dirOf = (account) => {
    if (!ID.test(String(account))) throw new Error('Conta inválida.');
    return path.join(baseDir, String(account));
  };
  const fileOf = (account, friend) => {
    if (!ID.test(String(friend))) throw new Error('Amigo inválido.');
    return path.join(dirOf(account), `${friend}.json`);
  };
  const anexoOf = (account, id) => {
    if (!MSG_ID.test(String(id))) throw new Error('Anexo inválido.');
    return path.join(dirOf(account), 'anexos', String(id));
  };
  const cutoff = () => (retentionDays ? now() - retentionDays * DAY : 0);
  const clean = (m) => {
    if (!m || typeof m.id !== 'string' || typeof m.text !== 'string' || !ID.test(String(m.from))) return null;
    const file = m.file ? cleanFile(m.file) : null;
    return { id: m.id.slice(0, 64), seq: Number(m.seq) || 0, from: String(m.from), text: m.text.slice(0, 2000), createdAt: Number(m.createdAt) || 0,
      ...(m.e2e ? { e2e: true } : {}), ...(m.plain ? { plain: true } : {}), ...(m.locked ? { locked: true } : {}), ...(m.keyChanged ? { keyChanged: true } : {}),
      ...(m.direto ? { direto: true } : {}), ...(file ? { file } : {}) };
  };
  const fresh = (m) => !cutoff() || m.createdAt >= cutoff();
  const seal = (json) => (sealedOk() ? JSON.stringify({ v: 2, sealed: storage.encryptString(json).toString('base64') }) : json);
  const unseal = (raw) => { const data = JSON.parse(raw); return data && data.v === 2 ? JSON.parse(storage.decryptString(Buffer.from(String(data.sealed), 'base64'))) : data; };
  // Troca o arquivo de uma vez: um arquivo pela metade nunca fica no lugar do bom
  function writeAtomic(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function load(account, friend) {
    try {
      const data = unseal(fs.readFileSync(fileOf(account, friend), 'utf8'));
      return { name: typeof data.name === 'string' ? data.name.slice(0, 60) : '', messages: (Array.isArray(data.messages) ? data.messages : []).map(clean).filter(Boolean).filter(fresh) };
    } catch { return { name: '', messages: [] }; }
  }

  // Grava a conversa inteira
  function save(account, friend, data) {
    const file = fileOf(account, friend);
    const messages = (Array.isArray(data?.messages) ? data.messages : []).map(clean).filter(Boolean).filter(fresh).slice(-KEEP);
    writeAtomic(file, seal(JSON.stringify({ friend, name: String(data?.name || '').slice(0, 60), messages })));
    return true;
  }

  function friendsOf(account) {
    let names;
    try { names = fs.readdirSync(dirOf(account)); } catch { return []; }
    return names.filter((n) => n.endsWith('.json') && ID.test(n.replace(/\.json$/, ''))).map((n) => n.replace(/\.json$/, ''));
  }
  // As conversas que existem neste PC, com a última mensagem de cada uma (para a lista do HUB)
  function list(account) {
    const out = [];
    for (const friend of friendsOf(account)) {
      const { name, messages } = load(account, friend);
      if (messages.length) out.push({ friend, name, last: messages.at(-1) });
    }
    return out;
  }

  // ---------- Prazo ----------
  // 0 = para sempre; 30 = apaga o que tiver mais de 30 dias (mensagens e imagens guardadas)
  function setRetention(days, account = '') {
    retentionDays = Number(days) === 30 ? 30 : 0;
    if (retentionDays && ID.test(String(account))) prune(account);
    return retentionDays;
  }
  function prune(account) {
    if (!cutoff()) return;
    for (const friend of friendsOf(account)) {
      const { name, messages } = load(account, friend); // load já tira o que passou do prazo
      try { save(account, friend, { name, messages }); } catch {}
    }
    const dir = path.join(dirOf(account), 'anexos');
    let files = [];
    try { files = fs.readdirSync(dir); } catch {}
    for (const n of files) {
      try { if (fs.statSync(path.join(dir, n)).mtimeMs < cutoff()) fs.rmSync(path.join(dir, n), { force: true }); } catch {}
    }
  }

  // ---------- Imagens recebidas (e enviadas) pela conexão direta ----------
  function saveImage(account, id, mime, bytes) {
    if (!IMAGE_TYPES.includes(String(mime))) throw new Error('Só imagens ficam guardadas.');
    const buf = Buffer.from(bytes || []);
    if (!buf.length || buf.length > IMAGE_MAX) throw new Error('Imagem grande demais para guardar.');
    writeAtomic(anexoOf(account, id), seal(JSON.stringify({ mime, data: buf.toString('base64') })));
    return true;
  }
  function loadImage(account, id) {
    try {
      const file = anexoOf(account, id);
      if (cutoff() && fs.statSync(file).mtimeMs < cutoff()) return null;
      const data = unseal(fs.readFileSync(file, 'utf8'));
      if (!IMAGE_TYPES.includes(data?.mime) || typeof data.data !== 'string') return null;
      return { mime: data.mime, bytes: new Uint8Array(Buffer.from(data.data, 'base64')) };
    } catch { return null; }
  }

  // ---------- Backup no celular ----------
  function exportAll(account) {
    return friendsOf(account).map((friend) => ({ friend, ...load(account, friend) })).filter((c) => c.messages.length);
  }
  // Junta as conversas do backup com as deste PC (pela id); devolve quantas mensagens entraram
  function importAll(account, convs) {
    dirOf(account);
    let added = 0;
    for (const c of (Array.isArray(convs) ? convs : []).slice(0, IMPORT_MAX)) {
      if (!c || !ID.test(String(c.friend))) continue;
      const cur = load(account, c.friend);
      const byId = new Map(cur.messages.map((m) => [m.id, m]));
      for (const m of (Array.isArray(c.messages) ? c.messages : []).slice(0, KEEP).map(clean).filter(Boolean).filter(fresh)) {
        if (!byId.has(m.id)) { byId.set(m.id, m); added++; }
      }
      const messages = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
      save(account, c.friend, { name: cur.name || String(c.name || ''), messages });
    }
    return added;
  }

  return { load, save, list, setRetention, saveImage, loadImage, exportAll, importAll };
}

module.exports = { createDmStore };
