'use strict';
// Salas dos amigos pelo modo Internet: quem cria uma sala pela internet (e deixou "Mostrar para meus amigos")
// anuncia servidor, código e um passe de convite na RazzeAPI, junto da presença (main/razze-presence.js).
// A API mostra só para os amigos aceitos. O amigo vê a sala na tela inicial e entra com um clique,
// pelo passe; se o passe não valer mais (ou o servidor for antigo, sem passe), o app pede a senha.
// O passe só existe enquanto quem convidou está na sala; o servidor guarda só o HMAC dele.
// Convite pelas mensagens diretas: o Convidar da aba Amigos manda uma mensagem com um texto legível (para app antigo) e
// uma linha telap2p://sala?d=... que o app mostra como um cartão com Entrar (mensagens.js). Só entra com o clique.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, sala, sessoes.

const salasAmigos = {
  passe: '',          // o meu passe de convite (sala que eu criei)
  enviado: '',        // o que foi mandado ao processo principal por último (evita IPC repetido)
  alvo: null,         // sala de amigo que pediu senha: { codigo, servidor } (Entrar com código usa este servidor)
  entrando: false,
};

function novoPasse() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); // 43 caracteres
}

// Ao entrar na sala que eu criei e ao voltar depois de a conexão cair: registra o passe no servidor.
// Também vale para quem convidou alguém pelas mensagens (garantirPasse), mesmo sem ter criado a sala.
function registrarPasseSala() {
  const c = state.cloud;
  if (!c || !c.passeOn || c.passe || !state.ws) return; // quem entrou por um passe não cria outro (o servidor recusa)
  if (!salasAmigos.passe) {
    if (!c.criador || !c.amigos) return;
    salasAmigos.passe = novoPasse();
  }
  try { state.ws.send(JSON.stringify({ type: 'passe', passe: salasAmigos.passe })); } catch {}
}
// O passe para um convite: o que já existe ou um novo, registrado agora ('' se esta sala não aceita passe)
function garantirPasse() {
  const c = state.cloud;
  if (!c || !c.passeOn || c.passe || !state.ws) return '';
  if (!salasAmigos.passe) { salasAmigos.passe = novoPasse(); registrarPasseSala(); }
  return salasAmigos.passe;
}

// Anuncia (ou atualiza o número de pessoas) da sala que eu criei pela internet
function publicarSalaInternet() {
  const c = state.cloud;
  if (!c || !c.criador || !c.amigos) return;
  const sala = { servidor: c.url, codigo: c.code, pessoas: state.members.size + 1, passe: c.passeOn ? salasAmigos.passe || null : null };
  const assinatura = JSON.stringify(sala);
  if (assinatura === salasAmigos.enviado) return;
  salasAmigos.enviado = assinatura;
  window.api.razzeInternetRoom(sala).catch(() => {});
}

function retirarSalaInternet() {
  if (salasAmigos.enviado) window.api.razzeInternetRoom(null).catch(() => {});
  salasAmigos.enviado = '';
  salasAmigos.passe = '';
}

// ---------- Em que sala estou (docs/spec/sala-do-amigo.md) ----------
// Em qualquer modo, mesmo sem ser o host: os amigos veem "Na sala de [host] · Radmin · 4 pessoas". Vai só o modo, o
// nome do host, quantas pessoas e se estou na voz, nada de endereço. Sala escondida (a das chamadas, ou a que o host
// tirou da lista) não vai; Perfil › Atividade desliga. Chamado a cada renderMembers (membros.js): só manda se mudou.
const salaAtualLigada = () => load('atividadeSala', '1') === '1';
let salaAtualEnviada = '';
// paraComparar: a minha sala para o "Na sua sala", mesmo com o interruptor desligado
function salaAtualResumo(paraComparar = false) {
  if (!state.myId || !state.ws || state.sessao?.oculta || (!paraComparar && !salaAtualLigada())) return null;
  const modo = state.cloud ? 'internet' : selectedNetworkProvider() === 'razze' ? 'razze' : 'radmin';
  const host = state.hostId === state.myId ? getName() : nameOf(state.hostId);
  return { modo, host, pessoas: state.members.size + 1, voz: !!voice.session };
}
function publicarSalaAtual() {
  const sala = salaAtualResumo();
  const assinatura = sala ? JSON.stringify(sala) : '';
  if (assinatura === salaAtualEnviada) return;
  salaAtualEnviada = assinatura;
  window.api.razzeSalaAtual(sala).catch(() => {});
}
function retirarSalaAtual() {
  if (salaAtualEnviada) window.api.razzeSalaAtual(null).catch(() => {});
  salaAtualEnviada = '';
}
// O texto embaixo do nome do amigo (aba Amigos e Início): onde ele está; vazio se não anunciou (fica "Online")
const SALA_MODO = { radmin: 'Radmin', razze: 'Razze', internet: 'Internet' };
function textoSalaDoAmigo(f) {
  const s = f?.sala;
  if (!s || !f.online) return '';
  const minha = salaAtualResumo(true);
  if (minha && minha.modo === s.modo && minha.host === s.host && minha.pessoas === s.pessoas) return s.voz ? 'Na sua sala · na voz' : 'Na sua sala';
  return `Na sala de ${s.host} · ${SALA_MODO[s.modo] || s.modo} · ${s.voz ? 'na voz' : s.pessoas === 1 ? '1 pessoa' : `${s.pessoas} pessoas`}`;
}

