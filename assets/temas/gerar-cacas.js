'use strict';
// Os caças do tema Top Gun vistos de cima (styles-topgun.css › --tg-jet, no fim do letreiro em pé do Início).
// Comprimento = 100 unidades (nariz em y=0); metade direita, espelhada. Medidas reais: F-14A 19,1 m x 19,5 m (asa a ~35°), F-22 18,9 x 13,6, F/A-18F 18,3 x 13,6,
// F-35C 15,7 x 13,1, F-16 15,1 x 10,0. Gira 180° (o letreiro é girado). Imprime as linhas --tg-jet para colar no CSS:
//   node assets/temas/gerar-cacas.js
const J = {
  f14: {
    body: [[0, 0], [1.6, 6], [3, 13], [3.6, 19], [4, 27], [5, 31], [19, 55], [50, 77], [49, 85], [17, 72], [13, 74], [13, 80], [28, 93], [28, 98], [13, 99], [12.5, 103], [6.5, 103], [6, 97], [3, 97], [1.5, 102], [0, 102]],
    canopy: [0, 25, 1.9, 8.5],
    lines: ['M6.5 44V97', 'M9 72 11 95'],
  },
  f22: {
    body: [[0, 0], [2.4, 8], [4.4, 16], [5.8, 26], [9.5, 30], [10, 38], [10.5, 41], [36, 66], [35.5, 71], [14, 77.6], [12.5, 78], [12.5, 80], [23, 92], [22.5, 96], [11, 101], [9, 102], [3, 102], [2, 99], [0, 99]],
    canopy: [0, 20, 2.2, 9],
    lines: ['M9 66 14 77 14 92 9 90Z', 'M9.5 30 8.5 52'],
  },
  f18: {
    body: [[0, 0], [1.8, 7], [3, 14], [3.6, 20], [4.5, 26], [7, 34], [10, 41], [11.5, 46], [35, 58.5], [35, 64], [12.5, 70], [12, 70], [11.5, 78], [25, 88], [25, 92], [11, 96], [8.5, 100], [3.5, 100], [2.5, 97], [0, 97]],
    canopy: [0, 22, 2, 10.5],
    lines: ['M7.5 62 11 70 11 88 7.5 86Z', 'M36.5 55V66'],
  },
  f35: {
    body: [[0, 0], [2, 6], [3.6, 12], [4.8, 18], [6, 24], [10, 30], [11, 38], [11.5, 40], [41.5, 60], [40.5, 67], [14, 73], [13, 74], [13, 77], [29, 88], [29, 92], [11, 96], [6, 96], [4, 103], [0, 103]],
    canopy: [0, 19, 2.3, 9],
    lines: ['M7.5 62 12 72 12 88 7.5 86Z', 'M10 30 8 46'],
  },
  f16: {
    body: [[0, 0], [1.6, 7], [2.6, 14], [3.4, 22], [4, 30], [6.5, 42], [8.5, 50], [31, 69], [31, 76], [8.5, 76], [8, 77], [8, 80], [20, 90], [20, 94], [7.5, 96], [4.2, 100], [0, 100]],
    canopy: [0, 21, 2, 9],
    lines: ['M32.5 64V79', 'M0 70V97'],
  },
};
function svg(j, { color = '%2339FF6A', rotate = true, size = [88, 92] } = {}) {
  const right = j.body, left = right.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  const d = 'M' + [...right, ...left].map(([x, y]) => `${x} ${y}`).join(' L') + 'Z';
  const lines = j.lines.flatMap((l) => (/^M0 /.test(l) ? [l] : [l, mirrorPath(l)])).join('');
  const [cx, cy, rx, ry] = j.canopy;
  const g = `<g ${rotate ? "transform='rotate(180 0 51)' " : ''}fill='none' stroke='${color}' stroke-width='1.5' stroke-linejoin='round'><path d='${d}' fill='${color}' fill-opacity='.1'/><ellipse cx='${cx}' cy='${cy}' rx='${rx}' ry='${ry}'/><path d='${lines}' stroke-opacity='.75' stroke-width='1.1'/></g>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size[0]}' height='${size[1]}' viewBox='-56 -3 112 108'>${g}</svg>`;
}
// Espelha um caminho simples (M, L implícito, V, Z): troca o sinal de cada x
function mirrorPath(p) {
  return p.replace(/([MLZ ]?)(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, c, x, y) => `${c}${-x} ${y}`);
}
for (const [k, j] of Object.entries(J)) console.log(`${k}: url("data:image/svg+xml,${svg(j)}")`);
