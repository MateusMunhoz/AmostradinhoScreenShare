// Arquivos saem sem metadados (renderer/metadados.js): cada formato montado à mão, com segredos em todo canto.
// Todo segredo tem "SEGREDO" no texto; nenhum pode sobrar no arquivo limpo.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { clean, kind, orientation, crc32 } = require('../renderer/metadados');

const bytes = (...parts) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const has = (buf, text) => Buffer.from(buf).includes(Buffer.from(text, 'latin1'));
const run = async (buf, name = 'arquivo') => {
  const r = await clean(new Blob([buf]), name);
  return r && { out: Buffer.from(await r.blob.arrayBuffer()), name: r.name };
};
const noSecret = (out) => assert.ok(!has(out, 'SEGREDO'), `sobrou: ...${latin(out).slice(Math.max(0, latin(out).indexOf('SEGREDO') - 30), latin(out).indexOf('SEGREDO') + 12)}...`);
const latin = (b) => Buffer.from(b).toString('latin1');

// ---------- Perfil de cor ----------
// ICC com data, sistema, fabricante, modelo, criador, descrição e aparelho
function icc() {
  const p = Buffer.alloc(300);
  p.writeUInt32BE(300, 0); p.write('acsp', 36, 'latin1');
  p.write('SEGREDO-DATA', 24, 'latin1'); p.write('MSFT', 40, 'latin1'); p.write('DELL', 48, 'latin1'); p.write('U27Q', 52, 'latin1'); p.write('SEGR', 80, 'latin1');
  p.writeUInt32BE(3, 128);
  const tag = (k, sig, off, len) => { p.write(sig, 132 + k * 12, 'latin1'); p.writeUInt32BE(off, 136 + k * 12); p.writeUInt32BE(len, 140 + k * 12); };
  tag(0, 'desc', 180, 40); p.write('mluc', 180, 'latin1'); p.write('Monitor SEGREDO', 200, 'latin1');
  tag(1, 'dmdd', 220, 40); p.write('text', 220, 'latin1'); p.write('Modelo SEGREDO', 228, 'latin1');
  tag(2, 'rXYZ', 260, 20); p.write('XYZ COR-FICA', 260, 'latin1');
  return p;
}
const iccClean = (out) => { noSecret(out); assert.ok(!has(out, 'DELL') && !has(out, 'MSFT')); assert.ok(has(out, 'acsp') && has(out, 'COR-FICA'), 'o que dá as cores fica'); };

