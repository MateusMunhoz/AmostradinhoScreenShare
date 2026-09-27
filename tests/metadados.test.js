// Fotos saem sem metadados (renderer/metadados.js): arquivos montados à mão, com GPS e texto em todo canto.
const test = require('node:test');
const assert = require('node:assert');
const { strip, kind, orientation } = require('../renderer/metadados');

const bytes = (...parts) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const seg = (marker, body) => { const b = bytes(body); return bytes([0xff, marker, (b.length + 2) >> 8, (b.length + 2) & 255], b); };
const has = (buf, text) => Buffer.from(buf).includes(Buffer.from(text, 'latin1'));

// EXIF (little-endian) com rotação e um apontador para GPS, mais o texto "GPS-SEGREDO"
function exif(rot) {
  const ifd = bytes([2, 0], [0x12, 0x01, 3, 0, 1, 0, 0, 0, rot, 0, 0, 0], [0x25, 0x88, 4, 0, 1, 0, 0, 0, 38, 0, 0, 0], [0, 0, 0, 0]);
  return bytes('Exif\0\0', 'II*\0', [8, 0, 0, 0], ifd, 'GPS-SEGREDO -23.55,-46.63');
}
const SCAN = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56, 0x78]; // FF00 (FF dos dados) e FFD3 (reinício) não terminam a imagem
function jpegWith(rot) {
  return bytes([0xff, 0xd8],
    seg(0xe0, bytes('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0])),
    seg(0xe1, exif(rot)),
    seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>XMP-SEGREDO</x:xmpmeta>'),
    seg(0xe2, 'ICC_PROFILE\0\x01\x01perfil-de-cor'),
    seg(0xed, 'Photoshop 3.0\0IPTC-SEGREDO'),
    seg(0xfe, 'COMENTARIO-SEGREDO'),
    seg(0xdb, [0, ...Array(64).fill(1)]),
    seg(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
    seg(0xda, [1, 1, 0, 0, 63, 0]), SCAN,
    seg(0xfe, 'COMENTARIO-NO-MEIO'),
    seg(0xda, [1, 1, 0, 0, 63, 0]), [0x9a, 0xbc],
    [0xff, 0xd9],
    // Foto extra que o celular gruda depois do fim, com o próprio EXIF
    [0xff, 0xd8], seg(0xe1, exif(1)), [0xff, 0xd9]);
}

test('JPEG: sai o EXIF, o XMP, o IPTC, os comentários e a foto grudada no fim', () => {
  const out = strip(jpegWith(6));
  for (const s of ['GPS-SEGREDO', 'XMP-SEGREDO', 'IPTC-SEGREDO', 'COMENTARIO-SEGREDO', 'COMENTARIO-NO-MEIO']) assert.ok(!has(out, s), s);
  assert.deepStrictEqual([...out.subarray(-2)], [0xff, 0xd9]);
  assert.strictEqual(Buffer.from(out).indexOf(Buffer.from([0xff, 0xd8]), 2), -1, 'nenhuma segunda imagem');
});

test('JPEG: fica o que desenha a imagem, o perfil de cor e a rotação', () => {
  const out = Buffer.from(strip(jpegWith(6)));
  assert.ok(has(out, 'JFIF') && has(out, 'perfil-de-cor'));
  assert.ok(out.includes(Buffer.from(SCAN)), 'os dados da imagem ficam iguais');
  const app1 = out.indexOf(Buffer.from([0xff, 0xe1]));
  assert.ok(app1 > 0, 'tem um EXIF novo');
  assert.strictEqual(orientation(out.subarray(app1 + 4, app1 + 4 + out.readUInt16BE(app1 + 2) - 2)), 6);
  assert.ok(out.length < jpegWith(6).length);
});

test('JPEG sem rotação não ganha EXIF nenhum', () => {
  assert.ok(!has(strip(jpegWith(1)), 'Exif'));
});

test('JPEG cortado dá erro (o chat então redesenha a foto)', () => {
  assert.throws(() => strip(jpegWith(1).subarray(0, 60)));
});

function crcTable() { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const T = crcTable();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const d = bytes(data); const head = Buffer.alloc(4); head.writeUInt32BE(d.length);
  const td = bytes(type, d); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(td));
  return bytes(head, td, tail);
}

test('PNG: saem os textos, o eXIf e a data; ficam imagem, cor e transparência', () => {
  const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const png = bytes('\x89PNG\r\n\x1a\n', ihdr, chunk('sRGB', [0]), chunk('tEXt', 'Location\0GPS-SEGREDO'),
    chunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0XMP-SEGREDO'), chunk('eXIf', exif(1).subarray(6)), chunk('tIME', [7, 234, 9, 27, 12, 0, 0]),
    chunk('tRNS', [0]), chunk('IDAT', [1, 2, 3]), chunk('IEND', []), 'lixo-depois-GPS-SEGREDO');
  const out = strip(png);
  assert.strictEqual(kind(out), 'png');
  for (const s of ['GPS-SEGREDO', 'XMP-SEGREDO', 'tIME', 'eXIf', 'tEXt', 'iTXt']) assert.ok(!has(out, s), s);
  for (const s of ['IHDR', 'sRGB', 'tRNS', 'IDAT', 'IEND']) assert.ok(has(out, s), s);
});

test('WebP: saem o EXIF e o XMP, o tamanho do RIFF e os avisos do VP8X se ajustam', () => {
  const ch = (type, data) => { const d = bytes(data); const h = Buffer.alloc(8); h.write(type, 0, 'latin1'); h.writeUInt32LE(d.length, 4); return bytes(h, d, d.length & 1 ? [0] : []); };
  const body = bytes('WEBP', ch('VP8X', [0x0c | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ch('ALPH', [1, 2, 3]), ch('VP8 ', [9, 9, 9, 9]),
    ch('EXIF', exif(1).subarray(6)), ch('XMP ', '<x>XMP-SEGREDO</x>'));
  const riff = Buffer.alloc(8); riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(body.length, 4);
  const out = Buffer.from(strip(bytes(riff, body)));
  assert.ok(!has(out, 'GPS-SEGREDO') && !has(out, 'XMP-SEGREDO') && !has(out, 'EXIF'));
  assert.strictEqual(out.readUInt32LE(4), out.length - 8);
  assert.strictEqual(out[20], 0x10, 'fica só o aviso de transparência');
  assert.ok(has(out, 'ALPH') && has(out, 'VP8 '));
});

test('Outros arquivos não são mexidos', () => {
  assert.strictEqual(strip(Buffer.from('GIF89a......')), null);
  assert.strictEqual(strip(Buffer.from('um texto qualquer')), null);
});
