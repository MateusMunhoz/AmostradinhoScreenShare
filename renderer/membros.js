'use strict';
// Painel da sala: endereço, lista de pessoas e o texto da área vazia.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, tema, voz, assistir, chat.

// ---------- Painel da sala ----------
async function renderRoomAddress() {
  const box = $('roomAddress');
  box.innerHTML = '';
  let addrs;
  if (state.cloud) { // modo Internet: quem entra só precisa do código (e da senha)
    $('noRadmin').hidden = true;
    addrs = [state.cloud.code];
  } else if (state.isOwner) {
    const provider = selectedNetworkProvider();
    const ips = await window.api.getIps(provider);
    const preferred = provider === 'razze' ? ips.filter((i) => i.razze) : ips.filter((i) => i.radmin);
    $('noRadmin').hidden = preferred.length > 0;
    $('noRadmin').textContent = provider === 'razze'
      ? 'Nenhum IP da VPN Razze foi encontrado. Conecte uma rede na aba Rede (no HUB, à esquerda).'
      : 'Nenhum IP da Radmin VPN (26.x.x.x) encontrado. Ligue a Radmin e entre na rede.';
    const usable = provider === 'razze' ? preferred : (preferred.length ? preferred : ips);
    addrs = usable.map((i) => `${i.address}:${state.port}`);
  } else {
    $('noRadmin').hidden = true;
    addrs = [`${state.host}:${state.port}`];
  }
  for (const addr of addrs) {
    const row = document.createElement('div');
    row.className = 'addr';
    const code = document.createElement('code');
    code.textContent = addr;
    const copy = document.createElement('button');
    copy.className = 'btn small';
    copy.textContent = 'Copiar';
    copy.onclick = async () => {
      try {
        await copiar(addr);
        copy.textContent = 'Copiado';
        setTimeout(() => { copy.textContent = 'Copiar'; }, 1500);
      } catch { toast('Não foi possível copiar. Selecione o endereço e use Ctrl+C.', 'error'); }
    };
    row.append(code, copy);
    box.append(row);
  }
  state.roomAddr = addrs[0] || '';
  $('dockAddr').hidden = !state.roomAddr;
  $('dockAddr').title = state.cloud
    ? `Copiar o código da sala para convidar alguém: ${state.roomAddr}`
    : `Copiar o endereço da sala para convidar alguém: ${state.roomAddr}`;
}

