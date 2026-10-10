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
  provider: '',
  razze: [],
  amigos: [],                  // modo Internet: as salas dos amigos do Razze (salas-amigos.js)
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
  if (state.cloud) return; // modo Internet: a sala está no servidor, não em endereços da rede
  const addrs = [];
  if (state.host && state.host !== '127.0.0.1') addrs.push(`${state.host}:${state.port}`);
  for (const m of state.members.values()) for (const ip of m.addrs || []) if (ip.startsWith('26.')) addrs.push(`${ip}:${state.port}`);
  lembrarSessoes(addrs);
}

// De quem é a sala em que você entrou, o modo e quando: o "Última sala" do Início (inicio.js › renderLastRoom). Só
// para sala dos outros; vale enquanto o roomAddr guardado for o desta sala
function lembrarUltimaSala() {
  if (!state.hostId || state.hostId === state.myId) return;
  const modo = state.cloud ? 'internet' : selectedNetworkProvider() === 'razze' ? 'razze' : 'radmin';
  save('ultimaSala', JSON.stringify({ endereco: load('roomAddr'), host: nameOf(state.hostId).slice(0, 32), modo, quando: Date.now() }));
}

// Procura sessões com a tela inicial à vista
function sessionWatchWanted() { return !$('home').hidden; }

