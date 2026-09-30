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

// Tema Arasaka: o ícone da janela vira o emblema da corporação (anel, três esferas e o tronco), em 100 x 100.
// O mesmo desenho está em styles-arasaka.css (máscara da barra de título e do saguão).
function drawArasakaIcon(ctx, size, color) {
  const s = size / 100;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(s, s);
  ctx.fillStyle = ctx.strokeStyle = color;
  for (const [x, y, r] of [[50, 27, 11], [29, 43, 10], [71, 43, 10]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.lineWidth = size <= 32 ? 10 : 8;
  ctx.beginPath(); ctx.arc(50, 50, 43, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 9;
  ctx.stroke(new Path2D('M50 36V84M50 64 33 50M50 64 67 50'));
  ctx.restore();
}
if (typeof module !== 'undefined') module.exports.drawArasakaIcon = drawArasakaIcon;