// Da presença (conectividade.js): as salas dos amigos no formato da lista de sessões
function receberSalasAmigos(lista) {
  sessoes.amigos = (Array.isArray(lista) ? lista : []).filter((s) => s && typeof s.codigo === 'string' && typeof s.servidor === 'string')
    .map((s) => ({
      id: `${s.servidor}#${s.codigo}`, host: String(s.host || 'amigo').slice(0, 60), pessoas: Number.isInteger(s.pessoas) ? s.pessoas : 1,
      senha: !s.passe, codigo: s.codigo, servidor: s.servidor, passe: s.passe || '',
      userId: typeof s.userId === 'string' ? s.userId : '', // o dono, para o cartão mostrar o jogo dele (sessoes.js)
    }));
}

// Entrar na sala de um amigo: pelo passe, direto; sem passe (ou se ele não vale mais), pede a senha
async function entrarSalaAmigo(s) {
  if (state.myId) return toast('Você já está numa sala. Volte para ela e saia antes de entrar em outra.', 'error');
  if (!s.passe) return pedirSenhaAmigo(s);
  if (salasAmigos.entrando) return;
  salasAmigos.entrando = true;
  try {
    const welcome = await connectRoom(s.servidor, { name: getName(), passe: s.passe, room: s.codigo });
    state.password = '';
    try { enterRoom(welcome, false, s.servidor, 0, { url: s.servidor, code: welcome.sala || s.codigo, passe: s.passe }); }
    catch (err) { dropHalfJoin(); throw err; }
  } catch (err) {
    if (/convite não vale/i.test(err.message)) pedirSenhaAmigo(s, err.message);
    else toast(err.message, 'error');
  } finally {
    salasAmigos.entrando = false;
  }
}

function pedirSenhaAmigo(s, motivo = '') {
  salasAmigos.alvo = { codigo: s.codigo, servidor: s.servidor };
  $('roomAddr').value = s.codigo;
  setJoinOpen(true);
  $('joinPassword').value = '';
  $('joinPassword').focus();
  toast(motivo || `A sala de ${s.host} pede a senha. Digite e clique em Entrar.`);
}

// Entrar com código: se o código é o de uma sala de amigo que pediu senha, usa o servidor dela
function servidorDoCodigo(code) {
  const alvo = salasAmigos.alvo;
  return alvo && alvo.codigo === code ? alvo.servidor : '';
}

// ---------- Convite pelas mensagens diretas ----------
const CONVITE_RE = /\btelap2p:\/\/sala\?d=([A-Za-z0-9_-]{10,1200})\s*$/;
const MODO_NOME = { internet: 'Internet', radmin: 'Radmin ou rede local', razze: 'Razze' };
const b64url = (t) => btoa(String.fromCharCode(...new TextEncoder().encode(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (t) => new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)));

// O convite da sala em que estou agora (null se não estou numa sala)
function conviteDaSala() {
  if (!state.myId) return null;
  const pessoas = state.members.size + 1;
  if (state.cloud) {
    const passe = garantirPasse();
    return { v: 1, modo: 'internet', servidor: state.cloud.url, codigo: state.cloud.code, ...(passe ? { passe } : {}), pessoas };
  }
  const endereco = state.roomAddr || (state.host && state.host !== '127.0.0.1' ? `${state.host}:${state.port}` : '');
  if (!endereco) return null;
  const modo = selectedNetworkProvider() === 'razze' ? 'razze' : 'radmin';
  return { v: 1, modo, endereco, senha: !!state.password, pessoas, ...(modo === 'razze' ? { rede: networkPreferences().activeNetworkId } : {}) };
}

function textoConvite(cv) {
  const onde = cv.modo === 'internet' ? `código ${cv.codigo}, no servidor ${cv.servidor} (modo Internet)` : `endereço ${cv.endereco} (${MODO_NOME[cv.modo]})`;
  return `Te convidei para a minha sala no Nebula: ${onde}.\ntelap2p://sala?d=${b64url(JSON.stringify(cv))}`;
}

