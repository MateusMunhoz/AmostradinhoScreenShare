'use strict';
// Mensagens diretas entre amigos (contas Razze), fora da sala: vão pela RazzeAPI (POST/GET /v1/messages) e o
// histórico completo fica num arquivo por amigo neste PC (main/mensagens.js). O servidor guarda só 30 dias.
// Criptografadas de ponta a ponta no processo principal (main/mensagens-cripto.js): aqui chega texto normal, com
// as marcas e2e, plain (de antes, sem criptografia), locked (não abre neste PC) e keyChanged (a chave do amigo mudou).
// - Barra de conversas, embaixo: o "Mensagens" abre para cima a lista das conversas (amigos e quem já conversou com
//   você, com a última mensagem e as não lidas); um chip por conversa aberta. Arrastar um chip (ou Alt+←/→) muda a
//   ordem; as que não cabem na largura vão para o "+N" no fim da barra, que lista e traz de volta. Clicar abre a janela (o mesmo desenho do chat da
//   sala); o "—" minimiza de volta para o chip; o X tira da barra (o histórico continua no arquivo).
//   Clicar fora da janela minimiza; o alfinete trava a janela aberta (fica salvo com a barra).
// Mensagem nova de alguém fora da barra: a conversa entra na barra, minimizada, com o número de não lidas.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, tema, chat, conectividade, hub.

const DM_POLL_MS = 4000;
const dm = {
  account: '', convs: new Map(), bar: [], cursor: 0, timer: null, polling: false,
  unsupported: false, error: '', filter: '',
};

const dmKey = (k) => `${k}.${dm.account}`;
function dmSaveBar() {
  save(dmKey('dmBar'), JSON.stringify(dm.bar.map(({ id, open, pinned }) => ({ id, open, ...(pinned ? { pinned: true } : {}) }))));
  save(dmKey('dmUnread'), JSON.stringify(Object.fromEntries([...dm.convs].filter(([, c]) => c.unread).map(([id, c]) => [id, c.unread]))));
}
function friendName(id) {
  return friendsData.friends.find((f) => f.id === id)?.displayName || dm.convs.get(id)?.name || 'Amigo';
}
function friendOnline(id) { return !friendsData.error && !!friendsData.friends.find((f) => f.id === id)?.online; }
function dmUnreadTotal() { let n = 0; for (const c of dm.convs.values()) n += c.unread; return n; }
function dmConv(id) {
  let c = dm.convs.get(id);
  if (!c) { c = { id, name: '', messages: [], loaded: false, unread: 0, last: null, el: null, shown: 0 }; dm.convs.set(id, c); }
  return c;
}
async function dmLoadConv(c) {
  if (c.loaded || !dm.account) return;
  const data = await window.api.dmLoad(dm.account, c.id).catch(() => ({ name: '', messages: [] }));
  const byId = new Map(data.messages.map((m) => [m.id, m]));
  for (const m of c.messages) byId.set(m.id, m); // o que chegou antes de o arquivo carregar
  c.messages = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
  c.name = c.name || data.name;
  c.last = c.messages.at(-1) || c.last;
  c.loaded = true;
}
function dmSaveConv(c) {
  if (!dm.account) return;
  c.name = friendName(c.id);
  window.api.dmSave(dm.account, c.id, { name: c.name, messages: c.messages }).catch(() => {});
}
function dmAdd(c, m) {
  if (c.messages.some((x) => x.id === m.id)) return false;
  c.messages.push({ id: m.id, seq: m.seq || 0, from: m.from, text: m.text, createdAt: m.createdAt,
    ...(m.e2e ? { e2e: true } : {}), ...(m.plain ? { plain: true } : {}), ...(m.locked ? { locked: true } : {}), ...(m.keyChanged ? { keyChanged: true } : {}) });
  c.messages.sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
  c.last = c.messages.at(-1);
  return true;
}

