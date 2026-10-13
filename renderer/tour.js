'use strict';
// Passo a passo guiado (docs/spec/tour-entrar-na-sala.md): escurece a janela, acende o botão do passo e avança quando a
// pessoa faz a ação de verdade. Os alvos são os elementos de sempre do app; renomear um deles quebra o roteiro (o e2e
// tests/e2e/tour.js pega). Fase 1: "Entrar com código e senha" e "Criar sala e chamar os amigos".
// Script clássico: só declara; quem liga é renderer/inicio.js (setupTour). Usa: util ($, show, toast), estado (state),
// conectividade (selectedNetworkProvider), inicio (setJoinOpen), chamada (novaSenhaSala), sala (leaveRoom).

const TOUR_EXEMPLO = { codigo: 'ABC234', senha: 'pizza-azul-marte' };
const tour = { id: '', i: 0, timer: 0, ultimoRect: '', sumiuDesde: 0, final: null, redeInicial: true };

// O primeiro elemento visível com esse texto (para botões sem id fixo, como o "Entrar na voz" do Seu sinal)
function tourPorTexto(texto, raiz = document) {
  return [...raiz.querySelectorAll('button')].find((b) => b.textContent.trim() === texto && b.getClientRects().length && !b.closest('#tour')) || null;
}
const tourVisivel = (el) => !!el && el.getClientRects().length > 0;
const tourNaInternet = () => selectedNetworkProvider() === 'internet';

