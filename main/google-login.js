'use strict';
// Login com Google pelo navegador do sistema (nunca uma janela embutida: o Google bloqueia). Fluxo OAuth 2.0 com PKCE:
// o app abre a página do Google, o Google devolve o código para um servidor que vive só enquanto dura o login, em
// 127.0.0.1 numa porta livre, e o código segue para a RazzeAPI, que o troca pela conta (renderer nunca vê o código).
// O client ID vem da RazzeAPI (GET /v1/auth/google/config), então o app não leva credencial dentro dele.
const http = require('node:http');
const { createHash, randomBytes } = require('node:crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TEMPO_MS = 3 * 60 * 1000;
const PAGINA = (titulo, texto) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nebula</title>`
  + `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0D10;color:#D7DCE3;font:16px/1.5 system-ui,sans-serif}main{max-width:380px;padding:28px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#9A9EA4;margin:0}</style>`
  + `</head><body><main><h1>${titulo}</h1><p>${texto}</p></main></body></html>`;

const base64url = (buf) => buf.toString('base64url');
const novoVerificador = () => base64url(randomBytes(48)); // 64 caracteres
const desafio = (verificador) => base64url(createHash('sha256').update(verificador).digest());

function enderecoDeLogin({ clientId, redirectUri, verificador, estado }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
    code_challenge: desafio(verificador), code_challenge_method: 'S256', state: estado, prompt: 'select_account',
  });
  return AUTH_URL + '?' + q.toString();
}

// Abre o navegador no Google e espera o código. abrir(url) abre o endereço no navegador do sistema.
// Devolve { code, codeVerifier, redirectUri }. Falha se a pessoa cancelar, o estado não bater ou passar de 3 minutos.
function loginComGoogle({ clientId, abrir, tempoMs = TEMPO_MS }) {
  if (!/^[A-Za-z0-9._-]{10,200}$/.test(String(clientId || ''))) return Promise.reject(new Error('O servidor devolveu um cliente do Google inválido.'));
  const verificador = novoVerificador();
  const estado = base64url(randomBytes(24));
  return new Promise((resolve, reject) => {
    let terminou = false;
    const servidor = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const fim = (erro, valor) => {
        if (terminou) return;
        terminou = true;
        clearTimeout(timer);
        setTimeout(() => servidor.close(), 200); // deixa a resposta sair antes de fechar
        erro ? reject(erro) : resolve(valor);
      };
      const cabecalho = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" };
      if (url.searchParams.get('state') !== estado) {
        res.writeHead(400, cabecalho).end(PAGINA('Pedido inválido', 'Volte ao Nebula e tente entrar de novo.'));
        return fim(new Error('A resposta do Google não bateu com o pedido. Tente de novo.'));
      }
      const code = url.searchParams.get('code');
      if (url.searchParams.get('error') || !code) {
        res.writeHead(200, cabecalho).end(PAGINA('Login cancelado', 'Você pode fechar esta aba e voltar ao Nebula.'));
        return fim(new Error('O login com o Google foi cancelado.'));
      }
      res.writeHead(200, cabecalho).end(PAGINA('Pronto', 'Você pode fechar esta aba e voltar ao Nebula.'));
      fim(null, { code, codeVerifier: verificador, redirectUri: `http://127.0.0.1:${servidor.address().port}/callback` });
    });
    const timer = setTimeout(() => {
      if (terminou) return;
      terminou = true;
      servidor.close();
      reject(new Error('O login com o Google demorou demais. Tente de novo.'));
    }, tempoMs);
    servidor.on('error', (e) => { if (!terminou) { terminou = true; clearTimeout(timer); reject(e); } });
    servidor.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${servidor.address().port}/callback`;
      Promise.resolve(abrir(enderecoDeLogin({ clientId, redirectUri, verificador, estado }))).catch((e) => {
        if (terminou) return;
        terminou = true;
        clearTimeout(timer);
        servidor.close();
        reject(e);
      });
    });
  });
}

module.exports = { loginComGoogle, enderecoDeLogin, desafio, novoVerificador, AUTH_URL };