// ---------- Conta: liga e desliga junto com o login Razze (conectividade.js) ----------
async function dmStart(account) {
  if (!/^[a-f0-9]{32}$/.test(String(account)) || dm.account === account) return;
  dmStop();
  dm.account = account;
  dm.cursor = Number(load(dmKey('dmCursor'), '0')) || 0;
  let bar = [], unread = {};
  try { bar = JSON.parse(load(dmKey('dmBar'), '[]')); } catch {}
  try { unread = JSON.parse(load(dmKey('dmUnread'), '{}')); } catch {}
  for (const s of await window.api.dmList(account).catch(() => [])) {
    const c = dmConv(s.friend);
    c.name = s.name; c.last = s.last;
  }
  for (const [id, n] of Object.entries(unread)) if (/^[a-f0-9]{32}$/.test(id)) dmConv(id).unread = Math.max(0, Number(n) || 0);
  dm.bar = (Array.isArray(bar) ? bar : []).filter((b) => /^[a-f0-9]{32}$/.test(String(b?.id))).map((b) => ({ id: b.id, open: !!b.open, pinned: !!b.pinned }));
  for (const b of dm.bar) { const c = dmConv(b.id); if (b.open) await dmLoadConv(c); }
  renderDm();
  void dmPoll();
  dm.timer = setInterval(dmPoll, DM_POLL_MS);
}
function dmStop() {
  clearInterval(dm.timer);
  dm.timer = null;
  for (const c of dm.convs.values()) c.el?.slot.remove();
  Object.assign(dm, { account: '', convs: new Map(), bar: [], cursor: 0, unsupported: false, error: '' });
  renderDm();
}

// Busca o que chegou (e o que você mandou de outro PC) desde a última vez
async function dmPoll() {
  if (dm.polling || !dm.account || dm.unsupported) return;
  dm.polling = true;
  const account = dm.account;
  let incoming = false;
  let ligando = null; // chamada que acabou de chegar (chamada.js)
  const changed = new Set();
  try {
    for (let page = 0; page < 20; page++) {
      const res = await window.api.razzeMessages(dm.cursor);
      if (dm.account !== account) return;
      for (const m of res.messages || []) {
        dm.cursor = Math.max(dm.cursor, Number(m.seq) || 0);
        const mine = m.from === account;
        const c = dmConv(mine ? m.to : m.from);
        await dmLoadConv(c);
        if (!dmAdd(c, m)) continue;
        changed.add(c);
        if (!mine && !dmIsOpen(c.id)) { c.unread++; dmPutInBar(c.id, false); incoming = true; }
        const cv = !mine && !m.locked && lerConvite(m.text);
        if (cv?.chamada && Date.now() - m.createdAt < CHAMADA_AVISO_MS) ligando = { cv, quem: friendName(c.id) };
      }
      if (!res.more) break;
    }
    dm.error = '';
    save(dmKey('dmCursor'), String(dm.cursor));
  } catch (error) {
    // Servidor Razze antigo, sem mensagens diretas: para de perguntar e avisa na aba
    if (error?.message?.includes('Endpoint não encontrado')) dm.unsupported = true;
    dm.error = error?.message || 'Não foi possível buscar as mensagens.';
  } finally {
    dm.polling = false;
  }
  for (const c of changed) dmSaveConv(c);
  if (ligando) avisarChamada(ligando.cv, ligando.quem);
  else if (incoming) void appSounds.play('chat');
  if (changed.size || incoming) dmSaveBar();
  renderDm();
}

async function dmSend(c) {
  const input = c.el.input;
  const text = input.value.trim();
  if (!text) return;
  c.el.status.textContent = '';
  // O campo nunca é desativado (isso tiraria o foco): limpa na hora e, se não for, devolve o texto
  input.value = '';
  fitDmInput(input);
  try {
    const res = await window.api.razzeSendMessage(c.id, text);
    if (res?.message) { dmAdd(c, res.message); dmSaveConv(c); }
  } catch (error) {
    c.el.status.textContent = 'Não foi enviada: ' + String(error?.message || 'erro desconhecido').replace(/^.*RazzeApiError: /, '');
    if (!input.value) { input.value = text; fitDmInput(input); }
  } finally {
    renderDm();
  }
}

