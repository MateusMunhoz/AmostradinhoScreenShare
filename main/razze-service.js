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

  // Etapas do meio do login que ficam só aqui no processo principal: a página nunca vê o desafio do 2FA nem o ticket
  // do Google (docs/spec/email-e-dois-fatores.md, docs/spec/identificador-nome-tag.md)
  const pendente = { desafio: '', emailCadastro: '', ticketGoogle: '', ticketMover: '' };
  function exigirCofre() {
    if (!storage.isEncryptionAvailable()) throw new Error('O Windows não disponibilizou armazenamento protegido para a sessão Razze.');
  }
  function entrou(result) {
    accessToken = result.accessToken;
    pendente.desafio = '';
    recreateClient();
    persist();
    return { status: 'active', user: result.user, state: state() };
  }

  async function register(email, password, displayName, handleName) {
    const result = await requireClient(false).register(email, password, displayName, handleName);
    if (result.status === 'confirm_email') pendente.emailCadastro = String(email).trim().toLowerCase();
    return { status: result.status || 'pending_approval', user: result.user, enviadoPara: result.enviadoPara || '' };
  }
  // O código do cadastro: entra (ou espera a aprovação)
  async function confirmEmail(code) {
    if (!pendente.emailCadastro) throw new Error('Comece o cadastro de novo.');
    exigirCofre();
    const result = await requireClient(false).confirmEmail(pendente.emailCadastro, code);
    pendente.emailCadastro = '';
    if (!result.accessToken) return { status: 'pending_approval', user: result.user };
    return entrou(result);
  }
  async function resendConfirmation() {
    if (!pendente.emailCadastro) throw new Error('Comece o cadastro de novo.');
    return requireClient(false).resendConfirmation(pendente.emailCadastro);
  }

  // login: e-mail ou identificador. Com 2FA, devolve { status: '2fa_required' } e guarda o desafio para login2fa
  async function login(login, password) {
    exigirCofre();
    try { return entrou(await requireClient(false).login(login, password)); }
    catch (error) {
      if (error.code === '2fa_required' && error.data?.challenge) { pendente.desafio = error.data.challenge; return { status: '2fa_required' }; }
      if (error.code === 'email_unconfirmed') {
        pendente.emailCadastro = error.data?.email || (String(login).includes('@') ? String(login).trim().toLowerCase() : '');
        return { status: 'email_unconfirmed', email: pendente.emailCadastro };
      }
      throw error;
    }
  }
  async function login2fa(code) {
    if (!pendente.desafio) throw new Error('Entre com a senha de novo.');
    try { return entrou(await requireClient(false).login2fa(pendente.desafio, code)); }
    catch (error) { if (error.code === 'challenge_expired') pendente.desafio = ''; throw error; }
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
  // Conta nova pelo Google: o servidor pede o nome antes de criar (choose_handle). E-mail que já tem conta: o ticket
  // fica guardado para vincular este Google logo depois de entrar com a senha (googleLinkPending).
  async function googleLogin(abrir) {
    exigirCofre();
    let result;
    try { result = await requireClient(false).googleLogin({ ...(await googleCodigo(abrir)), escolherNome: true }); }
    catch (error) {
      if (error.code !== 'account_exists') throw error;
      pendente.ticketGoogle = error.data?.ticket || '';
      return { status: 'account_exists', handle: error.data?.handle || '', message: error.message };
    }
    if (result.status === 'choose_handle') {
      pendente.ticketGoogle = result.ticket || '';
      return { status: 'choose_handle', suggestion: result.suggestion || '', email: result.email || '', displayName: result.displayName || '' };
    }
    if (result.status === 'pending_approval') return { status: 'pending_approval', user: result.user };
    return entrou(result);
  }
  async function googleFinish(handleName) {
    if (!pendente.ticketGoogle) throw new Error('Entre com o Google de novo.');
    exigirCofre();
    const result = await requireClient(false).googleFinish(pendente.ticketGoogle, handleName);
    pendente.ticketGoogle = '';
    if (result.status === 'pending_approval') return { status: 'pending_approval', user: result.user };
    return entrou(result);
  }
  // O Google é de outra conta: guarda o ticket para mover (googleMove) e devolve o que a outra conta tem
  function googleConflito(error) {
    if (error.code !== 'google_taken') throw error;
    const d = error.data || {};
    pendente.ticketMover = d.ticket || '';
    return { status: 'google_taken', message: error.message, handle: d.handle || '', amigos: d.amigos || 0, mensagens: d.mensagens || 0, redes: d.redes || 0, excluir: !!d.excluir, bloqueio: d.bloqueio || '' };
  }
  async function googleLink(abrir, confirmacao = {}) {
    const login = await googleCodigo(abrir);
    try { return { status: 'linked', user: (await requireClient().googleLink({ ...login, ...confirmacao })).user }; }
    catch (error) { return googleConflito(error); }
  }
  // Depois de entrar com a senha no "Entrar e vincular": vincula o Google que já foi confirmado
  async function googleLinkPending(confirmacao = {}) {
    if (!pendente.ticketGoogle) return { status: 'none' };
    const ticket = pendente.ticketGoogle;
    try {
      const r = await requireClient().googleLink({ ticket, ...confirmacao });
      pendente.ticketGoogle = '';
      return { status: 'linked', user: r.user };
    } catch (error) {
      if (error.code === 'ticket_expired') pendente.ticketGoogle = '';
      return googleConflito(error);
    }
  }
  async function googleMove(confirmacao = {}) {
    if (!pendente.ticketMover) throw new Error('Vincule o Google de novo.');
    const r = await requireClient().googleLink({ ticket: pendente.ticketMover, move: true, ...confirmacao });
    pendente.ticketMover = '';
    return { status: 'moved', user: r.user, deleted: !!r.deleted };
  }
  const temGooglePendente = () => !!pendente.ticketGoogle;

  async function logout() {
    try { if (client && accessToken) await client.logout(); } finally {
      accessToken = '';
      Object.assign(pendente, { desafio: '', emailCadastro: '', ticketGoogle: '', ticketMover: '' });
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
    state, configure, register, confirmEmail, resendConfirmation, login, login2fa, logout,
    googleConfig, googleLogin, googleFinish, googleLink, googleLinkPending, googleMove, temGooglePendente,
    googleUnlink: (confirmacao) => requireClient().googleUnlink(confirmacao),
    forgot: (login) => requireClient(false).forgot(login),
    forgotReset: (body) => requireClient(false).forgotReset(body),
    setHandle: (name) => requireClient().setHandle(name),
    changeEmail: (body) => requireClient().changeEmail(body),
    verifyEmail: () => requireClient().verifyEmail(),
    confirmEmailChange: (code, purpose) => requireClient().confirmEmailChange(code, purpose),
    passwordSetup: (body) => requireClient().passwordSetup(body),
    twoFactorSetup: (confirmacao) => requireClient().twoFactorSetup(confirmacao),
    twoFactorEnable: (code) => requireClient().twoFactorEnable(code),
    twoFactorDisable: (confirmacao) => requireClient().twoFactorDisable(confirmacao),
    twoFactorRecovery: (confirmacao) => requireClient().twoFactorRecovery(confirmacao),
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
    changePassword: (current, next, code2fa) => requireClient().changePassword(current, next, code2fa),
    resetPassword: (email, code, password) => requireClient().resetPassword(email, code, password),
    setBio: (bio) => requireClient().setBio(bio),
    sendFeedback: (feedback) => requireClient().sendFeedback(feedback),
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
