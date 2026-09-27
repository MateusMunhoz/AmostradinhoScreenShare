'use strict';

// Integração opcional com o agente NetBird já instalado. O agente, e não o Electron,
// mantém o túnel WireGuard e o serviço de sistema.
const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

let cachedStatus = null;
let cachedAt = 0;

function executable() {
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'bin', 'selfvpn', 'netbird.exe') : '',
    !app.isPackaged ? path.join(app.getAppPath(), 'bin', 'selfvpn', 'netbird.exe') : '',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NetBird', 'netbird.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NetBird', 'netbird.exe'),
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function run(args, timeout = 15000) {
  const file = executable();
  if (!file) return Promise.resolve({ ok: false, error: 'O agente NetBird não está instalado.' });
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`.trim();
      resolve(err
        ? { ok: false, error: output || (err.killed ? 'O comando do NetBird expirou.' : `O NetBird encerrou com código ${err.code ?? 'desconhecido'}.`) }
        : { ok: true, output });
    });
  });
}

function parseStatus(output) {
  // `status -d` lista primeiro os pares e só depois mostra o IP local do cliente.
  const ips = [...output.matchAll(/NetBird IP:\s*([\d.]+)(?:\/\d+)?/gi)];
  const ip = ips.at(-1)?.[1] || '';
  const managementUrl = /Management:\s*Connected to\s+(https?:\/\/[^\s]+)/i.exec(output)?.[1] || '';
  const connected = /Daemon status:\s*Connected/i.test(output) || (/Management:\s*Connected/i.test(output) && !!ip);
  return { installed: true, connected, ip, managementUrl };
}

async function status(force = false) {
  if (!force && cachedStatus && Date.now() - cachedAt < 3000) return cachedStatus;
  if (!executable()) return { installed: false, connected: false, ip: '', error: 'O agente NetBird não está instalado.' };
  const result = await run(['status', '-d'], 30000);
  const value = result.ok
    ? parseStatus(result.output)
    : { installed: true, connected: false, ip: '', error: result.error };
  cachedStatus = value;
  cachedAt = Date.now();
  return value;
}

function managementUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return ''; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return '';
  if (url.username || url.password || url.search || url.hash) return '';
  return url.origin;
}

async function connect(value, setupKey = '') {
  const url = managementUrl(value);
  if (!url) return { ok: false, error: 'Informe um endereço HTTPS válido para o servidor NetBird.' };
  if (!executable()) return { ok: false, error: 'Instale o agente NetBird neste PC antes de conectar.' };
  const args = ['up', '--management-url', url];
  if (typeof setupKey === 'string' && setupKey.trim()) args.push('--setup-key', setupKey.trim());
  const result = await run(args, 120000);
  cachedStatus = null;
  if (!result.ok) return result;
  const current = await status(true);
  let connectedTo = '';
  try { connectedTo = new URL(current.managementUrl).origin; } catch {}
  return current.connected && connectedTo === url
    ? { ok: true, status: current }
    : { ok: false, error: current.connected ? 'O NetBird continua conectado a outro servidor. Desconecte-o e tente novamente.' : current.error || 'O NetBird recebeu o pedido, mas ainda não confirmou a conexão.', status: current };
}

async function disconnect() {
  if (!executable()) return { ok: false, error: 'O agente NetBird não está instalado.' };
  const result = await run(['down']);
  cachedStatus = null;
  return result.ok ? { ok: true, status: await status(true) } : result;
}

module.exports = { status, connect, disconnect };
