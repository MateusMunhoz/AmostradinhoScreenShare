'use strict';
// Salas dos amigos pelo modo Internet: quem cria uma sala pela internet (e deixou "Mostrar para meus amigos")
// anuncia servidor, código e um passe de convite na RazzeAPI, junto da presença (main/razze-presence.js).
// A API mostra só para os amigos aceitos. O amigo vê a sala na tela inicial e no HUB e entra com um clique,
// pelo passe; se o passe não valer mais (ou o servidor for antigo, sem passe), o app pede a senha.
// O passe só existe enquanto quem convidou está na sala; o servidor guarda só o HMAC dele.
// Convite pelas mensagens diretas: o Convidar do HUB manda uma mensagem com um texto legível (para app antigo) e
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

// Da presença (conectividade.js): as salas dos amigos no formato da lista de sessões
function receberSalasAmigos(lista) {
  sessoes.amigos = (Array.isArray(lista) ? lista : []).filter((s) => s && typeof s.codigo === 'string' && typeof s.servidor === 'string')
    .map((s) => ({
      id: `${s.servidor}#${s.codigo}`, host: String(s.host || 'amigo').slice(0, 60), pessoas: Number.isInteger(s.pessoas) ? s.pessoas : 1,
      senha: !s.passe, codigo: s.codigo, servidor: s.servidor, passe: s.passe || '',
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
  return `Te convidei para a minha sala no Tela P2P: ${onde}.\ntelap2p://sala?d=${b64url(JSON.stringify(cv))}`;
}

// Lê o convite de uma mensagem; null se não é convite ou se algo não está no formato certo
function lerConvite(text) {
  const m = CONVITE_RE.exec(String(text || ''));
  if (!m) return null;
  let cv;
  try { cv = JSON.parse(deB64url(m[1])); } catch { return null; }
  if (!cv || typeof cv !== 'object' || cv.v !== 1 || !MODO_NOME[cv.modo]) return null;
  const pessoas = Number.isInteger(cv.pessoas) ? Math.min(99, Math.max(1, cv.pessoas)) : 1;
  if (cv.modo === 'internet') {
    let url = null;
    try { url = new URL(String(cv.servidor)); } catch { return null; }
    if (String(cv.servidor).length > 200 || !['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    if (typeof cv.codigo !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(cv.codigo)) return null;
    const passe = typeof cv.passe === 'string' && /^[A-Za-z0-9_-]{43}$/.test(cv.passe) ? cv.passe : '';
    return { modo: 'internet', servidor: String(cv.servidor), codigo: cv.codigo, passe, pessoas };
  }
  if (typeof cv.endereco !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(cv.endereco)) return null;
  const rede = cv.modo === 'razze' && typeof cv.rede === 'string' && cv.rede.length <= 80 ? cv.rede : '';
  return { modo: cv.modo, endereco: cv.endereco, senha: !!cv.senha, pessoas, rede };
}

// Convidar (HUB › Amigos): manda o convite como mensagem direta
async function convidarPorMensagem(f) {
  const cv = conviteDaSala();
  if (!cv) return friendsStatus(`Entre numa sala primeiro para convidar ${f.displayName}.`);
  try {
    const res = await window.api.razzeSendMessage(f.id, textoConvite(cv));
    const c = dmConv(f.id);
    await dmLoadConv(c);
    if (res?.message && dmAdd(c, res.message)) dmSaveConv(c);
    renderDm();
    friendsStatus(`Convite enviado para ${f.displayName} pelas mensagens.`);
  } catch (error) {
    friendsStatus('Não foi possível mandar o convite: ' + String(error?.message || 'erro desconhecido').replace(/^.*RazzeApiError: /, ''));
  }
}

const mesmaSala = (cv) => (cv.modo === 'internet' ? state.cloud?.code === cv.codigo && state.cloud?.url === cv.servidor
  : !state.cloud && (state.roomAddr === cv.endereco || `${state.host}:${state.port}` === cv.endereco));

// Entrar pelo cartão do convite: só com o clique, no modo da sala (nunca troca o modo sozinho)
async function aceitarConvite(cv, quem) {
  if (state.myId && mesmaSala(cv)) return toast('Você já está nessa sala.');
  if (cv.modo !== selectedNetworkProvider()) return toast(`Esse convite é pelo modo ${MODO_NOME[cv.modo]}. Mude em HUB › Rede e clique em Entrar de novo.`, 'error');
  if (cv.modo === 'razze' && cv.rede && cv.rede !== networkPreferences().activeNetworkId) {
    return toast(`Ligue a mesma rede Razze de ${quem} (HUB › Rede) e clique em Entrar de novo.`, 'error');
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

// O cartão do convite dentro da conversa (mensagens.js)
function cartaoConvite(cv, mine, quem) {
  const box = document.createElement('div');
  box.className = 'dm-invite';
  const title = document.createElement('strong');
  title.textContent = mine ? `Você convidou ${quem} para a sua sala` : `Convite para a sala de ${quem}`;
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
    btn.textContent = 'Entrar';
    btn.title = `Entrar na sala de ${quem}`;
    btn.onclick = () => aceitarConvite(cv, quem);
    box.append(btn);
  }
  return box;
}
