'use strict';
// Mensagens diretas entre amigos (contas Razze), fora da sala: vão pela RazzeAPI (POST/GET /v1/messages) e o
// histórico completo fica num arquivo por amigo neste PC (main/mensagens.js). O servidor guarda só 30 dias.
// - HUB, aba Mensagens: as conversas (amigos e quem já conversou com você), com a última mensagem e as não lidas.
// - Barra de conversas, embaixo: um chip por conversa aberta. Clicar abre a janela (o mesmo desenho do chat da
//   sala); o "—" minimiza de volta para o chip; o X tira da barra (o histórico continua no arquivo).
// Mensagem nova de alguém fora da barra: a conversa entra na barra, minimizada, com o número de não lidas.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, tema, chat, conectividade, hub.

const DM_POLL_MS = 4000;
const dm = {
  account: '', convs: new Map(), bar: [], cursor: 0, timer: null, polling: false,
  unsupported: false, error: '', filter: '',
};

const dmKey = (k) => `${k}.${dm.account}`;
function dmSaveBar() {
  save(dmKey('dmBar'), JSON.stringify(dm.bar.map(({ id, open }) => ({ id, open }))));
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
  c.messages.push({ id: m.id, seq: m.seq || 0, from: m.from, text: m.text, createdAt: m.createdAt });
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
  dm.bar = (Array.isArray(bar) ? bar : []).filter((b) => /^[a-f0-9]{32}$/.test(String(b?.id))).map((b) => ({ id: b.id, open: !!b.open }));
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
  if (incoming) void appSounds.play('chat');
  if (changed.size || incoming) dmSaveBar();
  renderDm();
}

async function dmSend(c) {
  const input = c.el.input;
  const text = input.value.trim();
  if (!text) return;
  c.el.status.textContent = '';
  input.disabled = true;
  try {
    const res = await window.api.razzeSendMessage(c.id, text);
    if (res?.message) { dmAdd(c, res.message); dmSaveConv(c); }
    input.value = '';
    fitDmInput(input);
  } catch (error) {
    c.el.status.textContent = 'Não foi enviada: ' + (error?.message || 'erro desconhecido');
  } finally {
    input.disabled = false;
    input.focus();
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
  c.unread = 0;
  dmSaveBar();
  if (typeof hub === 'object' && hub.open) setHubOpen(false);
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
// Tira da barra: o histórico continua no arquivo e volta quando abrir de novo (HUB, aba Mensagens)
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
  chip.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void toggleDm(c.id); } };
  const dot = document.createElement('span');
  dot.className = 'dm-dot';
  const name = document.createElement('span');
  name.className = 'dm-name';
  const badge = document.createElement('span');
  badge.className = 'hub-badge dm-badge';
  const min = dmIconButton('dm-chip-btn dm-min', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>', 'Minimizar', () => minimizeDm(c.id));
  const close = dmIconButton('dm-chip-btn', ICON.close, 'Fechar a conversa (o histórico fica salvo neste PC)', () => closeDm(c.id));
  chip.append(dot, name, badge, min, close);
  slot.append(win, chip);
  c.el = { slot, win, list, empty, status, input, chip, dot, name, badge, min };
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
  textWithLinks(text, m.text);
  line.append(who, sep, text);
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.append(line);
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
  el.empty.textContent = `Comece a conversa com ${friendName(c.id)}. As mensagens chegam mesmo se a pessoa estiver offline (o servidor guarda por 30 dias) e ficam salvas neste PC.`;
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
  for (const b of dm.bar) {
    const c = dmConv(b.id);
    renderDmWindow(c, b.open);
    slots.append(c.el.slot); // na ordem da barra
  }
  $('dmBarHint').hidden = dm.bar.length > 0;
}

// ---------- HUB, aba Mensagens ----------
function renderDmList() {
  const box = $('dmConvList');
  if (!box) return;
  const on = !!dm.account;
  $('dmSignedOut').hidden = on;
  $('dmBody').hidden = !on;
  if (!on) return;
  $('dmUnsupported').hidden = !dm.unsupported;
  $('dmError').textContent = !dm.unsupported && dm.error ? dm.error : '';
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
    const preview = last ? `${last.from === dm.account ? 'você: ' : ''}${last.text.replace(/\s+/g, ' ')}` : friendsData.friends.some((f) => f.id === id) ? 'Nenhuma mensagem ainda' : '';
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
  $('dmConvEmpty').hidden = rows.length > 0;
  $('dmConvEmpty').textContent = needle ? `Ninguém com “${dm.filter.trim()}”.` : 'Adicione amigos na aba Amigos para conversar com eles.';
}

function renderDm() {
  renderDmBar();
  if (typeof renderHub === 'function') renderHub(); // o número de não lidas no HUB e a lista da aba
}

function setupDm() {
  $('dmBarLabel').onclick = () => setHubOpen(true, 'messages');
  $('dmFilter').oninput = () => { dm.filter = $('dmFilter').value; renderDmList(); };
  $('dmOpenLogin').onclick = openRazzeLogin;
  // Voltando para o app: busca na hora (sem esperar os 4 s)
  window.addEventListener('focus', () => void dmPoll());
}
