'use strict';
// Conta: trocar a senha, esqueci a senha (com o código que o administrador gera, sem e-mail) e a frase do perfil.
// Script clássico: só declara; quem liga é renderer/inicio.js (setupConta). Usa: util (toast, load/save),
// conectividade (razzeUser), primeira-entrada (erroDoServico).

const BIO_MAX = 128;
const senha = { modo: 'trocar', ocupado: false };
let bioAtual = load('bio', '');

// ---------- Senha ----------
function abrirSenha(modo, email = '') {
  senha.modo = modo;
  const esqueci = modo === 'esqueci';
  $('senhaTitle').textContent = esqueci ? 'Esqueci a senha' : 'Trocar a senha';
  $('senhaIntro').textContent = esqueci
    ? 'Peça um código ao administrador do servidor. Ele vale por 1 hora e funciona uma vez.'
    : 'Digite a senha atual e escolha a nova. Os outros PCs em que você está logado continuam como estão.';
  $('senhaEmailField').hidden = !esqueci;
  $('senhaCodeField').hidden = !esqueci;
  // Conta que só entra pelo Google ainda não tem senha: define a primeira, sem a atual
  const semSenha = !esqueci && typeof razzeUser !== 'undefined' && !!razzeUser && razzeUser.hasPassword === false;
  senha.semSenha = semSenha;
  $('senhaCurrentField').hidden = esqueci || semSenha;
  $('senhaSubmit').textContent = esqueci ? 'Redefinir senha' : 'Trocar senha';
  for (const id of ['senhaCode', 'senhaCurrent', 'senhaNew', 'senhaNew2']) $(id).value = '';
  $('senhaEmail').value = email || '';
  $('senhaStatus').textContent = '';
  $('senhaDialog').hidden = false;
  (esqueci ? ($('senhaEmail').value ? $('senhaCode') : $('senhaEmail')) : $('senhaCurrent')).focus();
}

function fecharSenha() { $('senhaDialog').hidden = true; }

async function enviarSenha() {
  if (senha.ocupado) return;
  const esqueci = senha.modo === 'esqueci';
  const nova = $('senhaNew').value;
  if (nova.length < 8) { $('senhaStatus').textContent = 'A senha nova precisa de pelo menos 8 caracteres.'; return $('senhaNew').focus(); }
  if (nova !== $('senhaNew2').value) { $('senhaStatus').textContent = 'As duas senhas novas não são iguais.'; return $('senhaNew2').focus(); }
  const email = $('senhaEmail').value.trim();
  if (esqueci && (!email || !$('senhaCode').value.trim())) { $('senhaStatus').textContent = 'Preencha o e-mail e o código.'; return; }
  if (!esqueci && !senha.semSenha && !$('senhaCurrent').value) { $('senhaStatus').textContent = 'Digite a senha atual.'; return $('senhaCurrent').focus(); }
  senha.ocupado = true;
  $('senhaSubmit').disabled = true;
  $('senhaStatus').textContent = 'Enviando…';
  try {
    if (esqueci) {
      await window.api.razzeResetPassword(email, $('senhaCode').value.trim(), nova);
      for (const id of ['razzeEmail', 'obEmail']) if ($(id)) $(id).value = email;
      fecharSenha();
      // Entra sozinho com a senha nova: a pessoa acabou de digitar e não precisa pedir e-mail e senha de novo
      try {
        const r = await window.api.razzeLogin(email, nova);
        razzeUser = r.user;
        await refreshRazzeState();
        if (!$('onboarding').hidden) fecharPrimeiraEntrada();
        else void retomarConviteAmigo();
        toast('Senha redefinida. Você já está dentro.');
      } catch {
        toast('Senha redefinida. Entre com a senha nova.');
      }
    } else {
      await window.api.razzeChangePassword(senha.semSenha ? '' : $('senhaCurrent').value, nova);
      fecharSenha();
      toast('Senha trocada.');
    }
  } catch (err) {
    $('senhaStatus').textContent = erroDoServico(err).replace(/Endpoint não encontrado\.?/i, 'Seu servidor ainda não tem essa opção.');
  } finally {
    senha.ocupado = false;
    $('senhaSubmit').disabled = false;
  }
}

