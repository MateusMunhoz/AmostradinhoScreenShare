'use strict';
// Administração dentro do app (Perfil › Conta Razze › Administração): só para contas com papel de administrador.
// Visão geral (números), Pedidos (contas pendentes), Convidados (lista de e-mails que entram direto), Pessoas
// (filtro por grupo) e Servidor (interruptores). Tudo vai por window.api.razzeAdmin, que só aceita as rotas do painel
// (main/razze-api-client.js); o servidor confere o papel em toda chamada. Plano: docs/spec/conta-so-google-e-admin.md.
// Script clássico: só declara; quem liga é renderer/inicio.js (setupAdmin). Usa: util ($, toast, appConfirm), conectividade (razzeUser).

const adm = { aba: 'geral', filtro: 'todos', busca: '', dados: null, ocupado: false };
const ADM_ABAS = [['geral', 'Visão geral'], ['pedidos', 'Pedidos'], ['convidados', 'Convidados'], ['pessoas', 'Pessoas'], ['servidor', 'Servidor']];
const ADM_FILTROS = [['todos', 'Todos'], ['amigo', 'Amigos'], ['teste', 'Teste'], ['admin', 'Admin'], ['pendente', 'Pendentes'], ['desativado', 'Desativados']];
const ADM_SERVIDOR = [
  ['googleOnly', 'Só Google para criar conta', 'Ninguém cria conta por e-mail e senha. O administrador continua entrando por senha.'],
  ['legacyPasswordLogin', 'Contas antigas ainda entram por senha', 'Desligue quando todos tiverem vinculado o Google. Só vale com "Só Google" ligado.'],
  ['requireApproval', 'Aprovar contas novas', 'E-mail fora da lista de convidados fica pendente até você aprovar em Pedidos.'],
  ['onlyAllowlist', 'Só quem está na lista de convidados', 'E-mail fora da lista nem consegue pedir conta.'],
  ['registrationOpen', 'Aceitar contas novas', 'Desligado: só e-mails da lista de convidados criam conta.'],
];

function admEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const admBtn = (text, onclick, cls = 'btn small') => { const b = admEl('button', cls, text); b.type = 'button'; b.onclick = onclick; return b; };
const admData = (t) => (t ? new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—');
const admSouAdmin = () => typeof razzeUser !== 'undefined' && !!razzeUser && razzeUser.role === 'admin';

async function admChamar(method, rota, body) {
  try { return await window.api.razzeAdmin(method, rota, body); }
  catch (e) { toast(String(e?.message || 'Não deu certo.').replace(/^.*RazzeApiError: /, ''), 'error'); throw e; }
}

// Mostra o botão só para administradores (chamado quando a conta muda: conta.js)
function admAtualizarBotao() {
  const b = document.getElementById('razzeAdminOpen');
  if (b) b.hidden = !admSouAdmin();
}

function abrirAdmin() {
  if (!admSouAdmin()) return;
  $('adminDialog').hidden = false;
  void admCarregar();
  $('adminClose').focus();
}
function fecharAdmin() { $('adminDialog').hidden = true; }

async function admCarregar() {
  if (adm.ocupado) return;
  adm.ocupado = true;
  $('adminStatus').textContent = 'Atualizando…';
  try {
    const [analytics, users, allow, settings] = await Promise.all([
      window.api.razzeAdmin('GET', '/v1/admin/analytics'), window.api.razzeAdmin('GET', '/v1/admin/users'),
      window.api.razzeAdmin('GET', '/v1/admin/allowlist'), window.api.razzeAdmin('GET', '/v1/admin/settings'),
    ]);
    adm.dados = { analytics, users: users.users, allow: allow.allowlist, settings: settings.settings };
    $('adminStatus').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    adm.dados = null;
    $('adminStatus').textContent = e?.status === 403 || /administrador/i.test(e?.message || '') ? 'Esta conta não é administradora.' : 'Não deu para carregar: ' + String(e?.message || '').replace(/^.*RazzeApiError: /, '');
  } finally { adm.ocupado = false; }
  admDesenhar();
}

function admDesenhar() {
  const pendentes = adm.dados ? adm.dados.users.filter((u) => u.status === 'pending').length : 0;
  const tabs = $('adminTabs');
  tabs.textContent = '';
  for (const [id, nome] of ADM_ABAS) {
    const b = admEl('button', '', nome);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(adm.aba === id));
    if (id === 'pedidos' && pendentes) b.append(' ', admEl('span', 'hub-badge', String(pendentes)));
    b.onclick = () => { adm.aba = id; admDesenhar(); };
    tabs.append(b);
  }
  const corpo = $('adminBody');
  corpo.textContent = '';
  if (!adm.dados) return;
  ({ geral: admGeral, pedidos: admPedidos, convidados: admConvidados, pessoas: admPessoas, servidor: admServidor })[adm.aba](corpo);
}