// ---------- Barra de conversas ----------
const dmIsOpen = (id) => !!dm.bar.find((b) => b.id === id)?.open;
function dmPutInBar(id, open) {
  let b = dm.bar.find((x) => x.id === id);
  if (!b) { b = { id, open }; dm.bar.push(b); }
  else if (open) b.open = true;
  return b;
}
async function openDm(id) {
  if (!dm.account) return;
  const c = dmConv(id);
  await dmLoadConv(c);
  dmPutInBar(id, true);
  dmBringIntoView(id);
  c.unread = 0;
  dmSaveBar();
  if (typeof hub === 'object' && hub.open) setHubOpen(false);
  setDmPanel(false);
  renderDm();
  c.el?.input.focus();
  dmScrollEnd(c, true);
}
function minimizeDm(id) {
  const b = dm.bar.find((x) => x.id === id);
  if (b) b.open = false;
  dmSaveBar();
  renderDm();
}
async function toggleDm(id) { if (dmIsOpen(id)) minimizeDm(id); else await openDm(id); }
function toggleDmPin(id) {
  const b = dm.bar.find((x) => x.id === id);
  if (!b) return;
  b.pinned = !b.pinned;
  dmSaveBar();
  renderDm();
}
// Clique fora de uma janela aberta (e do chip dela) minimiza, menos as travadas. Diálogos, balões de dica e
// avisos não contam como "fora" (podem ter sido abertos por algo dentro da janela, como o Entrar de um convite).
function minimizeDmOutside(target) {
  if (target.closest?.('dialog, .dialog, #tipBubble, .toast')) return;
  let changed = false;
  for (const b of dm.bar) {
    if (!b.open || b.pinned) continue;
    const slot = dm.convs.get(b.id)?.el?.slot;
    if (slot && slot.contains(target)) continue;
    b.open = false;
    changed = true;
  }
  if (!changed) return;
  dmSaveBar();
  renderDm();
}
// Tira da barra: o histórico continua no arquivo e volta quando abrir de novo (pela lista do "Mensagens")
function closeDm(id) {
  dm.bar = dm.bar.filter((b) => b.id !== id);
  const c = dm.convs.get(id);
  if (c) { c.unread = 0; c.el?.slot.remove(); c.el = null; c.shown = 0; }
  dmSaveBar();
  renderDm();
}

function dmIconButton(cls, icon, label, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.innerHTML = icon;
  b.title = b.ariaLabel = label;
  b.onclick = (e) => { e.stopPropagation(); onclick(); };
  return b;
}
function fitDmInput(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; }
function dmScrollEnd(c, force = false) {
  const list = c.el?.list;
  if (!list) return;
  if (force || list.scrollHeight - list.scrollTop - list.clientHeight < 80) list.scrollTop = list.scrollHeight;
}

// Os elementos de cada conversa são criados uma vez (o rascunho e a rolagem não se perdem a cada atualização)
function dmElements(c) {
  if (c.el) return c.el;
  const slot = document.createElement('div');
  slot.className = 'dm-slot';
  const win = document.createElement('section');
  win.className = 'dm-window';
  const list = document.createElement('ul');
  list.className = 'chat-list dm-list';
  list.setAttribute('aria-live', 'polite');
  const empty = document.createElement('p');
  empty.className = 'hint dm-empty';
  const status = document.createElement('p');
  status.className = 'dm-status';
  status.setAttribute('role', 'status');
  const form = document.createElement('form');
  form.className = 'chat-form dm-form';
  const input = document.createElement('textarea');
  input.rows = 1;
  input.maxLength = 2000;
  input.setAttribute('aria-label', 'Mensagem');
  input.addEventListener('input', () => fitDmInput(input));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void dmSend(c); } if (e.key === 'Escape') { e.preventDefault(); minimizeDm(c.id); } });
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'btn primary icon';
  setIcon(sendBtn, 'send', 'Enviar');
  form.onsubmit = (e) => { e.preventDefault(); void dmSend(c); };
  form.append(input, sendBtn);
  win.append(empty, list, status, form);
  const chip = document.createElement('div');
  chip.className = 'dm-chip';
  chip.tabIndex = 0;
  chip.setAttribute('role', 'button');
  chip.onclick = () => void toggleDm(c.id);
  chip.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void toggleDm(c.id); }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); dmMoveBy(c.id, e.key === 'ArrowLeft' ? -1 : 1); chip.focus(); }
  };
  dmDraggable(slot, chip, c.id);
  const dot = document.createElement('span');
  dot.className = 'dm-dot';
  const name = document.createElement('span');
  name.className = 'dm-name';
  const badge = document.createElement('span');
  badge.className = 'hub-badge dm-badge';
  const call = dmIconButton('dm-chip-btn dm-call-btn', ICON.phone, 'Ligar (cria uma sala só para vocês e entra na voz)', () => void ligarPara(c.id));
  const pin = dmIconButton('dm-chip-btn dm-pin', ICON.pin, 'Travar aberta', () => toggleDmPin(c.id));
  const min = dmIconButton('dm-chip-btn dm-min', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>', 'Minimizar', () => minimizeDm(c.id));
  const close = dmIconButton('dm-chip-btn', ICON.close, 'Fechar a conversa (o histórico fica salvo neste PC)', () => closeDm(c.id));
  chip.append(dot, name, badge, call, pin, min, close);
  slot.append(win, chip);
  c.el = { slot, win, list, empty, status, input, chip, dot, name, badge, pin, min };
  return c.el;
}

