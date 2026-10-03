'use strict';
// Preferências deste PC. Só a fonte do nome (nameFont) vai para a sala, pelo perfil (navegacao.js).
let appPreferences = AppPreferences.read(localStorage);
let appSkin = AppPreferences.cleanSkin(load('tema', '')); // Configurações > Tema ('' = padrão)
const appSounds = new AppPreferences.SoundPlayer({ settings: () => appPreferences });
let settingsReturnFocus = null;

// Modo gamer (renderer/modo-gamer.js): marcado já aqui, antes do primeiro applyAppTheme, para a janela não abrir
// com o vidro e depois trocar. Com ele ligado, o vidro fica opaco sem mudar a escolha salva
if (load('modoGamer', '') === '1') document.documentElement.dataset.gamer = 'on';
const glassMode = () => (document.documentElement.dataset.gamer === 'on' ? 'opaque' : appPreferences.appearance.glass);

// Material da janela (acrílico do Windows 11) só muda quando o modo muda; a resposta diz se o sistema tem
let windowMaterial = { key: '', material: 'none', supported: false };
function applyWindowMaterial() {
  const mode = glassMode(), key = mode === 'opaque' ? 'opaque|' + appPreferences.colors.main : mode;
  if (windowMaterial.key === key || !window.api?.windowMaterial) return;
  windowMaterial.key = key;
  window.api.windowMaterial(mode, appPreferences.colors.main).then((r) => {
    if (windowMaterial.key !== key) return;
    windowMaterial = { key, material: r?.material || 'none', supported: !!r?.supported };
    document.documentElement.dataset.material = windowMaterial.material;
    if (!$('generalSettingsDialog').hidden) renderGlassHint();
  }).catch(() => {});
}
// Botões minimizar, maximizar e fechar do Windows nas cores do tema: fundo da cor principal (com vidro,
// transparente, para o fundo desenhado aparecer) e símbolos na cor do texto
let titleBarKey = '';
function applyTitleBar() {
  if (!window.api?.setTitleBar) return;
  const c = appPreferences.colors, text = AppPreferences.palette(c)['--text'];
  const color = glassMode() === 'opaque' ? c.main : '#00000000';
  const key = color + text;
  if (key === titleBarKey) return;
  titleBarKey = key;
  window.api.setTitleBar(color, text).catch(() => {});
}
// Ícone da janela na barra de tarefas: a logo (nas cores dela); os temas E.V.A e Arasaka têm o próprio
let appIconColor = '';
function applyAppIcon() {
  // Tema E.V.A: o rosto do EVA-01; tema Arasaka: o emblema da corporação; senão, as duas telas
  const color = AppPreferences.palette(appPreferences.colors)['--accent'];
  const skin = document.documentElement.dataset.skin || '';
  const eva = skin === 'eva';
  const key = eva ? 'eva' : color + skin;
  if (key === appIconColor || !window.api?.setWindowIcon) return;
  appIconColor = key;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  if (eva) drawEvaIcon(canvas.getContext('2d'), 256);
  else (skin === 'arasaka' ? drawArasakaIcon : drawAppIcon)(canvas.getContext('2d'), 256, color);
  window.api.setWindowIcon(canvas.toDataURL('image/png')).catch(() => {});
}
// A imagem de fundo saiu do app: apaga a que tenha ficado guardada
try { localStorage.removeItem('appWallpaper.v1'); } catch {}
// Largura do chat e da voz (alça em renderer/navegacao.js). 0 = a automática do styles.css; nunca passa de 55% da janela
function applyPaneWidth(px) {
  const root = document.documentElement;
  if (px > 0) root.style.setProperty('--workspace-width', `min(${px}px, 55vw)`);
  else root.style.removeProperty('--workspace-width');
}
function applyAppTheme(d = document) {
  const root = d.documentElement;
  for (const [key, value] of Object.entries(AppPreferences.palette(appPreferences.colors))) root.style.setProperty(key, value);
  // Tema (aba Tema): o desenho do app inteiro. Continua mesmo se as cores forem ajustadas depois.
  const skin = appSkin;
  if (skin) root.dataset.skin = skin; else delete root.dataset.skin;
  const fonts = AppPreferences.fontStacks(appPreferences.font);
  // Com a fonte padrão, o Arasaka usa a Bahnschrift (vem no Windows) e números em fonte fixa
  if (skin === 'arasaka' && appPreferences.font.family === 'system') {
    fonts.body = fonts.display = 'Bahnschrift, "Segoe UI", system-ui, sans-serif';
    fonts.console = '"Cascadia Mono", Consolas, monospace';
  }
  // Com a fonte padrão, o E.V.A usa a Chakra Petch (painel) e a Share Tech Mono no chat, como terminal (incluídas no app)
  if (skin === 'eva' && appPreferences.font.family === 'system') {
    fonts.body = fonts.display = '"Chakra Petch", "Segoe UI", system-ui, sans-serif';
    fonts.console = '"Share Tech Mono", Consolas, monospace';
  }
  // Com a fonte padrão, o Du'Sol usa a Bahnschrift (vem no Windows) nos títulos, como o letreiro dele
  if (skin === 'dusol' && appPreferences.font.family === 'system') fonts.display = 'Bahnschrift, "Segoe UI", system-ui, sans-serif';
  // O letreiro na lateral (index.html › #themeDecor) é do E.V.A
  if (d === document) $('themeDecor').hidden = skin !== 'eva';
  root.style.setProperty('--font-body', fonts.body);
  root.style.setProperty('--font-display', fonts.display);
  root.style.setProperty('--font-console', fonts.console);
  const borders = AppPreferences.borders(appPreferences.colors, appPreferences.appearance);
  if (borders) for (const [key, value] of Object.entries(borders)) root.style.setProperty(key, value);
  else root.style.removeProperty('--edge-sheen');
  root.dataset.border = appPreferences.appearance.border;
  // As janelas por cima do jogo usam painéis translúcidos, sem o fundo da página principal.
  if (d !== document) {
    root.style.setProperty('--text', 'var(--surface-text)');
    root.style.setProperty('--muted', 'var(--surface-muted)');
    return;
  }
  // Vidro: só na janela principal; as flutuantes já são translúcidas por cima do jogo
  const glass = AppPreferences.glass(appPreferences.colors, { ...appPreferences.appearance, glass: glassMode() });
  for (const [key, value] of Object.entries(glass || {})) root.style.setProperty(key, value);
  root.dataset.glass = glassMode();
  // Interface espelhada: HUB na direita, barrinha e painéis de chat e voz na esquerda (styles.css)
  root.dataset.mirror = appPreferences.appearance.mirror ? 'on' : 'off';
  applyPaneWidth(appPreferences.appearance.paneWidth);
  applyWindowMaterial();
  applyTitleBar();
  applyAppIcon();
}
applyAppTheme();

