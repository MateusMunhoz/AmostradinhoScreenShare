'use strict';
// Preferências locais: não são enviadas para a sala ou para outros participantes.
let appPreferences = AppPreferences.read(localStorage);
const appSounds = new AppPreferences.SoundPlayer({ settings: () => appPreferences });
let settingsReturnFocus = null;

// Material da janela (acrílico do Windows 11) só muda quando o modo muda; a resposta diz se o sistema tem
let windowMaterial = { key: '', material: 'none', supported: false };
function applyWindowMaterial() {
  const mode = appPreferences.appearance.glass, key = mode === 'opaque' ? 'opaque|' + appPreferences.colors.main : mode;
  if (windowMaterial.key === key || !window.api?.windowMaterial) return;
  windowMaterial.key = key;
  window.api.windowMaterial(mode, appPreferences.colors.main).then((r) => {
    if (windowMaterial.key !== key) return;
    windowMaterial = { key, material: r?.material || 'none', supported: !!r?.supported };
    document.documentElement.dataset.material = windowMaterial.material;
    if (!$('generalSettingsDialog').hidden) renderGlassHint();
  }).catch(() => {});
}
function applyAppTheme(d = document) {
  const root = d.documentElement;
  for (const [key, value] of Object.entries(AppPreferences.palette(appPreferences.colors))) root.style.setProperty(key, value);
  const fonts = AppPreferences.fontStacks(appPreferences.font);
  root.style.setProperty('--font-body', fonts.body);
  root.style.setProperty('--font-display', fonts.display);
  root.style.setProperty('--font-console', fonts.console);
  // As janelas por cima do jogo usam painéis translúcidos, sem o fundo da página principal.
  if (d !== document) {
    root.style.setProperty('--text', 'var(--surface-text)');
    root.style.setProperty('--muted', 'var(--surface-muted)');
    return;
  }
  // Vidro: só na janela principal; as flutuantes já são translúcidas por cima do jogo
  const glass = AppPreferences.glass(appPreferences.colors, appPreferences.appearance);
  for (const [key, value] of Object.entries(glass || {})) root.style.setProperty(key, value);
  root.dataset.glass = appPreferences.appearance.glass;
  applyWindowMaterial();
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
  if (!$('profilePane').hidden) closeProfilePopup();
  settingsReturnFocus = document.activeElement;
  renderGeneralSettings();
  renderConnectivitySettings();
  $('generalSettingsDialog').hidden = false;
  syncWorkspace();
  setUtilityBackground(true);
  $('closeGeneralSettings').focus();
}
function closeGeneralSettings() {
  $('generalSettingsDialog').hidden = true;
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
  const desktop = windowMaterial.supported ? ' A área de trabalho aparece desfocada atrás da janela.'
    : ' A área de trabalho atrás da janela só aparece no Windows 11 22H2 ou mais novo; aqui o app desenha um fundo próprio.';
  $('glassHint').textContent = mode === 'opaque' ? 'Cores sólidas. É o mais leve para jogar e transmitir ao mesmo tempo.'
    : mode === 'clear' ? 'Vidro limpo: painéis bem transparentes e pouco desfoque.' + desktop
    : 'Vidro grosso: mais desfoque, cores mais vivas e brilho nas bordas. Usa mais a placa de vídeo; se o jogo perder FPS, volte para Opaco.' + desktop;
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
function renderAppearance() {
  const a = appPreferences.appearance;
  for (const input of document.querySelectorAll('input[name=glass]')) input.checked = input.value === a.glass;
  $('glassLevelRow').hidden = a.glass === 'opaque';
  $('glassLevel').value = a.level;
  $('glassLevelValue').textContent = a.level + '%';
  renderGlassHint();
  if (!$('fontFamily').options.length) renderFontOptions();
  renderFontPreview();
}
function setupAppearance() {
  for (const input of document.querySelectorAll('input[name=glass]')) input.onchange = () => {
    if (!input.checked) return;
    appPreferences.appearance = { glass: input.value, level: AppPreferences.glassLevel[input.value] ?? appPreferences.appearance.level };
    saveAppPreferences(); renderAppearance();
  };
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
function setupGeneralSettings() {
  setupConnectivitySettings();
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
