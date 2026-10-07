'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiServer } = require('../razze-api/server');
const ROOT = 'test-bootstrap-token-with-thirty-plus-characters';
async function fixture(t, opts = {}) {
  let clock = 1000000;
  const server = createApiServer({ dbPath: ':memory:', adminToken: ROOT, requireApproval: false, stun: false, now: () => clock, ...opts });
  const address = await server.listen(0, '127.0.0.1');
  t.after(() => { server.server.closeAllConnections(); return server.close(); });
  const url = 'http://127.0.0.1:' + address.port;
  const req = async (route, method = 'GET', body, token) => {
    const response = await fetch(url + '/v1/' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ...(await response.json()), status: response.status };
  };
  const register = async name => req('auth/register', 'POST', { email: name + '@test.example', displayName: name, password: 'correct-password-123' });
  return { server, url, req, register, advance: ms => { clock += ms; } };
}
test('heartbeat: amigos online, redes e salas privadas; expiração e logout por sessão', async t => {
  const { req, register, advance } = await fixture(t);
  const a = await register('Alice'), b = await register('Bob'), stranger = await register('Eve');
  const friend = await req('friends/requests', 'POST', { email: b.user.email }, a.accessToken);
  await req('friends/requests/' + friend.id + '/accept', 'POST', undefined, b.accessToken);
  const { network } = await req('networks', 'POST', { name: 'Privada' }, a.accessToken);
  const invitation = await req('networks/' + network.id + '/invites', 'POST', {}, a.accessToken);
  await req('invites/accept', 'POST', { token: invitation.token }, b.accessToken);
  const deviceId = 'a'.repeat(32);
  const { device } = await req('networks/' + network.id + '/devices', 'POST', { deviceId, name: 'PC', publicKey: Buffer.alloc(32,1).toString('base64') }, a.accessToken);
  const heartbeat = { connections: [{ networkId: network.id, deviceId }], room: { id: 'f'.repeat(16), networkId: network.id, host: 'Alice', porta: 8765, pessoas: 2, senha: true } };
  assert.equal((await req('presence/heartbeat', 'POST', heartbeat, a.accessToken)).status, 200);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].online, true);
  const rooms = (await req('rooms', 'GET', undefined, b.accessToken)).rooms;
  assert.equal(rooms.length, 1); assert.equal(rooms[0].endereco, device.assignedIp); assert.equal(rooms[0].senha, true);
  assert.equal((await req('rooms', 'GET', undefined, stranger.accessToken)).rooms.length, 0);
  assert.equal((await req('presence/heartbeat', 'POST', heartbeat, stranger.accessToken)).status, 403);
  const listed = (await req('networks', 'GET', undefined, b.accessToken)).networks[0];
  assert.equal(listed.onlineCount, 1); assert.equal(listed.roomCount, 1);
  // Sala encerrada some na próxima batida, sem colocar o amigo offline.
  await req('presence/heartbeat', 'POST', { ...heartbeat, room: null }, a.accessToken);
  assert.equal((await req('rooms', 'GET', undefined, b.accessToken)).rooms.length, 0);
  await req('presence/heartbeat', 'POST', heartbeat, a.accessToken);
  advance(71000);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].online, false);
  assert.equal((await req('rooms', 'GET', undefined, b.accessToken)).rooms.length, 0);
  await req('presence/heartbeat', 'POST', heartbeat, a.accessToken);
  const second = await req('auth/login', 'POST', { email: a.user.email, password: 'correct-password-123' });
  await req('presence/heartbeat', 'POST', {}, second.accessToken);
  await req('auth/logout', 'POST', undefined, a.accessToken);
  assert.equal((await req('rooms', 'GET', undefined, b.accessToken)).rooms.length, 0);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].online, true);
  await req('presence', 'DELETE', undefined, second.accessToken);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].online, false);
});
test('administradores, aprovação, banimento, auditoria e consulta sanitizada ao banco', async t => {
  const { req, register, url } = await fixture(t);
  const a = await register('Admin'), b = await register('Member');
  assert.equal((await req('admin/users', 'GET', undefined, b.accessToken)).status, 403);
  assert.equal((await req('admin/users/' + a.user.id, 'PATCH', { role: 'admin' }, ROOT)).status, 200);
  assert.equal((await req('admin/me', 'GET', undefined, a.accessToken)).user.role, 'admin');
  assert.equal((await req('admin/users/' + a.user.id, 'PATCH', { role: 'user' }, ROOT)).status, 400);
  assert.equal((await req('admin/settings', 'PATCH', { requireApproval: true }, a.accessToken)).status, 200);
  const pending = await register('Pending'); assert.equal(pending.status, 202);
  assert.equal((await req('admin/users/' + pending.user.id + '/approve', 'POST', undefined, a.accessToken)).status, 200);
  await req('admin/users/' + b.user.id, 'PATCH', { status: 'disabled', banReason: 'Teste' }, a.accessToken);
  assert.equal((await req('me', 'GET', undefined, b.accessToken)).status, 401);
  assert.equal((await req('auth/login', 'POST', { email: b.user.email, password: 'correct-password-123' })).status, 403);
  await req('admin/users/' + b.user.id, 'PATCH', { status: 'active' }, a.accessToken);
  assert.equal((await req('auth/login', 'POST', { email: b.user.email, password: 'correct-password-123' })).status, 200);
  await req('admin/settings', 'PATCH', { registrationOpen: false }, a.accessToken);
  assert.equal((await register('Blocked')).status, 403);
  assert.equal((await req('admin/settings', 'PATCH', { presenceTimeoutSeconds: 3 }, a.accessToken)).status, 400);
  assert.equal((await req('admin/settings', 'PATCH', { unknown: true }, a.accessToken)).status, 400);
  for (const name of ['users', 'sessions', 'invites', 'audit_log']) {
    const page = await req('admin/database/' + name + '?limit=1', 'GET', undefined, a.accessToken);
    assert.equal(page.status, 200); assert.ok(page.rows.length <= 1);
    assert.doesNotMatch(JSON.stringify(page), /password_hash|password_salt|token_hash|accessToken/);
  }
  assert.equal((await req('admin/database/sqlite_master', 'GET', undefined, a.accessToken)).status, 404);
  assert.equal((await req('admin/database/users?offset=-1', 'GET', undefined, a.accessToken)).status, 400);
  const audit = await req('admin/database/audit_log', 'GET', undefined, a.accessToken);
  assert.ok(audit.rows.some(r => r.action === 'user.update' && r.target === b.user.id));
  const page = await fetch(url + '/admin/'); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /Clientes/);
});
test('clientes: uma conta mantém somente uma sessão ativa', async t => {
  const { req, register } = await fixture(t);
  const a = await register('Alice');

  const second = await req('auth/login', 'POST', {
    email: a.user.email,
    password: 'correct-password-123'
  });

  assert.notEqual(a.accessToken, second.accessToken);

  await req('presence/heartbeat', 'POST', {}, a.accessToken);
  await req('presence/heartbeat', 'POST', {}, second.accessToken);

  const clients = (await req('admin/clients', 'GET', undefined, ROOT)).clients;

  assert.equal(clients.length, 1);
  assert.equal(clients.filter(c => c.online).length, 1);

  const overview = await req('admin/overview', 'GET', undefined, ROOT);
  assert.equal(overview.connectedClients, 1);
  assert.equal(overview.online, 1);

  const statuses = [
    (await req('me', 'GET', undefined, a.accessToken)).status,
    (await req('me', 'GET', undefined, second.accessToken)).status
  ].sort();

  assert.deepEqual(statuses, [200, 401]);
});
test('configurações persistem após reiniciar e presença exige nova confirmação', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'razze-control-'));
  const dbPath = path.join(temp, 'data.sqlite');
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const first = await fixture(t, { dbPath });
  const a = await first.register('Alice');
  await first.req('admin/settings', 'PATCH', { requireApproval: true, presenceTimeoutSeconds: 90 }, ROOT);
  await first.req('presence/heartbeat', 'POST', {}, a.accessToken);
  await first.server.close();
  const second = await fixture(t, { dbPath });
  assert.equal((await second.req('admin/settings', 'GET', undefined, ROOT)).settings.requireApproval, true);
  assert.equal((await second.req('admin/overview', 'GET', undefined, ROOT)).online, 0);
  assert.equal((await second.register('Pending')).status, 202);
  await second.server.close();
});

