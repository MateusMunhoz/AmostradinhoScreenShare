'use strict';
// Chat: mensagens, arquivos e não lidas.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, metadados, tema, sala, voz, overlay, estatisticas.

// ---------- Chat ----------
// Mensagens passam pelo servidor da sala (que guarda as últimas 100 para quem entrar depois). Um arquivo
// anexado fica no PC de quem mandou; quem clica em Baixar recebe direto dele, em pedaços, pela sala.
const CHAT_MAX_FILE = 200 * 1024 * 1024;
const CHAT_AUTO_IMAGE = 8 * 1024 * 1024;
const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const FILE_CHUNK = 48 * 1024;
const chat = {
  open: true,             // painel (pessoas + chat) aberto
  log: [],                // as últimas 100 mensagens, como vieram do servidor
  lastMsg: null,          // para agrupar mensagens seguidas da mesma pessoa
  divider: null,          // linha "N mensagens novas"
  sending: new Set(),     // "pessoa|arquivo" que estou mandando agora (Cancelar do outro lado para)
  supported: false,
  unread: 0,
  files: new Map(),       // id -> File que eu anexei (disponível enquanto eu estiver na sala)
  downloads: new Map(),   // id -> { from, file, chunks, got, bytes, card }
  cards: new Map(),       // id do arquivo -> partes do cartão na tela
  urls: [],               // blob: criados, para liberar ao sair
  staged: [],             // { file, url } esperando o Enviar (a bandeja em cima do campo de mensagem)
};


// Painel (endereço, pessoas e chat) aberto ou recolhido pelo balão da barra
function setPanelOpen(open) {
  chat.open = open;
  save('panelOpen', open ? '1' : '0');
  workspaceViews.chat = open;
  saveWorkspaceViews();
  syncWorkspace();
  $('chatToggle').setAttribute('aria-pressed', String(open));
  if (open && chatAtBottom()) markRead();
  renderUnread();
  renderVoiceAvatars();
  closePersonCard();
  setPeopleOpen(false);
}

// Lista de pessoas: abre pelo botão no topo do chat, por cima das mensagens
function setPeopleOpen(open) {
  $('peoplePop').hidden = !open;
  $('peopleBtn').setAttribute('aria-expanded', String(open));
  if (!open) closePersonCard();
  if (!open && typeof skyFocusFrom !== 'undefined' && skyFocusFrom === 'pessoas') closeSkyProfile();
}

function chatAtBottom() {
  const l = $('chatList');
  return l.scrollHeight - l.scrollTop - l.clientHeight < 40;
}

function scrollChatToEnd() {
  const l = $('chatList');
  l.scrollTop = l.scrollHeight;
}

function markRead() {
  if (!chat.unread) return;
  chat.unread = 0;
  renderUnread();
}

function renderUnread() {
  const n = chat.unread;
  $('navUnread').hidden = !n;
  $('navUnread').textContent = n > 99 ? '99+' : String(n);
  $('chatUnread').hidden = !n;
  $('chatUnread').textContent = n > 99 ? '99+' : String(n);
  $('chatFoldUnread').hidden = !n; // chat recolhido: as novas no título (setupPaneFold)
  $('chatFoldUnread').textContent = n === 1 ? '1 nova' : `${n > 99 ? '99+' : n} novas`;
  $('mapChatUnread').hidden = !n;
  $('mapChatUnread').textContent = n === 1 ? '1 nova' : `${n > 99 ? '99+' : n} novas`;
  const label = chat.open ? 'Recolher o painel da sala'
    : n ? `Abrir o chat (${n} ${n === 1 ? 'mensagem nova' : 'mensagens novas'})` : 'Abrir o painel da sala e o chat';
  $('chatToggle').title = label;
  $('chatToggle').setAttribute('aria-label', label);
  $('chatJump').hidden = !n || !chat.open || chatAtBottom();
  if (typeof renderHomeCall === 'function') renderHomeCall(); // o Voltar conta as novas
}

function resetChat(welcome) {
  resetChatOverlayMessages();
  for (const u of chat.urls) URL.revokeObjectURL(u);
  chat.urls = [];
  chat.files.clear();
  chat.downloads.clear();
  chat.cards.clear();
  chat.sending.clear();
  chat.unread = 0;
  chat.lastMsg = null;
  chat.divider = null;
  chat.supported = !!welcome && Array.isArray(welcome.features) && welcome.features.includes('chat');
  chat.log = ((welcome && welcome.chat) || []).slice(-100);
  $('chatList').innerHTML = '';
  $('chatOff').hidden = !welcome || chat.supported;
  $('chatInput').disabled = $('chatAttach').disabled = !chat.supported;
  clearStaged(); // sala nova: nada da bandeja da sala anterior
  $('chatSend').disabled = !chat.supported || !$('chatInput').value.trim();
  for (const m of (welcome && welcome.chat) || []) appendMessage(m, false);
  setPanelOpen(workspaceViews.chat);
  requestAnimationFrame(scrollChatToEnd);
}