function dmMessageEl(c, m, prev) {
  const mine = m.from === dm.account;
  const li = document.createElement('li');
  li.className = 'msg' + (mine ? ' mine' : '') + (prev && prev.from === m.from && m.createdAt - prev.createdAt < 5 * 60 * 1000 ? ' grouped' : '');
  li.style.setProperty('--person', personColor(mine ? 'me' : c.id));
  const d = new Date(m.createdAt);
  const when = document.createElement('time');
  when.className = 'msg-time';
  when.textContent = `${two(d.getHours())}:${two(d.getMinutes())}`;
  when.title = d.toLocaleString('pt-BR');
  const line = document.createElement('p');
  line.className = 'msg-line';
  const who = document.createElement('strong');
  who.className = 'msg-who';
  who.textContent = mine ? (razzeUser?.displayName || 'Você') : friendName(c.id);
  if (mine) who.dataset.nameOf = 'me';
  const sep = document.createElement('span');
  sep.className = 'msg-sep';
  sep.textContent = ' : ';
  const text = document.createElement('span');
  text.className = 'msg-text';
  const convite = !m.locked && lerConvite(m.text); // convite para uma sala: vira um cartão com Entrar (salas-amigos.js)
  if (m.locked) {
    text.classList.add('dm-locked');
    text.textContent = 'Mensagem criptografada para outro PC: não dá para abrir aqui.';
    text.title = 'Ela foi cifrada para a chave de outro PC desta conta (ou de antes de trocar de PC).';
  } else if (!convite) textWithLinks(text, m.text);
  if (convite) line.append(who); else line.append(who, sep, text);
  if (m.plain) {
    const tag = document.createElement('span');
    tag.className = 'dm-plain';
    tag.textContent = 'sem criptografia';
    tag.title = 'Mandada antes das mensagens criptografadas: o servidor pôde ler esta.';
    line.append(tag);
  }
  const body = document.createElement('div');
  body.className = 'msg-body';
  if (m.keyChanged) {
    const note = document.createElement('p');
    note.className = 'dm-key-changed';
    note.textContent = `A chave de segurança de ${friendName(c.id)} mudou. Acontece quando a pessoa troca de PC ou reinstala o app; se não foi isso, confirme com ela por outro meio.`;
    body.append(note);
  }
  body.append(line);
  if (convite) body.append(cartaoConvite(convite, mine, friendName(c.id), m.createdAt));
  li.append(when, body);
  return li;
}

