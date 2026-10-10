'use strict';
// Tela inicial e a partida do app: liga os botões e listeners, carrega as preferências e mostra o início.
// Roda por último (todos os outros scripts já definiram o que ele usa).

voice.media = { getUserMedia: () => openMic() };
document.addEventListener('mousedown', (e) => {
  const card = $('personCard');
  if (!card.hidden && !card.contains(e.target) && !e.target.closest('.vol-btn, .vs-row, [data-profile], #imageViewer')) closePersonCard();
});

$('voiceJoin').onclick = () => {
  if (voice.session || voice.pending) return voice.leave();
  if (state.systemLoopback) return toast('Pare sua transmissão, entre na voz e depois reinicie a transmissão: a captura atual inclui todo o som do PC.', 'error');
  joinVoiceIn($('voiceJoin').dataset.channel || ''); // o canal com mais gente (renderVoiceJoin)
};
$('voiceJoinMore').onclick = () => ($('voiceJoinPop') ? closeVoiceJoinPop() : openVoiceJoinPop());
setIcon($('voiceJoinMore'), 'chevronUp', 'Escolher o canal para entrar');
$('voiceMute').onclick = () => voice.mute();
$('paneVoiceSubsala').onclick = () => subsalaButtonClick($('paneVoiceSubsala'));
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
// Foto de perfil (renderer/fotos.js)
$('profilePhotoBig').onclick =() => $('profilePhotoFile').click();
$('profilePhotoFile').onchange = async () => {
  const file = $('profilePhotoFile').files[0];
  $('profilePhotoFile').value = '';
  if (!file) return;
  try { await ajustarFoto(file); } catch { toast('Não deu para abrir essa imagem. Escolha uma foto (JPG, PNG, WebP...).', 'error'); }
};
$('profilePhotoRemove').onclick = removeMyPhoto;
for (const b of $('profilePhotoFit').querySelectorAll('[data-fit]')) b.onclick = () => setPhotoFit(b.dataset.fit);
renderMyPhoto();
setupProfileBg(); // fundo do perfil (renderer/fundo-perfil.js)
setupGamerMode(); // o botão do controle na barrinha (renderer/modo-gamer.js); depois da prioridade salva
$('micSelect').onchange = () => {
  const id = $('micSelect').value;
  if (id === voiceCfg.micId) return;
  voiceCfg.micId = id;
  voiceCfg.micLabel = id ? $('micSelect').selectedOptions[0].textContent : '';
  saveVoiceCfg();
  restartMic();
};
navigator.mediaDevices.addEventListener('devicechange', () => { if (voiceSettingsOpen()) renderMicList(); });
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
// Volume das vozes: vale na hora para todo mundo na voz; clique duplo volta para 100%
const setVozes = (n) => { voiceCfg.vozes = n; saveVoiceCfg(); renderVoiceDialog(); for (const id of mixer.nodes.keys()) mixer.apply(id); };
$('vozesVolume').oninput = () => setVozes(Number($('vozesVolume').value));
$('vozesVolume').ondblclick = () => setVozes(100);
$('duckAmount').oninput = () => { voiceCfg.duck = Number($('duckAmount').value); saveVoiceCfg(); renderVoiceDialog(); updateDuck(); };
$('duckSelf').onchange = () => { voiceCfg.duckSelf = $('duckSelf').checked; saveVoiceCfg(); updateDuck(); };
$('shortcutReset').onclick = async () => {
  const defaults = { compose: 'CommandOrControl+Enter', mute: 'CommandOrControl+Shift+M', deafen: 'CommandOrControl+Shift+D', edit: 'CommandOrControl+Shift+E', hideChat: 'CommandOrControl+Shift+O', clip: 'CommandOrControl+Shift+C', voiceCmd: 'CommandOrControl+Shift+V' };
  for (const action of Object.keys(defaults)) await window.api.setShortcut(action, '').catch(() => {}); // solta todos antes
  for (const [action, accel] of Object.entries(defaults)) await applyShortcut(action, accel);
};
$('micTestBtn').onclick = () => (micTest.on ? stopMicTest() : startMicTest());
$('voiceSettingsBtn').onclick = () => (voiceSettingsOpen() ? closeVoiceDialog() : openVoiceDialog()); // de novo: fecha

