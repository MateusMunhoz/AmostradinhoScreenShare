const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../renderer/preferencias-modelo');

test('Preferências: hexadecimal, dados inválidos e persistência', () => {
  assert.equal(P.hex('aB3'), '#AABB33');
  assert.equal(P.hex('#1a2b3c'), '#1A2B3C');
  for (const v of ['', '#12345', 'red', '#gggggg', null]) assert.equal(P.hex(v), null);
  let saved = '{invalid'; const storage = {getItem: () => saved, setItem: (_k,v) => {saved=v;}};
  assert.deepEqual(P.read(storage), P.defaults);
  const desired = P.normalize({colors:{main:'#fff',secondary:'#000',detail1:'#ff0000',detail2:'#00ff00'},sounds:{join:'none',leave:'wood',chat:'notification066',chatMuted:true,volume:27}});
  P.write(storage, desired);
  assert.deepEqual(P.read(storage), desired);
  assert.equal(P.normalize({sounds:{chat:'../../secret',volume:500}}).sounds.chat, P.defaults.sounds.chat);
  assert.equal(P.normalize({sounds:{volume:500}}).sounds.volume, 100);
});
test('Cores escolhidas permanecem exatas e textos se adaptam a fundos opostos', () => {
  const colors={main:'#FFFFFF',secondary:'#000000',detail1:'#123456',detail2:'#ABCDEF'};
  const palette=P.palette(colors);
  assert.equal(palette['--bg'], colors.main); assert.equal(palette['--panel'],colors.secondary);
  assert.equal(palette['--primary'], colors.detail1); assert.equal(palette['--ok'],colors.detail2);
  assert.equal(palette['--text'],'#000000'); assert.equal(palette['--surface-text'],'#FFFFFF');
});
test('Texto sobre tons médios: cinzas vizinhos não viram o tema, e cores vivas médias levam texto branco', () => {
  const base={main:'#22271E',secondary:'#2D3327',detail1:'#D6C45C',detail2:'#A6D089'};
  const on=(field,c)=>P.palette({...base,[field]:c});
  // #757575 e #787878 ficavam um de cada lado do limiar antigo: o texto e o tema inteiro trocavam
  for (const c of ['#757575','#787878','#8A8A8A']) {
    assert.equal(on('main',c)['--text'],'#FFFFFF',c); assert.equal(on('main',c)['color-scheme'],'dark',c);
    assert.equal(on('secondary',c)['--surface-text'],'#FFFFFF',c);
  }
  // Cinza claro de verdade continua com texto preto e tema claro
  assert.equal(on('main','#B0B0B0')['--text'],'#000000'); assert.equal(on('main','#B0B0B0')['color-scheme'],'light');
  // Botão principal: azul, verde, vermelho e rosa médios com texto branco; amarelo e verde claro do padrão, preto
  for (const c of ['#3B82F6','#16A34A','#EF4444','#F472B6']) assert.equal(on('detail1',c)['--primary-ink'],'#FFFFFF',c);
  for (const c of ['#D6C45C','#A6D089','#FFB74D']) assert.equal(on('detail1',c)['--primary-ink'],'#000000',c);
});

test('Volumes por evento preservam preferências antigas e multiplicam o volume geral', async () => {
  const prefs=P.normalize({sounds:{join:'wood',volume:40,levels:{chat:30,voiceJoin:50,voiceLeave:-5,leave:'inválido'}}});
  assert.equal(prefs.sounds.join,'wood'); assert.equal(prefs.sounds.levels.join,100);
  assert.equal(prefs.sounds.levels.leave,100); assert.equal(prefs.sounds.levels.voiceLeave,0);
  const played=[]; const player=new P.SoundPlayer({settings:()=>prefs,createAudio:url=>({pause(){},play(){played.push({url,volume:this.volume});return Promise.resolve();}}),
    synth:(notes,volume)=>{played.push({url:'suave',volume});return {pause(){}};}});
  await player.play('voiceJoin',true); assert.equal(played.at(-1).volume,.2);
  await player.play('chat',true); assert.equal(played.at(-1).volume,.12);
  assert.equal(await player.play('voiceLeave',true),false);
  prefs.sounds.volume=0; assert.equal(await player.play('voiceJoin',true),false);
  assert.equal(prefs.sounds.levels.voiceJoin,50);
  let saved;P.write({setItem:(_k,v)=>{saved=v;}},prefs);
  assert.deepEqual(P.read({getItem:()=>saved}),prefs);
});
test('Sons: silêncio do chat, prévia, volume, seleção e falha de reprodução', async () => {
  const prefs=P.normalize(null); let time=1000; const played=[];
  const player=new P.SoundPlayer({settings:()=>prefs,now:()=>time,createAudio:url=>({volume:0,pause(){},async play(){played.push({url,volume:this.volume});}})});
  prefs.sounds.chatMuted=true;
  assert.equal(await player.play('chat'),false);
  assert.equal(await player.play('chat',true),true);
  assert.equal(played[0].volume,.5);
  prefs.sounds.join='notification066';
  assert.equal(await player.play('join'),true);
  assert.ok(played.at(-1).url.endsWith('universfield-new-notification-066-494545.mp3'));
  assert.equal(await player.play('join'),false);
  time+=200; assert.equal(await player.play('join'),true);
  prefs.sounds.leave='none'; assert.equal(await player.play('leave'),false);
  prefs.sounds.volume=0; assert.equal(await player.play('chat',true),false);
  prefs.sounds.volume=50; player.createAudio=()=>({pause(){},play:()=>Promise.reject(new Error('decode'))});
  assert.equal(await player.play('chat',true),false);
  assert.equal(player.players.has('preview'),false);
  player.stopAll(); assert.equal(player.players.size,0);
});

