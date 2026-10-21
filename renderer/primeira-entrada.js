'use strict';
// Primeira entrada (3 telas: como usar, nome e foto, conta) e o Início de quem tem conta: amigos online com Ligar e
// Mensagem, e "Abrir minha sala" em um clique. Plano e motivos: docs/auditoria-fluxo.md.
// Script clássico: só declara; quem liga é renderer/inicio.js (setupPrimeiraEntrada). Usa: util, conectividade
// (razzeUser, refreshRazzeState), hub (friendsData, hubAvatar, openFriendsDialog), chamada (ligarPara, novaSenhaSala),
// mensagens (openDm), fotos (setMyPhoto), sala (createRoom), conta (atvLigada, atvAgendar).

const entrada = { passo: 1, modo: '', registrar: false, ocupado: false };

const modoDeUso = () => load('modoUso', '');

function entradaIrPara(n) {
  entrada.passo = n;
  for (const s of $('onboarding').querySelectorAll('[data-ob]')) s.hidden = Number(s.dataset.ob) !== n;
  [...$('obDots').children].forEach((d, i) => d.classList.toggle('on', i < n));
  $({ 1: 'obModeFriends', 2: 'obName', 3: 'obEmail' }[n]).focus();
}

function abrirPrimeiraEntrada(passo = 1) {
  $('obName').value = $('name').value || '';
  $('obAtvJogo').checked = atvLigada('Jogo');
  $('obAtvMusica').checked = atvLigada('Musica');
  $('onboarding').hidden = false;
  entradaIrPara(passo);
}

function fecharPrimeiraEntrada() {
  $('onboarding').hidden = true;
  save('primeiraEntrada', '1');
  renderHomeAmigos();
  void retomarConviteAmigo();
  if (!$('home').hidden) $('goQuick').focus();
}

function entradaEscolher(modo) {
  entrada.modo = modo;
  save('modoUso', modo);
  entradaIrPara(2);
}

function entradaContinuarNome() {
  const nome = $('obName').value.trim();
  if (!nome) {
    $('obNameHint').textContent = 'Escolha um nome para os amigos te reconhecerem.';
    return $('obName').focus();
  }
  $('name').value = nome;
  save('name', nome);
  // A atividade do perfil (conta.js): a mesma escolha de Configurações › Atividade
  for (const [id, k] of [['obAtvJogo', 'Jogo'], ['obAtvMusica', 'Musica']]) {
    save('atividade' + k, $(id).checked ? '1' : '0');
    $('atv' + k).checked = $(id).checked;
  }
  atvAgendar();
  atvAgendarProcura();
  if (entrada.modo === 'amigos' && !razzeUser) return entradaIrPara(3);
  fecharPrimeiraEntrada();
}

function entradaAba(registrar) {
  entrada.registrar = registrar;
  $('obTabLogin').setAttribute('aria-selected', String(!registrar));
  $('obTabRegister').setAttribute('aria-selected', String(registrar));
  $('obSubmit').textContent = registrar ? 'Criar conta' : 'Entrar';
  $('obPassword').autocomplete = registrar ? 'new-password' : 'current-password';
  $('obStatus').textContent = '';
}

async function entradaEnviarConta() {
  if (entrada.ocupado) return;
  const email = $('obEmail').value.trim();
  const senha = $('obPassword').value;
  if (!email || !senha) { $('obStatus').textContent = 'Preencha o e-mail e a senha.'; return; }
  entrada.ocupado = true;
  $('obSubmit').disabled = true;
  $('obStatus').textContent = entrada.registrar ? 'Criando a conta…' : 'Entrando…';
  try {
    if (entrada.registrar) {
      const r = await window.api.razzeRegister(email, senha, $('name').value.trim() || email);
      if (r.status === 'pending_approval') {
        $('obStatus').textContent = 'Conta criada. O administrador do servidor ainda precisa aprovar; enquanto isso, use como sala rápida.';
        $('obPassword').value = '';
        return;
      }
    }
    const r = await window.api.razzeLogin(email, senha);
    razzeUser = r.user;
    $('obPassword').value = '';
    await refreshRazzeState();
    fecharPrimeiraEntrada();
    toast('Você entrou. Seus amigos aparecem no Início.');
  } catch (e) {
    $('obStatus').textContent = 'Não deu: ' + e.message;
  } finally {
    entrada.ocupado = false;
    $('obSubmit').disabled = false;
  }
}