function memberRow(id, name, sharing) {
  const who = id || state.myId;
  const li = document.createElement('li');
  li.className = 'member' + (sharing ? ' live' : '');
  li.style.setProperty('--person', personColor(id));
  li.dataset.person = who;
  li.classList.toggle('speaking', speaking.has(who));
  const dot = markProfile(avatar(id ? name : getName(), id), id, name);
  const info = document.createElement('div');
  info.className = 'info';
  const nameEl = document.createElement('span');
  nameEl.className = 'mname';
  nameEl.textContent = name;
  paintName(nameEl, id);
  markProfile(nameEl, id, name);
  nameEl.append(speakBars());
  const status = document.createElement('span');
  status.className = 'mstatus';
  const paused = id && state.focus && state.focus !== id && state.in.has(id);
  const inPip = id && state.pips.has(id);
  const voiceOn = inVoice(who);
  li.classList.toggle('in-voice', voiceOn); // no painel de voz, a linha abre o perfil do mapa (ceu-voz.js)
  const micOff = voiceOn && (id ? !!voice.members.get(id)?.muted : voice.muted);
  // Fone silenciado ("Silenciar vozes"): a pessoa não está ouvindo ninguém
  const deafOn = voiceOn && (id ? !!voice.members.get(id)?.deafened : voice.deafened);
  const parts = [];
  if (sharing) parts.push(inPip ? 'Transmitindo · na janela flutuante' : paused ? 'Transmitindo, em pausa para você' : 'Transmitindo');
  // Na voz não vira texto: os ícones de microfone e fone desligados (logo abaixo) já dizem
  status.textContent = parts.join(' · ') || (voiceOn ? '' : 'Na sala');
  status.hidden = !status.textContent;
  info.append(nameEl, status);
  // Host: uma coroinha no canto do avatar; com o mouse em cima, aparece "Host" (CSS)
  let face = dot;
  if (who === state.hostId) {
    face = document.createElement('span');
    face.className = 'member-face is-host';
    const crown = document.createElement('span');
    crown.className = 'host-badge';
    crown.setAttribute('role', 'img');
    crown.setAttribute('aria-label', 'Host');
    crown.innerHTML = ICON.crown;
    face.append(dot, crown);
  }
  li.append(face, info);
  for (const [on, icon, title] of [[micOff, 'micOff', 'Microfone desligado'], [deafOn, 'headphonesOff', 'Fone silenciado: não está ouvindo a voz']]) {
    if (!on) continue;
    const mo = document.createElement('span');
    mo.className = 'mic-off-icon';
    mo.innerHTML = ICON[icon];
    mo.title = title;
    li.append(mo);
  }

  // Volume dessa pessoa para você (voz e/ou transmissão); mostra o valor quando não está no padrão
  if (id && (voiceOn || state.in.has(id))) {
    const v = volOf(id);
    const changed = v.muted || v.voice !== DEFAULT_VOICE || v.screen !== DEFAULT_SCREEN;
    const vb = document.createElement('button');
    vb.type = 'button';
    vb.className = 'btn small vol-btn' + (changed ? ' changed' : '');
    vb.innerHTML = v.muted ? ICON.muted : ICON.volume;
    const badge = v.muted ? 'mudo' : voiceOn && v.voice !== DEFAULT_VOICE ? `${v.voice}%` : !voiceOn && v.screen !== DEFAULT_SCREEN ? `${v.screen}%` : '';
    if (badge) vb.append(badge);
    const label = `Volume de ${name}${v.muted ? ' (silenciada para você)' : badge ? ` (${badge})` : ''}`;
    vb.title = label;
    vb.setAttribute('aria-label', label);
    vb.setAttribute('aria-expanded', String($('personCard').dataset.for === id && !$('personCard').hidden));
    vb.onclick = (e) => openPersonCard(id, vb, e.detail === 0);
    onWheelVolume(vb, id, () => (inVoice(id) ? 'voice' : 'screen')); // na voz, a roda muda a voz
    li.append(vb);
  }

  if (!id && sharing && state.myId) {
    const watching = state.in.has(state.myId);
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = watching ? 'Parar de ver' : 'Ver';
    btn.title = watching ? 'Tirar a sua tela da sala' : 'Ver a sua própria transmissão, como um quadro na sala';
    btn.onclick = toggleSelfView;
    li.append(btn);
  }

  if (id && sharing) {
    const watching = state.in.has(id);
    const btn = document.createElement('button');
    btn.className = watching ? 'btn small' : 'btn small primary';
    btn.textContent = watching ? 'Parar' : 'Assistir';
    btn.onclick = () => (watching ? stopWatching(id) : watch(id));
    if (!watching && !canWatch(id)) { btn.disabled = true; btn.title = closedShareText(id); }
    li.append(btn);
  }
  return li;
}

function renderMembers() {
  const list = $('members');
  list.innerHTML = '';
  $('memberCount').textContent = $('memberTitleCount').textContent = state.members.size + 1;
  $('peopleBtn').setAttribute('aria-label', `Pessoas na sala (${state.members.size + 1})`);
  $('peopleBtn').title = 'Pessoas na sala';
  const inVoiceCount = [...voice.members.values()].filter((m) => m.session).length + (voice.session ? 1 : 0);
  $('voiceCount').textContent = inVoiceCount ? `${inVoiceCount} na voz` : '';
  list.append(memberRow(null, `${getName()} (você)`, state.sharing));
  const others = [...state.members].sort((a, b) => Number(b[1].sharing) - Number(a[1].sharing));
  for (const [id, m] of others) list.append(memberRow(id, m.name, m.sharing));
  renderVoicePane();
  if (typeof renderHomeCall === 'function') renderHomeCall(); // quem está na sala, na faixa do início
  repaintAllAvatars(); // entrou ou saiu alguém: a cor da estrela de quem não tem foto segue a ordem da sala
}

function updateStage() {
  const othersSharing = [...state.members.values()].some((m) => m.sharing);
  $('emptyStage').hidden = state.in.size > 0;
  $('tiles').hidden = state.in.size === 0;
  $('emptyText').textContent = othersSharing
    ? 'Clique em Assistir ao lado de quem está transmitindo.'
    : state.sharing
      ? 'Você está transmitindo.'
      : 'Ninguém está transmitindo agora.';
  if (!state.in.size) $('downloadInfo').textContent = '';
}
