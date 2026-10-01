// Tela inicial no tema Padrão: o fundo é um exemplo de sala com subsalas (sóis e gente em órbita, sem nomes), com
// gente falando e transmitindo de vez em quando. Também: nada de japonês no tema Padrão, e o HUB sem Mensagens.
const { openApp, check, sleep, run } = require('./ajuda');

const CJK = '/[\\u3040-\\u30ff\\u4e00-\\u9fff]/';

run('Tela inicial: céu de exemplo', 60000, async () => {
  const A = await openApp('inicioCeu', 9498);
  await A.waitFor(`typeof renderHomeSky === 'function' && !$('home').hidden`);
  await A.eval(`document.documentElement.removeAttribute('data-skin')`); // tema Padrão
  await sleep(500);

  check('O fundo do início é o céu de exemplo, à vista', await A.eval(`(() => { const r = $('homeSky').getBoundingClientRect(); return getComputedStyle($('homeSky')).display === 'block' && r.width > 200 && r.height > 200; })()`));
  check('Seis subsalas (sóis) e doze pessoas (planetas)', await A.eval(`$('homeSky').querySelectorAll('.sky-sun').length === 6 && $('homeSky').querySelectorAll('.sky-star').length === 12`));
  check('Sem nomes: nenhum texto nem dica', await A.eval(`!$('homeSky').querySelector('text, title') && !$('homeSky').querySelector('[data-person]')`));
  // Quem acende ao longo de uns segundos (o tick roda a cada 1,4 s)
  await A.eval(`(() => { window.ceuLog = []; new MutationObserver((ms) => { for (const m of ms) if (m.target.classList.contains('speaking')) ceuLog.push('fala'); }).observe($('homeSky'), { subtree: true, attributes: true, attributeFilter: ['class'] }); })()`);
  await sleep(5000);
  check('De vez em quando alguém fala (acende)', await A.eval(`ceuLog.length > 0`), await A.eval(`ceuLog.length`));
  await A.eval(`(() => { const r = Math.random; Math.random = () => .01; homeSkyTick(); Math.random = r; })()`);
  check('E alguém começa a transmitir (anel tracejado)', await A.eval(`$('homeSky').querySelectorAll('.sky-star.live .sky-orbit').length === 1`));
  await A.send('Page.bringToFront'); await sleep(400);
  await A.shot('inicio-ceu.png');

  check('Tema Padrão sem japonês (barra de título e tela vazia da sala)', await A.eval(`(() => {
    const t = getComputedStyle($('titlebar'), '::after').content, e = getComputedStyle(document.querySelector('.empty-stage'), '::after').content;
    return !${CJK}.test(t) && !${CJK}.test(e) && t.includes('CARTA ESTELAR');
  })()`));
  check('Em outro tema, o céu de exemplo some', await A.eval(`(() => { document.documentElement.setAttribute('data-skin', 'arasaka'); const off = getComputedStyle($('homeSky')).display === 'none'; document.documentElement.removeAttribute('data-skin'); return off; })()`));
  check('HUB sem a aba Mensagens (só Salas, Amigos e Rede)', await A.eval(`!$('hubTabMessages') && !$('hubMessages') && [...document.querySelectorAll('.hub-tabs button')].map((b) => b.textContent.trim().split(' ')[0]).join() === 'Salas,Amigos,Rede'`));
});