function setSessionWatch(on) {
  on = !!on;
  const provider = selectedNetworkProvider();
  if (on === sessoes.observando && provider === sessoes.provider) return;
  sessoes.provider = provider;
  sessoes.observando = on;
  const lan = provider === 'radmin'; // Razze e Internet não anunciam sessões na rede local
  window.api.sessoesObservar(on && lan).catch(() => {});
  clearInterval(sessoes.sondaTimer);
  clearTimeout(sessoes.procuraTimer);
  sessoes.procurando = false;
  if (on && lan) {
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

// A sala em que você está (docs/spec/inicio-novo.md): ela aparece só na faixa do topo do Início, nunca na lista
function ehMinhaSala(s) {
  if (!state.myId || !s) return false;
  if (s.codigo) return state.cloud?.code === s.codigo && state.cloud?.url === s.servidor;
  if (state.cloud) return false;
  if (state.sessao?.id && s.id === state.sessao.id) return true;
  return !!s.endereco && `${s.endereco}:${s.porta}` === state.roomAddr;
}

// As duas fontes juntas, pelo id (o anúncio pela rede vale mais: é o mais atual), sem a sala em que você está
function listaSessoes() {
  const porNome = (a, b) => a.host.localeCompare(b.host, 'pt-BR');
  if (selectedNetworkProvider() === 'internet') return sessoes.amigos.filter((s) => !ehMinhaSala(s)).sort(porNome);
  if (selectedNetworkProvider() === 'razze') return sessoes.razze.filter((s) => s.networkId === networkPreferences().activeNetworkId && !ehMinhaSala(s)).sort(porNome);
  const agora = Date.now();
  for (const [id, s] of sessoes.diretas) if (agora - s.visto > SONDA_VALIDADE) sessoes.diretas.delete(id);
  const porId = new Map(sessoes.diretas);
  for (const s of sessoes.rede) porId.set(s.id, s);
  return [...porId.values()].filter((s) => !ehMinhaSala(s)).sort(porNome);
}

function renderSessoes() {
  const list = $('sessionList');
  if (!list) return;
  const all = sessoes.observando ? listaSessoes() : [];
  list.replaceChildren(...all.map(sessionRow));
  // Criar e entrar não mudam de lugar nem de peso com sala na lista (docs/spec/inicio-novo.md); o título conta quantas
  const temSalas = all.length > 0;
  $('home').classList.toggle('tem-salas', temSalas);
  $('sessionsTitle').dataset.total = temSalas ? String(all.length) : '';
  $('sessionsEmpty').hidden = temSalas;
  if (typeof renderHomeTopo === 'function') renderHomeTopo(); // o resumo do topo fala da sala aberta
  if (typeof renderLastRoom === 'function') renderLastRoom(); // "Última sala" não repete uma sala da lista
  const rede = selectedNetworkProvider() === 'razze' ? 'nesta rede' : window.api.platform === 'linux' ? 'na rede local' : 'na Radmin';
  $('sessionsEmpty').textContent = sessoes.procurando
    ? 'Procurando salas abertas na rede…'
    : selectedNetworkProvider() === 'internet'
      ? (razzeLive.updatedAt ? 'Nenhum amigo com sala aberta pela internet agora. Crie uma e chame os amigos.' : 'Entre na sua conta Razze (no seu Perfil) para ver as salas dos seus amigos aqui.')
    : selectedNetworkProvider() === 'razze'
      ? (razzeLive.error ? 'Não foi possível atualizar as salas: ' + razzeLive.error : networkPreferences().activeNetworkId ? `Nenhuma sala aberta ${rede} agora. Crie uma e chame os amigos.` : 'Conecte uma rede Razze para descobrir suas salas.')
      : `Nenhuma sala aberta ${rede} agora. Crie uma e chame os amigos.`;
}

// O amigo dono da sala (modo Internet, pela conta) e os seus amigos que estão nela: o cartão mostra o jogo, a voz e os rostos
function amigosDaSala(s) {
  const amigos = typeof friendsData === 'object' ? friendsData.friends : [];
  const dono = s.userId ? amigos.find((f) => f.id === s.userId) || null : null;
  const dentro = amigos.filter((f) => f !== dono && f.online && f.sala && f.sala.host === s.host && (f.sala.modo === 'internet') === !!s.codigo);
  return { dono, dentro };
}

function rostoDe(nome) {
  const r = document.createElement('span');
  r.className = 'avatar';
  r.textContent = (String(nome).trim()[0] || '?').toUpperCase();
  r.style.setProperty('--person', personColor(nome));
  r.title = nome;
  return r;
}

function sessionRow(s) {
  const { dono, dentro } = amigosDaSala(s);
  const li = document.createElement('li');
  li.className = 'session';
  const dot = rostoDe(s.host);
  dot.removeAttribute('title');
  dot.setAttribute('aria-hidden', 'true');
  const info = document.createElement('div');
  info.className = 'session-info';
  const vivo = document.createElement('span');
  vivo.className = 'session-live';
  vivo.textContent = 'AO VIVO';
  const name = document.createElement('strong');
  name.textContent = `Sala de ${s.host}`;
  const meta = document.createElement('span');
  meta.className = 'session-meta';
  const voz = dono?.sala?.voz || dentro.some((f) => f.sala.voz) ? ' · voz ligada' : '';
  // dentro: os outros amigos na sala (o dono já é o rosto grande do cartão)
  // com: os meus amigos que mostram a sala (modo Internet; salas-amigos.js)
  const com = s.codigo ? comAmigosDaSala(s) : '';
  meta.textContent = `${s.pessoas} ${s.pessoas === 1 ? 'pessoa' : 'pessoas'}${s.codigo ? ' · pela internet' : ''}${com ? ' · ' + com : ''}${voz}${s.senha ? ', com senha' : ''}`;
  if (s.senha) meta.insertAdjacentHTML('afterbegin', ICON.lock);
  info.append(vivo, name, meta);
  if (dono?.activity?.game) {
    const jogo = document.createElement('span');
    jogo.className = 'session-game';
    jogo.textContent = 'Jogando ' + dono.activity.game;
    info.append(jogo);
  }
  if (dentro.length) {
    const rostos = document.createElement('span');
    rostos.className = 'session-faces';
    rostos.setAttribute('aria-label', 'Amigos na sala: ' + dentro.map((f) => f.displayName).join(', '));
    rostos.append(...dentro.slice(0, 4).map((f) => rostoDe(f.displayName)));
    info.append(rostos);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn session-entrar'; // contornado: o azul cheio é de Criar sala e de Voltar para a sala
  btn.textContent = 'Entrar';
  btn.title = s.codigo ? `Entrar na sala de ${s.host} (código ${s.codigo})` : `Entrar na sala de ${s.host} (${s.endereco}:${s.porta})`;
  btn.onclick = () => enterSession(s);
  li.append(dot, info, btn);
  return li;
}

// Entrar: preenche o endereço; com senha, abre o "Entrar numa sala" para digitar
function enterSession(s) {
  if (s.codigo) return entrarSalaAmigo(s); // sala de amigo pela internet (salas-amigos.js)
  $('roomAddr').value = `${s.endereco}:${s.porta}`;
  save('roomAddr', $('roomAddr').value);
  if (s.senha) {
    setJoinOpen(true);
    $('joinPassword').value = '';
    $('joinPassword').focus();
    toast(`A sala de ${s.host} tem senha. Digite e clique em Entrar.`);
    return;
  }
  joinRoom();
}