// ---------- Entrar com Google ----------
const google = { ligado: false, ocupado: false, soGoogle: false, senhaAntiga: false, comSenha: false };

// Servidor só com Google: o formulário de e-mail e senha some (CSS .so-google .legacy-login) e o Google vira o botão principal.
// Quem ainda tem conta com senha abre o formulário por "Tenho uma conta com e-mail e senha" (só entrar; criar não existe mais).
function googleAplicarModo() {
  const so = google.ligado && google.soGoogle;
  for (const [caixa, google_, legado] of [['onboarding', 'obGoogle', 'obLegacy'], ['razzeAuth', 'razzeGoogle', 'razzeLegacy']]) {
    $(caixa).classList.toggle('so-google', so);
    $(caixa).classList.toggle('com-senha', so && google.comSenha);
    $(google_).classList.toggle('primary', so);
    $(legado).hidden = !(so && google.senhaAntiga && !google.comSenha);
  }
  $('obGoogleHint').hidden = !so;
}

// O servidor diz se o Google está ligado; só então os botões aparecem
async function googleAtualizar() {
  try {
    const cfg = await window.api.razzeGoogleConfig();
    google.ligado = !!cfg?.enabled;
    google.soGoogle = !!cfg?.googleOnly;
    google.senhaAntiga = cfg?.passwordLogin !== false;
  } catch { google.ligado = false; google.soGoogle = false; }
  googleAplicarModo();
  $('obGoogle').hidden = !google.ligado;
  $('razzeGoogle').hidden = !google.ligado;
  const logado = typeof razzeUser !== 'undefined' && !!razzeUser;
  $('razzeGoogleLink').hidden = !google.ligado || !logado;
  if (logado) $('razzeGoogleLink').textContent = razzeUser.googleLinked ? 'Desvincular Google' : 'Vincular Google';
}

async function googleEntrar(statusEl, depois) {
  if (google.ocupado) return;
  google.ocupado = true;
  statusEl.textContent = 'Abrindo o navegador… escolha a conta do Google e volte para cá.';
  try {
    const r = await window.api.razzeGoogleLogin();
    if (r.status === 'pending_approval') {
      statusEl.textContent = 'Pedido enviado. Avise o administrador para aprovar; quando ele aprovar, toque em Entrar com Google de novo. Enquanto isso, use sem conta.';
      return;
    }
    razzeUser = r.user;
    await refreshRazzeState();
    statusEl.textContent = '';
    depois();
    toast('Você entrou com o Google.');
  } catch (err) {
    statusEl.textContent = 'Não deu: ' + erroDoServico(err);
  } finally { google.ocupado = false; }
}

// Vincular e desvincular, na Conta Razze do Perfil
async function googleVincular() {
  if (google.ocupado || typeof razzeUser === 'undefined' || !razzeUser) return;
  google.ocupado = true;
  $('razzeGoogleLink').disabled = true;
  try {
    const r = razzeUser.googleLinked ? await window.api.razzeGoogleUnlink() : await window.api.razzeGoogleLink();
    razzeUser = r.user;
    toast(razzeUser.googleLinked ? 'Google vinculado à sua conta.' : 'Google desvinculado.');
    await refreshRazzeState();
  } catch (err) {
    toast('Não deu: ' + erroDoServico(err), 'error');
  } finally {
    google.ocupado = false;
    $('razzeGoogleLink').disabled = false;
    void googleAtualizar();
  }
}

// ---------- Frase do perfil ----------
const limparBio = (v) => Array.from(String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, BIO_MAX).join('');

function renderBio() {
  if (!$('profileBio')) return;
  if (document.activeElement !== $('profileBio')) $('profileBio').value = bioAtual;
  $('bioCount').textContent = `${Array.from($('profileBio').value).length}/${BIO_MAX}`;
  $('profileCardBio').textContent = bioAtual;
}

