'use strict';
// Subsalas de voz: canais dentro da sala (só voz). A Voz geral é o canal ''; cada subsala tem um número e o nome
// Subsala_N (o servidor da sala escolhe o número: o maior que existe + 1). Qualquer pessoa cria e apaga; quem estava
// numa subsala apagada volta para a Voz geral. Só quem está no mesmo canal se conecta e se ouve (voice.js).
// O painel de voz (renderVoicePane em navegacao.js) mostra os canais com quem está em cada um.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, voz.

const subsalasOn = () => Array.isArray(state.subsalas);
function channelName(ch) { return !ch ? 'Voz geral' : state.subsalas?.find((s) => s.id === ch)?.name || `Subsala_${ch}`; }
// Canal de alguém que está na voz ('' também para quem está fora; use inVoice para saber se está)
function voiceChannelOf(id) { return !id || id === state.myId ? voice.channel : voice.members.get(id)?.channel || ''; }

// A lista chegou do servidor (entrada, troca de host ou alguém criou/apagou): null é sala sem subsalas
function setSubsalas(list) {
  state.subsalas = Array.isArray(list)
    ? list.filter((s) => s && /^\d{1,6}$/.test(String(s.id))).map((s) => ({ id: String(s.id), name: `Subsala_${s.id}` }))
    : null;
  // Estava numa subsala que não existe mais (o servidor novo não tem subsalas): volta para a Voz geral
  if (voice.session && voice.channel && !(state.subsalas || []).some((s) => s.id === voice.channel)) voice.moveTo('');
  renderVoice();
}

function createSubsala() {
  if (!subsalasOn() || !state.myId) return;
  send({ type: 'subsala-create' });
}

async function deleteSubsala(sub) {
  const inside = voiceIdsIn(sub.id).length;
  const text = inside
    ? `Apagar ${sub.name}? ${inside === 1 ? 'Quem está nela volta' : `As ${inside} pessoas que estão nela voltam`} para a Voz geral.`
    : `Apagar ${sub.name}?`;
  if (!(await appConfirm(text, { title: 'Apagar subsala', ok: 'Apagar', danger: true }))) return;
  send({ type: 'subsala-delete', id: sub.id });
}

// Quem está na voz num canal (ids; null é você)
function voiceIdsIn(ch) {
  const ids = [...voice.members].filter(([id, m]) => m.session && state.members.has(id) && (m.channel || '') === ch).map(([id]) => id);
  if (voice.session && voice.channel === ch) ids.unshift(null);
  return ids;
}

// Cabeçalho de um canal no painel de voz: nome, quantas pessoas, Entrar (se você não está nele) e apagar (subsala)
function channelHead(ch, sub) {
  const li = document.createElement('li');
  const here = !!voice.session && voice.channel === ch;
  li.className = 'voice-channel' + (here ? ' here' : '');
  li.dataset.channel = ch;
  const icon = document.createElement('span');
  icon.className = 'voice-channel-icon';
  icon.innerHTML = ICON.volume;
  icon.setAttribute('aria-hidden', 'true');
  const name = document.createElement('strong');
  name.textContent = channelName(ch);
  const count = document.createElement('span');
  count.className = 'voice-channel-count';
  const n = voiceIdsIn(ch).length;
  count.textContent = n ? String(n) : '';
  li.append(icon, name, count);
  if (!here) {
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'btn small voice-channel-join';
    join.textContent = 'Entrar';
    join.disabled = !voice.supported || voice.pending;
    join.title = voice.session ? `Ir para ${channelName(ch)}` : `Entrar na voz, em ${channelName(ch)}`;
    join.onclick = () => voice.setChannel(ch);
    li.append(join);
  }
  if (sub) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn small icon voice-channel-delete';
    del.innerHTML = ICON.close;
    del.title = del.ariaLabel = `Apagar ${sub.name}`;
    del.onclick = () => deleteSubsala(sub);
    li.append(del);
  }
  return li;
}

// Os canais no painel de voz, cada um com quem está nele
function renderVoiceChannels(list) {
  const row = (id) => (id ? memberRow(id, nameOf(id), !!state.members.get(id)?.sharing) : memberRow(null, `${getName()} (você)`, state.sharing));
  for (const [ch, sub] of [['', null], ...state.subsalas.map((s) => [s.id, s])]) {
    list.append(channelHead(ch, sub));
    for (const id of voiceIdsIn(ch)) { const li = row(id); li.classList.add('in-channel'); list.append(li); }
  }
  const add = document.createElement('li');
  add.className = 'voice-channel-add';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small';
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  btn.append('Nova subsala');
  btn.title = 'Criar uma subsala de voz (Subsala_1, Subsala_2…)';
  btn.onclick = createSubsala;
  add.append(btn);
  list.append(add);
}