function onChatMessage(m) {
  if (m.id && chat.log.some(entry => entry.id === m.id)) return;
  const calledMe = m.from !== state.myId && mentionsMe(m.text);
  void appSounds.play(calledMe ? 'mention' : 'chat'); // menção tem som próprio
  // Cópia da conversa: se eu virar o host, o novo servidor continua daqui
  const { type, ...entry } = m;
  chat.log.push(entry);
  if (chat.log.length > 100) forgetChatOverlayMessage(chat.log.shift());
  noteChatOverlayMessage(entry);
  renderChatOverlay();
  const wasBottom = chatAtBottom();
  const away = $('chatTab').hidden || mapFocus.on; // chat fechado (também no menu) ou com o mapa em foco: não está à vista
  const unseen = m.from !== state.myId && (!chat.open || away || document.hidden || !wasBottom);
  if (unseen && !chat.unread) {
    // Começa um lote de novas: a linha "mensagens novas" vai antes desta
    if (chat.divider) chat.divider.remove();
    chat.divider = document.createElement('li');
    chat.divider.className = 'new-divider';
    $('chatList').append(chat.divider);
    chat.lastMsg = null;
  }
  appendMessage(m, true);
  if (m.from === state.myId || (chat.open && wasBottom && !document.hidden)) scrollChatToEnd();
  if (unseen) {
    chat.unread++;
    chat.divider.textContent = `${chat.unread} ${chat.unread === 1 ? 'mensagem nova' : 'mensagens novas'}`;
    if ((!chat.open || away) && !calledMe) toast(`${m.name}: ${m.text || `mandou ${m.file.name}`}`);
  }
  if (calledMe) notifyMention(m);
  renderUnread();
}

