const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../renderer/comando-voz-regras');

const pessoas = [
  { id: '1', name: 'Mateus' }, { id: '2', name: 'Guilherme' }, { id: '3', name: 'Ana' }, { id: '4', name: 'João Pedro' },
  { id: '5', name: 'Thalita' },
];
const ctx = { pessoas, subsalas: [{ id: '1' }, { id: '2' }] };
const ok = (texto) => R.interpretar(texto, ctx);

test('assistir alguém: variações do jeito de falar', () => {
  for (const f of ['Assistir o Mateus', 'abre a live do Mateus.', 'Ver a tela do Matheus', 'mostra a transmissão do mateus']) {
    assert.deepEqual(ok(f), { ok: true, acao: 'assistir', id: '1' }, f);
  }
  assert.equal(ok('assistir a Talita').id, '5'); // Thalita, sem o h
  assert.equal(ok('abre a live do Gui').id, '2'); // apelido pelo começo do nome
  assert.equal(ok('assistir o João Pedro').id, '4');
  // Nome partido pelo Whisper (ouvido de verdade no teste de ponta a ponta)
  assert.deepEqual(ok('Coloca uma teus na janela flutuante no canto esquerdo de cima.'), { ok: true, acao: 'flutuante', id: '1', canto: 'tl' });
  assert.equal(ok('abre a live do Guil herme').id, '2');
});

test('janela flutuante: canto pedido, abrir e tirar', () => {
  assert.deepEqual(ok('Abre a live do Mateus na janela flutuante no canto esquerdo de cima'), { ok: true, acao: 'flutuante', id: '1', canto: 'tl' });
  assert.equal(ok('coloca a Ana na janela flutuante no canto direito de baixo').canto, 'br');
  assert.equal(ok('Guilherme na janela flutuante no canto inferior esquerdo').canto, 'bl');
  assert.equal(ok('Guilherme na janela flutuante, canto direito').canto, 'tr');
  assert.equal(ok('Guilherme na janela flutuante').canto, null);
  assert.deepEqual(ok('Tirar a Ana da janela flutuante.'), { ok: true, acao: 'tirar-flutuante', id: '3' });
});

test('parar de assistir alguém ou todo mundo', () => {
  assert.deepEqual(ok('Pará de assistir o Guilherme.'), { ok: true, acao: 'parar', id: '2' }); // como o Whisper escreveu
  assert.deepEqual(ok('fechar a live da Ana'), { ok: true, acao: 'parar', id: '3' });
  assert.deepEqual(ok('fecha todas'), { ok: true, acao: 'parar-todos' });
  assert.deepEqual(ok('parar de assistir todo mundo'), { ok: true, acao: 'parar-todos' });
});

test('como o Whisper escreve as palavras curtas (ouvido nos testes com ruído e fala rápida)', () => {
  for (const f of ['Facha todas as lives.', 'Fesha todas as lives.', 'Fecha toda as lives.']) assert.deepEqual(ok(f), { ok: true, acao: 'parar-todos' }, f);
  for (const f of ['Saida a col.', 'Sai da col.', 'Sai da cola.']) assert.deepEqual(ok(f), { ok: true, acao: 'voz-sair' }, f);
  assert.deepEqual(ok('Vai para a subsalatriz.'), { ok: false, motivo: 'subsala', numero: '3' }); // a sala de teste tem 1 e 2
  assert.deepEqual(R.interpretar('Vai para a subsalatriz.', { subsalas: [{ id: '3' }] }), { ok: true, acao: 'canal', ch: '3' });
  assert.deepEqual(ok('Tiram, Ana, da janela flutuante.'), { ok: true, acao: 'tirar-flutuante', id: '3' });
  assert.deepEqual(ok('Fara de assistir o Guilherme.'), { ok: true, acao: 'parar', id: '2' });
});

test('voz, microfone e canal', () => {
  assert.deepEqual(ok('Entrar na voz.'), { ok: true, acao: 'voz-entrar' });
  assert.deepEqual(ok('sair da call'), { ok: true, acao: 'voz-sair' });
  assert.deepEqual(ok('desligar o microfone'), { ok: true, acao: 'mic-off' });
  assert.deepEqual(ok('mutar'), { ok: true, acao: 'mic-off' });
  assert.deepEqual(ok('ligar o microfone'), { ok: true, acao: 'mic-on' });
  assert.deepEqual(ok('desmuta'), { ok: true, acao: 'mic-on' });
  assert.deepEqual(ok('ir para a subçala 2.'), { ok: true, acao: 'canal', ch: '2' }); // como o Whisper escreveu
  assert.deepEqual(ok('vai pra sub sala um'), { ok: true, acao: 'canal', ch: '1' });
  assert.deepEqual(ok('volta para a voz geral'), { ok: true, acao: 'canal', ch: '' });
  assert.deepEqual(ok('ir para a subsala 7'), { ok: false, motivo: 'subsala', numero: '7' });
});

