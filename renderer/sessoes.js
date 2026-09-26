'use strict';
// Sessões abertas na rede: a lista da tela inicial, com Entrar. Vêm de dois lugares: o anúncio pela rede
// (main/sessoes.js, UDP) e, como reserva, a pergunta direta aos endereços de salas em que você já esteve
// (se a rede não deixar passar o anúncio). Só com a tela inicial à vista.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, sala.

const SONDA_MS = 20000;        // de quanto em quanto tempo pergunta de novo aos endereços conhecidos
const SONDA_ESPERA = 2000;     // quem não responder em 2 s fica de fora (servidor antigo não responde)
const SONDA_VALIDADE = 45000;
const CONHECIDAS_MAX = 20;
const sessoes = {
  observando: false,
  rede: [],                    // do anúncio pela rede: { id, host, porta, pessoas, senha, versao, endereco }
  diretas: new Map(),          // da pergunta direta: id -> { ...o mesmo, visto }
  sondaTimer: null,
  procurando: false,           // nos primeiros segundos, a lista vazia diz "procurando"
  procuraTimer: null,
};

// Endereços de salas em que você já esteve (e dos IPs da Radmin de quem estava nelas), para o plano B
function conhecidas() {
  try {
    const l = JSON.parse(load('sessoesConhecidas', '[]'));
    return Array.isArray(l) ? l.filter((a) => typeof a === 'string' && /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(a)) : [];
  } catch { return []; }
}
function lembrarSessoes(addrs) {
  const novos = addrs.filter((a) => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(a) && !a.startsWith('127.'));
  const l = [...new Set([...novos, ...conhecidas()])].slice(0, CONHECIDAS_MAX);
  save('sessoesConhecidas', JSON.stringify(l));
}

// Chamado ao entrar numa sala: o endereço dela e o de quem está nela (se um deles abrir uma sala depois)
function lembrarDaSala() {
  const addrs = [];
  if (state.host && state.host !== '127.0.0.1') addrs.push(`${state.host}:${state.port}`);
  for (const m of state.members.values()) for (const ip of m.addrs || []) if (ip.startsWith('26.')) addrs.push(`${ip}:${state.port}`);
  lembrarSessoes(addrs);
}

function setSessionWatch(on) {
  if (on === sessoes.observando) return;
  sessoes.observando = on;
  window.api.sessoesObservar(on).catch(() => {});
  clearInterval(sessoes.sondaTimer);
  clearTimeout(sessoes.procuraTimer);
  if (on) {
    sessoes.procurando = true;
    sessoes.procuraTimer = setTimeout(() => { sessoes.procurando = false; renderSessoes(); }, 3000);
    sondar();
    sessoes.sondaTimer = setInterval(sondar, SONDA_MS);
  } else {
    sessoes.rede = [];
  }
  renderSessoes();
}

function onSessoesDaRede(lista) {
  sessoes.rede = Array.isArray(lista) ? lista : [];
  renderSessoes();
}

// Plano B: pergunta "info" direto a cada endereço conhecido, sem entrar (a sala responde nome, pessoas e senha)
function sondar() {
  for (const addr of conhecidas()) {
    let ws;
    try { ws = new WebSocket(`ws://${addr}`); } catch { continue; }
    const timer = setTimeout(() => ws.close(), SONDA_ESPERA);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'info' }));
    ws.onmessage = (e) => {
      clearTimeout(timer);
      ws.close();
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!m || m.type !== 'info' || m.app !== 'tela-p2p' || !/^[a-f0-9]{16}$/.test(String(m.id))) return;
      if (typeof m.host !== 'string' || !Number.isInteger(m.pessoas) || !Number.isInteger(m.porta)) return;
      const [ip] = addr.split(':');
      sessoes.diretas.set(m.id, {
        id: m.id, host: m.host.slice(0, 32), porta: m.porta, pessoas: m.pessoas, senha: !!m.senha, versao: '', endereco: ip, visto: Date.now(),
      });
      renderSessoes();
    };
    ws.onerror = () => clearTimeout(timer);
  }
}

// As duas fontes juntas, pelo id (o anúncio pela rede vale mais: é o mais atual)
function listaSessoes() {
  const agora = Date.now();
  for (const [id, s] of sessoes.diretas) if (agora - s.visto > SONDA_VALIDADE) sessoes.diretas.delete(id);
  const porId = new Map(sessoes.diretas);
  for (const s of sessoes.rede) porId.set(s.id, s);
  return [...porId.values()].sort((a, b) => a.host.localeCompare(b.host, 'pt-BR'));
}

function renderSessoes() {
  const list = $('sessionList');
  if (!list) return;
  const all = sessoes.observando ? listaSessoes() : [];
  list.replaceChildren(...all.map(sessionRow));
  $('sessionsEmpty').hidden = all.length > 0;
  $('sessionsEmpty').textContent = sessoes.procurando
    ? 'Procurando sessões abertas na rede…'
    : 'Nenhuma sessão aberta na rede agora. Quando alguém criar uma, ela aparece aqui.';
}

function sessionRow(s) {
  const li = document.createElement('li');
  li.className = 'session';
  const info = document.createElement('div');
  info.className = 'session-info';
  const name = document.createElement('strong');
  name.textContent = `Sessão de ${s.host}`;
  const meta = document.createElement('span');
  meta.className = 'session-meta';
  meta.textContent = `${s.pessoas} ${s.pessoas === 1 ? 'pessoa' : 'pessoas'}${s.senha ? ', com senha' : ''}`;
  if (s.senha) meta.insertAdjacentHTML('afterbegin', ICON.lock);
  info.append(name, meta);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small primary';
  btn.textContent = 'Entrar';
  btn.title = `Entrar na sessão de ${s.host} (${s.endereco}:${s.porta})`;
  btn.onclick = () => enterSession(s);
  li.append(info, btn);
  return li;
}

// Entrar: preenche o endereço; com senha, abre o "Entrar numa sala" para digitar
function enterSession(s) {
  $('roomAddr').value = `${s.endereco}:${s.porta}`;
  save('roomAddr', $('roomAddr').value);
  if (s.senha) {
    setJoinOpen(true);
    $('joinPassword').value = '';
    $('joinPassword').focus();
    toast(`A sessão de ${s.host} tem senha. Digite e clique em Entrar.`);
    return;
  }
  joinRoom();
}
