// O que as janelas do processo principal dividem: a janela do app, o chat por cima do jogo e os modos
// (ajuste das janelas por cima do jogo e escrever no chat). Os módulos leem e mudam por aqui.
const janelas = {
  main: null,           // a janela do app
  chat: null,           // o chat por cima do jogo, quando aberto
  pipEdit: false,      // modo de ajuste: dá para arrastar e redimensionar as janelas por cima do jogo
  chatCompose: false,  // o chat por cima do jogo está com o teclado para escrever (Ctrl+Enter)
};

// Avisos para a página (janelas flutuantes, atalhos, apertar para falar)
function sendMain(msg) {
  if (janelas.main && !janelas.main.isDestroyed()) janelas.main.webContents.send('pip', msg);
}

module.exports = { janelas, sendMain };
