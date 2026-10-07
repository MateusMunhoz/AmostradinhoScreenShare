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
  await createRoom();
}

// ---------- Início de quem tem conta ----------
function renderHomeAmigos() {
  if (!$('homeFriends')) return;
  const logado = !!razzeUser;
  $('homeSignin').hidden = logado || modoDeUso() !== 'amigos';
  $('homeFriends').hidden = !logado;
  if (!logado) return;
  const online = friendsData.friends.filter((f) => f.online);
  const total = friendsData.friends.length;
  $('homeFriendsTitle').textContent = online.length ? `Amigos online (${online.length})` : 'Amigos';
  const lista = $('homeFriendsList');
  lista.textContent = '';
  for (const f of online.slice(0, 5)) {
    const li = document.createElement('li');
    li.className = 'home-friend';
    const nome = document.createElement('span');
    nome.className = 'home-friend-name';
    const quem = document.createElement('strong');
    quem.textContent = f.displayName;
    nome.append(quem);
    // Em que sala o amigo está, em qualquer modo (salas-amigos.js: textoSalaDoAmigo)
    const naSala = typeof textoSalaDoAmigo === 'function' ? textoSalaDoAmigo(f) : '';
    if (naSala) {
      const sala = document.createElement('span');
      sala.className = 'hint home-friend-bio home-friend-sala';
      sala.textContent = naSala;
      nome.append(sala);
    }
    const atividade = f.activity;
    if (atividade?.game) {
      const jogo = document.createElement('span');
      jogo.className = 'hint home-friend-bio';
      jogo.textContent = 'Jogando ' + atividade.game;
      nome.append(jogo);
    }
    if (atividade?.artist) {
      // "Ouvindo <artista>"; clicar mostra a faixa
      const musica = document.createElement('button');
      musica.type = 'button';
      musica.className = 'link-btn home-friend-music';
      const fechado = 'Ouvindo ' + atividade.artist;
      musica.textContent = fechado;
      musica.title = 'Clique para ver a música';
      musica.onclick = () => { musica.textContent = musica.textContent === fechado ? (atividade.title ? atividade.title + ' — ' + atividade.artist : fechado) : fechado; };
      nome.append(musica);
    }
    if (f.bio && !atividade?.game && !atividade?.artist) {
      const frase = document.createElement('span');
      frase.className = 'hint home-friend-bio';
      frase.textContent = f.bio;
      nome.append(frase);
    }
    const chat = document.createElement('button');
    chat.type = 'button';
    chat.className = 'btn small';
    chat.textContent = 'Mensagem';
    chat.onclick = () => openDm(f.id);
    const ligar = document.createElement('button');
    ligar.type = 'button';
    ligar.className = 'btn small primary';
    ligar.textContent = 'Ligar';
    ligar.title = 'Cria uma sala só para vocês e entra na voz';
    ligar.onclick = () => void ligarPara(f.id);
    li.append(hubAvatar(f.displayName, true), nome, chat, ligar);
    lista.append(li);
  }
  $('homeFriendsEmpty').textContent = !total ? 'Você ainda não tem amigos aqui. Adicione o primeiro.'
    : !online.length ? 'Ninguém online agora.'
    : online.length > 5 ? `e mais ${online.length - 5} online` : '';
  $('homeFriendsAll').hidden = !total;
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
  $('goQuick').onclick = abrirMinhaSala;
  $('homeSigninBtn').onclick = () => abrirPrimeiraEntrada(3);
  $('homeFriendsAll').onclick = () => openFriendsDialog();
  $('homeFriendsLink').onclick = copiarMeuLink;
  $('friendsLinkCopy').onclick = copiarMeuLink;
  $('homeFriendsAdd').onclick = () => { openFriendsDialog(); if (typeof setFriendsAddOpen === 'function') setFriendsAddOpen(true); };
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