test('sala do modo Internet: só os amigos aceitos veem, sem rede nem VPN, e some ao fechar ou expirar', async t => {
  const { req, register, advance } = await fixture(t);
  const a = await register('Ana'), b = await register('Bia'), stranger = await register('Eve');
  const friend = await req('friends/requests', 'POST', { email: b.user.email }, a.accessToken);
  await req('friends/requests/' + friend.id + '/accept', 'POST', undefined, b.accessToken);
  const passe = 'x'.repeat(43);
  const internetRoom = { servidor: 'ws://203.0.113.5:8765', codigo: 'ABC234', pessoas: 2, passe };
  assert.equal((await req('presence/heartbeat', 'POST', { internetRoom }, a.accessToken)).status, 200);
  const seen = (await req('rooms', 'GET', undefined, b.accessToken)).internet;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].host, 'Ana'); assert.equal(seen[0].codigo, 'ABC234'); assert.equal(seen[0].passe, passe);
  assert.equal((await req('rooms', 'GET', undefined, stranger.accessToken)).internet.length, 0);
  assert.equal((await req('rooms', 'GET', undefined, a.accessToken)).internet.length, 0); // a própria sala não aparece
  for (const bad of [{ ...internetRoom, servidor: 'https://x.com' }, { ...internetRoom, codigo: 'abc' }, { ...internetRoom, passe: 'curto' }, { ...internetRoom, pessoas: 0 }]) {
    assert.equal((await req('presence/heartbeat', 'POST', { internetRoom: bad }, a.accessToken)).status, 400);
  }
  await req('presence/heartbeat', 'POST', {}, a.accessToken);
  assert.equal((await req('rooms', 'GET', undefined, b.accessToken)).internet.length, 0);
  await req('presence/heartbeat', 'POST', { internetRoom }, a.accessToken);
  advance(71000);
  assert.equal((await req('rooms', 'GET', undefined, b.accessToken)).internet.length, 0);
  // Admin não vê o passe pelo banco
  const page = await req('admin/database/live_presence', 'GET', undefined, ROOT);
  assert.doesNotMatch(JSON.stringify(page), new RegExp(passe));
});

