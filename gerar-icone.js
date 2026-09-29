// Gera assets/icone/tela-p2p.ico (o ícone do .exe) com o mesmo desenho da barra de título, na cor padrão do
// tema (Detalhe 1). Roda pelo Electron para desenhar num canvas de verdade: npm run icone
// O .ico leva PNGs de 16 a 256 px; o Windows escolhe o tamanho certo para cada lugar.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const COLOR = '#D6C45C'; // Detalhe 1 padrão (renderer/preferencias-modelo.js)
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const OUT = path.join(__dirname, 'assets', 'icone');

// ICO com PNG dentro: cabeçalho de 6 bytes, uma entrada de 16 bytes por tamanho e os PNGs em seguida
function packIco(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<canvas></canvas>');
  const draw = fs.readFileSync(path.join(__dirname, 'renderer', 'icone-app.js'), 'utf8');
  await win.webContents.executeJavaScript(draw.replace("'use strict';", '') + '; window.drawAppIcon = drawAppIcon; 1');
  const pngs = [];
  for (const size of SIZES) {
    const url = await win.webContents.executeJavaScript(`(() => { const c = document.createElement('canvas'); c.width = c.height = ${size};
      drawAppIcon(c.getContext('2d'), ${size}, ${JSON.stringify(COLOR)}); return c.toDataURL('image/png'); })()`);
    pngs.push({ size, data: Buffer.from(url.split(',')[1], 'base64') });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'tela-p2p.ico'), packIco(pngs));
  fs.writeFileSync(path.join(OUT, 'tela-p2p.png'), pngs.at(-1).data);
  console.log('Ícone gerado em ' + path.relative(__dirname, OUT) + ': ' + SIZES.join(', ') + ' px');
  app.quit();
});
