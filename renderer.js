'use strict';

// ---------- Atualizações pela sala ----------
// true se a versão a for mais nova que b ("1.2.10" > "1.2.9")
function newerVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// Procura na sala alguém com versão mais nova que a minha (e que a já baixada) e pede o pacote
function checkUpdates() {
  if (update.busy || !state.ws || !update.myVersion) return;
  const base = update.ready || update.myVersion;
  let best = null;
  for (const [id, m] of state.members) {
    if (!m.version || !newerVersion(m.version, base) || update.tried.has(`${id}@${m.version}`)) continue;
    if (!best || newerVersion(m.version, best.version)) best = { id, version: m.version };
  }
  if (!best) return;
  update.tried.add(`${best.id}@${best.version}`);
  update.busy = { from: best.id, version: best.version, parts: [], total: 0, sig: '', timer: setTimeout(cancelDownload, 60000) };
  sendSignal(best.id, { side: 'update', want: best.version });
}

function cancelDownload() {
  if (!update.busy) return;
  clearTimeout(update.busy.timer);
  update.busy = null;
  checkUpdates(); // tenta outra pessoa, se houver
}

async function sendUpdate(to, want) {
  const pack = want === update.myVersion && !update.sending.has(to) ? await window.api.getOwnPack() : null;
  if (!pack) return sendSignal(to, { side: 'update', unavailable: true });
  update.sending.add(to);
  const CHUNK = 48 * 1024;
  const total = Math.ceil(pack.pack.length / CHUNK);
  for (let part = 0; part < total && state.members.has(to); part++) {
    const msg = { side: 'update', version: want, part, total, data: pack.pack.slice(part * CHUNK, (part + 1) * CHUNK) };
    if (part === 0) msg.sig = pack.sig;
    sendSignal(to, msg);
    await waitRoomBuffer();
  }
  update.sending.delete(to);
}

async function onUpdateSignal(from, data) {
  if (data.want) return sendUpdate(from, String(data.want));
  const b = update.busy;
  if (!b || b.from !== from) return;
  if (data.unavailable) return cancelDownload();
  if (data.version !== b.version || !Number.isInteger(data.part) || !Number.isInteger(data.total)
      || data.total < 1 || data.total > 300 || data.part >= data.total || typeof data.data !== 'string') return;
  if (data.sig) b.sig = data.sig;
  b.total = data.total;
  b.parts[data.part] = data.data;
  if (b.parts.filter((p) => p !== undefined).length < b.total) return;

  clearTimeout(b.timer);
  update.busy = null;
  // O processo principal confere a assinatura antes de guardar qualquer coisa
  const res = await window.api.installUpdate(b.parts.join(''), b.sig);
  if (res.ok) {
    update.ready = res.version;
    renderUpdateBanner();
  } else {
    console.warn(`Atualização de ${nameOf(from)} recusada:`, res.error);
  }
  checkUpdates();
}

// ---------- Atualizações pelo GitHub ----------
// Procura a última versão publicada; se for mais nova, mostra o botão na tela inicial
async function checkGithub(manual = false) {
  const link = $('checkUpdates');
  link.disabled = true;
  link.textContent = 'Procurando…';
  const res = await window.api.githubCheck();
  link.disabled = false;
  link.textContent = 'Procurar atualização';
  if (!res.ok) {
    if (manual) toast(`Não deu para ver o GitHub: ${res.error}`, 'error');
    return;
  }
  const rel = res.release;
  if (!rel || !newerVersion(rel.version, update.ready || update.myVersion)) {
    update.github = null;
    renderUpdateBanner();
    if (manual) toast(update.ready ? `A versão ${update.ready} já está baixada. Reinicie para usar.` : 'Você já está na versão mais nova.');
    return;
  }
  if (update.github?.version !== rel.version) update.exePage = '';
  update.github = rel;
  if (manual) update.dismissed = '';
  renderUpdateBanner();
}

// ---------- Aviso de atualização ----------
// Um cartão no canto da tela, em qualquer tela do app. Um botão faz tudo: baixa do GitHub (se ainda
// não veio pela sala) e reinicia o app já na versão nova. "Depois" esconde até a próxima versão.
function updateMode() {
  if (update.ready) return { mode: 'ready', version: update.ready };
  if (update.github) return { mode: update.exePage ? 'exe' : 'github', version: update.github.version };
  return null;
}

function renderUpdateBanner() {
  const m = updateMode();
  const banner = $('updateBanner');
  if (!m || update.dismissed === m.version || update.installing) {
    banner.hidden = !update.installing;
    return;
  }
  const inRoom = !!state.myId;
  const leaves = inRoom ? ' Você sai da sala e o app abre de novo sozinho.' : ' O app fecha e abre de novo sozinho.';
  $('ubTitle').textContent = m.mode === 'ready' ? `Versão ${m.version} pronta` : `Versão ${m.version} disponível`;
  $('ubText').textContent = m.mode === 'ready' ? `Já está baixada.${leaves}`
    : m.mode === 'github' ? `Baixa em poucos segundos e atualiza.${leaves}`
    : 'Esta versão precisa do .exe novo. Baixe na página do GitHub e abra no lugar do antigo.';
  $('ubGo').textContent = m.mode === 'exe' ? 'Abrir no GitHub' : 'Atualizar agora';
  $('ubGo').disabled = false;
  $('ubLater').hidden = false;
  banner.hidden = false;
}

async function runUpdate() {
  const m = updateMode();
  if (!m) return;
  if (m.mode === 'exe') return window.api.openGithub(update.exePage);
  const go = $('ubGo');
  update.installing = true;
  $('ubLater').hidden = true;
  if (m.mode === 'github') {
    setBusy(go, true, 'Baixando…');
    $('ubText').textContent = 'Baixando a versão nova do GitHub…';
    const res = await window.api.githubInstall();
    if (!res.ok) {
      update.installing = false;
      if (res.page && /exe novo|pacote de atualização/.test(res.error)) {
        // Mudou algo que só um .exe novo traz (ex.: versão do Electron): manda para a página da versão
        update.exePage = res.page;
      } else {
        toast(`Não deu para atualizar: ${res.error}`, 'error');
      }
      return renderUpdateBanner();
    }
    update.ready = res.version;
  }
  setBusy(go, true, 'Reiniciando…');
  $('ubText').textContent = 'Abrindo a versão nova…';
  window.api.restartApp();
}

