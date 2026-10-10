'use strict';
// Atualizações: pela sala, pelo GitHub e o aviso na tela.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, sala.

// ---------- Novidades ----------
// O cartão do Início com as mensagens dos commits de cada versão (lista NOVIDADES, de renderer/novidades.js,
// que o publicar.js gera). "Chat: a; b" vira a etiqueta "Chat" com uma linha para "a" e outra para "b".
function newsParts(msg) {
  const m = /^([^:;]{2,24}):\s+(.+)$/.exec(msg);
  const lines = (m ? m[2] : msg).split(/;\s+/).filter(Boolean).map((t) => t[0].toUpperCase() + t.slice(1));
  return { tag: m ? m[1] : '', lines };
}

function newsDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }) : '';
}

function newsItems(n) {
  const ul = document.createElement('ul');
  ul.className = 'news-items';
  for (const msg of n.items) {
    const { tag, lines } = newsParts(msg);
    const li = document.createElement('li');
    const chip = document.createElement('span');
    chip.className = tag ? 'news-tag' : 'news-tag empty';
    chip.textContent = tag;
    const text = document.createElement('div');
    text.className = 'news-lines';
    for (const t of lines) {
      const p = document.createElement('p');
      p.textContent = t;
      text.append(p);
    }
    li.append(chip, text);
    ul.append(li);
  }
  return ul;
}

// A versão atual aberta em cima; as anteriores numa linha do tempo, cada uma abre ao clicar
function renderNews() {
  const mine = update.myVersion;
  const list = (typeof NOVIDADES === 'undefined' ? [] : NOVIDADES).filter((n) => !newerVersion(n.version, mine));
  const current = list[0]?.version === mine ? list[0] : null;
  $('homeNewsTitle').textContent = current ? 'Novidades desta versão' : 'Novidades';
  $('homeNewsSub').textContent = current ? [`Versão ${mine}`, newsDate(current.date)].filter(Boolean).join(' · ') : `Você está na versão ${mine}`;
  const box = $('homeNewsList');
  box.textContent = '';
  if (current) box.append(newsItems(current));
  const older = list.filter((n) => n !== current);
  if (!older.length) return;
  const h = document.createElement('h3');
  h.className = 'news-older-title';
  h.textContent = 'Versões anteriores';
  const ol = document.createElement('ol');
  ol.className = 'news-timeline';
  for (const n of older) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'news-version';
    btn.setAttribute('aria-expanded', 'false');
    const v = document.createElement('strong');
    v.textContent = n.version;
    const meta = document.createElement('span');
    meta.textContent = [newsDate(n.date), `${n.items.length} ${n.items.length === 1 ? 'mudança' : 'mudanças'}`].filter(Boolean).join(' · ');
    btn.innerHTML = ICON.chevron;
    btn.prepend(v, meta);
    const items = newsItems(n);
    items.hidden = true;
    btn.onclick = () => {
      items.hidden = !items.hidden;
      btn.setAttribute('aria-expanded', String(!items.hidden));
    };
    li.append(btn, items);
    ol.append(li);
  }
  box.append(h, ol);
}

function setNewsOpen(open) {
  if (open) renderNews();
  $('homeNews').hidden = !open;
  $('showNews').setAttribute('aria-expanded', String(open));
  if (!open && update.myVersion) save('novidadesVistas', update.myVersion);
}

// Depois de atualizar, o cartão "Novo na versão" aparece no pé da coluna de amigos (docs/spec/inicio-novo.md), com o
// primeiro item; fica até fechar ou abrir a lista inteira, e não volta até a próxima versão
function showNewsIfNew() {
  const v = update.myVersion;
  const n = typeof NOVIDADES === 'undefined' ? null : NOVIDADES.find((x) => x.version === v);
  if (!n || !n.items.length || load('novidadesVistas') === v) return;
  const { tag, lines } = newsParts(n.items[0]);
  $('homeNovoTitulo').textContent = `Novo na ${v}`;
  $('homeNovoTexto').textContent = (tag ? `${tag}: ` : '') + lines.join(' ') + (n.items.length > 1 ? ` (e mais ${n.items.length - 1})` : '');
  $('homeNovo').hidden = false;
}
function fecharNovo() {
  $('homeNovo').hidden = true;
  if (update.myVersion) save('novidadesVistas', update.myVersion);
}

