'use strict';
(() => {
  const get = id => document.getElementById(id);
  let busy = false, last = null, polling = false;
  function render(value) {
    if (!value.ok) { get('vpnStatus').textContent = value.error || 'Não foi possível verificar a VPN.'; return; }
    last = value;
    const active = value.state !== 'disconnected';
    get('vpnConnect').disabled = busy || !!value.busy || active || !value.installed;
    get('vpnDisconnect').disabled = busy || !!value.busy || (!active && !value.configured);
    get('vpnInvite').disabled = busy || active;
    get('vpnConnect').textContent = busy ? 'Aguarde…' : value.configured ? 'Conectar / trocar rede' : 'Conectar VPN';
    get('vpnStatus').textContent = !value.installed ? 'Componente ausente. No código-fonte, execute npm run vpn:prepare.'
      : value.state === 'connected' ? `Conectado · ${value.address} · servidor acessível`
      : value.state === 'unreachable' ? `Túnel ativo · ${value.address} · servidor sem resposta. Aguarde ou confira o servidor e sua internet.`
      : value.configured ? 'Desconectado. Deixe o convite vazio para reconectar à última rede.' : 'Desconectado. Aguardando convite da rede.';
  }
  async function refresh() {
    if (busy || polling) return;
    polling = true;
    try { const result = await window.api.vpnStatus(); if (!busy) render(result); } catch { if (!busy) render({ ok: false, error: 'Falha ao consultar o controlador da VPN.' }); }
    finally { polling = false; }
  }
  async function change(connect) {
    if (busy) return;
    if (state.myId) return toast('Saia da sala antes de alterar a VPN.', 'error');
    busy = true;
    for (const id of ['goCreate', 'goJoin', 'rejoinBtn', 'createBtn', 'joinBtn']) get(id).disabled = true;
    if (last) render(last);
    get('vpnStatus').textContent = 'Aguardando a operação e a permissão do Windows…';
    let result;
    try {
      result = await (connect ? window.api.vpnConnect(get('vpnInvite').value.trim()) : window.api.vpnDisconnect());
      if (result.ok) get('vpnInvite').value = '';
    } catch { result = { ok: false, error: 'O controlador da VPN não respondeu.' }; }
    finally {
      busy = false;
      for (const id of ['goCreate', 'goJoin', 'rejoinBtn', 'createBtn', 'joinBtn']) get(id).disabled = false;
    }
    if (last) render(last);
    if (result.ok) { render({ ...result, busy: false }); renderRadmin(); }
    else { get('vpnStatus').textContent = result.error; toast(result.error, 'error'); }
  }
  get('vpnConnect').onclick = () => change(true);
  get('vpnDisconnect').onclick = () => change(false);
  get('vpnInvite').addEventListener('keydown', e => { if (e.key === 'Enter' && !get('vpnConnect').disabled) change(true); });
  refresh();
  setInterval(() => { if (!document.hidden && !state.myId) refresh(); }, 5000);
})();