function saveAppPreferences() {
  try {
    appPreferences = AppPreferences.write(localStorage, appPreferences);
    $('settingsSaveStatus').textContent = 'Salvo neste dispositivo. As escolhas continuam ao reabrir o app.';
  } catch { $('settingsSaveStatus').textContent = 'Não foi possível salvar neste dispositivo. As alterações valem apenas nesta sessão.'; }
  applyAppTheme();
  for (const p of state.pips.values()) if (!p.win.closed) applyAppTheme(p.win.document);
  if (overlay.p && !overlay.p.win.closed) applyAppTheme(overlay.p.win.document);
}

function renderGeneralSettings() {
  const effective = AppPreferences.palette(appPreferences.colors);
  const shown = { text: '--text', live: '--live', speaking: '--ok', warn: '--warn', line: '--line' };
  for (const [key, value] of Object.entries(appPreferences.colors)) {
    // Automática: o campo mostra, em cinza, a cor calculada
    const color = value || effective[shown[key]];
    $('color-' + key).value = color;
    $('hex-' + key).value = color;
    $('hex-' + key).classList.toggle('is-auto', !value);
    $('hex-' + key).removeAttribute('aria-invalid');
    $('error-' + key).hidden = true;
  }
  for (const event of AppPreferences.events) {
    $('sound-' + event).value = appPreferences.sounds[event];
    $('preview-' + event).disabled = appPreferences.sounds[event] === 'none';
    $('volume-' + event).value = appPreferences.sounds.levels[event];
    $('value-' + event).textContent = appPreferences.sounds.levels[event] + '%';
  }
  renderAppearance();
  $('muteChatSound').checked = appPreferences.sounds.chatMuted;
  $('notificationVolume').value = appPreferences.sounds.volume;
  $('notificationVolumeValue').textContent = `${appPreferences.sounds.volume}%`;
}
function openGeneralSettings() {
  if (!$('friendsDialog').hidden) closeFriendsDialog();
  if (!$('profilePane').hidden) closeProfilePopup();
  if (!$('networkDialog').hidden) closeNetworkDialog();
  settingsReturnFocus = document.activeElement;
  renderGeneralSettings();
  $('generalSettingsDialog').hidden = false;
  syncWorkspace();
  setUtilityBackground(true);
  $('closeGeneralSettings').focus();
}
function closeGeneralSettings() {
  $('generalSettingsDialog').hidden = true;
  if (phone.modo) cancelPhone(); // o servidor da rede local do Celular não fica aberto com as configurações fechadas
  syncWorkspace();
  appSounds.stop('preview');
  setUtilityBackground(false);
  settingsReturnFocus?.focus();
}
// As cores em Auto seguem as principais: ao mudar uma, o código e a amostra delas mudam junto
function refreshAutoColors() {
  const effective = AppPreferences.palette(appPreferences.colors);
  const shown = { text: '--text', live: '--live', speaking: '--ok', warn: '--warn', line: '--line' };
  for (const key of AppPreferences.optionalColors) {
    if (appPreferences.colors[key] || document.activeElement === $('hex-' + key)) continue;
    $('hex-' + key).value = $('color-' + key).value = effective[shown[key]];
  }
}