test('Sons Suave: gerados na hora, sem arquivo, padrão da voz e do microfone', async () => {
  assert.ok(P.sounds.filter(s => s.synth).every(s => !s.file && s.synth.every(n => n.length === 4)));
  const d=P.normalize(null).sounds;
  assert.deepEqual([d.voiceJoin,d.voiceLeave,d.mute,d.unmute],['suaveEntrou','suaveSaiu','suaveMutou','suaveDesmutou']);
  const played=[]; const prefs=P.normalize(null);
  const player=new P.SoundPlayer({settings:()=>prefs,createAudio:()=>{throw new Error('não era para abrir arquivo');},synth:(notes,volume)=>{played.push({f:notes[0][0],volume});return {pause(){}};}});
  assert.equal(await player.play('mute'),true);
  assert.deepEqual(played[0],{f:659,volume:.5});
  prefs.sounds.levels.unmute=0; assert.equal(await player.play('unmute'),false);
});

test('Aparência: modos de vidro, transparência e dados inválidos', () => {
  assert.deepEqual(P.normalize(null).appearance, { glass: 'opaque', level: 70, border: 'solid', ambient: true });
  assert.equal(P.normalize({ appearance: { ambient: false } }).appearance.ambient, false);
  assert.equal(P.normalize({ appearance: { ambient: 'sim' } }).appearance.ambient, true);
  assert.equal(P.glass(P.defaults.colors, { glass: 'opaque' }), null);
  assert.equal(P.normalize({ appearance: { glass: 'metal', level: 999 } }).appearance.glass, 'opaque');
  assert.equal(P.normalize({ appearance: { glass: 'liquid', level: 999 } }).appearance.level, 100);
  const clear = P.glass(P.defaults.colors, { glass: 'clear', level: 70 }), liquid = P.glass(P.defaults.colors, { glass: 'liquid', level: 70 });
  const a = v => Number(/, ([\d.]+)\)$/.exec(v)[1]);
  assert.ok(a(clear['--panel']) < a(liquid['--panel']), 'o limpo é mais transparente que o líquido');
  assert.ok(a(P.glass(P.defaults.colors, { glass: 'clear', level: 0 })['--panel']) > a(P.glass(P.defaults.colors, { glass: 'clear', level: 100 })['--panel']));
  assert.equal(clear['--glass-base'], P.defaults.colors.main);
  // Leitura: mesmo no mais transparente, diálogos e listas ficam com pelo menos 78% de opacidade
  for (const glass of ['clear', 'liquid']) assert.ok(a(P.glass(P.defaults.colors, { glass, level: 100 })['--panel-strong']) >= .78);
});
test('Fontes: catálogo, nome digitado seguro e pilha com a padrão no fim', () => {
  assert.equal(new Set(P.fonts.map(f => f.id)).size, P.fonts.length);
  assert.ok(P.fonts.filter(f => f.group === 'Outros idiomas').every(f => f.sample));
  assert.equal(P.fontName('  Noto   Sans '), 'Noto Sans');
  for (const bad of ['a"; } body { x', 'x'.repeat(65), 'url(x)', '', null]) assert.equal(P.fontName(bad), '');
  assert.equal(P.normalize({ font: { family: 'custom', custom: 'a"b' } }).font.family, 'system');
  assert.equal(P.normalize({ font: { family: 'nada' } }).font.family, 'system');
  const custom = P.fontStacks({ family: 'custom', custom: 'Fira Sans', chat: true });
  assert.ok(custom.body.startsWith('"Fira Sans", ') && custom.body.endsWith('system-ui, sans-serif'));
  assert.equal(custom.console, custom.body);
  assert.equal(P.fontStacks({ family: 'georgia' }).console, 'Tahoma, Verdana, sans-serif');
  assert.equal(P.fontStacks(P.defaults.font).display, P.fonts[0].display);
  let saved; const prefs = P.normalize({ appearance: { glass: 'liquid', level: 40 }, font: { family: 'korean', chat: true } });
  P.write({ setItem: (_k, v) => { saved = v; } }, prefs);
  assert.deepEqual(P.read({ getItem: () => saved }), prefs);
});
test('Bordas: normal, transparente e líquido, em qualquer material', () => {
  assert.equal(P.normalize({ appearance: { border: 'neon' } }).appearance.border, 'solid');
  assert.equal(P.borders(P.defaults.colors, { border: 'solid' }), null);
  const pal = P.palette(P.defaults.colors);
  const clear = P.borders(P.defaults.colors, { glass: 'opaque', border: 'clear' }), liquid = P.borders(P.defaults.colors, { border: 'liquid' });
  for (const b of [clear, liquid]) for (const k of ['--line', '--line-strong', '--field-line', '--edge-sheen']) assert.match(b[k], /^rgba\(/);
  assert.notEqual(clear['--line'], pal['--line']);
  assert.ok(Number(/, ([\d.]+)\)$/.exec(liquid['--edge-sheen'])[1]) > Number(/, ([\d.]+)\)$/.exec(clear['--edge-sheen'])[1]), 'o líquido acende mais a quina');
});
test('Fonte do nome: só ids da lista, pilha com a padrão no fim, padrão vazio', () => {
  assert.equal(P.normalize(null).nameFont, '');
  assert.equal(P.normalize({ nameFont: 'segoeScript' }).nameFont, 'segoeScript');
  for (const bad of ['system', 'custom', 'Arial; x', 'nada', 42, null]) assert.equal(P.cleanNameFont(bad), '');
  assert.equal(P.nameFontStack(''), '');
  assert.ok(P.nameFontStack('impact').startsWith('Impact, ') && P.nameFontStack('impact').endsWith('system-ui, sans-serif'));
});
test('Temas prontos: aplicam cores e material, zeram detalhes e são reconhecidos', () => {
  assert.ok(P.themes.length >= 5);
  assert.equal(new Set(P.themes.map(t => t.id)).size, P.themes.length);
  const custom = P.normalize({ colors: { main: '#123456', text: '#FF0000' }, font: { family: 'georgia' }, nameFont: 'impact' });
  assert.equal(P.currentTheme(custom), '');
  const neon = P.applyTheme(custom, 'neon');
  assert.equal(neon.colors.main, '#0B0A14');
  assert.equal(neon.colors.text, '', 'cor de detalhe do tema anterior volta ao automático');
  assert.equal(neon.appearance.glass, 'clear');
  assert.equal(neon.font.family, 'georgia');
  assert.equal(neon.nameFont, 'impact');
  assert.equal(P.currentTheme(neon), 'neon');
  assert.equal(P.currentTheme(P.normalize(null)), 'lanhouse');
  for (const t of P.themes) assert.equal(P.currentTheme(P.applyTheme(null, t.id)), t.id);
});
test('Sem imagem de fundo; material e bordas livres dentro do tema', () => {
  const old = P.normalize({ appearance: { wallpaper: 'custom', blur: 12, dim: 55 } }).appearance;
  assert.deepEqual(Object.keys(old).sort(), ['ambient', 'border', 'glass', 'level'], 'preferência antiga de imagem é descartada');
  const neon = P.applyTheme(null, 'neon');
  assert.equal(P.currentTheme({ ...neon, appearance: { ...neon.appearance, glass: 'liquid', border: 'solid' } }), 'neon');
});test('Tema E.V.A (aba Tema): um só, com as cores do EVA-01 e sem imagem de fundo', () => {
  assert.equal(P.themes.some(t => /eva/i.test(t.id)), false, 'saiu de Temas prontos');
  const eva = P.skins.find(k => k.id === 'eva');
  assert.equal(eva.label, 'E.V.A by Asock');
  assert.equal(P.cleanSkin('eva'), 'eva');
  const p = P.applyTheme(P.normalize({ nameFont: 'impact', sounds: { volume: 12 }, appearance: { ambient: false } }), 'eva');
  assert.equal(p.colors.detail1, '#FF8A1F', 'laranja no destaque');
  assert.equal(p.colors.secondary, '#170C29', 'roxo nos painéis');
  assert.equal(p.appearance.ambient, false, 'o tema não mexe na luz ambiente');
  assert.equal(p.nameFont, 'impact');
  assert.equal(p.sounds.volume, 12);
  const pal = P.palette(p.colors);
  assert.equal(new Set([pal['--live'], pal['--ok'], pal['--warn']]).size, 3, 'você, quem fala e cuidado em cores diferentes');
});
test('Fontes incluídas no app: arquivos locais que existem', () => {
  const fs = require('node:fs'), path = require('node:path');
  const bundled = P.fonts.filter(f => f.files);
  for (const id of ['chakra', 'shareTech', 'loveLetter']) assert.ok(bundled.some(f => f.id === id), id);
  for (const f of bundled) for (const file of f.files) assert.ok(fs.existsSync(path.join(__dirname, '..', file)), file);
});
