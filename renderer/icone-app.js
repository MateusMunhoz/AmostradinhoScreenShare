'use strict';
// O ícone do app: o mesmo desenho da barra de título (duas telas, uma atrás da outra, em traço), num canvas.
// Usado pela janela aberta (barra de tarefas e Alt+Tab, na cor do tema) e pelo gerar-icone.js (o .ico do .exe).
// Mesmo caminho do SVG da barra de título, em 24 x 24: "M3 5h13v10H3zM8 19h13V9".
function drawAppIcon(ctx, size, color) {
  const s = size / 24;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = color;
  // Nos tamanhos pequenos o traço fica um pouco mais grosso, senão some na barra de tarefas
  ctx.lineWidth = (size <= 16 ? 2.6 : size <= 32 ? 2.4 : 2) * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.rect(3 * s, 5 * s, 13 * s, 10 * s);
  ctx.moveTo(8 * s, 19 * s);
  ctx.lineTo(21 * s, 19 * s);
  ctx.lineTo(21 * s, 9 * s);
  ctx.stroke();
}
if (typeof module !== 'undefined') module.exports = { drawAppIcon };