const ROTEIROS = {
  codigo: {
    titulo: 'Entrar com código e senha',
    resumo: 'Sem conta: com o código e a senha que o host te passou.',
    passos: [
      {
        alvo: () => $('homeRede'),
        antes: () => { if ($('home').hidden) show('home'); tour.redeInicial = tourNaInternet(); },
        titulo: () => tour.redeInicial ? 'A rede está em Internet' : 'Escolha a rede Internet',
        texto: () => tour.redeInicial
          ? 'O botão Rede, no topo do Início, diz como os PCs se conectam. Para salas pela internet ele precisa mostrar Internet, e o seu já mostra.'
          : 'O botão Rede, no topo do Início, diz como os PCs se conectam. Clique nele e escolha Internet: o passo segue sozinho.',
        botao: () => (tour.redeInicial ? 'Entendi' : ''),
        esperar: () => !tour.redeInicial && tourNaInternet(),
      },
      {
        alvo: () => ($('joinPanel').hidden ? $('goJoin') : $('joinPanel')),
        antes: () => { if (typeof setRedeMenuOpen === 'function') setRedeMenuOpen(false); },
        titulo: 'Entrar numa sala',
        texto: 'Esse cartão abre os campos do código e da senha. Funciona para qualquer pessoa, com ou sem conta.',
        // Numa sala, o Entrar perguntaria se quer sair dela: no passo a passo só abre os campos
        interceptar: () => (state.myId ? () => setJoinOpen(true) : null),
        esperar: () => !$('joinPanel').hidden,
      },
      {
        alvo: () => [$('roomAddr').closest('.field'), $('joinPassword').closest('.field')],
        titulo: 'Código e senha',
        texto: 'Digite o código da sala (6 letras e números) e a senha que o host te passou. Sem um código agora? Use o exemplo para ensaiar.',
        extra: { rotulo: 'Preencher exemplo', acao: () => { $('roomAddr').value = TOUR_EXEMPLO.codigo; $('joinPassword').value = TOUR_EXEMPLO.senha; } },
        esperar: () => $('roomAddr').value.trim().length >= 4 && $('joinPassword').value.length >= 4,
      },
      {
        alvo: () => $('joinBtn'),
        titulo: () => tourEnsaio() ? 'Entrar (ensaio)' : 'Entrar',
        texto: () => tourEnsaio()
          ? 'Com o código de exemplo, este clique não entra em sala nenhuma: é só o ensaio. Com um código de verdade, aqui você entraria na sala.'
          : 'Clique para entrar. O app mostra "Entrando na sala…" até a sala abrir. Senha errada não entra: ele avisa e você tenta de novo.',
        interceptar: () => (tourEnsaio() ? () => {
          $('roomAddr').value = $('joinPassword').value = '';
          setJoinOpen(false);
          tourTerminar('Pronto, você ensaiou', 'Com um código e uma senha de verdade, o Entrar abre a sala. Lá dentro, Entrar na voz liga o microfone.');
        } : null),
        esperar: () => !!state.myId && !$('room').hidden,
      },
      {
        alvo: () => tourPorTexto('Entrar na voz'),
        titulo: 'Você está na sala',
        texto: 'Para conversar, entre na voz. Para mostrar a sua tela, Transmitir tela, logo embaixo.',
        botao: 'Concluir',
        aoClicarAlvo: true,
      },
    ],
  },
  host: {
    titulo: 'Criar sala e chamar os amigos',
    resumo: 'Para o host: a senha, quem pode entrar e como convidar.',
    passos: [
      {
        alvo: () => $('goCreate'),
        antes: () => { if ($('home').hidden && $('create-room').hidden) show('home'); },
        titulo: 'Opções da sala',
        texto: 'Criar sala abre a sala na hora, com uma senha gerada. Para escolher a senha e quem pode entrar, use Opções da sala.',
        esperar: () => !$('create-room').hidden,
      },
      {
        alvo: () => $('roomPassword').closest('.field'),
        titulo: () => tourNaInternet() ? 'A senha (obrigatória)' : 'A senha',
        texto: () => tourNaInternet()
          ? 'Pela internet a sala precisa de senha, com pelo menos 4 caracteres. Quem tiver o código e a senha entra. Digite uma ou gere uma.'
          : 'Na sua rede a senha é opcional, mas recomendada. Digite uma ou gere uma.',
        extra: { rotulo: 'Gerar uma senha', acao: () => { $('roomPassword').type = 'text'; $('roomPassword').value = novaSenhaSala(); } },
        esperar: () => $('roomPassword').value.length >= 4,
      },
      {
        alvo: () => [$('roomVisibleLine'), ...(tourVisivel($('roomAmigosMembrosLine')) ? [$('roomAmigosMembrosLine')] : [])],
        titulo: 'Quem pode entrar sem senha',
        texto: () => tourNaInternet()
          ? '"Mostrar esta sala para meus amigos" põe a sala na lista dos seus amigos, que entram com um clique. "Amigos de quem estiver na sala" deixa entrar também os amigos de quem já está dentro, gente que você pode não conhecer. Desmarque se quiser só os seus amigos.'
          : '"Mostrar esta sala para quem está na rede" faz a sala aparecer para os outros da rede. A senha continua sendo pedida.',
        botao: 'Entendi',
      },
      {
        alvo: () => $('createBtn'),
        titulo: 'Criar a sala',
        texto: 'Isso abre uma sala de verdade. Ela fecha quando todo mundo sair, e no fim do passo a passo dá para encerrar.',
        esperar: () => !!state.myId && !$('room').hidden,
      },
      {
        alvo: () => $('roomMenuBtn'),
        titulo: 'O menu da sala',
        texto: 'O nome da sala, no alto do painel, abre o que o host precisa: o código, a senha e quem pode entrar.',
        esperar: () => !$('roomMenu').hidden,
      },
      {
        alvo: () => $('roomMenu'),
        titulo: 'Código, senha e a porta dos amigos',
        texto: () => 'Copiar copia o código; mande junto com a senha (o olho mostra, Mudar troca). '
          + (tourVisivel($('roomAmigosAberta')) ? 'A caixinha "Amigos de quem está na sala podem entrar" liga e desliga a qualquer hora. ' : '')
          + 'Mudar a senha não tira quem já está, mas os convites sem senha param de valer.',
        botao: 'Entendi',
        depois: () => { if (!$('roomMenu').hidden) $('roomMenuBtn').click(); },
      },
      {
        alvo: () => $('dockAddr'),
        titulo: 'Chamar a galera',
        texto: () => 'Convidar, na barrinha da direita, copia o código da sala para você mandar por onde quiser. '
          + (typeof razzeUser !== 'undefined' && razzeUser
            ? 'Com amigos no Nebula, também dá para usar Convidar na aba Amigos do envelope: o convite chega nas mensagens e eles entram com um clique.'
            : 'Com uma conta (Perfil › Conta), seus amigos veem a sala na lista e entram com um clique.'),
        aoClicarAlvo: true,
        botao: 'Pular',
      },
    ],
    // No fim: ficar ou encerrar a sala que o roteiro criou
    final: () => ({
      titulo: 'Sua sala está aberta',
      texto: 'Quem tiver o código e a senha entra, e os seus amigos a veem na lista. Quer ficar nela ou encerrar a sala de teste?',
      botoes: [
        { rotulo: 'Encerrar a sala de teste', acao: () => { if (state.myId) leaveRoom(); } },
        { rotulo: 'Ficar na sala', principal: true },
      ],
    }),
  },
};

const tourEnsaio = () => $('roomAddr').value.trim().toUpperCase() === TOUR_EXEMPLO.codigo;
const tourPassoAtual = () => ROTEIROS[tour.id]?.passos[tour.i] || null;
const tourValor = (v) => (typeof v === 'function' ? v() : v);

