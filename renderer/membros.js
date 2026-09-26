'use strict';
// Painel da sala: endereço, lista de pessoas e o texto da área vazia.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, tema, voz, assistir, chat.

// ---------- Painel da sala ----------
async function renderRoomAddress() {
  const box = $('roomAddress');
  box.innerHTML = '';
  let addrs;
  if (state.isOwner) {
    const ips = await window.api.getIps();
    const radmin = ips.filter((i) => i.radmin);
    $('noRadmin').hidden = radmin.length > 0;
    addrs = (radmin.length ? radmin : ips).map((i) => `${i.address}:${state.port}`);
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
        await navigator.clipboard.writeText(addr);
        copy.textContent = 'Copiado';
        setTimeout(() => { copy.textContent = 'Copiar'; }, 1500);
      } catch { toast('Não foi possível copiar. Selecione o endereço e use Ctrl+C.', 'error'); }
    };
    row.append(code, copy);
    box.append(row);
  }
  state.roomAddr = addrs[0] || '';
  $('dockAddrText').textContent = state.roomAddr;
  $('dockAddr').hidden = chat.open || !state.roomAddr;
}

function memberRow(id, name, sharing) {
  const who = id || state.myId;
  const li = document.createElement('li');
  li.className = 'member' + (sharing ? ' live' : '');
  li.style.setProperty('--person', personColor(id));
  li.dataset.person = who;
  li.classList.toggle('speaking', speaking.has(who));
  const dot = avatar(id ? name : getName());
  const info = document.createElement('div');
  info.className = 'info';
  const nameEl = document.createElement('span');
  nameEl.className = 'mname';
  nameEl.textContent = name;
  nameEl.append(speakBars());
  const status = document.createElement('span');
  status.className = 'mstatus';
  const paused = id && state.focus && state.focus !== id && state.in.has(id);
  const inPip = id && state.pips.has(id);
  const voiceOn = inVoice(who);
  const micOff = voiceOn && (id ? !!voice.members.get(id)?.muted : voice.muted);
  const parts = [];
  if (who === state.hostId) parts.push('Host');
  if (sharing) parts.push(inPip ? 'Transmitindo · na janela flutuante' : paused ? 'Transmitindo, em pausa para você' : 'Transmitindo');
  if (voiceOn) parts.push(micOff ? 'na voz, microfone desligado' : 'na voz');
  status.textContent = parts.join(' · ') || 'Na sala';
  info.append(nameEl, status);
  li.append(dot, info);
  if (micOff) {
    const mo = document.createElement('span');
    mo.className = 'mic-off-icon';
    mo.innerHTML = ICON.micOff;
    mo.title = 'Microfone desligado';
    li.append(mo);
  }

  // Volume dessa pessoa para você (voz e/ou transmissão); mostra o valor quando não está em 100%
  if (id && (voiceOn || state.in.has(id))) {
    const v = volOf(id);
    const changed = v.muted || v.voice !== 100 || v.screen !== 100;
    const vb = document.createElement('button');
    vb.type = 'button';
    vb.className = 'btn small vol-btn' + (changed ? ' changed' : '');
    vb.innerHTML = v.muted ? ICON.muted : ICON.volume;
    const badge = v.muted ? 'mudo' : voiceOn && v.voice !== 100 ? `${v.voice}%` : !voiceOn && v.screen !== 100 ? `${v.screen}%` : '';
    if (badge) vb.append(badge);
    const label = `Volume de ${name}${v.muted ? ' (silenciada para você)' : badge ? ` (${badge})` : ''}`;
    vb.title = label;
    vb.setAttribute('aria-label', label);
    vb.setAttribute('aria-expanded', String($('personCard').dataset.for === id && !$('personCard').hidden));
    vb.onclick = (e) => openPersonCard(id, vb, e.detail === 0);
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
}

function updateStage() {
  const othersSharing = [...state.members.values()].some((m) => m.sharing);
  $('emptyStage').hidden = state.in.size > 0;
  $('tiles').hidden = state.in.size === 0;
  $('emptyText').textContent = othersSharing
    ? 'Escolha na lista ao lado quem você quer assistir. A tela só começa a ser baixada depois que você clicar em Assistir.'
    : state.sharing
      ? 'Você está transmitindo. Quando outra pessoa começar, aparece um botão Assistir ao lado do nome dela.'
      : 'Ninguém está transmitindo agora. Quando alguém começar, aparece um botão Assistir ao lado do nome.';
  if (!state.in.size) $('downloadInfo').textContent = '';
}
