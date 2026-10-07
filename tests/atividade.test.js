'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { camposCsv, nomesDeProcessos, jogoAberto, musicaDoSpotify, musicaDoMidia, limparCapa, JOGOS, lerVdf, registroSteam, limparIdsSteam, naoEJogo } = require('../main/atividade');
const { mesmoJogo } = require('../main/atividade');
global.load = () => '';
const { atvTexto, limparAtividade, atvHa } = require('../renderer/conta');

const LISTA = [
  '"System","4","Services","0","144 K"',
  '"chrome.exe","1234","Console","1","300.000 K"',
  '"VALORANT-Win64-Shipping.exe","5678","Console","1","3.000.000 K"',
  '"Spotify.exe","900","Console","1","200.000 K"',
].join('\r\n');

test('lê o CSV do tasklist e acha o jogo da lista, sem ligar para a caixa das letras', () => {
  assert.deepEqual(camposCsv('"a","b ""c""","d"'), ['a', 'b "c"', 'd']);
  const nomes = nomesDeProcessos(LISTA);
  assert.ok(nomes.has('chrome.exe'));
  assert.equal(jogoAberto(nomes), 'Valorant');
  assert.equal(jogoAberto(nomesDeProcessos('"chrome.exe","1","Console","1","1 K"')), ''); // programa comum não aparece
  assert.equal(jogoAberto(nomesDeProcessos('"r5apex_dx12.exe","1","Console","1","1 K"')), 'Apex Legends'); // o Apex em DirectX 12
});

test('só os jogos da lista aparecem; a lista tem nome para cada executável', () => {
  for (const [exe, nome] of Object.entries(JOGOS)) {
    assert.equal(exe, exe.toLowerCase());
    assert.match(exe, /\.exe$/);
    assert.ok(nome.length > 1);
  }
});

const SPOTIFY = (titulo) => [
  '"Spotify.exe","900","Console","1","200.000 K","Unknown","MAQUINA\\eu","0:00:10","N/A"',
  '"Spotify.exe","901","Console","1","90.000 K","Unknown","MAQUINA\\eu","0:00:05","' + titulo + '"',
].join('\r\n');

test('Spotify tocando mostra artista e faixa; pausado, não mostra nada', () => {
  assert.deepEqual(musicaDoSpotify(SPOTIFY('Metallica - One')), { artista: 'Metallica', faixa: 'One' });
  assert.deepEqual(musicaDoSpotify(SPOTIFY('AC/DC - Back In Black - Remastered')), { artista: 'AC/DC', faixa: 'Back In Black - Remastered' });
  assert.equal(musicaDoSpotify(SPOTIFY('Spotify Premium')), null);
  assert.equal(musicaDoSpotify(SPOTIFY('Spotify')), null);
  assert.equal(musicaDoSpotify(SPOTIFY('Spotify Free')), null);
  assert.equal(musicaDoSpotify(SPOTIFY('N/A')), null);
  assert.equal(musicaDoSpotify(SPOTIFY('Sem separador')), null);
  assert.equal(musicaDoSpotify(''), null);
});

test('o texto da prévia junta jogo e música', () => {
  assert.equal(atvTexto('Valorant', null), 'Jogando Valorant');
  assert.equal(atvTexto('', { artista: 'Metallica', faixa: 'One' }), 'Ouvindo Metallica — One');
  assert.equal(atvTexto('Dota 2', { artista: 'A', faixa: 'B' }), 'Jogando Dota 2 · Ouvindo A — B');
  assert.equal(atvTexto('', null), '');
});

test('lê a linha do midia.exe: faixa, artista, álbum e a capa só se for JPEG pequeno', () => {
  const capa = '/9j/' + 'A'.repeat(100) + '==';
  assert.deepEqual(musicaDoMidia(JSON.stringify({ tocando: true, app: 'Spotify.exe', faixa: "When I'm Small", artista: 'Phantogram', album: 'Eyelid Movies', capa })),
    { artista: 'Phantogram', faixa: "When I'm Small", album: 'Eyelid Movies', capa: 'data:image/jpeg;base64,' + capa, pausada: false });
  assert.equal(musicaDoMidia('{"tocando":false}'), null);
  assert.equal(musicaDoMidia('{"tocando":false,"pausada":true,"faixa":"x"}').pausada, true); // pausada: vem, marcada
  assert.equal(musicaDoMidia('{"tocando":false,"pausada":"sim","faixa":"x"}'), null); // só true conta
  assert.equal(musicaDoMidia('{"tocando":true,"pausada":true,"faixa":"x"}').pausada, false); // tocando ganha
  assert.equal(musicaDoMidia('{"tocando":true,"faixa":""}'), null); // sem nome não mostra
  assert.equal(musicaDoMidia('lixo'), undefined);
  assert.equal(musicaDoMidia('{"faixa":"x"}'), undefined);
  assert.equal(musicaDoMidia(JSON.stringify({ tocando: true, faixa: 'x'.repeat(300) })).faixa.length, 80);
  assert.equal(limparCapa('iVBORw0KGgo='), ''); // PNG não
  assert.equal(limparCapa('/9j/<script>'), '');
  assert.equal(limparCapa('/9j/' + 'A'.repeat(30000)), ''); // grande demais
});