// Abrir a sala em um clique: senha gerada (no modo Internet ela é obrigatória) e visível para quem pode ver; as
// opções (porta, senha própria) ficam na tela "Opções da sala"
async function abrirMinhaSala() {
  $('roomPassword').value = selectedNetworkProvider() === 'internet' ? novaSenhaSala() : '';
  $('roomVisible').checked = load('sessaoVisivel', '1') !== '0';
  $('roomAmigosMembros').checked = load('salaAmigosMembros', '1') !== '0';
  await createRoom();
}

// ---------- Início de quem tem conta ----------
// Topo: com nome, "Boa noite, Naitsi" (o lápis abre o campo); sem nome, o slogan e o campo à vista. Embaixo, o resumo
// do que está acontecendo (sala de amigo aberta, quem está online, quem está jogando) e a constelação dos amigos.
const SLOGAN = 'Sua tela, direto no PC dos amigos.';
const saudacao = (h) => (h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite');

function renderHomeTopo() {
  const nome = $('name').value.trim();
  const editando = $('home').classList.contains('editando-nome');
  $('homeTitle').textContent = nome ? `${saudacao(new Date().getHours())}, ${nome}` : SLOGAN;
  $('homeNameLabel').hidden = !!nome && !editando;
  $('homeNameEdit').hidden = !nome || editando;

  const logado = !!razzeUser;
  const online = logado ? friendsData.friends.filter((f) => f.online) : [];
  const salas = typeof listaSessoes === 'function' && sessoes.observando ? listaSessoes() : [];
  const resumo = $('homeResumo');
  resumo.textContent = '';
  if (state.myId) { // a sala em que você está já é a faixa de cima (docs/spec/inicio-novo.md)
    resumo.textContent = nome ? 'O que você quer fazer agora?' : '';
  } else if (salas.length) {
    const vivo = document.createElement('span');
    vivo.className = 'home-resumo-vivo';
    vivo.textContent = salas.length === 1 ? `${salas[0].host} abriu uma sala` : `${salas.length} salas abertas agora`;
    resumo.append(vivo);
    if (salas.length === 1) resumo.append(` · ${salas[0].pessoas} ${salas[0].pessoas === 1 ? 'pessoa' : 'pessoas'}`);
  } else if (logado) {
    const jogando = online.find((f) => f.activity?.game);
    resumo.textContent = !online.length ? 'Nenhum amigo online agora.'
      : `${online.length} ${online.length === 1 ? 'amigo online' : 'amigos online'}${jogando ? ` · ${jogando.displayName} está jogando ${jogando.activity.game}` : ''}`;
  }
  resumo.hidden = !resumo.textContent;
  renderHomeCeu(logado, online);

  // Quem vê a sala que você abrir (só no modo Internet a lista é dos amigos da conta); sem ninguém, o que o botão faz
  const internet = selectedNetworkProvider() === 'internet';
  const visivel = internet && logado && load('sessaoVisivel', '1') !== '0';
  const nomes = online.map((f) => f.displayName);
  $('goQuickSub').textContent = visivel && nomes.length
    ? (nomes.length === 1 ? `Abre na hora. ${nomes[0]} vê a sua sala.` : nomes.length === 2 ? `Abre na hora. ${nomes[0]} e ${nomes[1]} veem a sua sala.` : `Abre na hora. ${nomes.length} amigos online veem a sua sala.`)
    : internet ? 'Abre na hora, com senha gerada.' : 'Abre na hora. Os amigos entram pelo seu endereço.';
}

// Numa sala, criar ou entrar em outra pergunta antes de sair desta (docs/spec/inicio-novo.md) e só depois faz. Fora de
// sala, faz na hora (sem esperar: quem clica e já preenche a tela seguinte, como os testes, não fica para trás)
function foraDaSala(acao, fazer) {
  if (!state.myId) return fazer();
  void sairDaSalaAntes(acao).then((ok) => { if (ok) fazer(); });
}
async function sairDaSalaAntes(acao) {
  if (!state.myId) return true;
  const sala = state.hostId && state.hostId !== state.myId ? `da sala de ${nameOf(state.hostId)}` : 'da sua sala';
  if (!(await appConfirm(`Você sai ${sala} para ${acao}.`, { title: 'Sair da sala?', ok: 'Sair e continuar' }))) return false;
  leaveRoom();
  return true;
}

// A constelação do topo: você no meio e até 5 amigos online em volta, ligados por pontilhados. Quem está numa sala
// brilha na cor de "ao vivo". Parada: nada se mexe (pode estar com jogo aberto)
const CEU_POS = [[30, 56], [190, 50], [62, 16], [160, 76], [204, 14]];
function renderHomeCeu(logado, online) {
  const ceu = $('homeCeu');
  ceu.toggleAttribute('hidden', !logado); // SVG não tem a propriedade .hidden: só o atributo
  if (!logado) return;
  const NS = 'http://www.w3.org/2000/svg';
  const novo = (tag, attrs, cls) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (cls) e.setAttribute('class', cls);
    return e;
  };
  const eu = [110, 30];
  const nomeCurto = (n) => (n.length > 12 ? n.slice(0, 11) + '…' : n);
  ceu.replaceChildren();
  const amigos = online.slice(0, CEU_POS.length);
  amigos.forEach((f, i) => {
    const [x, y] = CEU_POS[i];
    ceu.append(novo('line', { x1: eu[0], y1: eu[1], x2: x, y2: y }, 'ceu-linha'));
  });
  amigos.forEach((f, i) => {
    const [x, y] = CEU_POS[i];
    const vivo = !!f.sala;
    if (vivo) ceu.append(novo('circle', { cx: x, cy: y, r: 9 }, 'ceu-anel'));
    ceu.append(novo('circle', { cx: x, cy: y, r: 4 }, vivo ? 'ceu-estrela vivo' : 'ceu-estrela'));
    const t = novo('text', { x, y: y > 40 ? y + 16 : y - 9 }, vivo ? 'ceu-nome vivo' : 'ceu-nome');
    t.textContent = nomeCurto(f.displayName);
    ceu.append(t);
  });
  ceu.append(novo('circle', { cx: eu[0], cy: eu[1], r: 10 }, 'ceu-anel eu'), novo('circle', { cx: eu[0], cy: eu[1], r: 5 }, 'ceu-estrela eu'));
  const voce = novo('text', { x: eu[0], y: eu[1] - 15 }, 'ceu-nome eu');
  voce.textContent = 'você';
  ceu.append(voce);
  ceu.setAttribute('aria-label', amigos.length ? `Você e ${amigos.map((f) => f.displayName).join(', ')} online` : 'Nenhum amigo online agora');
}

