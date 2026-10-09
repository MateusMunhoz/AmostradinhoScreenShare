'use strict';
// Ligar para um amigo pela mensagem privada: quem liga escolhe só o modo da rede. O app cria uma sala escondida
// (fora da lista de sessões e da lista dos amigos), com uma senha gerada aqui, entra na voz e manda a chamada
// pela mensagem privada (criptografada de ponta a ponta): o cartão "Fulano está te ligando" com Atender.
// Atender entra com a senha que veio na mensagem e vai direto para a voz.
// Também a senha da sala no Painel da sala: ver, copiar e, para o host, mudar (mensagem "senha" do protocolo).
// Script clássico: divide o escopo global com os outros (ordem no index.html).
// Usa de: util, estado, conectividade, sala, voz, membros, salas-amigos, mensagens.

const chamada = { ligando: false, atendendo: false, verSenha: false };
const CHAMADA_TOCA_MS = 10 * 60 * 1000;  // até aqui o cartão diz "está te ligando"
const CHAMADA_AVISO_MS = 2 * 60 * 1000;  // chamada que chegou há pouco: avisa com som e o Atender no aviso
const SENHA_ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I/L, que confundem ao ditar

// Senha legível, como K7P-4MX-Q2R (9 caracteres sorteados, uns 44 bits)
function novaSenhaSala() {
  const out = [];
  while (out.length < 9) {
    const [x] = crypto.getRandomValues(new Uint8Array(1));
    if (x < 248) out.push(SENHA_ALFABETO[x % SENHA_ALFABETO.length]); // 248 = 8 × 31: sem viés
  }
  return `${out.slice(0, 3).join('')}-${out.slice(3, 6).join('')}-${out.slice(6).join('')}`;
}

// Por que um modo não dá para usar agora ('' se dá)
async function motivoModoIndisponivel(modo) {
  if (modo === 'internet') return internetServerUrl() ? '' : 'falta o endereço do servidor (Configurações › Rede)';
  if (modo !== 'razze') return '';
  try {
    const st = await window.api.razzeState();
    if (!st.configured || !st.authenticated) return 'entre na conta Razze (no Perfil)';
    const rede = networkPreferences().activeNetworkId;
    if (!rede) return 'conecte uma rede Razze (Configurações › Rede)';
    if (!(await window.api.razzeWireGuardStatus(rede)).connected) return 'a rede Razze está desligada (Configurações › Rede)';
  } catch { return 'não deu para conferir a Razze'; }
  return '';
}

// Passa a usar o modo, como trocar em Configurações › Rede
function usarModoRede(modo) {
  if (selectedNetworkProvider() === modo) return;
  saveNetworkPreferences({ provider: modo });
  renderConnectivitySettings();
  renderRadmin();
  setSessionWatch(sessionWatchWanted());
}

// Janelinha no estilo do appConfirm, com conteúdo próprio. ler() devolve o valor (ou lança o texto do erro)
function dialogoChamada({ titulo, corpo, ok, ler, aoAbrir }) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const modal = document.createElement('div');
    modal.className = 'modal global app-confirm chamada-dialogo';
    const box = document.createElement('div');
    box.className = 'dialog narrow';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const h = document.createElement('h2');
    h.textContent = titulo;
    const erro = document.createElement('p');
    erro.className = 'warn';
    erro.hidden = true;
    const row = document.createElement('div');
    row.className = 'app-confirm-actions';
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'btn small'; no.textContent = 'Cancelar';
    const yes = document.createElement('button');
    yes.type = 'button'; yes.className = 'btn small primary'; yes.textContent = ok;
    row.append(no, yes);
    box.append(h, ...corpo, erro, row);
    modal.append(box);
    const done = (value) => { modal.remove(); back?.focus?.(); resolve(value); };
    yes.onclick = () => {
      try { done(ler()); } catch (e) { erro.textContent = String(e?.message || e); erro.hidden = false; }
    };
    no.onclick = () => done(null);
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) done(null); });
    modal.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); yes.click(); }
    });
    document.body.append(modal);
    (aoAbrir?.(yes) || yes).focus();
  });
}

