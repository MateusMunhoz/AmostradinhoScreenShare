'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const { RazzeApiClient } = require('./razze-api-client');
const { createWireGuardManager } = require('./razze-wireguard');

function createRazzeService(options = {}) {
  const electronApp = options.app || app;
  const storage = options.safeStorage || safeStorage;
  const file = path.join(electronApp.getPath('userData'), 'razze', 'session.json');
  let baseUrl = '';
  let accessToken = '';
  let sealedToken = '';
  let client = null;

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    sealedToken = accessToken && storage.isEncryptionAvailable() ? storage.encryptString(accessToken).toString('base64') : '';
    fs.writeFileSync(file, JSON.stringify({ baseUrl, secret: sealedToken }), { mode: 0o600 });
  }

  function load() {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      baseUrl = String(saved.baseUrl || '');
      sealedToken = String(saved.secret || '');
    } catch {}
    unlockSession();
    recreateClient();
  }

  function unlockSession() {
    if (accessToken || !sealedToken || !storage.isEncryptionAvailable()) return;
    try { accessToken = storage.decryptString(Buffer.from(sealedToken, 'base64')); } catch { accessToken = ''; }
  }

  function recreateClient() {
    client = baseUrl ? new RazzeApiClient(baseUrl) : null;
    if (client) client.setAccessToken(accessToken);
  }

  function requireClient(authenticated = true) {
    unlockSession();
    recreateClient();
    if (!client) throw new Error('Configure o endereço do servidor Razze nas configurações.');
    if (authenticated && !accessToken) throw new Error('Entre na sua conta Razze para continuar.');
    return client;
  }

  function state() {
    unlockSession();
    return { configured: !!baseUrl, baseUrl, authenticated: !!accessToken };
  }

  function configure(url) {
    const next = new RazzeApiClient(url);
    if (baseUrl !== next.baseUrl) accessToken = '';
    if (!accessToken) sealedToken = '';
    baseUrl = next.baseUrl;
    recreateClient();
    persist();
    return state();
  }

  async function register(email, password, displayName) {
    const result = await requireClient(false).register(email, password, displayName);
    return { status: result.status || 'pending_approval', user: result.user };
  }

  async function login(email, password) {
    if (!storage.isEncryptionAvailable()) throw new Error('O Windows não disponibilizou armazenamento protegido para a sessão Razze.');
    const result = await requireClient(false).login(email, password);
    accessToken = result.accessToken;
    recreateClient();
    persist();
    return { user: result.user, state: state() };
  }

  async function logout() {
    try { if (client && accessToken) await client.logout(); } finally {
      accessToken = '';
      recreateClient();
      persist();
    }
    return state();
  }

  async function me() {
    try { return await requireClient().me(); }
    catch (error) {
      if (error.status === 401 || error.status === 403) {
        accessToken = '';
        sealedToken = '';
        recreateClient();
        persist();
      }
      throw error;
    }
  }

  load();
  const wireguard = options.wireguard || createWireGuardManager({ app: electronApp, safeStorage: storage });
  return {
    state, configure, register, login, logout,
    health: () => requireClient(false).health(),
    me,
    listNetworks: () => requireClient().listNetworks(),
    createNetwork: (network) => requireClient().createNetwork(network),
    updateNetwork: (id, patch) => requireClient().updateNetwork(id, patch),
    deleteNetwork: (id) => requireClient().deleteNetwork(id),
    listMembers: (id) => requireClient().listMembers(id),
    removeMember: (id, userId) => requireClient().removeMember(id, userId),
    listDevices: (id) => requireClient().listDevices(id),
    createInvite: (id, invite) => requireClient().createInvite(id, invite),
    acceptInvite: (token) => requireClient().acceptInvite(token),
    listFriends: () => requireClient().listFriends(),
    friendRequests: () => requireClient().friendRequests(),
    requestFriend: (nickname) => requireClient().requestFriend(nickname),
    acceptFriendRequest: (id) => requireClient().acceptFriendRequest(id),
    cancelFriendRequest: (id) => requireClient().cancelFriendRequest(id),
    removeFriend: (id) => requireClient().removeFriend(id),
    sendMessage: (to, text) => requireClient().sendMessage(to, text),
    messages: (after) => requireClient().messages(after),
    wireguard,
    api: () => requireClient(),
    // Ao abrir o app com o túnel já ligado: volta a buscar quem entrou na rede
    resume: (networkId) => wireguard.resume(requireClient(), networkId),
  };
}

module.exports = { createRazzeService };