function admCartao(titulo, valor, dica) {
  const c = admEl('div', 'adm-stat');
  c.append(admEl('strong', '', String(valor)), admEl('span', '', titulo));
  if (dica) c.title = dica;
  return c;
}

function admGeral(corpo) {
  const a = adm.dados.analytics;
  const grade = admEl('div', 'adm-stats');
  grade.append(
    admCartao('Online agora', a.usage.online), admCartao('Ativos hoje', a.usage.today), admCartao('Ativos em 7 dias', a.usage.last7),
    admCartao('Ativos em 30 dias', a.usage.last30), admCartao('Pico de hoje', a.usage.peakToday, 'Mais pessoas online ao mesmo tempo hoje'),
    admCartao('Contas novas (7 dias)', a.usage.newLast7), admCartao('Voltaram na semana', a.usage.returning, 'Contas com mais de 7 dias que abriram o app esta semana'),
    admCartao('Nunca abriram', a.usage.neverUsed, 'Contas ativas que ainda não abriram o app'), admCartao('Pedidos pendentes', a.accounts.pending),
    admCartao('Amizades', a.social.friendships), admCartao('Sem nenhum amigo', a.social.withoutFriends), admCartao('Mensagens (7 dias)', a.social.messagesLast7),
    admCartao('Salas abertas', a.social.openRooms), admCartao('Contas com Google', a.accounts.withGoogle + ' de ' + a.accounts.total, 'Para desligar a senha das contas antigas, todas precisam estar aqui'),
  );
  corpo.append(grade);

  // Gráfico de 14 dias: barras de quem usou (cheia) e do pico (contorno), só com CSS
  const maior = Math.max(1, ...a.daily.map((d) => Math.max(d.active, d.peak, d.signups)));
  const grafico = admEl('div', 'adm-chart');
  grafico.setAttribute('role', 'img');
  grafico.setAttribute('aria-label', 'Pessoas ativas por dia nos últimos 14 dias');
  for (const d of a.daily) {
    const col = admEl('div', 'adm-col');
    col.title = `${admData(Date.parse(d.day + 'T12:00:00'))}: ${d.active} ativas, pico ${d.peak}, ${d.signups} contas novas`;
    const barras = admEl('div', 'adm-bars');
    const pico = admEl('i', 'adm-bar adm-bar-peak');
    pico.style.height = Math.round((d.peak / maior) * 100) + '%';
    const ativa = admEl('i', 'adm-bar');
    ativa.style.height = Math.round((d.active / maior) * 100) + '%';
    barras.append(pico, ativa);
    col.append(barras, admEl('span', 'adm-day', d.day.slice(8)));
    grafico.append(col);
  }
  const caixa = admEl('section', 'adm-box');
  caixa.append(admEl('h3', '', 'Últimos 14 dias'), grafico, admEl('p', 'hint', 'Barra cheia: pessoas que abriram o app no dia. Contorno: o maior número online ao mesmo tempo.'));
  corpo.append(caixa);

  const versoes = admEl('section', 'adm-box');
  versoes.append(admEl('h3', '', 'Versões em uso'));
  if (a.versions.length) {
    const lista = admEl('ul', 'adm-list');
    for (const v of a.versions) lista.append(admEl('li', '', `${v.version} · ${v.n} ${v.n === 1 ? 'pessoa' : 'pessoas'}`));
    versoes.append(lista);
  } else versoes.append(admEl('p', 'hint', 'Aparece quando as pessoas abrirem uma versão com este painel.'));
  corpo.append(versoes);
}

