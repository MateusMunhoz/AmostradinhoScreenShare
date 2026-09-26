'use strict';
const crypto = require('node:crypto');
const net = require('node:net');

const NETWORK = '10.77.0.0/24';
const GATEWAY = '10.77.0.1';
const INTERFACE = 'TelaP2PSelfVPN';
function key(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value) ||
      Buffer.from(value, 'base64').length !== 32 || Buffer.from(value, 'base64').toString('base64') !== value ||
      Buffer.from(value, 'base64').every(b => b === 0)) throw new Error('Chave WireGuard inválida.');
  return value;
}
function endpoint(value) {
  if (typeof value !== 'string' || value.length > 260) throw new Error('Endpoint inválido.');
  const match = /^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?):([0-9]{1,5})$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535 ||
      (match[1].startsWith('[') && net.isIP(match[1].slice(1, -1)) !== 6)) throw new Error('Endpoint inválido.');
  return value;
}
function origin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Endereço HTTPS do servidor inválido.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('O servidor deve ser uma origem HTTPS, sem caminho ou credenciais.');
  }
  return url.origin;
}
function parseInvite(text) {
  if (typeof text !== 'string' || text.length > 2048 || !text.trim().startsWith('selfvpn:')) throw new Error('Convite inválido.');
  let data;
  try { data = JSON.parse(Buffer.from(text.trim().slice(8), 'base64url').toString('utf8')); }
  catch { throw new Error('Convite inválido.'); }
  if (!data || data.v !== 1 || typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw new Error('Convite inválido.');
  return { server: origin(data.server), token: data.token };
}
function profile(data) {
  if (!data || data.network !== NETWORK || data.gateway !== GATEWAY ||
      !/^10\.77\.0\.(?:[2-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/.test(data.address)) {
    throw new Error('Configuração de rede inválida: esperado um IP de cliente em 10.77.0.0/24.');
  }
  return { network: NETWORK, gateway: GATEWAY, address: data.address,
    serverKey: key(data.serverKey), endpoint: endpoint(data.endpoint) };
}
function identity() {
  const pair = crypto.generateKeyPairSync('x25519');
  const privateKey = Buffer.from(pair.privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64');
  const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  return { privateKey, publicKey };
}
function config(data, privateKey) {
  const p = profile(data);
  return `[Interface]\nPrivateKey = ${key(privateKey)}\nAddress = ${p.address}/32\nMTU = 1280\n\n[Peer]\nPublicKey = ${p.serverKey}\nEndpoint = ${p.endpoint}\nAllowedIPs = ${NETWORK}\nPersistentKeepalive = 25\n`;
}
module.exports = { NETWORK, GATEWAY, INTERFACE, key, endpoint, origin, parseInvite, profile, identity, config };