async function salvarBio() {
  const v = limparBio($('profileBio').value);
  bioAtual = v;
  save('bio', v);
  renderBio();
  if (typeof razzeUser === 'undefined' || !razzeUser) {
    $('profileBioHint').textContent = 'Salva neste PC. Seus amigos veem quando você entrar na conta.';
    return;
  }
  try {
    await window.api.razzeSetBio(v);
    $('profileBioHint').textContent = v ? 'Salva. Seus amigos veem no Início.' : 'Frase removida.';
  } catch (err) {
    $('profileBioHint').textContent = 'Não deu para salvar no servidor: ' + erroDoServico(err);
  }
}

// ---------- Atividade (jogo e música) ----------
const ATV_CADA_MS = 30 * 1000;
const ATV_RENOVAR_MS = 60 * 1000;
const atv = { leitura: 0, amigos: 0, ultimo: '', enviadoEm: 0, jogo: '', jogoImagem: '', jogoDesde: 0 };
// Jogo e música: ligados por padrão (quem nunca mexeu); desligar fica salvo como '0'
const atvLigada = (k) => load('atividade' + k, '1') === '1';

function atvTexto(jogo, musica) {
  const p = [];
  if (jogo) p.push('Jogando ' + jogo);
  if (musica) p.push('Ouvindo ' + musica.artista + ' — ' + musica.faixa);
  return p.join(' · ');
}

// Lê o que está ligado, mostra a prévia (o que os amigos veem), passa para quem está na sala quando muda e manda ao
// servidor quando muda ou a cada minuto. Sem conta e fora da sala não lê (só a prévia, quando forcar)
async function atvTick(forcar = false) {
  const jogos = atvLigada('Jogo'), musica = atvLigada('Musica');
  const logado = typeof razzeUser !== 'undefined' && !!razzeUser;
  if (!forcar && !logado && !state.myId) return;
  let r = { jogo: '', jogoImagem: '', musica: null };
  if ((jogos || musica) && window.api?.atividadeLer) { try { r = await window.api.atividadeLer({ jogos, musica, steam: steamMarcados() }); } catch { /* sem leitura: manda vazio */ } }
  const jogo = jogos ? r.jogo || '' : '';
  if (jogo !== atv.jogo) atv.jogoDesde = jogo ? Date.now() : 0; // desde quando joga: "há 40 min" no perfil
  atv.jogo = jogo; // para a música que chega na hora (atvMusicaChegou) não apagar o jogo
  atv.jogoImagem = jogo ? r.jogoImagem || '' : '';
  const faixa = musica ? r.musica : null;
  const tocando = faixa && !faixa.pausada ? faixa : null; // os amigos (e a prévia) só veem a que está tocando
  const texto = atvTexto(jogo, tocando);
  $('atvPreview').textContent = !jogos && !musica ? 'Nada aparece no seu perfil.'
    : texto ? 'Aparece agora: ' + texto : 'Agora não há nada para mostrar (jogo não reconhecido ou música pausada).';
  atvMudou(limparAtividade({ jogo, jogoImagem: atv.jogoImagem, jogoDesde: atv.jogoDesde, artista: faixa ? faixa.artista : '', faixa: faixa ? faixa.faixa : '', album: faixa?.album, capa: faixa?.capa, pausada: faixa?.pausada }));
  if (!logado) return;
  const payload = { game: jogo, artist: tocando ? tocando.artista : '', title: tocando ? tocando.faixa : '' };
  const chave = JSON.stringify(payload);
  if (chave === atv.ultimo && Date.now() - atv.enviadoEm < ATV_RENOVAR_MS) return;
  if (chave === atv.ultimo && !jogo && !tocando) return; // vazio e já avisado: não renova
  try { await window.api.razzeSetActivity(payload); atv.ultimo = chave; atv.enviadoEm = Date.now(); } catch { /* tenta no próximo */ }
}

