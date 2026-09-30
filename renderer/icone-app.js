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
// Tema E.V.A: o rosto do EVA-01 no lugar das duas telas. Desenho próprio em 64 x 64 ([cor, caminho SVG]), fundo
// transparente; também vira o .ico do build E.V.A (gerar-icone.js > tela-p2p-eva.ico)
const evaMirror = d => d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `${64 - x} ${y}`); // espelha na vertical do meio
const EVA_HEAD = [
  ['#4E2A80', 'M9 29 L19 21 L24 33 L22 46 L14 51 L7 44 Z'],                       // aba lateral esquerda
  ['#4E2A80', evaMirror('M9 29 L19 21 L24 33 L22 46 L14 51 L7 44 Z')],
  ['#7443B5', 'M32 9 L44 15 L50.5 28 L46 44 L38 50 L32 52 L26 50 L18 44 L13.5 28 L20 15 Z'], // capacete
  ['#9366D8', 'M32 9 L44 15 L50 27 L37 21 Z'],                                     // brilho do alto
  ['#3A1F66', 'M19 29 L30 33 L32 39 L34 33 L45 29 L45 32.5 L34.5 36.5 L32 44 L29.5 36.5 L19 32.5 Z'], // sobrancelha
  ['#F5E663', 'M21.5 34.5 L29 37.2 L28 39.4 L22 36.8 Z'],                          // olhos
  ['#F5E663', evaMirror('M21.5 34.5 L29 37.2 L28 39.4 L22 36.8 Z')],
  ['#A3F43C', 'M16.5 43.5 L23 46.5 L22 50 L14.5 47 Z'],                            // verde do maxilar
  ['#A3F43C', evaMirror('M16.5 43.5 L23 46.5 L22 50 L14.5 47 Z')],
  ['#7F8FE6', 'M24 48 L32 52 L40 48 L38.5 56 L33.5 60.5 L30.5 60.5 L25.5 56 Z'],  // maxilar
  ['#A3F43C', 'M31 58 L33 58 L32.6 62.5 L31.4 62.5 Z'],                            // ponta do queixo
  ['#241440', 'M31 1.5 L33 1.5 L33 42 L32 46 L31 42 Z'],                           // chifre
  ['#A3F43C', 'M31.35 35 L32.65 35 L32.4 40 L31.6 40 Z'],                          // verde no chifre
];
function drawEvaIcon(ctx, size) {
  ctx.clearRect(0, 0, size, size);
  ctx.save(); ctx.scale(size / 64, size / 64);
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#120820'; ctx.lineWidth = size <= 24 ? 3 : size <= 48 ? 2.2 : 1.4;
  const paths = EVA_HEAD.map(([color, d]) => [color, new Path2D(d)]);
  for (const [, p] of paths) ctx.stroke(p); // contorno por baixo de tudo: separa a cabeça de qualquer fundo
  for (const [color, p] of paths) { ctx.fillStyle = color; ctx.fill(p); }
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