// ---------- Ligar ----------
// A única escolha: o modo da rede (vem marcado o que você usa agora; o que não está pronto fica desativado)
async function escolherModoChamada(nome, online) {
  const modos = ['internet', 'radmin', 'razze'];
  const motivos = await Promise.all(modos.map(motivoModoIndisponivel));
  const atual = selectedNetworkProvider();
  const marcado = !motivos[modos.indexOf(atual)] ? atual : modos.find((_, i) => !motivos[i]);
  const p = document.createElement('p');
  p.className = 'app-confirm-text';
  p.textContent = online
    ? `O app cria uma sala só para vocês, com senha, te põe na voz e manda a chamada para ${nome} pelas mensagens. Por qual modo de rede?`
    : `${nome} está offline: a chamada fica nas mensagens e chega quando ${nome} abrir o app. Por qual modo de rede?`;
  const grupo = document.createElement('div');
  grupo.className = 'chamada-modos';
  grupo.setAttribute('role', 'radiogroup');
  grupo.setAttribute('aria-label', 'Modo de rede');
  modos.forEach((modo, i) => {
    const label = document.createElement('label');
    label.className = 'chamada-modo';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'chamadaModo';
    input.value = modo;
    input.disabled = !!motivos[i];
    input.checked = modo === marcado;
    const t = document.createElement('span');
    t.textContent = MODO_NOME[modo];
    label.append(input, t);
    if (motivos[i]) {
      const s = document.createElement('small');
      s.className = 'hint';
      s.textContent = motivos[i][0].toUpperCase() + motivos[i].slice(1);
      label.append(s);
    }
    grupo.append(label);
  });
  return dialogoChamada({
    titulo: `Ligar para ${nome}`, corpo: [p, grupo], ok: 'Ligar',
    ler() {
      const modo = grupo.querySelector('input:checked')?.value;
      if (!modo) throw new Error('Nenhum modo está pronto. Configure um em Configurações › Rede.');
      mixer.ensure(); // o clique libera o áudio da voz (a sala leva um tempo para abrir)
      return modo;
    },
    aoAbrir: (yes) => { yes.disabled = !marcado; return null; },
  });
}

// Abre a sala da chamada: escondida, com a senha gerada
async function abrirSalaChamada(modo, senha) {
  if (state.abrindo) throw new Error('Já tem uma sala abrindo. Espere um instante.');
  setAbrindoSala(true);
  try { await abrirSalaChamadaJa(modo, senha); } finally { setAbrindoSala(false); }
}
async function abrirSalaChamadaJa(modo, senha) {
  if (modo === 'internet') {
    const url = internetServerUrl();
    const welcome = await connectRoom(url, { name: getName(), password: senha, create: true, amigosMembros: false });
    state.password = senha;
    try { enterRoom(welcome, false, url, 0, { url, code: welcome.sala, criador: true, amigos: false, chamada: true }); }
    catch (err) { dropHalfJoin(); throw err; }
    return;
  }
  const port = parseInt($('roomPort').value, 10) || 8765;
  detalheEntrada('Abrindo a sala neste PC…');
  const res = await window.api.startServer(port, senha, { sessao: { oculta: true } }, modo);
  if (!res.ok) throw new Error(res.error);
  try {
    const welcome = await connectRoom(`ws://127.0.0.1:${port}`, { name: getName(), password: senha });
    state.password = senha;
    enterRoom(welcome, true, '127.0.0.1', port);
  } catch (err) {
    dropHalfJoin();
    await window.api.stopServer();
    throw err;
  }
}

// O convite da chamada: o mesmo formato do convite (salas-amigos.js), mais chamada e a senha
function conviteChamada(senha) {
  const pessoas = state.members.size + 1;
  if (state.cloud) return { v: 1, modo: 'internet', servidor: state.cloud.url, codigo: state.cloud.code, pessoas, chamada: true, chave: senha };
  if (!state.roomAddr) return null;
  const modo = selectedNetworkProvider() === 'razze' ? 'razze' : 'radmin';
  return { v: 1, modo, endereco: state.roomAddr, senha: true, pessoas, ...(modo === 'razze' ? { rede: networkPreferences().activeNetworkId } : {}), chamada: true, chave: senha };
}

// O texto legível vai junto (app antigo mostra o convite comum: com ele, dá para digitar a senha)
function textoChamada(cv) {
  const onde = cv.modo === 'internet' ? `código ${cv.codigo}, no servidor ${cv.servidor} (modo Internet)` : `endereço ${cv.endereco} (${MODO_NOME[cv.modo]})`;
  return `Te liguei pelo Nebula: ${onde}, senha ${cv.chave}.\ntelap2p://sala?d=${b64url(JSON.stringify(cv))}`;
}