test('em que sala a pessoa está: só os amigos veem, sem endereço; some ao sair, ao expirar e não vaza para os membros da rede', async t => {
  const { req, register, advance } = await fixture(t);
  const a = await register('Ana'), b = await register('Bia'), stranger = await register('Eve');
  const friend = await req('friends/requests', 'POST', { email: b.user.email }, a.accessToken);
  await req('friends/requests/' + friend.id + '/accept', 'POST', undefined, b.accessToken);
  const salaAtual = { modo: 'radmin', host: 'Caio', pessoas: 4, voz: true };
  assert.equal((await req('presence/heartbeat', 'POST', { salaAtual }, a.accessToken)).status, 200);
  const ana = (await req('friends', 'GET', undefined, b.accessToken)).friends[0];
  assert.deepEqual(ana.sala, salaAtual);
  assert.equal((await req('friends', 'GET', undefined, stranger.accessToken)).friends.length, 0);
  // Membros de uma rede (que não precisam ser amigos) e a administração não recebem
  const { network } = await req('networks', 'POST', { name: 'Rede' }, a.accessToken);
  const invitation = await req('networks/' + network.id + '/invites', 'POST', {}, a.accessToken);
  await req('invites/accept', 'POST', { token: invitation.token }, stranger.accessToken);
  const members = await req('networks/' + network.id + '/members', 'GET', undefined, stranger.accessToken);
  assert.equal(members.status, 200);
  assert.ok(members.members.every(m => m.sala === undefined));
  assert.ok((await req('admin/users', 'GET', undefined, ROOT)).users.every(u => u.sala === undefined));
  for (const bad of [{ ...salaAtual, modo: 'lan' }, { ...salaAtual, host: '' }, { ...salaAtual, host: 'x'.repeat(33) }, { ...salaAtual, host: 'a\nb' },
    { ...salaAtual, pessoas: 0 }, { ...salaAtual, voz: 'sim' }, { ...salaAtual, endereco: '26.1.2.3' }]) {
    assert.equal((await req('presence/heartbeat', 'POST', { salaAtual: bad }, a.accessToken)).status, 400);
  }
  await req('presence/heartbeat', 'POST', { salaAtual: null }, a.accessToken);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].sala, null);
  await req('presence/heartbeat', 'POST', { salaAtual }, a.accessToken);
  advance(71000);
  const depois = (await req('friends', 'GET', undefined, b.accessToken)).friends[0];
  assert.equal(depois.online, false); assert.equal(depois.sala, null);
});

