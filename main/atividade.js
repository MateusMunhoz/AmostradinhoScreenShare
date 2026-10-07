'use strict';
// Atividade no perfil (docs/spec/primeira-entrada-e-perfil.md, fase 5): o jogo que está aberto e a música que toca,
// lidos só quando a pessoa liga cada um em Seu perfil › Atividade. Só Windows.
// Privacidade: o jogo vem da lista de executáveis abaixo (o que não está nela não aparece, e nenhum outro nome de
// programa sai do PC); a música vem dos controles de mídia do Windows (bin/midia.exe, só players de música, com a capa)
// ou, sem ele, do título da janela do Spotify. Só quando está tocando. Nada é gravado.
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// executável (minúsculas) -> nome para mostrar. Quem quiser incluir um jogo acrescenta uma linha aqui.
const JOGOS = {
  'valorant-win64-shipping.exe': 'Valorant', 'cs2.exe': 'Counter-Strike 2', 'csgo.exe': 'Counter-Strike: GO',
  'league of legends.exe': 'League of Legends', 'dota2.exe': 'Dota 2', 'fortniteclient-win64-shipping.exe': 'Fortnite',
  'overwatch.exe': 'Overwatch 2', 'r5apex.exe': 'Apex Legends', 'r5apex_dx12.exe': 'Apex Legends', 'rocketleague.exe': 'Rocket League', 'gta5.exe': 'GTA V',
  'gta_sa.exe': 'GTA San Andreas', 'fivem.exe': 'FiveM', 'minecraft.windows.exe': 'Minecraft', 'rainbowsix.exe': 'Rainbow Six Siege',
  'rainbowsix_vulkan.exe': 'Rainbow Six Siege', 'eldenring.exe': 'Elden Ring', 'darksoulsiii.exe': 'Dark Souls III',
  'sekiro.exe': 'Sekiro', 'cyberpunk2077.exe': 'Cyberpunk 2077', 'witcher3.exe': 'The Witcher 3', 'bf6.exe': 'Battlefield 6',
  'bf2042.exe': 'Battlefield 2042', 'bfv.exe': 'Battlefield V', 'cod.exe': 'Call of Duty', 'modernwarfare.exe': 'Call of Duty: Modern Warfare',
  'blackopscoldwar.exe': 'Call of Duty: Black Ops Cold War', 'destiny2.exe': 'Destiny 2', 'wow.exe': 'World of Warcraft',
  'wowclassic.exe': 'World of Warcraft Classic', 'ffxiv_dx11.exe': 'Final Fantasy XIV', 'pathofexile.exe': 'Path of Exile',
  'pathofexile_x64.exe': 'Path of Exile', 'rustclient.exe': 'Rust', 'tslgame.exe': 'PUBG', 'escapefromtarkov.exe': 'Escape from Tarkov',
  'helldivers2.exe': 'Helldivers 2', 'palworld-win64-shipping.exe': 'Palworld', 'bg3.exe': "Baldur's Gate 3", 'bg3_dx11.exe': "Baldur's Gate 3",
  'hollow_knight.exe': 'Hollow Knight', 'terraria.exe': 'Terraria', 'stardew valley.exe': 'Stardew Valley', 'among us.exe': 'Among Us',
  'genshinimpact.exe': 'Genshin Impact', 'starrail.exe': 'Honkai: Star Rail', 'zenlesszonezero.exe': 'Zenless Zone Zero',
  'robloxplayerbeta.exe': 'Roblox', 'fallguys_client_game.exe': 'Fall Guys', 'deadbydaylight-win64-shipping.exe': 'Dead by Daylight',
  'left4dead2.exe': 'Left 4 Dead 2', 'eurotrucks2.exe': 'Euro Truck Simulator 2', 'forzahorizon5.exe': 'Forza Horizon 5',
  'fc25.exe': 'EA Sports FC 25', 'fc24.exe': 'EA Sports FC 24', 'fifa23.exe': 'FIFA 23', 'projectzomboid64.exe': 'Project Zomboid',
  '7daystodie.exe': '7 Days to Die', 'valheim.exe': 'Valheim', 'lethalcompany.exe': 'Lethal Company', 'phasmophobia.exe': 'Phasmophobia',
  'enshrouded.exe': 'Enshrouded', 'hades.exe': 'Hades', 'celeste.exe': 'Celeste', 'streetfighter6.exe': 'Street Fighter 6',
  'monsterhunterrise.exe': 'Monster Hunter Rise', 'mhw.exe': 'Monster Hunter: World', 'dayz_x64.exe': 'DayZ', 'arma3_x64.exe': 'Arma 3',
  'marvel-win64-shipping.exe': 'Marvel Rivals', 'deltaforceclient-win64-shipping.exe': 'Delta Force', 'warframe.x64.exe': 'Warframe',
  'brawlhalla.exe': 'Brawlhalla', 'tekken8.exe': 'Tekken 8', 'hogwartslegacy.exe': 'Hogwarts Legacy', 'rdr2.exe': 'Red Dead Redemption 2',
  'tlou-i.exe': 'The Last of Us Part I', 'spider-man.exe': "Marvel's Spider-Man", 'nms.exe': "No Man's Sky", 'subnautica.exe': 'Subnautica',
};

