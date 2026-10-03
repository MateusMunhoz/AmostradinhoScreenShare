'use strict';
// O ícone do app: a logo (três estrelas ligadas por pontilhados), o mesmo desenho da barra de título e do Início
// (index.html, .app-logo), num canvas. Usado pela janela aberta (barra de tarefas e Alt+Tab) e pelo gerar-icone.js
// (o .ico do .exe). Sempre nas cores da logo, em qualquer tema de cores (só os temas E.V.A e Arasaka têm o próprio).
// Quadro de 0 a 100. Estrelas: [cor, caminho SVG]; pontos: [x, y, raio, cor]. Cor 12, 23: a mistura das duas.
const LOGO_COLORS = { 1: '#FF6B61', 2: '#8B93FF', 3: '#22E5FA', 12: '#C57FB0', 23: '#56BCFC' };
const LOGO_STARS = [
  ['1', 'M46.17 3.83C47 10.79 50.21 14.01 57.17 14.83C50.21 15.65 47 18.87 46.17 25.83C45.34 18.87 42.13 15.65 35.17 14.83C42.13 14.01 45.34 10.79 46.17 3.83Z'],
  ['2', 'M13.83 57.5C14.65 64.46 17.87 67.67 24.83 68.5C17.87 69.33 14.65 72.54 13.83 79.5C13.01 72.54 9.79 69.33 2.83 68.5C9.79 67.67 13.01 64.46 13.83 57.5Z'],
  ['3', 'M77.83 55.5C79.31 67.95 85.05 73.69 97.5 75.17C85.05 76.65 79.31 82.39 77.83 94.84C76.35 82.39 70.61 76.65 58.16 75.17C70.61 73.69 76.35 67.95 77.83 55.5Z'],
];
const LOGO_DOTS = [[39.67, 19.83, 1, 1], [36.5, 22.67, 0.7, 1], [33.67, 25.33, 0.58, 1], [31.17, 28, 0.5, 12], [28.83, 30.67, 0.5, 12], [26.5, 33.67, 0.57, 2], [24.17, 37.33, 0.67, 2], [21.83, 41, 0.75, 2], [19.67, 45.17, 0.83, 2], [17.83, 49.5, 0.92, 2], [16.17, 54.33, 1, 2], [54, 20.33, 1.08, 1], [57.83, 23.83, 1, 1], [61.5, 27.67, 0.92, 1], [65, 31.83, 0.92, 1], [68.17, 36.33, 0.83, 1], [71, 41, 0.92, 3], [73.67, 46, 1, 3], [75.67, 51.33, 1.08, 3], [23, 73.17, 1, 2], [26.5, 74.83, 0.6, 2], [28.83, 75.67, 0.5, 2], [32, 76.67, 0.5, 2], [35.17, 77.5, 0.5, 23], [38.33, 78.33, 0.5, 23], [42, 79, 0.6, 3], [46.17, 79.5, 0.75, 3], [51, 79.67, 0.92, 3], [56.33, 79.67, 1, 3], [61.67, 79.33, 1.17, 3]];
function drawAppIcon(ctx, size) {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(size / 100, size / 100);
  for (const [c, d] of LOGO_STARS) { ctx.fillStyle = LOGO_COLORS[c]; ctx.fill(new Path2D(d)); }
  // Até 32 px os pontilhados viram borrão: ficam só as estrelas
  if (size > 32) for (const [x, y, r, c] of LOGO_DOTS) { ctx.fillStyle = LOGO_COLORS[c]; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
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
