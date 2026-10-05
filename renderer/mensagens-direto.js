'use strict';
// Conexão direta das mensagens privadas: uma RTCPeerConnection só da conversa, fora da sala (o app fica numa sala
// por vez; esta conexão não mexe nela). Com ela de pé, texto e arquivos vão direto de um PC para o outro; sem ela,
// o texto vai pela RazzeAPI (renderer/mensagens.js) e arquivo nenhum sai: arquivo nunca passa pelo servidor.
// - Sinais: a oferta e a resposta (SDP com todos os candidatos, sem trickle) vão cifradas de ponta a ponta pela
//   RazzeAPI (POST/GET /v1/signals, main/mensagens-cripto.js). Quem tem a id menor oferece; o outro pede ("pedir").
// - Canal ordenado "dm": JSON { t: 'msg' | 'ack' | 'quero' | 'parte' | 'cancela' | 'indisponivel' }; cada 'parte'
//   é seguida dos bytes (até 64 KB). Mensagem sem 'ack' em 5 s (ou com o canal caindo) vai pela RazzeAPI.
// - Arquivos: até 200 MB, sem metadados (withoutMetadata, chat.js). Imagem até 8 MB chega sozinha e fica guardada,
//   cifrada, neste PC (main/mensagens.js); outro arquivo vem com Baixar, direto do PC de quem mandou, enquanto o
//   app dele estiver aberto.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, chat,
// conectividade, mensagens (as funções são chamadas só depois da carga).

const DIRETO_ESPERA_MS = 20000;      // tentando conectar; depois disso, desiste
const DIRETO_DE_NOVO_MS = 60000;     // depois de não dar, tenta de novo
const DIRETO_ACK_MS = 5000;
const DIRETO_PARTE = 64 * 1024;
const DIRETO_MAX_ARQUIVO = 200 * 1024 * 1024;
const DIRETO_AUTO_IMAGEM = 8 * 1024 * 1024;
const DIRETO_BUFFER = 4 * 1024 * 1024; // passando disso esperando na conexão, o envio espera
const DIRETO_SINAIS_MS = 3000, DIRETO_SINAIS_RAPIDO_MS = 1000;
const DIRETO_SDP_MAX = 10000;
const DIRETO_ID = /^[a-f0-9]{32}$/;

const direto = {
  peers: new Map(),      // amigo -> { id, pc, ch, estado: 'conectando' | 'aberto' | 'falhou', prox, acks, parte, enviando, sessao }
  timer: null, buscando: false, rapido: false, unsupported: false,
  ice: null,             // { at, list }: STUN do servidor do modo Internet
  arquivos: new Map(),   // id do arquivo -> File que eu mandei (disponível enquanto o app estiver aberto)
  baixando: new Map(),   // id do arquivo -> { from, f, chunks, got, bytes, total }
  prontos: new Map(),    // id do arquivo -> blob: pronto para mostrar ou salvar
  cards: new Map(),      // id do arquivo -> partes do cartão na tela
};

// Por onde os sinais vão e vêm (o teste ponta a ponta troca por uma ponte entre dois apps, sem RazzeAPI)
const diretoApi = {
  enviar: (to, text) => window.api.dmSignalSend(to, text),
  buscar: () => window.api.dmSignals(),
};