// ---------- JPEG ----------
const seg = (marker, body) => { const b = bytes(body); return bytes([0xff, marker, (b.length + 2) >> 8, (b.length + 2) & 255], b); };
function exif(rot) {
  const ifd = bytes([2, 0], [0x12, 0x01, 3, 0, 1, 0, 0, 0, rot, 0, 0, 0], [0x25, 0x88, 4, 0, 1, 0, 0, 0, 38, 0, 0, 0], [0, 0, 0, 0]);
  return bytes('Exif\0\0', 'II*\0', [8, 0, 0, 0], ifd, 'GPS-SEGREDO -23.55,-46.63');
}
const SCAN = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56, 0x78]; // FF00 (FF dos dados) e FFD3 (reinício) não terminam a imagem
function jpegWith(rot) {
  const prof = icc();
  return bytes([0xff, 0xd8],
    seg(0xe0, bytes('JFIF\0', [1, 2, 1, 0, 72, 0, 72, 2, 2], Buffer.alloc(12, 0x77))), // com miniatura 2x2
    seg(0xe0, bytes('JFXX\0', [0x10], 'MINIATURA-SEGREDO')),
    seg(0xe1, exif(rot)),
    seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>XMP-SEGREDO</x:xmpmeta>'),
    seg(0xe2, bytes('ICC_PROFILE\0', [1, 2], prof.subarray(0, 150))),
    seg(0xe2, bytes('ICC_PROFILE\0', [2, 2], prof.subarray(150))),
    seg(0xed, 'Photoshop 3.0\0IPTC-SEGREDO'),
    seg(0xfe, 'COMENTARIO-SEGREDO'),
    seg(0xdb, [0, ...Array(64).fill(1)]),
    seg(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
    seg(0xda, [1, 1, 0, 0, 63, 0]), SCAN,
    seg(0xfe, 'COMENTARIO-NO-MEIO-SEGREDO'),
    seg(0xda, [1, 1, 0, 0, 63, 0]), [0x9a, 0xbc],
    [0xff, 0xd9],
    // Foto extra que o celular grava depois do fim, com o próprio EXIF
    [0xff, 0xd8], seg(0xe1, exif(1)), [0xff, 0xd9]);
}

test('JPEG: sai EXIF, XMP, IPTC, comentários, miniatura, DPI e a foto grudada no fim', async () => {
  const { out } = await run(jpegWith(6));
  noSecret(out);
  assert.deepStrictEqual([...out.subarray(-2)], [0xff, 0xd9]);
  assert.strictEqual(out.indexOf(Buffer.from([0xff, 0xd8]), 2), -1, 'nenhuma segunda imagem');
  const jfif = out.indexOf('JFIF');
  assert.deepStrictEqual([...out.subarray(jfif + 7, jfif + 14)], [0, 0, 1, 0, 1, 0, 0], 'JFIF sem DPI e sem miniatura');
});

test('JPEG: fica o que desenha a imagem, a rotação e o perfil de cor (limpo)', async () => {
  const { out } = await run(jpegWith(6));
  assert.ok(out.includes(Buffer.from(SCAN)), 'os dados da imagem ficam iguais');
  const app1 = out.indexOf(Buffer.from([0xff, 0xe1]));
  assert.strictEqual(orientation(out.subarray(app1 + 4, app1 + 2 + out.readUInt16BE(app1 + 2))), 6);
  iccClean(out);
  assert.strictEqual(out.indexOf('ICC_PROFILE', out.indexOf('ICC_PROFILE') + 1) > 0, true, 'o perfil continua em 2 pedaços');
});

test('JPEG sem rotação não ganha EXIF nenhum', async () => {
  assert.ok(!has((await run(jpegWith(1))).out, 'Exif'));
});

test('JPEG cortado dá erro (o chat então redesenha a foto)', async () => {
  await assert.rejects(run(jpegWith(1).subarray(0, 60)));
});

test('Foto com data no nome vira "foto"', async () => {
  assert.strictEqual((await run(jpegWith(1), 'IMG_20260927_153012.JPG')).name, 'foto.jpg');
  assert.strictEqual((await run(jpegWith(1), 'WhatsApp Image 2026-09-27 at 15.30.12.jpeg')).name, 'foto.jpeg');
  assert.strictEqual((await run(jpegWith(1), 'gato.jpg')).name, 'gato.jpg');
});

// ---------- PNG ----------
function chunk(type, data) {
  const d = bytes(data); const head = Buffer.alloc(4); head.writeUInt32BE(d.length);
  const td = bytes(type, d); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(td));
  return bytes(head, td, tail);
}
test('PNG: saem textos, eXIf, data e DPI; o perfil de cor fica limpo e o arquivo continua válido', async () => {
  const png = bytes('\x89PNG\r\n\x1a\n', chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    chunk('iCCP', bytes('Perfil SEGREDO\0\0', zlib.deflateSync(icc()))), chunk('tEXt', 'Location\0GPS-SEGREDO'),
    chunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0XMP-SEGREDO'), chunk('eXIf', exif(1).subarray(6)), chunk('tIME', [7, 234, 9, 27, 12, 0, 0]),
    chunk('pHYs', [0, 0, 0x16, 0x25, 0, 0, 0x16, 0x25, 1]), chunk('tRNS', [0]), chunk('IDAT', [1, 2, 3]), chunk('IEND', []), 'lixo-depois-SEGREDO');
  const { out } = await run(png);
  noSecret(out);
  for (const s of ['tIME', 'eXIf', 'tEXt', 'iTXt', 'pHYs']) assert.ok(!has(out, s), s);
  for (const s of ['IHDR', 'iCCP', 'tRNS', 'IDAT', 'IEND']) assert.ok(has(out, s), s);
  // Cada bloco com o CRC certo, e o perfil de dentro limpo
  for (let i = 8; i < out.length;) {
    const len = out.readUInt32BE(i);
    assert.strictEqual(out.readUInt32BE(i + 8 + len), crc32(out.subarray(i + 4, i + 8 + len)), `CRC de ${latin(out.subarray(i + 4, i + 8))}`);
    if (latin(out.subarray(i + 4, i + 8)) === 'iCCP') iccClean(zlib.inflateSync(out.subarray(i + 8 + 5, i + 8 + len)));
    i += 12 + len;
  }
});