// ---------- Atualizações pela sala ----------
// true se a versão a for mais nova que b ("1.2.10" > "1.2.9")
function newerVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// Procura na sala alguém com versão mais nova que a minha (e que a já baixada) e pede o pacote
function checkUpdates() {
  if (update.busy || !state.ws || !update.myVersion) return;
  const base = update.ready || update.myVersion;
  let best = null;
  for (const [id, m] of state.members) {
    if (!m.version || !newerVersion(m.version, base) || update.tried.has(`${id}@${m.version}`)) continue;
    if (!best || newerVersion(m.version, best.version)) best = { id, version: m.version };
  }
  if (!best) return;
  update.tried.add(`${best.id}@${best.version}`);
  update.busy = { from: best.id, version: best.version, parts: [], total: 0, sig: '', timer: setTimeout(cancelDownload, 60000) };
  sendSignal(best.id, { side: 'update', want: best.version });
}

function cancelDownload() {
  if (!update.busy) return;
  clearTimeout(update.busy.timer);
  update.busy = null;
  checkUpdates(); // tenta outra pessoa, se houver
}

async function sendUpdate(to, want) {
  const pack = want === update.myVersion && !update.sending.has(to) ? await window.api.getOwnPack() : null;
  if (!pack) return sendSignal(to, { side: 'update', unavailable: true });
  update.sending.add(to);
  const CHUNK = 48 * 1024;
  const total = Math.ceil(pack.pack.length / CHUNK);
  for (let part = 0; part < total && state.members.has(to); part++) {
    const msg = { side: 'update', version: want, part, total, data: pack.pack.slice(part * CHUNK, (part + 1) * CHUNK) };
    if (part === 0) msg.sig = pack.sig;
    sendSignal(to, msg);
    await waitRoomBuffer();
  }
  update.sending.delete(to);
}

async function onUpdateSignal(from, data) {
  if (data.want) return sendUpdate(from, String(data.want));
  const b = update.busy;
  if (!b || b.from !== from) return;
  if (data.unavailable) return cancelDownload();
  if (data.version !== b.version || !Number.isInteger(data.part) || !Number.isInteger(data.total)
      || data.total < 1 || data.total > 300 || data.part >= data.total || typeof data.data !== 'string') return;
  if (data.sig) b.sig = data.sig;
  b.total = data.total;
  b.parts[data.part] = data.data;
  if (b.parts.filter((p) => p !== undefined).length < b.total) return;

  clearTimeout(b.timer);
  update.busy = null;
  // O processo principal confere a assinatura antes de guardar qualquer coisa
  const res = await window.api.installUpdate(b.parts.join(''), b.sig);
  if (res.ok) {
    update.ready = res.version;
    renderUpdateBanner();
  } else {
    console.warn(`Atualização de ${nameOf(from)} recusada:`, res.error);
  }
  checkUpdates();
}

// ---------- Atualizações pelo GitHub ----------
// Procura a última versão publicada; se for mais nova, mostra o botão na tela inicial
async function checkGithub(manual = false) {
  const link = $('checkUpdates');
  link.disabled = true;
  link.textContent = 'Procurando…';
  const res = await window.api.githubCheck();
  link.disabled = false;
  link.textContent = 'Procurar atualização';
  if (!res.ok) {
    if (manual) toast(`Não deu para ver o GitHub: ${res.error}`, 'error');
    return;
  }
  const rel = res.release;
  if (!rel || !newerVersion(rel.version, update.ready || update.myVersion)) {
    update.github = null;
    renderUpdateBanner();
    if (manual) toast(update.ready ? `A versão ${update.ready} já está baixada. Reinicie para usar.` : 'Você já está na versão mais nova.');
    return;
  }
  if (update.github?.version !== rel.version) update.exePage = '';
  update.github = rel;
  if (manual) update.dismissed = '';
  renderUpdateBanner();
}

