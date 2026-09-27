'use strict';
// Tira os metadados de um arquivo antes de ele ir para o chat: localização (GPS), aparelho, datas, autor,
// programa, pasta do PC, comentários. Mexe só nos pedaços de metadado, sem recomprimir a imagem ou o vídeo.
// Reconhece o formato pelo começo do arquivo, não pelo nome:
//  - JPEG: sai EXIF, XMP, IPTC, comentários, miniaturas e as fotos extras que o celular grava depois do fim.
//    Fica a rotação (senão a foto chega deitada), num EXIF novo só com ela.
//  - PNG, WebP, GIF: saem textos, EXIF, XMP, data, DPI e comentários.
//  - Perfil de cor (JPEG, PNG, WebP, HEIC): fica, porque muda as cores, mas sem data, aparelho, fabricante e
//    descrição (um monitor calibrado põe o modelo dele ali).
//  - HEIC/AVIF: o EXIF e o XMP são apagados no lugar.
//  - Vídeo e áudio MP4/MOV/M4A/3GP: saem o udta e o meta (GPS, aparelho, programa), as datas de criação e as
//    trilhas de metadado (GPS da GoPro, dados do iPhone). Imagem e som ficam iguais.
//  - PDF: some autor, programa, datas e título (o /Info), o XMP, e o EXIF das fotos de dentro.
//  - Word, Excel, PowerPoint, LibreOffice: autor, empresa, datas, tempo de edição, pasta do PC, e o EXIF das
//    imagens de dentro. As datas dos arquivos dentro do .zip viram 1980.
// Arquivo de outro tipo volta null (vai como está). Arquivo quebrado lança erro.
// Script clássico e também módulo do Node (tests/metadados.test.js).
const FileMetadata = (() => {
  const u16 = (b, i, le) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const u32 = (b, i, le) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0);
  const u64 = (b, i) => u32(b, i) * 2 ** 32 + u32(b, i + 4);
  const put16le = (b, i, v) => { b[i] = v & 255; b[i + 1] = (v >> 8) & 255; };
  const put32le = (b, i, v) => { b[i] = v & 255; b[i + 1] = (v >> 8) & 255; b[i + 2] = (v >> 16) & 255; b[i + 3] = (v >>> 24) & 255; };
  const put32 = (b, i, v) => { b[i] = (v >>> 24) & 255; b[i + 1] = (v >> 16) & 255; b[i + 2] = (v >> 8) & 255; b[i + 3] = v & 255; };
  const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
  const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };
  const join = (parts) => {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const bad = (what) => { throw new Error(`arquivo estranho: ${what}`); };
  const utf8 = (b) => new TextDecoder().decode(b);
  const bytesOf = (s) => new TextEncoder().encode(s);

  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const through = async (b, stream) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(stream)).arrayBuffer());
  const inflate = (b, raw) => through(b, new DecompressionStream(raw ? 'deflate-raw' : 'deflate'));
  const deflate = (b) => through(b, new CompressionStream('deflate'));

  // ---------- Perfil de cor (ICC), no lugar ----------
  // Fica o que dá as cores; saem data, sistema, fabricante, modelo, criador, a assinatura do perfil e os textos
  // de descrição, aparelho e direitos
  function cleanIcc(p) {
    if (p.length < 132) return p;
    p.fill(0, 24, 36); p.fill(0, 40, 44); p.fill(0, 48, 56); p.fill(0, 80, 100);
    const n = Math.min(u32(p, 128), (p.length - 132) / 12);
    for (let k = 0; k < n; k++) {
      const e = 132 + k * 12;
      const sig = ascii(p, e, 4), off = u32(p, e + 4), len = u32(p, e + 8);
      if (!['desc', 'dmnd', 'dmdd', 'cprt', 'targ'].includes(sig) || len <= 12 || off + len > p.length) continue;
      const type = ascii(p, off, 4);
      p.fill(0, off + 8, off + len);
      if (type === 'mluc') put32(p, off + 12, 12); // lista vazia, com o tamanho de registro que os leitores esperam
    }
    return p;
  }

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
  const orientationSegment = (v) => Uint8Array.from([0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8,
    0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, v, 0, 0, 0, 0, 0, 0]);
  // JFIF sem miniatura e sem DPI (versão da original)
  const jfifSegment = (b, i) => Uint8Array.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, b[i + 9] || 1, b[i + 10] || 1, 0, 0, 1, 0, 1, 0, 0]);

  function jpeg(b) {
    const out = [b.subarray(0, 2)];
    const icc = []; // pedaços do perfil de cor (o perfil pode vir dividido em vários APP2)
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
      if (m === 0xe0) {
        if (ascii(b, i + 4, 5) === 'JFIF\0' && !out.some((p) => p[1] === 0xe0)) out.push(jfifSegment(b, i));
      } else if (m === 0xe1) {
        if (ascii(b, i + 4, 6) === 'Exif\0\0') {
          rot = orientation(b.subarray(i + 4, end));
          if (rotAt < 0) rotAt = out.length;
        }
      } else if (m === 0xe2) {
        if (ascii(b, i + 4, 12) === 'ICC_PROFILE\0' && len > 16) { const seg = b.slice(i, end); icc.push(seg); out.push(seg); }
      } else if (m === 0xee || !(m >= 0xe3 && m <= 0xef || m === 0xfe)) {
        out.push(b.subarray(i, end)); // APP14 (Adobe, muda as cores se sumir) e o que desenha a imagem
      }
      i = end;
      if (m === 0xda) {
        // Dados da imagem até o próximo marcador de verdade (FF00 é um FF dos dados; FFD0 a FFD7, reinício)
        const start = i;
        while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0 && b[i + 1] !== 0xff && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i++;
        if (i + 1 >= b.length) bad('JPEG sem fim');
        out.push(b.subarray(start, i));
      }
    }
    if (icc.length) {
      icc.sort((a, c) => a[16] - c[16]);
      const whole = cleanIcc(join(icc.map((s) => s.subarray(18))));
      let at = 0;
      for (const s of icc) { s.set(whole.subarray(at, at + s.length - 18), 18); at += s.length - 18; }
    }
    if (rot !== 1) out.splice(rotAt, 0, orientationSegment(rot));
    return join(out);
  }

  // ---------- PNG ----------
  function pngChunk(type, data) {
    const c = new Uint8Array(12 + data.length);
    put32(c, 0, data.length);
    c.set(bytesOf(type), 4);
    c.set(data, 8);
    put32(c, 8 + data.length, crc32(c.subarray(4, 8 + data.length)));
    return c;
  }
  // Blocos opcionais que ficam (cor, transparência, animação); os outros opcionais (texto, eXIf, tIME, pHYs...) saem
  const PNG_KEEP = new Set(['tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'hIST', 'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCV', 'cLLI']);
  async function png(b) {
    const out = [b.subarray(0, 8)];
    let i = 8;
    for (;;) {
      if (i + 12 > b.length) bad('PNG sem fim');
      const len = u32(b, i);
      const type = ascii(b, i + 4, 4);
      const end = i + 12 + len;
      if (end > b.length) bad('bloco PNG cortado');
      if (type === 'iCCP') {
        // Nome do perfil + 0 + método + perfil comprimido: o perfil sai limpo, com um nome neutro
        const data = b.subarray(i + 8, i + 8 + len);
        const z = data.indexOf(0);
        if (z > 0 && z + 2 <= data.length) {
          const prof = cleanIcc(await inflate(data.subarray(z + 2)));
          out.push(pngChunk('iCCP', join([bytesOf('ICC\0\0'), await deflate(prof)])));
        }
      } else if (type.charCodeAt(0) < 97 || PNG_KEEP.has(type)) {
        out.push(b.subarray(i, end)); // maiúscula: bloco obrigatório
      }
      i = end;
      if (type === 'IEND') break;
    }
    return join(out);
  }

  // ---------- WebP ----------
  const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
  function webp(b) {
    const out = [];
    const size = Math.min(b.length, 8 + u32(b, 4, true));
    let i = 12;
    while (i + 8 <= size) {
      const type = ascii(b, i, 4);
      const len = u32(b, i + 4, true);
      const end = i + 8 + len + (len & 1);
      if (i + 8 + len > size) bad('bloco WebP cortado');
      if (WEBP_KEEP.has(type)) {
        const chunk = b.slice(i, Math.min(end, size));
        if (type === 'VP8X') chunk[8] &= ~0x0c; // desliga os avisos de "tem EXIF" e "tem XMP"
        if (type === 'ICCP') cleanIcc(chunk.subarray(8, 8 + len));
        out.push(chunk);
      }
      i = end;
    }
    const body = join(out);
    const head = b.slice(0, 12);
    put32le(head, 4, body.length + 4);
    return join([head, body]);
  }

  // ---------- GIF ----------
  // Ficam a imagem, o controle de quadros e a repetição da animação; saem comentários e extensões de programa (XMP)
  function gif(b) {
    const skip = (i) => { while (i < b.length && b[i]) i += b[i] + 1; if (i >= b.length) bad('GIF cortado'); return i + 1; };
    const table = (flags) => (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);
    let i = 13 + table(b[10]);
    const out = [b.subarray(0, i)];
    for (;;) {
      if (i >= b.length) bad('GIF sem fim');
      const start = i;
      if (b[i] === 0x3b) { out.push(b.subarray(i, i + 1)); break; }
      if (b[i] === 0x2c) {
        i = skip(i + 10 + table(b[i + 9]) + 1);
        out.push(b.subarray(start, i));
      } else if (b[i] === 0x21) {
        const label = b[i + 1];
        const app = label === 0xff ? ascii(b, i + 3, 11) : '';
        i = skip(i + 2);
        if (label === 0xf9 || label === 0x01 || app === 'NETSCAPE2.0' || app === 'ANIMEXTS1.0') out.push(b.subarray(start, i));
      } else bad('bloco GIF desconhecido');
    }
    return join(out);
  }

  // ---------- MP4, MOV, HEIC (caixas ISO) ----------
  // Muda no lugar, sem mudar o tamanho de nada (os índices do vídeo apontam para posições no arquivo):
  // devolve remendos { at, bytes } para aplicar por cima do arquivo original.
  function boxes(b, start, end) {
    const list = [];
    for (let at = start; at + 8 <= end;) {
      let len = u32(b, at), hdr = 8;
      if (len === 1) { if (at + 16 > end) break; len = u64(b, at + 8); hdr = 16; } else if (len === 0) len = end - at;
      if (len < hdr || at + len > end) bad('caixa cortada');
      list.push({ at, len, hdr, type: ascii(b, at + 4, 4) });
      at += len;
    }
    return list;
  }
  const child = (b, box, type, skip = 0) => boxes(b, box.at + box.hdr + skip, box.at + box.len).find((c) => c.type === type);
  // A caixa vira "free" (espaço vazio, que todo leitor pula) com o conteúdo zerado
  function toFree(b, box) { b.set(bytesOf('free'), box.at + 4); b.fill(0, box.at + box.hdr, box.at + box.len); }
  // Datas de criação e de mudança (mvhd, tkhd, mdhd) zeradas: "sem data"
  function zeroTimes(b, box) { const v = b[box.at + box.hdr]; b.fill(0, box.at + box.hdr + 4, box.at + box.hdr + 4 + (v === 1 ? 16 : 8)); }

  // Onde ficam, no arquivo, as amostras de uma trilha: [início, tamanho] por bloco
  function sampleRanges(b, stbl) {
    const kids = boxes(b, stbl.at + stbl.hdr, stbl.at + stbl.len);
    const get = (t) => kids.find((c) => c.type === t);
    const stsz = get('stsz'), stz2 = get('stz2'), stsc = get('stsc'), stco = get('stco'), co64 = get('co64');
    if (!(stsz || stz2) || !stsc || !(stco || co64)) return [];
    let size;
    if (stsz) {
      const p = stsz.at + stsz.hdr + 4, fixed = u32(b, p);
      size = (k) => fixed || u32(b, p + 8 + 4 * k);
    } else {
      const p = stz2.at + stz2.hdr + 4, bits = b[p + 3];
      size = (k) => (bits === 16 ? u16(b, p + 8 + 2 * k) : bits === 8 ? b[p + 8 + k] : (b[p + 8 + (k >> 1)] >> (k & 1 ? 0 : 4)) & 15);
    }
    const sc = stsc.at + stsc.hdr + 4, runs = Math.min(u32(b, sc), (stsc.len - 16) / 12);
    const co = (co64 || stco).at + (co64 || stco).hdr + 4, chunks = Math.min(u32(b, co), (b.length - co) / (co64 ? 8 : 4));
    const ranges = [];
    let sample = 0;
    for (let c = 1, r = 0; c <= chunks; c++) {
      while (r + 1 < runs && u32(b, sc + 4 + 12 * (r + 1)) <= c) r++;
      const per = u32(b, sc + 4 + 12 * r + 4);
      let len = 0;
      for (let k = 0; k < per; k++) len += size(sample++);
      ranges.push([co64 ? u64(b, co + 4 + 8 * (c - 1)) : u32(b, co + 4 + 4 * (c - 1)), len]);
    }
    return ranges;
  }

  // moov: udta e meta viram "free", datas zeradas; trilhas de metadado (GPS da GoPro, "mebx" do iPhone,
  // câmera 360) têm as amostras zeradas lá no mdat
  const META_TRACKS = new Set(['meta', 'camm']);
  function moov(b, zeroRanges) {
    const walk = (start, end) => {
      for (const box of boxes(b, start, end)) {
        if (box.type === 'udta' || box.type === 'meta' || box.type === 'uuid') toFree(b, box);
        else if (box.type === 'mvhd' || box.type === 'tkhd' || box.type === 'mdhd') zeroTimes(b, box);
        else if (['trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex'].includes(box.type)) {
          if (box.type === 'trak') {
            const mdia = child(b, box, 'mdia'), hdlr = mdia && child(b, mdia, 'hdlr'), minf = mdia && child(b, mdia, 'minf');
            const stbl = minf && child(b, minf, 'stbl');
            if (hdlr && stbl && META_TRACKS.has(ascii(b, hdlr.at + hdlr.hdr + 8, 4))) zeroRanges.push(...sampleRanges(b, stbl));
          }
          walk(box.at + box.hdr, box.at + box.len);
        }
      }
    };
    walk(headerOf(b), b.length);
  }

  // meta de uma imagem HEIC/AVIF (ou meta solto de um vídeo): os itens EXIF e XMP são zerados onde estiverem;
  // o perfil de cor fica limpo. meta sem itens vira "free".
  const headerOf = (b) => (u32(b, 0) === 1 ? 16 : 8);
  function heifMeta(b, zeroRanges) {
    const meta = { at: 0, len: b.length, hdr: headerOf(b) };
    const kids = boxes(b, meta.hdr + 4, b.length);
    const iinf = kids.find((c) => c.type === 'iinf'), iloc = kids.find((c) => c.type === 'iloc');
    if (!iinf || !iloc) { toFree(b, meta); return; }
    const secret = new Set();
    const cstr = (i) => { let e = i; while (e < b.length && b[e]) e++; return [ascii(b, i, e - i), e + 1]; };
    for (const infe of boxes(b, iinf.at + iinf.hdr + 4 + (b[iinf.at + iinf.hdr] === 0 ? 2 : 4), iinf.at + iinf.len)) {
      const v = b[infe.at + infe.hdr];
      if (infe.type !== 'infe' || v < 2) continue;
      let p = infe.at + infe.hdr + 4;
      const id = v === 2 ? u16(b, p) : u32(b, p);
      p += (v === 2 ? 2 : 4) + 2;
      const type = ascii(b, p, 4);
      const [, afterName] = cstr(p + 4);
      if (type === 'Exif' || (type === 'mime' && /xmp|rdf/i.test(cstr(afterName)[0]))) secret.add(id);
    }
    const idat = kids.find((c) => c.type === 'idat');
    const v = b[iloc.at + iloc.hdr];
    let p = iloc.at + iloc.hdr + 4;
    const offSize = b[p] >> 4, lenSize = b[p] & 15, baseSize = b[p + 1] >> 4, idxSize = v === 1 || v === 2 ? b[p + 1] & 15 : 0;
    p += 2;
    const num = (n) => { const x = n === 8 ? u64(b, p) : n === 4 ? u32(b, p) : n === 2 ? u16(b, p) : 0; p += n; return x; };
    const count = v < 2 ? num(2) : num(4);
    for (let k = 0; k < count; k++) {
      const id = v < 2 ? num(2) : num(4);
      const method = v === 1 || v === 2 ? num(2) & 15 : 0;
      num(2);
      const base = num(baseSize);
      const extents = num(2);
      for (let e = 0; e < extents; e++) {
        num(idxSize);
        const off = base + num(offSize), len = num(lenSize);
        if (!secret.has(id) || !len) continue;
        if (method === 0) zeroRanges.push([off, len]);
        else if (method === 1 && idat) b.fill(0, idat.at + idat.hdr + off, Math.min(idat.at + idat.len, idat.at + idat.hdr + off + len));
      }
    }
    const iprp = kids.find((c) => c.type === 'iprp'), ipco = iprp && child(b, iprp, 'ipco');
    for (const colr of ipco ? boxes(b, ipco.at + ipco.hdr, ipco.at + ipco.len) : []) {
      const kind = colr.type === 'colr' && ascii(b, colr.at + colr.hdr, 4);
      if (kind === 'prof' || kind === 'rICC') cleanIcc(b.subarray(colr.at + colr.hdr + 4, colr.at + colr.len));
    }
  }

  async function iso(read, size) {
    const patches = [], zeroRanges = [];
    let video = false;
    for (let at = 0; at + 8 <= size;) {
      const h = await read(at, 16);
      let len = u32(h, 0), hdr = 8;
      const type = ascii(h, 4, 4);
      if (len === 1) { len = u64(h, 8); hdr = 16; } else if (len === 0) len = size - at;
      if (len < hdr || at + len > size) bad('caixa cortada');
      if (type === 'moov') {
        video = true;
        const b = await read(at, len);
        moov(b, zeroRanges);
        patches.push({ at, bytes: b });
      } else if (type === 'meta') {
        const b = await read(at, len);
        const before = zeroRanges.length;
        heifMeta(b, zeroRanges);
        // Zerar algo que está dentro deste mesmo meta: zera direto nele
        for (let k = zeroRanges.length - 1; k >= before; k--) {
          const [o, n] = zeroRanges[k];
          if (o >= at && o + n <= at + len) { b.fill(0, o - at, o - at + n); zeroRanges.splice(k, 1); }
        }
        patches.push({ at, bytes: b });
      } else if (type === 'udta' || type === 'uuid') {
        const b = new Uint8Array(Math.min(len, 16));
        b.set(h.subarray(0, hdr));
        b.set(bytesOf('free'), 4);
        patches.push({ at, bytes: b }, { at: at + b.length, bytes: new Uint8Array(len - b.length) });
      }
      at += len;
    }
    // Faixas de zeros juntas quando encostam
    const merged = [];
    for (const [o, n] of zeroRanges.sort((a, c) => a[0] - c[0])) {
      if (!n || o >= size) continue;
      const end = Math.min(size, o + n), last = merged[merged.length - 1];
      if (last && o <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([o, end]);
    }
    for (const [o, e] of merged) patches.push({ at: o, bytes: new Uint8Array(e - o) });
    return { patches, video };
  }

  // ---------- PDF ----------
  // Muda no lugar, sem mudar o tamanho (o índice do PDF aponta para posições no arquivo): textos viram espaços
  function pdf(b) {
    const s = latin1(b);
    const blank = (from, to) => b.fill(0x20, from, to);
    const objAt = (n, g) => {
      const re = new RegExp(`(?:^|[^0-9])${n}\\s+${g}\\s+obj\\b`, 'g');
      const found = [];
      for (let m; (m = re.exec(s));) found.push(m.index + m[0].length);
      return found;
    };
    // O dicionário que começa em i: todo texto (string) dentro dele fica vazio. Devolve onde ele acaba.
    const blankDict = (i) => {
      i = s.indexOf('<<', i);
      if (i < 0) return;
      let depth = 0;
      while (i < s.length) {
        if (s.startsWith('<<', i)) { depth++; i += 2; continue; }
        if (s.startsWith('>>', i)) { depth--; i += 2; if (!depth) return; continue; }
        if (s[i] === '(') {
          const start = i + 1;
          let d = 1; i++;
          while (i < s.length && d) { if (s[i] === '\\') i++; else if (s[i] === '(') d++; else if (s[i] === ')') d--; i++; }
          blank(start, i - 1);
          continue;
        }
        if (s[i] === '<') { const e = s.indexOf('>', i); blank(i + 1, e); i = e + 1; continue; }
        i++;
      }
    };
    // /Info (autor, programa, datas, título): tira a referência e esvazia o dicionário
    // /Metadata (XMP): tira a referência e apaga o conteúdo do fluxo
    for (const m of s.matchAll(/\/(Info|Metadata)\s+(\d+)\s+(\d+)\s+R/g)) {
      blank(m.index, m.index + m[0].length);
      for (const at of objAt(m[2], m[3])) {
        if (m[1] === 'Info') { blankDict(at); continue; }
        const st = s.indexOf('stream', at), end = s.indexOf('endstream', st);
        if (st > 0 && end > st && st < s.indexOf('endobj', at)) blank(st + 6 + (s[st + 6] === '\r' ? 2 : 1), end);
      }
    }
    // XMP solto (sem compressão) em qualquer lugar, inclusive dentro das fotos
    for (const m of s.matchAll(/<\?xpacket begin/g)) {
      const end = s.indexOf('<?xpacket end', m.index);
      if (end > 0) blank(m.index, s.indexOf('?>', end) + 2);
    }
    // EXIF e IPTC das fotos (JPEG) dentro do PDF: o conteúdo do segmento é zerado, e o leitor o ignora
    for (const [marker, tag] of [[0xe1, 'Exif\0\0'], [0xed, 'Photoshop 3.0\0']]) {
      for (let i = s.indexOf(tag); i >= 4; i = s.indexOf(tag, i + 1)) {
        if (b[i - 4] !== 0xff || b[i - 3] !== marker) continue;
        b.fill(0, i, Math.min(b.length, i - 2 + u16(b, i - 2)));
      }
    }
    return b;
  }

  // ---------- Word, Excel, PowerPoint, LibreOffice (.zip) ----------
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  const VT = 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"';
  const OFFICE_EMPTY = {
    'docProps/core.xml': `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>`,
    'docProps/app.xml': `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ${VT}/>`,
    'docProps/custom.xml': `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ${VT}/>`,
  };
  const OFFICE_EDIT = {
    'meta.xml': (x) => x.replace(/<office:meta>[\s\S]*<\/office:meta>/, '<office:meta/>'), // LibreOffice
    'word/people.xml': (x) => x.replace(/<w15:presenceInfo\b[^>]*\/>/g, ''),              // e-mail/conta de quem comentou
    'xl/workbook.xml': (x) => x.replace(/<x15ac:absPath\b[^>]*\/>/g, ''),                  // pasta do PC onde a planilha estava
  };
  async function office(b) {
    let e = b.length - 22;
    while (e >= Math.max(0, b.length - 65557) && u32(b, e, true) !== 0x06054b50) e--;
    if (e < 0 || u32(b, e, true) !== 0x06054b50) bad('zip sem índice');
    const count = u16(b, e + 10, true), cdOff = u32(b, e + 16, true);
    if (count === 0xffff || cdOff === 0xffffffff) return null; // zip64: deixa como está
    const entries = [];
    for (let k = 0, p = cdOff; k < count; k++) {
      if (u32(b, p, true) !== 0x02014b50) bad('índice do zip quebrado');
      const nl = u16(b, p + 28, true), el = u16(b, p + 30, true), cl = u16(b, p + 32, true);
      entries.push({ flags: u16(b, p + 8, true), method: u16(b, p + 10, true), crc: u32(b, p + 16, true), csize: u32(b, p + 20, true),
        usize: u32(b, p + 24, true), local: u32(b, p + 42, true), nameBytes: b.subarray(p + 46, p + 46 + nl), name: utf8(b.subarray(p + 46, p + 46 + nl)) });
      p += 46 + nl + el + cl;
    }
    const names = new Set(entries.map((x) => x.name));
    if (!names.has('[Content_Types].xml') && !(names.has('mimetype') && names.has('meta.xml'))) return null; // .zip comum
    entries.sort((a, c) => a.local - c.local); // a ordem de dentro (o "mimetype" do LibreOffice tem que ser o primeiro)
    const parts = [], central = [];
    let at = 0;
    for (const x of entries) {
      const data0 = x.local + 30 + u16(b, x.local + 26, true) + u16(b, x.local + 28, true);
      let data = b.subarray(data0, data0 + x.csize);
      let { method, crc, usize } = x;
      const image = /\.(jpe?g|png|webp|gif)$/i.test(x.name);
      if (!(x.flags & 1) && (method === 0 || method === 8) && (OFFICE_EMPTY[x.name] || OFFICE_EDIT[x.name] || image)) {
        let raw = method === 8 ? await inflate(data, true) : data;
        if (OFFICE_EMPTY[x.name]) raw = bytesOf(OFFICE_EMPTY[x.name]);
        else if (OFFICE_EDIT[x.name]) raw = bytesOf(OFFICE_EDIT[x.name](utf8(raw)));
        else raw = (await strip(raw)) || raw;
        data = raw; method = 0; crc = crc32(raw); usize = raw.length;
      }
      const head = new Uint8Array(30);
      put32le(head, 0, 0x04034b50); put16le(head, 4, 20); put16le(head, 6, x.flags & 0x0800); put16le(head, 8, method);
      put16le(head, 10, 0); put16le(head, 12, 0x21); // hora 0, 1º de janeiro de 1980
      put32le(head, 14, crc); put32le(head, 18, data.length); put32le(head, 22, usize); put16le(head, 26, x.nameBytes.length);
      const cd = new Uint8Array(46);
      put32le(cd, 0, 0x02014b50); put16le(cd, 4, 20); cd.set(head.subarray(4, 30), 6); put32le(cd, 42, at);
      central.push(cd, x.nameBytes);
      parts.push(head, x.nameBytes, data);
      at += 30 + x.nameBytes.length + data.length;
    }
    const cdBytes = join(central);
    const end = new Uint8Array(22);
    put32le(end, 0, 0x06054b50); put16le(end, 8, entries.length); put16le(end, 10, entries.length);
    put32le(end, 12, cdBytes.length); put32le(end, 16, at);
    return join([...parts, cdBytes, end]);
  }

  // ---------- Nome ----------
  // Foto e vídeo com data no nome (IMG_20260927_153012.jpg, "WhatsApp Image 2026-09-27 at...") viram "foto.jpg"
  function cleanName(name, what) {
    if (!/(19|20)\d\d[-_. ]?[01]\d[-_. ]?[0-3]\d/.test(name)) return name;
    return `${what}${(name.match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0].toLowerCase()}`;
  }

  // Formato pelos primeiros 16 bytes
  function kind(b) {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b.length >= 8 && ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
    if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
    if (ascii(b, 0, 4) === 'GIF8') return 'gif';
    if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
    if (u32(b, 0, true) === 0x04034b50) return 'zip';
    if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(b, 4, 4))) return 'iso';
    return null;
  }

  // Bytes de uma imagem (JPEG, PNG, WebP, GIF) sem metadados, ou null se não for uma delas
  async function strip(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const k = kind(b);
    return k === 'jpeg' ? jpeg(b) : k === 'png' ? png(b) : k === 'webp' ? webp(b) : k === 'gif' ? gif(b) : null;
  }

  // Um arquivo (Blob/File) sem metadados: { blob, name }, ou null se o formato não tiver o que limpar
  async function clean(blob, name = '') {
    const read = async (at, n) => new Uint8Array(await blob.slice(at, at + n).arrayBuffer());
    const k = kind(await read(0, 16));
    if (!k) return null;
    const type = blob.type || '';
    if (k === 'iso') {
      const { patches, video } = await iso(read, blob.size);
      patches.sort((a, c) => a.at - c.at);
      const parts = [];
      let pos = 0;
      for (const p of patches) {
        if (p.at < pos) continue;
        parts.push(blob.slice(pos, p.at), p.bytes);
        pos = p.at + p.bytes.length;
      }
      parts.push(blob.slice(pos));
      return { blob: new Blob(parts, { type }), name: cleanName(name, video ? 'video' : 'foto') };
    }
    const b = await read(0, blob.size);
    if (k === 'pdf') return { blob: new Blob([pdf(b)], { type }), name };
    if (k === 'zip') { const z = await office(b); return z && { blob: new Blob([z], { type }), name }; }
    return { blob: new Blob([await strip(b)], { type }), name: cleanName(name, 'foto') };
  }

  return { kind, clean, cleanName, strip, orientation, cleanIcc, crc32 };
})();
if (typeof module !== 'undefined') module.exports = FileMetadata;
