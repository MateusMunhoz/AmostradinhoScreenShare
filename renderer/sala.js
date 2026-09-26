'use strict';
// Criar, entrar e sair da sala, mensagens do servidor, sinalização e troca de host.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, rtc, voz, membros, assistir, overlay, chat, estatisticas, atualizacao, transmitir.

// ---------- Criar / entrar / sair da sala ----------
// Meus endereços (Radmin primeiro): a sala guarda para me achar se eu virar o host
async function myAddrs() {
  try {
    const ips = await window.api.getIps();
    return ips.map((i) => i.address);
  } catch { return []; }
}

async function connectRoom(url, hello, timeoutMs = 8000) {
  const addrs = await myAddrs();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let joined = false;
    let errMsg = null;
    const timer = setTimeout(() => {
      if (!joined) { errMsg = 'Tempo esgotado. Confira o endereço e se a Radmin VPN está ligada.'; ws.close(); }
    }, timeoutMs);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', ...hello, addrs, version: update.myVersion }));
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!joined) {
        if (m.type === 'welcome') { joined = true; clearTimeout(timer); state.ws = ws; resolve(m); }
        else if (m.type === 'error') errMsg = m.message;
        return;
      }
      onRoomMessage(m);
    };
    ws.onclose = (e) => {
      clearTimeout(timer);
      if (!joined) {
        reject(new Error(errMsg || 'Não foi possível conectar. Confira o endereço e se a Radmin VPN está ligada nos dois PCs.'));
      } else if (state.ws === ws) {
        // Sem quem roda o servidor, a sala passa para quem está nela há mais tempo
        if (e.reason !== 'room-closed' && state.handoff) migrateRoom(e.reason);
        else leaveRoom(e.reason === 'room-closed' ? 'O host encerrou a sala.' : 'A conexão com a sala caiu.', 'error');
      }
    };
  });
}

