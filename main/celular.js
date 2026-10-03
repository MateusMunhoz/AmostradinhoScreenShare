'use strict';
// Configurações no celular (docs/spec/config-no-celular.md): um servidor pequeno na rede local, que só existe enquanto
// o QR está aberto nas configurações. Ele serve uma página simples para o navegador do celular:
// - entregar: o celular baixa o arquivo (já cifrado no PC, com a senha que só o PC conhece);
// - receber: o celular escolhe o arquivo guardado e envia para cá.
// Tudo fica atrás de uma chave de uso único no endereço (sem ela, 404), vale 5 minutos e serve uma vez só.
// A página do celular não faz cripto: num endereço http:// da rede local, o navegador não libera a WebCrypto.
// Só usa módulos do Node, para os testes rodarem sem o Electron (tests/celular-servidor.test.js).
const http = require('http');
const os = require('os');
const crypto = require('crypto');

const MAX = 4 * 1024 * 1024; // o arquivo (o fundo do perfil, um GIF de até 1 MB, é o maior item)
const VIDA = 5 * 60 * 1000;
let atual = null; // { server, chave, modo, arquivo, avisar, timer, usado }

// IPs da rede local (Wi-Fi ou cabo), onde o celular alcança o PC. Sem a Radmin (26.x) e sem os túneis Razze.
function ipsLocais(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (/razze/i.test(name) || /^rz[a-f0-9]{12}$/.test(name)) continue;
    for (const a of addrs || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (v4 && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push({ name, address: a.address });
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2); // Wi-Fi de casa costuma ser 192.168
  return out.sort((a, b) => rank(a.address) - rank(b.address));
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A página do celular: claro ou escuro conforme o celular, botões grandes, nada de fora
function pagina(modo, nome, nonce, chave) {
  const alvo = `/c/${chave}/arquivo`; // caminho completo: "arquivo" sozinho cairia em /c/arquivo
  const corpo = modo === 'entregar'
    ? `<h1>Guardar no celular</h1>
<p>Baixe o arquivo e deixe ele guardado no celular. Ele está cifrado com a senha que você escolheu no PC.</p>
<a class="btn" id="baixar" href="${alvo}" download="${escape(nome)}">Baixar arquivo</a>
<p class="dica" id="status">No iPhone, ele fica em Arquivos › Downloads. No Android, em Downloads.</p>
<script nonce="${nonce}">document.getElementById('baixar').addEventListener('click', () => {
  document.getElementById('status').textContent = 'Pronto. Pode fechar esta página.';
});</script>`
    : `<h1>Trazer do celular</h1>
<p>Escolha o arquivo <b>.tp2p</b> que você guardou. Depois, digite a senha no PC.</p>
<label class="btn" for="arquivo">Escolher arquivo</label>
<input id="arquivo" type="file" accept=".tp2p,application/json,text/plain">
<p class="dica" id="status"></p>
<script nonce="${nonce}">const status = document.getElementById('status');
document.getElementById('arquivo').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > ${MAX}) { status.textContent = 'Esse arquivo é grande demais.'; return; }
  status.textContent = 'Enviando…';
  try {
    const r = await fetch('${alvo}', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: await f.text() });
    status.textContent = r.ok ? 'Enviado. Agora digite a senha no PC.' : 'Esse arquivo não é uma configuração do Tela P2P.';
  } catch { status.textContent = 'Não foi possível enviar. O PC fechou o código?'; }
});</script>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tela P2P</title><style>
:root { color-scheme: light dark; --bg: #f4f6fa; --fg: #14161b; --muted: #5b6270; --accent: #0e7c8c; --ink: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #0b0c0e; --fg: #e3e7ee; --muted: #9aa3b2; --accent: #22e5fa; --ink: #0b0c0e; } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 17px/1.5 system-ui, sans-serif; }
main { max-width: 420px; padding: 32px 24px; }
h1 { font-size: 22px; margin: 0 0 12px; }
.btn { display: block; margin: 24px 0 12px; padding: 16px; border-radius: 12px; background: var(--accent); color: var(--ink); text-align: center; font-weight: 700; text-decoration: none; cursor: pointer; }
input[type=file] { position: absolute; width: 1px; height: 1px; opacity: 0; }
.dica { color: var(--muted); font-size: 15px; }
</style></head><body><main>${corpo}</main></body></html>`;
}

function responder(res, status, tipo, corpo, extra = {}) {
  res.writeHead(status, {
    'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra,
  });
  res.end(corpo);
}
const chaveCerta = (dada) => {
  if (!atual || typeof dada !== 'string' || dada.length !== atual.chave.length) return false;
  return crypto.timingSafeEqual(Buffer.from(dada), Buffer.from(atual.chave));
};

function atender(req, res) {
  const m = /^\/c\/([A-Za-z0-9_-]{43})(\/arquivo)?$/.exec(String(req.url || '').split('?')[0]);
  if (!atual || atual.usado || !m || !chaveCerta(m[1])) return responder(res, 404, 'text/plain; charset=utf-8', 'Não encontrado.');
  const sessao = atual;
  if (!m[2] && req.method === 'GET') {
    sessao.avisar({ tipo: 'aberto' });
    const nonce = crypto.randomBytes(16).toString('base64');
    return responder(res, 200, 'text/html; charset=utf-8', pagina(sessao.modo, sessao.nome, nonce, sessao.chave), {
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    });
  }
  if (m[2] && req.method === 'GET' && sessao.modo === 'entregar') {
    sessao.usado = true;
    res.on('finish', () => { sessao.avisar({ tipo: 'entregue' }); if (atual === sessao) fechar(); });
    return responder(res, 200, 'application/octet-stream', sessao.arquivo, { 'Content-Disposition': `attachment; filename="${sessao.nome}"` });
  }
  if (m[2] && req.method === 'POST' && sessao.modo === 'receber') {
    const partes = [];
    let tamanho = 0, cortado = false;
    req.on('data', (c) => {
      if (cortado) return;
      tamanho += c.length;
      if (tamanho > MAX) { cortado = true; responder(res, 413, 'text/plain; charset=utf-8', 'Grande demais.'); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      if (cortado) return;
      const texto = Buffer.concat(partes).toString('utf8');
      let ok = false;
      try { ok = JSON.parse(texto)?.app === 'tela-p2p-config'; } catch {}
      if (!ok) return responder(res, 400, 'text/plain; charset=utf-8', 'Não é uma configuração do Tela P2P.');
      sessao.usado = true;
      responder(res, 200, 'text/plain; charset=utf-8', 'ok');
      sessao.avisar({ tipo: 'recebido', texto });
      if (atual === sessao) fechar();
    });
    return undefined;
  }
  return responder(res, 404, 'text/plain; charset=utf-8', 'Não encontrado.');
}

// Abre a entrega (modo 'entregar', com o arquivo cifrado) ou o recebimento ('receber'). Fecha o que estiver aberto.
// avisar(msg): { tipo: 'aberto' | 'entregue' | 'recebido' (com texto) | 'expirou' }
async function abrir(modo, arquivo, avisar, { porta = 0, interfaces } = {}) {
  fechar();
  if (modo !== 'entregar' && modo !== 'receber') return { ok: false, error: 'Pedido inválido.' };
  if (modo === 'entregar' && (typeof arquivo !== 'string' || !arquivo || arquivo.length > MAX)) return { ok: false, error: 'Arquivo inválido.' };
  const ips = ipsLocais(interfaces);
  if (!ips.length) return { ok: false, error: 'Este PC não está numa rede local (Wi-Fi ou cabo). Conecte e tente de novo.' };
  const d = new Date(), dois = (n) => String(n).padStart(2, '0');
  const sessao = {
    modo, arquivo: modo === 'entregar' ? arquivo : '', avisar: typeof avisar === 'function' ? avisar : () => {},
    chave: crypto.randomBytes(32).toString('base64url'), usado: false,
    nome: `tela-p2p-config-${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}.tp2p`,
  };
  sessao.server = http.createServer(atender);
  sessao.server.on('clientError', (_e, socket) => socket.destroy());
  try {
    await new Promise((resolve, reject) => { sessao.server.once('error', reject); sessao.server.listen(porta, '0.0.0.0', resolve); });
  } catch {
    return { ok: false, error: 'Não foi possível abrir a conexão com o celular.' };
  }
  atual = sessao;
  sessao.timer = setTimeout(() => { if (atual === sessao) { sessao.avisar({ tipo: 'expirou' }); fechar(); } }, VIDA);
  const p = sessao.server.address().port;
  return { ok: true, urls: ips.map((ip) => ({ name: ip.name, url: `http://${ip.address}:${p}/c/${sessao.chave}` })), expira: Date.now() + VIDA };
}

function fechar() {
  if (!atual) return;
  const s = atual;
  atual = null;
  clearTimeout(s.timer);
  s.server.close();
  s.server.closeAllConnections?.();
}

module.exports = { abrir, fechar, ipsLocais, MAX, VIDA };
