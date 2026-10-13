'use strict';
// Apoiar o Nebula com Pix (docs/spec/plano-premium.md, etapa do apoio voluntário): coração na barra lateral e o botão
// "Apoiar" sempre à vista no topo do Início. Os dois abrem a janela com o QR, o Pix copia e cola e a chave.
// Nada passa pelo app nem pela RazzeAPI: o Pix vai do banco de quem apoia direto para a conta abaixo.
// O código do Pix (BR Code, padrão EMV do Banco Central) é montado aqui; pixBrCode também roda no Node, nos testes.
// Script clássico: só declara; quem liga é renderer/inicio.js (setupApoio). Usa: util ($, toast, setIcon, copiar),
// qr (qrSvg).

// Quem recebe. Vazio: o coração e o botão "Apoiar" não aparecem. A chave fica pública (no código e no QR): use a aleatória.
const APOIO_PIX = { chave: 'dc3507fa-798f-4593-9ede-2908302d7058', nome: 'CRISTIAN D VILELA', cidade: 'RIO DE JANEIR' };
const APOIO_VALORES = [5, 10, 20, 50]; // em reais; "Outro" deixa o valor para quem paga digitar no banco

// Campo EMV: id de 2 dígitos, tamanho de 2 dígitos e o valor
function pixCampo(id, valor) { return id + String(valor.length).padStart(2, '0') + valor; }

// Nome e cidade no BR Code: sem acento, em maiúsculas e só caracteres comuns (os bancos recusam o resto)
function pixTexto(texto, max) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .-]/g, '').trim().toUpperCase().slice(0, max);
}

// CRC16-CCITT (polinômio 0x1021, início 0xFFFF), em 4 dígitos hexadecimais maiúsculos
function pixCrc(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Pix estático (copia e cola). valor em reais (opcional): sem ele, quem paga escolhe no banco
function pixBrCode({ chave, nome, cidade, valor }) {
  chave = String(chave || '').trim();
  nome = pixTexto(nome, 25);
  cidade = pixTexto(cidade, 15);
  if (!chave || chave.length > 77 || !nome || !cidade) return '';
  const centavos = Math.round(Number(valor) * 100);
  let s = pixCampo('00', '01')
    + pixCampo('26', pixCampo('00', 'br.gov.bcb.pix') + pixCampo('01', chave))
    + pixCampo('52', '0000')
    + pixCampo('53', '986')
    + (Number.isFinite(centavos) && centavos > 0 ? pixCampo('54', (centavos / 100).toFixed(2)) : '')
    + pixCampo('58', 'BR')
    + pixCampo('59', nome)
    + pixCampo('60', cidade)
    + pixCampo('62', pixCampo('05', '***'))
    + '6304';
  return s + pixCrc(s);
}

const apoio = { valor: 0, voltarFoco: null };

function apoioConfigurado() { return !!pixBrCode(APOIO_PIX); }

function apoioRenderValor() {
  const codigo = pixBrCode({ ...APOIO_PIX, valor: apoio.valor });
  $('apoioQr').innerHTML = qrSvg(codigo); // SVG gerado aqui (renderer/qr.js), sem dado de fora
  $('apoioCodigo').value = codigo;
  $('apoioValorHint').textContent = apoio.valor ? `R$ ${apoio.valor},00` : 'Você escolhe o valor no banco';
  for (const b of $('apoioValores').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.valor) === apoio.valor));
}

function abrirApoio(origem) {
  apoio.voltarFoco = origem || document.activeElement;
  $('apoioDialog').hidden = false;
  $('navApoio').setAttribute('aria-expanded', 'true');
  apoioRenderValor();
  $('apoioCopiar').focus();
}
function fecharApoio() {
  $('apoioDialog').hidden = true;
  $('navApoio').setAttribute('aria-expanded', 'false');
  (apoio.voltarFoco && document.contains(apoio.voltarFoco) ? apoio.voltarFoco : $('navApoio')).focus();
}

async function apoioCopiar(texto, aviso) {
  try { await copiar(texto); toast(aviso); } catch { toast('Não deu para copiar. Selecione e copie com Ctrl+C.', 'error'); }
}

function setupApoio() {
  const ok = apoioConfigurado();
  $('navApoio').hidden = !ok;
  $('homeApoio').hidden = !ok;
  if (!ok) return;
  setIcon($('apoioClose'), 'close', 'Fechar');
  $('apoioChave').textContent = APOIO_PIX.chave;
  $('apoioNome').textContent = pixTexto(APOIO_PIX.nome, 25);
  const valores = $('apoioValores');
  valores.textContent = '';
  for (const v of [...APOIO_VALORES, 0]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'apoio-valor';
    b.dataset.valor = String(v);
    b.textContent = v ? `R$ ${v}` : 'Outro';
    b.onclick = () => { apoio.valor = v; apoioRenderValor(); };
    valores.append(b);
  }
  $('navApoio').onclick = () => ($('apoioDialog').hidden ? abrirApoio($('navApoio')) : fecharApoio());
  $('homeApoio').onclick = () => abrirApoio($('homeApoio'));
  $('apoioClose').onclick = fecharApoio;
  $('apoioCopiar').onclick = () => void apoioCopiar($('apoioCodigo').value, 'Pix copia e cola copiado. Cole no app do seu banco.');
  $('apoioCopiarChave').onclick = () => void apoioCopiar(APOIO_PIX.chave, 'Chave Pix copiada.');
  $('apoioCodigo').onfocus = () => $('apoioCodigo').select();
  $('apoioDialog').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); fecharApoio(); } });
  $('apoioDialog').addEventListener('mousedown', (e) => { if (e.target === $('apoioDialog')) fecharApoio(); });
}

if (typeof module !== 'undefined') module.exports = { APOIO_PIX, pixBrCode, pixCrc, pixTexto };
