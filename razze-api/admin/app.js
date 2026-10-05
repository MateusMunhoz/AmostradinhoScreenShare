'use strict';
const $ = id => document.getElementById(id);
let token = '', bootstrap = false, view = 'overview', epoch = 0, refreshing = false;
$('server').textContent = location.origin;
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const message = (text, error = false) => { $('message').textContent = text; $('message').classList.toggle('error', error); };
const time = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
const bytes = value => { let n = value || 0, i = 0; const units = ['B', 'KiB', 'MiB', 'GiB']; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + units[i]; };
const badge = on => el('span', on ? 'Online' : 'Offline', 'badge' + (on ? ' online' : ''));
async function api(endpoint, method = 'GET', body) {
  const response = await fetch('/v1/' + endpoint, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && token) signedOut();
    throw new Error(data.error?.message || 'Falha na requisição.');
  }
  return data;
}
function signedOut() { token = ''; epoch++; $('workspace').hidden = true; $('logout').hidden = true; $('login').hidden = false; $('content').replaceChildren(); }
async function signIn(candidate, isBootstrap) {
  token = candidate; bootstrap = isBootstrap;
  try {
    await api('admin/me');
    $('password').value = ''; $('token').value = '';
    $('workspace').hidden = false; $('logout').hidden = false; $('login').hidden = true;
    message(''); await render();
  } catch (error) { if (!bootstrap && token) await api('auth/logout', 'POST').catch(() => {}); signedOut(); throw error; }
}
function formHandler(form, handler) {
  form.onsubmit = async event => { event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
    try { await handler(); } catch (e) { message(e.message, true); } finally { button.disabled = false; } };
}
formHandler($('loginForm'), async () => { const data = await api('auth/login', 'POST', { email: $('email').value, password: $('password').value }); await signIn(data.accessToken, false); });
formHandler($('tokenForm'), () => signIn($('token').value.trim(), true));
$('logout').onclick = async () => { try { if (!bootstrap) await api('auth/logout', 'POST'); } finally { signedOut(); message('Você saiu do painel.'); } };
$('nav').onclick = event => { const button = event.target.closest('[data-view]'); if (!button) return; view = button.dataset.view; message(''); render().catch(e => message(e.message, true)); };
$('refresh').onclick = () => render().catch(e => message(e.message, true));
function action(label, handler, danger = false) {
  const button = el('button', label, danger ? 'danger' : '');
  button.onclick = async () => { button.disabled = true; try { if (await handler() === false) return; message('Alteração concluída.'); await render(); } catch (e) { message(e.message, true); } finally { button.disabled = false; } };
  return button;
}
function table(headers, rows) {
  const wrap = el('div', undefined, 'table-wrap'), t = el('table'), head = el('thead'), tr = el('tr');
  headers.forEach(h => tr.append(el('th', h))); head.append(tr); t.append(head);
  const body = el('tbody');
  for (const cells of rows) { const row = el('tr'); for (const value of cells) { const td = el('td'); td.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—'))); row.append(td); } body.append(row); }
  t.append(body); wrap.append(t); if (!rows.length) wrap.append(el('p', 'Nenhum registro.', 'panel')); return wrap;
}
async function render() {
  const requestEpoch = ++epoch, currentView = view, fragment = document.createDocumentFragment();
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'overview') {
    const data = await api('admin/overview');
    fragment.append(el('h2', 'Visão geral'));
    const stats = el('div', undefined, 'stats');
    for (const [name, value] of [['Clientes conectados', data.connectedClients], ['Usuários online', data.online], ['Contas pendentes', data.pending], ['Redes cadastradas', data.networks], ['Salas abertas', data.rooms.length]]) {
      const card = el('div', undefined, 'panel stat'); card.append(el('span', name, 'muted'), el('strong', value)); stats.append(card);
    }
    fragment.append(stats, el('p', 'Processo da API: ' + bytes(data.server.memoryBytes) + ' de memória · ativo há ' + Math.floor(data.server.uptimeSeconds / 60) + ' min.', 'muted'), el('h3', 'Salas anunciadas agora'), table(['Host', 'Rede', 'Pessoas', 'Último contato'], data.rooms.map(r => [r.host, r.networkName, r.pessoas, time(r.lastSeen)])));
  } else if (view === 'clients') {
    const data = await api('admin/clients');
    fragment.append(el('h2', 'Clientes · ' + data.clients.filter(c => c.online).length + ' conectados'), el('p', 'Contadores por sessão: requisições autenticadas e bytes dos corpos HTTP da API. Não incluem cabeçalhos, TLS, STUN ou vídeo/voz P2P. Online significa contato recente com a API; não confirma conexão direta entre os PCs.', 'muted'));
    fragment.append(table(['Cliente / usuário', 'Presença', 'Requisições', 'Recebido pela VPS', 'Enviado pela VPS', 'Desde / último contato', 'Controle'], data.clients.map(c => [
      c.displayName + ' · ' + c.clientName + ' (' + c.id.slice(0, 8) + ')', badge(c.online), c.requests || 0, bytes(c.receivedBytes), bytes(c.sentBytes), time(c.startedAt) + ' / ' + time(c.lastSeen),
      action('Forçar desconexão', async () => { if (!confirm('Revogar esta sessão de ' + c.displayName + '? Ela precisará entrar novamente.')) return false; await api('admin/clients/' + c.id, 'DELETE'); }, true),
    ])));
  } else if (view === 'users') {
    const { users } = await api('admin/users');
    fragment.append(el('h2', 'Usuários'), el('p', 'Aprovação automática vale para novos cadastros. Contas pendentes existentes devem ser aprovadas aqui.', 'muted'));
    const search = el('input'); search.placeholder = 'Buscar nome ou e-mail'; search.setAttribute('aria-label', 'Buscar usuário'); const box = el('div');
    const draw = () => box.replaceChildren(table(['Nome / e-mail', 'Presença', 'Acesso', 'Ações'], users.filter(u => (u.displayName + u.email).toLowerCase().includes(search.value.toLowerCase())).map(u => {
      const actions = el('div', undefined, 'actions');
      if (u.status === 'pending') actions.append(action('Aprovar', () => api('admin/users/' + u.id + '/approve', 'POST')));
      actions.append(action(u.role === 'admin' ? 'Remover administração' : 'Tornar administrador', async () => {
        if (!confirm('Alterar o acesso administrativo de ' + u.displayName + '?')) return false;
        await api('admin/users/' + u.id, 'PATCH', { role: u.role === 'admin' ? 'user' : 'admin' });
      }));
      actions.append(action(u.status === 'disabled' ? 'Desbanir' : 'Banir', async () => {
        let reason = '';
        if (u.status !== 'disabled') { reason = prompt('Motivo do banimento de ' + u.displayName + ':'); if (reason === null) return false; }
        else if (!confirm('Reativar ' + u.displayName + '?')) return false;
        await api('admin/users/' + u.id, 'PATCH', { status: u.status === 'disabled' ? 'active' : 'disabled', banReason: reason });
      }, true));
      actions.append(action('Código de senha', async () => {
        if (!confirm('Gerar um código para ' + u.displayName + ' redefinir a senha? Vale por 1 hora e uma vez.')) return false;
        const r = await api('admin/users/' + u.id + '/reset-code', 'POST');
        prompt('Passe este código a ' + u.displayName + ' (vale 1 hora):', r.code);
      }));
      actions.append(action('Revogar sessões', async () => { if (!confirm('Desconectar todas as sessões de ' + u.displayName + '?')) return false; await api('admin/users/' + u.id + '/revoke-sessions', 'POST'); }, true));
      return [u.displayName + ' · ' + u.email, badge(u.online), (u.role === 'admin' ? 'Administrador' : 'Usuário') + ' / ' + ({ active: 'Ativo', pending: 'Pendente', disabled: 'Banido' }[u.status]) + (u.banReason ? ' · ' + u.banReason : ''), actions];
    })));
    search.oninput = draw; draw(); fragment.append(search, box);
  } else if (view === 'networks') {
    const { networks } = await api('admin/networks'); fragment.append(el('h2', 'Redes'));
    fragment.append(table(['Rede', 'Dono', 'Online / salas', 'Ações'], networks.map(n => {
      const actions = el('div', undefined, 'actions');
      actions.append(action('Revogar convites', async () => { if (!confirm('Invalidar os convites de ' + n.name + '?')) return false; await api('admin/networks/' + n.id + '/invites', 'DELETE'); }),
        action('Excluir rede', async () => { if (!confirm('Excluir definitivamente ' + n.name + ' e seus membros/dispositivos?')) return false; await api('admin/networks/' + n.id, 'DELETE'); }, true));
      return [n.name, n.ownerName + ' · ' + n.ownerEmail, n.onlineCount + ' / ' + n.roomCount, actions];
    })));
  } else if (view === 'settings') {
    const { settings } = await api('admin/settings'); fragment.append(el('h2', 'Configurações do servidor'));
    const form = el('form', undefined, 'panel settings');
    const checkbox = (text, checked) => { const label = el('label'); const input = el('input'); input.type = 'checkbox'; input.checked = checked; label.append(input, document.createTextNode(text)); form.append(label); return input; };
    const registration = checkbox('Permitir novos cadastros', settings.registrationOpen);
    const approval = checkbox('Exigir aprovação para novas contas', settings.requireApproval);
    const label = el('label', 'Marcar offline após (segundos)'); const timeout = el('input'); timeout.type = 'number'; timeout.min = '45'; timeout.max = '300'; timeout.value = settings.presenceTimeoutSeconds; timeout.required = true; label.append(timeout); form.append(label, el('p', 'Alterações são salvas no banco e entram em vigor sem reiniciar. TLS, domínio e portas continuam na configuração da VPS.', 'muted'), el('button', 'Salvar configurações', 'primary'));
    formHandler(form, async () => { await api('admin/settings', 'PATCH', { registrationOpen: registration.checked, requireApproval: approval.checked, presenceTimeoutSeconds: Number(timeout.value) }); message('Configurações salvas.'); }); fragment.append(form);
  } else {
    const audit = view === 'audit'; fragment.append(el('h2', audit ? 'Histórico de ações administrativas' : 'Banco de dados'));
    fragment.append(el('p', 'Consulta paginada, somente leitura. Senhas, hashes e tokens não são expostos.', 'muted'));
    const controls = el('div', undefined, 'filters'), select = el('select'); select.setAttribute('aria-label', 'Tabela');
    const names = audit ? ['audit_log'] : (await api('admin/database')).tables;
    names.forEach(name => { const option = el('option', name); option.value = name; select.append(option); });
    let offset = 0, pageEpoch = 0; const box = el('div'), count = el('span', '', 'muted'), prev = el('button', 'Anterior'), next = el('button', 'Próxima');
    const draw = async () => {
      const mine = ++pageEpoch;
      const data = await api('admin/database/' + select.value + '?offset=' + offset + '&limit=50');
      if (mine !== pageEpoch) return;
      const columns = Object.keys(data.rows[0] || {}); box.replaceChildren(table(columns, data.rows.map(r => columns.map(c => r[c]))));
      count.textContent = data.total + ' registros · página ' + (offset / 50 + 1); prev.disabled = offset === 0; next.disabled = offset + 50 >= data.total;
    };
    const load = () => draw().catch(e => message(e.message, true));
    select.onchange = () => { offset = 0; load(); }; prev.onclick = () => { offset = Math.max(0, offset - 50); load(); }; next.onclick = () => { offset += 50; load(); };
    controls.append(select, prev, next, count); fragment.append(controls, box); await draw();
  }
  if (token && requestEpoch === epoch && currentView === view) $('content').replaceChildren(fragment);
}
setInterval(async () => {
  if (!token || refreshing || document.hidden || !['clients', 'overview'].includes(view) || document.querySelector('button:disabled')) return;
  refreshing = true; try { await render(); } catch (e) { message('Não foi possível atualizar: ' + e.message, true); } finally { refreshing = false; }
}, 10000);