async function ligarPara(id) {
  const nome = friendName(id);
  if (chamada.ligando || entrandoNaSala()) return;
  const modo = await escolherModoChamada(nome, friendOnline(id));
  if (!modo) return;
  if (state.myId) {
    if (!(await appConfirm(`Sair desta sala e ligar para ${nome}?`, { title: 'Ligar', ok: 'Sair e ligar' }))) return;
    leaveRoom();
  }
  chamada.ligando = true;
  toast(`Ligando para ${nome}…`);
  try {
    usarModoRede(modo);
    const senha = novaSenhaSala();
    await comCarregando(`Ligando para ${nome}…`, async () => {
      await requireSelectedNetwork();
      await abrirSalaChamada(modo, senha);
    });
    if (!state.myId) return; // outra entrada já estava em andamento
    await renderRoomAddress(); // o endereço da sala (Radmin e Razze) sai daqui
    joinVoiceIn('');
    const cv = conviteChamada(senha);
    if (!cv) throw new Error('A sala abriu, mas o app não achou o endereço dela para mandar a chamada.');
    const res = await window.api.razzeSendMessage(id, textoChamada(cv));
    const c = dmConv(id);
    await dmLoadConv(c);
    if (res?.message && dmAdd(c, res.message)) dmSaveConv(c);
    renderDm();
    toast(`Chamando ${nome}. A chamada foi pelas mensagens; quando ${nome} atender, entra direto na voz.`);
  } catch (err) {
    if (err?.cancelada) return;
    const msg = String(err?.message || 'erro desconhecido').replace(/^.*RazzeApiError: /, '');
    toast(state.myId ? `A sala está aberta, mas a chamada não foi: ${msg}` : `Não foi possível ligar: ${msg}`, 'error');
  } finally {
    chamada.ligando = false;
  }
}

// ---------- Atender ----------
async function atenderChamada(cv, quem) {
  if (chamada.atendendo || entrandoNaSala()) return;
  mixer.ensure(); // o clique em Atender libera o áudio da voz
  if (state.myId && mesmaSala(cv)) {
    if (!voice.session) joinVoiceIn('');
    show('room');
    return toast('Você já está nessa chamada.');
  }
  if (cv.modo !== selectedNetworkProvider()
    && !(await appConfirm(`A chamada de ${quem} é pelo modo ${MODO_NOME[cv.modo]}. Mudar para ele e atender?`, { title: 'Atender', ok: 'Mudar e atender' }))) return;
  const motivo = cv.modo === 'razze' ? await motivoModoIndisponivel('razze') : '';
  if (motivo) return toast(`Não dá para atender pelo modo Razze: ${motivo}.`, 'error');
  if (cv.modo === 'razze' && cv.rede && cv.rede !== networkPreferences().activeNetworkId) {
    return toast(`Ligue a mesma rede Razze de ${quem} (Configurações › Rede) e atenda de novo.`, 'error');
  }
  if (state.myId) {
    if (!(await appConfirm(`Sair desta sala e atender ${quem}?`, { title: 'Atender', ok: 'Sair e atender' }))) return;
    leaveRoom();
  }
  usarModoRede(cv.modo);
  chamada.atendendo = true;
  try {
    await comCarregando(`Atendendo ${quem}…`, () => entrarNaChamada(cv));
    if (state.myId) joinVoiceIn('');
  } catch (err) {
    if (err?.cancelada) return;
    const msg = String(err?.message || '');
    toast(/senha incorreta|não encontrada/i.test(msg) ? `A chamada de ${quem} já acabou ou a senha mudou. ${msg}`
      : /conectar|tempo|timeout|recus/i.test(msg) ? `Não deu para chegar na sala de ${quem}: ${msg}` : msg || 'Não foi possível atender.', 'error');
  } finally {
    chamada.atendendo = false;
  }
}

// Entra na sala da chamada (pela tela de carregando de atenderChamada)
async function entrarNaChamada(cv) {
  if (cv.modo === 'internet') {
    const welcome = await connectRoom(cv.servidor, { name: getName(), password: cv.chave, room: cv.codigo });
    state.password = cv.chave;
    try { enterRoom(welcome, false, cv.servidor, 0, { url: cv.servidor, code: welcome.sala || cv.codigo, chamada: true }); }
    catch (err) { dropHalfJoin(); throw err; }
  } else {
    const [host, porta] = cv.endereco.split(':');
    const welcome = await connectRoom(`ws://${host}:${porta}`, { name: getName(), password: cv.chave });
    state.password = cv.chave;
    save('roomAddr', cv.endereco);
    try { enterRoom(welcome, false, host, Number(porta)); }
    catch (err) { dropHalfJoin(); throw err; }
  }
}

// Chamada que acabou de chegar (mensagens.js): som e aviso com Atender, mesmo com a conversa fechada
function avisarChamada(cv, quem) {
  void appSounds.play('mention');
  toast(`${quem} está te ligando.`, 'info', { label: 'Atender', run: () => atenderChamada(cv, quem) });
}