test('pedido de amizade pela conta (userId): acha pela id, mesmo com nickname repetido; id inexistente dá 404', async t => {
  const { req, register } = await fixture(t);
  const a = await register('Ana'), b = await register('Bia');
  const b2 = await req('auth/register', 'POST', { email: 'outra-bia@test.example', displayName: 'Bia', password: 'correct-password-123' });
  assert.equal((await req('friends/requests', 'POST', { nickname: 'Bia' }, a.accessToken)).status, 409);
  const pedido = await req('friends/requests', 'POST', { userId: b2.user.id }, a.accessToken);
  assert.equal(pedido.status, 201);
  const recebidos = await req('friends/requests', 'GET', undefined, b2.accessToken);
  assert.equal(recebidos.incoming[0].userId, a.user.id);
  assert.equal((await req('friends/requests', 'GET', undefined, b.accessToken)).incoming.length, 0);
  assert.equal((await req('friends/requests', 'POST', { userId: 'f'.repeat(32) }, a.accessToken)).status, 404);
  assert.equal((await req('friends/requests', 'POST', { userId: a.user.id }, a.accessToken)).status, 400);
});

test('mensagens criptografadas: chave pública por conta, entregue só aos amigos; texto cifrado longo aceito', async t => {
  const { req, register } = await fixture(t);
  const a = await register('Ana'), b = await register('Bia'), stranger = await register('Eve');
  const friend = await req('friends/requests', 'POST', { email: b.user.email }, a.accessToken);
  await req('friends/requests/' + friend.id + '/accept', 'POST', undefined, b.accessToken);
  const key = Buffer.alloc(32, 7).toString('base64');
  assert.equal((await req('me/dm-key', 'PUT', { publicKey: 'curta' }, a.accessToken)).status, 400);
  assert.equal((await req('me/dm-key', 'PUT', { publicKey: key }, a.accessToken)).status, 200);
  assert.equal((await req('friends', 'GET', undefined, b.accessToken)).friends[0].dmKey, key);
  assert.equal((await req('friends', 'GET', undefined, a.accessToken)).friends[0].dmKey, null);
  assert.equal((await req('friends', 'GET', undefined, stranger.accessToken)).friends.length, 0);
  const longE2e = 'e2e1:' + 'A'.repeat(8000);
  assert.equal((await req('messages', 'POST', { to: b.user.id, text: longE2e }, a.accessToken)).status, 201);
  assert.equal((await req('messages', 'POST', { to: b.user.id, text: 'x'.repeat(2001) }, a.accessToken)).status, 400);
  assert.equal((await req('messages', 'POST', { to: b.user.id, text: 'e2e1:' + 'A'.repeat(9001) }, a.accessToken)).status, 400);
  assert.equal((await req('messages', 'GET', undefined, b.accessToken)).messages[0].text, longE2e);
});