// Aparência: vidro e fonte
const localFonts = []; // nomes vindos de "Fontes deste PC" (só nesta sessão)
function renderGlassHint() {
  const mode = appPreferences.appearance.glass;
  $('glassHint').textContent = mode === 'opaque' ? 'O mais leve para jogar e transmitir.'
    : mode === 'clear' ? 'Painéis transparentes, pouco desfoque.'
    : 'Mais desfoque e brilho. Pesa mais na placa de vídeo.';
}
function fontInstalled(name) {
  // Mede o mesmo texto com a fonte e sem ela: se nada muda nas duas bases, ela não está no PC
  const c = fontInstalled.c || (fontInstalled.c = document.createElement('canvas').getContext('2d'));
  const text = 'mmmmmmmmmmlli WQ@#ÁÇã 0123';
  return ['monospace', 'serif'].some((base) => {
    c.font = `40px ${base}`; const w = c.measureText(text).width;
    c.font = `40px "${name}", ${base}`; return c.measureText(text).width !== w;
  });
}
function fontSelectValue() {
  const f = appPreferences.font;
  if (f.family !== 'custom') return f.family;
  return localFonts.includes(f.custom) ? 'local:' + f.custom : 'custom';
}
function renderFontOptions() {
  const select = $('fontFamily');
  select.replaceChildren();
  const groups = new Map();
  for (const f of AppPreferences.fonts) {
    if (!groups.has(f.group)) { const g = document.createElement('optgroup'); g.label = f.group; groups.set(f.group, g); select.append(g); }
    const o = document.createElement('option'); o.value = f.id; o.textContent = f.label;
    o.style.fontFamily = AppPreferences.fontStacks({ family: f.id }).body;
    groups.get(f.group).append(o);
  }
  if (localFonts.length) {
    const g = document.createElement('optgroup'); g.label = `Deste PC (${localFonts.length})`;
    for (const name of localFonts) {
      const o = document.createElement('option'); o.value = 'local:' + name; o.textContent = name;
      o.style.fontFamily = `"${name}", ${AppPreferences.fontStacks(null).body}`; g.append(o);
    }
    select.append(g);
  }
  const g = document.createElement('optgroup'); g.label = 'Personalizada';
  const o = document.createElement('option'); o.value = 'custom'; o.textContent = 'Outra fonte instalada… (digitar o nome)';
  g.append(o); select.append(g);
}
function renderFontPreview() {
  const f = appPreferences.font, stacks = AppPreferences.fontStacks(f);
  const preview = $('fontPreview'), script = $('fontPreviewScript');
  preview.style.fontFamily = stacks.body;
  const sample = AppPreferences.fonts.find(x => x.id === f.family)?.sample;
  script.hidden = !sample; script.textContent = sample || '';
  const value = fontSelectValue();
  $('fontFamily').value = value;
  $('fontCustomRow').hidden = value !== 'custom';
  if (value === 'custom' && document.activeElement !== $('fontCustom')) $('fontCustom').value = f.custom;
  $('fontChat').checked = f.chat;
  const missing = f.family === 'custom' && f.custom && !fontInstalled(f.custom);
  if (value === 'custom') $('fontStatus').textContent = !f.custom ? 'Digite o nome de uma fonte instalada no Windows.'
    : missing ? `“${f.custom}” não foi encontrada neste PC. O app usa a fonte padrão até ela ser instalada.` : `Usando “${f.custom}”.`;
}
// Aba Tema: cada cartão mostra uma prévia do desenho. Escolher um tema aplica as cores dele; voltar ao Padrão
// devolve as cores e o material que você tinha antes de escolher o tema.
function chooseSkin(id) {
  id = AppPreferences.cleanSkin(id);
  if (id === appSkin) return;
  if (!appSkin) save('temaCoresAntes', JSON.stringify({ colors: appPreferences.colors, appearance: appPreferences.appearance }));
  if (id) appPreferences = AppPreferences.applyTheme(appPreferences, id);
  else {
    let before = null;
    try { before = JSON.parse(load('temaCoresAntes', 'null')); } catch {}
    appPreferences = before ? AppPreferences.normalize({ ...appPreferences, ...before }) : AppPreferences.applyTheme(appPreferences, 'grafiteaco');
  }
  appSkin = id;
  save('tema', id);
  saveAppPreferences();
  renderGeneralSettings();
}
function renderSkins() {
  const list = $('skinList');
  if (!list.children.length) {
    for (const k of AppPreferences.skins) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'skin-card';
      b.setAttribute('role', 'radio');
      b.dataset.skin = k.id;
      const preview = document.createElement('span');
      preview.className = 'skin-preview';
      preview.dataset.preview = k.id || 'padrao';
      preview.setAttribute('aria-hidden', 'true');
      const name = document.createElement('strong');
      name.textContent = k.label;
      const note = document.createElement('small');
      note.textContent = k.note;
      b.append(preview, name, note);
      b.onclick = () => chooseSkin(k.id);
      list.append(b);
    }
  }
  for (const b of list.children) b.setAttribute('aria-checked', String(b.dataset.skin === appSkin));
}