test('ir para onde alguém está: "me leva pra sala da Débora"', () => {
  const sala = { pessoas: [...pessoas, { id: '6', name: 'Débora' }, { id: '7', name: 'Sara' }] };
  assert.deepEqual(R.interpretar('Me leva pra sala da Débora.', sala), { ok: true, acao: 'canal-pessoa', id: '6' }); // ouvido de verdade
  assert.deepEqual(R.interpretar('vai pro canal do Lucas', { pessoas: [{ id: 'l', name: 'Lucas' }] }), { ok: true, acao: 'canal-pessoa', id: 'l' });
  assert.deepEqual(R.interpretar('entra na call do Mateus', sala), { ok: true, acao: 'canal-pessoa', id: '1' });
  assert.deepEqual(R.interpretar('ir para a subsala 2', ctx), { ok: true, acao: 'canal', ch: '2' }); // subsala continua igual
  assert.deepEqual(R.interpretar('volta pra voz geral', ctx), { ok: true, acao: 'canal', ch: '' });
});

test('música: tocar (com a busca), pausar, continuar, parar', () => {
  assert.deepEqual(ok('Toca Evidências.'), { ok: true, acao: 'musica-por', busca: 'evidencias' });
  assert.deepEqual(ok('põe aquela música do Coldplay Yellow'), { ok: true, acao: 'musica-por', busca: 'coldplay yellow' });
  assert.deepEqual(ok('troca a música para lofi'), { ok: true, acao: 'musica-por', busca: 'lofi' });
  assert.deepEqual(ok('coloca uma música de Raul Seixas'), { ok: true, acao: 'musica-por', busca: 'raul seixas' });
  assert.deepEqual(ok('troca a música'), { ok: false, motivo: 'musica' });
  assert.deepEqual(ok('pausa a música'), { ok: true, acao: 'musica-pausar' });
  assert.deepEqual(ok('volta a música'), { ok: true, acao: 'musica-continuar' });
  assert.deepEqual(ok('continua a música'), { ok: true, acao: 'musica-continuar' });
  assert.deepEqual(ok('para a música'), { ok: true, acao: 'musica-parar' });
});

test('som: voz e live de alguém, e todas as vozes', () => {
  assert.deepEqual(ok('abaixa o Mateus'), { ok: true, acao: 'volume', id: '1', alvo: 'voz', mudanca: 'abaixar' });
  assert.deepEqual(ok('aumenta o volume do Guilherme'), { ok: true, acao: 'volume', id: '2', alvo: 'voz', mudanca: 'aumentar' });
  assert.deepEqual(ok('liga o som da live da Ana'), { ok: true, acao: 'volume', id: '3', alvo: 'live', mudanca: 'ligar' });
  assert.deepEqual(ok('desliga o som da tela do Mateus'), { ok: true, acao: 'volume', id: '1', alvo: 'live', mudanca: 'silenciar' });
  assert.deepEqual(ok('abaixa o som da live da Ana'), { ok: true, acao: 'volume', id: '3', alvo: 'live', mudanca: 'abaixar' });
  assert.deepEqual(ok('silencia o Guilherme'), { ok: true, acao: 'volume', id: '2', alvo: 'voz', mudanca: 'silenciar' });
  assert.deepEqual(ok('muta a Thalita'), { ok: true, acao: 'volume', id: '5', alvo: 'voz', mudanca: 'silenciar' });
  assert.deepEqual(ok('silencia todo mundo'), { ok: true, acao: 'fone', silenciar: true });
  assert.deepEqual(ok('deixa todo mundo quieto um pouco'), { ok: true, acao: 'fone', silenciar: true });
  assert.deepEqual(ok('volta a ouvir todo mundo'), { ok: true, acao: 'fone', silenciar: false });
  assert.deepEqual(ok('muta meu microfone'), { ok: true, acao: 'mic-off' }); // continua sendo o microfone
  assert.deepEqual(ok('mutar'), { ok: true, acao: 'mic-off' });
});