// Texto sempre como texto; só endereços http(s) viram link, que abre no navegador, e @nome vira destaque
function textWithLinks(p, text) {
  for (const part of text.split(/(https?:\/\/[^\s]+)/i)) {
    if (!/^https?:\/\//i.test(part)) { appendMentions(p, part); continue; }
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = part;
    a.title = 'Abrir no navegador';
    a.onclick = (e) => { e.preventDefault(); window.api.openLink(part); };
    p.append(a);
  }
}

// Mensagens seguidas da mesma pessoa (em até 5 min) ficam juntas, sem repetir nome e hora
function appendMessage(m, live) {
  const mine = m.from === state.myId;
  const prev = chat.lastMsg;
  const grouped = !!prev && prev.from === m.from && m.ts - prev.ts < 5 * 60 * 1000;
  const li = document.createElement('li');
  li.className = 'msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '') + (!mine && mentionsMe(m.text) ? ' mentioned' : '');
  const name = m.name; // as suas também com o seu nome, como os outros veem
  li.style.setProperty('--person', personColor(m.from));
  const d = new Date(m.ts);
  const when = document.createElement('time');
  when.className = 'msg-time';
  when.textContent = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const line = document.createElement('p');
  line.className = 'msg-line';
  const who = document.createElement('strong');
  who.className = 'msg-who';
  who.textContent = name;
  paintName(who, m.from);
  if (!mine) markProfile(who, m.from, name);
  const sep = document.createElement('span');
  sep.className = 'msg-sep';
  sep.textContent = ' : ';
  // Com foto de perfil, ela vem antes do nome (quem não tem continua só com o nome colorido)
  if (photoHashOf(m.from)) line.append(mine ? avatar(m.name, m.from) : markProfile(avatar(m.name, m.from), m.from, name));
  line.append(who, sep);
  if (m.text) {
    const text = document.createElement('span');
    text.className = 'msg-text';
    textWithLinks(text, m.text);
    line.append(text);
  }
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.append(line);
  if (m.file) body.append(fileCard(m, live));
  li.append(when, body);
  $('chatList').append(li);
  chat.lastMsg = { from: m.from, ts: m.ts };
}

// Cartão de arquivo: ícone, nome, tamanho/estado, botão (Baixar, Cancelar, Salvar) e barra de progresso
function fileCard(m, live) {
  const f = m.file;
  const mine = m.from === state.myId;
  const card = document.createElement('div');
  card.className = 'file-card';
  const row = document.createElement('div');
  row.className = 'file-row';
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.innerHTML = ICON.doc;
  const info = document.createElement('div');
  info.className = 'file-info';
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = f.name;
  name.title = f.name;
  const meta = document.createElement('span');
  meta.className = 'file-meta';
  info.append(name, meta);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small primary';
  btn.textContent = 'Baixar';
  row.append(icon, info);
  const bar = document.createElement('div');
  bar.className = 'file-bar';
  bar.hidden = true;
  const fill = document.createElement('span');
  bar.append(fill);
  card.append(row, bar);
  const parts = { card, row, icon, meta, bar, fill, btn, f, from: m.from, state: 'offer' };
  chat.cards.set(f.id, parts);

  const local = mine && chat.files.get(f.id);
  if (local) {
    parts.state = 'mine';
    meta.textContent = `${formatBytes(f.size)} · disponível enquanto você estiver na sala`;
    if (CHAT_IMAGE_TYPES.includes(f.mime)) showImage(parts, URL.createObjectURL(local));
  } else if (mine) {
    setCardGone(parts, 'enviado antes de você reabrir o app, não está mais disponível');
  } else if (!state.members.has(m.from)) {
    setCardGone(parts, 'Quem mandou saiu da sala');
  } else {
    meta.textContent = formatBytes(f.size);
    btn.onclick = () => requestFile(m.from, f);
    row.append(btn);
    // Imagem pequena chega sozinha e aparece no chat
    if (live && CHAT_IMAGE_TYPES.includes(f.mime) && f.size <= CHAT_AUTO_IMAGE) requestFile(m.from, f);
  }
  return card;
}

function setCardGone(parts, text) {
  parts.state = 'gone';
  parts.card.classList.add('gone');
  parts.icon.innerHTML = ICON.warn;
  parts.bar.hidden = true;
  parts.btn.remove();
  parts.meta.textContent = text;
}

// Imagem no chat: só a imagem, sem o ícone, o nome e o tamanho do cartão de arquivo. O selo "Só nesta sala"
// aparece com o mouse em cima (ou com o foco): a imagem só existe enquanto quem mandou está na sala.
let chatImageSeq = 0;
function showImage(parts, url) {
  if (!chat.urls.includes(url)) chat.urls.push(url);
  const img = document.createElement('img');
  img.src = url;
  img.alt = parts.f.name;
  img.className = 'chat-image';
  img.tabIndex = 0;
  img.setAttribute('role', 'button');
  img.setAttribute('aria-label', `Ampliar ${parts.f.name}`);
  img.title = 'Clique para ampliar';
  img.onclick = () => openImageViewer(img);
  img.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openImageViewer(img); } };
  const badge = document.createElement('span');
  badge.className = 'chat-image-badge';
  badge.id = `chatImageBadge${++chatImageSeq}`;
  badge.innerHTML = ICON.leave;
  badge.append('Só nesta sala');
  img.setAttribute('aria-describedby', badge.id);
  const wrap = document.createElement('div');
  wrap.className = 'chat-image-wrap';
  wrap.append(img, badge);
  parts.card.classList.add('image-only');
  parts.card.insertBefore(wrap, parts.card.firstChild);
}