// Temas prontos: cada botão mostra as 4 cores do tema; o que bate com as escolhas atuais fica marcado
function renderThemes() {
  const list = $('themeList');
  if (!list.children.length) {
    for (const t of AppPreferences.themes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-card';
      b.setAttribute('role', 'radio');
      b.dataset.theme = t.id;
      const sw = document.createElement('span');
      sw.className = 'theme-swatches';
      sw.setAttribute('aria-hidden', 'true');
      for (const key of ['main', 'secondary', 'detail1', 'detail2']) {
        const s = document.createElement('span');
        s.style.background = t.colors[key];
        sw.append(s);
      }
      const name = document.createElement('span');
      name.textContent = t.label;
      b.append(sw, name);
      b.onclick = () => {
        appPreferences = AppPreferences.applyTheme(appPreferences, t.id);
        saveAppPreferences();
        renderGeneralSettings();
      };
      list.append(b);
    }
  }
  const current = AppPreferences.currentTheme(appPreferences);
  for (const b of list.children) b.setAttribute('aria-checked', String(b.dataset.theme === current));
  $('themeHint').textContent = current ? '' : 'Personalizado.';
}
function setupAmbient() {
  $('ambientLight').onchange = () => {
    appPreferences.appearance = { ...appPreferences.appearance, ambient: $('ambientLight').checked };
    saveAppPreferences();
  };
  $('voiceSkyOn').onchange = () => setVoiceSkyOn($('voiceSkyOn').checked);
  $('mirrorOn').onchange = () => {
    appPreferences.appearance = { ...appPreferences.appearance, mirror: $('mirrorOn').checked };
    saveAppPreferences();
  };
}
// Céu da voz na visão Lista (o Mapa não depende disso), em Aparência
function setVoiceSkyOn(on) {
  appPreferences.appearance = { ...appPreferences.appearance, voiceSky: !!on };
  saveAppPreferences();
  $('voiceSkyOn').checked = !!on;
  if (typeof renderVoiceSky === 'function') renderVoiceSky();
}
function renderAppearance() {
  renderSkins();
  renderThemes();
  const a = appPreferences.appearance;
  for (const input of document.querySelectorAll('input[name=glass]')) input.checked = input.value === a.glass;
  $('glassLevelRow').hidden = a.glass === 'opaque';
  $('glassLevel').value = a.level;
  $('glassLevelValue').textContent = a.level + '%';
  for (const input of document.querySelectorAll('input[name=border]')) input.checked = input.value === a.border;
  renderGlassHint();
  $('ambientLight').checked = appPreferences.appearance.ambient;
  $('voiceSkyOn').checked = appPreferences.appearance.voiceSky;
  $('mirrorOn').checked = appPreferences.appearance.mirror;
  if (!$('fontFamily').options.length) renderFontOptions();
  renderFontPreview();
}
function setupAppearance() {
  for (const input of document.querySelectorAll('input[name=glass]')) input.onchange = () => {
    if (!input.checked) return;
    appPreferences.appearance = { ...appPreferences.appearance, glass: input.value, level: AppPreferences.glassLevel[input.value] ?? appPreferences.appearance.level };
    saveAppPreferences(); renderAppearance();
  };
  for (const input of document.querySelectorAll('input[name=border]')) input.onchange = () => {
    if (!input.checked) return;
    appPreferences.appearance = { ...appPreferences.appearance, border: input.value };
    saveAppPreferences();
  };
  setupAmbient();
  $('glassLevel').oninput = () => {
    appPreferences.appearance.level = Number($('glassLevel').value);
    $('glassLevelValue').textContent = appPreferences.appearance.level + '%';
    saveAppPreferences();
  };
  $('fontFamily').onchange = () => {
    const v = $('fontFamily').value;
    $('fontStatus').textContent = '';
    if (v.startsWith('local:')) appPreferences.font = { ...appPreferences.font, family: 'custom', custom: v.slice(6) };
    else if (v === 'custom') {
      $('fontCustomRow').hidden = false; $('fontCustom').value = appPreferences.font.custom; $('fontCustom').focus();
      if (!AppPreferences.fontName(appPreferences.font.custom)) { $('fontStatus').textContent = 'Digite o nome de uma fonte instalada no Windows.'; return; }
      appPreferences.font = { ...appPreferences.font, family: 'custom' };
    } else appPreferences.font = { ...appPreferences.font, family: v };
    saveAppPreferences(); renderFontPreview();
  };
  $('fontCustom').oninput = () => {
    const name = AppPreferences.fontName($('fontCustom').value);
    $('fontCustom').setAttribute('aria-invalid', String(!!$('fontCustom').value.trim() && !name));
    if (!name) return;
    appPreferences.font = { ...appPreferences.font, family: 'custom', custom: name };
    saveAppPreferences(); renderFontPreview(); $('fontFamily').value = 'custom'; $('fontCustomRow').hidden = false;
  };
  $('fontChat').onchange = () => { appPreferences.font = { ...appPreferences.font, chat: $('fontChat').checked }; saveAppPreferences(); };
  $('loadLocalFonts').onclick = async () => {
    if (typeof window.queryLocalFonts !== 'function') {
      $('fontStatus').textContent = 'Este sistema não deixa o app listar as fontes. Escolha “Outra fonte instalada…” e digite o nome.';
      return;
    }
    $('loadLocalFonts').disabled = true; $('fontStatus').textContent = 'Procurando as fontes deste PC…';
    try {
      const names = new Set();
      for (const f of await window.queryLocalFonts()) { const n = AppPreferences.fontName(f.family); if (n) names.add(n); }
      localFonts.splice(0, localFonts.length, ...[...names].sort((a, b) => a.localeCompare(b, 'pt-BR')));
      renderFontOptions(); renderFontPreview();
      $('fontStatus').textContent = localFonts.length ? `${localFonts.length} fontes deste PC no fim da lista, em “Deste PC”.` : 'Nenhuma fonte encontrada.';
    } catch { $('fontStatus').textContent = 'Não foi possível listar as fontes. Escolha “Outra fonte instalada…” e digite o nome.'; }
    $('loadLocalFonts').disabled = false;
  };
}
// Abas das configurações: Tema, Aparência, Cores e Sons (a rede tem a própria janela, networkDialog). Lembra a última aberta.
function showSettingsTab(name, focus = false) {
  const tabs = [...document.querySelectorAll('.settings-tabs [role=tab]')];
  const tab = tabs.find((t) => t.dataset.tab === name) || tabs[0];
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $('settingsPanel-' + t.dataset.tab).hidden = !on;
  }
  save('settingsTab', tab.dataset.tab);
  if (focus) tab.focus();
}
function setupSettingsTabs() {
  const tabs = [...document.querySelectorAll('.settings-tabs [role=tab]')];
  for (const t of tabs) {
    t.onclick = () => showSettingsTab(t.dataset.tab);
    t.onkeydown = (e) => {
      const i = tabs.indexOf(t);
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      showSettingsTab(tabs[(next + tabs.length) % tabs.length].dataset.tab, true);
    };
  }
  showSettingsTab(load('settingsTab') || 'appearance');
}
function setupGeneralSettings() {
  setupConnectivitySettings();
  setupSettingsTabs();
  setupAppearance();
  window.api.getVersion().then((v) => { $('settingsVersion').textContent = v ? 'v' + v : ''; }).catch(() => {});
  for (const [key] of Object.entries(appPreferences.colors)) {
    const picker = $('color-' + key), field = $('hex-' + key), error = $('error-' + key);
    const optional = AppPreferences.optionalColors.includes(key);
    const change = (value, source) => {
      if (optional && !String(value).trim()) { // vazio: volta a ser automática
        field.removeAttribute('aria-invalid');
        error.hidden = true;
        appPreferences.colors[key] = '';
        saveAppPreferences();
        renderGeneralSettings();
        return;
      }
      const normalized = AppPreferences.hex(value);
      field.setAttribute('aria-invalid', String(!normalized));
      error.hidden = !!normalized;
      if (!normalized) return;
      appPreferences.colors[key] = normalized;
      picker.value = normalized;
      if (source === picker) field.value = normalized;
      field.classList.remove('is-auto');
      saveAppPreferences();
      refreshAutoColors();
    };
    picker.oninput = () => change(picker.value, picker);
    field.oninput = () => change(field.value, field);
    field.onblur = () => { const value = AppPreferences.hex(field.value); if (value) field.value = value; };
  }
  for (const event of AppPreferences.events) {
    $('volume-' + event).oninput = () => {
      appPreferences.sounds.levels[event] = Number($('volume-' + event).value);
      $('value-' + event).textContent = appPreferences.sounds.levels[event] + '%';
      appSounds.stop(event); appSounds.stop('preview');
      saveAppPreferences();
    };
    const select = $('sound-' + event);
    for (const s of [{ id: 'none', label: 'Sem som' }, ...AppPreferences.sounds]) {
      const option = document.createElement('option'); option.value = s.id; option.textContent = s.label; select.append(option);
    }
    select.onchange = () => {
      appPreferences.sounds[event] = select.value;
      appSounds.stop(event); appSounds.stop('preview');
      $('preview-' + event).disabled = select.value === 'none';
      saveAppPreferences();
    };
    $('preview-' + event).onclick = async () => {
      if (!await appSounds.play(event, true)) $('settingsSaveStatus').textContent = appPreferences.sounds.volume === 0 || appPreferences.sounds.levels[event] === 0
        ? 'Aumente o volume geral e o volume deste evento para ouvir a prévia.' : 'Não foi possível reproduzir este som.';
    };
  }
  $('muteChatSound').onchange = () => {
    appPreferences.sounds.chatMuted = $('muteChatSound').checked;
    if (appPreferences.sounds.chatMuted) appSounds.stop('chat');
    saveAppPreferences();
  };
  $('notificationVolume').oninput = () => {
    appPreferences.sounds.volume = Number($('notificationVolume').value);
    $('notificationVolumeValue').textContent = `${appPreferences.sounds.volume}%`;
    if (!appPreferences.sounds.volume) appSounds.stopAll();
    saveAppPreferences();
  };
  $('resetColors').onclick = () => { appPreferences.colors = { ...AppPreferences.defaults.colors }; renderGeneralSettings(); saveAppPreferences(); };
  $('openGeneralSettingsRoom').onclick = openGeneralSettings;
  setIcon($('openGeneralSettingsRoom'), 'sliders', 'Configurações gerais: cores e sons');
  $('closeGeneralSettings').onclick = closeGeneralSettings;
  renderGeneralSettings();
  window.addEventListener('beforeunload', () => appSounds.stopAll());
}