window.addEventListener('beforeunload', () => { stopMicTest(); voice.leave(false); });

window.api.onPip((m) => {
  // O modo de ajuste vale para todas as janelas ao mesmo tempo
  if (m.group) { pipGroupState = m.group; renderPipGroup(); }
  if (m.type === 'edit') { overlay.edit = !!m.on; renderChatOverlay(); }
  if (m.type === 'chat-closed') { overlay.p = null; overlay.compose = false; clearTimeout(overlay.timer); renderOverlayButton(); }
  if (m.type === 'compose-key') onComposeKey();
  if (m.type === 'ptt') onPttKey(!!m.down);
  if (m.type === 'mute-key' && voice.session) voice.mute();
  if (m.type === 'deafen-key' && voice.session) voice.deafen();
  if (m.type === 'tray-update') checkGithub(true);
  if (m.type === 'clip-key') saveClip();
  if (m.type === 'cmd-key') onComandoVozTecla(!!m.down);
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
// "Uma vez só" é o padrão (dá clipe sem recodificar e pesa menos com várias pessoas). A chave mudou de nome para
// quem tinha "uma por pessoa" salvo só por ser o padrão antigo começar no novo; quem não tem o modo cai em "uma por pessoa"
// sozinho (transmitir.js › checkEncodeOnce).
setRadio('encodeMode', load('encodeMode2', 'once') === 'per' ? 'per' : 'once');
$('cursorOn').checked = load('mostrarMouse', '1') !== '0';
$('shareOpenOn').checked = load('transmissaoAberta', '1') !== '0';
// Dicas (o "i"): liga e desliga todas de uma vez (renderer/util.js)
$('tipsOn').checked = document.documentElement.dataset.tips !== 'off';
$('tipsOn').onchange = () => { save('dicas', $('tipsOn').checked ? '1' : '0'); document.documentElement.dataset.tips = $('tipsOn').checked ? 'on' : 'off'; };
// Prioridade vale para o app inteiro e já na abertura, não só durante a transmissão
setRadio('priority', load('priority', 'above'));
if (!radioValue('priority')) setRadio('priority', 'above');
window.api.setPriority(radioValue('priority'));

// Qualquer mudança na janela de transmitir atualiza o resumo do rodapé
$('shareDialog').addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'priority') {
    save('priority', t.value);
    window.api.setPriority(gamerOn() ? 'normal' : t.value); // no modo gamer fica normal até desligar (modo-gamer.js)
  } else if (t.name === 'encodeMode') {
    // Sem o mouse só dá no NVENC direto: voltar para "Uma por pessoa" traz o mouse de volta
    if (t.value === 'per' && !$('cursorOn').checked) { $('cursorOn').checked = true; save('mostrarMouse', '1'); }
    syncEncodeNote();
    syncCursor();
  } else if (t.id === 'cursorOn') {
    save('mostrarMouse', t.checked ? '1' : '0');
    if (!t.checked && encodeOnceSupport?.engine === 'nvenc') { setRadio('encodeMode', 'once'); syncEncodeNote(); }
    syncCursor();
  } else if (t.id === 'soundOn') {
    syncAudioMode();
  } else if (t.id === 'shareOpenOn') {
    save('transmissaoAberta', t.checked ? '1' : '0');
  }
  renderShareSummary();
});
$('tabScreens').onclick = () => { state.sourceTab = 'screens'; renderSources(); };
$('tabWindows').onclick = () => { state.sourceTab = 'windows'; renderSources(); };
$('advToggle').onclick = () => setAdvanced($('advToggle').getAttribute('aria-expanded') !== 'true');
// Todo botão de fechar janela é um X (a dica e o leitor de tela dizem "Fechar")
for (const id of ['closeShare', 'closeGeneralSettings', 'closeProfile']) setIcon($(id), 'close', 'Fechar');
setIcon($('refreshSources'), 'refresh', 'Atualizar lista');
$('closeShare').onclick = closeShareDialog;

