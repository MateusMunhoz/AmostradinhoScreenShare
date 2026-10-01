'use strict';
// Listas de opções no tema do app. A lista nativa do <select> é desenhada pelo Windows (cinza claro, sem vidro),
// então cada <select> ganha um botão e uma lista feitos aqui, com o fundo das janelas (opaco ou vidro).
// O <select> continua sendo a fonte da verdade: o resto do código lê e muda .value e ouve 'change' como antes.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util.

const selectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const selectIndex = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
let openList = null; // { select, button, pop, items, active }

function selectLabel(select) {
  const label = select.id && document.querySelector(`label[for="${CSS.escape(select.id)}"]`) || select.closest('label');
  if (!label) return select.getAttribute('aria-label') || '';
  return [...label.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ').trim() || label.textContent.trim();
}

function refreshSelectButton(select) {
  const button = select._listButton;
  if (!button) return;
  const option = select.options[selectIndex.get.call(select)];
  button.firstChild.textContent = option ? option.textContent : '';
  button.style.fontFamily = option?.style.fontFamily || '';
  button.disabled = select.disabled;
}

function enhanceSelect(select) {
  if (select._listButton) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'select-btn ' + select.className;
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', selectLabel(select));
  button.append(document.createElement('span'));
  select._listButton = button;
  select.classList.add('select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.after(button);
  // Código que muda .value ou .selectedIndex direto (sem evento) também atualiza o botão
  Object.defineProperty(select, 'value', { configurable: true, get() { return selectValue.get.call(this); }, set(v) { selectValue.set.call(this, v); refreshSelectButton(this); } });
  Object.defineProperty(select, 'selectedIndex', { configurable: true, get() { return selectIndex.get.call(this); }, set(v) { selectIndex.set.call(this, v); refreshSelectButton(this); } });
  new MutationObserver(() => refreshSelectButton(select)).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
  const label = select.id && document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
  if (label) label.addEventListener('click', (e) => { e.preventDefault(); button.focus(); });
  button.onclick = () => (openList?.select === select ? closeList(true) : openListFor(select));
  button.onkeydown = (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openListFor(select); }
    // Com a lista fechada, digitar uma letra abre e já pula para a opção
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openListFor(select); typeToFind(e.key); }
  };
  refreshSelectButton(select);
}

function openListFor(select) {
  closeList(false);
  const button = select._listButton;
  if (button.disabled) return;
  const pop = document.createElement('div');
  pop.className = 'select-pop';
  pop.setAttribute('role', 'listbox');
  pop.id = (select.id || 'lista') + '-opcoes';
  pop.tabIndex = -1;
  pop.setAttribute('aria-label', button.getAttribute('aria-label'));
  const items = [];
  const addOption = (option, parent) => {
    if (option.hidden) return;
    const item = document.createElement('div');
    item.className = 'select-item';
    item.setAttribute('role', 'option');
    item.id = `${pop.id}-${items.length}`;
    item.style.fontFamily = option.style.fontFamily;
    const text = document.createElement('span');
    text.className = 'select-text';
    text.textContent = option.textContent;
    item.append(text);
    // Amostra (ex.: o seu nome em cada fonte, na lista "Fonte do nome"): select.listSample() devolve o texto
    const sample = select.listSample?.();
    if (sample) {
      const s = document.createElement('span');
      s.className = 'select-sample';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = sample;
      item.append(s);
    }
    item.setAttribute('aria-selected', String(option.selected));
    if (option.disabled) item.setAttribute('aria-disabled', 'true');
    item.onpointerdown = (e) => e.preventDefault(); // o foco fica na lista
    item.onclick = () => { if (!option.disabled) choose(option); };
    item.onpointermove = () => setActive(items.indexOf(entry));
    const entry = { item, option };
    items.push(entry);
    parent.append(item);
  };
  for (const child of select.children) {
    if (child.tagName === 'OPTGROUP') {
      const group = document.createElement('div');
      group.setAttribute('role', 'group');
      const title = document.createElement('div');
      title.className = 'select-group';
      title.id = `${pop.id}-g${items.length}`;
      title.textContent = child.label;
      group.setAttribute('aria-labelledby', title.id);
      group.append(title);
      for (const option of child.children) addOption(option, group);
      pop.append(group);
    } else addOption(child, pop);
  }
  (select.closest('.modal') || document.body).append(pop);
  openList = { select, button, pop, items, active: -1 };
  placeList();
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-controls', pop.id);
  setActive(Math.max(0, items.findIndex((x) => x.option.selected)));
  pop.focus();
  pop.onkeydown = listKey;
}

