// Música junto: Ana põe um vídeo do YouTube na Subsala_1, Bia ouve junto no mesmo ponto; pausar, pular e trocar
// valem para as duas; quem sai do canal não controla; parar fecha a tela das duas. Precisa de internet (YouTube).
// O volume fica em 0 (mudo) nas duas: o teste não toca som alto no seu PC.
const { openApp, createRoom, joinRoom, share, check, sleep, run, attach, FAKE } = require('./ajuda');
// A janela do teste fica atrás da outra: sem isto, a animação de abrir o painel congela no começo e o clique erra o botão
FAKE.push('--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion');

const VID = 'dQw4w9WgXcQ', VID2 = 'M7lc1UVf-VE';
const TONE = `(() => { window.tctx = new AudioContext(); const o = tctx.createOscillator(); const dst = tctx.createMediaStreamDestination(); o.connect(dst); o.start(); voice.media = { getUserMedia: async () => dst.stream }; })()`;
const centerOf = (app, sel) => app.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const mouse = (app, type, [x, y]) => app.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
async function clickAt(app, p) { await mouse(app, 'mouseMoved', p); await sleep(60); await mouse(app, 'mousePressed', p); await mouse(app, 'mouseReleased', p); await sleep(250); }
const MU = (ch) => `state.in.get('musica:${ch}')?.music`;
const posOf = (app, ch) => app.eval(`(() => { const m = ${MU(ch)}; return m && m.ready ? m.time + (m.state === 1 ? (performance.now() - m.timeAt) / 1000 : 0) : null; })()`);