// Lê o convite de uma mensagem; null se não é convite ou se algo não está no formato certo
function lerConvite(text) {
  const m = CONVITE_RE.exec(String(text || ''));
  if (!m) return null;
  let cv;
  try { cv = JSON.parse(deB64url(m[1])); } catch { return null; }
  if (!cv || typeof cv !== 'object' || cv.v !== 1 || !MODO_NOME[cv.modo]) return null;
  const pessoas = Number.isInteger(cv.pessoas) ? Math.min(99, Math.max(1, cv.pessoas)) : 1;
  // Chamada (chamada.js): a senha da sala vem junto, porque a mensagem é criptografada de ponta a ponta
  const chave = cv.chamada === true && typeof cv.chave === 'string' && cv.chave.length >= 4 && cv.chave.length <= 64
    && !/[\u0000-\u001f\u007f]/.test(cv.chave) ? cv.chave : '';
  const chamadaInfo = chave ? { chamada: true, chave } : {};
  if (cv.modo === 'internet') {
    let url = null;
    try { url = new URL(String(cv.servidor)); } catch { return null; }
    if (String(cv.servidor).length > 200 || !['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    if (typeof cv.codigo !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(cv.codigo)) return null;
    const passe = typeof cv.passe === 'string' && /^[A-Za-z0-9_-]{43}$/.test(cv.passe) ? cv.passe : '';
    return { modo: 'internet', servidor: String(cv.servidor), codigo: cv.codigo, passe, pessoas, ...chamadaInfo };
  }
  if (typeof cv.endereco !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(cv.endereco)) return null;
  const rede = cv.modo === 'razze' && typeof cv.rede === 'string' && cv.rede.length <= 80 ? cv.rede : '';
  return { modo: cv.modo, endereco: cv.endereco, senha: !!cv.senha, pessoas, rede, ...chamadaInfo };
}

// Convidar (envelope › Amigos; e "Chamar para minha sala" no Início, que avisa por toast): manda o convite como
// mensagem direta
async function convidarPorMensagem(f, avisar = friendsStatus) {
  const cv = conviteDaSala();
  if (!cv) return avisar(`Entre numa sala primeiro para convidar ${f.displayName}.`);
  try {
    const res = await window.api.razzeSendMessage(f.id, textoConvite(cv));
    const c = dmConv(f.id);
    await dmLoadConv(c);
    if (res?.message && dmAdd(c, res.message)) dmSaveConv(c);
    renderDm();
    avisar(`Convite enviado para ${f.displayName} pelas mensagens.`);
  } catch (error) {
    avisar('Não foi possível mandar o convite: ' + String(error?.message || 'erro desconhecido').replace(/^.*RazzeApiError: /, ''));
  }
}

const mesmaSala = (cv) => (cv.modo === 'internet' ? state.cloud?.code === cv.codigo && state.cloud?.url === cv.servidor
  : !state.cloud && (state.roomAddr === cv.endereco || `${state.host}:${state.port}` === cv.endereco));

// Entrar pelo cartão do convite: só com o clique, no modo da sala (nunca troca o modo sozinho)
async function aceitarConvite(cv, quem) {
  if (state.myId && mesmaSala(cv)) return toast('Você já está nessa sala.');
  if (cv.modo !== selectedNetworkProvider()) return toast(`Esse convite é pelo modo ${MODO_NOME[cv.modo]}. Mude em Configurações › Rede e clique em Entrar de novo.`, 'error');
  if (cv.modo === 'razze' && cv.rede && cv.rede !== networkPreferences().activeNetworkId) {
    return toast(`Ligue a mesma rede Razze de ${quem} (Configurações › Rede) e clique em Entrar de novo.`, 'error');
  }
  if (state.myId) {
    if (!(await appConfirm(`Sair desta sala e entrar na sala de ${quem}?`, { title: 'Trocar de sala', ok: 'Trocar' }))) return;
    leaveRoom();
  }
  show('home');
  if (cv.modo === 'internet') return entrarSalaAmigo({ host: quem, codigo: cv.codigo, servidor: cv.servidor, passe: cv.passe });
  const [endereco, porta] = cv.endereco.split(':');
  enterSession({ host: quem, endereco, porta: Number(porta), senha: cv.senha });
}

// O cartão do convite dentro da conversa (mensagens.js). quando: a hora da mensagem (a chamada "toca" por um tempo)
function cartaoConvite(cv, mine, quem, quando = 0) {
  const box = document.createElement('div');
  box.className = 'dm-invite' + (cv.chamada ? ' dm-call' : '');
  const title = document.createElement('strong');
  const tocando = cv.chamada && Date.now() - quando < CHAMADA_TOCA_MS;
  title.textContent = cv.chamada
    ? (mine ? `Você ligou para ${quem}` : tocando ? `${quem} está te ligando` : `Chamada de ${quem}`)
    : mine ? `Você convidou ${quem} para a sua sala` : `Convite para a sala de ${quem}`;
  const meta = document.createElement('span');
  meta.className = 'dm-invite-meta';
  const senha = cv.modo === 'internet' ? !cv.passe : cv.senha;
  meta.textContent = [`${cv.pessoas} ${cv.pessoas === 1 ? 'pessoa' : 'pessoas'}`, cv.modo === 'internet' ? 'pela internet' : MODO_NOME[cv.modo],
    cv.modo === 'internet' ? `código ${cv.codigo}` : cv.endereco, senha ? 'com senha' : ''].filter(Boolean).join(' · ');
  box.append(title, meta);
  if (!mine) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small primary';
    btn.textContent = cv.chamada ? (tocando ? 'Atender' : 'Entrar') : 'Entrar';
    btn.title = cv.chamada ? `Entrar na chamada de ${quem}, direto na voz` : `Entrar na sala de ${quem}`;
    btn.onclick = () => (cv.chamada ? atenderChamada(cv, quem) : aceitarConvite(cv, quem));
    box.append(btn);
  }
  return box;
}