// ---------- Imagem grande ----------
// Clicar numa imagem do chat abre ela por cima do app. Clicar nela alterna entre caber na tela e o tamanho real;
// ← e → passam entre as imagens da conversa; Copiar, Salvar; Esc ou clicar fora fecha.
const viewer = { list: [], index: 0, returnTo: null };
function openImageViewer(img) {
  viewer.list = [...(img.closest('.chat-list') || $('chatList')).querySelectorAll('img.chat-image')]; // a do chat da sala ou a da mensagem privada
  viewer.index = Math.max(0, viewer.list.indexOf(img));
  viewer.returnTo = img;
  $('imageViewer').hidden = false;
  showViewerImage();
  $('ivClose').focus();
}
// A foto de perfil de alguém, inteira: abre na hora com a pequena e troca quando a inteira chegar
function openPhotoViewer(id, name, anchor) {
  const entry = { src: photoUrl(photoHashOf(id)), alt: `Foto de ${name}`, file: `foto-${name}.webp`, photo: true };
  viewer.list = [entry];
  viewer.index = 0;
  viewer.returnTo = anchor;
  $('imageViewer').hidden = false;
  showViewerImage();
  $('ivClose').focus();
  fullPhotoOf(id).then((url) => {
    if (!url || viewer.list[0] !== entry || $('imageViewer').hidden) return;
    entry.src = url;
    showViewerImage();
  });
}
function closeImageViewer() {
  if ($('imageViewer').hidden) return;
  $('imageViewer').hidden = true;
  $('ivImg').removeAttribute('src');
  if (viewer.returnTo?.isConnected) viewer.returnTo.focus();
}
function showViewerImage() {
  const src = viewer.list[viewer.index];
  if (!src) return closeImageViewer();
  const name = src.alt;
  $('ivImg').src = src.src;
  $('ivImg').alt = name;
  $('ivStage').classList.remove('actual');
  $('ivStage').classList.toggle('photo', !!src.photo); // foto de perfil: grande mesmo quando é pequena
  $('ivName').textContent = name;
  $('ivCount').textContent = viewer.list.length > 1 ? `${viewer.index + 1} de ${viewer.list.length}` : '';
  $('ivSave').href = src.src;
  $('ivSave').download = src.file || name;
  $('ivPrev').hidden = $('ivNext').hidden = viewer.list.length < 2;
}
function stepViewer(dir) {
  if (viewer.list.length < 2) return;
  viewer.index = (viewer.index + dir + viewer.list.length) % viewer.list.length;
  showViewerImage();
}
// Copiar: a imagem vira PNG (a área de transferência do Windows aceita PNG) e vai para colar no Discord, WhatsApp…
async function copyViewerImage() {
  try {
    const img = $('ivImg');
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Imagem copiada. É só colar onde quiser.');
  } catch { toast('Não foi possível copiar a imagem.', 'error'); }
}
setIcon($('ivClose'), 'close', 'Fechar');
setIcon($('ivPrev'), 'chevron', 'Imagem anterior');
setIcon($('ivNext'), 'chevron', 'Próxima imagem');
$('ivClose').onclick = closeImageViewer;
$('ivPrev').onclick = () => stepViewer(-1);
$('ivNext').onclick = () => stepViewer(1);
$('ivCopy').onclick = copyViewerImage;
$('ivImg').onclick = () => $('ivStage').classList.toggle('actual');
// Clicar em qualquer lugar que não seja a imagem ou um botão fecha, inclusive a faixa de cima. No tamanho real, a
// área da imagem tem barras de rolagem: clicar nela (para rolar) não fecha.
$('imageViewer').addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('#ivImg, button, a')) return;
  if (e.target === $('ivStage') && $('ivStage').classList.contains('actual')) return;
  closeImageViewer();
});
// Aberta, as teclas são dela (antes dos atalhos do resto do app)
document.addEventListener('keydown', (e) => {
  if ($('imageViewer').hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeImageViewer(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); stepViewer(e.key === 'ArrowLeft' ? -1 : 1); }
  else if (e.key === 'Tab') {
    const items = [...$('imageViewer').querySelectorAll('button:not([hidden]), a')];
    const at = items.indexOf(document.activeElement);
    if (e.shiftKey && at <= 0) { e.preventDefault(); items.at(-1).focus(); }
    else if (!e.shiftKey && at === items.length - 1) { e.preventDefault(); items[0].focus(); }
  }
}, true);

// Enviar: primeiro os arquivos da bandeja, depois o texto (que vira a legenda deles)
function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if ((!text && !chat.staged.length) || !chat.supported) return;
  const files = chat.staged.map((s) => s.file);
  clearStaged();
  if (files.length) attachFiles(files).then(() => { if (text) send({ type: 'chat', text }); });
  else send({ type: 'chat', text });
  input.value = '';
  fitChatInput();
}

// ---------- Bandeja: arquivos esperando o Enviar ----------
// Colar, arrastar ou o clipe põem o arquivo aqui (não manda na hora): dá para ver, tirar e escrever uma legenda
const CHAT_STAGE_MAX = 10;
function stageFiles(list) {
  if (!chat.supported) return;
  for (const file of list) {
    if (!file.size) continue;
    if (file.size > CHAT_MAX_FILE) { toast(`${file.name} passa de 200 MB e não pode ser enviado pelo chat.`, 'error'); continue; }
    if (chat.staged.length >= CHAT_STAGE_MAX) { toast(`Até ${CHAT_STAGE_MAX} arquivos por vez.`, 'error'); break; }
    chat.staged.push({ file, url: CHAT_IMAGE_TYPES.includes(file.type) ? URL.createObjectURL(file) : '' });
  }
  if (!chat.open) setPanelOpen(true); // a bandeja fica no chat: abre para você ver o que vai
  renderStaged();
  $('chatInput').focus();
}
function unstage(i) {
  const [gone] = chat.staged.splice(i, 1);
  if (gone?.url) URL.revokeObjectURL(gone.url);
  renderStaged();
  $('chatInput').focus();
}
function clearStaged() {
  for (const s of chat.staged) if (s.url) URL.revokeObjectURL(s.url);
  chat.staged = [];
  renderStaged();
}
function renderStaged() {
  const tray = $('chatStaged');
  tray.replaceChildren();
  tray.hidden = !chat.staged.length;
  chat.staged.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'staged-item' + (s.url ? ' image' : '');
    if (s.url) {
      const img = document.createElement('img');
      img.src = s.url;
      img.alt = s.file.name;
      item.append(img);
    } else {
      const icon = document.createElement('span');
      icon.className = 'staged-icon';
      icon.innerHTML = ICON.doc;
      const info = document.createElement('span');
      info.className = 'staged-info';
      const name = document.createElement('span');
      name.textContent = s.file.name;
      const size = document.createElement('span');
      size.className = 'hint';
      size.textContent = formatBytes(s.file.size);
      info.append(name, size);
      item.append(icon, info);
    }
    item.title = `${s.file.name} · ${formatBytes(s.file.size)}`;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'staged-remove';
    setIcon(x, 'close', `Tirar ${s.file.name}`);
    x.onclick = () => unstage(i);
    item.append(x);
    tray.append(item);
  });
  $('chatInput').placeholder = chat.staged.length ? 'Legenda (opcional) e Enter para enviar' : 'Mensagem para a sala';
  fitChatInput();
}

