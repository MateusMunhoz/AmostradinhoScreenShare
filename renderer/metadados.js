'use strict';
// Tira os metadados de uma foto antes de ela ir para o chat: localização (GPS), câmera, data, dono, comentários.
// Mexe só nos bytes do arquivo, sem recomprimir, então a imagem fica igual. Reconhece pelo começo do arquivo:
//  - JPEG: tira o EXIF, o XMP, o IPTC e os comentários. Fica a rotação da foto (senão foto de celular chega
//    deitada), num EXIF novo só com ela. Corta o que vem depois do fim da imagem (celular guarda ali outras
//    fotos, cada uma com o próprio GPS).
//  - PNG: tira os blocos de texto, EXIF e data.
//  - WebP: tira o EXIF e o XMP.
// Outros formatos voltam null (não mexe). Script clássico e também módulo do Node (tests/metadados.test.js).
const ImageMetadata = (() => {
  const u16 = (b, i, le) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const u32 = (b, i, le) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0);
  const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
  const join = (parts) => {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const bad = (what) => { throw new Error(`arquivo estranho: ${what}`); };

  // ---------- JPEG ----------
  // Rotação (tag 0x0112) de dentro de um EXIF, ou 1
  function orientation(seg) {
    const t = 6; // depois de "Exif\0\0"
    if (seg.length < t + 8) return 1;
    const le = seg[t] === 0x49;
    const ifd = t + u32(seg, t + 4, le);
    if (ifd + 2 > seg.length) return 1;
    const n = u16(seg, ifd, le);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > seg.length) break;
      if (u16(seg, e, le) === 0x0112) { const v = u16(seg, e + 8, le); return v >= 1 && v <= 8 ? v : 1; }
    }
    return 1;
  }
  // APP1 com um EXIF que só diz a rotação
  function orientationSegment(v) {
    return Uint8Array.from([0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8,
      0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, v, 0, 0, 0, 0, 0, 0]);
  }
  // Fica: APP0 (JFIF), APP2 só com perfil de cor, APP14 (Adobe, muda as cores se sumir). O resto dos APPn e o COM saem.
  function keepJpeg(marker, b, at) {
    if (marker === 0xe0 || marker === 0xee) return true;
    if (marker === 0xe2) return ascii(b, at + 4, 11) === 'ICC_PROFILE';
    return !(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe;
  }
  function jpeg(b) {
    const out = [b.subarray(0, 2)];
    let i = 2, rot = 1, rotAt = -1;
    for (;;) {
      if (i >= b.length) bad('JPEG sem fim');
      if (b[i] !== 0xff) bad('JPEG sem marcador');
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }            // enchimento entre segmentos
      if (m === 0xd9) { out.push(b.subarray(i, i + 2)); break; } // fim da imagem: o que vier depois fica fora
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
      if (i + 4 > b.length) bad('JPEG cortado');
      const len = u16(b, i + 2);
      const end = i + 2 + len;
      if (len < 2 || end > b.length) bad('segmento JPEG cortado');
      if (m === 0xe1 && ascii(b, i + 4, 6) === 'Exif\0\0') {
        rot = orientation(b.subarray(i + 4, end));
        if (rotAt < 0) rotAt = out.length;
      }
      if (keepJpeg(m, b, i)) out.push(b.subarray(i, end));
      i = end;
      if (m === 0xda) {
        // Dados da imagem até o próximo marcador de verdade (FF00 é um FF dos dados; FFD0 a FFD7, reinício)
        const start = i;
        while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0 && b[i + 1] !== 0xff && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i++;
        if (i + 1 >= b.length) bad('JPEG sem fim');
        out.push(b.subarray(start, i));
      }
    }
    if (rot !== 1) out.splice(rotAt, 0, orientationSegment(rot));
    return join(out);
  }

  // ---------- PNG ----------
  // Blocos opcionais que ficam (cor, transparência, animação); os outros opcionais (texto, eXIf, tIME...) saem
  const PNG_KEEP = new Set(['tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD', 'hIST', 'sPLT', 'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCV', 'cLLI']);
  function png(b) {
    const out = [b.subarray(0, 8)];
    let i = 8;
    for (;;) {
      if (i + 12 > b.length) bad('PNG sem fim');
      const len = u32(b, i);
      const type = ascii(b, i + 4, 4);
      const end = i + 12 + len;
      if (end > b.length) bad('bloco PNG cortado');
      const critical = type.charCodeAt(0) < 97; // maiúscula: obrigatório
      if (critical || PNG_KEEP.has(type)) out.push(b.subarray(i, end));
      i = end;
      if (type === 'IEND') break;
    }
    return join(out);
  }

  // ---------- WebP ----------
  function webp(b) {
    const out = [];
    const size = Math.min(b.length, 8 + u32(b, 4, true));
    let i = 12;
    while (i + 8 <= size) {
      const type = ascii(b, i, 4);
      const len = u32(b, i + 4, true);
      const end = i + 8 + len + (len & 1);
      if (i + 8 + len > size) bad('bloco WebP cortado');
      if (type !== 'EXIF' && type !== 'XMP ') {
        const chunk = b.slice(i, Math.min(end, size));
        if (type === 'VP8X') chunk[8] &= ~0x0c; // desliga os avisos de "tem EXIF" e "tem XMP"
        out.push(chunk);
      }
      i = end;
    }
    const body = join(out);
    const head = new Uint8Array(12);
    head.set(b.subarray(0, 12));
    const riff = body.length + 4;
    head[4] = riff & 255; head[5] = (riff >> 8) & 255; head[6] = (riff >> 16) & 255; head[7] = (riff >>> 24) & 255;
    return join([head, body]);
  }

  // Formato pelos primeiros 12 bytes: 'jpeg', 'png', 'webp' ou null
  function kind(b) {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b.length >= 8 && ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
    if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
    return null;
  }

  // Bytes sem metadados, ou null se não for JPEG, PNG nem WebP. Lança erro se o arquivo estiver quebrado.
  function strip(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const k = kind(b);
    return k === 'jpeg' ? jpeg(b) : k === 'png' ? png(b) : k === 'webp' ? webp(b) : null;
  }

  return { kind, strip, orientation };
})();
if (typeof module !== 'undefined') module.exports = ImageMetadata;