// Etiqueta com ícone (jogo, música, sala) na linha do amigo
function homeChip(icone, texto, cls = '') {
  const chip = document.createElement('span');
  chip.className = 'home-chip' + (cls ? ' ' + cls : '');
  if (icone) chip.innerHTML = ICON[icone];
  // O texto num span: numa coluna estreita ele corta com "…" (o inteiro fica na dica)
  const t = document.createElement('span');
  t.className = 'home-chip-texto';
  t.textContent = texto;
  chip.append(t);
  chip.title = texto;
  return chip;
}

function homeIconBtn(icone, label, onclick, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn icon small' + (cls ? ' ' + cls : '');
  setIcon(b, icone, label);
  b.onclick = onclick;
  return b;
}

// "Chamar para minha sala": manda o convite da sala em que você está; fora de sala, abre a sua antes
async function chamarParaMinhaSala(f) {
  if (!state.myId) {
    await abrirMinhaSala();
    if (!state.myId) return; // não abriu: o erro já apareceu
  }
  await convidarPorMensagem(f, toast);
}

// Aba e busca da lista de amigos do Início: Ativos (quem está online), Todos e Pedidos (só aparece com pedido)
const homeAmigos = { aba: 'ativos', busca: '' };

// Uma linha de amigo: quem é, o que está fazendo e o que dá para fazer agora (Entrar, Mensagem, Ligar)
function homeAmigoLinha(f) {
  const li = document.createElement('li');
  li.className = 'home-friend' + (f.online ? '' : ' offline');
  const nome = document.createElement('span');
  nome.className = 'home-friend-name';
  const quem = document.createElement('strong');
  quem.textContent = f.displayName;
  const chips = document.createElement('span');
  chips.className = 'home-friend-chips';
  // Em que sala o amigo está, em qualquer modo (salas-amigos.js: textoSalaDoAmigo)
  const naSala = f.online && typeof textoSalaDoAmigo === 'function' ? textoSalaDoAmigo(f) : '';
  const atividade = f.online ? f.activity : null;
  if (naSala) chips.append(homeChip('', naSala, 'home-friend-sala'));
  if (atividade?.game) chips.append(homeChip('game', atividade.game));
  if (atividade?.artist) {
    // A música: clicar mostra a faixa
    const musica = document.createElement('button');
    musica.type = 'button';
    musica.className = 'home-chip home-friend-music';
    musica.innerHTML = ICON.music;
    const texto = document.createTextNode(atividade.artist);
    const completo = atividade.title ? atividade.title + ' — ' + atividade.artist : atividade.artist;
    musica.append(texto);
    musica.title = 'Clique para ver a música';
    musica.onclick = () => { texto.textContent = texto.textContent === atividade.artist ? completo : atividade.artist; };
    chips.append(musica);
  }
  if (!chips.childNodes.length) {
    const estado = document.createElement('span');
    estado.className = 'hint home-friend-bio';
    estado.textContent = !f.online ? 'Offline' : f.bio || 'Online';
    chips.append(estado);
  }
  nome.append(quem, chips);
  const acoes = document.createElement('span');
  acoes.className = 'home-friend-actions';
  // A sala pela internet em que o amigo está e que ele deixa entrar: Entrar, sem código nem senha (salas-amigos.js)
  const salaDele = f.online && typeof salaDoAmigo === 'function' ? salaDoAmigo(f) : null;
  if (salaDele) {
    const entrar = document.createElement('button');
    entrar.type = 'button';
    entrar.className = 'btn small primary home-friend-entrar';
    entrar.textContent = 'Entrar na sala';
    entrar.title = `Entrar na sala de ${salaDele.host}, onde ${f.displayName} está`;
    entrar.onclick = () => void entrarPeloAmigo(f);
    acoes.append(entrar);
  } else if (naSala && !f.sala?.minha && !/^Na sua sala/.test(naSala)) {
    // Está numa sala em que não dá para entrar com um clique: pede para ele deixar (mensagem com cartão, sem senha)
    const pedir = document.createElement('button');
    pedir.type = 'button';
    pedir.className = 'btn small home-friend-pedir';
    pedir.textContent = 'Pedir para entrar';
    pedir.title = `Manda um pedido para ${f.displayName} deixar você entrar na sala`;
    pedir.onclick = () => void pedirParaEntrar(f);
    acoes.append(pedir);
  }
  acoes.append(homeIconBtn('chat', `Mensagem para ${f.displayName}`, () => openDm(f.id)));
  if (f.online) {
    acoes.append(
      homeIconBtn('phone', `Ligar para ${f.displayName}: cria uma sala só para vocês e entra na voz`, () => void ligarPara(f.id), 'home-friend-ligar'),
      homeIconBtn('userPlus', state.myId ? `Chamar ${f.displayName} para a sua sala (manda o convite)` : `Chamar ${f.displayName}: abre a sua sala e manda o convite`,
        () => void chamarParaMinhaSala(f), 'home-friend-chamar'));
  }
  li.append(hubAvatar(f.displayName, f.online), nome, acoes);
  return li;
}

