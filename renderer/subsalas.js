'use strict';
// Subsalas de voz: canais dentro da sala (só voz). A Voz geral é o canal ''; cada subsala tem um número e o nome
// Subsala_N (o servidor da sala escolhe o número: o maior que existe + 1). Qualquer pessoa cria e apaga; quem estava
// numa subsala apagada volta para a Voz geral. Só quem está no mesmo canal se conecta e se ouve (voice.js).
// O painel de voz (renderVoicePane em navegacao.js) mostra os canais com quem está em cada um. Arrastar alguém que está
// na voz (ou você) para outro canal leva a pessoa para lá.
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
  const wait = subsalaJoinNext, made = wait && (state.subsalas || []).find((s) => !wait.known.has(s.id));
  if (wait && (made || Date.now() - wait.at > 5000)) subsalaJoinNext = null;
  if (made && Date.now() - wait.at <= 5000 && voice.supported) voice.setChannel(made.id);
  renderVoice();
}

// Nova subsala. join (o botão do painel): cria e já entra nela; quando a lista volta do servidor com uma subsala que
// não existia, vai para lá (até 5 s depois; se nada chegar, só não entra)
let subsalaJoinNext = null; // { known: ids de antes, at }
function createSubsala(join = false) {
  if (!subsalasOn() || !state.myId) return;
  if (join === true) subsalaJoinNext = { known: new Set(state.subsalas.map((s) => s.id)), at: Date.now() };
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

// Cabeçalho de um canal no painel de voz: nome, quantas pessoas, pôr música e apagar (subsala). Clicar no cabeçalho
// (fora dos botões dele) entra no canal, se você não está nele
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
  if (!here && voice.supported && !voice.pending) {
    const label = voice.session ? `Ir para ${channelName(ch)}` : `Entrar na voz, em ${channelName(ch)}`;
    li.classList.add('joinable');
    li.tabIndex = 0;
    li.title = label;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', label);
    li.onclick = (e) => { if (!e.target.closest('button')) voice.setChannel(ch); };
    li.onkeydown = (e) => {
      if (e.target !== li || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      voice.setChannel(ch);
    };
  }
  const music = typeof musicHeadButton === 'function' && musicHeadButton(ch); // pôr uma música (renderer/musica.js)
  if (music) li.append(music);
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
// A linha de alguém na voz (null é você): nome, volume, Assistir… (memberRow em membros.js)
function voiceRow(id) { return id ? memberRow(id, nameOf(id), !!state.members.get(id)?.sharing) : memberRow(null, `${getName()} (você)`, state.sharing); }

function renderVoiceChannels(list) {
  for (const [ch, sub] of [['', null], ...state.subsalas.map((s) => [s.id, s])]) {
    list.append(channelHead(ch, sub));
    const music = musicRow(ch); // a música do canal, com Ouvir (renderer/musica.js)
    if (music) list.append(music);
    for (const id of voiceIdsIn(ch)) { const li = voiceRow(id); li.classList.add('in-channel'); makeVoiceDraggable(li, id, ch); list.append(li); }
  }
  setupVoiceDrop(list);
}

// ---------- Arrastar pessoas entre canais ----------
// Você troca de canal como no Entrar; os outros, quem move é o servidor da sala (subsala-move), se ele souber fazer
// isso (servidor antigo: só dá para arrastar a si mesmo). Enquanto alguém está sendo arrastado, o painel não é
// redesenhado (a linha arrastada sumiria e o arraste acabaria): redesenha quando soltar.
const VOICE_DRAG_TYPE = 'application/x-tela-p2p-voz';
let voiceDrag = null;          // { id, from } enquanto alguém está sendo arrastado; id null é você
let voiceDragPending = false;  // a voz mudou durante o arraste

const canDragVoice = (id) => voice.supported && (id ? state.subsalaMove && inVoice(id) : !!voice.session);

function makeVoiceDraggable(li, id, ch) {
  li.dataset.channel = ch; // soltar em cima de alguém leva para o canal dessa pessoa
  if (!canDragVoice(id)) return;
  li.draggable = true;
  li.classList.add('voice-draggable');
  li.ondragstart = (e) => {
    voiceDrag = { id, from: ch };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(VOICE_DRAG_TYPE, id || state.myId);
    li.classList.add('dragging');
    $('voicePaneMembers').classList.add('voice-dragging');
  };
  li.ondragend = endVoiceDrag;
}

function markVoiceDrop(ch) {
  for (const el of $('voicePaneMembers').querySelectorAll('[data-channel]')) el.classList.toggle('drop-target', el.dataset.channel === ch);
}

function endVoiceDrag() {
  if (!voiceDrag) return;
  voiceDrag = null;
  $('voicePaneMembers').classList.remove('voice-dragging');
  markVoiceDrop(null);
  for (const el of $('voicePaneMembers').querySelectorAll('.dragging')) el.classList.remove('dragging');
  if (voiceDragPending) { voiceDragPending = false; renderVoicePane(); }
}

// O canal debaixo do ponteiro (cabeçalho do canal ou alguém nele), ou null fora deles
function voiceDropChannel(e) {
  const el = voiceDrag && e.target.closest?.('[data-channel]');
  return el && $('voicePaneMembers').contains(el) ? el.dataset.channel : null;
}

function setupVoiceDrop(list) {
  list.ondragover = (e) => {
    const ch = voiceDropChannel(e);
    if (ch === null) return markVoiceDrop(null);
    e.preventDefault();
    e.dataTransfer.dropEffect = ch === voiceDrag.from ? 'none' : 'move';
    markVoiceDrop(ch === voiceDrag.from ? null : ch);
  };
  list.ondragleave = (e) => { if (voiceDrag && !list.contains(e.relatedTarget)) markVoiceDrop(null); };
  list.ondrop = (e) => {
    const ch = voiceDropChannel(e), drag = voiceDrag;
    if (ch === null) return;
    e.preventDefault();
    endVoiceDrag();
    if (ch !== drag.from) moveVoiceTo(drag.id, ch);
  };
}

function moveVoiceTo(id, ch) {
  if (!id) return voice.setChannel(ch);
  if (!inVoice(id) || (ch && !state.subsalas?.some((s) => s.id === ch))) return;
  send({ type: 'subsala-move', id, channel: ch });
  toast(`${nameOf(id)} foi para ${channelName(ch)}`);
}
