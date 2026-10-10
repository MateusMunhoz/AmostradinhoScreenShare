'use strict';
// Subsalas de voz: canais dentro da sala (só voz). A Voz geral é o canal ''; cada subsala tem um número e o nome
// Subsala_N (o servidor da sala escolhe o número: o maior que existe + 1). Qualquer pessoa cria e apaga; quem estava
// numa subsala apagada volta para a Voz geral. Só quem está no mesmo canal se conecta e se ouve (voice.js).
// O painel de voz (renderVoicePane em navegacao.js) mostra os canais com quem está em cada um. Arrastar alguém que está
// na voz (ou você) para outro canal leva a pessoa para lá.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, voz.

const subsalasOn = () => Array.isArray(state.subsalas);
// Modo Líder (docs/spec/modo-lider.md): a subsala Líder fala para a sala toda. O canal dela, ou '' sem ela
const liderChannel = () => state.subsalas?.find((s) => s.modo === 'lider')?.id || '';
function channelName(ch) { return !ch ? 'Voz geral' : state.subsalas?.find((s) => s.id === ch)?.name || `Subsala_${ch}`; }
// Canal de alguém que está na voz ('' também para quem está fora; use inVoice para saber se está)
function voiceChannelOf(id) { return !id || id === state.myId ? voice.channel : voice.members.get(id)?.channel || ''; }