// Pedido de amizade: recebido (Aceitar) ou enviado (Cancelar)
function homePedidoLinha(r, recebido) {
  const li = document.createElement('li');
  li.className = 'home-friend';
  const nome = document.createElement('span');
  nome.className = 'home-friend-name';
  const quem = document.createElement('strong');
  quem.textContent = r.displayName;
  const sub = document.createElement('span');
  sub.className = 'hint home-friend-bio';
  sub.textContent = recebido ? 'Quer ser seu amigo' : 'Aguardando resposta';
  nome.append(quem, sub);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small' + (recebido ? ' primary' : '');
  b.textContent = recebido ? 'Aceitar' : 'Cancelar';
  b.title = recebido ? `Aceitar o pedido de ${r.displayName}` : `Cancelar o pedido para ${r.displayName}`;
  b.onclick = () => void (recebido ? acceptFriend(r) : cancelFriendRequest(r));
  const acoes = document.createElement('span');
  acoes.className = 'home-friend-actions';
  acoes.append(b);
  li.append(hubAvatar(r.displayName), nome, acoes);
  return li;
}

function renderHomeAmigos() {
  if (!$('homeFriends')) return;
  renderHomeTopo();
  const logado = !!razzeUser;
  $('homeSignin').hidden = logado || modoDeUso() !== 'amigos';
  $('homeFriends').hidden = !logado;
  $('homeMensagens').hidden = !logado;
  if (typeof fillDmList === 'function') fillDmList('homeDm');
  if (!logado) return;
  const todos = friendsData.friends;
  const ativos = todos.filter((f) => f.online);
  const recebidos = friendsData.incoming, enviados = friendsData.outgoing;
  const pedidos = recebidos.length + enviados.length;
  if (homeAmigos.aba === 'pedidos' && !pedidos) homeAmigos.aba = 'ativos';
  $('homeAbaPedidos').hidden = !pedidos;
  $('homeAbaAtivosN').textContent = String(ativos.length);
  $('homeAbaTodosN').textContent = String(todos.length);
  $('homeAbaPedidosN').textContent = String(recebidos.length || pedidos);
  for (const b of $('homeAbas').querySelectorAll('.home-aba')) b.setAttribute('aria-pressed', String(b.dataset.aba === homeAmigos.aba));
  // Busca só quando a lista é grande; ela vale para Ativos e Todos
  const busca = homeAmigos.aba !== 'pedidos' && todos.length > 6;
  $('homeFriendsBusca').hidden = !busca;
  const agulha = busca ? semAcento(homeAmigos.busca.trim()) : '';
  const lista = $('homeFriendsList');
  lista.textContent = '';
  const porNome = (a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR');
  // Quem está numa sala vem primeiro (dá para entrar), depois quem joga, depois o resto por nome
  const peso = (f) => (typeof salaDoAmigo === 'function' && salaDoAmigo(f) ? 0 : f.online && f.activity?.game ? 1 : f.online ? 2 : 3);
  let vazio = '';
  if (homeAmigos.aba === 'pedidos') {
    for (const r of recebidos) lista.append(homePedidoLinha(r, true));
    for (const r of enviados) lista.append(homePedidoLinha(r, false));
  } else {
    const base = homeAmigos.aba === 'ativos' ? ativos : todos;
    const itens = base.filter((f) => !agulha || semAcento(f.displayName).includes(agulha)).sort((a, b) => peso(a) - peso(b) || porNome(a, b));
    for (const f of itens) lista.append(homeAmigoLinha(f));
    if (!itens.length) {
      vazio = !todos.length ? 'Você ainda não tem amigos aqui. Toque em Convidar para copiar o seu link ou adicionar pelo nickname.'
        : agulha ? `Ninguém com “${homeAmigos.busca.trim()}”.`
        : 'Ninguém online agora. Em Todos você vê seus amigos e pode mandar mensagem.';
    }
  }
  $('homeFriendsEmpty').textContent = vazio;
  $('homeFriendsAll').hidden = !todos.length;
}

// Menu "Convidar": copiar o seu link de amigo ou adicionar alguém
function setHomeConvidarOpen(open) {
  $('homeConvidarMenu').hidden = !open;
  $('homeConvidar').setAttribute('aria-expanded', String(open));
  if (open) $('homeFriendsLink').focus();
}

function setupPrimeiraEntrada() {
  // Quem já usava o app não passa pela primeira entrada
  if (load('primeiraEntrada') !== '1' && (load('name') || load('roomAddr'))) save('primeiraEntrada', '1');
  $('obModeFriends').onclick = () => entradaEscolher('amigos');
  $('obModeQuick').onclick = () => entradaEscolher('rapida');
  $('obNext2').onclick = entradaContinuarNome;
  $('obName').addEventListener('keydown', (e) => { if (e.key === 'Enter') entradaContinuarNome(); });
  $('obBack2').onclick = () => entradaIrPara(1);
  $('obBack3').onclick = () => entradaIrPara(2);
  $('obPhoto').onclick = () => $('obPhotoFile').click();
  $('obPhotoFile').onchange = async () => {
    const f = $('obPhotoFile').files[0];
    $('obPhotoFile').value = '';
    if (!f) return;
    try { await setMyPhoto(f); $('obPhotoNote').textContent = 'Foto adicionada.'; }
    catch { $('obPhotoNote').textContent = 'Não deu para abrir essa imagem.'; }
  };
  $('obTabLogin').onclick = () => entradaAba(false);
  $('obTabRegister').onclick = () => entradaAba(true);
  $('obSubmit').onclick = entradaEnviarConta;
  $('obPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') entradaEnviarConta(); });
  $('obForgot').onclick = () => abrirSenha('esqueci', $('obEmail').value.trim());
  $('obSkip').onclick = () => { save('modoUso', 'rapida'); fecharPrimeiraEntrada(); };
  $('obDialog').addEventListener('keydown', (e) => { if (e.key === 'Escape' && entrada.passo > 1) entradaIrPara(entrada.passo - 1); });
  $('goQuick').onclick = () => foraDaSala('criar outra sala', abrirMinhaSala);
  $('homeSigninBtn').onclick = () => abrirPrimeiraEntrada(3);
  $('homeFriendsAll').onclick = () => openFriendsDialog();
  for (const b of $('homeAbas').querySelectorAll('.home-aba')) b.onclick = () => { homeAmigos.aba = b.dataset.aba; renderHomeAmigos(); };
  $('homeFriendsBusca').addEventListener('input', () => { homeAmigos.busca = $('homeFriendsBusca').value; renderHomeAmigos(); });
  $('homeFriendsLink').onclick = () => { setHomeConvidarOpen(false); copiarMeuLink(); };
  $('friendsLinkCopy').onclick = copiarMeuLink;
  $('homeFriendsAdd').onclick = () => { setHomeConvidarOpen(false); openFriendsDialog(); if (typeof setFriendsAddOpen === 'function') setFriendsAddOpen(true); };
  $('homeConvidar').insertAdjacentHTML('afterbegin', ICON.plus);
  $('homeConvidar').onclick = () => setHomeConvidarOpen($('homeConvidarMenu').hidden);
  $('homeConvidarMenu').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setHomeConvidarOpen(false); $('homeConvidar').focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const itens = [...$('homeConvidarMenu').querySelectorAll('[role=menuitem]')];
      itens[(itens.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : itens.length - 1)) % itens.length].focus();
    }
  });
  document.addEventListener('click', (e) => { if (!$('homeConvidarMenu').hidden && !e.target.closest('.home-menu-wrap')) setHomeConvidarOpen(false); });
  // O nome: o lápis abre o campo; Enter ou sair do campo fecha
  setIcon($('homeNameEdit'), 'edit', 'Mudar seu nome');
  $('homeNameEdit').onclick = () => { $('home').classList.add('editando-nome'); renderHomeTopo(); $('name').focus(); $('name').select(); };
  const pararDeEditar = () => { if (!$('home').classList.contains('editando-nome')) return; $('home').classList.remove('editando-nome'); renderHomeTopo(); };
  $('name').addEventListener('input', renderHomeTopo);
  $('name').addEventListener('blur', pararDeEditar);
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { pararDeEditar(); $('homeNameEdit').focus(); } });
  entradaAba(false);
  if (load('primeiraEntrada') !== '1') abrirPrimeiraEntrada();
  renderHomeAmigos();
}