// O botão da rede no topo do Início (docs/spec/inicio-novo.md): bolinha, nome curto e detalhe; a frase inteira vai na
// dica e no resumo de Configurações › Rede (homeRede.dataset.explica)
function setRedeTopo(ok, nome, detalhe, explica) {
  $('radminDot').className = 'dot ' + (ok ? 'ok' : 'warn');
  $('radminTitle').textContent = nome;
  $('radminDetail').textContent = detalhe;
  $('homeRede').title = explica;
  $('homeRede').dataset.explica = explica;
  $('homeRede').setAttribute('aria-label', `Rede: ${nome}, ${detalhe}. Trocar de rede`);
  if (!$('homeRedeMenu').hidden) renderRedeMenu();
}

// Tela inicial: a rede em uso, última sala e "Entrar numa sala" aberto ali mesmo
async function renderRadmin() {
  renderHomeForNetwork();
  if (selectedNetworkProvider() === 'internet') {
    const url = internetServerUrl();
    let host = '';
    try { host = url ? new URL(url).host : ''; } catch {}
    return setRedeTopo(!!url, 'Internet', !url ? 'sem servidor' : url === INTERNET_URL_PADRAO ? 'servidor da equipe' : host,
      url ? `Modo Internet · servidor ${url}` : 'Modo Internet sem servidor: coloque o endereço em Configurações › Rede');
  }
  if (selectedNetworkProvider() === 'razze') {
    let status;
    const prefs = networkPreferences();
    try { status = prefs.activeNetworkId ? await window.api.razzeWireGuardStatus(prefs.activeNetworkId) : null; } catch { status = null; }
    const ips = await window.api.getIps('razze').catch(() => []);
    const connected = !!status?.connected && ips.length > 0;
    return setRedeTopo(connected, 'Razze', connected ? ips[0].address : 'desconectada',
      connected ? `VPN Razze conectada · ${ips.map((item) => item.address).join(', ')}` : status?.error || 'VPN Razze desconectada: conecte uma rede');
  }
  let ips = [];
  try { ips = await window.api.getIps(); } catch {}
  if (window.api.platform === 'linux') { // a Radmin não existe no Linux: rede local, ou a Razze pela internet
    const lan = ips[0];
    return setRedeTopo(!!lan, 'Rede local', lan ? lan.address : 'sem rede',
      lan ? `Rede local · ${lan.address}. Pela internet, use a VPN Razze` : 'Sem rede: conecte o PC a uma rede');
  }
  const r = ips.find((i) => i.radmin);
  setRedeTopo(!!r, 'Radmin', r ? r.address : 'sem IP 26.x',
    r ? `Radmin VPN conectada · ${r.address}` : 'Radmin VPN não encontrada: ligue a Radmin e entre na rede');
}

