'use strict';
// Salas dos amigos pelo modo Internet: quem cria uma sala pela internet (e deixou "Mostrar para meus amigos")
// anuncia servidor, código e um passe de convite na RazzeAPI, junto da presença (main/razze-presence.js).
// A API mostra só para os amigos aceitos. O amigo vê a sala na tela inicial e no HUB e entra com um clique,
// pelo passe; se o passe não valer mais (ou o servidor for antigo, sem passe), o app pede a senha.
// O passe só existe enquanto quem convidou está na sala; o servidor guarda só o HMAC dele.
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

// Ao entrar na sala que eu criei e ao voltar depois de a conexão cair: registra o passe no servidor
function registrarPasseSala() {
  const c = state.cloud;
  if (!c || !c.criador || !c.amigos || !c.passeOn || !state.ws) return;
  if (!salasAmigos.passe) salasAmigos.passe = novoPasse();
  try { state.ws.send(JSON.stringify({ type: 'passe', passe: salasAmigos.passe })); } catch {}
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
