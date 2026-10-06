'use strict';
// O ícone do app: a logo (o N de constelação do Nebula: três estrelas ligadas por pontilhados), o mesmo desenho da barra de título e do Início
// (index.html, .app-logo), num canvas. Usado pela janela aberta (barra de tarefas e Alt+Tab) e pelo gerar-icone.js
// (o .ico do .exe). Sempre nas cores da logo, em qualquer tema de cores (só os temas E.V.A e Arasaka têm o próprio).
// Quadro de 0 a 100. Estrelas: [cor, caminho SVG]; pontos: [x, y, raio, cor]. Cor 12, 23: a mistura das duas.
const LOGO_COLORS = { 1: '#FF6B61', 2: '#8B93FF', 3: '#22E5FA', 12: '#C57FB0', 13: '#91A8AE' };
const LOGO_STARS = [
  ['2', 'M19.5 73C20.18 78.7 22.8 81.33 28.5 82C22.8 82.68 20.18 85.3 19.5 91C18.83 85.3 16.2 82.68 10.5 82C16.2 81.33 18.83 78.7 19.5 73Z'],
  ['1', 'M35.5 3C36.33 9.96 39.54 13.18 46.5 14C39.54 14.83 36.33 18.04 35.5 25C34.67 18.04 31.46 14.83 24.5 14C31.46 13.18 34.67 9.96 35.5 3Z'],
  ['3', 'M71.5 67C72.63 76.5 77.01 80.88 86.5 82C77.01 83.13 72.63 87.51 71.5 97C70.38 87.51 66 83.13 56.5 82C66 80.88 70.38 76.5 71.5 67Z'],
];
const LOGO_DOTS = [[21.42, 70.12, 1.04, 2], [22.41, 64.72, 0.92, 2], [23.47, 59.34, 0.81, 2], [24.61, 53.98, 0.69, 12], [25.81, 48.63, 0.57, 12], [27.09, 43.3, 0.65, 12], [28.44, 37.99, 0.76, 1], [29.86, 32.69, 0.88, 1], [31.36, 27.41, 1, 1], [41.26, 26.79, 1.03, 1], [42.86, 30.18, 0.95, 1], [44.49, 33.56, 0.88, 1], [46.14, 36.92, 0.81, 1], [47.81, 40.27, 0.74, 1], [49.52, 43.61, 0.66, 13], [51.24, 46.93, 0.59, 13], [52.99, 50.24, 0.58, 13], [54.77, 53.54, 0.66, 13], [56.57, 56.82, 0.73, 3], [58.4, 60.09, 0.8, 3], [60.25, 63.35, 0.88, 3], [62.13, 66.59, 0.95, 3], [74.9, 64.29, 1.25, 3], [76.28, 58.03, 1.14, 3], [77.75, 51.79, 1.02, 3], [79.32, 45.57, 0.91, 3], [80.98, 39.38, 0.8, 3], [82.73, 33.21, 0.69, 3], [84.57, 27.07, 0.57, 3], [86.5, 20.94, 0.46, 3], [88.52, 14.85, 0.35, 3]];
// Até 48 px: menos pontos e maiores, senão o N vira só três estrelas soltas
const LOGO_DOTS_P = [[21.42, 70.12, 2.71, 2], [24.22, 55.76, 1.89, 12], [27.53, 41.53, 1.78, 12], [31.36, 27.41, 2.6, 1], [41.26, 26.79, 2.67, 1], [45.14, 34.9, 2.21, 1], [49.17, 42.94, 1.76, 13], [53.35, 50.9, 1.56, 13], [57.66, 58.79, 2.01, 3], [62.13, 66.59, 2.47, 3], [74.9, 64.29, 3, 3], [78.79, 47.64, 2.28, 3], [83.33, 31.16, 1.56, 3], [88.52, 14.85, 0.84, 3]];
function drawAppIcon(ctx, size) {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(size / 100, size / 100);
  for (const [c, d] of LOGO_STARS) { ctx.fillStyle = LOGO_COLORS[c]; ctx.fill(new Path2D(d)); }
  for (const [x, y, r, c] of size > 48 ? LOGO_DOTS : LOGO_DOTS_P) { ctx.fillStyle = LOGO_COLORS[c]; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
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

// Tema Top Gun: o ícone da janela vira as asas de piloto (as três listras de cada lado e a estrela), o mesmo desenho do
// --tg-wings em styles-topgun.css (quadro 100 x 60), sobre um fundo escuro para aparecer também em barra clara.
function drawTopGunIcon(ctx, size) {
  const s = size / 100;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.fillStyle = '#010402';
  ctx.beginPath(); ctx.roundRect(0, 0, size, size, size * 0.18); ctx.fill();
  ctx.translate(0, (size - 60 * s) / 2);
  ctx.scale(s, s);
  ctx.fillStyle = '#D7343E';
  ctx.fill(new Path2D('M2 18H34V24H6ZM8 28H34V34H12ZM14 38H34V44H18ZM98 18H66V24H94ZM92 28H66V34H88ZM86 38H66V44H82Z'));
  ctx.fillStyle = '#F4F6FB';
  ctx.fill(new Path2D('M50 16 53.29 25.47 63.31 25.67 55.33 31.73 58.23 41.33 50 35.6 41.77 41.33 44.67 31.73 36.69 25.67 46.71 25.47Z'));
  ctx.restore();
}
if (typeof module !== 'undefined') module.exports.drawTopGunIcon = drawTopGunIcon;