async function createRoom() {
  const port = parseInt($('roomPort').value, 10) || 8765;
  const password = $('roomPassword').value;
  save('roomPort', String(port));
  const btn = $('createBtn');
  setBusy(btn, true, 'Criando…');
  try {
    const res = await window.api.startServer(port, password);
    if (!res.ok) throw new Error(res.error);
    try {
      const welcome = await connectRoom(`ws://127.0.0.1:${port}`, { name: getName(), password });
      state.password = password;
      enterRoom(welcome, true, '127.0.0.1', port);
    } catch (err) {
      await window.api.stopServer();
      throw err;
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setBusy(btn, false, 'Criar sala');
  }
}

async function joinRoom() {
  const raw = $('roomAddr').value.trim().replace(/^ws:\/\//, '');
  if (!raw) return toast('Digite o endereço que aparece na tela de quem criou a sala.', 'error');
  const [host, portStr] = raw.split(':');
  const port = parseInt(portStr, 10) || 8765;
  save('roomAddr', raw);
  const btn = $('joinBtn');
  setBusy(btn, true, 'Entrando…');
  try {
    const welcome = await connectRoom(`ws://${host}:${port}`, { name: getName(), password: $('joinPassword').value });
    state.password = $('joinPassword').value;
    enterRoom(welcome, false, host, port);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setBusy(btn, false, 'Entrar');
  }
}

function enterRoom(welcome, owner, host, port) {
  state.myId = welcome.id;
  state.isOwner = owner;
  state.host = host;
  state.port = port;
  state.members.clear();
  for (const m of welcome.members) state.members.set(m.id, { name: m.name, sharing: m.sharing, version: m.version, addrs: m.addrs || [], shareInfo: m.shareInfo || null });
  state.hostId = welcome.hostId || null;
  state.handoff = (welcome.features || []).includes('handoff');
  state.order = [...welcome.members.map((m) => m.id), welcome.id];
  voice.reset(welcome);
  window.api.roomKeys(true).catch(() => {});
  renderLeaveBtn();
  resetChat(welcome);
  renderRoomAddress();
  renderMembers();
  renderShareBox();
  updateStage();
  show('room');
  perfStart();
  const live = welcome.members.filter((m) => m.sharing).length;
  if (live) toast(live === 1 ? '1 pessoa está transmitindo. Clique em Assistir para ver.' : `${live} pessoas estão transmitindo. Escolha quem assistir.`);
  checkUpdates();
}

// endRoom: o host encerra para todos; sem isso, ao sair ele passa a sala para quem está há mais tempo
function leaveRoom(reason, kind = 'info', endRoom = false) {
  if (!state.myId) return;
  voice.reset(null);
  const ws = state.ws;
  state.ws = null;
  state.migrating = false;
  clearTimeout(state.graceTimer);
  if (ws) { ws.onclose = null; ws.close(); }
  stopSharing();
  for (const id of [...state.in.keys()]) stopWatching(id, false);
  stopStats();
  closeStats();
  perfStop();
  if (state.isOwner) window.api.stopServer(endRoom);
  closeChatOverlay();
  closePersonCard();
  window.api.roomKeys(false).catch(() => {});
  resetChat(null);
  state.members.clear();
  state.myId = null;
  state.isOwner = false;
  state.hostId = null;
  state.order = [];
  closeShareDialog();
  $('closeDialog').hidden = true;
  if (update.busy) { clearTimeout(update.busy.timer); update.busy = null; }
  update.tried.clear();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  show('home');
  if (reason) toast(reason, kind);
}

function renderLeaveBtn() {
  const endsRoom = state.isOwner && !state.handoff;
  setIcon($('leaveBtn'), 'leave', endsRoom ? 'Encerrar sala (sai todo mundo)' : 'Sair da sala');
}

// Quem assume se o host sair: o mais antigo na sala (sem contar o host)
function successors() {
  return state.order.filter((id) => id !== state.hostId && (id === state.myId || state.members.has(id)));
}

// ---------- Troca de host ----------
// O servidor da sala roda no app do host. Se ele sai ou o app fecha, todo mundo calcula a mesma
// pessoa (a mais antiga): ela abre um servidor novo, na mesma porta, e os outros se conectam nela
// pelos endereços que ela tinha avisado. Cada um volta com o mesmo número, então as conexões diretas
// (quem assiste quem) continuam de pé e a tela não cai.
async function migrateRoom(reason) {
  const myId = state.myId;
  state.ws = null;
  state.migrating = true;
  const oldHost = state.hostId;
  const hostName = oldHost && oldHost !== myId ? nameOf(oldHost) : 'O host';
  // Talvez só a minha conexão tenha caído: tenta voltar para o mesmo host antes de trocar
  if (reason !== 'host-left' && !state.isOwner) {
    for (let i = 0; i < 2 && state.migrating; i++) {
      if (await rejoin(`${state.host}`, 2500)) return;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (!state.migrating || state.myId !== myId) return;
  if (oldHost && oldHost !== myId && state.members.has(oldHost)) onRoomMessage({ type: 'member-left', id: oldHost });
  state.hostId = null;
  const line = successors();
  toast(`${hostName} saiu. Passando a sala para ${line[0] === myId ? 'você' : nameOf(line[0])}…`);
  for (const id of line) {
    if (!state.migrating || state.myId !== myId) return;
    if (id === myId) {
      if (await becomeHost()) return;
      continue;
    }
    // Espera o próximo abrir a sala (até ~15 s), tentando cada endereço que ele avisou
    const addrs = (state.members.get(id)?.addrs || []).slice(0, 4);
    const until = Date.now() + 15000;
    while (Date.now() < until && state.migrating && state.members.has(id)) {
      for (const addr of addrs) if (await rejoin(addr, 2500)) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (state.migrating && state.myId === myId) leaveRoom('Não foi possível continuar a sala depois que o host saiu.', 'error');
}

async function becomeHost() {
  const known = [...state.members.keys(), state.myId].map(Number).filter(Number.isFinite);
  // Se o app do host acabou de cair, a porta pode levar um instante para ficar livre
  let res;
  for (let i = 0; i < 6; i++) {
    res = await window.api.startServer(state.port, state.password, { chat: chat.log, nextId: Math.max(0, ...known) + 1, hostId: state.myId });
    if (res.ok || !state.migrating) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!res.ok) { toast(res.error, 'error'); return false; }
  const ok = await rejoin('127.0.0.1', 4000);
  if (!ok) { await window.api.stopServer(); return false; }
  return true;
}

// Entra no servidor novo com o mesmo número e avisa se estou transmitindo
async function rejoin(host, timeoutMs) {
  const myId = state.myId;
  let welcome;
  try {
    welcome = await connectRoom(`ws://${host}:${state.port}`, {
      name: getName(), password: state.password, resume: myId, sharing: state.sharing, shareInfo: state.sharing ? state.shareInfo : undefined,
      voiceSession: voice.session || '', muted: voice.muted,
    }, timeoutMs);
  } catch { return false; }
  if (!state.migrating || state.myId !== myId) { state.ws?.close(); return false; }
  if (welcome.id !== myId) { // o servidor não aceitou o número: melhor sair do que misturar as conexões
    state.migrating = false;
    leaveRoom('Não foi possível continuar a sala depois que o host saiu.', 'error');
    return true;
  }
  state.migrating = false;
  const sameHost = !!state.hostId && state.hostId === welcome.hostId;
  state.isOwner = host === '127.0.0.1';
  state.host = host;
  state.hostId = welcome.hostId || null;
  state.handoff = (welcome.features || []).includes('handoff');
  if (!state.isOwner) save('roomAddr', `${host}:${state.port}`);
  const present = new Set(welcome.members.map((m) => m.id));
  for (const m of state.members.values()) delete m.back;
  for (const m of welcome.members) {
    const before = state.members.get(m.id);
    state.members.set(m.id, { name: m.name, sharing: m.sharing, version: m.version, addrs: m.addrs || [], shareInfo: m.shareInfo || null, back: true });
    if (!state.order.includes(m.id)) state.order.push(m.id);
    if (before && before.sharing && !m.sharing) stopWatching(m.id, false);
    voice.update(m.id, m.voiceSession || '', !!m.muted);
  }
  // Quem ainda não voltou tem um tempo para voltar; depois disso, conta como quem saiu
  clearTimeout(state.graceTimer);
  state.graceTimer = setTimeout(() => {
    for (const id of [...state.members.keys()]) {
      if (!state.members.get(id).back) onRoomMessage({ type: 'member-left', id });
    }
  }, 20000);
  renderLeaveBtn();
  renderRoomAddress();
  renderMembers();
  renderShareBox();
  updateStage();
  toast(sameHost ? 'Conexão com a sala de volta.' : state.isOwner ? 'Você agora é o host da sala.' : `${nameOf(state.hostId)} agora é o host da sala.`);
  return true;
}

function onRoomMessage(m) {
  switch (m.type) {
    case 'member-joined': {
      // Quem volta depois da troca de host continua de onde estava (mesmo número, mesmas conexões)
      const back = state.members.get(m.id);
      state.members.set(m.id, { name: m.name, sharing: !!m.sharing, version: m.version, addrs: m.addrs || [], shareInfo: m.shareInfo || null, back: true });
      if (!state.order.includes(m.id)) state.order.push(m.id);
      if (back && back.sharing && !m.sharing) stopWatching(m.id, false);
      voice.update(m.id, m.voiceSession || '', !!m.muted);
      renderMembers();
      updateStage();
      if (!back) toast(`${m.name} entrou na sala`);
      checkUpdates();
      break;
    }
    case 'member-left': {
      const name = nameOf(m.id);
      state.order = state.order.filter((id) => id !== m.id);
      voice.remove(m.id);
      if (update.busy?.from === m.id) cancelDownload();
      chatMemberLeft(m.id);
      closeOut(m.id);
      stopWatching(m.id, false);
      state.members.delete(m.id);
      renderMembers();
      updateStage();
      toast(`${name} saiu da sala`);
      break;
    }
    case 'share-state': {
      const mem = state.members.get(m.id);
      if (!mem) return;
      const started = m.sharing && !mem.sharing; // com sharing de novo, é só a configuração que mudou
      mem.sharing = m.sharing;
      mem.shareInfo = m.sharing ? m.info || null : null;
      if (started) toast(`${mem.name} começou a transmitir`);
      else if (!m.sharing) stopWatching(m.id, false);
      renderMembers();
      updateStage();
      break;
    }
    case 'voice-state':
      if (m.id === state.myId || state.members.has(m.id)) voice.update(m.id, m.session, m.muted);
      break;
    case 'signal':
      handleSignal(m.from, m.data || {});
      break;
    case 'chat':
      onChatMessage(m);
      break;
  }
}

// Cada par de PCs pode ter duas conexões (eu assisto você e você me assiste).
// O campo "side" diz de qual lado da conexão veio a mensagem.
function handleSignal(from, data) {
  if (data.side === 'voice') return voice.receive(from, data);
  if (data.side === 'viewer') {
    // Mensagem de alguém que assiste (ou quer assistir) a minha tela
    if (data.subscribe) return addWatcher(from, data.once === true);
    if (data.unsubscribe) return closeOut(from);
    const link = state.out.get(from);
    if (!link) return;
    if (typeof data.video === 'boolean') {
      link.videoOff = !data.video;
      onceVideoChanged(link);
      renderWatchers();
      link.chain = link.chain.then(() => applyBitrate(link)).catch(console.error);
      return;
    }
    link.chain = link.chain.then(async () => {
      if (data.sdp) {
        await link.pc.setRemoteDescription({ type: data.sdp.type, sdp: enhanceOpus(data.sdp.sdp) });
        await applyBitrate(link);
      } else if (data.candidate) {
        await link.pc.addIceCandidate(data.candidate);
      }
    }).catch(console.error);
  } else if (data.side === 'update') {
    onUpdateSignal(from, data);
  } else if (data.side === 'file') {
    onFileSignal(from, data);
  } else if (data.side === 'sharer') {
    // Mensagem de quem transmite uma tela que eu pedi para assistir
    const link = state.in.get(from);
    if (!link) return;
    if (data.unavailable) {
      stopWatching(from, false);
      return toast(`${nameOf(from)} não está mais transmitindo.`);
    }
    link.chain = link.chain.then(async () => {
      if (data.sdp) {
        await link.pc.setRemoteDescription(data.sdp);
        await link.pc.setLocalDescription(await link.pc.createAnswer());
        sendSignal(from, { side: 'viewer', sdp: link.pc.localDescription });
      } else if (data.candidate) {
        await link.pc.addIceCandidate(data.candidate);
      }
    }).catch(console.error);
  }
}

// Pedaços grandes pela sala (atualizações e arquivos do chat): sem pausa fixa entre as partes, porque com a
// janela minimizada o Chromium atrasa timers para 1 por segundo. Só espera se a conexão estiver muito cheia.
async function waitRoomBuffer() {
  while (state.ws && state.ws.bufferedAmount > 1_000_000) await new Promise((r) => setTimeout(r, 50));
}
