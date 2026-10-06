'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const { RazzeApiClient } = require('./razze-api-client');
const { createWireGuardManager } = require('./razze-wireguard');
const { loginComGoogle } = require('./google-login');

// RazzeAPI da equipe (conta, amigos e salas dos amigos): quem instala agora já cria a conta sem configurar nada.
// TELA_RAZZE_API troca o padrão; vazia, o app começa sem servidor (os testes de ponta a ponta usam assim).
const API_PADRAO = process.env.TELA_RAZZE_API ?? 'https://srv2015370.hstgr.cloud';

function createRazzeService(options = {}) {
  const electronApp = options.app || app;
  const storage = options.safeStorage || safeStorage;
  const file = path.join(electronApp.getPath('userData'), 'razze', 'session.json');
  const padrao = options.baseUrl ?? API_PADRAO;
  let baseUrl = padrao;
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
      baseUrl = String(saved.baseUrl || padrao);
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

  // Login com Google: o navegador do sistema abre no Google (abrir vem do main.js), o código volta pelo PC e a RazzeAPI faz a troca
  async function googleConfig() {
    try { return await requireClient(false).googleConfig(); } catch { return { enabled: false, clientId: '' }; }
  }
  async function googleCodigo(abrir) {
    const cfg = await requireClient(false).googleConfig();
    if (!cfg.enabled) throw new Error('Entrar com Google não está ligado neste servidor.');
    return loginComGoogle({ clientId: cfg.clientId, abrir });
  }
  async function googleLogin(abrir) {
    if (!storage.isEncryptionAvailable()) throw new Error('O Windows não disponibilizou armazenamento protegido para a sessão Razze.');
    const result = await requireClient(false).googleLogin(await googleCodigo(abrir));
    if (result.status === 'pending_approval') return { status: 'pending_approval', user: result.user };
    accessToken = result.accessToken;
    recreateClient();
    persist();
    return { status: 'active', user: result.user, state: state() };
  }
  async function googleLink(abrir) {
    const login = await googleCodigo(abrir);
    return requireClient().googleLink(login);
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
    state, configure, register, login, logout, googleConfig, googleLogin, googleLink,
    googleUnlink: () => requireClient().googleUnlink(),
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
    // Pela conta (o Adicionar do perfil na sala). RazzeAPI antiga não conhece userId e responde 400: vai pelo nome do servidor
    requestFriendById: async (userId, nome) => {
      const client = requireClient();
      try { return await client.requestFriendById(userId); }
      catch (error) { if (error.status === 400 && nome) return client.requestFriend(nome); throw error; }
    },
    acceptFriendRequest: (id) => requireClient().acceptFriendRequest(id),
    cancelFriendRequest: (id) => requireClient().cancelFriendRequest(id),
    removeFriend: (id) => requireClient().removeFriend(id),
    changePassword: (current, next) => requireClient().changePassword(current, next),
    resetPassword: (email, code, password) => requireClient().resetPassword(email, code, password),
    setBio: (bio) => requireClient().setBio(bio),
    setActivity: (activity) => requireClient().setActivity(activity),
    friendLinkCreate: () => requireClient().friendLinkCreate(),
    friendLinkList: () => requireClient().friendLinkList(),
    friendLinkRevoke: (id) => requireClient().friendLinkRevoke(id),
    friendLinkPreview: (token) => requireClient().friendLinkPreview(token),
    friendLinkAccept: (token) => requireClient().friendLinkAccept(token),
    admin: (method, endpoint, body) => requireClient().admin(method, endpoint, body),
    sendMessage: (to, text) => requireClient().sendMessage(to, text),
    messages: (after) => requireClient().messages(after),
    wireguard,
    api: () => requireClient(),
    // Ao abrir o app com o túnel já ligado: volta a buscar quem entrou na rede
    resume: (networkId) => wireguard.resume(requireClient(), networkId),
  };
}

module.exports = { createRazzeService };
