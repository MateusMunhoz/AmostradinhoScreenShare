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
    item.textContent = option.textContent;
    item.style.fontFamily = option.style.fontFamily;
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
function placeList() {
  const { button, pop } = openList;
  const r = button.getBoundingClientRect(), gap = 4, margin = 8;
  const below = innerHeight - r.bottom - margin, above = r.top - margin;
  const down = below >= Math.min(320, pop.scrollHeight) || below >= above;
  pop.style.left = Math.max(margin, Math.min(r.left, innerWidth - margin - r.width)) + 'px';
  pop.style.minWidth = r.width + 'px';
  pop.style.maxHeight = Math.max(120, Math.min(360, down ? below : above) - gap) + 'px';
  if (down) { pop.style.top = r.bottom + gap + 'px'; pop.style.bottom = ''; }
  else { pop.style.bottom = innerHeight - r.top + gap + 'px'; pop.style.top = ''; }
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
  else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Digitar as primeiras letras pula para a opção
    const now = Date.now();
    typed = (now - typedAt > 700 ? '' : typed) + e.key.toLowerCase(); typedAt = now;
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const i = list.items.findIndex((x) => norm(x.option.textContent).startsWith(norm(typed)));
    if (i !== -1) setActive(i);
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
// Rolar a página ou mudar o tamanho da janela fecha a lista (rolar dentro dela, não)
document.addEventListener('scroll', (e) => { if (openList && e.target !== openList.pop) closeList(false); }, true);
window.addEventListener('resize', () => closeList(false));
window.addEventListener('blur', () => closeList(false));

for (const select of document.querySelectorAll('select')) enhanceSelect(select);
