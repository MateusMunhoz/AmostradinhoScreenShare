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
      toast('Senha redefinida. Entre com a senha nova.');
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
const google = { ligado: false, ocupado: false };

// O servidor diz se o Google está ligado; só então os botões aparecem
async function googleAtualizar() {
  try { google.ligado = !!(await window.api.razzeGoogleConfig())?.enabled; } catch { google.ligado = false; }
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
      statusEl.textContent = 'Conta criada. O administrador do servidor ainda precisa aprovar; enquanto isso, use como sala rápida.';
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
const atv = { leitura: 0, amigos: 0, ultimo: '', enviadoEm: 0 };
const atvLigada = (k) => load('atividade' + k, '0') === '1';

function atvTexto(jogo, musica) {
  const p = [];
  if (jogo) p.push('Jogando ' + jogo);
  if (musica) p.push('Ouvindo ' + musica.artista + ' — ' + musica.faixa);
  return p.join(' · ');
}

// Lê o que está ligado, mostra a prévia (o que os amigos veem) e manda ao servidor quando muda ou a cada minuto
async function atvTick() {
  const jogos = atvLigada('Jogo'), musica = atvLigada('Musica');
  let r = { jogo: '', musica: null };
  if ((jogos || musica) && window.api?.atividadeLer) { try { r = await window.api.atividadeLer({ jogos, musica }); } catch { /* sem leitura: manda vazio */ } }
  const jogo = jogos ? r.jogo || '' : '';
  const faixa = musica ? r.musica : null;
  const texto = atvTexto(jogo, faixa);
  $('atvPreview').textContent = !jogos && !musica ? 'Nada aparece para os amigos.'
    : texto ? 'Os amigos veem agora: ' + texto : 'Agora não há nada para mostrar (jogo não reconhecido ou música pausada).';
  if (typeof razzeUser === 'undefined' || !razzeUser) return;
  const payload = { game: jogo, artist: faixa ? faixa.artista : '', title: faixa ? faixa.faixa : '' };
  const chave = JSON.stringify(payload);
  if (chave === atv.ultimo && Date.now() - atv.enviadoEm < ATV_RENOVAR_MS) return;
  if (chave === atv.ultimo && !jogo && !faixa) return; // vazio e já avisado: não renova
  try { await window.api.razzeSetActivity(payload); atv.ultimo = chave; atv.enviadoEm = Date.now(); } catch { /* tenta no próximo */ }
}

// Liga ou desliga a leitura conforme as caixinhas e a conta
function atvAgendar() {
  clearInterval(atv.leitura);
  atv.leitura = 0;
  const logado = typeof razzeUser !== 'undefined' && !!razzeUser;
  if (logado && (atvLigada('Jogo') || atvLigada('Musica'))) atv.leitura = setInterval(() => void atvTick(), ATV_CADA_MS);
  void atvTick(); // também manda o vazio quando acabou de desligar
}

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
    $(id).onchange = () => { save('atividade' + k, $(id).checked ? '1' : '0'); atvAgendar(); };
  }
  atv.amigos = setInterval(() => void atvAtualizarAmigos(), ATV_CADA_MS);
  window.addEventListener('beforeunload', () => { if (atv.ultimo && atv.ultimo !== '{"game":"","artist":"","title":""}') window.api.razzeSetActivity({}).catch(() => {}); });
  void atvTick();
  $('senhaCancel').onclick = fecharSenha;
  $('senhaSubmit').onclick = enviarSenha;
  $('senhaDialog').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharSenha();
    else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); void enviarSenha(); }
  });
  $('obGoogle').onclick = () => void googleEntrar($('obStatus'), fecharPrimeiraEntrada);
  $('razzeGoogle').onclick = () => void googleEntrar($('razzeAccountStatus'), () => {});
  $('razzeGoogleLink').onclick = () => void googleVincular();
  void googleAtualizar();
  $('razzeChangePassword').onclick = () => abrirSenha('trocar');
  $('razzeForgot').onclick = () => abrirSenha('esqueci', $('razzeEmail').value.trim());
  $('profileBio').oninput = renderBio;
  $('profileBio').onblur = () => { if (limparBio($('profileBio').value) !== bioAtual) void salvarBio(); };
  $('profileBio').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('profileBio').blur(); } });
  renderBio();
}

if (typeof module !== 'undefined') module.exports = { limparBio, atvTexto };
