'use strict';
// Atividade no perfil (docs/spec/primeira-entrada-e-perfil.md, fase 5): o jogo que está aberto e a música que toca no
// Spotify, lidos só quando a pessoa liga cada um em Seu perfil › Atividade. Só Windows.
// Privacidade: o jogo vem da lista de executáveis abaixo (o que não está nela não aparece, e nenhum outro nome de
// programa sai do PC); a música vem do título da janela do Spotify, só quando ele está tocando. Nada é gravado.
const { execFile } = require('node:child_process');

// executável (minúsculas) -> nome para mostrar. Quem quiser incluir um jogo acrescenta uma linha aqui.
const JOGOS = {
  'valorant-win64-shipping.exe': 'Valorant', 'cs2.exe': 'Counter-Strike 2', 'csgo.exe': 'Counter-Strike: GO',
  'league of legends.exe': 'League of Legends', 'dota2.exe': 'Dota 2', 'fortniteclient-win64-shipping.exe': 'Fortnite',
  'overwatch.exe': 'Overwatch 2', 'r5apex.exe': 'Apex Legends', 'rocketleague.exe': 'Rocket League', 'gta5.exe': 'GTA V',
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

// opcoes: { jogos: boolean, musica: boolean }. Só lê o que foi pedido.
async function lerAtividade(opcoes = {}) {
  const vazio = { jogo: '', musica: null };
  if (process.platform !== 'win32') return vazio;
  const r = { ...vazio };
  const lista = opcoes.jogos || opcoes.musica ? nomesDeProcessos(await rodar('tasklist /fo csv /nh')) : new Set();
  if (opcoes.jogos) r.jogo = jogoAberto(lista);
  if (opcoes.musica && lista.has('spotify.exe')) r.musica = musicaDoSpotify(await rodar('tasklist /v /fo csv /nh /fi "IMAGENAME eq Spotify.exe"'));
  return r;
}

module.exports = { lerAtividade, camposCsv, nomesDeProcessos, jogoAberto, musicaDoSpotify, JOGOS };