// ---------- WebP ----------
test('WebP: saem EXIF e XMP, o perfil fica limpo, o tamanho e os avisos do VP8X se ajustam', async () => {
  const ch = (type, data) => { const d = bytes(data); const h = Buffer.alloc(8); h.write(type, 0, 'latin1'); h.writeUInt32LE(d.length, 4); return bytes(h, d, d.length & 1 ? [0] : []); };
  const body = bytes('WEBP', ch('VP8X', [0x0c | 0x10 | 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ch('ICCP', icc()), ch('ALPH', [1, 2, 3]), ch('VP8 ', [9, 9, 9, 9]),
    ch('EXIF', exif(1).subarray(6)), ch('XMP ', '<x>XMP-SEGREDO</x>'));
  const riff = Buffer.alloc(8); riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(body.length, 4);
  const { out } = await run(bytes(riff, body));
  iccClean(out);
  assert.ok(!has(out, 'EXIF'));
  assert.strictEqual(out.readUInt32LE(4), out.length - 8);
  assert.strictEqual(out[20], 0x30, 'ficam os avisos de transparência e de perfil de cor');
  assert.ok(has(out, 'ALPH') && has(out, 'VP8 '));
});

// ---------- GIF ----------
test('GIF: saem comentários e XMP; ficam a imagem e a animação', async () => {
  const sub = (t) => { const b = bytes(t); return bytes([b.length], b, [0]); };
  const g = bytes('GIF89a', [2, 0, 2, 0, 0x80, 0, 0], Buffer.alloc(6, 0x11),
    [0x21, 0xff], sub('NETSCAPE2.0'),
    [0x21, 0xfe], sub('COMENTARIO-SEGREDO'),
    [0x21, 0xff], [11], 'XMP DataXMP', [19], '<x>XMP-SEGREDO</x>!', [0],
    [0x21, 0xf9, 4, 0, 10, 0, 0, 0],
    [0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0], [2], sub('PIXELS'),
    [0x3b], 'lixo-SEGREDO');
  const { out } = await run(g);
  noSecret(out);
  assert.ok(has(out, 'NETSCAPE2.0') && has(out, 'PIXELS'));
  assert.strictEqual(out[out.length - 1], 0x3b);
});

// ---------- MP4 / MOV ----------
const box = (type, ...body) => { const b = bytes(...body); const h = Buffer.alloc(8); h.writeUInt32BE(b.length + 8); h.write(type, 4, 'latin1'); return bytes(h, b); };
const full = (type, v, ...body) => box(type, [v, 0, 0, 0], ...body);
const u32be = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x, 4 * i)); return b; };
function mp4() {
  const video = 'QUADROS-DE-VIDEO-FICAM';
  const gps = 'GPMF-GPS-SEGREDO';
  const head = box('ftyp', 'isom', u32be(0), 'isommp41');
  const make = (offVideo, offGps) => box('moov',
    full('mvhd', 0, u32be(0xdeadbeef, 0xdeadbeef, 1000, 5000), Buffer.alloc(80)),
    box('trak', full('tkhd', 0, u32be(0xdeadbeef, 0xdeadbeef, 1), Buffer.alloc(72)),
      box('mdia', full('mdhd', 0, u32be(0xdeadbeef, 0xdeadbeef, 1000, 5000), Buffer.alloc(4)), full('hdlr', 0, u32be(0), 'vide', Buffer.alloc(13)),
        box('minf', box('stbl', full('stsz', 0, u32be(0, 1, video.length)), full('stsc', 0, u32be(1, 1, 1, 1)), full('stco', 0, u32be(1, offVideo)))))),
    box('trak', full('tkhd', 0, u32be(0xdeadbeef, 0xdeadbeef, 2), Buffer.alloc(72)),
      box('mdia', full('mdhd', 0, u32be(0xdeadbeef, 0xdeadbeef, 1000, 5000), Buffer.alloc(4)), full('hdlr', 0, u32be(0), 'meta', Buffer.alloc(13)),
        box('minf', box('stbl', full('stsz', 0, u32be(8, 2)), full('stsc', 0, u32be(1, 1, 2, 1)), full('stco', 0, u32be(1, offGps)))))),
    box('udta', box('\xa9xyz', '+23.55-046.63/ GPS-SEGREDO'), box('\xa9mod', 'iPhone SEGREDO')),
    box('meta', 'com.apple.quicktime.location SEGREDO'));
  const probe = make(0, 0);
  const mdatAt = head.length + probe.length;
  const moov = make(mdatAt + 8, mdatAt + 8 + video.length);
  return bytes(head, moov, box('mdat', video, gps.slice(0, 16)), box('uuid', 'XMP-SEGREDO'));
}
test('MP4/MOV: sai GPS, aparelho, datas e a trilha de GPS; o vídeo fica igual e do mesmo tamanho', async () => {
  const src = mp4();
  const { out, name } = await run(src, 'VID_20260927_153012.mp4');
  assert.strictEqual(out.length, src.length);
  noSecret(out);
  assert.ok(has(out, 'QUADROS-DE-VIDEO-FICAM'));
  assert.ok(!has(out, '\xde\xad\xbe\xef'), 'datas zeradas');
  assert.strictEqual(name, 'video.mp4');
  assert.strictEqual(kind(out), 'iso');
});