// Liga ou desliga a leitura conforme as caixinhas e a conta
function atvAgendar() {
  clearInterval(atv.leitura);
  atv.leitura = 0;
  // Lê com a conta ou numa sala (atvTick confere a cada vez: entrar ou sair da sala não precisa reagendar)
  if (atvLigada('Jogo') || atvLigada('Musica')) atv.leitura = setInterval(() => void atvTick(), ATV_CADA_MS);
  void atvTick(true); // também manda o vazio quando acabou de desligar
}

// ---------- Jogos da Steam (Configurações › Atividade) ----------
// Os jogos instalados na Steam só aparecem no perfil se a pessoa marcar. A escolha fica neste PC:
// atividadeSteam = { "<número do jogo>": true (mostrar) | false (não mostrar) }; jogo que não está ali é novo (ainda não
// escolhido) e não aparece. Achou jogo novo: um aviso leva para a escolha (atvProcurarNovos).
const STEAM_NOVOS_CADA_MS = 10 * 60 * 1000;
const steamUi = { jogos: [], avisados: new Set(), timer: 0, novosMarcados: new Set() };
function steamEscolhas() {
  try {
    const o = JSON.parse(load('atividadeSteam', '{}'));
    const r = {};
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const [id, v] of Object.entries(o)) if (/^\d{1,10}$/.test(id) && typeof v === 'boolean') r[id] = v;
    return r;
  } catch { return {}; }
}
function steamEscolher(mudancas) { save('atividadeSteam', JSON.stringify({ ...steamEscolhas(), ...mudancas })); }
const steamMarcados = () => Object.entries(steamEscolhas()).filter(([, v]) => v).map(([id]) => id).slice(0, 500);

function steamLinha(j, marcado, onchange) {
  const li = document.createElement('li');
  const label = document.createElement('label');
  label.className = 'steam-game';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = marcado;
  cb.onchange = () => onchange(cb.checked);
  const img = document.createElement(j.imagem ? 'img' : 'span');
  img.className = 'steam-img';
  if (j.imagem) { img.src = j.imagem; img.alt = ''; } else img.innerHTML = ICON.game;
  const nome = document.createElement('span');
  nome.className = 'steam-nome';
  nome.textContent = j.nome;
  label.append(cb, img, nome);
  li.append(label);
  return li;
}

// Desenha as duas listas: os novos (a escolher, vários de uma vez) e os já escolhidos (cada um muda na hora)
async function renderSteamJogos(recarregar = false) {
  if (!window.api?.atividadeSteamJogos) return;
  $('steamStatus').textContent = 'Procurando os jogos da Steam…';
  try { steamUi.jogos = await window.api.atividadeSteamJogos(recarregar); } catch { steamUi.jogos = []; }
  const e = steamEscolhas();
  const novos = steamUi.jogos.filter((j) => !(j.id in e));
  const seus = steamUi.jogos.filter((j) => j.id in e);
  for (const id of [...steamUi.novosMarcados]) if (!novos.some((j) => j.id === id)) steamUi.novosMarcados.delete(id);
  $('steamStatus').textContent = !steamUi.jogos.length ? 'Nenhum jogo da Steam encontrado neste PC.'
    : novos.length ? `${novos.length === 1 ? '1 jogo novo' : novos.length + ' jogos novos'} para escolher.` : '';
  $('steamNovosBox').hidden = !novos.length;
  $('steamNovos').replaceChildren(...novos.map((j) => steamLinha(j, steamUi.novosMarcados.has(j.id), (on) => {
    if (on) steamUi.novosMarcados.add(j.id); else steamUi.novosMarcados.delete(j.id);
  })));
  $('steamSeusBox').hidden = !seus.length;
  $('steamSeus').replaceChildren(...seus.map((j) => steamLinha(j, e[j.id], (on) => { steamEscolher({ [j.id]: on }); void atvTick(true); })));
}
// Os novos viram escolhidos: os marcados aparecem, os outros não
function steamDecidirNovos(mostrarMarcados) {
  const e = steamEscolhas();
  const mudancas = {};
  for (const j of steamUi.jogos) if (!(j.id in e)) mudancas[j.id] = mostrarMarcados && steamUi.novosMarcados.has(j.id);
  steamUi.novosMarcados.clear();
  steamEscolher(mudancas);
  void renderSteamJogos();
  void atvTick(true);
}
function steamMarcarSeus(on) {
  const mudancas = {};
  for (const id of Object.keys(steamEscolhas())) mudancas[id] = on;
  steamEscolher(mudancas);
  void renderSteamJogos();
  void atvTick(true);
}

