// Peças dos testes no WebKit: servir o www, um servidor do modo Internet local com uma sala criada por um "Ana" de mentira,
// e uma página que entra nela como o app do iPhone entraria.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { montar } from '../scripts/montar-www.mjs';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.webp': 'image/webp', '.png': 'image/png',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

export async function montarEServir() {
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
  return { saida, url: `http://127.0.0.1:${servidor.address().port}/`, fechar: () => servidor.close() };
}

// O PC da Ana: cria a sala no servidor local e fica nela (ela é quem o iPhone vê na lista)
export async function salaDaAna(servidorInternet, { senha = 'pizza-azul-marte', nome = 'Ana' } = {}) {
  const ws = new WebSocket(servidorInternet);
  await new Promise((ok, erro) => { ws.once('open', ok); ws.once('error', erro); });
  const welcome = await new Promise((ok, erro) => {
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'welcome') ok(m); else if (m.type === 'error') erro(new Error(m.message)); });
    ws.send(JSON.stringify({ type: 'hello', create: true, name: nome, password: senha, client: crypto.randomBytes(16).toString('hex') }));
  });
  return { ws, codigo: welcome.sala, senha, fechar: () => ws.close() };
}

// Pula a primeira entrada (o mesmo que tests/e2e/ajuda.js faz no desktop), aponta para o servidor local e entra pelo código
export async function entrarPeloCodigo(page, { servidor, codigo, senha, nome = 'Bia' }) {
  await page.evaluate(({ servidor, nome }) => {
    save('modoUso', 'rapida'); save('tourOferecido', '1');
    if (typeof fecharPrimeiraEntrada === 'function' && !document.getElementById('onboarding').hidden) fecharPrimeiraEntrada();
    saveNetworkPreferences({ provider: 'internet', internetUrl: servidor });
    renderHomeForNetwork();
    document.getElementById('name').value = nome;
  }, { servidor, nome });
  await page.click('#goJoin');
  await page.fill('#roomAddr', codigo);
  await page.fill('#joinPassword', senha);
  await page.click('#joinBtn');
  await page.waitForFunction(() => !!state.myId && !document.getElementById('room').hidden, null, { timeout: 15000 });
}

// O WebKit do Playwright no Windows não tem mediaDevices nem WebRTC (o do iOS tem): só o suficiente para o inicio.js ligar na carga
export const MEDIA_DEVICES_MINIMO = () => {
  if (!navigator.mediaDevices) {
    const alvo = new EventTarget();
    alvo.enumerateDevices = async () => [];
    alvo.getUserMedia = async () => { throw new DOMException('sem microfone no teste', 'NotFoundError'); };
    Object.defineProperty(navigator, 'mediaDevices', { value: alvo, configurable: true });
  }
};
