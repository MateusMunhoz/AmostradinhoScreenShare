'use strict';
// Criar, entrar e sair da sala, mensagens do servidor, sinalização e troca de host.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, rtc, voz, membros, assistir, overlay, chat, estatisticas, atualizacao, transmitir.

// ---------- Criar / entrar / sair da sala ----------
// Meus endereços (Radmin primeiro): a sala guarda para me achar se eu virar o host
async function myAddrs() {
  try {
    const provider = selectedNetworkProvider();
    if (provider === 'internet') return []; // pela internet ninguém precisa (nem deve ver) os IPs da sua casa
    const ips = await window.api.getIps(provider);
    if (provider === 'razze') return ips.filter((i) => i.razze).map((i) => i.address);
    return ips.map((i) => i.address);
  } catch { return []; }
}

// Código fixo deste PC (não identifica ninguém fora da sala): o servidor usa para derrubar uma conexão antiga
// do mesmo PC que tenha ficado aberta, em vez de mostrar a pessoa repetida
function clientId() {
  let id = load('clientId', '');
  if (!/^[a-f0-9]{32}$/.test(id)) { id = crypto.randomUUID().replace(/-/g, ''); save('clientId', id); }
  return id;
}

async function connectRoom(url, hello, timeoutMs = 8000) {
  const addrs = await myAddrs();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let joined = false;
    let errMsg = null;
    const timer = setTimeout(() => {
      if (!joined) { errMsg = 'Tempo esgotado. Confira o endereço e se a VPN ou rede escolhida está conectada.'; ws.close(); }
    }, timeoutMs);

    ws.onopen = () => {
      const razze = contaSala(); // a conta Razze (perfil e Adicionar dos outros)
      contaAnunciada = JSON.stringify(razze);
      ws.send(JSON.stringify({ type: 'hello', ...hello, client: clientId(), addrs, version: update.myVersion, avatar: fotos.mine?.hash || '', avatarFull: fotos.mineFull?.hash || '', nameFont: appPreferences.nameFont, razze }));
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!joined) {
        // "Pode entrar" depois de já ter desistido (tempo esgotado): fecha, senão fica um fantasma na sala
        if (m.type === 'welcome' && errMsg) { ws.close(); return; }
        if (m.type === 'welcome') {
          joined = true; clearTimeout(timer);
          // Conexão anterior ainda aberta (entrada que falhou no meio): fecha antes de usar a nova
          if (state.ws && state.ws !== ws && state.ws.readyState <= WebSocket.OPEN) { const old = state.ws; state.ws = null; old.onclose = null; old.close(); }
          state.ws = ws; resolve(m);
        }
        else if (m.type === 'error') errMsg = m.message;
        return;
      }
      onRoomMessage(m);
    };
    ws.onclose = (e) => {
      clearTimeout(timer);
      if (!joined) {
        reject(new Error(errMsg || (state.cloud || selectedNetworkProvider() === 'internet'
          ? 'Não foi possível falar com o servidor. Confira o endereço na aba Rede e a sua internet.'
          : 'Não foi possível conectar. Confira o endereço e se a Radmin VPN está ligada nos dois PCs.')));
      } else if (state.ws === ws) {
        // Sem quem roda o servidor, a sala passa para quem está nela há mais tempo.
        // No modo Internet o servidor continua de pé: só a minha conexão caiu, então volto para ele.
        if (e.reason !== 'room-closed' && (state.handoff || state.cloud)) migrateRoom(e.reason);
        else leaveRoom(e.reason === 'room-closed' ? 'O host encerrou a sala.' : 'A conexão com a sala caiu.', 'error');
      }
    };
  });
}

// A sala disse "pode entrar", mas deu erro antes de abrir a tela da sala: fecha a conexão (senão ela fica
// aberta, respondendo ao servidor, e você aparece repetido na lista dos outros)
function dropHalfJoin() {
  const ws = state.ws;
  state.ws = null;
  state.myId = null;
  if (ws) { ws.onclose = null; try { ws.close(); } catch {} }
}