// ---------- Aviso de atualização (docs/spec/inicio-novo.md) ----------
// Sem cartão flutuante (não cobre o jogo nem a transmissão): no Início, o botão "Nova versão" no topo e o
// "1.2.3 disponível" no rodapé; nas outras telas, o mesmo botão na barra da direita (navUpdate), que leva ao Início.
// Os dois abrem o painel: um botão faz tudo, baixa do GitHub (se ainda não veio pela sala) e reinicia o app já na
// versão nova. "Depois" esconde o botão até a próxima versão (o rodapé continua dizendo que tem).
function updateMode() {
  if (update.ready) return { mode: 'ready', version: update.ready };
  if (update.github) return { mode: update.exePage ? 'exe' : 'github', version: update.github.version };
  return null;
}

// O nome ficou de antes (todo lugar que sabe de versão nova chama este): agora desenha o botão, o rodapé e o painel
function renderUpdateBanner() {
  const m = updateMode();
  const mostrar = !!m && (update.dismissed !== m.version || update.installing);
  $('homeVersaoNova').hidden = !mostrar;
  $('navUpdate').hidden = !mostrar || !$('home').hidden;
  $('navUpdate').title = m ? `Versão ${m.version}: ver e atualizar` : '';
  const estado = $('homeVersaoEstado');
  estado.textContent = m ? `${m.version} ${m.mode === 'ready' ? 'pronta' : 'disponível'}` : 'atualizado';
  estado.classList.toggle('nova', !!m);
  estado.disabled = !m;
  if (!m) setVersaoPainelOpen(false);
  else if (!$('homeVersaoPainel').hidden) renderVersaoPainel();
}

function renderVersaoPainel() {
  const m = updateMode();
  if (!m) return;
  if (update.installing) return; // baixando ou reiniciando: o texto é o do runUpdate
  const leaves = state.myId ? ' Você sai da sala e o app abre de novo sozinho.' : ' O app fecha e abre de novo sozinho.';
  $('hvKicker').textContent = m.mode === 'ready' ? 'Nova versão pronta' : 'Nova versão disponível';
  $('hvTitulo').textContent = `Nebula ${m.version}`;
  $('hvSub').textContent = `Você está na ${update.myVersion}`;
  // As novidades da versão nova só chegam com ela (renderer/novidades.js vem no pacote): o link leva à página dela
  const box = $('hvNovidades');
  box.textContent = '';
  const page = update.github?.page;
  if (page) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'link-btn';
    link.textContent = 'Ver o que mudou no GitHub';
    link.onclick = () => window.api.openGithub(page);
    box.append(link);
  }
  box.hidden = !page;
  $('hvAviso').textContent = m.mode === 'ready' ? `Já está baixada.${leaves}`
    : m.mode === 'github' ? `Baixa em poucos segundos e atualiza.${leaves}`
    : `Esta versão precisa do ${window.api.platform === 'linux' ? 'AppImage' : '.exe'} novo. Baixe na página do GitHub e abra no lugar do antigo.`;
  $('hvGo').textContent = m.mode === 'exe' ? 'Abrir no GitHub' : 'Atualizar e reiniciar';
  $('hvGo').disabled = false;
  $('hvDepois').hidden = false;
}

function setVersaoPainelOpen(open) {
  if (open && !updateMode()) return;
  if (open) { setRedeMenuOpen(false); renderVersaoPainel(); }
  $('homeVersaoPainel').hidden = !open;
  $('homeVersaoNova').setAttribute('aria-expanded', String(open));
  if (open) $('hvGo').focus();
}

async function runUpdate() {
  const m = updateMode();
  if (!m) return;
  if (m.mode === 'exe') return window.api.openGithub(update.exePage);
  const go = $('hvGo');
  update.installing = true;
  $('hvDepois').hidden = true;
  if (m.mode === 'github') {
    setBusy(go, true, 'Baixando…');
    $('hvAviso').textContent = 'Baixando a versão nova do GitHub…';
    const res = await window.api.githubInstall();
    if (!res.ok) {
      update.installing = false;
      setBusy(go, false, 'Atualizar e reiniciar');
      if (res.page && /exe novo|pacote de atualização/.test(res.error)) {
        // Mudou algo que só um .exe novo traz (ex.: versão do Electron): manda para a página da versão
        update.exePage = res.page;
      } else {
        toast(`Não deu para atualizar: ${res.error}`, 'error');
      }
      renderUpdateBanner();
      return renderVersaoPainel();
    }
    update.ready = res.version;
  }
  setBusy(go, true, 'Reiniciando…');
  $('hvAviso').textContent = 'Abrindo a versão nova…';
  window.api.restartApp();
}
