'use strict';
// Comando de voz: o texto que o Whisper ouviu vira um comando, por regras (sem modelo de linguagem). Puro, sem DOM:
// usado pela página (renderer/comando-voz.js) e pelos testes (tests/comando-voz-regras.test.js).
// interpretar(texto, { pessoas: [{ id, name }], subsalas: [{ id }] }) devolve
//   { ok: true, acao, id?, canto?, ch? }  ou  { ok: false, motivo: 'nao-entendi' | 'pessoa' | 'ambiguo' | 'subsala', ... }
// Ações: assistir, parar, parar-todos, flutuante (canto 'tl' | 'tr' | 'bl' | 'br' | null), tirar-flutuante,
// voz-entrar, voz-sair, mic-on, mic-off, canal (ch: '' é a Voz geral), canal-pessoa (id: vai para o canal de quem está nele).
const ComandoVozRegras = (() => {
  // Minúsculas, sem acento e sem pontuação; "sub sala", "subçala" (o Whisper ouve assim) viram "subsala"
  function normalizar(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ').replace(/\bsub ?[sc]ala(s)?\b/g, 'subsala').replace(/\s+/g, ' ').trim();
  }
  // Como o Whisper escreve as palavras curtas dos comandos (visto nos testes com ruído e fala rápida):
  // "Fesha todas", "Sai da col", "subsalatriz", "Fara de assistir"
  const CORRECOES = [
    [/\bsaida\b/g, 'sai da'], [/\b(col|cola|cou|cal|coal|kol|cool)\b/g, 'call'],
    [/\b(facha|fesha|faisa|fersha|faxa|fexa|fecho|feixa)\b/g, 'fecha'], [/\btoda\b/g, 'todas'], [/\btiram\b/g, 'tira'],
    [/\bsubsala(?=[a-z])/g, 'subsala '], [/\b(triz|treis|trez)\b/g, 'tres'], [/\bdoiz\b/g, 'dois'],
    [/\b(fara|prata|pala|paira) de assistir\b/g, 'parar de assistir'],
  ];
  function corrigir(t) {
    for (const [re, por] of CORRECOES) t = t.replace(re, por);
    return t;
  }
  const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20 };
  // Palavras de comando e de ligação: o que sobra na frase é o nome da pessoa
  const VAZIAS = new Set(('o a os as do da dos das de no na nos nas em para pra pro por favor e um uma ao aos me eu meu minha '
    + 'que ai la agora ja tambem so isso esse essa este esta pode poderia quero queria voce ele ela dele dela ' + 'assistir assiste assista abre abrir abra ver veja mostrar mostra mostre live lives tela transmissao stream '
    + 'janela flutuante flutuando pip picture in pic to canto lado esquerdo esquerda direito direita cima baixo superior inferior alto '
    + 'topo parar pare deixar deixa fechar fecha feche tirar tira tire remover remove sair sai saia coloca colocar coloque poe por bota '
    + 'botar manda mandar joga jogar todas todos tudo de novo leva levar vai ir vou volta voltar muda mudar entra entrar '
    + 'sala canal call chamada onde esta musica musicas cancao toca toque tocar troca trocar pausa pausar continua continuar '
    + 'despausa som volume abaixa abaixar baixa diminui aumenta aumentar sobe subir silencia silenciar muta mutar desmuta '
    + 'destaque grande maior foco cheia clipe clip clipa clipar salva salvar grava gravar transmitir mundo todo ninguem fone '
    + 'liga ligar desliga desligar').split(' '));

  const tem = (t, re) => re.test(t);
  function canto(t) {
    const h = tem(t, /\besquerd/) ? 'l' : tem(t, /\bdireit/) ? 'r' : '';
    const v = tem(t, /\b(cima|superior|alto|topo)\b/) ? 't' : tem(t, /\b(baixo|inferior)\b/) ? 'b' : '';
    if (!h && !v) return null;
    return (v || 't') + (h || 'l'); // "canto direito" sem dizer em cima ou embaixo: em cima
  }

  // Parecido com o nome falado: sem acento, "th" e "h" mudos, letras dobradas e trocas comuns do Whisper
  function fonetica(w) {
    return w.replace(/^h/, '').replace(/th/g, 't').replace(/ph/g, 'f').replace(/y/g, 'i').replace(/w/g, 'v').replace(/k/g, 'c')
      .replace(/ss/g, 's').replace(/(.)\1+/g, '$1');
  }
  function distancia(a, b) {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0];
      d[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cur = d[j];
        d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
    }
    return d[b.length];
  }
  function semelhanca(ouvida, nome) {
    if (ouvida === nome) return 1;
    const a = fonetica(ouvida), b = fonetica(nome);
    if (a === b) return 0.97;
    if (a.length >= 3 && b.startsWith(a)) return 0.85; // apelido pelo começo: Gui, Guilherme
    return 1 - distancia(a, b) / Math.max(a.length, b.length);
  }
  const LIMIAR = 0.72;
  // A pessoa citada: compara as palavras que sobraram com cada parte do nome de cada um
  function acharPessoa(t, pessoas) {
    const palavras = t.split(' ').filter((w) => w.length >= 2 && !VAZIAS.has(w) && !/^\d+$/.test(w));
    if (!palavras.length) return { motivo: 'pessoa', ouvido: '' };
    // O Whisper às vezes parte o nome em duas palavras ("o Mateus" vira "uma teus"): junta o fim de uma palavra com a
    // seguinte e compara também, valendo um pouco menos que o nome inteiro ouvido
    const todas = t.split(' ');
    const partidos = [];
    for (let i = 0; i + 1 < todas.length; i++) {
      const [a, b] = [todas[i], todas[i + 1]];
      if (VAZIAS.has(b) && b.length > 2) continue;
      for (let n = 1; n <= Math.min(3, a.length); n++) partidos.push(a.slice(-n) + b);
    }
    const notas = [];
    for (const p of pessoas || []) {
      const nome = normalizar(p.name);
      if (!nome) continue;
      // Nome inteiro dito (com sobrenome): vale mais que só uma parte dele
      if (nome.includes(' ') && ` ${t} `.includes(` ${nome} `)) { notas.push({ p, nota: 1.01 }); continue; }
      let nota = 0;
      for (const parte of nome.split(' ')) {
        for (const w of palavras) nota = Math.max(nota, semelhanca(w, parte));
        // Partido só vale para nome de 5 letras ou mais (curto demais acharia "Ana" em qualquer lugar)
        if (parte.length >= 5) for (const w of partidos) if (fonetica(w) === fonetica(parte)) nota = Math.max(nota, 0.9);
      }
      if (nota >= LIMIAR) notas.push({ p, nota });
    }
    notas.sort((x, y) => y.nota - x.nota);
    if (!notas.length) return { motivo: 'pessoa', ouvido: palavras.join(' ') };
    // Dois parecidos quase empatados: pergunta em vez de chutar (o nome dito exatamente ganha de um parecido)
    if (notas.length > 1 && notas[0].nota - notas[1].nota < 0.08 && !(notas[0].nota >= 1 && notas[1].nota < 1)) {
      return { motivo: 'ambiguo', candidatos: notas.filter((n) => notas[0].nota - n.nota < 0.08).map((n) => n.p.name) };
    }
    return { id: notas[0].p.id };
  }

  function numeroSubsala(t) {
    const m = t.match(/\bsubsala (\w+)/);
    if (!m) return null;
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMEROS[m[1]];
    return n ? String(n) : '';
  }

  function interpretar(texto, ctx = {}) {
    const t = corrigir(normalizar(texto));
    if (!t) return { ok: false, motivo: 'nao-entendi', ouvido: '' };
    const comPessoa = (acao, extra = {}) => {
      const r = acharPessoa(t, ctx.pessoas);
      return r.id ? { ok: true, acao, id: r.id, ...extra } : { ok: false, ...r, acao };
    };
    const parar = /\b(parar|pare|para de|deixar de|deixa de|fechar|fecha|feche|tirar|tira|tire|remover|remove|sair|sai|saia)\b/;

    // Janela flutuante (pip): tirar alguém dela, ou mandar alguém para ela (num canto)
    if (tem(t, /\b(flutuante|flutuando|pip|picture in picture|pic to pic)\b/)) {
      if (tem(t, parar)) return comPessoa('tirar-flutuante');
      return comPessoa('flutuante', { canto: canto(t) });
    }
    // Resposta a uma pergunta ("Parar a sua transmissão?"): sim ou não, curto
    if (t.split(' ').length <= 3) {
      if (tem(t, /^(sim|confirma|confirmo|confirmado|pode|isso|claro)\b/)) return { ok: true, acao: 'confirmar' };
      if (tem(t, /^(nao|cancela|cancelar|esquece|deixa pra la)\b/)) return { ok: true, acao: 'cancelar' };
    }
    // A sua transmissão: só para o seu canal, aberta para todos, ou parar (pede "sim" depois)
    const minha = tem(t, /\b(minha (live|transmissao|tela|stream)|de transmitir)\b/);
    if ((minha || tem(t, /\b(live|transmissao)\b/)) && tem(t, /\bso (pro|pra|para o|para|o) ?(meu )?(canal|subsala|sala)\b|\bso meu canal\b/)) {
      return { ok: true, acao: 'transmissao-canal', aberta: false };
    }
    if (minha && tem(t, /\b(abre|abrir|libera|liberar|deixa)\b/) && tem(t, /\b(todo mundo|todos|geral|sala toda|sala inteira)\b/)) {
      return { ok: true, acao: 'transmissao-canal', aberta: true };
    }
    if (minha && tem(t, /\b(para|parar|pare|encerra|encerrar|desliga|desligar|termina|terminar|fecha|fechar)\b/)) return { ok: true, acao: 'parar-transmissao' };
    // Clipe: de alguém ou da tela que o app escolheria (a em destaque, a principal…)
    if (tem(t, /\b(clipe|clip|clipa|clipar)\b/)) {
      const r = acharPessoa(t, ctx.pessoas);
      return { ok: true, acao: 'clipe', id: r.id || null };
    }
    // Tela cheia e destaque
    const sair = /\b(tira|tirar|sai|sair|desliga|desligar|fecha|volta ao normal)\b/;
    if (tem(t, /\btela cheia\b/)) return tem(t, sair) ? { ok: true, acao: 'tela-cheia', id: null } : comPessoa('tela-cheia');
    if (tem(t, /\b(destaque|grande|maior|foco|focar|foca)\b/)) return tem(t, sair) ? { ok: true, acao: 'destaque', id: null } : comPessoa('destaque');
    // Música do YouTube: "toca Evidências", "põe aquela música do Coldplay", "pausa a música", "para a música"
    const tocar = /\b(toca|toque|tocar|poe|coloca|coloque|bota|troca|trocar|muda|mudar)\b/;
    if (tem(t, /\b(musica|musicas|cancao)\b/) || tem(t, /^(toca|toque|tocar)\b/)) {
      if (tem(t, tocar)) {
        const busca = t.replace(new RegExp(`^.*?${tocar.source}( pra tocar)?\\s*`), '')
          .replace(/^((a|uma|aquela|essa|outra) )?((musica|cancao)\b ?)?((de|do|da|para|pra|por) )?/, '').trim();
        return busca ? { ok: true, acao: 'musica-por', busca } : { ok: false, motivo: 'musica' };
      }
      if (tem(t, /\b(pausa|pausar|pause|segura)\b/)) return { ok: true, acao: 'musica-pausar' };
      if (tem(t, /\b(continua|continuar|volta|voltar|despausa|solta|retoma|play)\b/)) return { ok: true, acao: 'musica-continuar' };
      if (tem(t, /\b(para|parar|pare|tira|tirar|desliga|desligar|fecha|encerra)\b/)) return { ok: true, acao: 'musica-parar' };
    }
    // Todas as vozes (o fone): "silencia todo mundo", "volta a ouvir todo mundo"
    const todos = /\b(todo mundo|todos|geral|ninguem|as vozes|a call|o fone)\b/;
    if (tem(t, /\b(silencia|silenciar|muta|mutar|cala|quieto|quietos)\b/) && tem(t, todos)) return { ok: true, acao: 'fone', silenciar: true };
    if (tem(t, /\b(desliga|desligar)\b/) && tem(t, /\b(o fone|as vozes)\b/)) return { ok: true, acao: 'fone', silenciar: true };
    if (tem(t, /\b(volta a ouvir|ouvir todo mundo|desmuta todo mundo|desmutar todo mundo|liga o fone|liga as vozes)\b/)) return { ok: true, acao: 'fone', silenciar: false };
    // Som de alguém: o da live ("liga o som da live da Ana") ou a voz ("abaixa o Mateus", "silencia o Lucas")
    if (tem(t, /\bsom\b/) && tem(t, /\b(live|tela|transmissao|stream)\b/)) {
      const mudanca = tem(t, /\b(desliga|desligar|tira|tirar|muta|mutar|silencia)\b/) ? 'silenciar' : tem(t, /\b(abaixa|abaixar|baixa|diminui)\b/) ? 'abaixar'
        : tem(t, /\b(aumenta|aumentar|sobe|subir)\b/) ? 'aumentar' : 'ligar';
      return comPessoa('volume', { alvo: 'live', mudanca });
    }
    if (tem(t, /\b(abaixa|abaixar|baixa|diminui|diminuir|aumenta|aumentar|sobe|subir)\b/)) {
      return comPessoa('volume', { alvo: tem(t, /\b(live|tela|transmissao)\b/) ? 'live' : 'voz', mudanca: tem(t, /\b(aumenta|aumentar|sobe|subir)\b/) ? 'aumentar' : 'abaixar' });
    }
    if (!tem(t, /\b(microfone|mic|me|meu)\b/) && tem(t, /\b(silencia|silenciar|muta|mutar|desmuta|desmutar)\b/)) {
      const r = acharPessoa(t, ctx.pessoas);
      if (r.id) return { ok: true, acao: 'volume', id: r.id, alvo: 'voz', mudanca: tem(t, /\bdesmut/) ? 'ligar' : 'silenciar' };
    }
    // Mudar de canal: "ir para a subsala 2", "volta para a voz geral"
    if (tem(t, /\bsubsala\b/) && !tem(t, /\b(assistir|assiste|live|tela|transmissao)\b/)) {
      const n = numeroSubsala(t);
      if (!n) return { ok: false, motivo: 'subsala', ouvido: t };
      if (!(ctx.subsalas || []).some((s) => String(s.id) === n)) return { ok: false, motivo: 'subsala', numero: n };
      return { ok: true, acao: 'canal', ch: n };
    }
    if (tem(t, /\b(voz|canal|sala) geral\b/)) return { ok: true, acao: 'canal', ch: '' };
    // Para onde alguém está: "me leva pra sala da Débora", "vai pro canal do Lucas", "entra na call do Mateus"
    if (tem(t, /\b(sala|canal|call|chamada) (do|da|de)\b/) && tem(t, /\b(leva|levar|vai|ir|vou|volta|voltar|muda|mudar|entra|entrar|joga|manda|bota)\b/)) {
      return comPessoa('canal-pessoa');
    }
    // Microfone
    if (tem(t, /\b(microfone|mic|mute|mutar|muta|desmutar|desmuta|mudo)\b/)) {
      if (tem(t, /\b(desmutar|desmuta|ligar|liga|ligue|ativar|ativa|abrir|abre)\b/)) return { ok: true, acao: 'mic-on' };
      return { ok: true, acao: 'mic-off' };
    }
    // Voz (a call)
    if (tem(t, /\b(voz|call|chamada)\b/)) {
      if (tem(t, /\b(sair|sai|saia|desconectar|desconecta|desligar|desliga)\b/)) return { ok: true, acao: 'voz-sair' };
      if (tem(t, /\b(entrar|entra|entre|conectar|conecta|ligar|liga)\b/)) return { ok: true, acao: 'voz-entrar' };
    }
    // Parar de assistir: todo mundo ou alguém
    if (tem(t, parar)) {
      if (tem(t, /\b(todas|todos|tudo|todo mundo)\b/)) return { ok: true, acao: 'parar-todos' };
      return comPessoa('parar');
    }
    if (tem(t, /\b(assistir|assiste|assista|abre|abrir|abra|ver|veja|mostrar|mostra|mostre|live|tela|transmissao|stream)\b/)) {
      return comPessoa('assistir');
    }
    return { ok: false, motivo: 'nao-entendi', ouvido: texto };
  }

  // Pedido com mais de uma coisa ("fecha tudo e me leva pra subsala 2") ou falado do jeito livre (frase longa): as
  // regras fariam só uma parte. Com os pedidos livres ligados, ele vai direto para o modelo de linguagem
  const VERBOS = 'leva|levar|vai|ir|volta|abre|abrir|assiste|assistir|fecha|fechar|tira|tirar|coloca|poe|bota|entra|entrar|sai|sair|liga|ligar|desliga|desligar|muta|mutar|joga|manda|mostra|para|parar';
  function composto(texto) {
    const t = corrigir(normalizar(texto));
    return t.split(' ').length > 9 || new RegExp(`\\b(${VERBOS})\\b.* e (me |depois |tambem |ja )?(${VERBOS})\\b`).test(t);
  }

  // Dica para o Whisper: as palavras dos comandos e os nomes da sala (ajuda a escrever os nomes certo)
  function dica(nomes) {
    const limpos = [...new Set((nomes || []).map((n) => String(n || '').replace(/[\x00-\x1f"]/g, '').trim().slice(0, 32)).filter(Boolean))].slice(0, 20);
    return `Assistir a live, parar de assistir, janela flutuante no canto esquerdo de cima, subsala, voz geral, microfone.${limpos.length ? ` ${limpos.join(', ')}.` : ''}`;
  }

  return { normalizar, interpretar, composto, dica, semelhanca };
})();
if (typeof module !== 'undefined') module.exports = ComandoVozRegras;