function diretoNovaId() { return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
const diretoOferece = (id) => dm.account < id;
function diretoAberto(id) {
  const p = direto.peers.get(id);
  return p?.estado === 'aberto' && p.ch?.readyState === 'open' ? p : null;
}

// ---------- ICE: Razze, Radmin e rede local não precisam de nada; o modo Internet usa o STUN do servidor ----------
async function diretoIce() {
  if (typeof state === 'object' && state.cloud && RTC_CONFIG.iceServers.length) return RTC_CONFIG.iceServers; // na sala Internet: o TURN dela
  if (selectedNetworkProvider() !== 'internet' || !internetServerUrl()) return [];
  if (direto.ice && Date.now() - direto.ice.at < 10 * 60 * 1000) return direto.ice.list;
  let list = [];
  try {
    const info = await testInternetServer(internetServerUrl(), 4000);
    if (info.stun.length) list = [{ urls: info.stun }];
  } catch {}
  direto.ice = { at: Date.now(), list };
  return list;
}

// ---------- Conectar ----------
// Chamado ao abrir a conversa e ao mandar algo: tenta se o amigo está online e não tem conexão nem tentativa recente
function diretoGarantir(id) {
  if (!dm.account || direto.unsupported || !DIRETO_ID.test(id) || !friendOnline(id)) return;
  const p = direto.peers.get(id);
  if (p && p.estado !== 'falhou') return;
  if (p && Date.now() < p.prox) return;
  if (diretoOferece(id)) void diretoOferecer(id);
  else {
    diretoNovoPeer(id);
    diretoApi.enviar(id, JSON.stringify({ t: 'pedir' })).catch((e) => diretoErroSinal(e, id));
  }
  diretoAgendarSinais(true);
}

function diretoNovoPeer(id) {
  diretoFechar(id);
  const p = { id, pc: null, ch: null, estado: 'conectando', prox: 0, acks: new Map(), parte: null, enviando: new Set(), sessao: diretoNovaId() };
  p.timer = setTimeout(() => { if (p.estado === 'conectando') diretoFalhou(p); }, DIRETO_ESPERA_MS);
  direto.peers.set(id, p);
  renderDm();
  return p;
}
async function diretoPc(p) {
  const pc = new RTCPeerConnection({ iceServers: await diretoIce() });
  p.pc = pc;
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && direto.peers.get(p.id) === p) diretoFalhou(p, true); };
  pc.ondatachannel = (e) => diretoCanal(p, e.channel);
  return pc;
}
// Sem trickle: espera juntar os candidatos (até 5 s) e manda tudo num sinal só
function diretoEsperarIce(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 5000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
  });
}
async function diretoOferecer(id) {
  const p = diretoNovoPeer(id);
  try {
    const pc = await diretoPc(p);
    diretoCanal(p, pc.createDataChannel('dm', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await diretoEsperarIce(pc);
    if (direto.peers.get(id) !== p) return;
    await diretoApi.enviar(id, JSON.stringify({ t: 'oferta', sdp: pc.localDescription.sdp, s: p.sessao }));
  } catch (e) { diretoErroSinal(e, id); if (direto.peers.get(id) === p) diretoFalhou(p); }
}
async function diretoResponder(id, sinal) {
  const p = diretoNovoPeer(id);
  p.sessao = sinal.s;
  try {
    const pc = await diretoPc(p);
    await pc.setRemoteDescription({ type: 'offer', sdp: sinal.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await diretoEsperarIce(pc);
    if (direto.peers.get(id) !== p) return;
    await diretoApi.enviar(id, JSON.stringify({ t: 'resposta', sdp: pc.localDescription.sdp, s: p.sessao }));
  } catch (e) { diretoErroSinal(e, id); if (direto.peers.get(id) === p) diretoFalhou(p); }
}
function diretoErroSinal(e, id) {
  if (String(e?.message || '').includes('Endpoint não encontrado')) direto.unsupported = true; // RazzeAPI antiga
  else console.warn('conexão direta', id, e?.message || e);
}

// Um sinal que chegou (já decifrado e conferido no processo principal)
function diretoSinal(s) {
  const id = String(s?.from || '');
  if (!DIRETO_ID.test(id) || !friendsData.friends.some((f) => f.id === id)) return;
  let m = null;
  try { m = JSON.parse(s.text); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  const sdpOk = typeof m.sdp === 'string' && m.sdp.length <= DIRETO_SDP_MAX && typeof m.s === 'string' && DIRETO_ID.test(m.s);
  const p = direto.peers.get(id);
  if (m.t === 'pedir' && diretoOferece(id)) {
    // Quem pede não tem conexão: oferece de novo (menos com uma oferta saindo agora)
    if (!(p?.estado === 'conectando' && p.pc)) void diretoOferecer(id);
  } else if (m.t === 'oferta' && sdpOk && !diretoOferece(id)) {
    void diretoResponder(id, m);
  } else if (m.t === 'resposta' && sdpOk && diretoOferece(id)) {
    if (p?.pc && p.sessao === m.s && p.pc.signalingState === 'have-local-offer') p.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => diretoFalhou(p));
  }
}

// Busca os sinais: a cada 3 s, ou a cada 1 s com uma conexão sendo feita
async function diretoBuscarSinais() {
  direto.timer = null;
  if (!dm.account || direto.unsupported) return;
  direto.buscando = true;
  try { for (const s of await diretoApi.buscar()) diretoSinal(s); }
  catch (e) { diretoErroSinal(e, ''); }
  finally { direto.buscando = false; }
  diretoAgendarSinais(direto.rapido);
}
function diretoAgendarSinais(rapido = false) {
  if (!dm.account || direto.unsupported) return;
  if (direto.buscando) { direto.rapido = direto.rapido || rapido; return; }
  direto.rapido = false;
  const conectando = rapido || [...direto.peers.values()].some((p) => p.estado === 'conectando');
  if (direto.timer) { if (!rapido) return; clearTimeout(direto.timer); }
  direto.timer = setTimeout(diretoBuscarSinais, conectando ? DIRETO_SINAIS_RAPIDO_MS : DIRETO_SINAIS_MS);
}

// ---------- Canal ----------
function diretoCanal(p, ch) {
  p.ch = ch;
  ch.binaryType = 'arraybuffer';
  ch.bufferedAmountLowThreshold = 1024 * 1024;
  ch.onopen = () => {
    if (direto.peers.get(p.id) !== p) return ch.close();
    p.estado = 'aberto';
    clearTimeout(p.timer);
    renderDm();
  };
  ch.onclose = () => { if (direto.peers.get(p.id) === p && p.estado !== 'falhou') diretoFalhou(p, true); };
  ch.onmessage = (e) => { diretoMensagem(p, e.data).catch((err) => console.warn('conexão direta', err)); };
}
// Não deu ou caiu: as mensagens sem confirmação vão pelo servidor; tenta de novo depois (logo, se caiu)
function diretoFalhou(p, caiu = false) {
  clearTimeout(p.timer);
  p.estado = 'falhou';
  p.prox = Date.now() + (caiu ? 5000 : DIRETO_DE_NOVO_MS);
  diretoLargar(p);
  renderDm();
}
// Fecha de vez (conversa tirada da barra, saiu da conta)
function diretoFechar(id) {
  const p = direto.peers.get(id);
  if (!p) return;
  direto.peers.delete(id);
  clearTimeout(p.timer);
  diretoLargar(p);
}
function diretoLargar(p) {
  try { p.ch?.close(); } catch {}
  try { p.pc?.close(); } catch {}
  p.enviando.clear();
  for (const a of p.acks.values()) { clearTimeout(a.timer); void diretoPeloServidor(p.id, a.m); }
  p.acks.clear();
  for (const [fid, dl] of direto.baixando) if (dl.from === p.id) diretoArquivoFalhou(fid, 'a conexão direta caiu, tente de novo');
}
function diretoParar() {
  clearTimeout(direto.timer);
  for (const id of [...direto.peers.keys()]) diretoFechar(id);
  for (const url of direto.prontos.values()) URL.revokeObjectURL(url);
  Object.assign(direto, { timer: null, rapido: false, unsupported: false, ice: null, arquivos: new Map(), baixando: new Map(), prontos: new Map(), cards: new Map() });
}
const diretoEnviar = (p, obj) => p.ch.send(JSON.stringify(obj));

// ---------- Mensagens ----------
// Texto pela conexão direta; sem confirmação em 5 s, vai pelo servidor
function diretoTexto(p, c, text) {
  const m = { id: diretoNovaId(), from: dm.account, text, createdAt: Date.now(), e2e: true, direto: true };
  dmAdd(c, m);
  dmSaveConv(c);
  const timer = setTimeout(() => { if (p.acks.delete(m.id)) void diretoPeloServidor(p.id, m); }, DIRETO_ACK_MS);
  p.acks.set(m.id, { m, timer });
  diretoEnviar(p, { t: 'msg', id: m.id, text, createdAt: m.createdAt });
}
// A cópia direta dá lugar à do servidor (que também volta na busca, com a id dela)
async function diretoPeloServidor(id, m) {
  if (!m.text || !dm.account) return;
  const c = dmConv(id);
  try {
    const res = await window.api.razzeSendMessage(id, m.text);
    c.messages = c.messages.filter((x) => x.id !== m.id);
    if (res?.message) dmAdd(c, res.message);
    c.shown = -1;
    dmSaveConv(c);
  } catch (error) {
    if (c.el) c.el.status.textContent = 'Uma mensagem pode não ter chegado: ' + String(error?.message || 'erro desconhecido').replace(/^.*RazzeApiError: /, '');
  }
  renderDm();
}

function diretoArquivoValido(f) {
  if (!f || typeof f !== 'object' || !DIRETO_ID.test(String(f.id)) || typeof f.name !== 'string' || typeof f.mime !== 'string') return null;
  if (!Number.isInteger(f.size) || f.size < 1 || f.size > DIRETO_MAX_ARQUIVO) return null;
  return { id: f.id, name: f.name.replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'arquivo', size: f.size, mime: f.mime.slice(0, 100) };
}

async function diretoMensagem(p, data) {
  if (typeof data !== 'string') return diretoParte(p, data);
  if (data.length > 12000) return;
  let m = null;
  try { m = JSON.parse(data); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  const fid = DIRETO_ID.test(String(m.id)) ? m.id : '';
  if (!fid) return;
  if (m.t === 'msg') {
    const text = typeof m.text === 'string' ? m.text.slice(0, 2000) : '';
    const file = m.file ? diretoArquivoValido(m.file) : null;
    if ((!text.trim() && !file) || (m.file && !file)) return;
    diretoEnviar(p, { t: 'ack', id: fid });
    const createdAt = Math.min(Date.now(), Number(m.createdAt) || Date.now());
    const c = dmConv(p.id);
    await dmLoadConv(c);
    if (!dmAdd(c, { id: fid, from: p.id, text, createdAt, e2e: true, direto: true, ...(file ? { file } : {}) })) return;
    if (!dmIsOpen(p.id)) { c.unread++; dmPutInBar(p.id, false); }
    void appSounds.play('chat');
    dmSaveConv(c);
    dmSaveBar();
    renderDm();
    if (file && CHAT_IMAGE_TYPES.includes(file.mime) && file.size <= DIRETO_AUTO_IMAGEM) diretoPedir(p.id, file);
  } else if (m.t === 'ack') {
    const a = p.acks.get(fid);
    if (a) { clearTimeout(a.timer); p.acks.delete(fid); }
  } else if (m.t === 'quero') {
    const file = direto.arquivos.get(fid);
    if (!file) diretoEnviar(p, { t: 'indisponivel', id: fid });
    else void diretoMandarArquivo(p, fid, file);
  } else if (m.t === 'cancela') {
    p.enviando.delete(fid);
  } else if (m.t === 'indisponivel') {
    const dl = direto.baixando.get(fid);
    if (dl?.from === p.id) diretoArquivoFalhou(fid, 'não está mais disponível (quem mandou fechou o app)');
  } else if (m.t === 'parte') {
    const dl = direto.baixando.get(fid);
    if (!dl || dl.from !== p.id) { p.parte = ''; return; }
    if (m.n !== dl.got || !Number.isInteger(m.total) || m.total < 1 || m.total > Math.ceil(DIRETO_MAX_ARQUIVO / DIRETO_PARTE) + 1) return diretoArquivoFalhou(fid, 'o download falhou, tente de novo');
    dl.total = m.total;
    p.parte = fid;
  }
}

// ---------- Arquivos ----------
async function diretoAnexar(c, list) {
  const p = diretoAberto(c.id);
  if (!p) { c.el.status.textContent = `Arquivos só vão pela conexão direta, e ela não está ligada com ${friendName(c.id)}.`; return; }
  c.el.status.textContent = '';
  for (let file of list) {
    if (!file.size) continue;
    if (file.size > DIRETO_MAX_ARQUIVO) { toast(`${file.name} passa de 200 MB e não pode ser enviado.`, 'error'); continue; }
    const clean = await withoutMetadata(file);
    if (!clean) { toast(`Não deu para tirar os metadados de ${file.name} (arquivo fora do padrão), então ele não foi enviado. Para mandar assim mesmo, compacte num .zip.`, 'error'); continue; }
    file = clean;
    if (diretoAberto(c.id) !== p) { c.el.status.textContent = 'A conexão direta caiu: o resto não foi enviado.'; break; }
    const f = { id: diretoNovaId(), name: file.name, size: file.size, mime: file.type || '' };
    direto.arquivos.set(f.id, file);
    if (CHAT_IMAGE_TYPES.includes(f.mime) && f.size <= DIRETO_AUTO_IMAGEM) {
      window.api.dmImagemSalvar(dm.account, f.id, f.mime, new Uint8Array(await file.arrayBuffer())).catch(() => {});
    }
    const m = { id: diretoNovaId(), from: dm.account, text: '', createdAt: Date.now(), e2e: true, direto: true, file: f };
    dmAdd(c, m);
    dmSaveConv(c);
    diretoEnviar(p, { t: 'msg', id: m.id, text: '', createdAt: m.createdAt, file: f });
    renderDm();
    dmScrollEnd(c, true);
  }
}

function diretoEsperarBuffer(ch) {
  if (ch.bufferedAmount <= DIRETO_BUFFER) return Promise.resolve();
  return new Promise((resolve) => {
    const fim = () => { ch.removeEventListener('bufferedamountlow', fim); ch.removeEventListener('close', fim); resolve(); };
    ch.addEventListener('bufferedamountlow', fim);
    ch.addEventListener('close', fim);
  });
}
async function diretoMandarArquivo(p, id, file) {
  if (p.enviando.has(id)) return;
  p.enviando.add(id);
  const total = Math.max(1, Math.ceil(file.size / DIRETO_PARTE));
  for (let n = 0; n < total; n++) {
    if (!p.enviando.has(id) || diretoAberto(p.id) !== p) return;
    const buf = await file.slice(n * DIRETO_PARTE, (n + 1) * DIRETO_PARTE).arrayBuffer();
    await diretoEsperarBuffer(p.ch);
    if (!p.enviando.has(id) || diretoAberto(p.id) !== p) return;
    diretoEnviar(p, { t: 'parte', id, n, total });
    p.ch.send(buf);
  }
  p.enviando.delete(id);
}

function diretoPedir(from, f) {
  if (direto.baixando.has(f.id) || direto.prontos.has(f.id)) return;
  const p = diretoAberto(from);
  if (!p) { diretoGarantir(from); return diretoCartaoMeta(f.id, `${formatBytes(f.size)} · precisa da conexão direta com ${friendName(from)}`); }
  direto.baixando.set(f.id, { from, f, chunks: [], got: 0, bytes: 0, total: 0 });
  diretoEnviar(p, { t: 'quero', id: f.id });
  diretoCartaoEstado(f.id);
}
function diretoCancelar(id) {
  const dl = direto.baixando.get(id);
  if (!dl) return;
  direto.baixando.delete(id);
  const p = diretoAberto(dl.from);
  if (p) diretoEnviar(p, { t: 'cancela', id });
  diretoCartaoEstado(id);
}
function diretoArquivoFalhou(id, texto) {
  direto.baixando.delete(id);
  const parts = direto.cards.get(id);
  diretoCartaoEstado(id);
  if (parts?.card.isConnected) parts.meta.textContent = `${formatBytes(parts.f.size)} · ${texto}`;
}

async function diretoParte(p, buf) {
  const id = p.parte;
  p.parte = '';
  const dl = id && direto.baixando.get(id);
  if (!dl || dl.from !== p.id) return;
  if (!(buf instanceof ArrayBuffer) || buf.byteLength > DIRETO_PARTE || dl.bytes + buf.byteLength > dl.f.size) return diretoArquivoFalhou(id, 'o download falhou, tente de novo');
  dl.chunks.push(buf);
  dl.got++;
  dl.bytes += buf.byteLength;
  const parts = direto.cards.get(id);
  if (parts?.card.isConnected) {
    const pc = Math.min(100, Math.round((dl.bytes / dl.f.size) * 100));
    parts.fill.style.width = `${pc}%`;
    parts.meta.textContent = `${formatBytes(dl.bytes)} de ${formatBytes(dl.f.size)} · ${pc}%`;
  }
  if (dl.got < dl.total) return;
  direto.baixando.delete(id);
  if (dl.bytes !== dl.f.size) return diretoArquivoFalhou(id, 'chegou incompleto, tente de novo');
  const blob = new Blob(dl.chunks, { type: dl.f.mime || 'application/octet-stream' });
  direto.prontos.set(id, URL.createObjectURL(blob));
  if (CHAT_IMAGE_TYPES.includes(dl.f.mime) && dl.f.size <= DIRETO_AUTO_IMAGEM) {
    window.api.dmImagemSalvar(dm.account, id, dl.f.mime, new Uint8Array(await blob.arrayBuffer())).catch(() => {});
  }
  diretoCartaoEstado(id);
}

// Imagem guardada neste PC (a que chegou ou a que eu mandei): vira blob: uma vez e fica pronta
async function diretoImagemGuardada(f) {
  if (direto.prontos.has(f.id)) return direto.prontos.get(f.id);
  const mine = direto.arquivos.get(f.id);
  let blob = mine || null;
  if (!blob) {
    const r = await window.api.dmImagemLer(dm.account, f.id).catch(() => null);
    if (r?.bytes) blob = new Blob([r.bytes], { type: r.mime });
  }
  if (!blob) return '';
  if (!direto.prontos.has(f.id)) direto.prontos.set(f.id, URL.createObjectURL(blob));
  return direto.prontos.get(f.id);
}

// ---------- Cartão do arquivo na conversa ----------
// Os elementos da conversa são refeitos quando chega mensagem: o estado fica em direto.*, o cartão só mostra
function diretoCartao(c, m) {
  const f = m.file;
  const card = document.createElement('div');
  card.className = 'file-card';
  const row = document.createElement('div');
  row.className = 'file-row';
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  const info = document.createElement('div');
  info.className = 'file-info';
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = name.title = f.name;
  const meta = document.createElement('span');
  meta.className = 'file-meta';
  info.append(name, meta);
  row.append(icon, info);
  const bar = document.createElement('div');
  bar.className = 'file-bar';
  const fill = document.createElement('span');
  bar.append(fill);
  card.append(row, bar);
  direto.cards.set(f.id, { card, row, icon, meta, bar, fill, btn: null, img: null, f, from: m.from, conv: c.id });
  diretoCartaoEstado(f.id);
  if (CHAT_IMAGE_TYPES.includes(f.mime)) {
    diretoImagemGuardada(f).then((url) => { if (url) diretoCartaoEstado(f.id); });
  }
  return card;
}
function diretoCartaoMeta(id, texto) {
  const parts = direto.cards.get(id);
  if (parts?.card.isConnected) parts.meta.textContent = texto;
}
function diretoCartaoEstado(id) {
  const parts = direto.cards.get(id);
  if (!parts) return;
  const { f, card, row, icon, meta, bar, fill } = parts;
  const mine = parts.from === dm.account;
  const url = direto.prontos.get(id);
  const dl = direto.baixando.get(id);
  parts.btn?.remove();
  parts.btn = null;
  card.classList.remove('done', 'gone');
  bar.hidden = !dl;
  icon.innerHTML = ICON.doc;
  const botao = (texto, primario, onclick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small' + (primario ? ' primary' : '');
    b.textContent = texto;
    b.onclick = onclick;
    row.append(b);
    parts.btn = b;
  };
  if (url && CHAT_IMAGE_TYPES.includes(f.mime)) {
    diretoMostrarImagem(parts, url);
    meta.textContent = formatBytes(f.size);
  } else if (url) {
    card.classList.add('done');
    icon.innerHTML = ICON.check;
    meta.textContent = `${formatBytes(f.size)} · ${mine ? 'enviado' : 'recebido'}`;
    const a = document.createElement('a');
    a.className = 'btn small primary';
    a.href = url;
    a.download = f.name;
    a.textContent = 'Salvar';
    row.append(a);
    parts.btn = a;
  } else if (dl) {
    const pc = dl.bytes ? Math.round((dl.bytes / f.size) * 100) : 0;
    fill.style.width = `${pc}%`;
    meta.textContent = dl.bytes ? `${formatBytes(dl.bytes)} de ${formatBytes(f.size)} · ${pc}%` : `Pedindo a ${friendName(parts.from)}…`;
    botao('Cancelar', false, () => diretoCancelar(id));
  } else if (mine) {
    meta.textContent = direto.arquivos.has(id) ? `${formatBytes(f.size)} · disponível enquanto o app estiver aberto` : `${formatBytes(f.size)} · enviado`;
  } else {
    meta.textContent = formatBytes(f.size);
    botao('Baixar', true, () => diretoPedir(parts.from, f));
  }
}
function diretoMostrarImagem(parts, url) {
  if (parts.img?.isConnected) return;
  const img = document.createElement('img');
  img.src = url;
  img.alt = parts.f.name;
  img.className = 'chat-image';
  img.tabIndex = 0;
  img.setAttribute('role', 'button');
  img.setAttribute('aria-label', `Ampliar ${parts.f.name}`);
  img.title = 'Clique para ampliar';
  img.onclick = () => openImageViewer(img);
  img.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openImageViewer(img); } };
  const wrap = document.createElement('div');
  wrap.className = 'chat-image-wrap';
  wrap.append(img);
  parts.img = img;
  parts.card.classList.add('image-only');
  parts.card.insertBefore(wrap, parts.card.firstChild);
}

// ---------- Na janela da conversa: o modo e o clipe ----------
function diretoModo(id) {
  const p = direto.peers.get(id);
  if (diretoAberto(id)) return 'direto';
  if (p?.estado === 'conectando') return 'conectando';
  return 'servidor';
}
function renderDiretoJanela(c) {
  const el = c.el;
  if (!el?.modo) return;
  const modo = diretoModo(c.id);
  const nome = friendName(c.id);
  el.modo.dataset.modo = modo;
  el.modo.textContent = modo === 'direto' ? `Conexão direta com ${nome}: texto e arquivos vão direto, sem passar pelo servidor.`
    : modo === 'conectando' ? `Ligando a conexão direta com ${nome}…`
    : direto.unsupported ? 'Pelo servidor (criptografado). O servidor Razze ainda não tem a conexão direta: arquivos não vão.'
    : friendOnline(c.id) ? 'Pelo servidor (criptografado). A conexão direta não deu: arquivos não vão por enquanto.'
    : `Pelo servidor (criptografado): ${nome} está offline. Arquivos só vão com os dois online.`;
  el.attach.disabled = modo !== 'direto';
  setIcon(el.attach, 'attach', modo === 'direto' ? 'Anexar imagem ou arquivo' : 'Arquivos só pela conexão direta');
}
