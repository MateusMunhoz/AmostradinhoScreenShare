'use strict';

// O painel de administração do app só fala com as rotas do painel (main/razze-api-client.js)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RazzeApiClient } = require('../main/razze-api-client');

function cliente() {
  const chamadas = [];
  const c = new RazzeApiClient('http://127.0.0.1:8787', { fetch: async (url, opts) => { chamadas.push({ url, method: opts.method, body: opts.body }); return { ok: true, json: async () => ({ ok: true }) }; } });
  c.setAccessToken('t'.repeat(40));
  return { c, chamadas };
}
const ID = 'a'.repeat(32);

test('admin: as rotas do painel passam, com método e corpo', async () => {
  const { c, chamadas } = cliente();
  await c.admin('GET', '/v1/admin/analytics');
  await c.admin('GET', '/v1/admin/users');
  await c.admin('PATCH', '/v1/admin/users/' + ID, { grupo: 'teste' });
  await c.admin('POST', '/v1/admin/users/' + ID + '/approve');
  await c.admin('POST', '/v1/admin/users/' + ID + '/revoke-sessions');
  await c.admin('POST', '/v1/admin/allowlist', { email: 'a@b.com', grupo: 'amigo' });
  await c.admin('DELETE', '/v1/admin/allowlist/' + encodeURIComponent('a@b.com'));
  await c.admin('PATCH', '/v1/admin/settings', { googleOnly: true });
  await c.admin('GET', '/v1/admin/feedback');
  await c.admin('GET', '/v1/admin/feedback/' + ID + '/imagem');
  await c.admin('PATCH', '/v1/admin/feedback/' + ID, { status: 'visto' });
  await c.admin('DELETE', '/v1/admin/feedback/' + ID);
  assert.equal(chamadas.length, 12);
  assert.equal(chamadas[2].url, 'http://127.0.0.1:8787/v1/admin/users/' + ID);
  assert.equal(chamadas[2].body, '{"grupo":"teste"}');
});

test('admin: o que não é do painel não sai do app', async () => {
  const { c, chamadas } = cliente();
  const recusa = async (method, rota, body) => assert.rejects(async () => c.admin(method, rota, body), (e) => e.code === 'admin_route' || e.code === 'admin_body', method + ' ' + rota);
  await recusa('GET', '/v1/admin/database');
  await recusa('GET', '/v1/admin/database/users');
  await recusa('GET', '/v1/admin/clients');
  await recusa('DELETE', '/v1/admin/networks/' + ID);
  await recusa('POST', '/v1/admin/users/' + ID + '/reset-code');
  await recusa('GET', '/v1/me');
  await recusa('GET', '/v1/admin/feedback/' + ID + '/outra');
  await recusa('GET', '/v1/admin/feedback/xyz');
  await recusa('GET', '/v1/admin/users/../../me');
  await recusa('GET', '/v1/admin/users?x=1');
  await recusa('GET', 'https://evil.example/v1/admin/users');
  await recusa('PUT', '/v1/admin/settings', {});
  await recusa('PATCH', '/v1/admin/settings', [1]);
  await recusa('PATCH', '/v1/admin/settings', { x: 'a'.repeat(3000) });
  assert.equal(chamadas.length, 0);
});