// Linha CSV do tasklist -> campos. As aspas duplas envolvem cada campo.
function camposCsv(linha) {
  const out = [];
  const re = /"((?:[^"]|"")*)"/g;
  let m;
  while ((m = re.exec(linha))) out.push(m[1].replace(/""/g, '"'));
  return out;
}

// Saída de `tasklist /fo csv /nh` -> conjunto de nomes de processo em minúsculas
function nomesDeProcessos(saida) {
  const nomes = new Set();
  for (const linha of String(saida || '').split(/\r?\n/)) {
    const nome = camposCsv(linha)[0];
    if (nome) nomes.add(nome.toLowerCase());
  }
  return nomes;
}

// O primeiro jogo conhecido que está aberto ('' se nenhum)
function jogoAberto(nomes) {
  for (const exe of Object.keys(JOGOS)) if (nomes.has(exe)) return JOGOS[exe];
  return '';
}

// Saída de `tasklist /v /fo csv /nh` do Spotify: o título da janela é a 9ª coluna. Tocando, é "Artista - Faixa";
// pausado ou parado, é só "Spotify" (ou "Spotify Free/Premium"). Devolve { artista, faixa } ou null.
function musicaDoSpotify(saida) {
  for (const linha of String(saida || '').split(/\r?\n/)) {
    const c = camposCsv(linha);
    const titulo = (c[8] || '').trim();
    if (!titulo || /^n\/?[ad]$/i.test(titulo) || /^spotify( (free|premium))?$/i.test(titulo)) continue;
    const corte = titulo.indexOf(' - ');
    if (corte <= 0) continue; // sem "Artista - Faixa": é outra janela do Spotify
    return { artista: titulo.slice(0, corte).trim().slice(0, 80), faixa: titulo.slice(corte + 3).trim().slice(0, 80) };
  }
  return null;
}

