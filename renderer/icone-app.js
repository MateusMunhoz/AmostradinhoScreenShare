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
// Tema E.V.A: o rosto do EVA-01 no lugar das duas telas (desenho próprio, em 64 x 64: [cor, caminho SVG])
const EVA_HEAD = [
  ['#7A48B8', 'M32 0.5 L35 21 L29 21 Z'],
  ['#6B3FA0', 'M32 14 C43 14 48 22 47.5 32 L44.5 46 L37.5 61.5 L26.5 61.5 L19.5 46 L16.5 32 C16 22 21 14 32 14 Z'],
  ['#8A5CCB', 'M32 14 C40 14 44.5 19 45.5 25 L32 22 L18.5 25 C19.5 19 24 14 32 14 Z'],
  ['#1A1030', 'M20.5 30.5 L43.5 30.5 L41.5 45 L36 52 L28 52 L22.5 45 Z'],
  ['#A3F43C', 'M17.5 32.5 L21.5 32 L25.5 47 L23 53 Z'],
  ['#A3F43C', 'M46.5 32.5 L42.5 32 L38.5 47 L41 53 Z'],
  ['#F2FF6B', 'M22.5 33.5 L31 36.5 L30 38.8 L23 36.2 Z'],
  ['#F2FF6B', 'M41.5 33.5 L33 36.5 L34 38.8 L41 36.2 Z'],
  ['#A3F43C', 'M28 52 L36 52 L34.5 59.5 L29.5 59.5 Z'],
  ['#E9E2F7', 'M28.5 46.5 L35.5 46.5 L35 48.2 L29 48.2 Z'],
];
function drawEvaIcon(ctx, size) {
  ctx.clearRect(0, 0, size, size);
  ctx.save(); ctx.scale(size / 64, size / 64);
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#0B0714'; ctx.lineWidth = size <= 32 ? 2.4 : 1.5;
  const [horn, helmet] = EVA_HEAD.map(([, d]) => new Path2D(d));
  ctx.stroke(horn); ctx.stroke(helmet);
  for (const [color, d] of EVA_HEAD) { ctx.fillStyle = color; ctx.fill(new Path2D(d)); }
  ctx.restore();
}
if (typeof module !== 'undefined') module.exports = { drawAppIcon, drawEvaIcon };

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
