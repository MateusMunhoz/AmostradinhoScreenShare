'use strict';
// Preferências locais: não são enviadas para a sala ou para outros participantes.
let appPreferences = AppPreferences.read(localStorage);
const appSounds = new AppPreferences.SoundPlayer({ settings: () => appPreferences });
let settingsReturnFocus = null;

function applyAppTheme(d = document) {
  for (const [key, value] of Object.entries(AppPreferences.palette(appPreferences.colors))) d.documentElement.style.setProperty(key, value);
  // As janelas por cima do jogo usam painéis translúcidos, sem o fundo da página principal.
  if (d !== document) {
    d.documentElement.style.setProperty('--text', 'var(--surface-text)');
    d.documentElement.style.setProperty('--muted', 'var(--surface-muted)');
  }
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
    $('color-' + key).value = value || effective[shown[key]]; // automática: a amostra mostra a cor calculada
    $('hex-' + key).value = value;
    $('hex-' + key).removeAttribute('aria-invalid');
    $('error-' + key).hidden = true;
  }
  for (const event of AppPreferences.events) {
    $('sound-' + event).value = appPreferences.sounds[event];
    $('preview-' + event).disabled = appPreferences.sounds[event] === 'none';
    $('volume-' + event).value = appPreferences.sounds.levels[event];
    $('value-' + event).textContent = appPreferences.sounds.levels[event] + '%';
  }
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
function setupGeneralSettings() {
  setupConnectivitySettings();
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
      saveAppPreferences();
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