// utf-8 na saída (chcp 65001), senão os acentos dos títulos chegam quebrados. O comando vai entre aspas e sem o escape do
// Node (windowsVerbatimArguments): com /s o cmd tira só as aspas de fora e as do filtro do tasklist ficam como estão
const rodar = (comando) => new Promise((resolve) => {
  execFile('cmd.exe', ['/d', '/s', '/c', `"chcp 65001>nul & ${comando}"`], { windowsHide: true, windowsVerbatimArguments: true, timeout: 8000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (erro, saida) => resolve(erro ? '' : saida));
});

// ---------- A música pelos controles de mídia do Windows (native/midia.cpp) ----------
// O midia.exe fica aberto só enquanto a música está ligada: dorme até o Windows avisar que a faixa mudou e escreve uma
// linha JSON. Aqui fica a última; a página lê a cada 30 s (lerAtividade). Sem ele (apagado, Windows antigo, caiu três
// vezes), volta ao título da janela do Spotify.
const CAPA_MAX = 28000; // base64 de um JPEG 96x96 (o midia.exe já recusa acima de 20 KB)

// A capa como data: URL, só se for mesmo JPEG em base64 e pequeno; senão ''
function limparCapa(b64) {
  if (typeof b64 !== 'string' || !b64 || b64.length > CAPA_MAX || !/^\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(b64)) return '';
  return 'data:image/jpeg;base64,' + b64;
}

// Uma linha do midia.exe -> { artista, faixa, album, capa, pausada }, null (nada tocando) ou undefined (linha estranha)
function musicaDoMidia(linha) {
  let o;
  try { o = JSON.parse(linha); } catch { return undefined; }
  if (!o || typeof o !== 'object' || typeof o.tocando !== 'boolean') return undefined;
  const pausada = !o.tocando && o.pausada === true; // pausada: o perfil mostra parada, por até 3 min (MIDIA_PAUSA_MS)
  if (!o.tocando && !pausada) return null;
  const t = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : '');
  const faixa = t(o.faixa);
  if (!faixa) return null;
  return { artista: t(o.artista), faixa, album: t(o.album), capa: limparCapa(o.capa), pausada };
}

const midia = { proc: null, atual: null, pronto: false, quedas: 0, esperando: [], aoMudar: null, pausadaEm: 0 };
// Pausada há mais que isso: some, como se nada tocasse (quem pausou de manhã não fica "Pausada" o dia todo)
const MIDIA_PAUSA_MS = 3 * 60 * 1000;
// A música como os outros veem agora: a pausada só nos primeiros 3 min
function musicaAgora(agora = Date.now()) {
  const m = midia.atual;
  return m && m.pausada && agora - midia.pausadaEm > MIDIA_PAUSA_MS ? null : m;
}
// Quem quer saber na hora que a música mudou (main.js avisa a janela); o midia.exe só escreve quando muda
function aoMudarMusica(fn) { midia.aoMudar = typeof fn === 'function' ? fn : null; }
function caminhoMidia() {
  const local = path.join(__dirname, '..', 'bin', 'midia.exe'); // npm run dev e atualização
  if (fs.existsSync(local) || !process.resourcesPath) return local;
  return path.join(process.resourcesPath, 'bin', 'midia.exe'); // no .exe, fora do .asar
}
function midiaPronta() { for (const f of midia.esperando.splice(0)) f(); }
function iniciarMidia() {
  if (midia.proc || midia.quedas >= 3) return;
  const exe = caminhoMidia();
  if (!fs.existsSync(exe)) { midia.quedas = 3; return; }
  let proc;
  try { proc = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); } catch { midia.quedas = 3; return; }
  midia.proc = proc;
  midia.pronto = false;
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    if (buf.length > 256 * 1024) buf = ''; // linha sem fim: joga fora
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const r = musicaDoMidia(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (r === undefined) continue;
      // conta os 3 min desde que esta faixa pausou (outra faixa pausada, ou a mesma depois de tocar, conta de novo)
      if (r?.pausada && !(midia.atual?.pausada && midia.atual.faixa === r.faixa && midia.atual.artista === r.artista)) midia.pausadaEm = Date.now();
      midia.atual = r;
      midia.pronto = true;
      midiaPronta();
      try { midia.aoMudar?.(r); } catch { /* a janela fechou */ }
    }
  });
  proc.on('error', () => { midia.quedas = 3; });
  proc.on('exit', () => {
    if (midia.proc !== proc) return;
    midia.proc = null; midia.atual = null; midia.pronto = false; midia.quedas++;
    midiaPronta();
  });
}
function pararMidia() {
  const proc = midia.proc;
  if (!proc) return;
  midia.proc = null; midia.atual = null; midia.pronto = false;
  try { proc.stdin.end(); proc.kill(); } catch { /* já saiu */ }
  midiaPronta();
}
// { ok: true, musica } quando o midia.exe respondeu (esperando até 2 s na primeira vez); { ok: false } para usar o Spotify
async function musicaPeloWindows() {
  iniciarMidia();
  if (midia.proc && !midia.pronto) await new Promise((resolve) => { midia.esperando.push(resolve); setTimeout(resolve, 2000); });
  return midia.proc && midia.pronto ? { ok: true, musica: musicaAgora() } : { ok: false };
}

