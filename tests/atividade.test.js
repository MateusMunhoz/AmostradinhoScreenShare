'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { camposCsv, nomesDeProcessos, jogoAberto, musicaDoSpotify, JOGOS } = require('../main/atividade');
global.load = () => '';
const { atvTexto } = require('../renderer/conta');

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