// ---------- HEIC ----------
test('HEIC: o EXIF e o XMP são zerados no lugar, o perfil fica limpo, a imagem fica', async () => {
  const image = 'IMAGEM-HEVC-FICA', ex = 'Exif\0\0GPS-SEGREDO', xmp = '<x>XMP-SEGREDO</x>';
  const head = box('ftyp', 'heic', u32be(0), 'mif1heic');
  const infe = (id, type, extra = '') => full('infe', 2, [0, id, 0, 0], type, 'nome\0', extra);
  const make = (at) => box('meta', [0, 0, 0, 0], full('hdlr', 0, u32be(0), 'pict', Buffer.alloc(13)),
    full('iinf', 0, [0, 3], infe(1, 'hvc1'), infe(2, 'Exif'), infe(3, 'mime', 'application/rdf+xml\0')),
    full('iloc', 0, [0x44, 0x00], [0, 3],
      [0, 1, 0, 0, 0, 1], u32be(at, image.length),
      [0, 2, 0, 0, 0, 1], u32be(at + image.length, ex.length),
      [0, 3, 0, 0, 0, 1], u32be(at + image.length + ex.length, xmp.length)),
    box('iprp', box('ipco', box('colr', 'prof', icc()))));
  const at = head.length + make(0).length + 8;
  const src = bytes(head, make(at), box('mdat', image, ex, xmp));
  const { out } = await run(src, 'IMG_2026-09-27.heic');
  assert.strictEqual(out.length, src.length);
  iccClean(out);
  assert.ok(has(out, image));
});

// ---------- PDF ----------
test('PDF: saem autor, programa, datas, XMP e o EXIF das fotos de dentro; o tamanho não muda', async () => {
  const jpg = bytes([0xff, 0xd8], seg(0xe1, exif(1)), [0xff, 0xd9]);
  const src = bytes('%PDF-1.7\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Metadata 4 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
    '3 0 obj\n<< /Author (Mateus SEGREDO) /Producer (Word \\(SEGREDO\\)) /CreationDate (D:20260927) /Custom <534547524544> >>\nendobj\n',
    '4 0 obj\n<< /Type /Metadata /Subtype /XML /Length 60 >>\nstream\n<?xpacket begin="x"?><dc:creator>SEGREDO</dc:creator><?xpacket end="w"?>\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode >>\nstream\n', jpg, '\nendstream\nendobj\n',
    'trailer\n<< /Root 1 0 R /Info 3 0 R /Size 6 >>\nstartxref\n0\n%%EOF\n');
  const { out } = await run(src, 'relatorio.pdf');
  assert.strictEqual(out.length, src.length);
  noSecret(out);
  assert.ok(!has(out, 'Mateus') && !has(out, '534547524544') && !has(out, '/Info 3') && !has(out, 'D:2026'));
  assert.ok(has(out, '/Root 1 0 R') && has(out, '/Pages 2 0 R'), 'o resto do PDF fica');
});

