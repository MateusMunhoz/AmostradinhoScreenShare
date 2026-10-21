// Abre o mobile/www no WebKit (o motor do Safari do iPhone) em 390x844 e confere que a interface carrega com a ponte:
// sem erro no console, window.api do iPhone no lugar e a tela inicial à vista. Roda no Windows, no Linux e no macOS.
//   npx playwright install webkit   (uma vez)   e   npm run test:webkit
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { montar } from '../scripts/montar-www.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.webp': 'image/webp', '.png': 'image/png',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

let ok = 0, bad = 0;
const check = (nome, cond, extra = '') => { if (cond) { ok++; console.log('OK   ', nome); } else { bad++; console.log('FALHA', nome, extra); } };

const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-www-'));
await montar({ raiz: RAIZ, saida });

const servidor = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const arquivo = path.join(saida, rel);
  if (!arquivo.startsWith(saida) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
  fs.createReadStream(arquivo).pipe(res);
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${servidor.address().port}/`;

let browser;
try {
  browser = await webkit.launch();
} catch (e) {
  console.log('Não consegui abrir o WebKit do Playwright:', e.message.split('\n')[0]);
  console.log('Rode uma vez: npx playwright install webkit');
  servidor.close();
  process.exit(2);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const erros = [];
  // O WebKit do Playwright no Windows não tem mediaDevices nem WebRTC; o WKWebView do iOS 14.5+ tem. Só o suficiente para o
  // inicio.js ligar os ouvintes na carga (a voz e as telas de verdade só se provam num iPhone)
  await page.addInitScript(() => {
    if (!navigator.mediaDevices) {
      const alvo = new EventTarget();
      alvo.enumerateDevices = async () => [];
      alvo.getUserMedia = async () => { throw new DOMException('sem microfone no teste', 'NotFoundError'); };
      Object.defineProperty(navigator, 'mediaDevices', { value: alvo, configurable: true });
    }
  });
  page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  // O WebKit avisa "Refused to apply a stylesheet… style-src" a cada el.style.x = … (CSSOM), mas aplica: o teste abaixo
  // confere que o tema entrou. Já o setAttribute('style') bloqueado seria erro de verdade e continua não sendo filtrado.
  const RUIDO = /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/;
  page.on('console', (m) => { if (m.type() === 'error' && !RUIDO.test(m.text())) erros.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => erros.push('requisição falhou: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) erros.push(`HTTP ${r.status()}: ${r.url()}`); });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500); // o inicio.js liga tudo na carga; deixa as chamadas assíncronas da ponte terminarem

  const estado = await page.evaluate(() => ({
    plataforma: window.api && window.api.platform,
    html: document.documentElement.dataset.plataforma,
    chaves: window.api ? Object.keys(window.api).length : 0,
    versao: null,
    titulo: document.title,
    inicio: !!document.getElementById('home') && !document.getElementById('home').hidden,
    sala: !!document.getElementById('room') && !document.getElementById('room').hidden,
    largura: document.documentElement.clientWidth,
    escondidos: ['goCreate', 'goQuick', 'homeRede'].filter((id) => { const e = document.getElementById(id); return !e || getComputedStyle(e).display === 'none'; }).length,
    rolagem: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    tema: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  }));
  estado.versao = await page.evaluate(() => window.api.getVersion());

  check('window.api é o do iPhone (platform = ios, 155 chaves)', estado.plataforma === 'ios' && estado.chaves === 155, JSON.stringify(estado));
  check('o <html> sabe que é iOS', estado.html === 'ios');
  check('a tela inicial aparece e a sala não', estado.inicio && !estado.sala, JSON.stringify(estado));
  check('a versão do app é a do desktop', estado.versao === JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version);
  check('o viewport é o do iPhone (390 px)', estado.largura === 390, String(estado.largura));
  check('o que não existe no iPhone (criar sala, rede) fica escondido', estado.escondidos === 3, JSON.stringify(estado.escondidos));
  check('sem rolagem lateral', estado.rolagem[0] === estado.rolagem[1], JSON.stringify(estado.rolagem));
  check('o tema entrou (as variáveis de cor escritas por JavaScript valem no WebKit)', /^#[0-9a-f]{6}$/i.test(estado.tema), estado.tema);
  check('nenhum erro no console, na página nem nas requisições', erros.length === 0, '\n  ' + [...new Set(erros)].join('\n  '));

  const foto = path.join(os.tmpdir(), 'nebula-ios-webkit.png');
  await page.screenshot({ path: foto });
  console.log('Foto da tela inicial:', foto);
} finally {
  await browser.close();
  servidor.close();
}
console.log(`${ok} ok, ${bad} falhas`);
process.exit(bad ? 1 : 0);
