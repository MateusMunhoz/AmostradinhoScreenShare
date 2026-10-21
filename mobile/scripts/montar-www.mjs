// Monta mobile/www: a interface do desktop como ela é, mais a ponte (window.api do iPhone). Roda no Windows, no Linux e no
// macOS (CI). O index.html e os arquivos do desktop NÃO mudam: o que muda existe só na cópia em www/.
//   node mobile/scripts/montar-www.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_PADRAO = path.resolve(AQUI, '..', '..');
const SAIDA_PADRAO = path.resolve(AQUI, '..', 'www');

// Pastas copiadas inteiras (o renderer, o vendor e os assets são carregados por caminho, inclusive os worklets de áudio);
// fora delas só o que o desktop usa para gerar arquivos, nunca em tempo de execução
const PASTAS = ['renderer', 'vendor', 'assets'];
const NAO_COPIAR = /\.(py|md|txt)$|(^|[\\/])gerar-[^\\/]*\.js$/i;
// Arquivos soltos que o index.html não lista mas o app carrega por caminho (addModule)
const EXTRAS = ['pcm-worklet.js'];
// Só do iPhone (não existe no desktop): vai para a raiz do www e é carregado por último, para vencer o styles.css
const ESTILO_IOS = 'estilos/styles-ios.css';

// O que o index.html carrega por <script src> ou <link href> local (a mesma ideia de .github/scripts/conferir-pacote.js)
export function arquivosDoIndex(html) {
  return [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^":]+)"/g)].map((m) => m[1]);
}

// Só na cópia: o <html> sabe que é iOS, a ponte vem antes do primeiro script, e a CSP deixa o app falar com a sala (ws/wss)
// e com a RazzeAPI (https). Todo o resto da CSP fica como no desktop.
export function transformarHtml(html) {
  const csp = /(connect-src\s+)ws: wss:(\s*;)/;
  if (!csp.test(html)) throw new Error('A CSP do index.html mudou: confira o connect-src em mobile/scripts/montar-www.mjs');
  let out = html.replace(csp, '$1ws: wss: https:$2');
  if (!/<html\b[^>]*data-plataforma/.test(out)) out = out.replace(/<html\b/, '<html data-plataforma="ios"');
  // O CSS do iPhone depois do último <link rel="stylesheet">
  const links = [...out.matchAll(/<link\s+rel="stylesheet"[^>]*>/g)];
  if (!links.length) throw new Error('O index.html não tem <link rel="stylesheet">.');
  const ultimo = links.at(-1), fim = ultimo.index + ultimo[0].length;
  out = `${out.slice(0, fim)}\n  <link rel="stylesheet" href="styles-ios.css">${out.slice(fim)}`;
  const primeiro = out.search(/<script\s+src=/);
  if (primeiro < 0) throw new Error('O index.html não tem <script src>.');
  out = out.slice(0, primeiro) + '<script src="ponte.js"></script>\n  ' + out.slice(primeiro);
  // O iPhone precisa do viewport do aparelho (e da área segura, para a barra de baixo e o notch)
  if (!/<meta\s+name="viewport"/.test(out)) {
    const meta = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
    out = /<meta\s+charset=[^>]*>/.test(out) ? out.replace(/(<meta\s+charset=[^>]*>)/, `$1\n  ${meta}`) : out.replace(/<head>/, `<head>\n  ${meta}`);
  }
  return out;
}

function copiarPasta(origem, destino) {
  let n = 0;
  for (const item of fs.readdirSync(origem, { withFileTypes: true })) {
    const de = path.join(origem, item.name), para = path.join(destino, item.name);
    if (item.isDirectory()) { n += copiarPasta(de, para); continue; }
    if (NAO_COPIAR.test(de)) continue;
    fs.mkdirSync(destino, { recursive: true });
    fs.copyFileSync(de, para);
    n++;
  }
  return n;
}

// iOS 16.4 é o mínimo (OffscreenCanvas 2D, das fotos) e a versão do app é a do desktop. Só reescreve o que está diferente,
// então rodar de novo não suja o Git.
export function ajustarProjetoIos(versao, pbxproj = path.resolve(AQUI, '..', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj')) {
  if (!fs.existsSync(pbxproj)) return false;
  const antes = fs.readFileSync(pbxproj, 'utf8');
  const depois = antes
    .replace(/IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 16.4;')
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${versao};`);
  if (depois !== antes) fs.writeFileSync(pbxproj, depois);
  return depois !== antes;
}

export async function montar({ raiz = RAIZ_PADRAO, saida = SAIDA_PADRAO } = {}) {
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  const versao = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version;
  fs.rmSync(saida, { recursive: true, force: true });
  fs.mkdirSync(saida, { recursive: true });

  const soltos = [...new Set([...arquivosDoIndex(html), ...EXTRAS])].filter((f) => !PASTAS.some((p) => f.startsWith(p + '/')));
  const faltando = soltos.filter((f) => !fs.existsSync(path.join(raiz, f)));
  if (faltando.length) throw new Error(`O index.html carrega arquivos que não existem: ${faltando.join(', ')}`);
  for (const f of soltos) {
    fs.mkdirSync(path.dirname(path.join(saida, f)), { recursive: true });
    fs.copyFileSync(path.join(raiz, f), path.join(saida, f));
  }
  let copiados = soltos.length;
  for (const p of PASTAS) copiados += copiarPasta(path.join(raiz, p), path.join(saida, p));

  fs.copyFileSync(path.join(AQUI, '..', ESTILO_IOS), path.join(saida, 'styles-ios.css'));
  fs.writeFileSync(path.join(saida, 'index.html'), transformarHtml(html));
  await build({
    entryPoints: [path.join(AQUI, '..', 'ponte', 'index.js')],
    outfile: path.join(saida, 'ponte.js'),
    bundle: true,
    format: 'iife',
    target: 'safari16',
    define: { __VERSAO__: JSON.stringify(versao) },
    logLevel: 'warning',
  });
  if (saida === SAIDA_PADRAO) ajustarProjetoIos(versao);
  return { saida, versao, arquivos: copiados + 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = await montar();
  console.log(`OK: ${r.arquivos} arquivos em ${path.relative(process.cwd(), r.saida) || r.saida} (versão ${r.versao}).`);
}