// Abre para baixo; se não couber, para cima. Nunca passa da janela.
// A lista é "fixed", mas não conta a partir da janela: o body desce 32 px por causa da barra de título e tem
// contain: layout, então é ele que serve de referência. Mede onde fica o 0 de verdade (em cima, à esquerda e
// embaixo) e desconta, senão a lista ficava 32 px mais baixa e passava da borda de baixo da janela.
function placeList() {
  const { button, pop } = openList;
  const r = button.getBoundingClientRect(), gap = 4, margin = 8;
  const below = innerHeight - margin - (r.bottom + gap), above = r.top - gap - margin;
  const down = below >= Math.min(320, pop.scrollHeight) || below >= above;
  Object.assign(pop.style, { top: '0px', left: '0px', bottom: '' });
  const origin = pop.getBoundingClientRect();
  pop.style.top = ''; pop.style.bottom = '0px';
  const floor = pop.getBoundingClientRect().bottom;
  pop.style.left = Math.max(margin, Math.min(r.left, innerWidth - margin - r.width)) - origin.left + 'px';
  pop.style.minWidth = r.width + 'px';
  const maxH = Math.min(Math.max(120, Math.min(360, down ? below : above)), innerHeight - 2 * margin);
  pop.style.maxHeight = maxH + 'px';
  // Campo meio escondido (na beirada de uma área que rola): a lista sobe ou desce o que precisar para caber
  // inteira na janela, mesmo cobrindo um pouco o campo
  if (down) { pop.style.top = Math.min(r.bottom + gap, innerHeight - margin - maxH) - origin.top + 'px'; pop.style.bottom = ''; }
  else { pop.style.bottom = floor - Math.max(r.top - gap, margin + maxH) + 'px'; pop.style.top = ''; }
}

function setActive(i) {
  const list = openList;
  if (!list || i < 0 || i >= list.items.length) return;
  list.items[list.active]?.item.classList.remove('active');
  list.active = i;
  const { item } = list.items[i];
  item.classList.add('active');
  list.pop.setAttribute('aria-activedescendant', item.id);
  item.scrollIntoView({ block: 'nearest' });
}

function choose(option) {
  const { select } = openList;
  const changed = !option.selected;
  select.value = option.value;
  closeList(true);
  if (changed) {
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

let typed = '', typedAt = 0;
function listKey(e) {
  const list = openList;
  const step = (from, dir) => {
    for (let i = from + dir; i >= 0 && i < list.items.length; i += dir) if (!list.items[i].option.disabled) return i;
    return from;
  };
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeList(true); }
  else if (e.key === 'Tab') { e.preventDefault(); closeList(true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(step(list.active, 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(step(list.active, -1)); }
  else if (e.key === 'Home') { e.preventDefault(); setActive(step(-1, 1)); }
  else if (e.key === 'End') { e.preventDefault(); setActive(step(list.items.length, -1)); }
  else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); setActive(Math.max(0, Math.min(list.items.length - 1, list.active + (e.key === 'PageDown' ? 8 : -8)))); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const x = list.items[list.active]; if (x && !x.option.disabled) choose(x.option); }
  else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typeToFind(e.key); }
}
// Digitar as primeiras letras pula para a opção. A mesma letra de novo vai para a próxima que começa com ela
// ("g", "g": Gabriola, depois Georgia), como na lista do Windows.
function typeToFind(key) {
  const list = openList;
  if (!list) return;
  const now = Date.now();
  typed = (now - typedAt > 700 ? '' : typed) + key.toLowerCase(); typedAt = now;
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const same = [...typed].every((c) => c === typed[0]);
  const want = same ? typed[0] : typed;
  const n = list.items.length, from = same ? list.active + 1 : 0;
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    if (!list.items[i].option.disabled && norm(list.items[i].option.textContent).startsWith(norm(want))) { setActive(i); return; }
  }
}

function closeList(focusButton) {
  if (!openList) return;
  const { button, pop } = openList;
  openList = null;
  pop.remove();
  button.setAttribute('aria-expanded', 'false');
  button.removeAttribute('aria-controls');
  if (focusButton) button.focus();
}

document.addEventListener('pointerdown', (e) => {
  if (openList && !openList.pop.contains(e.target) && !openList.button.contains(e.target)) closeList(false);
}, true);
// Rolar a página (ou a área onde está o campo) ou mudar o tamanho da janela fecha a lista. Rolar dentro dela ou
// num painel sem relação (o chat com mensagem nova, a Rede se atualizando) não: a lista continua no lugar certo.
document.addEventListener('scroll', (e) => {
  if (openList && e.target !== openList.pop && (e.target === document || e.target.contains(openList.button))) closeList(false);
}, true);
window.addEventListener('resize', () => closeList(false));
window.addEventListener('blur', () => closeList(false));

for (const select of document.querySelectorAll('select')) enhanceSelect(select);