// ---------- Jogos da Steam ----------
// Os jogos instalados vêm dos arquivos da própria Steam (libraryfolders.vdf e appmanifest_*.acf); o que está aberto, do
// registro (HKCU\Software\Valve\Steam › RunningAppID, que a Steam grava quando abre um jogo). Só aparece o jogo que a
// pessoa marcou em Configurações › Atividade: a página manda a lista dos marcados a cada leitura (opcoes.steam).
// A imagem vem do cache da biblioteca da Steam neste PC (appcache/librarycache): nada é baixado.
const STEAM_MAX = 500;
// Coisas da Steam que não são jogos (redistribuíveis, Proton, runtimes do Linux, SteamVR)
const STEAM_NAO_JOGOS = new Set(['228980', '250820', '1070560', '1391110', '1628350', '1493710', '961940', '1054830', '1113280',
  '1245040', '1420170', '1580130', '1887720', '2180100', '2230260', '2348590', '2805730', '1826330', '1161040', '3658110']);
const naoEJogo = (id, nome) => STEAM_NAO_JOGOS.has(id) || /^(proton|steam linux runtime|steamworks|steamvr)\b/i.test(nome);

// VDF de texto da Steam -> objeto: chaves e valores entre aspas, blocos entre { }
function lerVdf(texto) {
  const raiz = {};
  const pilha = [raiz];
  let chave = null;
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let m;
  while ((m = re.exec(String(texto || '')))) {
    const atual = pilha[pilha.length - 1];
    if (m[2] === '{') {
      const o = {};
      if (chave !== null) atual[chave] = o;
      pilha.push(o);
      chave = null;
    } else if (m[2] === '}') {
      if (pilha.length > 1) pilha.pop();
      chave = null;
    } else {
      const v = m[1].replace(/\\(.)/g, '$1');
      if (chave === null) chave = v;
      else { atual[chave] = v; chave = null; }
    }
  }
  return raiz;
}

// A lista de jogos marcados que vem da página: só números, sem repetir, no máximo STEAM_MAX
function limparIdsSteam(lista) {
  if (!Array.isArray(lista)) return [];
  const ids = new Set();
  for (const x of lista.slice(0, STEAM_MAX)) { const id = String(x); if (/^\d{1,10}$/.test(id)) ids.add(id); }
  return [...ids];
}

// Saída de `reg query HKCU\Software\Valve\Steam` -> { caminho, rodando } (rodando: o número do jogo aberto, '' se nenhum)
function registroSteam(saida) {
  const caminho = /^\s*SteamPath\s+REG_SZ\s+(.+?)\s*$/im.exec(saida || '')?.[1] || '';
  const hex = /^\s*RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)\s*$/im.exec(saida || '')?.[1];
  const n = hex ? parseInt(hex, 16) : 0;
  return { caminho, rodando: n > 0 ? String(n) : '' };
}
const lerRegistroSteam = () => new Promise((resolve) => {
  execFile('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam'], { windowsHide: true, timeout: 5000, encoding: 'utf8' },
    (erro, saida) => resolve(registroSteam(erro ? '' : saida)));
});