// ---------- Transmitir ----------
function openShareDialog(switching = false) {
  state.shareSwitching = switching && state.sharing;
  $('shareDialog').hidden = false;
  $('shareDialog').classList.toggle('switching', state.shareSwitching);
  $('shareTitle').textContent = state.shareSwitching ? 'Trocar o que transmitir' : 'Transmitir';
  $('shareSubtitle').textContent = state.shareSwitching
    ? 'A transmissão continua: quem assiste passa a ver o que você escolher'
    : 'Escolha o que os outros vão ver';
  if (state.shareSwitching) state.selectedSource = state.sharingSource;
  loadSources();
  syncAudioMode();
  checkEncodeOnce();
  renderShareSummary();
}

const QUALITY_SPEC = { '720p30': '720p 30 fps', '720p60': '720p 60 fps', '1080p30': '1080p 30 fps', '1080p60': '1080p 60 fps' };
function radioValue(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value || ''; }
function setRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el && !el.disabled) el.checked = true;
}
// "Discord", "Discord e Spotify", "Discord, Spotify e Chrome"
function joinNames(list) { return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`; }
// Com um monitor só, o Chromium chama a tela de "Tela cheia" / "Entire screen": fica só "Tela inteira"
function sourceLabel(s) {
  if (!s.id.startsWith('screen')) return s.name;
  return /^(tela cheia|tela inteira|entire screen)$/i.test(s.name.trim()) ? 'Tela inteira' : `Tela inteira: ${s.name}`;
}

// A opção "uma vez só" só fica disponível se o PC codifica H.264 pelo NVENC ou pelo WebCodecs
let encodeOnceSupport = null;
async function checkEncodeOnce() {
  if (encodeOnceSupport === null) encodeOnceSupport = await onceSupport();
  const once = document.querySelector('input[name="encodeMode"][value="once"]');
  once.disabled = !encodeOnceSupport;
  $('encodeOnceLabel').textContent = encodeOnceSupport?.engine === 'nvenc' ? 'Uma vez só (NVENC direto)' : 'Uma vez só';
  if (!encodeOnceSupport) { once.checked = false; setRadio('encodeMode', 'per'); }
  syncEncodeNote();
  renderShareSummary();
}

function syncEncodeNote() {
  const note = $('encodeNote');
  if (encodeOnceSupport === null) return;
  note.hidden = false;
  note.textContent = !encodeOnceSupport
    ? 'Este PC não consegue codificar uma vez só para todos, então cada pessoa recebe a própria codificação.'
    : radioValue('encodeMode') === 'once'
      ? `Codifica o vídeo uma vez só${encodeOnceSupport.engine === 'nvenc' ? ', direto no NVENC da placa NVIDIA (a imagem nem passa pelo processador)' : encodeOnceSupport.hardware ? ', pela placa de vídeo' : ', pelo processador'}, e manda o mesmo para todos: o peso não aumenta quando mais gente assiste. Quem tem versão antiga do app recebe no modo normal.`
      : 'O processador codifica o vídeo uma vez para cada pessoa que assiste. Com vários amigos assistindo, experimente "Uma vez só".';
}

function encodeText() {
  if (radioValue('encodeMode') !== 'once' || !encodeOnceSupport) return 'uma codificação por pessoa';
  return encodeOnceSupport.engine === 'nvenc' ? 'NVENC direto' : encodeOnceSupport.hardware ? 'uma vez só pela placa' : 'uma vez só pelo processador';
}

function soundText() {
  if (!$('soundOn').checked) return 'sem som';
  const names = appsLoaded()
    ? [...$('excludeApps').querySelectorAll('input:checked')].map((i) => i.parentElement.textContent.trim())
    : savedExcludes().map((exe) => exe.replace(/\.exe$/i, ''));
  return names.length ? `som sem ${joinNames(names)}` : 'todo o som do PC';
}

// Rodapé: o que vai acontecer ao clicar em Iniciar; e o resumo do Avançado quando está fechado
function renderShareSummary() {
  const src = state.sources.find((s) => s.id === state.selectedSource);
  const same = state.shareSwitching && state.selectedSource === state.sharingSource;
  $('shareSummary').classList.toggle('ready', !!src && !same);
  $('shareSummaryText').textContent = state.shareSwitching
    ? (!src ? 'Escolha a tela ou janela nova'
      : same ? `${sourceLabel(src)} · é o que você já está transmitindo`
      : `${sourceLabel(src)} · a qualidade e o som continuam os mesmos`)
    : src
      ? [sourceLabel(src), QUALITY_SPEC[radioValue('quality')], encodeText(), soundText()].join(' · ')
      : 'Escolha uma tela ou janela para começar';
  $('shareSummary').title = $('shareSummaryText').textContent; // texto inteiro, se não couber
  $('startBtn').disabled = !src || same;
  if (!$('startBtn').dataset.busy) $('startBtn').textContent = state.shareSwitching ? 'Trocar para esta' : 'Iniciar transmissão';
  const open = $('advToggle').getAttribute('aria-expanded') === 'true';
  const prio = document.querySelector('input[name="priority"]:checked')?.nextElementSibling?.textContent || '';
  $('advSummary').textContent = open ? '' : `${encodeText()} · prioridade ${prio.toLowerCase()}`;
}

function setAdvanced(open) {
  $('advToggle').setAttribute('aria-expanded', String(open));
  $('advPanel').hidden = !open;
  renderShareSummary();
}

function closeShareDialog() {
  $('shareDialog').hidden = true;
  if (state.shareSwitching) state.selectedSource = state.sharingSource; // cancelou: a escolha volta a ser a de agora
  state.shareSwitching = false;
  $('shareDialog').classList.remove('switching');
}

async function loadSources() {
  $('sources').innerHTML = '<p class="hint">Carregando telas e janelas…</p>';
  let sources = [];
  try { sources = await window.api.getSources(); } catch (e) { console.error(e); }
  state.sources = sources;
  const sel = sources.find((s) => s.id === state.selectedSource);
  if (!sel) state.selectedSource = null;
  else state.sourceTab = sel.id.startsWith('screen') ? 'screens' : 'windows';
  renderSources();
}

function selectSource(id) {
  state.selectedSource = id;
  for (const el of $('shareDialog').querySelectorAll('[data-source]')) {
    const on = el.dataset.source === id;
    el.classList.toggle('selected', on);
    el.setAttribute('aria-pressed', String(on));
  }
  renderShareSummary();
}

// Abas Telas | Janelas. Janelas que saem pretas (administrador, protegidas ou minimizadas) ficam à parte.
function renderSources() {
  const grid = $('sources');
  const screens = state.sources.filter((s) => s.id.startsWith('screen'));
  const windows = state.sources.filter((s) => !s.id.startsWith('screen') && !s.dark);
  const blocked = state.sources.filter((s) => !s.id.startsWith('screen') && s.dark);
  $('countScreens').textContent = screens.length || '';
  $('countWindows').textContent = windows.length || '';
  $('tabScreens').setAttribute('aria-selected', String(state.sourceTab === 'screens'));
  $('tabWindows').setAttribute('aria-selected', String(state.sourceTab === 'windows'));
  const shown = state.sourceTab === 'screens' ? screens : windows;

  grid.innerHTML = '';
  if (!shown.length) {
    grid.innerHTML = state.sources.length
      ? '<p class="hint">Nenhuma janela aberta agora.</p>'
      : '<p class="hint">Nenhuma tela encontrada. Clique em atualizar.</p>';
  }
  for (const s of shown) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'source';
    btn.dataset.source = s.id;
    const img = document.createElement('img');
    img.src = s.thumbnail;
    img.alt = '';
    const label = document.createElement('span');
    label.textContent = sourceLabel(s);
    btn.append(img, label);
    btn.onclick = () => selectSource(s.id);
    btn.ondblclick = () => startSharing();
    grid.append(btn);
  }

  const note = $('blockedNote');
  note.hidden = state.sourceTab !== 'windows' || !blocked.length;
  if (!note.hidden) {
    $('blockedTitle').textContent = `Aparecem pretas (${blocked.length})`;
    $('blockedText').textContent = `${joinNames(blocked.map((s) => s.name))}: janela de administrador, protegida ou minimizada. Se estiver minimizada, abra a janela e clique em atualizar; senão, transmita a Tela inteira.`;
  }
  selectSource(state.selectedSource);
}

// Apps marcados da última vez. Sem nada salvo, o Discord já vem marcado (a voz da call não vai
// para a transmissão), a não ser que a pessoa já transmitisse com todo o som na versão antiga.
function savedExcludes() {
  try {
    const list = JSON.parse(load('excludeApps', 'null'));
    if (Array.isArray(list)) return list;
  } catch {}
  const oldMode = load('audioMode', '');
  if (oldMode === 'exclude') return [load('excludeApp', 'Discord.exe')]; // versão antiga: um app só
  return oldMode === 'all' ? [] : ['Discord.exe'];
}

function appsLoaded() { return !!$('excludeApps').querySelector('input'); }

function checkedApps() {
  return [...$('excludeApps').querySelectorAll('input:checked')].map((i) => i.value);
}

async function loadAudioApps() {
  const box = $('excludeApps');
  const wanted = appsLoaded() ? checkedApps() : savedExcludes();
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  if (!appsLoaded()) box.innerHTML = '<span class="hint">Procurando apps que estão tocando som…</span>';
  let apps = [];
  try { apps = await window.api.listAudioApps(); } catch (e) { console.error(e); }
  // Discord sempre aparece, mesmo sem estar numa call agora; os marcados antes também
  if (!apps.some((a) => same(a.exe, 'Discord.exe'))) apps.push({ exe: 'Discord.exe', name: 'Discord' });
  for (const w of wanted) if (!apps.some((a) => same(a.exe, w))) apps.push({ exe: w, name: w.replace(/\.exe$/i, '') });
  // Discord e Spotify primeiro (os mais ignorados), o resto em ordem alfabética
  const rank = (a) => ['discord.exe', 'spotify.exe'].indexOf(a.exe.toLowerCase()) >>> 0;
  apps.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'pt-BR'));
  box.innerHTML = '';
  for (const a of apps) {
    const chip = document.createElement('label');
    chip.className = 'app-chip';
    chip.title = a.exe;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = a.exe;
    input.checked = wanted.some((w) => same(w, a.exe));
    const text = document.createElement('span');
    text.textContent = a.name;
    chip.append(input, text);
    box.append(chip);
  }
  renderShareSummary();
}

function syncAudioMode() {
  const withAudio = $('soundOn').checked;
  $('excludeField').hidden = !withAudio;
  if (withAudio && !appsLoaded()) loadAudioApps();
}

async function createAppAudioTrack(exes) {
  const res = await window.api.startAppAudio(exes);
  if (!res.ok) throw new Error(res.error);

  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('pcm-worklet.js');
  const node = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
  const dest = ctx.createMediaStreamDestination();
  node.connect(dest);
  await ctx.resume();

  // O worklet converte para float no thread de áudio; aqui só copia e repassa
  window.api.onPcm((bytes) => {
    const i16 = new Int16Array(bytes.slice().buffer);
    node.port.postMessage(i16, [i16.buffer]);
  });

  state.appAudio = { ctx };
  return dest.stream.getAudioTracks()[0];
}

function stopAppAudio() {
  if (!state.appAudio) return;
  window.api.offPcm();
  window.api.stopAppAudio();
  state.appAudio.ctx.close().catch(() => {});
  state.appAudio = null;
}

function stopTracks() {
  state.systemLoopback = false;
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  stopAppAudio();
}

async function startSharing() {
  if (!state.selectedSource || state.sharing || !state.ws) return;
  const btn = $('startBtn');
  setBusy(btn, true, 'Iniciando…');

  state.quality = QUALITY[radioValue('quality')] ? radioValue('quality') : '1080p30';
  const q = QUALITY[state.quality];
  const audioMode = $('soundOn').checked ? 'all' : 'none';
  const encodeMode = radioValue('encodeMode') || 'per';
  save('encodeMode', encodeMode);
  const excluded = audioMode === 'none' ? [] : appsLoaded() ? checkedApps() : savedExcludes();
  save('quality', state.quality);
  save('audioMode', audioMode);
  if (audioMode !== 'none') save('excludeApps', JSON.stringify(excluded));

  // O som vem do capturador próprio, que sempre deixa de fora o som deste app (as telas que você
  // está assistindo) e os apps marcados. Se ele falhar sem nenhum app marcado, volta para a
  // captura comum do Windows; com apps marcados, transmite sem som (melhor que vazar a call).
  let audioTrack = null;
  let loopback = false;
  if (audioMode !== 'none') {
    try {
      audioTrack = await createAppAudioTrack(excluded);
    } catch (err) {
      stopAppAudio();
      if (!excluded.length && !voice.session && !voice.pending) {
        loopback = true;
        state.systemLoopback = true;
        toast('Não deu para separar o som deste app, então quem você assiste pode se ouvir na sua transmissão.', 'error');
      } else {
        toast(`Não foi possível ignorar os apps escolhidos: ${err.message}. Transmitindo sem áudio.`, 'error');
      }
    }
  }

  // Uma vez só + placa NVIDIA: o videocap captura e codifica, sem a captura do Chromium
  let nvenc = false;
  if (encodeMode === 'once' && (await onceSupport())?.engine === 'nvenc') nvenc = await startNvenc(state.selectedSource);

  try {
    if (nvenc && !loopback) {
      state.stream = new MediaStream();
    } else {
      await window.api.selectSource(state.selectedSource, loopback);
      state.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: q.w }, height: { max: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
        audio: loopback
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : false,
      });
      // Com o NVENC, a captura do Chromium só serviu para pegar o som do Windows
      if (nvenc) for (const t of state.stream.getVideoTracks()) { t.stop(); state.stream.removeTrack(t); }
    }
  } catch (err) {
    stopOnceEncoder();
    stopAppAudio();
    state.systemLoopback = false;
    setBusy(btn, false, 'Iniciar transmissão');
    return toast(`Não foi possível capturar a tela: ${err.message}`, 'error');
  }
  if (audioTrack) state.stream.addTrack(audioTrack);
  state.systemLoopback = loopback;

  const vTrack = state.stream.getVideoTracks()[0];
  if (vTrack) {
    setupChromeVideo(vTrack);
    if (encodeMode === 'once' && !nvenc && !(await startOnceEncoder(vTrack))) {
      toast('Este PC não conseguiu codificar uma vez só. Transmitindo no modo normal.', 'error');
    }
  }

  state.sharing = true;
  state.sharingSource = state.selectedSource;
  state.shareInfoKey = '';
  sendShareInfo();
  updateStage();
  startOutStats();
  $('noAudio').hidden = audioMode === 'none' || state.stream.getAudioTracks().length > 0;
  closeShareDialog();
  renderShareBox();
  renderMembers();
  setBusy(btn, false, 'Iniciar transmissão');
}

function setupChromeVideo(track) {
  track.contentHint = 'motion';
  track.onended = () => stopSharing('A captura foi encerrada (a janela foi fechada?).');
}

// Faixa de vídeo do Chromium, pega só quando precisa: no modo NVENC, para quem tem versão antiga
// ou quando o NVENC para no meio da transmissão
let chromeVideoPending = null;
function ensureChromeVideo() {
  const have = state.stream && state.stream.getVideoTracks()[0];
  if (have) return Promise.resolve(have);
  if (!state.sharing || !state.stream) return Promise.resolve(null);
  if (!chromeVideoPending) {
    chromeVideoPending = (async () => {
      const q = QUALITY[state.quality];
      try {
        await window.api.selectSource(state.sharingSource || state.selectedSource, false);
        const s = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { max: q.w }, height: { max: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
          audio: false,
        });
        const track = s.getVideoTracks()[0];
        if (!state.sharing || !state.stream) { track.stop(); return null; }
        setupChromeVideo(track);
        state.stream.addTrack(track);
        syncPreview();
        return track;
      } catch (err) {
        console.warn('Não foi possível capturar a tela pelo Chromium:', err);
        return null;
      } finally {
        chromeVideoPending = null;
      }
    })();
  }
  return chromeVideoPending;
}

// No modo NVENC, a captura do Chromium só fica ligada enquanto alguém com versão antiga assiste
function releaseChromeVideo() {
  if (!once.active || once.engine !== 'nvenc' || !state.stream) return;
  if ([...state.out.values()].some((l) => !l.dc)) return;
  for (const t of state.stream.getVideoTracks()) { t.onended = null; t.stop(); state.stream.removeTrack(t); }
  syncPreview();
}

function stopSharing(reason) {
  if (!state.sharing) return;
  state.sharing = false;
  state.sharingSource = null;
  if (state.shareSwitching) closeShareDialog();
  stopWatching(state.myId, false);
  stopOnceEncoder();
  stopOutStats();
  for (const id of [...state.out.keys()]) closeOut(id);
  stopTracks();
  state.shareInfo = null;
  state.shareInfoKey = '';
  send({ type: 'share', sharing: false });
  updateStage();
  renderShareBox();
  renderMembers();
  if (reason) toast(reason);
}

// Troca a tela ou janela no meio da transmissão, sem derrubar ninguém. O som não muda (vem do
// capturador de áudio, não da tela).
//   Modo normal: a faixa nova entra no lugar da antiga em cada conexão (replaceTrack, sem renegociar).
//   Uma vez só pelo WebCodecs: o codificador passa a ler da faixa nova.
//   Uma vez só pelo NVENC direto: o videocap recomeça apontando para a fonte nova, e todos recebem um
//   quadro-chave. Se o NVENC não conseguir, continua pelo WebCodecs com a faixa do Chromium.
async function switchSource() {
  const id = state.selectedSource;
  if (!state.sharing || !id || id === state.sharingSource) return closeShareDialog();
  const btn = $('startBtn');
  btn.dataset.busy = '1';
  setBusy(btn, true, 'Trocando…');
  const q = QUALITY[state.quality];
  const oldVideo = state.stream.getVideoTracks()[0] || null;
  const nvenc = once.active && once.engine === 'nvenc';
  let newVideo = null;
  try {
    // Faixa nova do Chromium: sempre, menos no NVENC sem ninguém de versão antiga (que não usa essa faixa)
    if (oldVideo || !nvenc) {
      await window.api.selectSource(id, false);
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: q.w }, height: { max: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
        audio: false,
      });
      newVideo = s.getVideoTracks()[0];
    }
  } catch (err) {
    delete btn.dataset.busy;
    setBusy(btn, false, 'Trocar para esta');
    return toast(`Não foi possível capturar: ${err.message}`, 'error');
  }
  if (!state.sharing) { newVideo?.stop(); delete btn.dataset.busy; return; }
  state.sharingSource = id;

  if (newVideo) {
    if (oldVideo) { oldVideo.onended = null; state.stream.removeTrack(oldVideo); }
    state.stream.addTrack(newVideo);
    setupChromeVideo(newVideo);
    for (const link of state.out.values()) {
      const sender = link.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
      if (sender) await sender.replaceTrack(newVideo).catch((e) => console.warn(e));
    }
    if (once.active && once.engine === 'webcodecs') {
      const reader = once.reader;
      once.reader = null;
      if (reader) reader.cancel().catch(() => {});
      once.keyWanted = true;
      readFrames(newVideo);
    }
    oldVideo?.stop();
  }

  if (nvenc) {
    window.api.offVideoCap();
    await window.api.videoCapStop().catch(() => {});
    once.active = false;
    once.engine = '';
    if (await startNvenc(id)) {
      sendConfigToAll();
      for (const [, l] of onceLinks()) l.needKey = true;
      requestKey();
    } else {
      await switchToWebCodecs('O NVENC direto não conseguiu capturar a fonte nova.');
    }
  }

  delete btn.dataset.busy;
  setBusy(btn, false, 'Trocar para esta');
  closeShareDialog();
  renderShareBox();
  sendShareInfo();
  refreshSelfView();
  const src = state.sources.find((s) => s.id === id);
  toast(`Agora você está transmitindo: ${src ? sourceLabel(src) : 'a fonte nova'}.`);
}

// Alguém clicou em Assistir na minha transmissão: só agora a conexão é criada
// Se eu transmito no modo "uma vez só" e o app da pessoa entende, o vídeo vai pelo canal de dados;
// senão (ex.: versão antiga), vai como faixa WebRTC normal, com o codificador próprio dessa conexão.
function addWatcher(id, wantsOnce) {
  if (!state.sharing || !state.stream) return sendSignal(id, { side: 'sharer', unavailable: true });
  closeOut(id);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const link = { pc, chain: Promise.resolve(), dc: null };
  state.out.set(id, link);

  const useOnce = wantsOnce && once.active;
  if (useOnce) {
    link.dc = pc.createDataChannel('video');
    setupOnceSender(link);
  }
  // No modo NVENC não há faixa de vídeo do Chromium: quem precisa dela (versão antiga) espera ela ser pega
  link.chain = link.chain.then(async () => {
    if (!useOnce) await ensureChromeVideo();
    if (!state.stream || state.out.get(id) !== link) return;
    state.stream.getTracks().filter((t) => !useOnce || t.kind !== 'video').forEach((t) => pc.addTrack(t, state.stream));
    if (!useOnce) preferH264(pc);
  });
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal(id, { side: 'sharer', candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') link.chain = link.chain.then(() => applyBitrate(link)).catch(console.error);
    renderWatchers();
  };
  link.chain = link.chain.then(async () => {
    await pc.setLocalDescription(await pc.createOffer());
    sendSignal(id, { side: 'sharer', sdp: pc.localDescription });
  }).catch(console.error);

  renderWatchers();
  toast(`${nameOf(id)} está assistindo você`);
}

function closeOut(id) {
  const link = state.out.get(id);
  if (!link) return;
  if (link.dc) link.dc.close();
  link.pc.close();
  state.out.delete(id);
  releaseChromeVideo();
  renderWatchers();
}

// Como a transmissão foi enquanto a janela estava escondida (ex.: jogo em tela cheia). Ao voltar,
// o painel diz o que limitou: captura lenta (placa de vídeo ocupada), processador ou internet.
const away = { since: 0, samples: [] };

function formatDuration(secs) {
  return secs < 120 ? `${Math.round(secs)} s` : `${Math.round(secs / 60)} min`;
}

function awayReport() {
  const s = away.samples;
  away.samples = [];
  const secs = (Date.now() - away.since) / 1000;
  if (!state.sharing || s.length < 3 || secs < 10) return;
  const avg = (k) => s.reduce((t, x) => t + x[k], 0) / s.length;
  const share = (l) => s.filter((x) => x.limit === l).length / s.length;
  const fps = QUALITY[state.quality].fps;
  const measured = s.some((x) => x.captureFps > 0);
  const captured = measured ? avg('captureFps') : avg('sentFps');
  const why = share('cpu') > 0.3 ? 'O processador ficou no limite.'
    : share('bandwidth') > 0.3 ? 'A internet limitou o envio.'
    : captured < fps * 0.7 ? 'A captura da tela entregou poucos quadros: se o jogo estava rodando, a placa de vídeo estava ocupada ou a janela do jogo não deixa ser capturada em tela cheia. Limite o FPS do jogo ou use o modo janela sem bordas.'
    : 'Nada limitou a transmissão.';
  $('awayInfo').textContent = `Enquanto o app estava escondido (${formatDuration(secs)}): captura a ${Math.round(captured)} de ${fps} fps, `
    + `enviando ${Math.round(avg('sentFps'))} fps e ${avg('mbps').toFixed(1)} Mbps. ${why}`;
  console.log('[diagnóstico]', $('awayInfo').textContent, s);
}

// O que eu estou usando para transmitir, para a aba Transmissão das Estatísticas de quem está na sala.
// Só manda de novo quando algo muda (ex.: o NVENC caiu para o WebCodecs, ou descobriu a placa de vídeo).
function myShareInfo(hw) {
  const info = { quality: state.quality, mode: once.active ? 'once' : 'per', engine: once.active ? engineName() : 'WebRTC',
    audio: !!state.stream?.getAudioTracks().length };
  const h = once.active ? once.hardware : hw;
  if (typeof h === 'boolean') info.hw = h;
  return info;
}
function sendShareInfo(hw) {
  if (!state.sharing) return;
  const info = myShareInfo(hw ?? state.shareInfo?.hw);
  const key = JSON.stringify(info);
  if (key === state.shareInfoKey) return;
  state.shareInfoKey = key;
  state.shareInfo = info;
  send({ type: 'share', sharing: true, info });
}

// Mostra para quem transmite qual codec está em uso e se a placa de vídeo está codificando
function startOutStats() {
  stopOutStats();
  const last = { ts: performance.now(), captured: 0, encoded: 0, dropped: 0, sent: 0, behind: 0 };
  state.outStatsTimer = setInterval(async () => {
    const active = [...state.out.values()].filter((l) => l.pc.connectionState === 'connected' && !l.videoOff);
    const links = active.filter((l) => !l.dc);
    const onceCount = active.length - links.length;
    if (!active.length) {
      Object.assign(perf.live, { captureFps: null, sentFps: 0, upMbps: 0 }); // ninguém assistindo
      if (!document.hidden) $('encoderInfo').textContent = '';
      return;
    }
    let codec = '', hw = null, limit = 'none', captureFps = 0, sentFps = 0, mbps = 0;

    // Modo "uma vez só": contadores próprios, já que não há faixa de vídeo WebRTC
    const now = performance.now();
    const secs = (now - last.ts) / 1000;
    const behind = active.reduce((t, l) => t + (l.behind || 0), 0);
    if (once.active && secs > 0) {
      captureFps = (once.captured - last.captured) / secs;
      if (onceCount) {
        sentFps = (once.encoded - last.encoded) / secs;
        mbps = ((once.sentBytes - last.sent) * 8) / secs / 1e6;
        if (once.dropped > last.dropped) limit = 'cpu';
        else if (behind > last.behind) limit = 'bandwidth';
      }
    }
    Object.assign(last, { ts: now, captured: once.captured, encoded: once.encoded, dropped: once.dropped, sent: once.sentBytes, behind });

    for (const link of links) {
      let report;
      try { report = await link.pc.getStats(); } catch { continue; }
      report.forEach((r) => {
        if (r.type === 'media-source' && r.kind === 'video') captureFps = Math.max(captureFps, r.framesPerSecond || 0);
        if (r.type !== 'outbound-rtp' || r.kind !== 'video') return;
        codec = codecName(report, r.codecId) || codec;
        const h = usesHardware(r.powerEfficientEncoder, r.encoderImplementation);
        if (h !== null) hw = hw === null ? h : hw && h;
        if (r.qualityLimitationReason === 'cpu') limit = 'cpu';
        else if (r.qualityLimitationReason === 'bandwidth' && limit !== 'cpu') limit = 'bandwidth';
        sentFps += (r.framesPerSecond || 0) / active.length;
        if (link.lastTs) mbps += ((r.bytesSent - link.lastBytes) * 8) / (r.timestamp - link.lastTs) / 1000;
        link.lastBytes = r.bytesSent;
        link.lastTs = r.timestamp;
      });
    }
    Object.assign(perf.live, { captureFps, sentFps, upMbps: mbps });
    sendShareInfo(hw); // a placa de vídeo só aparece depois das primeiras medidas
    if (document.hidden) {
      away.samples.push({ captureFps, sentFps, mbps, limit }); // ninguém está vendo o painel agora
      return;
    }
    const place = (h) => (h === true ? ' pela placa de vídeo' : h === false ? ' pelo processador' : '');
    let text = '';
    if (onceCount) {
      text = `Codificando em H.264 uma vez só${onceCount > 1 ? ` para ${onceCount} pessoas,` : ''}${once.engine === 'nvenc' ? ' pelo NVENC direto' : place(once.hardware)}.`;
    }
    if (codec) {
      const n = links.length;
      text += `${text ? ' ' : ''}Codificando em ${codec}${place(hw)}${onceCount ? ` para quem tem versão antiga` : ''}.`;
      if (n > 1) text += ` São ${n} codificações, uma para cada pessoa.`;
    }
    if (!text) return;
    if (limit === 'cpu') text += ' O processador está no limite, então a qualidade foi reduzida.';
    else if (limit === 'bandwidth') text += ' A internet está limitando a qualidade.';
    $('encoderInfo').textContent = text;
  }, 2000);
}

function stopOutStats() {
  clearInterval(state.outStatsTimer);
  state.outStatsTimer = null;
  Object.assign(perf.live, { captureFps: null, sentFps: null, upMbps: 0 });
  $('encoderInfo').textContent = '';
  $('awayInfo').textContent = '';
  away.samples = [];
}

// Transmitindo: a barra mostra "Ao vivo" e Parar; o painel mostra a prévia e os detalhes
function renderShareBox() {
  $('shareBtn').hidden = state.sharing;
  $('liveChip').hidden = !state.sharing;
  const selfOn = !!state.myId && state.in.has(state.myId);
  setIcon($('selfViewBtn'), 'eye', selfOn ? 'Parar de ver a sua transmissão' : 'Ver a sua própria transmissão');
  $('selfViewBtn').setAttribute('aria-pressed', String(selfOn));
  $('myShare').hidden = !state.sharing;
  syncPreview();
  renderWatchers();
}

function renderWatchers() {
  const names = [...state.out].map(([id, l]) => nameOf(id) + (l.videoOff ? ' (vídeo pausado)' : ''));
  $('watcherInfo').textContent = names.length
    ? `Assistindo você: ${names.join(', ')}`
    : 'Ninguém está assistindo ainda. Só é enviado vídeo para quem clicar em Assistir.';
  const n = state.out.size;
  $('liveText').textContent = n === 0 ? 'ninguém assistindo' : n === 1 ? '1 assistindo' : `${n} assistindo`;
}

// ---------- Partida: o que roda na carga, na mesma ordem de antes ----------
voice.media = { getUserMedia: () => openMic() };
document.addEventListener('mousedown', (e) => {
  const card = $('personCard');
  if (!card.hidden && !card.contains(e.target) && !e.target.closest('.vol-btn, .voice-avatar')) closePersonCard();
});

$('voiceJoin').onclick = () => {
  if (voice.session || voice.pending) return voice.leave();
  if (state.systemLoopback) return toast('Pare sua transmissão, entre na voz e depois reinicie a transmissão: a captura atual inclui todo o som do PC.', 'error');
  mixer.ensure(); // o clique libera o áudio do app
  voice.join();
};
$('voiceMute').onclick = () => voice.mute();
$('voiceDeafen').onclick = () => voice.deafen();
// Captura antes de qualquer outro atalho da página
window.addEventListener('keydown', async (e) => {
  if (!capturing) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') return stopCapture();
  const c = capturing;
  if (c.kind === 'ptt') {
    if (!e.keyCode) return;
    voiceCfg.pttVk = e.keyCode; // no Windows, é o código de tecla virtual que o teclas.exe usa
    voiceCfg.pttLabel = keyLabel(e);
    saveVoiceCfg();
    stopCapture();
    ptt.active = -1; // força reiniciar com a tecla nova
    syncPtt();
    renderVoiceDialog();
    renderVoiceMe();
    return;
  }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; // espera a tecla principal
  const a = accelFromEvent(e);
  if (!a) return toast('Essa tecla não pode ser usada como atalho.', 'error');
  if (!a.strong && !a.fkey) return toast('Use Ctrl ou Alt junto (ou uma tecla de F1 a F24), para não atrapalhar quando você digita.', 'error');
  stopCapture();
  await applyShortcut(c.action, a.accel);
}, true);
// Botões do mouse para o apertar para falar: meio e os laterais (o esquerdo e o direito ficam de fora)
window.addEventListener('mousedown', (e) => {
  if (!capturing || capturing.kind !== 'ptt' || ![1, 3, 4].includes(e.button)) return;
  e.preventDefault();
  voiceCfg.pttVk = { 1: 4, 3: 5, 4: 6 }[e.button];
  voiceCfg.pttLabel = { 1: 'Botão do meio', 3: 'Mouse 4', 4: 'Mouse 5' }[e.button];
  saveVoiceCfg();
  stopCapture();
  ptt.active = -1;
  syncPtt();
  renderVoiceDialog();
  renderVoiceMe();
}, true);

document.querySelectorAll('input[name="noise"]').forEach((r) => {
  r.onchange = () => { voiceCfg.ns = r.value; saveVoiceCfg(); renderVoiceDialog(); restartMic(); };
});
$('echoOn').onchange = () => { voiceCfg.echo = $('echoOn').checked; saveVoiceCfg(); restartMic(); };
document.querySelectorAll('input[name="talkMode"]').forEach((r) => {
  r.onchange = () => {
    voiceCfg.mode = r.value;
    saveVoiceCfg();
    renderVoiceDialog();
    syncPtt();
    applyMicGate();
    renderVoiceMe();
    if (voiceCfg.mode === 'ptt' && !voiceCfg.pttVk) startCapture({ kind: 'ptt', btn: $('pttChange') });
  };
});
$('pttChange').onclick = () => startCapture({ kind: 'ptt', btn: $('pttChange') });
$('gateAuto').onchange = () => {
  voiceCfg.gateAuto = $('gateAuto').checked;
  if (!voiceCfg.gateAuto && micNow) voiceCfg.gateDb = Math.round(gateThreshold(micNow)); // começa de onde o automático estava
  saveVoiceCfg();
  renderVoiceDialog();
};
$('gateDb').oninput = () => { voiceCfg.gateDb = Number($('gateDb').value); saveVoiceCfg(); renderVoiceDialog(); };
$('duckAmount').oninput = () => { voiceCfg.duck = Number($('duckAmount').value); saveVoiceCfg(); renderVoiceDialog(); updateDuck(); };
$('duckSelf').onchange = () => { voiceCfg.duckSelf = $('duckSelf').checked; saveVoiceCfg(); updateDuck(); };
$('shortcutReset').onclick = async () => {
  const defaults = { compose: 'CommandOrControl+Enter', mute: 'CommandOrControl+Shift+M', edit: 'CommandOrControl+Shift+E', hideChat: 'CommandOrControl+Shift+O' };
  for (const action of Object.keys(defaults)) await window.api.setShortcut(action, '').catch(() => {}); // solta todos antes
  for (const [action, accel] of Object.entries(defaults)) await applyShortcut(action, accel);
};
$('voiceSettingsBtn').onclick = openVoiceDialog;
$('closeVoiceDialog').onclick = closeVoiceDialog;
$('voiceDialog').addEventListener('mousedown', (e) => { if (e.target === $('voiceDialog')) closeVoiceDialog(); });
$('statsDialog').addEventListener('mousedown', (e) => { if (e.target === $('statsDialog')) closeStats(); });

window.addEventListener('beforeunload', () => voice.leave(false));

window.api.onPip((m) => {
  // O modo de ajuste vale para todas as janelas ao mesmo tempo
  if (m.group) { pipGroupState = m.group; renderPipGroup(); }
  if (m.type === 'edit') { overlay.edit = !!m.on; renderChatOverlay(); }
  if (m.type === 'chat-closed') { overlay.p = null; overlay.compose = false; clearTimeout(overlay.timer); renderOverlayButton(); }
  if (m.type === 'compose-key') onComposeKey();
  if (m.type === 'ptt') onPttKey(!!m.down);
  if (m.type === 'mute-key' && voice.session) voice.mute();
  if (m.type === 'compose') {
    overlay.compose = !!m.on;
    renderChatOverlay();
    if (overlay.compose) setTimeout(() => overlay.p?.input.focus(), 30);
  }
  if (m.type === 'edit') {
    for (const [id, p] of state.pips) {
      if (p.win.closed) continue;
      setPipLocked(p, !m.on);
      const o = m.opacity && m.opacity[id];
      if (typeof o === 'number') p.opacity.value = String(Math.round(o * 100));
    }
  }
  else if (m.type === 'closed' && state.pips.has(m.id)) { const p = state.pips.get(m.id); state.pips.delete(m.id); pipClosed(p); }
  else if (m.type === 'shortcut-busy') toast(`Outro programa já usa ${accelLabel(m.accel)}, então esse atalho não funciona agora. Dá para trocar em Voz e atalhos (a engrenagem na barra).`, 'error');
});

// ---------- Início ----------
$('name').value = load('name');
$('name').addEventListener('input', () => save('name', $('name').value));
$('roomPort').value = load('roomPort', '8765');
$('roomAddr').value = load('roomAddr');
// "720p 30 fps" saiu das opções: quem usava fica na Leve (720p 60 fps)
const savedQuality = load('quality', '1080p30');
setRadio('quality', savedQuality === '720p30' ? '720p60' : savedQuality);
if (!radioValue('quality')) setRadio('quality', '1080p30');
$('soundOn').checked = load('audioMode', 'all') !== 'none'; // "exclude" da versão antiga conta como com som
setRadio('encodeMode', load('encodeMode', 'per') === 'once' ? 'once' : 'per');
// Prioridade vale para o app inteiro e já na abertura, não só durante a transmissão
setRadio('priority', load('priority', 'above'));
if (!radioValue('priority')) setRadio('priority', 'above');
window.api.setPriority(radioValue('priority'));

// Qualquer mudança na janela de transmitir atualiza o resumo do rodapé
$('shareDialog').addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'priority') {
    save('priority', t.value);
    window.api.setPriority(t.value);
  } else if (t.name === 'encodeMode') {
    syncEncodeNote();
  } else if (t.id === 'soundOn') {
    syncAudioMode();
  }
  renderShareSummary();
});
$('tabScreens').onclick = () => { state.sourceTab = 'screens'; renderSources(); };
$('tabWindows').onclick = () => { state.sourceTab = 'windows'; renderSources(); };
$('advToggle').onclick = () => setAdvanced($('advToggle').getAttribute('aria-expanded') !== 'true');
setIcon($('closeShare'), 'close', 'Fechar');
setIcon($('refreshSources'), 'refresh', 'Atualizar lista');
$('closeShare').onclick = closeShareDialog;

// Tela inicial: Radmin VPN, última sala e "Entrar numa sala" aberto ali mesmo
async function renderRadmin() {
  let ips = [];
  try { ips = await window.api.getIps(); } catch {}
  const r = ips.find((i) => i.radmin);
  $('radminDot').className = 'dot ' + (r ? 'ok' : 'warn');
  $('radminTitle').textContent = r ? 'Radmin VPN conectada' : 'Radmin VPN não encontrada';
  $('radminDetail').textContent = r ? r.address : 'Ligue a Radmin e entre na rede';
}

function renderLastRoom() {
  const last = load('roomAddr');
  $('lastRoom').hidden = !last;
  $('lastRoomAddr').textContent = last;
}

function renderHome() {
  renderRadmin();
  renderLastRoom();
}

function setJoinOpen(open) {
  $('joinPanel').hidden = !open;
  $('goJoin').hidden = open;
  $('goJoin').setAttribute('aria-expanded', String(open));
  $('homeCard').classList.toggle('joining', open);
  (open ? $('roomAddr') : $('goJoin')).focus();
}
window.addEventListener('focus', () => { if (!$('home').hidden) renderRadmin(); });

window.api.getVersion().then((v) => {
  update.myVersion = v;
  $('appVersion').textContent = `Versão ${v}`;
  checkGithub();
});
$('checkUpdates').onclick = () => checkGithub(true);
$('ubGo').onclick = runUpdate;
$('ubLater').onclick = () => { update.dismissed = updateMode()?.version || ''; renderUpdateBanner(); };
setInterval(() => checkGithub(), 30 * 60 * 1000); // quem deixa o app aberto também fica sabendo

$('goCreate').onclick = () => show('create-room');
$('goJoin').onclick = () => setJoinOpen(true);
$('cancelJoin').onclick = () => setJoinOpen(false);
$('rejoinBtn').onclick = () => {
  $('roomAddr').value = load('roomAddr');
  setJoinOpen(true);
  joinRoom();
};
document.querySelectorAll('.back').forEach((b) => { b.onclick = () => show('home'); });

$('createBtn').onclick = createRoom;
$('roomPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') createRoom(); });
$('joinBtn').onclick = joinRoom;
$('roomAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('joinPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });

// O host, ao sair com mais gente na sala: passa a sala para o mais antigo ou encerra para todos
function openCloseDialog() {
  const next = successors().find((id) => id !== state.myId);
  const handoff = state.handoff && !!next;
  $('closeTitle').textContent = handoff ? 'Sair da sala?' : 'Encerrar a sala para todos?';
  $('closeText').textContent = handoff
    ? `Você é o host. Se sair, ${nameOf(next)} vira o host e a sala continua para os outros, sem as transmissões caírem. Ou encerre a sala para todo mundo.`
    : 'Todo mundo sai da sala e as transmissões param. Para voltar, crie a sala de novo e passe o endereço.';
  $('handoffLeave').hidden = !handoff;
  $('confirmClose').textContent = handoff ? 'Encerrar para todos' : 'Encerrar sala';
  $('closeDialog').hidden = false;
  (handoff ? $('handoffLeave') : $('cancelClose')).focus();
}
function closeCloseDialog() {
  $('closeDialog').hidden = true;
  $('leaveBtn').focus();
}
$('leaveBtn').onclick = () => {
  if (state.isOwner && state.members.size) openCloseDialog();
  else leaveRoom(state.isOwner ? 'Sala encerrada.' : null);
};
$('cancelClose').onclick = closeCloseDialog;
$('confirmClose').onclick = () => leaveRoom('Sala encerrada.', 'info', true);
$('handoffLeave').onclick = () => leaveRoom(`Você saiu. ${nameOf(successors().find((id) => id !== state.myId))} agora é o host da sala.`);
$('shareBtn').onclick = openShareDialog;
$('stopShareBtn').onclick = () => stopSharing();
$('cancelShare').onclick = closeShareDialog;
$('startBtn').onclick = () => (state.shareSwitching ? switchSource() : startSharing());
$('switchShareBtn').onclick = () => openShareDialog(true);
$('refreshSources').onclick = loadSources;
$('refreshApps').onclick = loadAudioApps;
// Ícone das Estatísticas, na sala ao lado de Sair da sala
setIcon($('openStatsRoom'), 'stats', 'Estatísticas: desempenho do PC e a transmissão de cada pessoa');
$('openStatsRoom').onclick = openStats;
$('selfViewBtn').onclick = toggleSelfView;
$('statsTabPerf').onclick = () => setStatsTab('perf');
$('statsTabStream').onclick = () => setStatsTab('stream');
for (const id of ['statsTabPerf', 'statsTabStream']) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setStatsTab(statsTab === 'perf' ? 'stream' : 'perf', true);
  });
}

// Chat
$('chatToggle').insertAdjacentHTML('afterbegin', ICON.chat);
$('chatToggle').onclick = () => setPanelOpen(!chat.open);
setIcon($('chatCollapse'), 'chevron', 'Recolher o painel da sala');
$('chatCollapse').onclick = () => setPanelOpen(false);
$('peopleBtn').onclick = () => setPeopleOpen($('peoplePop').hidden);
// Clicar fora da lista fecha (o cartão de volume, que abre de dentro dela, conta como dentro)
document.addEventListener('mousedown', (e) => {
  if ($('peoplePop').hidden) return;
  if (e.target.closest('#peoplePop, #peopleBtn, #personCard')) return;
  setPeopleOpen(false);
});
$('chatJump').onclick = () => { scrollChatToEnd(); markRead(); };
$('chatList').addEventListener('scroll', () => { if (chatAtBottom() && chat.open && !document.hidden) markRead(); else renderUnread(); });
// A barra de rolagem fica escondida e aparece enquanto rola (e com o mouse em cima, pelo CSS)
let chatScrollTimer = 0;
$('chatList').addEventListener('scroll', () => {
  $('chatList').classList.add('scrolling');
  clearTimeout(chatScrollTimer);
  chatScrollTimer = setTimeout(() => $('chatList').classList.remove('scrolling'), 900);
}, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && chat.open && chatAtBottom()) markRead(); });
$('dockAddr').onclick = async () => {
  try { await navigator.clipboard.writeText(state.roomAddr); toast('Endereço copiado.'); } catch { toast('Não foi possível copiar.', 'error'); }
};
setIcon($('pipChipClose'), 'close', 'Fechar as janelas flutuantes');
renderOverlayButton();
$('overlayToggle').onclick = toggleChatOverlay;
$('pipChipClose').onclick = () => { for (const id of [...state.pips.keys()]) closePip(id); };
setIcon($('chatAttach'), 'attach', 'Mandar arquivo (até 200 MB)');
setIcon($('chatSend'), 'send', 'Enviar');
$('chatForm').onsubmit = (e) => { e.preventDefault(); sendChat(); };
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
$('chatInput').addEventListener('input', fitChatInput);
$('chatAttach').onclick = () => $('chatFile').click();
$('chatFile').onchange = () => { attachFiles([...$('chatFile').files]); $('chatFile').value = ''; };
// Arrastar arquivo para o chat; fora dele, soltar um arquivo não faz a janela abrir o arquivo
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
$('chatTab').addEventListener('dragover', (e) => { e.preventDefault(); if (chat.supported) $('chatDrop').hidden = false; });
$('chatTab').addEventListener('dragleave', (e) => { if (!$('chatTab').contains(e.relatedTarget)) $('chatDrop').hidden = true; });
$('chatTab').addEventListener('drop', (e) => {
  e.preventDefault();
  $('chatDrop').hidden = true;
  attachFiles([...e.dataTransfer.files]);
});
$('closeStats').onclick = closeStats;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('voiceDialog').hidden) { if (!capturing) closeVoiceDialog(); }
  else if (!$('personCard').hidden) closePersonCard();
  else if (!$('peoplePop').hidden) { setPeopleOpen(false); $('peopleBtn').focus(); }
  else if (!$('statsDialog').hidden) closeStats();
  else if (!$('closeDialog').hidden) closeCloseDialog();
  else if (!$('shareDialog').hidden) closeShareDialog();
  else if (state.focus && !document.fullscreenElement) setFocus(null);
  else if (!$('home').hidden && !$('joinPanel').hidden) setJoinOpen(false);
});
document.addEventListener('fullscreenchange', () => {
  for (const link of state.in.values()) setFsIcon(link.tile.fs, document.fullscreenElement === link.tile.el);
});
document.addEventListener('visibilitychange', onVisibility);
window.addEventListener('focus', syncPreview);
window.addEventListener('blur', syncPreview);

show('home');
