'use strict';
// Histórico das mensagens diretas neste PC: um arquivo por amigo, em %APPDATA%\Tela P2P\mensagens\<conta>\<amigo>.json.
// Fechar a conversa na barra não apaga nada: ao abrir de novo, ela volta daqui. O servidor Razze só guarda 30 dias.
const fs = require('node:fs');
const path = require('node:path');

const ID = /^[a-f0-9]{32}$/;
const KEEP = 10000; // mensagens por conversa guardadas no PC

function createDmStore(baseDir) {
  const dirOf = (account) => {
    if (!ID.test(String(account))) throw new Error('Conta inválida.');
    return path.join(baseDir, String(account));
  };
  const fileOf = (account, friend) => {
    if (!ID.test(String(friend))) throw new Error('Amigo inválido.');
    return path.join(dirOf(account), `${friend}.json`);
  };
  const clean = (m) => (m && typeof m.id === 'string' && typeof m.text === 'string' && ID.test(String(m.from))
    ? { id: m.id.slice(0, 64), seq: Number(m.seq) || 0, from: String(m.from), text: m.text.slice(0, 2000), createdAt: Number(m.createdAt) || 0 } : null);

  function load(account, friend) {
    try {
      const data = JSON.parse(fs.readFileSync(fileOf(account, friend), 'utf8'));
      return { name: typeof data.name === 'string' ? data.name.slice(0, 60) : '', messages: (Array.isArray(data.messages) ? data.messages : []).map(clean).filter(Boolean) };
    } catch { return { name: '', messages: [] }; }
  }

  // Grava a conversa inteira (troca o arquivo de uma vez: um arquivo pela metade nunca fica no lugar do bom)
  function save(account, friend, data) {
    const file = fileOf(account, friend);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const messages = (Array.isArray(data?.messages) ? data.messages : []).map(clean).filter(Boolean).slice(-KEEP);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ friend, name: String(data?.name || '').slice(0, 60), messages }));
    fs.renameSync(tmp, file);
    return true;
  }

  // As conversas que existem neste PC, com a última mensagem de cada uma (para a lista do HUB)
  function list(account) {
    let names;
    try { names = fs.readdirSync(dirOf(account)); } catch { return []; }
    const out = [];
    for (const n of names) {
      const friend = n.replace(/\.json$/, '');
      if (!ID.test(friend) || !n.endsWith('.json')) continue;
      const { name, messages } = load(account, friend);
      if (messages.length) out.push({ friend, name, last: messages.at(-1) });
    }
    return out;
  }

  return { load, save, list };
}

module.exports = { createDmStore };