test('sinais da conexão direta: só entre amigos, só cifrados, entregues uma vez e apagados em 2 minutos', async t => {
  const { req, register, advance } = await fixture(t);
  const a = await register('Ana'), b = await register('Bia'), stranger = await register('Eve');
  const friend = await req('friends/requests', 'POST', { email: b.user.email }, a.accessToken);
  await req('friends/requests/' + friend.id + '/accept', 'POST', undefined, b.accessToken);
  const sinal = 'e2e1:' + 'B'.repeat(200);
  assert.equal((await req('signals', 'POST', { to: b.user.id, text: sinal }, a.accessToken)).status, 201);
  assert.equal((await req('signals', 'POST', { to: b.user.id, text: 'texto aberto' }, a.accessToken)).status, 400);
  assert.equal((await req('signals', 'POST', { to: b.user.id, text: 'e2e1:' + 'B'.repeat(16000) }, a.accessToken)).status, 400);
  assert.equal((await req('signals', 'POST', { to: b.user.id, text: sinal }, stranger.accessToken)).status, 403);
  assert.equal((await req('signals', 'POST', { to: a.user.id, text: sinal }, a.accessToken)).status, 403);
  const recebidos = await req('signals', 'GET', undefined, b.accessToken);
  assert.deepEqual(recebidos.signals.map(s => [s.from, s.text]), [[a.user.id, sinal]]);
  assert.equal((await req('signals', 'GET', undefined, b.accessToken)).signals.length, 0); // uma vez só
  // Não vão para o histórico das mensagens
  assert.equal((await req('messages', 'GET', undefined, b.accessToken)).messages.length, 0);
  // Esperando mais de 2 minutos, some
  await req('signals', 'POST', { to: b.user.id, text: sinal }, a.accessToken);
  advance(2 * 60 * 1000 + 1);
  assert.equal((await req('signals', 'GET', undefined, b.accessToken)).signals.length, 0);
});