// "Sala de Flyleaf · Última sala · ontem às 22h · Radmin" (sessoes.js › lembrarUltimaSala); o endereço ou o código
// vão na dica. Sem o nome guardado (sala antiga), mostra o endereço, como antes.
function quandoFoi(t) {
  const d = new Date(t), hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  const hora = `${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;
  if (d.toDateString() === hoje.toDateString()) return `hoje às ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem às ${hora}`;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// Só fora de sala (numa sala, ela é a faixa de cima). Se a última sala está aberta na lista, vira só informação
function renderLastRoom() {
  const last = load('roomAddr');
  $('lastRoom').hidden = !last || !!state.myId;
  let info = null;
  try { info = JSON.parse(load('ultimaSala', 'null')); } catch {}
  if (!info || info.endereco !== last || typeof info.host !== 'string' || !info.host) info = null;
  // Na lista pelo mesmo endereço, ou (a lista mostra o IP da rede, e o guardado pode ser outro, como 127.0.0.1) pelo
  // mesmo host na mesma porta
  const porta = Number(String(last).split(':')[1]);
  const naLista = !!last && sessoes.observando && listaSessoes().some((s) => s.codigo === last || `${s.endereco}:${s.porta}` === last
    || (!!info && s.host === info.host && s.porta === porta));
  $('rejoinBtn').hidden = naLista;
  $('lastRoom').classList.toggle('na-lista', naLista);
  $('lastRoomAddr').textContent = last;
  $('lastRoomName').textContent = info ? `Sala de ${info.host}` : 'Última sala';
  $('lastRoomMeta').textContent = info ? ['Última sala', Number.isFinite(info.quando) ? quandoFoi(info.quando) : '', SALA_MODO[info.modo] || '', naLista ? 'aberta na lista acima' : ''].filter(Boolean).join(' · ') : last;
  $('lastRoom').title = last;
}

function renderHome() {
  renderRadmin();
  renderLastRoom();
  renderHomeAmigos();
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
  $('appVersion').textContent = `Nebula ${v}`;
  showNewsIfNew();
  checkGithub();
});
$('showNews').onclick = () => setNewsOpen($('homeNews').hidden);
$('homeNovoFechar').onclick = () => { fecharNovo(); $('showNews').focus(); };
$('homeNovoTodas').onclick = () => { fecharNovo(); setNewsOpen(true); $('homeNewsClose').focus(); };
$('homeNewsClose').onclick = () => { setNewsOpen(false); $('showNews').focus(); };
$('checkUpdates').onclick = () => checkGithub(true);
// Topo do Início (docs/spec/inicio-novo.md): o painel da atualização e o menu da rede, um de cada vez
$('homeVersaoNova').onclick = () => setVersaoPainelOpen($('homeVersaoPainel').hidden);
$('homeVersaoEstado').onclick = () => setVersaoPainelOpen(true);
$('navUpdate').onclick = () => { show('home'); setVersaoPainelOpen(true); };
$('hvGo').onclick = runUpdate;
$('hvDepois').onclick = () => {
  update.dismissed = updateMode()?.version || '';
  setVersaoPainelOpen(false);
  renderUpdateBanner();
  $('homeVersaoEstado').focus();
};
$('homeRede').onclick = () => setRedeMenuOpen($('homeRedeMenu').hidden);
$('homeRedeAvancado').onclick = () => { setRedeMenuOpen(false); openGeneralSettings('network'); };
// Fecham com Esc (o foco volta ao botão), clique fora; no menu da rede, as setas andam entre as redes
for (const [pop, btn, fechar] of [['homeRedeMenu', 'homeRede', setRedeMenuOpen], ['homeVersaoPainel', 'homeVersaoNova', setVersaoPainelOpen]]) {
  $(pop).addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(false); $(btn).focus(); return; }
    if (pop !== 'homeRedeMenu' || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const itens = [...$('homeRedeOpcoes').querySelectorAll('button')];
    const i = itens.indexOf(document.activeElement);
    e.preventDefault();
    itens[(i + (e.key === 'ArrowDown' ? 1 : itens.length - 1)) % itens.length]?.focus();
  });
}
document.addEventListener('pointerdown', (e) => {
  if (!$('homeRedeMenu').hidden && !e.target.closest('#homeRedeMenu, #homeRede')) setRedeMenuOpen(false);
  if (!$('homeVersaoPainel').hidden && !e.target.closest('#homeVersaoPainel, #homeVersaoNova, #homeVersaoEstado, #navUpdate')) setVersaoPainelOpen(false);
});
// Quem deixa o app aberto também fica sabendo: procura de novo a cada 15 min, e também ao voltar para a janela se
// a última procura foi há mais de 15 min
let lastGithubCheck = Date.now();
const checkGithubSoon = () => {
  if (Date.now() - lastGithubCheck < 15 * 60 * 1000) return;
  lastGithubCheck = Date.now();
  checkGithub();
};
setInterval(checkGithubSoon, 60 * 1000);
window.addEventListener('focus', checkGithubSoon);

$('goCreate').onclick = () => foraDaSala('criar outra sala', () => show('create-room'));
setupRecorte(); // editor de recorte da foto e do fundo (renderer/recorte.js)
setupConta(); // senha e frase do perfil (renderer/conta.js)
setupAdmin(); // administração, só para administradores (renderer/admin.js)
setupFeedback(); // feedback e bugs, ícone na barrinha (renderer/feedback.js)
// Tela de carregando ao entrar na sala (renderer/sala.js): Cancelar ou Esc fecham a conexão que está esperando
$('entradaCancelar').onclick = cancelarEntrada;
$('entradaCarregando').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelarEntrada(); }
  else if (e.key === 'Tab') { e.preventDefault(); $('entradaCancelar').focus(); } // só tem o Cancelar
});
setupPrimeiraEntrada(); // primeira entrada e amigos no Início (renderer/primeira-entrada.js)
$('goJoin').onclick = () => foraDaSala('entrar em outra sala', () => setJoinOpen(true));
$('cancelJoin').onclick = () => setJoinOpen(false);
$('rejoinBtn').onclick = () => {
  $('roomAddr').value = load('roomAddr');
  setJoinOpen(true);
  joinRoom();
};
document.querySelectorAll('.back').forEach((b) => { b.onclick = () => show('home'); });

$('createBtn').onclick = createRoom;
// Sessões abertas: a lista chega do processo principal; a escolha de mostrar a sua fica guardada
window.api.onSessoes(onSessoesDaRede);
$('roomVisible').checked = load('sessaoVisivel', '1') !== '0';
$('roomVisible').onchange = () => save('sessaoVisivel', $('roomVisible').checked ? '1' : '0');
$('roomAmigosMembros').checked = load('salaAmigosMembros', '1') !== '0'; // modo Internet: passe da sala (salas-amigos.js)
$('roomAmigosMembros').onchange = () => save('salaAmigosMembros', $('roomAmigosMembros').checked ? '1' : '0');
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
// Resumo: a linha do som leva até o Som do PC (fica abaixo da Qualidade, fora da vista)
// (rola só a lista: scrollIntoView rolava também a sala e a janela saía do lugar)
$('shareSummaryMore').onclick = () => {
  const body = document.querySelector('.share-body');
  const top = body.scrollTop + $('soundGroup').getBoundingClientRect().top - body.getBoundingClientRect().top - 16;
  body.scrollTo({ top, behavior: 'smooth' });
  $('soundOn').focus({ preventScroll: true });
};
// Tem mais opções embaixo (Som do PC e Avançado): a borda de baixo da lista esmaece até chegar ao fim
(() => {
  const body = document.querySelector('.share-body');
  const hint = () => body.classList.toggle('more-below', body.scrollTop + body.clientHeight < body.scrollHeight - 4);
  body.addEventListener('scroll', hint, { passive: true });
  new ResizeObserver(hint).observe(body);
  new MutationObserver(hint).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
})();
$('startBtn').onclick = () => (state.shareSwitching ? switchSource() : startSharing());
$('switchShareBtn').onclick = () => openShareDialog(true);
setIcon($('switchShareBtn'), 'swap', 'Trocar a tela ou janela transmitida, sem parar');
setIcon($('stopShareBtn'), 'stop', 'Parar de transmitir');
$('shareOpenBtn').onclick = () => toggleShareOpenMenu();
document.addEventListener('pointerdown', (e) => { if ($('shareOpenMenu') && !e.target.closest('#shareOpenMenu, #shareOpenBtn')) toggleShareOpenMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('shareOpenMenu')) { toggleShareOpenMenu(false); $('shareOpenBtn').focus(); } });
$('refreshSources').onclick = loadSources;
$('refreshApps').onclick = loadAudioApps;
// Desempenho, no menu da sala: o ícone das Estatísticas com o nome
setIcon($('openStatsRoom'), 'stats', 'Estatísticas: desempenho do PC e a transmissão de cada pessoa');
$('openStatsRoom').append(rotuloMenu('Desempenho'));
$('openStatsRoom').onclick = openStats;
$('selfViewBtn').onclick = toggleSelfView;

// Chat
// Clicar fora fecha os balões da voz (o cartão de volume, que abre de dentro deles, conta como dentro)
document.addEventListener('mousedown', (e) => {
  if ($('voiceStackPop') && !e.target.closest('#voiceStackPop, #voiceAvatars, #personCard')) closeVoiceStackPop();
  if ($('voiceJoinPop') && !e.target.closest('#voiceJoinPop, #voiceJoinMore')) closeVoiceJoinPop();
});
$('chatJump').onclick = () => { scrollChatToEnd(); markRead(); };
$('chatList').addEventListener('scroll', () => { if (chatAtBottom() && chat.open && !document.hidden && !mapFocus.on) markRead(); else renderUnread(); });
// A barra de rolagem fica escondida e aparece enquanto rola (e com o mouse em cima, pelo CSS)
let chatScrollTimer = 0;
$('chatList').addEventListener('scroll', () => {
  $('chatList').classList.add('scrolling');
  clearTimeout(chatScrollTimer);
  chatScrollTimer = setTimeout(() => $('chatList').classList.remove('scrolling'), 900);
}, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && chat.open && chatAtBottom()) markRead(); });
$('dockAddr').onclick = async () => {
  try { await copiar(state.roomAddr); toast(state.cloud ? `Código copiado: ${state.roomAddr}. Mande junto com a senha para quem vai entrar.` : `Endereço copiado: ${state.roomAddr}. Mande para quem vai entrar.`); } catch { toast('Não foi possível copiar.', 'error'); }
};
setIcon($('pipChipClose'), 'close', 'Fechar as janelas flutuantes');
renderOverlayButton();
$('overlayToggle').onclick = toggleChatOverlay;
$('pipChipClose').onclick = () => { for (const id of [...state.pips.keys()]) closePip(id); };
setIcon($('chatAttach'), 'attach', 'Mandar arquivo (até 200 MB)');
setIcon($('chatSend'), 'send', 'Enviar');
$('chatForm').onsubmit = (e) => { e.preventDefault(); sendChat(); };
// Clicar na área vazia da linha de escrever (em volta do campo) põe o cursor no campo
$('chatForm').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) { e.preventDefault(); $('chatInput').focus(); } });
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
$('chatInput').addEventListener('input', fitChatInput);
$('chatAttach').onclick = () => $('chatFile').click();
document.addEventListener('paste', onChatPaste); // Ctrl+V com imagem ou arquivo: vai para o chat
$('chatFile').onchange = () => { stageFiles([...$('chatFile').files]); $('chatFile').value = ''; };
// Arrastar arquivo para o chat; fora dele, soltar um arquivo não faz a janela abrir o arquivo
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
$('chatTab').addEventListener('dragover', (e) => { e.preventDefault(); if (chat.supported) $('chatDrop').hidden = false; });
$('chatTab').addEventListener('dragleave', (e) => { if (!$('chatTab').contains(e.relatedTarget)) $('chatDrop').hidden = true; });
$('chatTab').addEventListener('drop', (e) => {
  e.preventDefault();
  $('chatDrop').hidden = true;
  stageFiles([...e.dataTransfer.files]);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('generalSettingsDialog').hidden) { if (!capturing) closeGeneralSettings(); } // trocando uma tecla, o Esc cancela só a troca
  else if (!$('personCard').hidden) closePersonCard();
  else if ($('voiceJoinPop')) { closeVoiceJoinPop(); $('voiceJoinMore').focus(); }
  else if ($('voiceStackPop')) { closeVoiceStackPop(); $('voiceAvatars').querySelector('.voice-stack')?.focus(); }
  else if (!$('voiceMapPop').hidden) closeSkyPop();
  else if (!$('dmPanel').hidden) { setDmPanel(false); $('dmBarLabel').focus(); }
  else if (!$('dmMoreMenu').hidden) { setDmMore(false); $('dmMore').focus(); }
  else if (!$('musicPop').hidden) closeMusicPop();
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

setupAmigos();
setupDm();
setupWorkspace();
startClips();
setupGeneralSettings();
setupComandoVoz();
setupPhone();
show('home');
