const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', path.join(__dirname, '..', '.test-profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
const windows = [];
const deadline = setTimeout(() => { console.error('Tempo esgotado no teste RTC'); app.exit(1); }, 30000);
const run = (w, code) => w.webContents.executeJavaScript(code);
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    for (const id of ['1', '2']) {
      const w = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
      windows.push(w);
      await w.loadFile(path.join(__dirname, 'rtc-smoke.html'));
      await run(w, `
        window.messages = []; window.errors = [];
        window.context = new AudioContext();
        window.oscillator = context.createOscillator();
        window.destination = context.createMediaStreamDestination();
        oscillator.connect(destination); oscillator.start();
        window.voice = new VoiceChat({
          send: m => messages.push(m), changed() {}, error: e => errors.push(e),
          media: { getUserMedia: async () => destination.stream },
        });
        voice.reset({ id: '${id}', features: ['voice'], members: [] });
        voice.join();
      `);
    }
    async function pump() {
      for (let i = 0; i < windows.length; i++) {
        // Mesma serialização JSON usada pelo WebSocket real (SDP/ICE têm toJSON).
        const messages = await run(windows[i], 'JSON.parse(JSON.stringify(messages.splice(0)))');
        for (const m of messages) {
          if (m.type === 'voice-state') {
            for (const w of windows) await run(w, `voice.update('${i + 1}', ${JSON.stringify(m.session)}, ${!!m.muted})`);
          } else if (m.type === 'signal') {
            await run(windows[Number(m.to) - 1], `voice.receive('${i + 1}', ${JSON.stringify(m.data)})`);
          }
        }
      }
    }
    let reports;
    for (let tries = 0; tries < 100; tries++) {
      await pump();
      reports = await Promise.all(windows.map(w => run(w, `(async () => {
        const p = [...voice.peers.values()][0];
        if (!p) return {};
        const stats = [...(await p.pc.getStats()).values()];
        const inbound = stats.find(s => s.type === 'inbound-rtp' && s.kind === 'audio');
        return { connected: p.pc.connectionState === 'connected', bytes: inbound?.bytesReceived || 0,
          energy: inbound?.totalAudioEnergy || 0, errors, status: p.status,
          signaling: p.pc.signalingState, ice: p.pc.iceConnectionState,
          local: p.pc.localDescription?.type, remote: p.pc.remoteDescription?.type,
          candidates: stats.filter(s => s.type === 'local-candidate').map(s => s.address) };
      })()`)));
      if (reports.every(r => r.connected && r.bytes > 0 && r.energy > 0)) break;
      await sleep(100);
    }
    assert.ok(reports.every(r => r.connected && r.bytes > 0 && r.energy > 0), JSON.stringify(reports));
    assert.ok(reports.every(r => r.errors.length === 0));
    console.log('PASS: áudio WebRTC bidirecional com energia e bytes recebidos:', JSON.stringify(reports));
    const controls = await run(windows[0], `(() => {
      voice.mute(); voice.deafen();
      return { enabled: voice.stream.getAudioTracks()[0].enabled, muted: [...voice.peers.values()][0].audio.muted };
    })()`);
    assert.deepEqual(controls, { enabled: false, muted: true });
    await run(windows[0], 'voice.leave()');
    await pump();
    assert.equal(await run(windows[1], 'voice.peers.size'), 0);
    assert.equal(await run(windows[0], 'destination.stream.getTracks()[0].readyState'), 'ended');
    console.log('PASS: mute, saída e liberação do microfone/conexões');
    // Carrega a interface real e o preload real; serviços nativos ficam simulados.
    for (const [channel, value] of Object.entries({
      'get-ips': [], 'get-version': '1.8.3', 'github-check': { ok: false },
      'set-priority': true, 'stats-start': true, 'stats-stop': true,
      'stop-app-audio': true, 'stop-server': true,
    })) ipcMain.handle(channel, () => value);
    const ui = new BrowserWindow({ show: false, width: 1200, height: 780,
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), backgroundThrottling: false } });
    windows.push(ui);
    const uiErrors = [];
    ui.webContents.on('console-message', (_event, level, message) => { if (level === 3) uiErrors.push(message); });
    await ui.loadFile(path.join(__dirname, '..', 'index.html'));
    await run(ui, `
      $('name').value = 'Teste local';
      enterRoom({ id: '1', features: ['chat', 'voice'], members: [], chat: [] }, false, '127.0.0.1', 8765);
      window.testContext = new AudioContext();
      window.testDestination = testContext.createMediaStreamDestination();
      voice.media = { getUserMedia: async () => testDestination.stream };
      voice.join();
    `);
    const result = await run(ui, `(() => {
      $('voiceMute').click(); $('voiceDeafen').click();
      return { joined: $('voiceJoin').getAttribute('aria-label'), mic: $('voiceMute').getAttribute('aria-pressed'),
        sound: $('voiceDeafen').getAttribute('aria-pressed'), visible: !$('room').hidden };
    })()`);
    assert.deepEqual(result, { joined: 'Sair da voz', mic: 'true', sound: 'true', visible: true });
    await sleep(100);
    const screenshot = await ui.webContents.capturePage();
    fs.writeFileSync(path.join(app.getPath('userData'), 'voice-preview.png'), screenshot.toPNG());
    await run(ui, 'leaveRoom()');
    assert.equal(await run(ui, 'testDestination.stream.getTracks()[0].readyState'), 'ended');
    assert.deepEqual(uiErrors, []);
    console.log('PASS: interface real, controles e saída da sala; captura em .test-profile/voice-preview.png');
    clearTimeout(deadline);
    app.exit(0);
  } catch (err) {
    console.error(err);
    clearTimeout(deadline);
    app.exit(1);
  }
});
