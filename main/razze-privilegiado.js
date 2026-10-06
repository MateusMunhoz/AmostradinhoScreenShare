'use strict';
// O que precisa de administrador no WireGuard: instalar e remover o serviço do túnel e trocar a lista de
// pessoas com o túnel ligado (wg syncconf). Roda direto quando o app já está como administrador, ou dentro
// do ajudante (razze-ajudante.js), que o app abre com a permissão do Windows.
//
// Os executáveis rodam de C:\Program Files\Tela P2P\WireGuard: o serviço do túnel roda como SYSTEM e guarda o
// caminho do wireguard.exe, então ele precisa ficar numa pasta em que só administrador escreve (no perfil ou na
// pasta temporária do .exe portátil, qualquer programa do usuário poderia trocar o arquivo).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const TUNNEL = /^Razze[a-f0-9]{12}$/;

function exec(file, args, timeout = 120_000) {
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
    const output = (String(stdout || '') + String(stderr || '')).trim();
    if (error) return reject(new Error(output || (error.killed ? 'O WireGuard excedeu o tempo limite.' : 'O WireGuard terminou com erro (' + (error.code ?? 'desconhecido') + ').')));
    resolve(output);
  }));
}

// wireguard e wg: os executáveis que vieram no app (numa atualização pela sala, o wg.exe vem no pacote e o
// wireguard.exe continua no .exe); tunnels: a pasta das configurações
function createPrivileged({ wireguard, wg, tunnels, destino = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tela P2P', 'WireGuard'), run = exec }) {
  const fontes = { 'wireguard.exe': wireguard, 'wg.exe': wg };
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

  // Copia (ou atualiza) o executável para a pasta protegida. Em uso por um túnel ligado, a cópia não troca:
  // continua valendo a que já está lá.
  function instalado(nome) {
    const src = fontes[nome];
    if (!src || !fs.existsSync(src)) throw new Error(nome + ' não foi encontrado no pacote do Nebula.');
    const dst = path.join(destino, nome);
    try {
      if (!fs.existsSync(dst) || hash(dst) !== hash(src)) {
        fs.mkdirSync(destino, { recursive: true });
        fs.copyFileSync(src, dst);
      }
    } catch (error) {
      if (!fs.existsSync(dst)) throw new Error('Não foi possível copiar o ' + nome + ' para ' + destino + ': ' + error.message);
    }
    return dst;
  }

  // Só arquivos da pasta dos túneis, com o nome que o app dá (nada de caminho vindo de fora)
  function config(file, sufixo) {
    const full = path.resolve(String(file || ''));
    const base = path.basename(full);
    if (path.dirname(full).toLowerCase() !== path.resolve(tunnels).toLowerCase() || !new RegExp('^Razze[a-f0-9]{12}' + sufixo.replace('.', '\\.') + '$').test(base)) {
      throw new Error('Configuração de túnel inválida.');
    }
    return full;
  }
  const tunnel = (name) => { if (!TUNNEL.test(String(name))) throw new Error('Nome de túnel inválido.'); return String(name); };

  return {
    // Confere o pedido antes de copiar qualquer coisa para o Program Files
    install: async (configPath) => { const args = ['/installtunnelservice', config(configPath, '.conf')]; return run(instalado('wireguard.exe'), args); },
    uninstall: async (name) => { const args = ['/uninstalltunnelservice', tunnel(name)]; return run(instalado('wireguard.exe'), args); },
    // Troca a lista de pessoas com o túnel ligado: as conexões de quem já estava não caem
    syncconf: async (name, configPath) => { const args = ['syncconf', tunnel(name), config(configPath, '.wg.conf')]; return run(instalado('wg.exe'), args); },
  };
}

module.exports = { createPrivileged, exec };