test('feedback e bugs: valida, limita por hora e o administrador lista, vê o print, marca e apaga', async t => {
  const { req, register, advance } = await fixture(t);
  const a = await register('fbalice'), b = await register('fbbob');
  // Sem login, não
  assert.equal((await req('feedback', 'POST', { tipo: 'nota', nota: 9 })).status, 401);
  // Campos inválidos ou faltando
  for (const ruim of [{ tipo: 'outro' }, { tipo: 'bug', titulo: 'Sem área' }, { tipo: 'bug', area: 'cozinha', titulo: 'x' }, { tipo: 'nota', nota: 11 },
    { tipo: 'nota', nota: 5, usa: ['voz', 'pizza'] }, { tipo: 'nota', nota: 5, extra: 1 }, { tipo: 'ideia', titulo: 'x'.repeat(141) },
    { tipo: 'nota', nota: 5, tecnico: { senha: 'x' } }, { tipo: 'nota', nota: 5, imagem: 'data:image/png;base64,' + Buffer.from('nao e png').toString('base64') }]) {
    assert.equal((await req('feedback', 'POST', ruim, a.accessToken)).status, 400, JSON.stringify(ruim));
  }
  // Um PNG mínimo (só a assinatura conta para o servidor)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const bug = await req('feedback', 'POST', {
    tipo: 'bug', area: 'voz', titulo: '  Áudio sumiu  ', passos: '1. Entrei\r\n2. Saí\u0007', frequencia: 'as-vezes', impacto: 'bastante', contato: true,
    tecnico: { versao: '1.9.0', sistema: 'Windows 11', tema: 'estelar', naSala: true }, imagem: 'data:image/png;base64,' + png.toString('base64'),
  }, a.accessToken);
  assert.equal(bug.status, 201);
  assert.equal((await req('feedback', 'POST', { tipo: 'nota', nota: 9, usa: ['voz', 'voz', 'chat'], gosta: 'Transmissão' }, b.accessToken)).status, 201);
  // Limite: 5 por hora por conta
  for (let i = 0; i < 4; i++) assert.equal((await req('feedback', 'POST', { tipo: 'ideia', titulo: 'Ideia ' + i }, a.accessToken)).status, 201);
  assert.equal((await req('feedback', 'POST', { tipo: 'ideia', titulo: 'Demais' }, a.accessToken)).status, 429);
  advance(60 * 60 * 1000 + 1);
  assert.equal((await req('feedback', 'POST', { tipo: 'ideia', titulo: 'Depois de uma hora' }, a.accessToken)).status, 201);
  // Só administrador lista
  assert.equal((await req('admin/feedback', 'GET', undefined, a.accessToken)).status, 403);
  const lista = (await req('admin/feedback', 'GET', undefined, ROOT)).feedback;
  assert.equal(lista.length, 7);
  const item = lista.find(f => f.id === bug.id);
  assert.equal(item.respostas.titulo, 'Áudio sumiu');
  assert.equal(item.respostas.passos, '1. Entrei\n2. Saí');
  assert.equal(item.nome, 'fbalice'); assert.equal(item.status, 'novo'); assert.equal(item.temImagem, true); assert.equal(item.contato, true);
  assert.deepEqual(item.tecnico, { versao: '1.9.0', sistema: 'Windows 11', tema: 'estelar', naSala: true });
  assert.ok(!('imagem' in item));
  assert.deepEqual(lista.find(f => f.tipo === 'nota').respostas.usa, ['voz', 'chat']);
  const imagem = await req('admin/feedback/' + bug.id + '/imagem', 'GET', undefined, ROOT);
  assert.equal(imagem.tipo, 'image/png'); assert.ok(Buffer.from(imagem.dados, 'base64').equals(png));
  assert.equal((await req('admin/feedback/' + bug.id, 'PATCH', { status: 'arquivado' }, ROOT)).status, 400);
  assert.equal((await req('admin/feedback/' + bug.id, 'PATCH', { status: 'resolvido' }, ROOT)).status, 200);
  assert.equal((await req('admin/feedback', 'GET', undefined, ROOT)).feedback.find(f => f.id === bug.id).status, 'resolvido');
  assert.equal((await req('admin/feedback/' + bug.id, 'DELETE', undefined, ROOT)).status, 200);
  assert.equal((await req('admin/feedback/' + bug.id + '/imagem', 'GET', undefined, ROOT)).status, 404);
  const tabela = await req('admin/database/feedback?limit=5', 'GET', undefined, ROOT);
  assert.equal(tabela.status, 200); assert.equal(tabela.total, 6);
});
test('excluir conta: só desativada, nunca a própria; apaga em cascata e fica no histórico', async t => {
  const { req, register } = await fixture(t);
  const admin = await register('Admin'), calopsita = await register('Calopsita'), amiga = await register('Amiga');
  await req('admin/users/' + admin.user.id, 'PATCH', { role: 'admin' }, ROOT);
  const pedido = await req('friends/requests', 'POST', { email: amiga.user.email }, calopsita.accessToken);
  await req('friends/requests/' + pedido.id + '/accept', 'POST', undefined, amiga.accessToken);
  await req('networks', 'POST', { name: 'Da Calopsita' }, calopsita.accessToken);
  assert.equal((await req('admin/users/' + calopsita.user.id, 'DELETE', undefined, calopsita.accessToken)).status, 403); // quem não é admin
  assert.equal((await req('admin/users/' + calopsita.user.id, 'DELETE', undefined, admin.accessToken)).status, 409); // ativa: desative antes
  assert.equal((await req('admin/users/' + admin.user.id, 'DELETE', undefined, admin.accessToken)).status, 400); // a própria
  await req('admin/users/' + calopsita.user.id, 'PATCH', { status: 'disabled', banReason: 'Duplicada' }, admin.accessToken);
  assert.equal((await req('admin/users/' + calopsita.user.id, 'DELETE', undefined, admin.accessToken)).status, 200);
  assert.equal((await req('admin/users/' + calopsita.user.id, 'DELETE', undefined, admin.accessToken)).status, 404);
  assert.equal((await req('auth/login', 'POST', { email: calopsita.user.email, password: 'correct-password-123' })).status, 401);
  assert.equal((await req('friends', 'GET', undefined, amiga.accessToken)).friends.length, 0);
  const lista = (await req('admin/users', 'GET', undefined, admin.accessToken)).users;
  assert.ok(!lista.some(u => u.id === calopsita.user.id));
  const historico = await req('admin/database/audit_log?limit=50', 'GET', undefined, admin.accessToken);
  assert.match(JSON.stringify(historico), /user\.delete/);
});
