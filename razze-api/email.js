'use strict';

// Envio de e-mail da RazzeAPI (docs/spec/email-e-dois-fatores.md): cliente SMTP próprio, sem dependência, com TLS desde o
// início (porta 465, como o smtp.gmail.com com senha de app). Só texto puro: códigos e avisos de segurança.
const tls = require('node:tls');
const os = require('node:os');
const { randomBytes } = require('node:crypto');

const EMAIL_RE = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/;
const TEMPO_MS = 15_000;

const semQuebra = (s) => String(s).replace(/[\r\n]+/g, ' ');
const palavraUtf8 = (s) => '=?UTF-8?B?' + Buffer.from(semQuebra(s), 'utf8').toString('base64') + '?=';

// Monta a mensagem (cabeçalhos + corpo em base64). Ponto no início de linha não acontece em base64, mas o envio dobra
// mesmo assim (dotStuff), para qualquer corpo.
function montarMensagem({ from, fromName, to, subject, text, agora = new Date() }) {
  const dominio = String(from).split('@')[1] || 'localhost';
  const corpo = Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    'From: ' + (fromName ? palavraUtf8(fromName) + ' ' : '') + '<' + from + '>',
    'To: <' + to + '>',
    'Subject: ' + palavraUtf8(subject),
    'Date: ' + agora.toUTCString(),
    'Message-ID: <' + randomBytes(12).toString('hex') + '@' + dominio + '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    corpo,
  ].join('\r\n');
}

const dotStuff = (dados) => dados.replace(/(^|\r\n)\./g, '$1..');

// Uma conversa SMTP inteira. Rejeita com a resposta do servidor quando um passo não dá o código esperado.
function enviarSmtp(cfg, msg) {
  return new Promise((resolve, reject) => {
    if (!EMAIL_RE.test(msg.to) || !EMAIL_RE.test(cfg.from)) return reject(new Error('endereço de e-mail inválido'));
    // cfg.conectar: só nos testes (servidor SMTP falso sem TLS); de verdade é sempre TLS com o certificado conferido
    const socket = cfg.conectar ? cfg.conectar() : tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host });
    let buffer = '';
    let linhas = [];
    let esperando = null;
    let terminou = false;
    const fim = (erro) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(relogio);
      if (erro) socket.destroy(); else socket.end(); // depois do QUIT, fecha com calma
      erro ? reject(erro) : resolve();
    };
    const relogio = setTimeout(() => fim(new Error('o servidor de e-mail não respondeu a tempo')), cfg.timeoutMs || TEMPO_MS);
    // Resposta pode ter várias linhas ("250-..." até "250 ..."); entrega o código e o texto quando completa
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const linha = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        linhas.push(linha);
        if (/^\d{3} /.test(linha) || /^\d{3}$/.test(linha)) {
          const resposta = { codigo: Number(linha.slice(0, 3)), texto: linhas.join('\n') };
          linhas = [];
          const e = esperando; esperando = null;
          if (e) e(resposta);
        }
      }
    });
    socket.on('error', (erro) => fim(erro));
    socket.on('close', () => fim(new Error('o servidor de e-mail fechou a conexão')));
    const resposta = () => new Promise((ok) => { esperando = ok; });
    const passo = async (comando, aceitos) => {
      if (comando !== null) socket.write(comando + '\r\n');
      const r = await resposta();
      if (!aceitos.includes(r.codigo)) throw new Error('SMTP ' + r.codigo + ': ' + semQuebra(r.texto).slice(0, 200));
      return r;
    };
    (async () => {
      await passo(null, [220]);
      await passo('EHLO ' + (cfg.ehlo || os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'razze-api'), [250]);
      if (cfg.user) await passo('AUTH PLAIN ' + Buffer.from('\0' + cfg.user + '\0' + cfg.pass, 'utf8').toString('base64'), [235]);
      await passo('MAIL FROM:<' + cfg.from + '>', [250]);
      await passo('RCPT TO:<' + msg.to + '>', [250, 251]);
      await passo('DATA', [354]);
      await passo(dotStuff(montarMensagem({ ...msg, from: cfg.from, fromName: cfg.fromName })) + '\r\n.', [250]);
      socket.write('QUIT\r\n');
      fim();
    })().catch(fim);
  });
}

// Configuração pelo ambiente: sem RAZZE_SMTP_USER o e-mail fica desligado e o servidor funciona como antes
function configDoAmbiente(env = process.env) {
  if (!env.RAZZE_SMTP_USER) return null;
  return {
    host: env.RAZZE_SMTP_HOST || 'smtp.gmail.com',
    port: Number(env.RAZZE_SMTP_PORT || 465),
    user: env.RAZZE_SMTP_USER,
    pass: String(env.RAZZE_SMTP_PASS || '').replace(/\s/g, ''), // a senha de app do Google vem com espaços
    from: env.RAZZE_EMAIL_FROM || env.RAZZE_SMTP_USER,
    fromName: 'Nebula',
  };
}

// Fila: o pedido responde na hora e o e-mail vai por fora, com 3 tentativas (agora, depois de 10 s e de 60 s).
// enviar: a função que manda de verdade (nos testes, uma falsa). Falha final vai para o log sem o texto (tem o código).
function criarCorreio({ enviar, log = console, esperas = [10_000, 60_000] } = {}) {
  const estado = { ultimoErro: '', ultimoErroEm: 0, enviados: 0 };
  const tentar = (msg, n) => {
    Promise.resolve().then(() => enviar(msg)).then(() => { estado.enviados++; estado.ultimoErro = ''; }, (erro) => {
      if (n < esperas.length) {
        const t = setTimeout(() => tentar(msg, n + 1), esperas[n]);
        t.unref?.();
        return;
      }
      estado.ultimoErro = String(erro?.message || erro).slice(0, 200);
      estado.ultimoErroEm = Date.now();
      log.error?.('[RazzeAPI] e-mail para ' + msg.to.replace(/^(.).*(@.*)$/, '$1***$2') + ' não foi: ' + estado.ultimoErro);
    });
  };
  return {
    ativo: !!enviar,
    estado: () => ({ ...estado }),
    mandar(msg) { if (enviar) tentar(msg, 0); },
  };
}

module.exports = { enviarSmtp, montarMensagem, dotStuff, configDoAmbiente, criarCorreio, EMAIL_RE };