function renderDmWindow(c, open) {
  const el = dmElements(c);
  const online = friendOnline(c.id);
  el.slot.classList.toggle('open', open);
  el.chip.classList.toggle('has-unread', c.unread > 0);
  el.chip.title = open ? `Minimizar a conversa com ${friendName(c.id)}` : `Abrir a conversa com ${friendName(c.id)}`;
  el.chip.setAttribute('aria-expanded', String(open));
  el.dot.classList.toggle('on', online);
  el.dot.title = online ? 'Online' : 'Offline';
  el.name.textContent = friendName(c.id);
  el.badge.hidden = !c.unread;
  el.badge.textContent = c.unread > 99 ? '99+' : String(c.unread);
  const pinned = !!dm.bar.find((b) => b.id === c.id)?.pinned;
  el.pin.hidden = !open;
  el.pin.setAttribute('aria-pressed', String(pinned));
  el.pin.title = el.pin.ariaLabel = pinned ? 'Destravar: clicar fora volta a minimizar' : 'Travar aberta: clicar fora não minimiza';
  el.min.hidden = !open;
  el.win.hidden = !open;
  el.input.placeholder = `Mensagem para ${friendName(c.id)}`;
  if (!open) return;
  if (c.shown !== c.messages.length) {
    const atEnd = el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 80;
    el.list.replaceChildren(...c.messages.map((m, i) => dmMessageEl(c, m, c.messages[i - 1])));
    c.shown = c.messages.length;
    if (atEnd || !el.list.dataset.scrolled) { el.list.scrollTop = el.list.scrollHeight; el.list.dataset.scrolled = '1'; }
  }
  el.empty.hidden = c.messages.length > 0;
  el.empty.textContent = `Comece a conversa com ${friendName(c.id)}. As mensagens são criptografadas de ponta a ponta: só vocês dois leem. Chegam mesmo se a pessoa estiver offline (o servidor guarda por 30 dias) e ficam salvas, protegidas, neste PC.`;
}

function renderDmBar() {
  const bar = $('dmBar');
  const on = !!dm.account;
  bar.hidden = !on;
  document.body.classList.toggle('has-dm-bar', on);
  if (!on) return;
  const total = dmUnreadTotal();
  $('dmBarBadge').hidden = !total;
  $('dmBarBadge').textContent = total > 99 ? '99+' : String(total);
  const slots = $('dmSlots');
  // Na ordem da barra, mexendo só no que está fora do lugar: mover um elemento (mesmo para o mesmo lugar) tira o
  // foco do campo de escrever, e isto roda a cada busca de mensagens
  dm.bar.forEach((b, i) => {
    const c = dmConv(b.id);
    renderDmWindow(c, b.open);
    if (slots.children[i] !== c.el.slot) slots.insertBefore(c.el.slot, slots.children[i] || null);
  });
  $('dmBarHint').hidden = dm.bar.length > 0;
  fitDmBar();
}