// A imagem do jogo, quadrada, 96x96, JPEG em data: URL ('' se não tem). A capa da biblioteca (em pé) é cortada no alto,
// onde ficam a arte e o nome; o banner, no meio; o ícone pequeno (32x32) é o último recurso.
let nativeImage;
function imagemQuadrada(arquivo, noAlto) {
  if (nativeImage === undefined) { try { const e = require('electron'); nativeImage = typeof e === 'object' ? e.nativeImage : null; } catch { nativeImage = null; } }
  if (!nativeImage) return '';
  try {
    const img = nativeImage.createFromPath(arquivo);
    if (img.isEmpty()) return '';
    const { width: w, height: h } = img.getSize();
    const l = Math.min(w, h);
    const q = img.crop({ x: Math.floor((w - l) / 2), y: noAlto ? 0 : Math.floor((h - l) / 2), width: l, height: l }).resize({ width: 96, height: 96, quality: 'good' });
    const jpg = q.toJPEG(80);
    return jpg.length && jpg.length <= 20000 ? 'data:image/jpeg;base64,' + jpg.toString('base64') : '';
  } catch {
    return '';
  }
}
async function imagemDoJogo(raiz, id) {
  const cache = path.join(raiz, 'appcache', 'librarycache');
  const achados = {}; // nome do arquivo -> caminho
  const pasta = path.join(cache, id);
  try {
    for (const e of await fs.promises.readdir(pasta, { withFileTypes: true })) {
      if (e.isFile()) { if (/\.jpg$/i.test(e.name)) achados.icone = path.join(pasta, e.name); continue; } // o ícone fica solto, com nome de hash
      if (!e.isDirectory()) continue;
      for (const f of await fs.promises.readdir(path.join(pasta, e.name))) achados[f.toLowerCase()] = path.join(pasta, e.name, f);
    }
  } catch { // Steam antiga: tudo solto na pasta, com o número na frente
    for (const [nome, arq] of [['library_600x900.jpg', `${id}_library_600x900.jpg`], ['header.jpg', `${id}_header.jpg`], ['icone', `${id}_icon.jpg`]]) {
      if (fs.existsSync(path.join(cache, arq))) achados[nome] = path.join(cache, arq);
    }
  }
  const capa = achados['library_capsule.jpg'] || achados['library_600x900.jpg'];
  const banner = achados['library_header.jpg'] || achados['header.jpg'];
  return (capa && imagemQuadrada(capa, true)) || (banner && imagemQuadrada(banner, false)) || (achados.icone && imagemQuadrada(achados.icone, false)) || '';
}