test('destaque, tela cheia e clipe', () => {
  assert.deepEqual(ok('deixa a do Guilherme grande'), { ok: true, acao: 'destaque', id: '2' });
  assert.deepEqual(ok('põe o Mateus em destaque'), { ok: true, acao: 'destaque', id: '1' });
  assert.deepEqual(ok('tira o destaque'), { ok: true, acao: 'destaque', id: null });
  assert.deepEqual(ok('tela cheia da Ana'), { ok: true, acao: 'tela-cheia', id: '3' });
  assert.deepEqual(ok('sai da tela cheia'), { ok: true, acao: 'tela-cheia', id: null });
  assert.deepEqual(ok('salva um clipe'), { ok: true, acao: 'clipe', id: null });
  assert.deepEqual(ok('salva um clipe do Mateus'), { ok: true, acao: 'clipe', id: '1' });
});

test('a sua transmissão: parar (pede sim), só para o canal, aberta; sim e não', () => {
  assert.deepEqual(ok('para a minha live'), { ok: true, acao: 'parar-transmissao' });
  assert.deepEqual(ok('encerra minha transmissão'), { ok: true, acao: 'parar-transmissao' });
  assert.deepEqual(ok('para de transmitir'), { ok: true, acao: 'parar-transmissao' });
  assert.deepEqual(ok('deixa minha live só pro meu canal'), { ok: true, acao: 'transmissao-canal', aberta: false });
  assert.deepEqual(ok('abre minha live pra todo mundo'), { ok: true, acao: 'transmissao-canal', aberta: true });
  assert.deepEqual(ok('Sim.'), { ok: true, acao: 'confirmar' });
  assert.deepEqual(ok('pode'), { ok: true, acao: 'confirmar' });
  assert.deepEqual(ok('Não.'), { ok: true, acao: 'cancelar' });
  assert.deepEqual(ok('para de assistir o Guilherme'), { ok: true, acao: 'parar', id: '2' }); // o de antes continua
  assert.deepEqual(ok('fecha todas'), { ok: true, acao: 'parar-todos' });
});

test('pedido composto ou falado do jeito livre: vai para o modelo de linguagem (se ligado)', () => {
  for (const f of ['fecha tudo e me leva pra subsala 2', 'desliga o microfone e sai da call', 'deixa o Mateus num cantinho pra eu ver enquanto eu jogo']) assert.equal(R.composto(f), true, f);
  for (const f of ['abre a live do Mateus', 'assistir o Lucas', 'Mateus na janela flutuante no canto esquerdo de cima']) assert.equal(R.composto(f), false, f);
});

test('nome parecido entre duas pessoas: pergunta em vez de chutar; nome exato ganha', () => {
  const dois = { pessoas: [{ id: 'a', name: 'Daniel' }, { id: 'b', name: 'Daniela' }, { id: 'c', name: 'Mateus' }, { id: 'd', name: 'Matheus' }] };
  const r = R.interpretar('assistir a Dani', dois);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'ambiguo');
  assert.deepEqual(r.candidatos.sort(), ['Daniel', 'Daniela']);
  assert.equal(R.interpretar('assistir a Daniela', dois).id, 'b');
  assert.equal(R.interpretar('assistir o Daniel', dois).id, 'a');
  assert.equal(R.interpretar('assistir o Matheus', dois).id, 'd');
});

test('sem pessoa ou sem comando: diz o que ouviu', () => {
  assert.deepEqual(ok('assistir o Ricardo'), { ok: false, motivo: 'pessoa', ouvido: 'ricardo', acao: 'assistir' });
  assert.equal(ok('qual é a previsão do tempo').motivo, 'nao-entendi');
  assert.equal(ok('').motivo, 'nao-entendi');
  assert.equal(ok('assistir').motivo, 'pessoa');
});

test('dica para o Whisper: nomes limpos, sem repetir, no máximo 20', () => {
  const d = R.dica(['Ana', 'Ana', 'Bo"b\n', ...Array.from({ length: 30 }, (_, i) => `P${i}`)]);
  assert.match(d, /Ana, Bob, P0/);
  assert.doesNotMatch(d, /"|\n/);
  assert.doesNotMatch(d, /P18/); // Ana, Bob e P0..P17
});