async function createRoom() {
  if (state.myId) return toast('Você já está numa sala. Volte para ela e saia antes de entrar em outra.', 'error');
  if (state.abrindo) return; // clique duplo: o segundo servidor derrubaria o primeiro
  const port = parseInt($('roomPort').value, 10) || 8765;
  const password = $('roomPassword').value;
  save('roomPort', String(port));
  const btn = $('createBtn');
  setBusy(btn, true, 'Criando…');
  setAbrindoSala(true);
  try {
    await requireSelectedNetwork();
    if (selectedNetworkProvider() === 'internet') {
      if (password.length < 4) throw new Error('No modo Internet a sala precisa de senha (mínimo 4 caracteres).');
      const url = internetServerUrl();
      const welcome = await connectRoom(url, { name: getName(), password, create: true });
      state.password = password;
      // criador + amigos: anuncia a sala aos amigos do Razze (salas-amigos.js), se a caixinha estiver marcada
      try { enterRoom(welcome, false, url, 0, { url, code: welcome.sala, criador: true, amigos: $('roomVisible').checked }); }
      catch (err) { dropHalfJoin(); throw err; }
      return;
    }
    // A sessão aparece para quem está na rede, menos se você desmarcou (e continua assim numa troca de host)
    const res = await window.api.startServer(port, password, { sessao: { oculta: !$('roomVisible').checked } }, selectedNetworkProvider());
    if (!res.ok) throw new Error(res.error);
    try {
      const welcome = await connectRoom(`ws://127.0.0.1:${port}`, { name: getName(), password });
      state.password = password;
      enterRoom(welcome, true, '127.0.0.1', port);
    } catch (err) {
      dropHalfJoin();
      await window.api.stopServer();
      throw err;
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setBusy(btn, false, 'Criar sala');
    setAbrindoSala(false);
  }
}
// Enquanto o servidor de uma sala abre, os botões de abrir ou entrar do Início ficam desativados
function setAbrindoSala(on) {
  state.abrindo = on;
  renderHomeCall();
}

async function joinRoom() {
  if (state.myId) return toast('Você já está numa sala. Volte para ela e saia antes de entrar em outra.', 'error');
  if (selectedNetworkProvider() === 'internet') return joinInternetRoom();
  const raw = $('roomAddr').value.trim().replace(/^ws:\/\//, '');
  if (!raw) return toast('Digite o endereço que aparece na tela de quem criou a sala.', 'error');
  const [host, portStr] = raw.split(':');
  const port = parseInt(portStr, 10) || 8765;
  save('roomAddr', raw);
  const btn = $('joinBtn');
  setBusy(btn, true, 'Entrando…');
  try {
    await requireSelectedNetwork();
    const welcome = await connectRoom(`ws://${host}:${port}`, { name: getName(), password: $('joinPassword').value });
    state.password = $('joinPassword').value;
    try { enterRoom(welcome, false, host, port); }
    catch (err) { dropHalfJoin(); throw err; }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setBusy(btn, false, 'Entrar');
  }
}

// Modo Internet: entra pelo código da sala, no servidor da aba Rede
async function joinInternetRoom() {
  const code = $('roomAddr').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) return toast('Digite o código de 6 letras e números que quem criou a sala passou.', 'error');
  $('roomAddr').value = code;
  save('roomAddr', code);
  const btn = $('joinBtn');
  setBusy(btn, true, 'Entrando…');
  try {
    // Sala de amigo que pediu a senha: o servidor é o dela, não precisa ser o da aba Rede
    const url = servidorDoCodigo(code) || internetServerUrl();
    if (!servidorDoCodigo(code)) await requireSelectedNetwork();
    const password = $('joinPassword').value;
    const welcome = await connectRoom(url, { name: getName(), password, room: code });
    state.password = password;
    try { enterRoom(welcome, false, url, 0, { url, code: welcome.sala || code }); }
    catch (err) { dropHalfJoin(); throw err; }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setBusy(btn, false, 'Entrar');
  }
}

// cloud: modo Internet ({ url, code }); a lista de STUN/TURN vem do servidor, só para esta sala
function enterRoom(welcome, owner, host, port, cloud = null) {
  state.cloud = cloud;
  if (cloud) cloud.passeOn = (welcome.features || []).includes('passe'); // servidor antigo: os amigos entram com a senha
  salasAmigos.alvo = null;
  RTC_CONFIG.iceServers = cloud && Array.isArray(welcome.iceServers) ? welcome.iceServers : [];
  state.myId = welcome.id;
  state.isOwner = owner;
  state.host = host;
  state.port = port;
  state.members.clear();
  resetBiosDaSala();
  resetAtvDaSala();
  resetProfileBgs(); // os ids são da sala: o que sabia do fundo de cada um não vale na próxima (fundo-perfil.js)
  for (const m of welcome.members) state.members.set(m.id, { name: m.name, sharing: m.sharing, version: m.version, addrs: m.addrs || [], shareInfo: m.shareInfo || null, avatar: m.avatar || '', avatarFull: m.avatarFull || '', nameFont: AppPreferences.cleanNameFont(m.nameFont), razze: limparContaSala(m.razze) });
  state.hostId = welcome.hostId || null;
  state.handoff = (welcome.features || []).includes('handoff');
  state.sessao = welcome.sessao || null;
  state.subsalas = (welcome.features || []).includes('subsalas') && Array.isArray(welcome.subsalas) ? welcome.subsalas : null;
  state.subsalaMove = (welcome.features || []).includes('subsala-move');
  state.musicaOn = (welcome.features || []).includes('musica');
  state.senhaOn = (welcome.features || []).includes('senha'); // o servidor sabe mudar a senha da sala
  state.order = [...welcome.members.map((m) => m.id), welcome.id];
  lembrarDaSala();
  lembrarUltimaSala();
  voice.reset(welcome);
  setMusicas(state.musicaOn ? welcome.musicas : [], welcome.now, true); // as músicas que já estavam tocando na sala
  window.api.roomKeys(true).then(syncComandoVozTecla, () => {});
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
  void appSounds.play('enter'); // você entrou
  registrarPasseSala();
  publicarSalaInternet();
}

// endRoom: o host encerra para todos; sem isso, ao sair ele passa a sala para quem está há mais tempo
function leaveRoom(reason, kind = 'info', endRoom = false) {
  if (!state.myId) return;
  void appSounds.play('leave');
  voice.reset(null);
  const ws = state.ws;
  state.ws = null;
  state.migrating = false;
  clearTimeout(state.graceTimer);
  if (ws) {
    ws.onclose = null;
    // Modo Internet: avisa o servidor que saí de propósito (senão ele espera um pouco achando que a internet caiu)
    if (state.cloud && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: 'leave' })); } catch {} }
    ws.close();
  }
  stopSharing();
  for (const id of [...state.in.keys()]) stopWatching(id, false);
  clearMusicas();
  stopStats();
  closeStats();
  perfStop();
  if (state.isOwner) window.api.stopServer(endRoom);
  retirarSalaInternet();
  retirarSalaAtual();
  closeChatOverlay();
  closePersonCard();
  window.api.roomKeys(false).catch(() => {}); // solta também a tecla do comando de voz
  resetChat(null);
  state.members.clear();
  state.myId = null;
  state.isOwner = false;
  state.hostId = null;
  state.cloud = null;
  state.subsalas = null;
  state.subsalaMove = false;
  state.musicaOn = false;
  RTC_CONFIG.iceServers = [];
  state.order = [];
  state.rewatch.clear();
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

