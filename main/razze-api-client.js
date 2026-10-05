'use strict';

class RazzeApiError extends Error {
  constructor(status, code, message) { super(message); this.name = 'RazzeApiError'; this.status = status; this.code = code; }
}

class RazzeApiClient {
  constructor(baseUrl, options = {}) {
    let parsed;
    let raw = String(baseUrl || '').trim();
    // Digitado sem o protocolo ("api.seudominio.com" ou "127.0.0.1:8787"): HTTPS, ou HTTP no próprio PC
    if (raw && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = (/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(raw) ? 'http://' : 'https://') + raw;
    try { parsed = new URL(raw); } catch { throw new Error('URL da RazzeAPI inválida.'); }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
      throw new Error('A RazzeAPI deve usar HTTPS; HTTP só é aceito em localhost.');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('A URL da RazzeAPI não pode conter credenciais ou parâmetros.');
    this.baseUrl = parsed.origin.replace(/\/+$/, '');
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 15_000;
    this.accessToken = '';
  }

  setAccessToken(token) { this.accessToken = typeof token === 'string' ? token : ''; }

  async request(method, endpoint, body) {
    const headers = { Accept: 'application/json' };
    if (this.accessToken) headers.Authorization = 'Bearer ' + this.accessToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await this.fetch(this.baseUrl + endpoint, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') throw new RazzeApiError(0, 'timeout', 'A RazzeAPI não respondeu a tempo.');
      throw new RazzeApiError(0, 'network_error', 'Não foi possível acessar a RazzeAPI.');
    }
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = payload && payload.error || {};
      throw new RazzeApiError(response.status, error.code || 'request_failed', error.message || 'A RazzeAPI recusou a requisição.');
    }
    return payload;
  }

  heartbeat(body) { return this.request('POST', '/v1/presence/heartbeat', body); }
  offline() { return this.request('DELETE', '/v1/presence'); }
  listRooms() { return this.request('GET', '/v1/rooms'); }
  health() { return this.request('GET', '/v1/health'); }
  register(email, password, displayName) { return this.request('POST', '/v1/auth/register', { email, password, displayName }); }
  login(email, password) { return this.request('POST', '/v1/auth/login', { email, password }); }
  logout() { return this.request('POST', '/v1/auth/logout'); }
  me() { return this.request('GET', '/v1/me'); }
  listFriends() { return this.request('GET', '/v1/friends'); }
  friendRequests() { return this.request('GET', '/v1/friends/requests'); }
  requestFriend(nickname) { return this.request('POST', '/v1/friends/requests', { nickname }); }
  acceptFriendRequest(id) { return this.request('POST', '/v1/friends/requests/' + encodeURIComponent(id) + '/accept'); }
  cancelFriendRequest(id) { return this.request('DELETE', '/v1/friends/requests/' + encodeURIComponent(id)); }
  removeFriend(id) { return this.request('DELETE', '/v1/friends/' + encodeURIComponent(id)); }
  googleConfig() { return this.request('GET', '/v1/auth/google/config'); }
  googleLogin(login) { return this.request('POST', '/v1/auth/google', login); }
  googleLink(login) { return this.request('POST', '/v1/me/google', login); }
  googleUnlink() { return this.request('DELETE', '/v1/me/google'); }
  changePassword(currentPassword, newPassword) { return this.request('POST', '/v1/me/password', { currentPassword, newPassword }); }
  resetPassword(email, code, password) { return this.request('POST', '/v1/auth/reset', { email, code, password }); }
  setActivity(activity) { return this.request('PUT', '/v1/me/activity', activity); }
  setBio(bio) { return this.request('PATCH', '/v1/me', { bio }); }
  friendLinkCreate() { return this.request('POST', '/v1/friends/links'); }
  friendLinkList() { return this.request('GET', '/v1/friends/links'); }
  friendLinkRevoke(id) { return this.request('DELETE', '/v1/friends/links/' + encodeURIComponent(id)); }
  friendLinkPreview(token) { return this.request('GET', '/v1/friends/links/preview?token=' + encodeURIComponent(token)); }
  friendLinkAccept(token) { return this.request('POST', '/v1/friends/links/accept', { token }); }
  sendMessage(to, text) { return this.request('POST', '/v1/messages', { to, text }); }
  setDmKey(publicKey) { return this.request('PUT', '/v1/me/dm-key', { publicKey }); }
  messages(after = 0) { return this.request('GET', '/v1/messages?after=' + Math.max(0, Math.floor(Number(after) || 0))); }
  listNetworks() { return this.request('GET', '/v1/networks'); }
  getNetwork(id) { return this.request('GET', '/v1/networks/' + encodeURIComponent(id)); }
  createNetwork(network) { return this.request('POST', '/v1/networks', network); }
  updateNetwork(id, patch) { return this.request('PATCH', '/v1/networks/' + encodeURIComponent(id), patch); }
  deleteNetwork(id) { return this.request('DELETE', '/v1/networks/' + encodeURIComponent(id)); }
  listMembers(id) { return this.request('GET', '/v1/networks/' + encodeURIComponent(id) + '/members'); }
  removeMember(id, userId) { return this.request('DELETE', '/v1/networks/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(userId)); }
  listDevices(id) { return this.request('GET', '/v1/networks/' + encodeURIComponent(id) + '/devices'); }
  registerDevice(id, device) { return this.request('POST', '/v1/networks/' + encodeURIComponent(id) + '/devices', device); }
  updateDeviceEndpoint(id, deviceId, endpoint) { return this.request('PATCH', '/v1/networks/' + encodeURIComponent(id) + '/devices/' + encodeURIComponent(deviceId) + '/endpoint', endpoint); }
  removeDevice(id, deviceId) { return this.request('DELETE', '/v1/networks/' + encodeURIComponent(id) + '/devices/' + encodeURIComponent(deviceId)); }
  createInvite(id, options = {}) { return this.request('POST', '/v1/networks/' + encodeURIComponent(id) + '/invites', options); }
  acceptInvite(token) { return this.request('POST', '/v1/invites/accept', { token }); }
}

module.exports = { RazzeApiClient, RazzeApiError };