// ---------- Senha da sala (Painel da sala) ----------
function renderSenhaSala() {
  renderAmigosMembros(); // logo abaixo: "Amigos de quem está na sala podem entrar" (salas-amigos.js)
  const box = $('roomSenha');
  const souHost = !!state.myId && state.hostId === state.myId;
  box.hidden = !state.myId || (!state.password && !souHost);
  box.innerHTML = '';
  if (box.hidden) return;
  const label = document.createElement('span');
  label.className = 'room-senha-label';
  label.textContent = 'Senha';
  const code = document.createElement('code');
  code.textContent = !state.password ? 'sem senha' : chamada.verSenha ? state.password : '•'.repeat(Math.min(8, state.password.length));
  box.append(label, code);
  if (state.password) {
    const ver = document.createElement('button');
    ver.type = 'button';
    ver.className = 'btn small icon';
    setIcon(ver, chamada.verSenha ? 'eyeOff' : 'eye', chamada.verSenha ? 'Esconder a senha' : 'Mostrar a senha');
    ver.onclick = () => { chamada.verSenha = !chamada.verSenha; renderSenhaSala(); };
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn small';
    copy.textContent = 'Copiar';
    copy.onclick = async () => {
      try { await copiar(state.password); copy.textContent = 'Copiado'; setTimeout(() => { copy.textContent = 'Copiar'; }, 1500); }
      catch { toast('Não foi possível copiar.', 'error'); }
    };
    box.append(ver, copy);
  }
  const mudar = document.createElement('button');
  mudar.type = 'button';
  mudar.className = 'btn small';
  mudar.id = 'roomSenhaMudar';
  mudar.textContent = 'Mudar';
  mudar.disabled = !souHost || !state.senhaOn;
  mudar.title = !souHost ? `Só o host (${state.hostId ? nameOf(state.hostId) : 'quem criou'}) muda a senha da sala.`
    : !state.senhaOn ? 'O servidor desta sala é de uma versão antiga e não sabe mudar a senha.'
    : 'Trocar a senha: quem já está continua na sala; quem entrar depois usa a nova.';
  mudar.onclick = () => void mudarSenhaSala();
  box.append(mudar);
}

async function mudarSenhaSala() {
  const internet = !!state.cloud;
  const min = internet ? 4 : 0;
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 64;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.value = novaSenhaSala();
  input.setAttribute('aria-label', 'Senha nova');
  const gerar = document.createElement('button');
  gerar.type = 'button';
  gerar.className = 'btn small';
  gerar.textContent = 'Gerar outra';
  gerar.onclick = () => { input.value = novaSenhaSala(); input.focus(); input.select(); };
  const linha = document.createElement('div');
  linha.className = 'chamada-senha-linha';
  linha.append(input, gerar);
  const p = document.createElement('p');
  p.className = 'app-confirm-text';
  p.textContent = 'Quem já está na sala continua e recebe a senha nova. Quem entrar depois precisa dela.'
    + (internet ? ' Os convites que entram sem senha (pelas mensagens e pela lista dos amigos) deixam de valer.' : ' Vazio: a sala fica sem senha.');
  const nova = await dialogoChamada({
    titulo: 'Mudar a senha da sala', corpo: [p, linha], ok: 'Mudar',
    ler() {
      const v = input.value.trim();
      if (v.length < min || v.length > 64 || /[\u0000-\u001f\u007f]/.test(v)) throw new Error(internet ? 'No modo Internet a senha precisa ter de 4 a 64 caracteres.' : 'A senha pode ter até 64 caracteres.');
      return v;
    },
    aoAbrir: () => { setTimeout(() => input.select()); return input; },
  });
  if (nova === null) return;
  if (!state.myId) return;
  send({ type: 'senha', password: nova });
}

// O servidor avisou que a senha mudou (para quem entrou por um passe, sem a senha nova)
function receberSenha(m) {
  if (typeof m.password === 'string' && m.password.length <= 64) state.password = m.password;
  if (state.cloud) { // os passes caíram: quem anuncia a sala aos amigos registra um novo
    salasAmigos.passe = '';
    registrarPasseSala();
    publicarSalaInternet();
  }
  renderSenhaSala();
  toast(m.by === state.myId ? 'Senha da sala mudada. Quem já está continua; quem entrar agora usa a nova.'
    : `${state.members.has(m.by) ? nameOf(m.by) : 'O host'} mudou a senha da sala.`);
}