const steam = { caminho: '', jogos: new Map(), lidoEm: 0 }; // id -> { id, nome, imagem }
// Os jogos instalados em todas as bibliotecas, com nome e imagem (a imagem de cada um é feita uma vez só)
async function jogosDaSteam({ recarregar = false } = {}) {
  if (process.platform !== 'win32') return [];
  const ordem = () => [...steam.jogos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  if (!recarregar && steam.lidoEm && Date.now() - steam.lidoEm < 60 * 1000) return ordem();
  const { caminho } = await lerRegistroSteam();
  if (!caminho) return [];
  const raiz = path.normalize(caminho);
  const bibliotecas = new Set([raiz]);
  try {
    const vdf = lerVdf(await fs.promises.readFile(path.join(raiz, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
    for (const b of Object.values(vdf.libraryfolders || {})) if (b && typeof b.path === 'string') bibliotecas.add(path.normalize(b.path));
  } catch { /* só a pasta da Steam */ }
  const achados = new Map();
  for (const lib of bibliotecas) {
    let nomes = [];
    try { nomes = await fs.promises.readdir(path.join(lib, 'steamapps')); } catch { continue; }
    for (const n of nomes) {
      if (!/^appmanifest_\d+\.acf$/i.test(n) || achados.size >= STEAM_MAX) continue;
      try {
        const app = lerVdf(await fs.promises.readFile(path.join(lib, 'steamapps', n), 'utf8')).AppState || {};
        const id = String(app.appid || ''), nome = String(app.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (/^\d{1,10}$/.test(id) && nome && !naoEJogo(id, nome)) achados.set(id, nome);
      } catch { /* manifesto quebrado: pula */ }
    }
  }
  if (raiz !== steam.caminho) steam.jogos.clear();
  steam.caminho = raiz;
  for (const id of [...steam.jogos.keys()]) if (!achados.has(id)) steam.jogos.delete(id);
  for (const [id, nome] of achados) {
    const antes = steam.jogos.get(id);
    steam.jogos.set(id, { id, nome, imagem: antes ? antes.imagem : await imagemDoJogo(raiz, id) });
  }
  steam.lidoEm = Date.now();
  return ordem();
}

// O jogo da Steam aberto agora, se a pessoa marcou: { nome, imagem } ou null
async function jogoDaSteamAberto(permitidos) {
  if (!permitidos.length) return null;
  const { rodando } = await lerRegistroSteam();
  if (!rodando || !permitidos.includes(rodando)) return null;
  if (!steam.jogos.has(rodando)) await jogosDaSteam({ recarregar: true });
  const j = steam.jogos.get(rodando);
  return j ? { nome: j.nome, imagem: j.imagem } : null;
}

// O jogo veio da lista de executáveis (JOGOS), mas a Steam está rodando esse mesmo jogo: usa a imagem dela. O nome já
// aparece de qualquer jeito, então a imagem não mostra nada a mais (marcar na Steam continua decidindo o resto)
const nomeComparavel = (n) => String(n || '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
// Um nome começando com o outro também vale ("Overwatch®" na Steam, "Overwatch 2" na lista): a Steam já disse que é
// esse jogo que está rodando, o nome só confere que não é outro
function mesmoJogo(a, b) {
  const x = nomeComparavel(a), y = nomeComparavel(b);
  return x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x));
}
let steamSemJogo = ''; // o número que a Steam diz estar rodando e não achamos instalado (não procura de novo a cada leitura)
async function imagemDaSteamPara(nome) {
  const { rodando } = await lerRegistroSteam();
  if (!rodando || rodando === steamSemJogo) return '';
  if (!steam.jogos.has(rodando)) await jogosDaSteam({ recarregar: true });
  const j = steam.jogos.get(rodando);
  if (!j) { steamSemJogo = rodando; return ''; }
  return mesmoJogo(j.nome, nome) ? j.imagem : '';
}

// opcoes: { jogos: boolean, musica: boolean, steam: ids marcados }. Só lê o que foi pedido.
async function lerAtividade(opcoes = {}) {
  const vazio = { jogo: '', jogoImagem: '', musica: null };
  if (process.platform !== 'win32') return vazio;
  if (!opcoes.musica) pararMidia(); // desligou a música: o midia.exe fecha
  const r = { ...vazio };
  const windows = opcoes.musica ? await musicaPeloWindows() : { ok: false };
  const daSteam = opcoes.jogos ? await jogoDaSteamAberto(limparIdsSteam(opcoes.steam)) : null;
  if (daSteam) { r.jogo = daSteam.nome; r.jogoImagem = daSteam.imagem; }
  const lista = (opcoes.jogos && !daSteam) || (opcoes.musica && !windows.ok) ? nomesDeProcessos(await rodar('tasklist /fo csv /nh')) : new Set();
  if (opcoes.jogos && !daSteam) r.jogo = jogoAberto(lista);
  if (r.jogo && !r.jogoImagem) r.jogoImagem = await imagemDaSteamPara(r.jogo);
  if (windows.ok) r.musica = windows.musica;
  else if (opcoes.musica && lista.has('spotify.exe')) r.musica = musicaDoSpotify(await rodar('tasklist /v /fo csv /nh /fi "IMAGENAME eq Spotify.exe"'));
  return r;
}

module.exports = {
  lerAtividade, pararMidia, aoMudarMusica, jogosDaSteam, limparIdsSteam, lerVdf, registroSteam, naoEJogo, mesmoJogo,
  camposCsv, nomesDeProcessos, jogoAberto, musicaDoSpotify, musicaDoMidia, limparCapa, JOGOS,
};