// Com o jogo ligado, procura jogos novos na Steam (ao abrir e a cada 10 min) e avisa uma vez por jogo
async function atvProcurarNovos() {
  if (!atvLigada('Jogo') || !window.api?.atividadeSteamJogos) return;
  let jogos = [];
  try { jogos = await window.api.atividadeSteamJogos(false); } catch { return; }
  const e = steamEscolhas();
  const novos = jogos.filter((j) => !(j.id in e) && !steamUi.avisados.has(j.id));
  if (!novos.length) return;
  for (const j of novos) steamUi.avisados.add(j.id);
  if (!$('generalSettingsDialog').hidden && !$('settingsPanel-activity').hidden) return void renderSteamJogos(); // já está na tela
  const texto = novos.length === 1 ? `Achamos ${novos[0].nome} na sua Steam. Quer mostrar no seu perfil quando jogar?`
    : `Achamos ${novos.length} jogos novos na sua Steam. Escolha quais mostrar no seu perfil.`;
  toast(texto, 'info', { label: 'Escolher', run: () => openGeneralSettings('activity') });
}
function atvAgendarProcura() {
  clearInterval(steamUi.timer);
  steamUi.timer = 0;
  if (!atvLigada('Jogo')) return;
  steamUi.timer = setInterval(() => void atvProcurarNovos(), STEAM_NOVOS_CADA_MS);
  setTimeout(() => void atvProcurarNovos(), 5000); // depois que o app abriu
}

// ---------- A atividade na sala ----------
// O jogo e a música aparecem no perfil e na linha de quem está na sala. Passa de PC para PC como a frase: quem vê a
// linha de alguém pergunta uma vez ({ side: 'atv', want: true }) e cada um avisa todos quando a sua muda
// ({ side: 'atv', jogo, jogoDesde, artista, faixa, album, capa, pausada }). Pausada: o perfil mostra a música parada. Nada muda no protocolo da sala; só na memória, só desta sala.
// A capa é um JPEG 96x96 em data: URL (main/atividade.js), uns 5 KB: vai só quando a faixa muda ou alguém pergunta.
const ATV_TEXTO_MAX = 80;
const ATV_CAPA_MAX = 28100;
const ATV_DESDE_MAX_MS = 48 * 3600 * 1000;
const atvDaSala = new Map(); // id -> { jogo, artista, faixa }
const atvPedidas = new Set(); // ids a quem já perguntei nesta sala
let atvMinha = null; // a minha, como os outros veem (null: nada)