// A lista chegou do servidor (entrada, troca de host ou alguém criou/apagou): null é sala sem subsalas
function setSubsalas(list) {
  state.subsalas = Array.isArray(list)
    ? list.filter((s) => s && /^\d{1,6}$/.test(String(s.id))).map((s) => ({ id: String(s.id), name: `Subsala_${s.id}`, ...(s.modo === 'lider' ? { modo: 'lider' } : {}) }))
    : null;
  lider.setCanal(liderChannel());
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
function createSubsala(join = false, modo = 'padrao') {
  if (!subsalasOn() || !state.myId) return;
  if (join === true) subsalaJoinNext = { known: new Set(state.subsalas.map((s) => s.id)), at: Date.now() };
  send(modo === 'lider' ? { type: 'subsala-create', modo } : { type: 'subsala-create' });
}

// O + Subsala do painel de voz: com servidor que conhece o Modo Líder, pergunta o modo antes (Padrão ou Líder);
// sem isso, cria uma Padrão direto, como sempre
function subsalaButtonClick(btn) {
  if (!state.liderOn) return createSubsala(true);
  toggleSubsalaModoMenu(btn);
}
function toggleSubsalaModoMenu(btn, force) {
  const open = force ?? !$('subsalaModoMenu');
  btn?.setAttribute('aria-expanded', String(open));
  $('subsalaModoMenu')?.remove();
  if (!open) return;
  const menu = document.createElement('div');
  menu.id = 'subsalaModoMenu';
  menu.className = 'share-open-menu subsala-modo-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Modo da subsala');
  const head = document.createElement('div');
  head.className = 'som-head';
  head.textContent = 'Nova subsala';
  menu.append(head);
  const ja = liderChannel();
  for (const [modo, icon, label, sub] of [['padrao', 'ondas', 'Padrão', 'Só quem está nela se ouve'],
    ['lider', 'megafone', 'Líder', ja ? `Já existe uma subsala Líder (${channelName(ja)})` : 'Quem está nela fala para a sala toda']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.dataset.modo = modo;
    b.innerHTML = ICON[icon];
    const t = document.createElement('span');
    t.className = 'som-text';
    const strong = document.createElement('strong');
    strong.textContent = label;
    const small = document.createElement('small');
    small.textContent = sub;
    t.append(strong, small);
    b.append(t);
    b.disabled = modo === 'lider' && !!ja;
    b.onclick = () => { toggleSubsalaModoMenu(btn, false); createSubsala(true, modo); };
    menu.append(b);
  }
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); toggleSubsalaModoMenu(btn, false); btn?.focus(); }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menu.querySelectorAll('button:not(:disabled)')], at = items.indexOf(document.activeElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  });
  document.body.append(menu);
  // Abre embaixo do botão (ou em cima, se não couber)
  const r = btn.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  if (r.bottom + 8 + menu.offsetHeight <= innerHeight - 8) menu.style.top = `${r.bottom + 6}px`;
  else menu.style.bottom = `${innerHeight - r.top + 6}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}
document.addEventListener('pointerdown', (e) => {
  if ($('subsalaModoMenu') && !e.target.closest?.('#subsalaModoMenu, #paneVoiceSubsala')) toggleSubsalaModoMenu($('paneVoiceSubsala'), false);
});

async function deleteSubsala(sub) {
  const inside = voiceIdsIn(sub.id).length;
  const text = inside
    ? `Apagar ${sub.name}? ${inside === 1 ? 'Quem está nela volta' : `As ${inside} pessoas que estão nela voltam`} para a Voz geral.`
    : `Apagar ${sub.name}?`;
  if (!(await appConfirm(text, { title: 'Apagar subsala', ok: 'Apagar', danger: true }))) return;
  send({ type: 'subsala-delete', id: sub.id });
}

// A linha da Líder no cartão Seu sinal: com gente na subsala Líder, quem está fora dela ouve (na voz, sempre; fora
// da voz, com o Ouvir) e ajusta o volume; quem está dentro vê que fala para a sala toda
function renderLiderLinha() {
  const row = $('ssLider'), ch = liderChannel();
  const fontes = ch && state.myId ? voiceIdsIn(ch) : [];
  row.hidden = !fontes.length;
  if (row.hidden) return;
  const dentro = !!voice.session && voice.channel === ch, ouvindo = lider.souOuvinte();
  $('ssLiderIcone').innerHTML = ICON.megafone;
  $('ssLiderTexto').textContent = dentro ? 'Você fala para a sala toda' : `${ouvindo ? 'Ouvindo a Líder' : 'Líder na sala'} · ${channelName(ch)}`;
  row.classList.toggle('ouvindo', ouvindo || dentro);
  const vol = $('ssLiderVol');
  vol.hidden = dentro || !ouvindo;
  if (document.activeElement !== vol) vol.value = String(liderVolume);
  vol.title = `Volume da Líder: ${liderVolume}%`;
  const ouvir = $('ssLiderOuvir');
  ouvir.hidden = dentro || !!voice.session; // na voz, a Líder já toca junto com o seu canal
  ouvir.textContent = lider.ouvindo ? 'Parar' : 'Ouvir';
  ouvir.title = lider.ouvindo ? 'Parar de ouvir a Líder' : 'Ouvir a Líder sem entrar na voz (sem microfone)';
  ouvir.setAttribute('aria-pressed', String(lider.ouvindo));
}
function setupLiderLinha() {
  $('ssLiderOuvir').onclick = () => { mixer.ensure(); lider.setOuvindo(!lider.ouvindo); renderLiderLinha(); };
  $('ssLiderVol').oninput = (e) => { setLiderVolume(e.target.value); e.target.title = `Volume da Líder: ${liderVolume}%`; };
  onWheelVolumeLider($('ssLiderVol'));
}
// A roda do mouse em cima do volume da Líder: 5% por clique
function onWheelVolumeLider(el) {
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const steps = wheelSteps('lider', e);
    if (!steps) return;
    setLiderVolume(liderVolume + steps * WHEEL_STEP);
    el.value = String(liderVolume);
    volBubble(document, `Volume da Líder: ${liderVolume}%`, e.clientX, e.clientY);
  }, { passive: false });
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
  // Sem caixa: as barrinhas de som (azuis e altas no seu canal, baixas e cinza nos outros) e o nome. Sem o número de
  // pessoas: quem está no canal aparece logo embaixo
  icon.innerHTML = here ? ICON.ondas : ICON.ondasParadas;
  icon.setAttribute('aria-hidden', 'true');
  const name = document.createElement('strong');
  name.textContent = channelName(ch);
  li.append(icon, name);
  // Subsala Líder: o selo, e AO VIVO com alguém transmitindo nela
  if (sub?.modo === 'lider') {
    li.classList.add('lider');
    const selo = document.createElement('span');
    selo.className = 'voice-channel-selo';
    selo.textContent = 'Líder';
    selo.title = 'Subsala Líder: quem está nela fala para a sala toda';
    const aoVivo = voiceIdsIn(ch).some((id) => (id ? state.members.get(id)?.sharing : state.sharing));
    if (aoVivo) { selo.classList.add('ao-vivo'); selo.textContent = 'Líder · ao vivo'; }
    name.after(selo);
  }
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
  const music = typeof musicHeadButton === 'function' && musicHeadButton(ch); // a música do canal (ouvir) ou Pôr música (renderer/musica.js)
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
function voiceRow(id) { return id ? memberRow(id, nameOf(id), !!state.members.get(id)?.sharing) : memberRow(null, getName(), state.sharing); }

function renderVoiceChannels(list) {
  for (const [ch, sub] of [['', null], ...state.subsalas.map((s) => [s.id, s])]) {
    list.append(channelHead(ch, sub));
    for (const id of voiceIdsIn(ch)) { const li = voiceRow(id); li.classList.add('in-channel'); makeVoiceDraggable(li, id, ch); list.append(li); }
  } // a música do canal fica no cabeçalho dele (channelHead › musicHeadButton)
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
