'use strict';
// Modo gamer: o botão do controle na barrinha da direita. Ligado, o app abre mão do que pesa no PC para o jogo
// render o máximo, sem mudar as escolhas salvas (desligar devolve tudo como estava):
// - prioridade do app normal, em vez da escolhida em Transmissão (por padrão, acima do normal, que disputa com o jogo)
// - vidro opaco (sem o acrílico do Windows nem o desfoque dos painéis: applyAppTheme, configuracoes.js)
// - nenhuma animação nem transição, e o céu estrelado do fundo some (CSS :root[data-gamer="on"])
// - o céu em cima da lista da voz some (renderVoiceSky) e a luz ambiente das transmissões desliga (assistir.js)
// - o fundo do perfil em GIF fica parado no primeiro quadro (fundo-perfil.js)
// Transmitir, assistir, voz e música continuam funcionando. Fica salvo neste PC (modoGamer).
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, configuracoes.
const gamerOn = () => document.documentElement.dataset.gamer === 'on';

function setGamerMode(on, quiet = false) {
  if (on) document.documentElement.dataset.gamer = 'on'; else delete document.documentElement.dataset.gamer;
  save('modoGamer', on ? '1' : '');
  window.api.setPriority(on ? 'normal' : load('priority', 'above'));
  applyAppTheme();
  if (typeof renderVoiceSky === 'function' && state.myId) renderVoiceSky();
  if (typeof skyFocusId !== 'undefined' && skyFocusId) { skyFocusKey = ''; renderSkyProfile(); }
  renderGamerButton();
  if (!quiet) {
    toast(on ? 'Modo gamer ligado: sem animações, sem vidro e sem céu, e o app em prioridade normal. Voz e transmissões continuam.'
      : 'Modo gamer desligado: o app voltou ao visual e à prioridade de antes.');
  }
}
function renderGamerButton() {
  const b = $('navGamer'), on = gamerOn();
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Modo gamer ligado: clique para desligar' : 'Modo gamer: desliga o que pesa no PC enquanto você joga';
}
function setupGamerMode() {
  $('navGamer').onclick = () => setGamerMode(!gamerOn());
  setGamerMode(load('modoGamer', '') === '1', true);
}
