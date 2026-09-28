'use strict';
// Faz as operações do WireGuard que precisam de administrador. Com o app já como administrador, faz direto.
// Senão, abre o ajudante (razze-ajudante.js) uma vez, com a janela de permissão do Windows, e manda os pedidos
// para ele por um pipe. O ajudante continua aberto até o app fechar, então a permissão é pedida uma vez só.
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createPrivileged } = require('./razze-privilegiado');

let elevadoCache = null;
// "net session" só funciona como administrador
function appElevado() {
  if (elevadoCache === null) {
    try { elevadoCache = spawnSync('net', ['session'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }).status === 0; }
    catch { elevadoCache = false; }
  }
  return elevadoCache;
}

const ps = (value) => "'" + String(value).replace(/'/g, "''") + "'";

// wireguard, wg: os executáveis que vieram no app; tunnels: a pasta das configurações
function createElevation({ wireguard, wg, tunnels, execPath = process.execPath, elevado = appElevado, launch = null, timeoutMs = 120_000 }) {
  let direto = null;
  let conn = null;
  let starting = null;
  let nextId = 1;
  const pending = new Map();

  function abrirAjudante() {
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      const pipe = '\\\\.\\pipe\\tela-p2p-razze-' + crypto.randomBytes(16).toString('hex');
      let done = false;
      const fim = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        server.close();
        starting = null;
        error ? reject(error) : resolve();
      };
      const server = net.createServer((socket) => {
        if (conn || done) return socket.destroy(); // só a primeira conexão (a do ajudante) vale
        conn = socket;
        let buffer = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n')) !== -1) {
            let msg;
            try { msg = JSON.parse(buffer.slice(0, end)); } catch { msg = null; }
            buffer = buffer.slice(end + 1);
            const p = msg && pending.get(msg.id);
            if (!p) continue;
            pending.delete(msg.id);
            msg.ok ? p.resolve(msg.output || '') : p.reject(new Error(msg.error || 'O ajudante do WireGuard recusou o pedido.'));
          }
        });
        socket.on('close', () => {
          if (conn === socket) conn = null;
          for (const p of pending.values()) p.reject(new Error('O ajudante do WireGuard fechou.'));
          pending.clear();
        });
        socket.on('error', () => {});
        fim();
      });
      server.on('error', (error) => fim(error));
      const timer = setTimeout(() => fim(new Error('A permissão de administrador não foi dada a tempo.')), timeoutMs);
      server.listen(pipe, () => {
        const args = [path.join(__dirname, 'razze-ajudante.js'), pipe, wireguard, wg, tunnels];
        if (launch) return launch(execPath, args, fim);
        // PowerShell com permissão de administrador (a janela do UAC), rodando o próprio Electron como Node
        const inner = "$env:ELECTRON_RUN_AS_NODE='1'; & " + ps(execPath) + ' ' + args.map(ps).join(' ');
        const encoded = Buffer.from(inner, 'utf16le').toString('base64');
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
          "Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-WindowStyle','Hidden','-EncodedCommand','" + encoded + "'"],
        { windowsHide: true, stdio: 'ignore' });
        child.on('error', (error) => fim(error));
        child.on('exit', (code) => { if (code) fim(new Error('A permissão de administrador foi negada. Sem ela o Windows não deixa criar a VPN.')); });
      });
    });
    return starting;
  }

  async function pedir(op, payload) {
    if (elevado()) {
      direto = direto || createPrivileged({ wireguard, wg, tunnels });
      return op === 'install' ? direto.install(payload.config) : op === 'uninstall' ? direto.uninstall(payload.tunnel) : direto.syncconf(payload.tunnel, payload.config);
    }
    if (!conn) await abrirAjudante();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      conn.write(JSON.stringify({ id, op, ...payload }) + '\n');
    });
  }

  return {
    install: (config) => pedir('install', { config }),
    uninstall: (tunnel) => pedir('uninstall', { tunnel }),
    syncconf: (tunnel, config) => pedir('syncconf', { tunnel, config }),
    close: () => { if (conn) conn.destroy(); },
  };
}

module.exports = { createElevation, appElevado };