// ---------- Word / Excel ----------
function zip(entries) {
  const parts = [], central = [];
  let at = 0;
  for (const [name, content, deflate] of entries) {
    const raw = bytes(content), data = deflate ? zlib.deflateRawSync(raw) : raw, n = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt16LE(0x6b3a, 10); h.writeUInt16LE(0x5b3b, 12);
    h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); h.copy(c, 6, 4, 30); c.writeUInt32LE(at, 42);
    parts.push(h, n, data); central.push(c, n);
    at += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, cd, end]);
}
// Lê um zip conferindo o CRC de cada arquivo: { nome: conteúdo }
function unzip(b) {
  const e = b.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  const files = {};
  for (let k = 0, p = b.readUInt32LE(e + 16); k < b.readUInt16LE(e + 10); k++) {
    const nl = b.readUInt16LE(p + 28), name = b.toString('utf8', p + 46, p + 46 + nl), local = b.readUInt32LE(p + 42);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28), data = b.subarray(start, start + b.readUInt32LE(p + 20));
    const raw = b.readUInt16LE(p + 10) === 8 ? zlib.inflateRawSync(data) : data;
    assert.strictEqual(crc32(raw), b.readUInt32LE(p + 16), `CRC de ${name}`);
    assert.strictEqual(b.readUInt16LE(local + 12), 0x21, `data de ${name} em 1980`);
    files[name] = raw;
    p += 46 + nl + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return files;
}
test('Word/Excel: saem autor, empresa, datas, pasta do PC, e-mail e o EXIF das imagens; o conteúdo fica', async () => {
  const src = zip([
    ['[Content_Types].xml', '<Types/>'],
    ['docProps/core.xml', '<cp:coreProperties><dc:creator>Mateus SEGREDO</dc:creator><dcterms:created>2026-09-27</dcterms:created></cp:coreProperties>', true],
    ['docProps/app.xml', '<Properties><Company>SEGREDO Ltda</Company><TotalTime>93</TotalTime></Properties>', true],
    ['word/document.xml', '<w:document>TEXTO-DO-DOCUMENTO-FICA</w:document>', true],
    ['word/people.xml', '<w15:people><w15:person w15:author="Ana"><w15:presenceInfo w15:providerId="AD" w15:userId="SEGREDO@empresa.com"/></w15:person></w15:people>', true],
    ['xl/workbook.xml', '<workbook><mc:Choice Requires="x15ac"><x15ac:absPath url="C:\\Users\\SEGREDO\\Documentos\\" xmlns:x15ac="x"/></mc:Choice><sheets/></workbook>', true],
    ['word/media/image1.jpeg', jpegWith(1), true],
  ]);
  const { out } = await run(src, 'relatorio.docx');
  noSecret(out);
  const files = unzip(out);
  assert.strictEqual(Object.keys(files).length, 7);
  assert.ok(has(files['word/document.xml'], 'TEXTO-DO-DOCUMENTO-FICA'));
  assert.ok(has(files['word/people.xml'], 'w15:author="Ana"'), 'o nome que aparece no comentário fica');
  assert.ok(has(files['xl/workbook.xml'], '<sheets/>'));
  assert.ok(files['word/media/image1.jpeg'].includes(Buffer.from(SCAN)));
});

test('.zip comum e outros arquivos não são mexidos', async () => {
  assert.strictEqual(await run(zip([['fotos/a.txt', 'oi']])), null);
  assert.strictEqual(await run(Buffer.from('um texto qualquer, com mais de 16 letras')), null);
});