function admPessoaLinha(u, acoes) {
  const li = admEl('li', 'adm-row');
  const ini = admEl('span', 'avatar', (u.displayName || u.email || '?').trim().charAt(0).toUpperCase());
  ini.setAttribute('aria-hidden', 'true');
  const texto = admEl('span', 'adm-row-text');
  texto.append(admEl('strong', '', u.displayName || u.email), admEl('span', 'hint', `${u.email} · desde ${admData(u.createdAt)}`));
  const chips = admEl('span', 'adm-chips');
  chips.append(admEl('span', 'adm-chip' + (u.role === 'admin' ? ' adm-chip-admin' : ''), u.role === 'admin' ? 'Admin' : u.grupo === 'teste' ? 'Teste' : 'Amigo'));
  if (u.status === 'pending') chips.append(admEl('span', 'adm-chip adm-chip-warn', 'Pendente'));
  if (u.status === 'disabled') chips.append(admEl('span', 'adm-chip adm-chip-warn', 'Desativada'));
  // Sem Google, a pessoa fica sem entrar quando a senha for desligada (legacyPasswordLogin)
  if (u.status === 'active' && u.googleLinked === false) chips.append(admEl('span', 'adm-chip adm-chip-warn', 'Sem Google'));
  if (u.online) chips.append(admEl('span', 'adm-chip adm-chip-ok', 'Online'));
  const botoes = admEl('span', 'adm-actions');
  botoes.append(...acoes);
  li.append(ini, texto, chips, botoes);
  return li;
}

async function admAlterar(id, corpo, aviso) {
  try { await admChamar('PATCH', '/v1/admin/users/' + id, corpo); if (aviso) toast(aviso); } catch { /* o aviso de erro já saiu */ }
  await admCarregar();
}

function admPedidos(corpo) {
  const fila = adm.dados.users.filter((u) => u.status === 'pending');
  corpo.append(admEl('p', 'hint', 'Quem entrou com o Google e não estava na lista de convidados espera aqui. Aprovar libera a conta na hora.'));
  if (!fila.length) { corpo.append(admEl('p', 'adm-empty', 'Nenhum pedido esperando.')); return; }
  const ul = admEl('ul', 'adm-rows');
  for (const u of fila) {
    const grupo = admEl('select', 'adm-select');
    grupo.setAttribute('aria-label', 'Grupo de ' + u.displayName);
    for (const [v, n] of [['amigo', 'Amigo'], ['teste', 'Teste']]) grupo.append(new Option(n, v));
    const aprovar = admBtn('Aprovar', async () => {
      try { await admChamar('POST', '/v1/admin/users/' + u.id + '/approve'); await admChamar('PATCH', '/v1/admin/users/' + u.id, { grupo: grupo.value }); toast(u.displayName + ' foi aprovada.'); } catch { /* erro já mostrado */ }
      await admCarregar();
    }, 'btn small primary');
    const recusar = admBtn('Recusar', async () => {
      if (!(await appConfirm(`Recusar ${u.displayName} (${u.email})? A conta fica desativada.`, { title: 'Recusar', ok: 'Recusar', danger: true }))) return;
      await admAlterar(u.id, { status: 'disabled', banReason: 'Pedido recusado' }, 'Pedido recusado.');
    }, 'btn small danger');
    ul.append(admPessoaLinha(u, [grupo, aprovar, recusar]));
  }
  corpo.append(ul);
}