run('Música junto (YouTube)', 180000, async () => {
  const A = await openApp('musA', 9561, { fake: true });
  await createRoom(A, { name: 'Ana', port: 18861 });
  const B = await openApp('musB', 9562, { fake: true });
  await joinRoom(B, { name: 'Bia', addr: '127.0.0.1:18861' });
  for (const X of [A, B]) {
    await X.eval(`setVoiceView('lista'); musica.volume = 0; setPainelSala({ aba: 'voz', juntos: false, recolhido: false })`);
    await X.eval(TONE);
    await X.eval(`$('voiceJoin').click()`);
  }
  check('O servidor da sala sabe guardar música', await A.eval('state.musicaOn') && await B.eval('state.musicaOn'));
  await A.eval(`createSubsala()`);
  await A.waitFor(`state.subsalas?.length === 1`, 5000);
  await A.waitFor(`voice.session`, 15000);
  await B.waitFor(`voice.session`, 15000);
  await A.eval(`voice.setChannel('1')`);
  await B.eval(`voice.setChannel('1')`);
  await A.waitFor(`voice.channel === '1' && voice.members.get('${await B.eval('state.myId')}')?.channel === '1'`, 8000);
  await sleep(300);

  // Ana põe a música: o botão fica no cabeçalho do canal dela
  check('"Pôr música" só no canal em que você está', await A.eval(`!!document.querySelector('.voice-channel[data-channel="1"] .voice-channel-music') && !document.querySelector('.voice-channel[data-channel=""] .voice-channel-music')`));
  await clickAt(A, await centerOf(A, '.voice-channel[data-channel="1"] .voice-channel-music'));
  check('Abre o balão de colar o link', await A.eval(`!$('musicPop').hidden && document.activeElement === $('musicUrl')`));
  await A.eval(`$('musicUrl').value = 'isso não é link'; $('musicPopGo').click()`);
  check('Link que não é do YouTube: avisa e não manda', await A.eval(`$('musicPopError').textContent.includes('Não reconheci') && state.musicas.size === 0`));
  await A.eval(`$('musicUrl').value = 'https://www.youtube.com/watch?v=${VID}&t=10s'; $('musicPopGo').click()`);
  await A.waitFor(`state.musicas.get('1')?.videoId === '${VID}' && state.in.has('musica:1')`, 5000);
  check('A música entra na Subsala_1 e a tela dela abre para quem pôs', true);
  await A.waitFor(`${MU('1')}?.ready && ${MU('1')}.state === 1`, 30000);
  check('O player do YouTube toca dentro do app (sem erro de player)', await A.eval(`!${MU('1')}.error`));
  // Legendas: desligadas por padrão (o YouTube liga sozinho, até traduzida); o CC da faixa de cima liga e desliga
  // (só para quem clicou) e fica salvo. Confere dentro do player, pelo DevTools do iframe do YouTube
  const Y = await attach(9561, (t) => t.type === 'iframe' && t.url.includes('youtube'));
  const track = () => Y.eval(`(() => { try { return JSON.stringify(document.querySelector('#movie_player').getOption('captions', 'track') || {}); } catch { return '?'; } })()`);
  const ccBtn = `state.in.get('musica:1').tile.el.querySelector('.tile-bar [aria-pressed]:not(.tile-mute)')`;
  await sleep(5000);
  check('Legendas: começam desligadas (nenhuma faixa no player)', await A.eval(`musica.legenda === false && ${ccBtn}?.getAttribute('aria-pressed') === 'false'`) && await track() === '{}', await track());
  await A.eval(`${ccBtn}.click()`);
  await A.waitFor(`${MU('1')}?.ready && ${MU('1')}.state === 1`, 30000);
  await sleep(3000);
  check('Legendas: o CC liga (o player tem faixa) e fica salvo', await A.eval(`musica.legenda === true && ${ccBtn}.getAttribute('aria-pressed') === 'true' && localStorage.getItem('musicaLegenda') === '1'`) && (await track()).includes('languageCode'), await track());
  await A.eval(`${ccBtn}.click()`);
  await sleep(3000);
  // Luz ambiente: o player fica 16:9 e as barras pegam as cores dele (o processo principal tira a foto de 32 x 18).
  // Só com o app em foco: aqui o foco é fingido pelo DevTools, e depois tirado
  await A.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const AMB = `state.in.get('musica:1').tile.el.querySelector('.tile-ambient')`;
  await A.waitFor(`!${AMB}.hidden`, 8000).catch(() => {});
  const cor = await A.eval(`(() => { const d = ${AMB}.getContext('2d').getImageData(0, 0, 32, 18).data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i] + d[i + 1] + d[i + 2]); return m; })()`);
  check('Luz ambiente: aparece com as cores do vídeo', await A.eval(`!${AMB}.hidden`) && cor > 60, `brilho máximo ${cor}`);
  await A.eval(`appPreferences.appearance = { ...appPreferences.appearance, ambient: false }`);
  await sleep(800);
  check('Luz ambiente: com a opção desligada, some', await A.eval(`${AMB}.hidden`));
  await A.eval(`appPreferences.appearance = { ...appPreferences.appearance, ambient: true }`);
  await A.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  check('Legendas: desliga de novo e a música segue tocando', await A.eval(`musica.legenda === false && !${MU('1')}.error && ${MU('1')}.state === 1`) && await track() === '{}', await track());
  await A.waitFor(`${MU('1')}.volume === 0 && ${MU('1')}.muted === false`, 8000);
  check('O volume local chega ao player (0: silêncio, sem o mudo do player)', true);
  check('A tela da música fica no palco, como uma transmissão', await A.eval(`$('tiles').contains(state.in.get('musica:1').tile.el) && !$('tiles').hidden && !!state.in.get('musica:1').tile.el.querySelector('iframe.music-frame')`));
  await A.waitFor(`state.musicas.get('1')?.title`, 15000);
  check('O título do vídeo vem do player e vai para a sala', (await A.eval(`state.musicas.get('1').title`)).includes('Never Gonna'));

  // Bia vê a música no painel de voz e ouve junto
  await B.waitFor(`!!document.querySelector('.voice-channel[data-channel="1"] .voice-channel-song')`, 5000);
  check('Bia vê a música da Subsala_1 no cabeçalho do canal, para ouvir', await B.eval(`document.querySelector('.voice-channel-song').textContent.includes('Never Gonna') && document.querySelector('.voice-channel-song').getAttribute('aria-pressed') === 'false'`));
  check('Com a música lá, o "Pôr música" some do canal (uma por subsala)', await B.eval(`!document.querySelector('.voice-channel[data-channel="1"] .voice-channel-music')`));
  await B.eval(`document.querySelector('.voice-channel-song').click()`);
  await B.waitFor(`${MU('1')}?.ready && ${MU('1')}.state === 1`, 30000);
  await sleep(2500);
  const [pa, pb] = [await posOf(A, '1'), await posOf(B, '1')];
  check('Bia ouve no mesmo ponto que a Ana (menos de 2 s de diferença)', Math.abs(pa - pb) < 2, `${pa?.toFixed(1)} × ${pb?.toFixed(1)}`);

  // Pausar e pular valem para as duas
  await A.eval(`state.in.get('musica:1').tile.el.querySelector('.music-controls .btn.icon').click()`);
  await B.waitFor(`${MU('1')}.state === 2`, 8000);
  check('Ana pausa: pausa para a Bia também', await B.eval(`state.musicas.get('1').playing === false`));
  await A.eval(`(() => { const s = state.in.get('musica:1').tile.el.querySelector('.music-seek'); s.value = '60'; s.dispatchEvent(new Event('change')); })()`);
  await B.waitFor(`Math.abs(${MU('1')}.time - 60) < 2`, 8000);
  check('Ana pula para 1:00: a Bia vai junto (pausada)', await B.eval(`${MU('1')}.state !== 1`));
  await B.eval(`state.in.get('musica:1').tile.el.querySelector('.music-controls .btn.icon').click()`);
  await A.waitFor(`${MU('1')}.state === 1`, 8000);
  check('Bia (no mesmo canal) toca de novo: toca para a Ana', true);

  // Quem sai do canal não controla
  await B.eval(`voice.setChannel('')`);
  await B.waitFor(`voice.channel === ''`, 5000);
  await sleep(300);
  check('Fora da Subsala_1, os controles da Bia ficam desligados (ela continua ouvindo)', await B.eval(`state.in.has('musica:1') && state.in.get('musica:1').tile.el.querySelector('.music-seek').disabled`));
  await B.eval(`send({ type: 'musica-ctl', ch: '1', action: 'pause', pos: 5 })`);
  await B.waitFor(`document.querySelector('#toast').textContent.includes('Só quem está em Subsala_1')`, 5000);
  check('E o servidor recusa se ela tentar', await A.eval(`state.musicas.get('1').playing`));

  // Trocar: as duas vão para o vídeo novo
  await A.eval(`musicCtl(state.musicas.get('1'), 'trocar', { videoId: '${VID2}' })`);
  await A.waitFor(`${MU('1')}.videoId === '${VID2}' && ${MU('1')}.ready`, 20000);
  await B.waitFor(`${MU('1')}.videoId === '${VID2}' && ${MU('1')}.ready`, 20000);
  check('Trocar a música troca nas duas', true);
  // Junto com as transmissões: Bia transmite a tela, Ana assiste; a música e a tela dividem o palco
  await share(B);
  const biaId = await B.eval('state.myId');
  await A.waitFor(`state.members.get('${biaId}')?.sharing`, 10000);
  await A.eval(`watch('${biaId}')`);
  await A.waitFor(`state.in.get('${biaId}')?.tile.video.videoWidth > 0`, 20000);
  await sleep(500);
  const stage = await A.eval(`(() => { const r = (id) => state.in.get(id).tile.el.getBoundingClientRect(); const a = r('musica:1'), b = r('${biaId}'); return { n: state.in.size, a: [a.left, a.top, a.width, a.height], b: [b.left, b.top, b.width, b.height], separadas: a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1 }; })()`);
  check('A música e a tela da Bia ficam lado a lado no palco', stage.n === 2 && stage.separadas && stage.a[2] > 200 && stage.b[2] > 200, JSON.stringify(stage));
  check('E a música segue tocando', await A.eval(`${MU('1')}.state === 1`));
  // Foto: minimiza a janela da Bia (com as duas abertas, a captura da tela trava)
  try { const { windowId } = await B.send('Browser.getWindowForTarget'); await B.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }); } catch (err) { console.log('     (não deu para minimizar a Bia: ' + err.message + ')'); }
  await A.send('Page.bringToFront');
  await sleep(800);
  await A.shot('musica.png');

  // Parar: a tela fecha nas duas e o "Pôr música" volta
  await A.eval(`musicCtl(state.musicas.get('1'), 'stop')`);
  await A.waitFor(`!state.in.has('musica:1') && state.musicas.size === 0`, 5000);
  await B.waitFor(`!state.in.has('musica:1')`, 5000);
  check('Parar a música fecha a tela nas duas', await A.eval(`!!document.querySelector('.voice-channel[data-channel="1"] .voice-channel-music')`));
});