// O arquivo sai sem os metadados: localização, aparelho, datas, autor, pasta do PC (renderer/metadados.js).
// Foto estranha demais para limpar byte a byte é redesenhada, o que também não leva metadado nenhum. Outro
// arquivo estranho (vídeo, PDF, documento) não vai: devolve null.
async function withoutMetadata(file) {
  try {
    const clean = await FileMetadata.clean(file, file.name);
    return clean ? new File([clean.blob], clean.name, { type: file.type }) : file;
  } catch (err) {
    const kind = FileMetadata.kind(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    console.warn('metadados:', file.name, kind, err.message);
    if (!['jpeg', 'png', 'webp', 'gif'].includes(kind)) return null;
    try {
      const bmp = await createImageBitmap(file);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d').drawImage(bmp, 0, 0);
      const type = kind === 'jpeg' ? 'image/jpeg' : kind === 'webp' ? 'image/webp' : 'image/png';
      return new File([await c.convertToBlob({ type, quality: 0.95 })], FileMetadata.cleanName(file.name, 'foto'), { type });
    } catch {
      return null;
    }
  }
}

async function attachFiles(list) {
  if (!chat.supported) return;
  for (let file of list) {
    if (!file.size) continue;
    if (file.size > CHAT_MAX_FILE) { toast(`${file.name} passa de 200 MB e não pode ser enviado pelo chat.`, 'error'); continue; }
    const clean = await withoutMetadata(file);
    if (!clean) { toast(`Não deu para tirar os metadados de ${file.name} (arquivo fora do padrão), então ele não foi enviado. Para mandar assim mesmo, compacte num .zip.`, 'error'); continue; }
    file = clean;
    const id = crypto.randomUUID();
    chat.files.set(id, file);
    send({ type: 'chat', file: { id, name: file.name, size: file.size, mime: file.type } });
  }
}

// Ctrl+V na sala com imagem (print da tela) ou arquivo copiado: manda para o chat, como o clipe. Texto
// continua colando normal. Print chega sem nome ("image.png"): ganha um nome com a hora.
function onChatPaste(e) {
  if ($('room').hidden || !chat.supported) return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  const d = new Date();
  const stamp = `${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
  const named = files.map((f, i) => {
    if (f.name && f.name !== 'image.png') return f;
    const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return new File([f], `imagem-colada-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.${ext}`, { type: f.type });
  });
  stageFiles(named);
}

function fitChatInput() {
  const t = $('chatInput');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
  // Enviar só acende com algo escrito ou arquivo na bandeja
  $('chatSend').disabled = !chat.supported || (!t.value.trim() && !chat.staged.length);
}

function requestFile(from, f) {
  if (chat.downloads.has(f.id)) return;
  const parts = chat.cards.get(f.id);
  chat.downloads.set(f.id, { from, file: f, chunks: [], got: 0, bytes: 0 });
  if (parts) {
    parts.state = 'downloading';
    parts.btn.textContent = 'Cancelar';
    parts.btn.className = 'btn small';
    parts.btn.onclick = () => cancelFile(f.id);
    parts.bar.hidden = false;
    parts.fill.style.width = '0%';
    parts.meta.textContent = `Pedindo a ${nameOf(from)}…`;
  }
  sendSignal(from, { side: 'file', want: f.id });
}

// Cancelar: avisa quem manda para parar, e o cartão volta a oferecer o Baixar
function cancelFile(id) {
  const dl = chat.downloads.get(id);
  if (!dl) return;
  chat.downloads.delete(id);
  sendSignal(dl.from, { side: 'file', cancel: id });
  const parts = chat.cards.get(id);
  if (!parts) return;
  parts.state = 'offer';
  parts.bar.hidden = true;
  parts.btn.textContent = 'Baixar';
  parts.btn.className = 'btn small primary';
  parts.btn.onclick = () => requestFile(dl.from, dl.file);
  parts.meta.textContent = formatBytes(dl.file.size);
}

function fileFailed(id, text) {
  chat.downloads.delete(id);
  const parts = chat.cards.get(id);
  if (parts) setCardGone(parts, `${formatBytes(parts.f.size)} · ${text}`);
}

async function streamFile(to, id, file) {
  const key = `${to}|${id}`;
  chat.sending.add(key);
  const total = Math.max(1, Math.ceil(file.size / FILE_CHUNK));
  for (let part = 0; part < total && state.members.has(to) && chat.files.has(id) && chat.sending.has(key); part++) {
    const buf = new Uint8Array(await file.slice(part * FILE_CHUNK, (part + 1) * FILE_CHUNK).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    sendSignal(to, { side: 'file', fileId: id, part, total, data: btoa(bin) });
    await waitRoomBuffer();
  }
  chat.sending.delete(key);
}

function onFileSignal(from, data) {
  if (typeof data.want === 'string') {
    const file = chat.files.get(data.want);
    if (!file) return sendSignal(from, { side: 'file', fileId: data.want, unavailable: true });
    streamFile(from, data.want, file).catch((e) => console.warn(e));
    return;
  }
  if (typeof data.cancel === 'string') return void chat.sending.delete(`${from}|${data.cancel}`);
  const dl = chat.downloads.get(data.fileId);
  if (!dl || dl.from !== from) return;
  if (data.unavailable) return fileFailed(data.fileId, 'não está mais disponível (quem mandou reabriu o app)');
  if (!Number.isInteger(data.part) || data.part !== dl.got || typeof data.data !== 'string') return fileFailed(data.fileId, 'o download falhou, tente de novo');
  const bin = atob(data.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  dl.chunks.push(bytes);
  dl.got++;
  dl.bytes += bytes.length;
  const parts = chat.cards.get(data.fileId);
  if (parts) {
    const pct = Math.min(100, Math.round((dl.bytes / dl.file.size) * 100));
    parts.fill.style.width = `${pct}%`;
    parts.meta.textContent = `${formatBytes(dl.bytes)} de ${formatBytes(dl.file.size)} · ${pct}%`;
  }
  if (dl.got < data.total) return;

  chat.downloads.delete(data.fileId);
  if (dl.bytes !== dl.file.size) return fileFailed(data.fileId, 'chegou incompleto, tente de novo');
  const blob = new Blob(dl.chunks, { type: dl.file.mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  chat.urls.push(url);
  if (!parts) return;
  parts.state = 'done';
  parts.card.classList.add('done');
  parts.icon.innerHTML = ICON.check;
  parts.bar.hidden = true;
  parts.btn.remove();
  parts.meta.textContent = `${formatBytes(dl.file.size)} · recebido`;
  if (CHAT_IMAGE_TYPES.includes(dl.file.mime)) showImage(parts, url);
  // Salvar: o Electron pergunta onde guardar
  const saveLink = document.createElement('a');
  saveLink.className = 'btn small primary';
  saveLink.href = url;
  saveLink.download = dl.file.name;
  saveLink.textContent = 'Salvar';
  parts.row.append(saveLink);
  parts.blob = blob;
}

// Quem saiu leva os arquivos: downloads em andamento e botões Baixar dele param
function chatMemberLeft(id) {
  for (const [fid, dl] of chat.downloads) if (dl.from === id) fileFailed(fid, 'quem mandou saiu da sala');
  for (const [fid, parts] of chat.cards) {
    if (parts.from === id && parts.state === 'offer') fileFailed(fid, 'quem mandou saiu da sala');
  }
}

// ---------- Menções (@nome) ----------
// @Nome de quem está na sala (ou @todos) chama a pessoa: som próprio, aviso diferente e, com o app em segundo
// plano, uma notificação do Windows. Escrevendo @, uma lista sugere os nomes.
const MENTION_ALL = 'todos';
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Depois do nome não pode vir letra ou número (senão "@Ana" chamaria a "Anabela")
const MENTION_END = '(?![\\p{L}\\p{N}_])';
function mentionsMe(text) {
  if (!text || !text.includes('@')) return false;
  return new RegExp(`@(${escapeRe(getName())}|${MENTION_ALL})${MENTION_END}`, 'iu').test(text);
}
function roomNames() {
  const names = new Set([getName(), ...[...state.members.values()].map((m) => m.name)]);
  return [...names].filter(Boolean).sort((a, b) => b.length - a.length); // compridos primeiro ("Ana Paula" antes de "Ana")
}
function appendMentions(p, text) {
  if (!text.includes('@')) { p.append(text); return; }
  const re = new RegExp(`@(${[...roomNames().map(escapeRe), MENTION_ALL].join('|')})${MENTION_END}`, 'giu');
  let at = 0;
  for (const m of text.matchAll(re)) {
    p.append(text.slice(at, m.index));
    const span = document.createElement('span');
    const me = m[1].toLowerCase() === getName().toLowerCase() || m[1].toLowerCase() === MENTION_ALL;
    span.className = 'mention' + (me ? ' me' : '');
    span.textContent = m[0];
    p.append(span);
    at = m.index + m[0].length;
  }
  p.append(text.slice(at));
}
function notifyMention(m) {
  const body = (m.text || '').slice(0, 140);
  toast(`${m.name} mencionou você: ${body}`, 'mention');
  if (document.hasFocus() && !document.hidden) return;
  try {
    const n = new Notification(`${m.name} mencionou você`, { body, silent: true }); // o som é o do app
    n.onclick = () => {
      window.focus();
      if (!state.myId) return;
      if ($('room').hidden) backToRoom();
      setPanelOpen(true);
      scrollChatToEnd();
    };
  } catch {}
}

// Sugestões enquanto escreve @: quem está na sala e "todos"; setas escolhem, Enter ou Tab põem, Esc fecha
const mentionPick = { list: [], active: 0, start: -1 };
function mentionQuery() {
  const t = $('chatInput');
  const before = t.value.slice(0, t.selectionStart);
  const m = /(^|\s)@([^@\n]{0,24})$/.exec(before);
  return m ? { start: before.length - m[2].length - 1, query: m[2] } : null;
}
function renderMentionPick() {
  const pop = $('mentionPop');
  const q = state.myId ? mentionQuery() : null;
  const others = [...state.members].map(([id, m]) => ({ name: m.name, id }));
  const options = q ? [...others, { name: MENTION_ALL, all: true }].filter((o) => o.name.toLowerCase().startsWith(q.query.toLowerCase())) : [];
  if (!q || !options.length) { pop.hidden = true; mentionPick.list = []; return; }
  mentionPick.list = options;
  mentionPick.start = q.start;
  mentionPick.active = Math.min(mentionPick.active, options.length - 1);
  pop.replaceChildren();
  options.forEach((o, i) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mention-item' + (i === mentionPick.active ? ' active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === mentionPick.active));
    item.tabIndex = -1;
    if (o.all) {
      const dot = document.createElement('span');
      dot.className = 'avatar mention-all';
      dot.textContent = '@';
      item.append(dot);
    } else item.append(avatar(o.name, o.id));
    const label = document.createElement('span');
    label.textContent = o.all ? '@todos · chama todo mundo da sala' : o.name;
    if (!o.all) paintName(label, o.id);
    item.append(label);
    item.onmousedown = (e) => { e.preventDefault(); insertMention(i); };
    pop.append(item);
  });
  pop.hidden = false;
}
function insertMention(i) {
  const o = mentionPick.list[i];
  if (!o) return;
  const t = $('chatInput');
  const end = t.selectionStart;
  const text = `@${o.name} `;
  t.value = t.value.slice(0, mentionPick.start) + text + t.value.slice(end);
  const caret = mentionPick.start + text.length;
  t.setSelectionRange(caret, caret);
  $('mentionPop').hidden = true;
  mentionPick.list = [];
  fitChatInput();
  t.focus();
}
$('chatInput').addEventListener('input', () => { mentionPick.active = 0; renderMentionPick(); });
$('chatInput').addEventListener('click', renderMentionPick);
$('chatInput').addEventListener('blur', () => { $('mentionPop').hidden = true; });
// Antes do Enter que envia (inicio.js): com a lista aberta, as teclas são dela
$('chatInput').addEventListener('keydown', (e) => {
  if ($('mentionPop').hidden || !mentionPick.list.length) return;
  const n = mentionPick.list.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { mentionPick.active = (mentionPick.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; renderMentionPick(); }
  else if (e.key === 'Enter' || e.key === 'Tab') insertMention(mentionPick.active);
  else if (e.key === 'Escape') $('mentionPop').hidden = true;
  else return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

// ---------- Comandos do chat ----------
// "/musica <link do YouTube>" (ou /tocar, /música): enquanto escreve, mostra a prévia do vídeo (o próprio player do
// YouTube, parado: capa e título) e onde vai tocar; Enter põe (ou troca) a música do seu canal, como o botão do
// painel de voz. Só "/" mostra os comandos. Texto que começa com "/" sem ser comando vai como mensagem normal.
const CHAT_COMMANDS = [{ name: 'musica', aliases: ['música', 'tocar'], usage: '/musica <link do YouTube>', about: 'Toca no seu canal de voz, todos ouvem junto' }];
const chatCmd = { videoId: '', ready: null, complete: null };
function chatCommandOf(text) {
  const m = /^\/(\S*)(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const cmd = CHAT_COMMANDS.find((c) => c.name === word || c.aliases.includes(word));
  return { word, cmd, arg: (m[2] || '').trim(), typingWord: m[2] === undefined };
}
function renderChatCommand() {
  const box = $('chatCmd');
  const c = state.myId ? chatCommandOf($('chatInput').value) : null;
  chatCmd.ready = null;
  chatCmd.complete = null;
  if (!c) { box.hidden = true; chatCmd.videoId = ''; return; }
  // Ainda escrevendo o nome do comando: a lista do que existe
  if (c.typingWord && !c.cmd) {
    const options = CHAT_COMMANDS.filter((o) => [o.name, ...o.aliases].some((n) => n.startsWith(c.word)));
    chatCmd.videoId = '';
    if (!options.length) { box.hidden = true; return; }
    box.replaceChildren(...options.map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-cmd-item';
      const u = document.createElement('strong');
      u.textContent = o.usage;
      const a = document.createElement('span');
      a.textContent = o.about;
      b.append(u, a);
      b.onmousedown = (e) => { e.preventDefault(); completeChatCommand(o); };
      return b;
    }));
    chatCmd.complete = options[0];
    box.hidden = false;
    return;
  }
  if (!c.cmd) { box.hidden = true; chatCmd.videoId = ''; return; }
  const ch = myVoiceChannel(), playing = state.musicas.get(ch);
  const line = (text, cls = '') => { const p = document.createElement('p'); p.className = `chat-cmd-line ${cls}`; p.textContent = text; return p; };
  const videoId = parseYouTube(c.arg);
  const fail = (text, cls) => { box.replaceChildren(line(text, cls)); chatCmd.videoId = ''; };
  if (!state.musicaOn) fail('Esta sala não tem música: quem criou precisa atualizar o app.', 'warn');
  else if (!c.arg) fail('Cole o link de um vídeo do YouTube depois do comando.');
  else if (!videoId) fail('Não reconheci esse link do YouTube.', 'warn');
  else {
    // A prévia é o player do YouTube parado (sem clique): mostra a capa e o título do vídeo
    if (chatCmd.videoId !== videoId || !box.querySelector('iframe')) {
      const frame = document.createElement('iframe');
      frame.className = 'chat-cmd-preview';
      frame.title = 'Prévia do vídeo';
      frame.src = `${YT_ORIGIN}/embed/${videoId}?controls=0&disablekb=1&fs=0&rel=0&iv_load_policy=3&playsinline=1`;
      frame.setAttribute('allow', 'encrypted-media');
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin'); // isolado: não navega a janela do app nem abre janelas
      frame.tabIndex = -1;
      box.replaceChildren(frame);
      chatCmd.videoId = videoId;
    } else box.querySelector('.chat-cmd-line')?.remove();
    box.append(line(playing ? `Enter para trocar a música de ${channelName(ch)}` : `Enter para tocar em ${channelName(ch)}`, 'go'));
    chatCmd.ready = { ch, videoId, playing };
  }
  box.hidden = false;
}
function completeChatCommand(o) {
  const t = $('chatInput');
  t.value = `/${o.name} `;
  t.focus();
  t.setSelectionRange(t.value.length, t.value.length);
  fitChatInput();
  renderChatCommand();
}
function runChatCommand() {
  const r = chatCmd.ready;
  if (!r) return;
  if (r.playing) musicCtl(r.playing, 'trocar', { videoId: r.videoId });
  else { musica.wantOpen = r.ch; send({ type: 'musica-set', videoId: r.videoId }); }
  $('chatInput').value = '';
  fitChatInput();
  renderChatCommand();
}
$('chatInput').addEventListener('input', renderChatCommand);
// Antes do Enter que envia (inicio.js): com um comando na linha, Enter (ou Tab) é dele, e não vai como mensagem
$('chatInput').addEventListener('keydown', (e) => {
  if ($('chatCmd').hidden) return;
  if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && chatCmd.complete) completeChatCommand(chatCmd.complete);
  else if (e.key === 'Enter' && !e.shiftKey && chatCommandOf($('chatInput').value)?.cmd) runChatCommand();
  else if (e.key === 'Escape') $('chatCmd').hidden = true;
  else return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