// ---------- Largura: o que não cabe vai para o "+N" ----------
// Aberta, uma conversa ocupa 340px; minimizada, pelo menos 160px (as larguras do CSS de .dm-slot)
const DM_W_OPEN = 340, DM_W_CHIP = 160, DM_GAP = 6, DM_W_MORE = 56;
function dmVisibleCount() {
  const avail = $('dmBar').clientWidth - $('dmBarLabel').offsetWidth - 10 - DM_GAP;
  const widths = dm.bar.map((b) => (b.open ? DM_W_OPEN : DM_W_CHIP) + DM_GAP);
  if (widths.reduce((a, w) => a + w, 0) <= avail) return dm.bar.length;
  let used = DM_W_MORE + DM_GAP, n = 0;
  while (n < widths.length && used + widths[n] <= avail) used += widths[n++];
  return Math.max(1, n);
}
function fitDmBar() {
  const shown = dmVisibleCount();
  dm.bar.forEach((b, i) => { const el = dm.convs.get(b.id)?.el; if (el) el.slot.hidden = i >= shown; });
  const hidden = dm.bar.slice(shown);
  const more = $('dmMore');
  more.hidden = !hidden.length;
  if (!hidden.length) return setDmMore(false);
  const unread = hidden.reduce((n, b) => n + (dm.convs.get(b.id)?.unread || 0), 0);
  more.textContent = '+' + hidden.length;
  more.classList.toggle('has-unread', unread > 0);
  more.title = 'Mais ' + hidden.length + (hidden.length === 1 ? ' conversa' : ' conversas') + (unread ? ' (' + unread + (unread === 1 ? ' não lida)' : ' não lidas)') : '');
  if (!$('dmMoreMenu').hidden) renderDmMore(hidden);
}
// Abrir uma conversa que está no "+N": ela entra no lugar da última que aparece (que vai para o "+N")
function dmBringIntoView(id) {
  const b = dm.bar.find((x) => x.id === id);
  if (!b) return;
  for (let at = dm.bar.indexOf(b); at > 0 && at >= dmVisibleCount(); at--) { dm.bar.splice(at, 1); dm.bar.splice(at - 1, 0, b); }
}
function setDmMore(open) {
  const menu = $('dmMoreMenu');
  open = open && !$('dmMore').hidden;
  menu.hidden = !open;
  $('dmMore').setAttribute('aria-expanded', String(open));
  if (open) { renderDmMore(dm.bar.slice(dmVisibleCount())); menu.querySelector('button')?.focus(); }
}
function renderDmMore(hidden) {
  $('dmMoreMenu').replaceChildren(...hidden.map((b) => {
    const c = dmConv(b.id);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dm-more-item' + (c.unread ? ' has-unread' : '');
    item.setAttribute('role', 'menuitem');
    item.title = 'Trazer a conversa com ' + friendName(b.id) + ' para a barra';
    const dot = document.createElement('span');
    dot.className = 'dm-dot' + (friendOnline(b.id) ? ' on' : '');
    const name = document.createElement('span');
    name.className = 'dm-name';
    name.textContent = friendName(b.id);
    item.append(dot, name);
    if (c.unread) { const n = document.createElement('span'); n.className = 'hub-badge'; n.textContent = c.unread > 99 ? '99+' : String(c.unread); item.append(n); }
    item.onclick = () => { setDmMore(false); void openDm(b.id); };
    return item;
  }));
}

