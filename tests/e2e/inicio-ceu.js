// Tela inicial no tema Padrão: o fundo é um céu estrelado parado (estrelas de vários tamanhos, a Via Láctea e
// nebulosas leves), sem o antigo exemplo de sala. Também: nada de japonês no tema Padrão, e o HUB (que saiu) não volta.
const { openApp, check, sleep, run } = require('./ajuda');

const CJK = '/[\\u3040-\\u30ff\\u4e00-\\u9fff]/';

run('Tela inicial: céu estrelado', 60000, async () => {
  const A = await openApp('inicioCeu', 9498);
  await A.waitFor(`!$('home').hidden`);
  await A.eval(`document.documentElement.removeAttribute('data-skin')`); // tema Padrão
  await sleep(500);

  check('O fundo é o céu estrelado (máscara de estrelas na cor do texto), parado', await A.eval(`(() => { const a = getComputedStyle(document.body, '::after'), b = getComputedStyle(document.body, '::before');
    return a.maskImage.includes('svg') && a.animationName === 'none' && b.backgroundImage.includes('radial-gradient'); })()`));
  check('Sem o céu de exemplo (sóis e gente em órbita)', await A.eval(`!$('homeSky') && typeof renderHomeSky === 'undefined'`));
  await A.send('Page.bringToFront'); await sleep(400);
  await A.shot('inicio-ceu.png');

  check('Tema Padrão sem japonês (barra de título e tela vazia da sala)', await A.eval(`(() => {
    const t = getComputedStyle($('titlebar'), '::after').content, e = getComputedStyle(document.querySelector('.empty-stage'), '::after').content;
    return !${CJK}.test(t) && !${CJK}.test(e) && t.includes('CARTA ESTELAR');
  })()`));
  check('Em outro tema, o céu estrelado some', await A.eval(`(() => { document.documentElement.setAttribute('data-skin', 'arasaka'); const off = getComputedStyle(document.body, '::after').maskImage === 'none'; document.documentElement.removeAttribute('data-skin'); return off; })()`));
  check('Sem o HUB: amigos e conversas no envelope', await A.eval(`!$('hubRail') && !document.querySelector('.hub-tabs') && $('dmPanel').contains($('dmFriends')) && $('dmPanel').contains($('dmConvs'))`));
});