function admConvidados(corpo) {
  const form = admEl('form', 'adm-form');
  const email = admEl('input', 'hub-filter');
  email.type = 'email'; email.placeholder = 'E-mail do Google'; email.required = true; email.autocomplete = 'off'; email.setAttribute('aria-label', 'E-mail do convidado');
  const nome = admEl('input', 'hub-filter');
  nome.type = 'text'; nome.placeholder = 'Nome (opcional)'; nome.maxLength = 60; nome.autocomplete = 'off'; nome.setAttribute('aria-label', 'Nome do convidado');
  const grupo = admEl('select', 'adm-select');
  grupo.setAttribute('aria-label', 'Grupo');
  for (const [v, n] of [['amigo', 'Amigo'], ['teste', 'Teste'], ['admin', 'Administrador']]) grupo.append(new Option(n, v));
  const ok = admEl('button', 'btn small primary', 'Adicionar');
  ok.type = 'submit';
  form.append(email, nome, grupo, ok);
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (grupo.value === 'admin' && !(await appConfirm(`Dar acesso de administrador a ${email.value}? A pessoa vê e muda tudo neste painel.`, { title: 'Novo administrador', ok: 'Dar acesso', danger: true }))) return;
    ok.disabled = true;
    try {
      const r = await admChamar('POST', '/v1/admin/allowlist', { email: email.value.trim(), grupo: grupo.value, label: nome.value.trim() });
      // Conta criada por senha com esse e-mail: o servidor não muda o grupo nem o papel dela até o Google confirmar o e-mail
      toast(r?.semGoogle ? 'E-mail na lista, mas a conta que já existe com ele não foi alterada: o Google ainda não confirmou esse e-mail.' : 'E-mail na lista de convidados.');
    } catch { /* erro já mostrado */ }
    await admCarregar();
  };
  corpo.append(admEl('p', 'hint', 'E-mails da lista entram já ativos, sem esperar aprovação, no grupo que você escolher.'), form);
  if (!adm.dados.allow.length) { corpo.append(admEl('p', 'adm-empty', 'Ninguém na lista ainda.')); return; }
  const ul = admEl('ul', 'adm-rows');
  for (const c of adm.dados.allow) {
    const li = admEl('li', 'adm-row');
    const texto = admEl('span', 'adm-row-text');
    texto.append(admEl('strong', '', c.label || c.email), admEl('span', 'hint', c.label ? c.email : 'sem nome'));
    const chips = admEl('span', 'adm-chips');
    chips.append(admEl('span', 'adm-chip' + (c.grupo === 'admin' ? ' adm-chip-admin' : ''), { amigo: 'Amigo', teste: 'Teste', admin: 'Admin' }[c.grupo]),
      admEl('span', 'adm-chip' + (c.joined ? ' adm-chip-ok' : ''), c.joined ? 'Já entrou' : 'Aguardando'));
    const remover = admBtn('Remover', async () => {
      if (!(await appConfirm(`Tirar ${c.email} da lista? Quem já entrou continua com a conta.`, { title: 'Remover da lista', ok: 'Remover', danger: true }))) return;
      try { await admChamar('DELETE', '/v1/admin/allowlist/' + encodeURIComponent(c.email)); } catch { /* erro já mostrado */ }
      await admCarregar();
    }, 'btn small');
    li.append(texto, chips, admEl('span', 'adm-actions'));
    li.lastChild.append(remover);
    ul.append(li);
  }
  corpo.append(ul);
}