function iniciarTour(id) {
  if (!ROTEIROS[id]) return;
  setTourLista(false);
  tour.id = id;
  tour.final = null;
  $('tour').hidden = false;
  document.body.classList.add('tour-ligado');
  tourIr(0);
  clearInterval(tour.timer);
  tour.timer = setInterval(tourAtualizar, 150); // acompanha o alvo (rolagem, resize, painel que abre) e espera a ação
}

function tourIr(i) {
  tourPassoAtual()?.depois?.();
  const passos = ROTEIROS[tour.id].passos;
  if (i >= passos.length) {
    const f = ROTEIROS[tour.id].final?.();
    return f ? tourTerminar(f.titulo, f.texto, f.botoes) : tourTerminar('Pronto', 'Você chegou ao fim do passo a passo.');
  }
  tour.i = i;
  tour.ultimoRect = '';
  tour.sumiuDesde = 0;
  const p = passos[i];
  p.antes?.();
  tourDesenharBalao();
  tourAtualizar();
  setTimeout(() => { const el = tourAlvos()[0]; if (el && !el.contains(document.activeElement)) (el.matches('button, input') ? el : el.querySelector('button, input') || $('tourBalao'))?.focus(); }, 0);
}

function tourAlvos() {
  const p = tourPassoAtual();
  if (!p) return [];
  return [].concat(tourValor(p.alvo) || []).filter(tourVisivel);
}

// O balão: título, texto, o passo, e os botões (o "Entendi"/extra do passo, Voltar e Sair)
function tourDesenharBalao() {
  const p = tourPassoAtual();
  const r = ROTEIROS[tour.id];
  $('tourNum').textContent = `${r.titulo} · passo ${tour.i + 1} de ${r.passos.length}`;
  $('tourTitulo').textContent = tourValor(p.titulo);
  $('tourTexto').textContent = tourValor(p.texto);
  const acoes = [];
  if (p.extra) acoes.push(tourBotao(p.extra.rotulo, () => { p.extra.acao(); tourAtualizar(); }));
  const ok = tourValor(p.botao);
  if (ok) acoes.push(tourBotao(ok, () => tourIr(tour.i + 1), true));
  $('tourAcoes').replaceChildren(...acoes);
  $('tourVoltar').hidden = tour.i === 0;
  $('tourSair').textContent = 'Sair do passo a passo';
  $('tourSair').hidden = false;
}
function tourBotao(rotulo, acao, principal = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small' + (principal ? ' primary' : '');
  b.textContent = rotulo;
  b.onclick = acao;
  return b;
}

// A cada 150 ms: pausa por baixo de uma confirmação ou do "Entrando na sala…", acompanha o alvo e confere a ação
function tourAtualizar() {
  if (!tour.id || tour.final) return;
  const pausado = !!document.querySelector('.modal.app-confirm') || !$('entradaCarregando').hidden;
  $('tour').classList.toggle('pausado', pausado);
  if (pausado) return;
  const p = tourPassoAtual();
  if (p.esperar && p.esperar()) return tourIr(tour.i + 1);
  const alvos = tourAlvos();
  if (!alvos.length) {
    tour.sumiuDesde ||= Date.now();
    if (Date.now() - tour.sumiuDesde > 1500) tourPerdido();
    return;
  }
  tour.sumiuDesde = 0;
  const rs = alvos.map((el) => el.getBoundingClientRect());
  const pad = 6;
  const box = {
    x: Math.max(0, Math.min(...rs.map((r) => r.left)) - pad), y: Math.max(0, Math.min(...rs.map((r) => r.top)) - pad),
    r: Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + pad), b: Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + pad),
  };
  const chave = [box.x, box.y, box.r, box.b, innerWidth, innerHeight].map(Math.round).join(',');
  if (chave === tour.ultimoRect) return;
  tour.ultimoRect = chave;
  // A camada pode não começar no canto da janela (a barra de título do app fica por cima): posição relativa a ela
  const o = $('tour').getBoundingClientRect();
  const t = $('tour').style;
  t.setProperty('--tx', (box.x - o.left) + 'px'); t.setProperty('--ty', (box.y - o.top) + 'px');
  t.setProperty('--tw', (box.r - box.x) + 'px'); t.setProperty('--th', (box.b - box.y) + 'px');
  tourPosicionarBalao(box);
}

// O balão embaixo do alvo; sem espaço, em cima; sem espaço nos dois, ao lado. Nunca sai da janela.
function tourPosicionarBalao(box) {
  const b = $('tourBalao');
  const w = b.offsetWidth, h = b.offsetHeight, m = 12;
  let x = Math.min(Math.max(m, box.x), innerWidth - w - m);
  let y;
  if (box.b + m + h <= innerHeight - m) y = box.b + m;
  else if (box.y - m - h >= m) y = box.y - m - h;
  else {
    y = Math.min(Math.max(m, box.y), innerHeight - h - m);
    x = box.r + m + w <= innerWidth - m ? box.r + m : Math.max(m, box.x - m - w);
  }
  const o = $('tour').getBoundingClientRect();
  b.style.setProperty('--bx', Math.round(x - o.left) + 'px');
  b.style.setProperty('--by', Math.round(y - o.top) + 'px');
}

