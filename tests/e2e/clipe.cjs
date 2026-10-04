// Clipe com vídeo de verdade: o WebCodecs codifica 40 s de quadros em H.264 (Annex B, como o modo "uma vez só"),
// o ClipBuffer guarda, o buildMp4 monta o MP4 e um <video> abre o arquivo. Cada segundo tem uma cor; no fim do clipe
// tem que estar a cor do último segundo. Janela invisível, uns 10 s.
// Roda com: npx electron tests/e2e/clipe.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const APP = path.resolve(__dirname, '..', '..');
app.setPath('userData', path.join(os.tmpdir(), 'tela-p2p-e2e', 'perfil-clipe'));
console.log('\n== Clipe (janela invisível)');
let ok = 0, bad = 0;
const check = (n, c, x = '') => { c ? ok++ : bad++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${x !== '' ? '  (' + x + ')' : ''}`); };
setTimeout(() => { console.log('TEMPO ESGOTADO'); app.exit(1); }, 90000);

const PAGE = `(async () => {
  const W = 640, H = 360, FPS = 30, SECONDS = 40;
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext('2d');
  const buffer = new ClipMp4.ClipBuffer({ seconds: 31 });
  const pending = [];
  const enc = new VideoEncoder({
    output: (chunk) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); pending.push({ key: chunk.type === 'key', ts: chunk.timestamp, data }); },
    error: (e) => { throw e; },
  });
  enc.configure({ codec: 'avc1.42001f', width: W, height: H, bitrate: 1_500_000, framerate: FPS, avc: { format: 'annexb' }, latencyMode: 'realtime' });
  for (let i = 0; i < SECONDS * FPS; i++) {
    const s = Math.floor(i / FPS);
    g.fillStyle = 'rgb(' + (s * 6) + ', 40, ' + (250 - s * 6) + ')';
    g.fillRect(0, 0, W, H);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS) });
    enc.encode(frame, { keyFrame: i % (8 * FPS) === 0 }); // como o NVENC com o pedido a cada 8 s
    frame.close();
    if (i % 30 === 0) await enc.flush();
    for (const f of pending.splice(0)) buffer.push(f);
  }
  await enc.flush();
  for (const f of pending.splice(0)) buffer.push(f);
  const { bytes, seconds } = ClipMp4.buildMp4(buffer.take(30), { width: W, height: H }, Mp4Muxer);
  const video = document.createElement('video');
  video.muted = true;
  video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = () => rej(new Error('o <video> não abriu o MP4: ' + (video.error && video.error.message))); });
  const duration = video.duration;
  const colorAt = async (t) => {
    video.currentTime = t;
    await new Promise((res) => { video.onseeked = res; });
    const c = new OffscreenCanvas(W, H).getContext('2d');
    c.drawImage(video, 0, 0);
    return Math.round(c.getImageData(W / 2, H / 2, 1, 1).data[0] / 6);
  };
  return { size: bytes.length, seconds, duration, width: video.videoWidth, height: video.videoHeight, firstSecond: await colorAt(0), lastSecond: await colorAt(duration - 0.1) };
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    // Página de arquivo (contexto seguro: o WebCodecs não existe numa página data:)
    const page = path.join(app.getPath('userData'), 'clipe.html');
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, '<meta charset=utf-8><body>');
    await win.loadFile(page);
    for (const f of ['vendor/mp4-muxer/mp4-muxer.js', 'renderer/clipe-mp4.js']) await win.webContents.executeJavaScript(fs.readFileSync(path.join(APP, f), 'utf8'));
    const r = await win.webContents.executeJavaScript(PAGE);
    console.log('     ', JSON.stringify(r));
    check('O <video> abre o MP4 no tamanho certo', r.width === 640 && r.height === 360);
    check('Duração: 30 s mais o caminho até o quadro-chave anterior (até 8 s)', r.duration >= 29.5 && r.duration <= 38.5, r.duration.toFixed(2));
    check('Começa num quadro-chave (segundo 8, múltiplo de 8)', r.firstSecond === 8, r.firstSecond);
    check('Termina no último segundo gravado (39)', r.lastSecond === 39, r.lastSecond);
  } catch (e) {
    check('Sem exceção', false, e.message);
  }
  console.log(`${ok} ok, ${bad} falhas`);
  app.exit(bad ? 1 : 0);
});
