'use strict';

// Cliente SMTP da RazzeAPI (razze-api/email.js) contra um servidor SMTP falso local
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { enviarSmtp, montarMensagem, dotStuff, configDoAmbiente, criarCorreio } = require('../razze-api/email');

// Servidor falso: responde a cada comando conforme `respostas` (comando -> linha) e guarda a conversa
function servidorFalso(respostas = {}, { calado = false } = {}) {
  const conversa = [];
  let dados = '';
  const server = net.createServer((sock) => {
    sock.on('error', () => {});
    if (calado) return;
    let buffer = '';
    let emDados = false;
    sock.write('220 smtp.teste ESMTP\r\n');
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const linha = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (emDados) {
          if (linha === '.') { emDados = false; sock.write((respostas.FIM || '250 2.0.0 OK') + '\r\n'); }
          else dados += linha + '\r\n';
          continue;
        }
        conversa.push(linha);
        const verbo = linha.split(/[ :]/)[0].toUpperCase();
        if (verbo === 'EHLO') sock.write('250-smtp.teste\r\n250-AUTH PLAIN\r\n250 SIZE 1000\r\n');
        else if (verbo === 'AUTH') sock.write((respostas.AUTH || '235 2.7.0 Accepted') + '\r\n');
        else if (verbo === 'MAIL') sock.write('250 OK\r\n');
        else if (verbo === 'RCPT') sock.write((respostas.RCPT || '250 OK') + '\r\n');
        else if (verbo === 'DATA') { emDados = true; sock.write('354 Go ahead\r\n'); }
        else if (verbo === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, conversa, dados: () => dados,
    cfg: { host: '127.0.0.1', port: server.address().port, user: 'app@gmail.com', pass: 'abcdabcdabcdabcd', from: 'app@gmail.com', fromName: 'Nebula',
      conectar: () => net.connect(server.address().port, '127.0.0.1'), timeoutMs: 1500 },
  })));
}

test('conversa certa: autentica, manda para o destinatário e o corpo em base64 com assunto acentuado', async () => {
  const s = await servidorFalso();
  try {
    await enviarSmtp(s.cfg, { to: 'pessoa@example.com', subject: 'Confirme seu e-mail · Nebula', text: 'Seu código do Nebula é 123 456.\nVale 15 minutos.' });
    assert.match(s.conversa[0], /^EHLO /);
    assert.equal(s.conversa[1], 'AUTH PLAIN ' + Buffer.from('\0app@gmail.com\0abcdabcdabcdabcd').toString('base64'));
    assert.equal(s.conversa[2], 'MAIL FROM:<app@gmail.com>');
    assert.equal(s.conversa[3], 'RCPT TO:<pessoa@example.com>');
    const msg = s.dados();
    assert.match(msg, /^From: =\?UTF-8\?B\?TmVidWxh\?= <app@gmail.com>/m);
    assert.match(msg, /^Subject: =\?UTF-8\?B\?/m);
    const assunto = /^Subject: =\?UTF-8\?B\?(.+)\?=/m.exec(msg)[1];
    assert.equal(Buffer.from(assunto, 'base64').toString('utf8'), 'Confirme seu e-mail · Nebula');
    const corpo = msg.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    assert.equal(Buffer.from(corpo, 'base64').toString('utf8'), 'Seu código do Nebula é 123 456.\r\nVale 15 minutos.');
  } finally { s.server.close(); }
});

test('AUTH recusado e RCPT recusado viram erro com a resposta do servidor', async () => {
  const a = await servidorFalso({ AUTH: '535 5.7.8 Username and Password not accepted' });
  try { await assert.rejects(enviarSmtp(a.cfg, { to: 'x@example.com', subject: 's', text: 't' }), /SMTP 535/); } finally { a.server.close(); }
  const r = await servidorFalso({ RCPT: '550 5.1.1 No such user' });
  try { await assert.rejects(enviarSmtp(r.cfg, { to: 'x@example.com', subject: 's', text: 't' }), /SMTP 550/); } finally { r.server.close(); }
});

test('servidor calado: desiste no tempo', async () => {
  const s = await servidorFalso({}, { calado: true });
  try { await assert.rejects(enviarSmtp({ ...s.cfg, timeoutMs: 200 }, { to: 'x@example.com', subject: 's', text: 't' }), /a tempo/); }
  finally { s.server.close(); }
});

test('endereço com quebra de linha ou inválido não sai; cabeçalho sem quebra; ponto no início de linha dobra', async () => {
  await assert.rejects(enviarSmtp({ from: 'a@b.com' }, { to: 'x@example.com\r\nRCPT TO:<y@z.com>', subject: 's', text: 't' }), /inválido/);
  const m = montarMensagem({ from: 'a@b.com', to: 'c@d.com', subject: 'linha\r\nBcc: x@y.com', text: 'oi' });
  assert.doesNotMatch(m, /^Bcc:/m);
  assert.equal(dotStuff('a\r\n.b\r\n..c'), 'a\r\n..b\r\n...c');
});

test('configuração pelo ambiente: sem usuário fica desligado; senha de app sem espaços', () => {
  assert.equal(configDoAmbiente({}), null);
  const cfg = configDoAmbiente({ RAZZE_SMTP_USER: 'app@gmail.com', RAZZE_SMTP_PASS: 'abcd efgh ijkl mnop' });
  assert.deepEqual(cfg, { host: 'smtp.gmail.com', port: 465, user: 'app@gmail.com', pass: 'abcdefghijklmnop', from: 'app@gmail.com', fromName: 'Nebula' });
});

test('fila: tenta de novo e guarda o último erro sem travar quem pediu', async () => {
  let tentativas = 0;
  const erros = [];
  const correio = criarCorreio({ enviar: async () => { tentativas++; throw new Error('fora do ar'); }, esperas: [5, 5], log: { error: (m) => erros.push(m) } });
  correio.mandar({ to: 'pessoa@example.com', subject: 's', text: 'Seu código do Nebula é 123 456' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(tentativas, 3);
  assert.equal(correio.estado().ultimoErro, 'fora do ar');
  assert.doesNotMatch(erros.join(' '), /123 456|pessoa@/); // nem o código nem o e-mail inteiro no log
  assert.equal(criarCorreio({}).ativo, false);
});