// Vem de outro PC: só texto, sem caracteres de controle e curto. Nada para mostrar -> null
function limparAtividade(d) {
  const t = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ATV_TEXTO_MAX) : '');
  const imagem = (v) => (typeof v === 'string' && v.length <= ATV_CAPA_MAX && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(v) ? v : '');
  // Desde quando joga (ms, relógio de quem joga): só um instante das últimas 48 h, com folga de 5 min para relógio adiantado
  const agora = Date.now();
  const desde = Number.isInteger(d?.jogoDesde) && d.jogoDesde >= agora - ATV_DESDE_MAX_MS && d.jogoDesde <= agora + 5 * 60000 ? Math.min(d.jogoDesde, agora) : 0;
  const a = { jogo: t(d?.jogo), jogoImagem: imagem(d?.jogoImagem), jogoDesde: desde, artista: t(d?.artista), faixa: t(d?.faixa), album: t(d?.album), capa: imagem(d?.capa) };
  if (!a.artista && a.faixa) { a.artista = a.faixa; a.faixa = ''; }
  a.pausada = !!a.artista && d?.pausada === true;
  if (!a.artista) a.album = a.capa = ''; // sem música, sem capa
  if (!a.jogo) { a.jogoImagem = ''; a.jogoDesde = 0; } // sem jogo, sem imagem nem tempo
  return a.jogo || a.artista ? a : null;
}
// "há 40 min", "há 1 h 20 min" ('' sem tempo)
function atvHa(desde, agora = Date.now()) {
  if (!desde) return '';
  const min = Math.max(0, Math.floor((agora - desde) / 60000));
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `há ${h} h ${m} min` : `há ${h} h`;
}
function atvDe(id) {
  if (!id || id === 'me' || id === state.myId) return atvMinha;
  return atvDaSala.get(id) || null;
}
function atvRedesenhar(id) {
  if (state.myId) renderMembers();
  if (typeof skyFocusId !== 'undefined' && skyFocusId && (skyFocusId === id || (!id && skyFocusId === state.myId))) { skyFocusKey = ''; renderSkyProfile(); }
}
function atvMudou(nova) {
  if (JSON.stringify(nova) === JSON.stringify(atvMinha)) return;
  atvMinha = nova;
  if (!state.myId) return;
  for (const id of state.members.keys()) sendSignal(id, { side: 'atv', ...(atvMinha || {}) });
  atvRedesenhar(null);
}
// A música mudou agora (main/atividade.js pelo midia.exe): a sala vê na hora; os amigos da conta, na próxima leitura
function atvMusicaChegou(m) {
  if (!atvLigada('Musica')) return;
  atvMudou(limparAtividade({ jogo: atvLigada('Jogo') ? atv.jogo : '', jogoImagem: atvLigada('Jogo') ? atv.jogoImagem : '', jogoDesde: atvLigada('Jogo') ? atv.jogoDesde : 0, artista: m?.artista, faixa: m?.faixa, album: m?.album, capa: m?.capa, pausada: m?.pausada }));
}
function pedirAtv(id) {
  if (!id || id === state.myId || atvPedidas.has(id) || !state.members.has(id)) return;
  atvPedidas.add(id);
  sendSignal(id, { side: 'atv', want: true });
}
function onAtvSignal(from, data) {
  if (!state.members.has(from)) return; // só quem está na sala
  if (data.want === true) return sendSignal(from, { side: 'atv', ...(atvMinha || {}) });
  const nova = limparAtividade(data);
  if (JSON.stringify(nova) === JSON.stringify(atvDaSala.get(from) || null)) return;
  if (nova) atvDaSala.set(from, nova); else atvDaSala.delete(from);
  atvRedesenhar(from);
}
function resetAtvDaSala() { atvDaSala.clear(); atvPedidas.clear(); }

// Os amigos no Início: recarrega só a atividade deles, sem mexer no resto da lista
async function atvAtualizarAmigos() {
  if (typeof razzeUser === 'undefined' || !razzeUser || $('home').hidden) return;
  try {
    const r = await window.api.razzeFriends();
    for (const f of r.friends || []) {
      const existente = friendsData.friends.find((x) => x.id === f.id);
      if (existente) { existente.activity = f.activity || null; existente.bio = f.bio || ''; }
    }
    renderHomeAmigos();
  } catch { /* sem rede: fica como está */ }
}

// ---------- A frase na sala ----------
// Quem abre o perfil de alguém pergunta pela frase ({ side: 'bio', want: true }) e a pessoa responde com ela ({ side: 'bio', text }).
// Passa só entre os dois, pelo mesmo canal da foto e do fundo; nada muda no protocolo da sala.
const biosDaSala = new Map(); // id -> frase (só na memória, só desta sala)
const biosPedidas = new Map(); // id -> quando pedi (não pede de novo antes de 3 s)

