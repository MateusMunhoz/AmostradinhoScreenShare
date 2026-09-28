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
  assert.deepEqual(P.normalize(null).appearance, { glass: 'opaque', level: 70 });
  assert.equal(P.glass(P.defaults.colors, { glass: 'opaque' }), null);
  assert.equal(P.normalize({ appearance: { glass: 'metal', level: 999 } }).appearance.glass, 'opaque');
  assert.equal(P.normalize({ appearance: { glass: 'liquid', level: 999 } }).appearance.level, 100);
  const clear = P.glass(P.defaults.colors, { glass: 'clear', level: 70 }), liquid = P.glass(P.defaults.colors, { glass: 'liquid', level: 70 });
  const a = v => Number(/, ([\d.]+)\)$/.exec(v)[1]);
  assert.ok(a(clear['--panel']) < a(liquid['--panel']), 'o limpo é mais transparente que o líquido');
  assert.ok(a(P.glass(P.defaults.colors, { glass: 'clear', level: 0 })['--panel']) > a(P.glass(P.defaults.colors, { glass: 'clear', level: 100 })['--panel']));
  assert.equal(clear['--glass-base'], P.defaults.colors.main);
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
