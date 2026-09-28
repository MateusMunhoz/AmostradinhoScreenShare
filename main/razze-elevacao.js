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

// ---------- Linux ----------
// O túnel é uma interface WireGuard do kernel (ip + wg). Um shell como root, aberto uma vez pelo pkexec (a
// janela de senha do sistema), recebe um pedido por linha e responde "OK" ou "ERR motivo" na mesma ordem.
// Ele confere tudo de novo: nome rz + 12 letras, endereço 10.x.x.x/24 e arquivo na pasta dos túneis ($1).
const SCRIPT_LINUX = `
T="$1"
ok_nome() { case "$1" in rz[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) [ \${#1} -eq 14 ];; *) return 1;; esac; }
ok_arq() { r="\${1#"$T"/}"; [ "$r" != "$1" ] || return 1; case "$r" in */*) return 1;; rz????????????.wg.conf) return 0;; *) return 1;; esac; }
ok_end() { case "$1" in 10.[0-9]*.[0-9]*.[0-9]*/24) case "$1" in *[!0-9./]*) return 1;; esac;; *) return 1;; esac; }
resp() { if out=$("$@" 2>&1); then echo OK; else echo "ERR $(printf %s "$out" | tr '\n' ' ')"; fi; }
ligar() { ip link del dev "$1" 2>/dev/null; ip link add dev "$1" type wireguard && wg setconf "$1" "$3" && ip address add "$2" dev "$1" && ip link set dev "$1" mtu 1380 up; }
while IFS=' ' read -r op a b c; do
  ok_nome "$a" || { echo "ERR Nome de túnel inválido."; continue; }
  case "$op" in
    install) ok_end "$b" && ok_arq "$c" || { echo "ERR Pedido inválido."; continue; }; resp ligar "$a" "$b" "$c";;
    uninstall) resp ip link del dev "$a";;
    syncconf) ok_arq "$b" || { echo "ERR Pedido inválido."; continue; }; resp wg syncconf "$a" "$b";;
    *) echo "ERR Operação desconhecida.";;
  esac
done
`;

function createElevationLinux({ tunnels, spawnHelper = null }) {
  let proc = null;
  let starting = null;
  const fila = []; // respostas esperadas, na ordem
  let buffer = '';

  function abrir() {
    if (proc) return Promise.resolve();
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      const args = ['/bin/sh', '-c', SCRIPT_LINUX, 'sh', tunnels];
      // Já como root, não precisa da janela de senha
      const p = spawnHelper ? spawnHelper(args) : typeof process.getuid === 'function' && process.getuid() === 0
        ? spawn(args[0], args.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn('pkexec', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let erro = '';
      p.stderr.on('data', (d) => { erro += d; });
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end).trim();
          buffer = buffer.slice(end + 1);
          const q = fila.shift();
          if (!q) continue;
          line === 'OK' ? q.resolve('') : q.reject(new Error(line.replace(/^ERR\s*/, '') || 'O ajudante do WireGuard recusou o pedido.'));
        }
      });
      p.on('error', (e) => { starting = null; reject(new Error(e.code === 'ENOENT' ? 'O pkexec não está instalado (sudo apt install pkexec).' : e.message)); });
      p.on('exit', (code) => {
        if (proc === p) proc = null;
        starting = null;
        // pkexec: 126 = a pessoa cancelou a janela de senha; 127 = sem permissão
        const motivo = code === 126 || code === 127 ? 'A permissão de administrador foi negada. Sem ela o Linux não deixa criar a VPN.' : 'O ajudante do WireGuard fechou.' + (erro ? ' ' + erro.trim() : '');
        for (const q of fila.splice(0)) q.reject(new Error(motivo));
        reject(new Error(motivo));
      });
      proc = p;
      starting = null;
      resolve();
    });
    return starting;
  }

  async function pedir(linha) {
    await abrir();
    return new Promise((resolve, reject) => {
      fila.push({ resolve, reject });
      proc.stdin.write(linha + '\n');
    });
  }

  // install(configPath, { tunnel, address }): o wg não aceita os campos do wg-quick; o arquivo sem eles
  // fica só o tempo de o túnel ler
  async function install(configPath, { tunnel, address } = {}) {
    const sync = String(configPath).replace(/\.conf$/, '.wg.conf');
    const { wgSyncConfig } = require('./razze-wireguard');
    require('node:fs').writeFileSync(sync, wgSyncConfig(require('node:fs').readFileSync(configPath, 'utf8')), { mode: 0o600 });
    try { return await pedir(['install', tunnel, address, sync].join(' ')); }
    finally { require('node:fs').rmSync(sync, { force: true }); }
  }

  return {
    install,
    uninstall: (tunnel) => pedir(['uninstall', tunnel].join(' ')),
    syncconf: (tunnel, config) => pedir(['syncconf', tunnel, config].join(' ')),
    close: () => { if (proc) proc.stdin.end(); },
  };
}

module.exports = { createElevation, createElevationLinux, appElevado, SCRIPT_LINUX };
