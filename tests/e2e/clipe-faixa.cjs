// Clipe no modo "uma por pessoa", dentro do app (janela invisível): uma faixa de vídeo (canvas) e uma de som
// (oscilador) ao vivo passam pelos gravadores do renderer/clipes.js (placa de vídeo, ou processador em até 720p, e
// AAC/Opus) e viram um MP4 que abre num <video>, com som. A faixa é 1080p: pelo processador, o clipe sai em 720p. Uns 15 s.
// Roda com: npx electron tests/e2e/clipe-faixa.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('node:os');
const path = require('node:path');
const APP = path.resolve(__dirname, '..', '..');
app.setPath('userData', path.join(os.tmpdir(), 'tela-p2p-e2e', 'perfil-clipe-faixa'));
console.log('\n== Clipe de uma faixa ao vivo (janela invisível)');
let ok = 0, bad = 0;
const check = (n, c, x = '') => { c ? ok++ : bad++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${x !== '' ? '  (' + x + ')' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('TEMPO ESGOTADO'); app.exit(1); }, 60000);

app.whenReady().then(async () => {
  for (const [channel, value] of Object.entries({
    'get-ips': [], 'razze-pending-invite': '', 'razze-presence-state': { friends: [], networks: [], rooms: [], error: '' }, 'razze-state': {}, 'get-version': '1.9.2',
    'github-check': { ok: false }, 'set-priority': true, 'stats-start': true, 'stats-stop': true, 'stop-app-audio': true, 'stop-server': true, 'room-keys': true,
    'sessoes-observar': true, 'capture-exclude': true, 'ptt': true, 'get-shortcuts': {},
  })) ipcMain.handle(channel, () => value);
  const win = new BrowserWindow({ show: false, width: 1200, height: 780, webPreferences: { preload: path.join(APP, 'preload.js'), backgroundThrottling: false } });
  const run = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.join(APP, 'index.html'));
    await sleep(800);
    const pick = await run(`clipEncoderConfig(1920, 1080).then((p) => p && { w: p.config.width, h: p.config.height, hw: p.config.hardwareAcceleration })`);
    console.log('      codificador:', JSON.stringify(pick));
    if (!pick) { console.log('AVISO Este PC não codifica H.264: o modo "uma por pessoa" fica sem clipe.'); app.exit(0); return; }
    await run(`(() => {
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
      const g = c.getContext('2d'); let n = 0;
      window.__clipTimer = setInterval(() => { n++; g.fillStyle = 'hsl(' + (n * 7 % 360) + ',70%,50%)'; g.fillRect(0, 0, 1920, 1080); }, 33);
      const ctx = new AudioContext(); const osc = ctx.createOscillator(); const dest = ctx.createMediaStreamDestination();
      osc.connect(dest); osc.start();
      window.__clipTarget = {};
      startClipVideo(window.__clipTarget, c.captureStream(30).getVideoTracks()[0]);
      startClipAudio(window.__clipTarget, dest.stream.getAudioTracks()[0]);
    })()`);
    await sleep(7000);
    const r = await run(`(async () => {
      const t = window.__clipTarget;
      const dur = t.clip ? t.clip.duration() : 0;
      const { bytes, seconds, audio } = ClipMp4.buildMp4(t.clip.take(5), t.clipDims, Mp4Muxer, t.clipAudio);
      stopClipVideo(t); stopClipAudio(t); clearInterval(window.__clipTimer);
      const v = document.createElement('video'); v.muted = true;
      v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('o <video> não abriu')); });
      await v.play(); await new Promise((res) => setTimeout(res, 1000)); v.pause();
      return { dur, seconds, audio, codec: t.clipAudio?.config?.codec, w: v.videoWidth, h: v.videoHeight, duration: v.duration, audioBytes: v.webkitAudioDecodedByteCount || 0, dims: t.clipDims };
    })()`);
    console.log('     ', JSON.stringify(r));
    check('Gravou uns segundos da faixa', r.dur >= 4, r.dur.toFixed(1) + ' s');
    check('Clipe de ~5 s (começa no quadro-chave de até 2 s antes)', r.duration >= 4.5 && r.duration <= 7.5, r.duration.toFixed(2));
    check('Abre no tamanho do codificador (1080p na placa, 720p no processador)', r.w === pick.w && r.h === pick.h, `${r.w}x${r.h}`);
    check('Com som, e o som toca', r.audio && r.audioBytes > 0, `${r.codec}, ${r.audioBytes} bytes`);
  } catch (e) {
    check('Sem exceção', false, e.message);
  }
  console.log(`${ok} ok, ${bad} falhas`);
  app.exit(bad ? 1 : 0);
});