// Quem assume se o host sair: o mais antigo na sala (sem contar o host). Vai pelo número de cada um, que segue a
// ordem de chegada e não muda quando a pessoa cai e volta: assim todo PC calcula a mesma fila. A ordem em que cada
// PC viu as pessoas entrarem (state.order) muda depois de uma volta, e a sala se dividia em duas.
function successors() {
  return state.order.filter((id) => id !== state.hostId && (id === state.myId || state.members.has(id)))
    .sort((a, b) => Number(a) - Number(b));
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
  if (state.cloud) return reconnectCloud(myId);
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
  // Eu era o host e caiu a conexão com o meu próprio servidor: volto para ele. Se ele parou e eu estou sozinho,
  // abro de novo; com mais gente, sigo a troca normal (os outros já estão indo para o próximo da fila)
  if (oldHost === myId) {
    for (let i = 0; i < 2 && state.migrating; i++) {
      if (await rejoin('127.0.0.1', 2500)) return;
      await new Promise((r) => setTimeout(r, 800));
    }
    if (!state.migrating || state.myId !== myId) return;
    if (!successors().some((id) => id !== myId) && await becomeHost()) return;
    if (!state.migrating || state.myId !== myId) return;
  }
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

// Modo Internet: a conexão com o servidor caiu (internet piscou). O servidor guarda o meu lugar por uns
// segundos; volto com o mesmo número e as conexões diretas (quem assiste quem) continuam de pé.
async function reconnectCloud(myId) {
  toast('A conexão com o servidor caiu. Tentando voltar…');
  const until = Date.now() + 18000;
  while (Date.now() < until && state.migrating && state.myId === myId) {
    if (await rejoin(state.cloud.url, 3000)) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (state.migrating && state.myId === myId) leaveRoom('A conexão com o servidor caiu e não voltou.', 'error');
}

async function becomeHost() {
  const known = [...state.members.keys(), state.myId].map(Number).filter(Number.isFinite);
  // Se o app do host acabou de cair, a porta pode levar um instante para ficar livre
  let res;
  for (let i = 0; i < 6; i++) {
    // O modo da rede vai junto: sala da Razze continua só para quem está na Razze depois que o host muda
    res = await window.api.startServer(state.port, state.password, { chat: chat.log, nextId: Math.max(0, ...known) + 1, hostId: state.myId, sessao: state.sessao, subsalas: state.subsalas || [], musicas: musicSeed() }, selectedNetworkProvider());
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
    welcome = await connectRoom(state.cloud ? state.cloud.url : `ws://${host}:${state.port}`, {
      name: getName(), password: state.password, resume: myId, sharing: state.sharing, shareInfo: state.sharing ? state.shareInfo : undefined,
      room: state.cloud ? state.cloud.code : undefined, passe: state.cloud?.passe || undefined,
      voiceSession: voice.session || '', voiceChannel: voice.channel, muted: voice.muted, deafened: voice.deafened,
    }, timeoutMs);
  } catch { return false; }
  if (!state.migrating || state.myId !== myId) { state.ws?.close(); return false; }
  if (welcome.id !== myId) { // o servidor não aceitou o número: melhor sair do que misturar as conexões
    state.migrating = false;
    leaveRoom('Não foi possível continuar a sala depois que o host saiu.', 'error');
    return true;
  }
  state.migrating = false;
  const sameHost = state.cloud ? true : !!state.hostId && state.hostId === welcome.hostId;
  state.isOwner = !state.cloud && host === '127.0.0.1';
  state.host = host;
  if (state.cloud && Array.isArray(welcome.iceServers)) RTC_CONFIG.iceServers = welcome.iceServers; // acesso ao TURN renovado
  if (state.cloud) { state.cloud.passeOn = (welcome.features || []).includes('passe'); registrarPasseSala(); }
  state.hostId = welcome.hostId || null;
  state.handoff = (welcome.features || []).includes('handoff');
  state.sessao = welcome.sessao || state.sessao;
  state.subsalaMove = (welcome.features || []).includes('subsala-move');
  state.musicaOn = (welcome.features || []).includes('musica');
  state.senhaOn = (welcome.features || []).includes('senha'); // o servidor sabe mudar a senha da sala
  setSubsalas((welcome.features || []).includes('subsalas') ? welcome.subsalas : null);
  setMusicas(state.musicaOn ? welcome.musicas : [], welcome.now);
  if (state.musicaOn) resendListening();
  if (!state.isOwner && !state.cloud) save('roomAddr', `${host}:${state.port}`);
  const present = new Set(welcome.members.map((m) => m.id));
  for (const m of state.members.values()) delete m.back;
  for (const m of welcome.members) {
    const before = state.members.get(m.id);
    state.members.set(m.id, { name: m.name, sharing: m.sharing, version: m.version, addrs: m.addrs || [], shareInfo: m.shareInfo || null, avatar: m.avatar || '', avatarFull: m.avatarFull || '', nameFont: AppPreferences.cleanNameFont(m.nameFont), razze: limparContaSala(m.razze), back: true });
    if (!state.order.includes(m.id)) state.order.push(m.id);
    if (before && before.sharing && !m.sharing) stopWatching(m.id, false);
    voice.update(m.id, m.voiceSession || '', !!m.muted, !!m.deafened, m.voiceChannel);
  }
  // Quem ainda não voltou tem um tempo para voltar; depois disso, conta como quem saiu
  clearTimeout(state.graceTimer);
  state.graceTimer = setTimeout(() => {
    for (const id of [...state.members.keys()]) {
      if (!state.members.get(id).back) onRoomMessage({ type: 'member-left', id });
    }
  }, 20000);
  resendIncomingVideo(); // quem já voltou recebe agora; quem ainda está voltando, no member-joined
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
      state.members.set(m.id, { name: m.name, sharing: !!m.sharing, version: m.version, addrs: m.addrs || [], shareInfo: m.shareInfo || null, avatar: m.avatar || '', avatarFull: m.avatarFull || '', nameFont: AppPreferences.cleanNameFont(m.nameFont), razze: limparContaSala(m.razze), back: true });
      if (!state.order.includes(m.id)) state.order.push(m.id);
      if (back && back.sharing && !m.sharing) stopWatching(m.id, false);
      voice.update(m.id, m.voiceSession || '', !!m.muted, !!m.deafened, m.voiceChannel);
      // Caiu da sala enquanto eu assistia e voltou transmitindo em até 1 min: volta a assistir sozinho
      const caiu = state.rewatch.get(m.id);
      state.rewatch.delete(m.id);
      if (caiu && m.sharing && Date.now() - caiu < 60000 && !state.in.has(m.id)) setTimeout(() => watch(m.id), 300);
      if (back) resendIncomingVideo(m.id); // voltou à sala: o aviso de vídeo pode ter se perdido enquanto ela estava fora
      renderMembers();
      updateStage();
      if (!back && !m.resumed) void appSounds.play('join');
      if (!back) toast(`${m.name} entrou na sala`);
      checkUpdates();
      publicarSalaInternet();
      break;
    }
    case 'member-left': {
      if (state.members.has(m.id)) void appSounds.play('leave');
      if (state.in.has(m.id) && !state.in.get(m.id).self) state.rewatch.set(m.id, Date.now());
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
      publicarSalaInternet();
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
      renderTileAudio(m.id); // a configuração pode ter mudado (com ou sem som)
      renderMembers();
      updateStage();
      break;
    }
    case 'avatar-state':
      onAvatarState(m.id, m.hash, m.full);
      break;
    case 'razze-state': {
      const mem = state.members.get(m.id);
      if (!mem) break;
      mem.razze = limparContaSala(m.conta);
      mixer.apply(m.id); // o volume é guardado pela conta (voz.js › volKey): pode ter mudado
      applyScreenVolume(m.id);
      renderMembers();
      if (typeof renderPersonCard === 'function') renderPersonCard();
      if (typeof skyFocusKey !== 'undefined') { skyFocusKey = ''; if (typeof renderSkyProfile === 'function') renderSkyProfile(); }
      break;
    }
    case 'name-font-state': {
      const mem = state.members.get(m.id);
      if (!mem) break;
      mem.nameFont = AppPreferences.cleanNameFont(m.font);
      repaintNames(m.id);
      break;
    }
    case 'voice-state':
      if (m.id === state.myId || state.members.has(m.id)) voice.update(m.id, m.session, m.muted, m.deafened, m.channel);
      break;
    case 'subsalas':
      setSubsalas(m.list);
      break;
    case 'musicas':
      setMusicas(m.list, m.now);
      break;
    case 'musica-erro':
      toast(m.text, 'error');
      break;
    case 'signal':
      handleSignal(m.from, m.data || {});
      break;
    case 'chat':
      onChatMessage(m);
      break;
    case 'senha': // o host mudou a senha da sala (chamada.js)
      receberSenha(m);
      break;
    case 'senha-erro':
      toast(String(m.message || 'Não foi possível mudar a senha.').slice(0, 200), 'error');
      break;
    case 'host': // modo Internet: o host saiu e outro assumiu
      if (m.id === state.myId || state.members.has(m.id)) { state.hostId = m.id; renderMembers(); renderRoomAddress(); }
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
    if (data.restart) return scheduleIceRestart(from, link, 0); // quem assiste perdeu a conexão
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
  } else if (data.side === 'foto') {
    onPhotoSignal(from, data);
  } else if (data.side === 'fundo') {
    onProfileBgSignal(from, data).catch(console.error);
  } else if (data.side === 'bio') {
    onBioSignal(from, data);
  } else if (data.side === 'atv') {
    onAtvSignal(from, data); // o jogo e a música do perfil (conta.js)
  } else if (data.side === 'atvh') {
    onAtvhSignal(from, data); // os últimos jogos e músicas, para o perfil (conta.js)
  } else if (data.side === 'sharer') {
    // Mensagem de quem transmite uma tela que eu pedi para assistir
    const link = state.in.get(from);
    if (!link) return;
    if (data.unavailable) {
      stopWatching(from, false);
      if (data.closed) return toast(closedShareText(from));
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
