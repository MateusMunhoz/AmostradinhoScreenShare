const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform, // 'win32' ou 'linux': o que só existe num dos dois some da tela
  getSources: () => ipcRenderer.invoke('get-sources'),
  selectSource: (id, withSystemAudio) => ipcRenderer.invoke('select-source', id, withSystemAudio),
  listAudioApps: () => ipcRenderer.invoke('list-audio-apps'),
  startAppAudio: (exes) => ipcRenderer.invoke('start-app-audio', exes),
  stopAppAudio: () => ipcRenderer.invoke('stop-app-audio'),
  onPcm: (cb) => ipcRenderer.on('pcm', (_e, data) => cb(data)),
  pipSetEdit: (on) => ipcRenderer.invoke('pip-edit', on),
  pipSize: (id, key) => ipcRenderer.invoke('pip-size', String(id), key),
  pipOpacity: (id, v) => ipcRenderer.invoke('pip-opacity', String(id), v),
  pipGroup: (id, patch) => ipcRenderer.invoke('pip-group', String(id), patch),
  roomKeys: (on) => ipcRenderer.invoke('room-keys', !!on),
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  setShortcut: (action, accel) => ipcRenderer.invoke('set-shortcut', action, accel),
  ptt: (vk) => ipcRenderer.invoke('ptt', Number(vk) || 0),
  noiseWasm: (simd) => ipcRenderer.invoke('noise-wasm', !!simd),
  chatCompose: (on, opening = false) => ipcRenderer.invoke('chat-compose', !!on, !!opening),
  openLink: (url) => ipcRenderer.invoke('open-link', url),
  clipSave: (bytes, label) => ipcRenderer.invoke('clip-save', bytes, label),
  clipShow: (id) => ipcRenderer.invoke('clip-show', id),
  // Comando de voz (main/comando-voz.js): baixar e conferir o Whisper, transcrever o WAV do comando, a tecla de segurar
  vozCmdEstado: () => ipcRenderer.invoke('voz-cmd-estado'),
  vozCmdInstalar: (modelo) => ipcRenderer.invoke('voz-cmd-instalar', String(modelo || '')),
  vozCmdCancelar: () => ipcRenderer.invoke('voz-cmd-cancelar'),
  vozCmdRemover: () => ipcRenderer.invoke('voz-cmd-remover'),
  vozCmdTranscrever: (wav, modelo, dica) => ipcRenderer.invoke('voz-cmd-transcrever', wav instanceof Uint8Array ? wav : null, String(modelo || ''), String(dica || '')),
  vozCmdTecla: (on) => ipcRenderer.invoke('voz-cmd-tecla', !!on),
  // Pedidos livres (main/comando-voz-ia.js): a chave só vai, nunca volta
  vozIaEstado: () => ipcRenderer.invoke('voz-ia-estado'),
  vozIaChave: (chave) => ipcRenderer.invoke('voz-ia-chave', String(chave || '')),
  vozIaApagarChave: () => ipcRenderer.invoke('voz-ia-apagar-chave'),
  vozIaEntender: (texto, ctx, opcoes) => ipcRenderer.invoke('voz-ia-entender', String(texto || ''), ctx, opcoes),
  vozIaTestar: (opcoes) => ipcRenderer.invoke('voz-ia-testar', opcoes),
  vozCmdYoutube: (busca) => ipcRenderer.invoke('voz-cmd-youtube', String(busca || '')), // o primeiro vídeo da busca
  onVozCmd: (cb) => {
    ipcRenderer.removeAllListeners('voz-cmd');
    ipcRenderer.on('voz-cmd', (_e, msg) => cb(msg));
  },
  onPip: (cb) => {
    ipcRenderer.removeAllListeners('pip');
    ipcRenderer.on('pip', (_e, msg) => cb(msg));
  },
  videoCapProbe: () => ipcRenderer.invoke('videocap-probe'),
  videoCapStart: (opts) => ipcRenderer.invoke('videocap-start', opts),
  videoCapStop: () => ipcRenderer.invoke('videocap-stop'),
  videoCapCmd: (cmd) => ipcRenderer.invoke('videocap-cmd', cmd),
  onVideoCap: (onChunk, onStats, onEnded) => {
    for (const ch of ['vchunk', 'vstats', 'vended']) ipcRenderer.removeAllListeners(ch);
    ipcRenderer.on('vchunk', (_e, c) => onChunk(c));
    ipcRenderer.on('vstats', (_e, s) => onStats(s));
    ipcRenderer.on('vended', (_e, info) => onEnded(info));
  },
  offVideoCap: () => { for (const ch of ['vchunk', 'vstats', 'vended']) ipcRenderer.removeAllListeners(ch); },
  offPcm: () => ipcRenderer.removeAllListeners('pcm'),
  getIps: (provider) => ipcRenderer.invoke('get-ips', provider),
  // Configurações no celular (main/celular.js): servidor da rede local só enquanto o QR está aberto
  celularEntregar: (texto) => ipcRenderer.invoke('celular-entregar', String(texto || '')),
  celularReceber: () => ipcRenderer.invoke('celular-receber'),
  celularFechar: () => ipcRenderer.invoke('celular-fechar'),
  onCelular: (cb) => {
    ipcRenderer.removeAllListeners('celular');
    ipcRenderer.on('celular', (_e, msg) => cb(msg));
  },
  copyText: (text) => ipcRenderer.invoke('copy-text', String(text || '')),
  razzePresence: () => ipcRenderer.invoke('razze-presence-state'),
  razzeInternetRoom: (room) => ipcRenderer.invoke('razze-internet-room', room || null),
  razzeSalaAtual: (sala) => ipcRenderer.invoke('razze-sala-atual', sala || null),
  onRazzePresence: (callback) => { ipcRenderer.removeAllListeners('razze-presence'); ipcRenderer.on('razze-presence', (_event, value) => callback(value)); },
  razzeState: () => ipcRenderer.invoke('razze-state'),
  razzePendingInvite: () => ipcRenderer.invoke('razze-pending-invite'),
  onRazzeInvite: (callback) => {
    ipcRenderer.removeAllListeners('razze-invite');
    ipcRenderer.on('razze-invite', (_event, token) => callback(String(token || '')));
  },
  razzeConfigure: (url) => ipcRenderer.invoke('razze-configure', String(url || '')),
  razzeHealth: () => ipcRenderer.invoke('razze-health'),
  razzeMe: () => ipcRenderer.invoke('razze-me'),
  razzeRegister: (email, password, name) => ipcRenderer.invoke('razze-register', String(email || ''), String(password || ''), String(name || '')),
  razzeLogin: (email, password) => ipcRenderer.invoke('razze-login', String(email || ''), String(password || '')),
  razzeLogout: () => ipcRenderer.invoke('razze-logout'),
  razzeListNetworks: () => ipcRenderer.invoke('razze-list-networks'),
  razzeCreateNetwork: (network) => ipcRenderer.invoke('razze-create-network', network),
  razzeUpdateNetwork: (id, patch) => ipcRenderer.invoke('razze-update-network', String(id || ''), patch),
  razzeDeleteNetwork: (id) => ipcRenderer.invoke('razze-delete-network', String(id || '')),
  razzeAcceptInvite: (token) => ipcRenderer.invoke('razze-accept-invite', String(token || '')),
  razzeListMembers: (id) => ipcRenderer.invoke('razze-list-members', String(id || '')),
  razzeRemoveMember: (id, userId) => ipcRenderer.invoke('razze-remove-member', String(id || ''), String(userId || '')),
  razzeCreateInvite: (id, options) => ipcRenderer.invoke('razze-create-invite', String(id || ''), options),
  razzeFriends: () => ipcRenderer.invoke('razze-friends'),
  razzeFriendRequests: () => ipcRenderer.invoke('razze-friend-requests'),
  razzeRequestFriend: (nickname) => ipcRenderer.invoke('razze-request-friend', String(nickname || '')),
  razzeRequestFriendId: (userId, nome) => ipcRenderer.invoke('razze-request-friend-id', String(userId || ''), String(nome || '')),
  razzeAcceptFriend: (id) => ipcRenderer.invoke('razze-accept-friend', String(id || '')),
  razzeCancelFriendRequest: (id) => ipcRenderer.invoke('razze-cancel-friend-request', String(id || '')),
  razzeRemoveFriend: (id) => ipcRenderer.invoke('razze-remove-friend', String(id || '')),
  razzeGoogleConfig: () => ipcRenderer.invoke('razze-google-config'),
  razzeGoogleLogin: () => ipcRenderer.invoke('razze-google-login'),
  razzeGoogleLink: () => ipcRenderer.invoke('razze-google-link'),
  razzeGoogleUnlink: () => ipcRenderer.invoke('razze-google-unlink'),
  razzeChangePassword: (current, next) => ipcRenderer.invoke('razze-change-password', String(current || ''), String(next || '')),
  razzeResetPassword: (email, code, password) => ipcRenderer.invoke('razze-reset-password', String(email || ''), String(code || ''), String(password || '')),
  atividadeLer: (opcoes) => ipcRenderer.invoke('atividade-ler', { jogos: !!opcoes?.jogos, musica: !!opcoes?.musica, steam: Array.isArray(opcoes?.steam) ? opcoes.steam.slice(0, 500).map(String) : [] }),
  atividadeSteamJogos: (recarregar) => ipcRenderer.invoke('atividade-steam-jogos', !!recarregar),
  aoMudarMusica: (cb) => ipcRenderer.on('atividade-musica', (_e, m) => cb(m)), // só recebe: a música nova (ou null)
  razzeSetActivity: (activity) => ipcRenderer.invoke('razze-set-activity', { game: String(activity?.game || ''), artist: String(activity?.artist || ''), title: String(activity?.title || '') }),
  razzeSetBio: (bio) => ipcRenderer.invoke('razze-set-bio', String(bio || '')),
  razzeFeedback: (feedback) => ipcRenderer.invoke('razze-feedback', feedback && typeof feedback === 'object' ? feedback : {}),
  razzeFriendLinkCreate: () => ipcRenderer.invoke('razze-friend-link-create'),
  razzeFriendLinkList: () => ipcRenderer.invoke('razze-friend-link-list'),
  razzeFriendLinkRevoke: (id) => ipcRenderer.invoke('razze-friend-link-revoke', String(id || '')),
  razzeFriendLinkPreview: (token) => ipcRenderer.invoke('razze-friend-link-preview', String(token || '')),
  razzeFriendLinkAccept: (token) => ipcRenderer.invoke('razze-friend-link-accept', String(token || '')),
  razzeAdmin: (method, endpoint, body) => ipcRenderer.invoke('razze-admin', String(method || ''), String(endpoint || ''), body),
  razzePendingFriendLink: () => ipcRenderer.invoke('razze-pending-friend-link'),
  onFriendLink: (callback) => {
    ipcRenderer.removeAllListeners('razze-friend-link');
    ipcRenderer.on('razze-friend-link', (_event, token) => callback(String(token || '')));
  },
  razzeSendMessage: (to, text) => ipcRenderer.invoke('razze-send-message', String(to || ''), String(text || '')),
  razzeMessages: (after) => ipcRenderer.invoke('razze-messages', Number(after) || 0),
  dmList: (account) => ipcRenderer.invoke('dm-list', String(account || '')),
  dmLoad: (account, friend) => ipcRenderer.invoke('dm-load', String(account || ''), String(friend || '')),
  dmSave: (account, friend, data) => ipcRenderer.invoke('dm-save', String(account || ''), String(friend || ''), data),
  dmSignalSend: (to, text) => ipcRenderer.invoke('dm-signal-send', String(to || ''), String(text || '')),
  dmSignals: () => ipcRenderer.invoke('dm-signals'),
  dmRetencao: (days, account) => ipcRenderer.invoke('dm-retencao', Number(days) || 0, String(account || '')),
  dmImagemSalvar: (account, id, mime, bytes) => ipcRenderer.invoke('dm-imagem-salvar', String(account || ''), String(id || ''), String(mime || ''), bytes instanceof Uint8Array ? bytes : new Uint8Array(0)),
  dmImagemLer: (account, id) => ipcRenderer.invoke('dm-imagem-ler', String(account || ''), String(id || '')),
  dmExportar: (account) => ipcRenderer.invoke('dm-exportar', String(account || '')),
  dmImportar: (account, convs) => ipcRenderer.invoke('dm-importar', String(account || ''), Array.isArray(convs) ? convs : []),
  razzeWireGuardConnections: () => ipcRenderer.invoke('razze-wg-connections'),
  razzeWireGuardStatus: (networkId) => ipcRenderer.invoke('razze-wg-status', String(networkId || '')),
  razzeWireGuardConnect: (networkId, name) => ipcRenderer.invoke('razze-wg-connect', String(networkId || ''), String(name || 'Razze')),
  razzeWireGuardDisconnect: (networkId) => ipcRenderer.invoke('razze-wg-disconnect', String(networkId || '')),
  razzeWireGuardDisconnectAll: () => ipcRenderer.invoke('razze-wg-disconnect-all'),
  razzeWireGuardResume: (networkId) => ipcRenderer.invoke('razze-wg-resume', String(networkId || '')),
  getVersion: () => ipcRenderer.invoke('get-version'),
  windowMaterial: (mode, color) => ipcRenderer.invoke('window-material', String(mode || ''), String(color || '')),
  setTitleBar: (color, symbolColor) => ipcRenderer.invoke('window-titlebar', String(color || ''), String(symbolColor || '')),
  setWindowIcon: (png) => ipcRenderer.invoke('window-icon', String(png || '')),
  // Luz ambiente da música: as cores (PNG de 32 x 18) de um retângulo da janela do app
  captureRegion: (x, y, w, h) => ipcRenderer.invoke('capture-region', Number(x) || 0, Number(y) || 0, Number(w) || 0, Number(h) || 0),
  setPriority: (level) => ipcRenderer.invoke('set-priority', level),
  statsStart: () => ipcRenderer.invoke('stats-start'),
  statsStop: () => ipcRenderer.invoke('stats-stop'),
  onStats: (cb) => ipcRenderer.on('stats', (_e, s) => cb(s)),
  offStats: () => ipcRenderer.removeAllListeners('stats'),
  getOwnPack: () => ipcRenderer.invoke('get-own-pack'),
  installUpdate: (pack, sig) => ipcRenderer.invoke('install-update', pack, sig),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  githubCheck: () => ipcRenderer.invoke('github-check'),
  githubInstall: () => ipcRenderer.invoke('github-install'),
  openGithub: (url) => ipcRenderer.invoke('open-github', url),
  startServer: (port, password, seed, provider) => ipcRenderer.invoke('start-server', port, password, seed, provider),
  stopServer: (endRoom) => ipcRenderer.invoke('stop-server', !!endRoom),
  captureExclude: (on) => ipcRenderer.invoke('capture-exclude', !!on),
  // Sessões abertas na rede: escuta só com a tela inicial à vista
  sessoesObservar: (on) => ipcRenderer.invoke('sessoes-observar', !!on),
  onSessoes: (cb) => ipcRenderer.on('sessoes', (_e, lista) => cb(lista)),
});
