'use strict';
// Lista de telas e janelas para transmitir: sem janelas repetidas.
// Alguns apps têm duas janelas de verdade com o mesmo conteúdo (o WhatsApp novo mostra "WhatsApp" e
// "(22) WhatsApp", a segunda com o número de mensagens não lidas no título). Na lista, viram uma só.

// "(22) WhatsApp" -> "WhatsApp": o contador de não lidas na frente do título não ajuda a escolher
function cleanTitle(name) {
  return String(name || '').replace(/^\(\d+\+?\)\s*/, '').trim() || String(name || '');
}

// Diferença média (0 a 255) entre duas miniaturas reduzidas ao mesmo tamanho, em tons de cinza
function thumbDiff(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// items: [{ id, name, sig }] na ordem do Windows (a da frente primeiro). sig: miniatura pequena em cinza.
// Duas janelas com o mesmo título (sem o contador) e quase a mesma imagem: fica a primeira.
const SAME = 10;
function dedupeWindows(items) {
  const kept = [];
  for (const item of items) {
    const isWindow = !String(item.id).startsWith('screen');
    const twin = isWindow && kept.find((k) => !String(k.id).startsWith('screen')
      && cleanTitle(k.name).toLowerCase() === cleanTitle(item.name).toLowerCase()
      && thumbDiff(k.sig, item.sig) <= SAME);
    if (!twin) kept.push(item);
  }
  return kept.map((k) => ({ ...k, name: String(k.id).startsWith('screen') ? k.name : cleanTitle(k.name) }));
}

// Miniatura do Electron (nativeImage) -> 32 x 18 em tons de cinza, para comparar
function thumbSignature(img) {
  const small = img.resize({ width: 32, height: 18 });
  const px = small.toBitmap(); // BGRA
  const out = new Array(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) out[j] = Math.round(px[i] * 0.114 + px[i + 1] * 0.587 + px[i + 2] * 0.299);
  return out;
}

module.exports = { cleanTitle, thumbDiff, dedupeWindows, thumbSignature };