// ---------- Convite de amigo recebido (docs/spec/convite-por-link.md) ----------
// Aceita o link https (/a/<token>), o telap2p://amigo/<token>, o segredo puro (20+ caracteres) e o código curto com
// hífens (ABCD-EFGH-JK; sem hífen seria confundido com um nickname). Devolve o texto que o servidor entende, ou ''.
function amigoTokenDe(valor) {
  let raw = String(valor ?? '').trim();
  const segredo = /^[A-Za-z0-9_-]{20,120}$/;
  if (/\s/.test(raw)) { // texto com a mensagem inteira: pega o link ou, na falta dele, o código com hífens
    const link = /(?:https?:\/\/[^\s]+\/a\/|telap2p:\/\/amigo\/)[A-Za-z0-9_-]{20,120}/.exec(raw)?.[0];
    const cod = /\b[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{2}\b/.exec(raw)?.[0];
    raw = link || cod || raw;
  }
  if (segredo.test(raw)) return raw;
  if (/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{2}$/.test(raw)) return raw.toUpperCase();
  let url;
  try { url = new URL(raw); } catch { return ''; }
  if (url.protocol === 'telap2p:' && url.hostname === 'amigo') {
    const t = url.pathname.replace(/^\//, '');
    return segredo.test(t) ? t : '';
  }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    const t = /^\/a\/([A-Za-z0-9_-]{20,120})$/.exec(url.pathname)?.[1];
    return t || '';
  }
  return '';
}
if (typeof module !== 'undefined') module.exports = { amigoTokenDe };

function erroDoServico(err) {
  // O Electron põe "Error invoking remote method '…': Error:" na frente da mensagem do serviço
  return String(err?.message || err).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
}

async function receberConviteAmigo(token) {
  const convite = amigoTokenDe(token);
  if (!convite) return toast('Esse link ou código de convite não parece certo.', 'error');
  save('amigoPendente', convite);
  if (!razzeUser) { try { await refreshRazzeState(); } catch {} }
  if (!razzeUser) {
    if (!$('onboarding').hidden) return;
    abrirPrimeiraEntrada(3);
    $('obStatus').textContent = 'Entre ou crie a conta para aceitar o convite de amigo.';
    return;
  }
  await retomarConviteAmigo();
}

// Chamada quando a conta fica pronta (e na hora, se já estava): mostra "quer ser seu amigo" e aceita se a pessoa confirmar
async function retomarConviteAmigo() {
  const convite = load('amigoPendente', '');
  if (!convite || !razzeUser || entrada.convitando) return;
  entrada.convitando = true;
  try {
    const previa = await window.api.razzeFriendLinkPreview(convite);
    if (previa.own) return toast('Esse é o seu próprio convite. Mande para um amigo.', 'error');
    if (previa.alreadyFriends) return toast(previa.displayName + ' já é seu amigo.');
    const ok = await appConfirm(previa.displayName + ' quer ser seu amigo. Aceitar?', { title: 'Convite de amigo', ok: 'Aceitar', cancel: 'Agora não' });
    if (!ok) return;
    const r = await window.api.razzeFriendLinkAccept(convite);
    await refreshRazzeLists();
    toast('Agora você e ' + (r.friend?.displayName || previa.displayName) + ' são amigos.');
  } catch (err) {
    const msg = erroDoServico(err);
    toast(/Endpoint não encontrado|not_found/i.test(msg)
      ? 'Seu servidor ainda não tem links de amigo. Peça o nickname e adicione por ele.'
      : 'Não deu para usar o convite: ' + msg, 'error');
  } finally {
    save('amigoPendente', '');
    entrada.convitando = false;
  }
}

// ---------- Gerar o meu link de convite ----------
function validadeCurta(ms) { return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }

async function copiarMeuLink() {
  try {
    const l = await window.api.razzeFriendLinkCreate();
    const endereco = l.url || l.appLink;
    await copiar('Me adiciona no Nebula: ' + endereco + '\n(ou cole o código ' + l.code + ' em Adicionar amigo)');
    toast('Link copiado. Código ' + l.code + ' · vale até ' + validadeCurta(l.expiresAt) + ' e para 1 pessoa.');
    void renderLinksAmigo();
  } catch (err) {
    const msg = erroDoServico(err);
    toast(/Endpoint não encontrado|not_found/i.test(msg)
      ? 'Seu servidor ainda não tem links de amigo. Adicione pelo nickname.'
      : 'Não deu para criar o link: ' + msg, 'error');
  }
}

// Os links ativos aparecem no formulário de Adicionar amigo, cada um com Revogar
async function renderLinksAmigo() {
  const lista = $('friendsLinks');
  if (!lista) return;
  let links = [];
  try { links = (await window.api.razzeFriendLinkList()).links || []; } catch { lista.textContent = ''; return; }
  lista.textContent = '';
  for (const l of links) {
    const li = document.createElement('li');
    li.className = 'hub-link';
    const t = document.createElement('span');
    t.textContent = 'Link até ' + validadeCurta(l.expiresAt) + ' · ' + l.uses + '/' + l.maxUses + ' uso';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = 'Revogar';
    b.onclick = async () => {
      b.disabled = true;
      try { await window.api.razzeFriendLinkRevoke(l.id); } catch (err) { toast('Não deu para revogar: ' + erroDoServico(err), 'error'); }
      void renderLinksAmigo();
    };
    li.append(t, b);
    lista.append(li);
  }
}
