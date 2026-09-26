const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
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
  chatCompose: (on, opening = false) => ipcRenderer.invoke('chat-compose', !!on, !!opening),
  openLink: (url) => ipcRenderer.invoke('open-link', url),
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
  getIps: () => ipcRenderer.invoke('get-ips'),
  getVersion: () => ipcRenderer.invoke('get-version'),
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
  startServer: (port, password, seed) => ipcRenderer.invoke('start-server', port, password, seed),
  stopServer: (endRoom) => ipcRenderer.invoke('stop-server', !!endRoom),
});