function admPessoas(corpo) {
  const barra = admEl('div', 'adm-filter');
  const seg = admEl('div', 'seg');
  seg.setAttribute('role', 'tablist');
  const conta = (f) => adm.dados.users.filter((u) => admFiltra(u, f)).length;
  for (const [id, nome] of ADM_FILTROS) {
    const b = admEl('button', '', nome);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(adm.filtro === id));
    b.append(' ', admEl('span', 'count', String(conta(id))));
    b.onclick = () => { adm.filtro = id; admDesenhar(); };
    seg.append(b);
  }
  const busca = admEl('input', 'hub-filter');
  busca.type = 'search'; busca.placeholder = 'Buscar nome ou e-mail'; busca.value = adm.busca; busca.setAttribute('aria-label', 'Buscar pessoas');
  busca.oninput = () => { adm.busca = busca.value; admLista(); };
  barra.append(seg, busca);
  corpo.append(barra);
  const lista = admEl('div', '');
  lista.id = 'adminPeople';
  corpo.append(lista);
  admLista();
}
function admFiltra(u, f) {
  if (f === 'admin') return u.role === 'admin';
  if (f === 'pendente') return u.status === 'pending';
  if (f === 'desativado') return u.status === 'disabled';
  if (f === 'todos') return true;
  return u.role !== 'admin' && u.status === 'active' && u.grupo === f;
}
function admLista() {
  const alvo = document.getElementById('adminPeople');
  if (!alvo) return;
  alvo.textContent = '';
  const q = adm.busca.trim().toLowerCase();
  const gente = adm.dados.users.filter((u) => admFiltra(u, adm.filtro) && (!q || (u.displayName + ' ' + u.email).toLowerCase().includes(q)));
  if (!gente.length) { alvo.append(admEl('p', 'adm-empty', 'Ninguém neste filtro.')); return; }
  const ul = admEl('ul', 'adm-rows');
  for (const u of gente) {
    const eu = razzeUser && u.id === razzeUser.id;
    const acoes = [];
    if (u.role !== 'admin' && u.status === 'active') {
      const g = admEl('select', 'adm-select');
      g.setAttribute('aria-label', 'Grupo de ' + u.displayName);
      for (const [v, n] of [['amigo', 'Amigo'], ['teste', 'Teste']]) g.append(new Option(n, v));
      g.value = u.grupo;
      g.onchange = () => void admAlterar(u.id, { grupo: g.value }, 'Grupo de ' + u.displayName + ' mudou.');
      acoes.push(g);
    }
    if (!eu) {
      if (u.status === 'active') {
        acoes.push(admBtn(u.role === 'admin' ? 'Tirar admin' : 'Tornar admin', async () => {
          const virar = u.role !== 'admin';
          if (!(await appConfirm(virar ? `Dar acesso de administrador a ${u.displayName}?` : `Tirar o acesso de administrador de ${u.displayName}?`, { title: 'Administrador', ok: virar ? 'Dar acesso' : 'Tirar', danger: true }))) return;
          await admAlterar(u.id, { role: virar ? 'admin' : 'user' }, virar ? u.displayName + ' agora é administradora.' : 'Acesso retirado.');
        }));
        acoes.push(admBtn('Desativar', async () => {
          if (!(await appConfirm(`Desativar ${u.displayName}? Ela sai de todos os PCs e não consegue entrar.`, { title: 'Desativar', ok: 'Desativar', danger: true }))) return;
          await admAlterar(u.id, { status: 'disabled', banReason: 'Desativada pelo administrador' }, u.displayName + ' foi desativada.');
        }, 'btn small danger'));
      } else if (u.status === 'disabled') acoes.push(admBtn('Reativar', () => void admAlterar(u.id, { status: 'active' }, u.displayName + ' foi reativada.')));
      else if (u.status === 'pending') acoes.push(admBtn('Aprovar', () => void admAlterar(u.id, { status: 'active' }, u.displayName + ' foi aprovada.'), 'btn small primary'));
    } else acoes.push(admEl('span', 'hint', 'Você'));
    ul.append(admPessoaLinha(u, acoes));
  }
  alvo.append(ul);
}

function admServidor(corpo) {
  corpo.append(admEl('p', 'hint', 'Vale para todo mundo, na hora. Cada mudança fica no registro do servidor.'));
  const ul = admEl('ul', 'adm-rows');
  for (const [chave, nome, dica] of ADM_SERVIDOR) {
    const li = admEl('li', 'adm-row');
    const texto = admEl('span', 'adm-row-text');
    texto.append(admEl('strong', '', nome), admEl('span', 'hint', dica));
    const label = admEl('label', 'adm-switch');
    const input = admEl('input');
    input.type = 'checkbox';
    input.checked = !!adm.dados.settings[chave];
    input.setAttribute('aria-label', nome);
    input.onchange = async () => {
      try { await admChamar('PATCH', '/v1/admin/settings', { [chave]: input.checked }); toast(nome + (input.checked ? ': ligado.' : ': desligado.')); } catch { /* erro já mostrado */ }
      await admCarregar();
    };
    label.append(input, admEl('span', 'adm-switch-ui'));
    li.append(texto, label);
    ul.append(li);
  }
  corpo.append(ul);
}

function setupAdmin() {
  $('adminClose').onclick = fecharAdmin;
  $('adminRefresh').onclick = () => void admCarregar();
  $('razzeAdminOpen').onclick = abrirAdmin;
  $('adminDialog').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.app-confirm')) fecharAdmin(); });
  admAtualizarBotao();
}