function tourPerdido() {
  tourTerminar('Esse passo saiu da tela', 'O botão do passo sumiu (a tela mudou ou a conexão caiu). Dá para recomeçar o passo a passo do início.', [
    { rotulo: 'Sair' },
    { rotulo: 'Recomeçar', principal: true, acao: () => iniciarTour(tour.id) },
  ]);
}

// O balão sozinho no meio da tela, sem alvo: o fim (ou o motivo de ter parado)
function tourTerminar(titulo, texto, botoes = [{ rotulo: 'Fechar', principal: true }]) {
  const id = tour.id;
  tourPassoAtual()?.depois?.();
  tour.final = { titulo };
  $('tour').classList.add('final');
  $('tour').classList.remove('pausado');
  $('tourNum').textContent = ROTEIROS[id]?.titulo || 'Passo a passo';
  $('tourTitulo').textContent = titulo;
  $('tourTexto').textContent = texto;
  $('tourVoltar').hidden = true;
  $('tourSair').hidden = true;
  $('tourAcoes').replaceChildren(...botoes.map((b) => tourBotao(b.rotulo, () => { sairDoTour(); b.acao?.(); }, b.principal)));
  const box = $('tourBalao');
  const o = $('tour').getBoundingClientRect();
  box.style.setProperty('--bx', Math.round((o.width - box.offsetWidth) / 2) + 'px');
  box.style.setProperty('--by', Math.round((o.height - box.offsetHeight) / 2) + 'px');
  $('tourAcoes').lastElementChild?.focus();
}

function sairDoTour() {
  if (!tour.id) return;
  clearInterval(tour.timer);
  if (!tour.final) tourPassoAtual()?.depois?.();
  tour.id = '';
  tour.final = null;
  $('tour').hidden = true;
  $('tour').classList.remove('final', 'pausado');
  document.body.classList.remove('tour-ligado');
}

// Clique no alvo: o passo segue depois que o próprio app tratou o clique. "interceptar" troca o clique por outra coisa
// (ensaio, ou abrir os campos sem sair da sala). Clique fora do alvo não chega no app (as faixas escuras pegam).
function tourClique(e) {
  if (!tour.id || tour.final || $('tour').classList.contains('pausado')) return;
  const p = tourPassoAtual();
  const alvo = tourAlvos().find((el) => el.contains(e.target));
  if (!alvo) return;
  const troca = p.interceptar?.();
  if (troca) {
    e.preventDefault();
    e.stopImmediatePropagation();
    troca();
    return;
  }
  if (p.aoClicarAlvo && alvo.matches('button')) setTimeout(() => { if (tour.id && tourPassoAtual() === p) tourIr(tour.i + 1); }, 0);
}

function setTourLista(open) {
  $('tourLista').hidden = !open;
  $('tourAbrir').setAttribute('aria-expanded', String(open));
  if (open) $('tourLista').querySelector('button')?.focus();
}

function setupTour() {
  $('tourLista').replaceChildren(...Object.entries(ROTEIROS).map(([id, r]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tour-roteiro';
    const t = document.createElement('strong');
    t.textContent = r.titulo;
    const s = document.createElement('small');
    s.textContent = `${r.resumo} ${r.passos.length} passos.`;
    b.append(t, s);
    b.onclick = () => iniciarTour(id);
    return b;
  }));
  $('tourAbrir').onclick = () => setTourLista($('tourLista').hidden);
  document.addEventListener('pointerdown', (e) => { if (!$('tourLista').hidden && !e.target.closest('.tour-abrir-wrap')) setTourLista(false); });
  $('tourLista').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setTourLista(false); $('tourAbrir').focus(); } });
  $('tourVoltar').onclick = () => { if (tour.i > 0) tourIr(tour.i - 1); };
  $('tourSair').onclick = sairDoTour;
  document.addEventListener('click', tourClique, true);
  // Esc sai do passo a passo (e não fecha mais nada por baixo); com uma confirmação aberta, o Esc é dela
  document.addEventListener('keydown', (e) => {
    if (!tour.id || e.key !== 'Escape' || document.querySelector('.modal.app-confirm')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    sairDoTour();
  }, true);
  for (const lado of $('tour').querySelectorAll('.tour-sombra')) lado.addEventListener('mousedown', (e) => e.preventDefault());
}

if (typeof module !== 'undefined') module.exports = { ROTEIROS };