// ---------- Ordem: arrastar um chip entre os outros (ou Alt+←/→) ----------
function dmMoveTo(id, index) {
  const from = dm.bar.findIndex((b) => b.id === id);
  if (from < 0) return;
  const [b] = dm.bar.splice(from, 1);
  dm.bar.splice(Math.max(0, Math.min(dm.bar.length, index)), 0, b);
  dmSaveBar();
  renderDm();
}
function dmMoveBy(id, step) {
  const i = dm.bar.findIndex((b) => b.id === id);
  if (i >= 0 && i + step >= 0 && i + step < dmVisibleCount()) dmMoveTo(id, i + step);
}
let dmDragId = null;
function dmClearDrop() { for (const el of $('dmSlots').querySelectorAll('.drop-before, .drop-after, .dragging')) el.classList.remove('drop-before', 'drop-after', 'dragging'); }
function dmDraggable(slot, chip, id) {
  chip.draggable = true;
  chip.ondragstart = (e) => {
    dmDragId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-tela-p2p-conversa', id);
    slot.classList.add('dragging');
  };
  chip.ondragend = () => { dmDragId = null; dmClearDrop(); };
  // Soltar em cima de outro chip: antes dele (metade esquerda) ou depois (metade direita)
  const side = (e) => { const r = chip.getBoundingClientRect(); return e.clientX < r.left + r.width / 2 ? 'before' : 'after'; };
  chip.ondragover = (e) => {
    if (!dmDragId || dmDragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const s = side(e);
    slot.classList.toggle('drop-before', s === 'before');
    slot.classList.toggle('drop-after', s === 'after');
  };
  chip.ondragleave = () => slot.classList.remove('drop-before', 'drop-after');
  chip.ondrop = (e) => {
    if (!dmDragId || dmDragId === id) return;
    e.preventDefault();
    const moving = dmDragId, s = side(e);
    dmDragId = null;
    dmClearDrop();
    const rest = dm.bar.filter((b) => b.id !== moving);
    dmMoveTo(moving, rest.findIndex((b) => b.id === id) + (s === 'after' ? 1 : 0));
  };
}

// ---------- Lista das conversas (no painel da barra) ----------
function fillDmList(prefix = 'dmPanel') {
  const box = $(prefix + 'ConvList');
  $(prefix + 'Unsupported').hidden = !dm.unsupported;
  $(prefix + 'Error').textContent = !dm.unsupported && dm.error ? dm.error : '';
  const ids = new Set([...friendsData.friends.map((f) => f.id), ...[...dm.convs.values()].filter((c) => c.last).map((c) => c.id)]);
  const needle = semAcento(dm.filter.trim());
  const rows = [...ids].map((id) => ({ id, c: dm.convs.get(id), name: friendName(id) }))
    .filter((r) => !needle || semAcento(r.name).includes(needle))
    .sort((a, b) => (b.c?.last?.createdAt || 0) - (a.c?.last?.createdAt || 0) || a.name.localeCompare(b.name, 'pt-BR'));
  box.replaceChildren(...rows.map(({ id, c, name }) => {
    const li = document.createElement('li');
    li.className = 'hub-room hub-conv' + (c?.unread ? ' has-unread' : '');
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.onclick = () => void openDm(id);
    li.onkeydown = (e) => { if (e.key === 'Enter') void openDm(id); };
    const last = c?.last;
    const preview = last ? `${last.from === dm.account ? 'você: ' : ''}${last.locked ? 'Mensagem criptografada' : lerConvite(last.text) ? (lerConvite(last.text).chamada ? 'Chamada' : 'Convite para a sala') : last.text.replace(/\s+/g, ' ')}` : friendsData.friends.some((f) => f.id === id) ? 'Nenhuma mensagem ainda' : '';
    const info = hubInfo(name, preview);
    li.append(hubAvatar(name, friendOnline(id)), info);
    if (last) {
      const d = new Date(last.createdAt);
      const t = document.createElement('time');
      t.className = 'hub-conv-time';
      t.textContent = d.toDateString() === new Date().toDateString() ? `${two(d.getHours())}:${two(d.getMinutes())}` : `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
      li.append(t);
    }
    if (c?.unread) { const n = document.createElement('span'); n.className = 'hub-badge'; n.textContent = String(c.unread); li.append(n); }
    return li;
  }));
  $(prefix + 'ConvEmpty').hidden = rows.length > 0;
  $(prefix + 'ConvEmpty').textContent = needle ? `Ninguém com “${dm.filter.trim()}”.` : 'Adicione amigos na aba Amigos para conversar com eles.';
}

// ---------- Painel da barra: o "Mensagens" abre a lista para cima, em cima da barra ----------
function setDmPanel(open) {
  open = open && !!dm.account;
  const was = !$('dmPanel').hidden;
  $('dmPanel').hidden = !open;
  $('dmBarLabel').setAttribute('aria-expanded', String(open));
  $('dmBarLabel').classList.toggle('open', open);
  if (!open) return;
  renderDmPanel();
  if (!was) { $('dmPanelFilter').value = dm.filter; $('dmPanelFilter').focus(); }
}
function renderDmPanel() { if (!$('dmPanel').hidden) fillDmList('dmPanel'); }

function renderDm() {
  renderDmBar();
  if (!dm.account) setDmPanel(false);
  renderDmPanel();
  if (typeof renderHub === 'function') renderHub();
}

function setupDm() {
  $('dmBarLabel').onclick = () => setDmPanel($('dmPanel').hidden);
  $('dmPanelClose').onclick = () => { setDmPanel(false); $('dmBarLabel').focus(); };
  $('dmPanelFilter').oninput = () => { dm.filter = $('dmPanelFilter').value; renderDmPanel(); };
  $('dmMore').onclick = () => setDmMore($('dmMoreMenu').hidden);
  new ResizeObserver(() => { if (dm.account) fitDmBar(); }).observe($('dmBar'));
  // Clicar fora do painel (e fora do botão que abre) fecha
  document.addEventListener('pointerdown', (e) => {
    minimizeDmOutside(e.target);
    if (!$('dmPanel').hidden && !e.target.closest?.('#dmPanel, #dmBarLabel')) setDmPanel(false);
    if (!$('dmMoreMenu').hidden && !e.target.closest?.('#dmMoreMenu, #dmMore')) setDmMore(false);
  });
  // Voltando para o app: busca na hora (sem esperar os 4 s)
  window.addEventListener('focus', () => void dmPoll());
}
