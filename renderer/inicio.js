'use strict';
// Tela inicial e a partida do app: liga os botões e listeners, carrega as preferências e mostra o início.
// Roda por último (todos os outros scripts já definiram o que ele usa).

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
closeOnBackdrop('voiceDialog', closeVoiceDialog);
closeOnBackdrop('statsDialog', closeStats);

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
