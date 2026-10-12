'use strict';

// Verificação em dois fatores por app autenticador (docs/spec/email-e-dois-fatores.md): TOTP da RFC 6238 (6 dígitos,
// 30 s, HMAC-SHA1), o que o Google Authenticator, o Microsoft Authenticator e os outros entendem. A chave fica cifrada
// no banco com AES-256-GCM (RAZZE_TOTP_KEY).
const { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const PASSO_S = 30;
const DIGITOS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(buf) {
  let bits = 0, valor = 0, out = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(valor << (5 - bits)) & 31];
  return out;
}

function deBase32(texto) {
  const limpo = String(texto || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, valor = 0;
  const out = [];
  for (const ch of limpo) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('base32 inválido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// Código de um passo (contador) para a chave
function codigo(chave, passo) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', chave).update(contador).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

const passoDe = (agoraMs) => Math.floor(agoraMs / 1000 / PASSO_S);

// Confere o código aceitando o passo anterior e o seguinte (relógio do celular fora de hora). Devolve o passo que bateu
// (para não aceitar o mesmo código duas vezes) ou -1.
function conferir(chave, texto, agoraMs, ultimoPasso = -1) {
  const dado = String(texto || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(dado)) return -1;
  const atual = passoDe(agoraMs);
  for (const passo of [atual - 1, atual, atual + 1]) {
    if (passo <= ultimoPasso) continue;
    const esperado = Buffer.from(codigo(chave, passo));
    if (timingSafeEqual(esperado, Buffer.from(dado))) return passo;
  }
  return -1;
}

const novaChave = () => randomBytes(20);

// Endereço que o QR code leva para o app autenticador
function enderecoOtpauth(chave, conta, emissor = 'Nebula') {
  const rotulo = encodeURIComponent(emissor + ':' + conta);
  return 'otpauth://totp/' + rotulo + '?secret=' + base32(chave) + '&issuer=' + encodeURIComponent(emissor) + '&algorithm=SHA1&digits=' + DIGITOS + '&period=' + PASSO_S;
}

// Cifra da chave guardada: a chave mestra vem de RAZZE_TOTP_KEY (qualquer texto longo; vira 32 bytes pelo SHA-256)
function criarCofre(segredo) {
  const mestra = segredo ? createHash('sha256').update(String(segredo)).digest() : null;
  return {
    pronto: !!mestra,
    fechar(chave) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', mestra, iv);
      const dados = Buffer.concat([c.update(chave), c.final()]);
      return 'v1:' + Buffer.concat([iv, c.getAuthTag(), dados]).toString('base64');
    },
    abrir(texto) {
      const bruto = Buffer.from(String(texto).replace(/^v1:/, ''), 'base64');
      const d = createDecipheriv('aes-256-gcm', mestra, bruto.subarray(0, 12));
      d.setAuthTag(bruto.subarray(12, 28));
      return Buffer.concat([d.update(bruto.subarray(28)), d.final()]);
    },
  };
}

// Códigos de recuperação: 10 de uso único, no formato ABCD-EFGH (sem 0/O/1/I/L)
const ALFABETO_REC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function codigosDeRecuperacao(n = 10) {
  const lista = [];
  while (lista.length < n) {
    let c = '';
    while (c.length < 8) { const [x] = randomBytes(1); if (x < 248) c += ALFABETO_REC[x % ALFABETO_REC.length]; }
    lista.push(c.slice(0, 4) + '-' + c.slice(4));
  }
  return lista;
}
const normalizarRecuperacao = (texto) => String(texto || '').toUpperCase().replace(/[\s-]/g, '');

module.exports = { base32, deBase32, codigo, conferir, passoDe, novaChave, enderecoOtpauth, criarCofre, codigosDeRecuperacao, normalizarRecuperacao, PASSO_S };
