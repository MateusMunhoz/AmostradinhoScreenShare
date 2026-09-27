'use strict';

const NETWORK_PREF_KEY = 'connectivity.v1';

function networkPreferences() {
  try {
    const p = JSON.parse(localStorage.getItem(NETWORK_PREF_KEY) || '{}');
    return {
      provider: p.provider === 'netbird' ? 'netbird' : 'radmin',
      managementUrl: typeof p.managementUrl === 'string' ? p.managementUrl : '',
    };
  } catch { return { provider: 'radmin', managementUrl: '' }; }
}

function saveNetworkPreferences(patch) {
  const next = { ...networkPreferences(), ...patch };
  localStorage.setItem(NETWORK_PREF_KEY, JSON.stringify(next));
  return next;
}

function selectedNetworkProvider() { return networkPreferences().provider; }

async function requireSelectedNetwork() {
  if (selectedNetworkProvider() !== 'netbird') return;
  const prefs = networkPreferences();
  const status = await window.api.netbirdStatus();
  if (!status.installed) throw new Error('Instale o agente NetBird e conecte à VPN nas configurações gerais.');
  if (!status.connected || !status.ip) throw new Error('Conecte à VPN Tela P2P nas configurações gerais antes de criar ou entrar numa sala.');
  let requested = '', connectedTo = '';
  try { requested = new URL(prefs.managementUrl).origin; } catch {}
  try { connectedTo = new URL(status.managementUrl).origin; } catch {}
  if (!requested || !connectedTo || requested !== connectedTo) throw new Error('O NetBird está conectado a outro servidor. Confira o endereço nas configurações gerais.');
}

function renderConnectivitySettings() {
  const prefs = networkPreferences();
  $('networkProvider').value = prefs.provider;
  $('netbirdManagementUrl').value = prefs.managementUrl;
  $('netbirdSetupKey').value = '';
  $('netbirdSettings').hidden = prefs.provider !== 'netbird';
  refreshNetBirdStatus();
}

async function refreshNetBirdStatus() {
  const line = $('netbirdStatus');
  if (!line) return;
  try {
    const s = await window.api.netbirdStatus();
    line.textContent = !s.installed
      ? 'Agente NetBird não encontrado. Instale o cliente NetBird neste PC.'
      : s.connected
        ? `Conectado${s.ip ? ` · IP privado ${s.ip}` : ''}${s.managementUrl ? ` · ${s.managementUrl}` : ''}.`
        : `Desconectado. ${s.error || 'Conecte ao servidor configurado.'}`;
  } catch (e) { line.textContent = `Não foi possível consultar o NetBird: ${e.message}`; }
}

function setupConnectivitySettings() {
  $('networkProvider').onchange = () => {
    saveNetworkPreferences({ provider: $('networkProvider').value });
    renderConnectivitySettings();
    renderRadmin();
    setSessionWatch(!$('home').hidden);
  };
  $('netbirdManagementUrl').onchange = () => saveNetworkPreferences({ managementUrl: $('netbirdManagementUrl').value.trim() });
  $('netbirdConnect').onclick = async () => {
    const url = $('netbirdManagementUrl').value.trim();
    saveNetworkPreferences({ managementUrl: url });
    $('netbirdConnect').disabled = true;
    $('netbirdStatus').textContent = 'Conectando…';
    try {
      const setupKey = $('netbirdSetupKey').value;
      const result = await window.api.netbirdConnect(url, setupKey);
      $('netbirdStatus').textContent = result.ok
        ? `Conectado à VPN${result.status?.ip ? ` · IP privado ${result.status.ip}` : ''}.`
        : `Não foi possível conectar: ${result.error}`;
      renderRadmin();
    } catch (e) { $('netbirdStatus').textContent = `Falha ao conectar: ${e.message}`; }
    finally { $('netbirdSetupKey').value = ''; $('netbirdConnect').disabled = false; }
  };
  $('netbirdDisconnect').onclick = async () => {
    $('netbirdDisconnect').disabled = true;
    try {
      const result = await window.api.netbirdDisconnect();
      $('netbirdStatus').textContent = result.ok ? 'VPN desconectada.' : `Não foi possível desconectar: ${result.error}`;
      renderRadmin();
    } catch (e) { $('netbirdStatus').textContent = `Falha ao desconectar: ${e.message}`; }
    finally { $('netbirdDisconnect').disabled = false; }
  };
  $('netbirdInstallHelp').onclick = () => window.api.openLink('https://docs.netbird.io/get-started/install/windows');
  $('netbirdServerHelp').onclick = () => window.api.openLink('https://docs.netbird.io/selfhosted/selfhosted-guide');
}