test('a atividade que chega de outro PC é limpa e limitada', () => {
  const capa = 'data:image/jpeg;base64,/9j/AAAA';
  assert.deepEqual(limparAtividade({ jogo: 'Dota 2', jogoImagem: capa, artista: 'A', faixa: 'B', album: 'C', capa }), { jogo: 'Dota 2', jogoImagem: capa, jogoDesde: 0, artista: 'A', faixa: 'B', album: 'C', capa, pausada: false });
  assert.equal(limparAtividade({ jogo: 'X', jogoImagem: 'data:image/svg+xml;base64,PHN2Zz4=' }).jogoImagem, ''); // só JPEG
  assert.equal(limparAtividade({ artista: 'A', jogoImagem: capa }).jogoImagem, ''); // sem jogo, sem imagem
  assert.equal(limparAtividade({}), null);
  assert.equal(limparAtividade({ jogo: 5, artista: ['x'] }), null);
  assert.equal(limparAtividade({ artista: 'A', capa: 'data:image/png;base64,iVBOR' }).capa, '');
  assert.equal(limparAtividade({ artista: 'A', capa: 'https://exemplo.com/capa.jpg' }).capa, ''); // nada de endereço de fora
  assert.equal(limparAtividade({ jogo: 'X', capa }).capa, ''); // sem música, sem capa
  assert.equal(limparAtividade({ jogo: 'a\u0000b\n c' }).jogo, 'a b c');
  assert.equal(limparAtividade({ jogo: 'x'.repeat(500) }).jogo.length, 80);
});

test('o jogo da lista e o da Steam são o mesmo pelo nome, sem símbolos', () => {
  assert.equal(mesmoJogo('Overwatch® 2', 'Overwatch 2'), true);
  assert.equal(mesmoJogo('Overwatch®', 'Overwatch 2'), true); // a Steam chama só de Overwatch
  assert.equal(mesmoJogo('GTA', 'GTA V'), false); // curto demais para confiar
  assert.equal(mesmoJogo('Counter-Strike 2', 'Counter Strike 2'), true);
  assert.equal(mesmoJogo('Dota 2', 'Overwatch 2'), false);
  assert.equal(mesmoJogo('', ''), false);
});

test('a música pausada passa marcada, e só com música', () => {
  assert.equal(limparAtividade({ artista: 'A', faixa: 'B', pausada: true }).pausada, true);
  assert.equal(limparAtividade({ artista: 'A', pausada: 1 }).pausada, false); // só true
  assert.equal(limparAtividade({ jogo: 'X', pausada: true }).pausada, false); // sem música, sem pausa
});

test('desde quando joga: só um instante plausível, e só com jogo', () => {
  const agora = Date.now();
  assert.equal(limparAtividade({ jogo: 'X', jogoDesde: agora - 60000 }).jogoDesde, agora - 60000);
  assert.equal(limparAtividade({ jogo: 'X', jogoDesde: agora - 49 * 3600000 }).jogoDesde, 0); // velho demais
  assert.equal(limparAtividade({ jogo: 'X', jogoDesde: agora + 3600000 }).jogoDesde, 0); // no futuro
  assert.ok(limparAtividade({ jogo: 'X', jogoDesde: agora + 60000 }).jogoDesde <= Date.now()); // relógio um pouco adiantado
  assert.equal(limparAtividade({ jogo: 'X', jogoDesde: '123' }).jogoDesde, 0);
  assert.equal(limparAtividade({ jogo: 'X', jogoDesde: 1.5 }).jogoDesde, 0);
  assert.equal(limparAtividade({ artista: 'A', jogoDesde: agora }).jogoDesde, 0); // sem jogo, sem tempo
});

test('o "há quanto tempo" do jogo', () => {
  const t = 1_000_000_000_000;
  assert.equal(atvHa(0, t), '');
  assert.equal(atvHa(t - 20000, t), 'agora há pouco');
  assert.equal(atvHa(t - 40 * 60000, t), 'há 40 min');
  assert.equal(atvHa(t - 60 * 60000, t), 'há 1 h');
  assert.equal(atvHa(t - 80 * 60000, t), 'há 1 h 20 min');
});

test('lê os arquivos da Steam: bibliotecas, manifesto e o registro', () => {
  const libs = lerVdf('"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\Program Files (x86)\\Steam"\n\t\t"apps"\n\t\t{\n\t\t\t"892970"\t\t"1"\n\t\t}\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\Jogos"\n\t}\n}');
  assert.deepEqual(Object.values(libs.libraryfolders).map((b) => b.path), ['C:\Program Files (x86)\Steam', 'D:\Jogos']);
  assert.deepEqual(lerVdf('"AppState"\n{\n\t"appid"\t\t"892970"\n\t"name"\t\t"Valheim"\n}').AppState, { appid: '892970', name: 'Valheim' });
  assert.deepEqual(lerVdf('lixo { } "a"'), {}); // quebrado não estoura
  const reg = '\r\nHKEY_CURRENT_USER\Software\Valve\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n    RunningAppID    REG_DWORD    0xd9fda\r\n';
  assert.deepEqual(registroSteam(reg), { caminho: 'c:/program files (x86)/steam', rodando: '892890' });
  assert.equal(registroSteam(reg.replace('0xd9fda', '0x0')).rodando, ''); // nada aberto
  assert.deepEqual(registroSteam(''), { caminho: '', rodando: '' });
});

test('a lista de jogos marcados que vem da página: só números, sem repetir, no máximo 500', () => {
  assert.deepEqual(limparIdsSteam(['892970', 892970, '1172470', '../x', '', null, '1'.repeat(11)]), ['892970', '1172470']);
  assert.deepEqual(limparIdsSteam('892970'), []);
  assert.equal(limparIdsSteam(Array.from({ length: 900 }, (_, i) => String(i + 1))).length, 500);
});

test('o que não é jogo na Steam fica de fora', () => {
  assert.ok(naoEJogo('228980', 'Steamworks Common Redistributables'));
  assert.ok(naoEJogo('9', 'Proton 9.0'));
  assert.ok(naoEJogo('9', 'Steam Linux Runtime 3.0 (sniper)'));
  assert.ok(!naoEJogo('892970', 'Valheim'));
});