function bioDe(id) {
  if (!id || id === 'me' || id === state.myId) return bioAtual;
  return biosDaSala.get(id) || '';
}
function pedirBio(id) {
  if (!id || id === state.myId || !state.members.has(id)) return;
  const at = biosPedidas.get(id);
  if (at && Date.now() - at < 3000) return;
  biosPedidas.set(id, Date.now());
  sendSignal(id, { side: 'bio', want: true });
}
function onBioSignal(from, data) {
  if (!state.members.has(from)) return; // só quem está na sala
  if (data.want === true) return sendSignal(from, { side: 'bio', text: bioAtual });
  if (typeof data.text !== 'string' || !biosPedidas.has(from)) return; // só aceita resposta de quem eu perguntei
  const antes = biosDaSala.get(from) || '';
  const texto = limparBio(data.text);
  if (texto) biosDaSala.set(from, texto); else biosDaSala.delete(from);
  if (texto !== antes && typeof skyFocusId !== 'undefined' && skyFocusId === from) { skyFocusKey = ''; renderSkyProfile(); }
}
function resetBiosDaSala() { biosDaSala.clear(); biosPedidas.clear(); }

// A conta carregou: a frase do servidor vale; se o servidor está sem frase e este PC tem uma, manda a daqui
function syncBioComConta(user) {
  atvAgendar();
  void googleAtualizar();
  const remota = limparBio(user?.bio);
  if (remota) { bioAtual = remota; save('bio', remota); }
  else if (bioAtual) void window.api.razzeSetBio(bioAtual).catch(() => {});
  renderBio();
}

function setupConta() {
  $('atvJogo').checked = atvLigada('Jogo');
  $('atvMusica').checked = atvLigada('Musica');
  for (const [id, k] of [['atvJogo', 'Jogo'], ['atvMusica', 'Musica']]) {
    $(id).onchange = () => { save('atividade' + k, $(id).checked ? '1' : '0'); atvAgendar(); if (k === 'Jogo') atvAgendarProcura(); };
  }
  $('atvConfigurar').onclick = () => openGeneralSettings('activity');
  $('steamProcurar').onclick = () => void renderSteamJogos(true);
  $('steamNovosTodos').onclick = () => { for (const cb of $('steamNovos').querySelectorAll('input')) { cb.checked = true; cb.onchange(); } };
  $('steamNovosMostrar').onclick = () => steamDecidirNovos(true);
  $('steamNovosNao').onclick = () => steamDecidirNovos(false);
  $('steamSeusTodos').onclick = () => steamMarcarSeus(true);
  $('steamSeusNenhum').onclick = () => steamMarcarSeus(false);
  atvAgendarProcura();
  // Em que sala estou: ligado por padrão (salas-amigos.js); desligar tira na hora
  $('atvSala').checked = salaAtualLigada();
  $('atvSala').onchange = () => { save('atividadeSala', $('atvSala').checked ? '1' : '0'); publicarSalaAtual(); };
  atv.amigos = setInterval(() => void atvAtualizarAmigos(), ATV_CADA_MS);
  window.addEventListener('beforeunload', () => { if (atv.ultimo && atv.ultimo !== '{"game":"","artist":"","title":""}') window.api.razzeSetActivity({}).catch(() => {}); });
  window.api?.aoMudarMusica?.(atvMusicaChegou);
  atvAgendar();
  $('senhaCancel').onclick = fecharSenha;
  $('senhaSubmit').onclick = enviarSenha;
  $('senhaDialog').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharSenha();
    else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); void enviarSenha(); }
  });
  $('obGoogle').onclick = () => void googleEntrar($('obStatus'), fecharPrimeiraEntrada);
  $('razzeGoogle').onclick = () => void googleEntrar($('razzeAccountStatus'), () => {});
  $('razzeGoogleLink').onclick = () => void googleVincular();
  for (const id of ['obLegacy', 'razzeLegacy']) $(id).onclick = () => { google.comSenha = true; googleAplicarModo(); };
  void googleAtualizar();
  $('razzeChangePassword').onclick = () => abrirSenha('trocar');
  $('razzeForgot').onclick = () => abrirSenha('esqueci', $('razzeEmail').value.trim());
  $('profileBio').oninput = renderBio;
  $('profileBio').onblur = () => { if (limparBio($('profileBio').value) !== bioAtual) void salvarBio(); };
  $('profileBio').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('profileBio').blur(); } });
  renderBio();
}

if (typeof module !== 'undefined') module.exports = { limparBio, atvTexto, limparAtividade, atvHa };
