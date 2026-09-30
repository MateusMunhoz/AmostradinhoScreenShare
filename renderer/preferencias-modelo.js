'use strict';
// Modelo puro compartilhado pelo renderer e pelos testes. Só IDs conhecidos viram URLs de áudio.
// Os sons "Suave" não têm arquivo: são tons gerados na hora ([frequência Hz, início s, duração s, volume relativo]).
const AppPreferences = (() => {
  const key = 'appPreferences.v1';
  const sounds = [
    { id: 'whoosh', label: 'Whoosh · transição', file: 'ksjsbwuil-whoosh-deep-short-481215.mp3' },
    { id: 'notification017', label: 'Notificação 017', file: 'universfield-new-notification-017-352293.mp3' },
    { id: 'notification033', label: 'Notificação 033', file: 'universfield-new-notification-033-480571.mp3' },
    { id: 'notification035', label: 'Notificação 035', file: 'universfield-new-notification-035-485894.mp3' },
    { id: 'notification039', label: 'Notificação 039', file: 'universfield-new-notification-039-493472.mp3' },
    { id: 'notification041', label: 'Notificação 041', file: 'universfield-new-notification-041-493473.mp3' },
    { id: 'notification066', label: 'Notificação 066', file: 'universfield-new-notification-066-494545.mp3' },
    { id: 'wood', label: 'Madeira · toque', file: 'vittemacop-wood-allert-notification-switch-onoff-478077.mp3' },
    { id: 'suaveEntrou', label: 'Suave · dois tons subindo', synth: [[660, 0, 0.13, 1], [880, 0.09, 0.2, 1]] },
    { id: 'suaveSaiu', label: 'Suave · dois tons descendo', synth: [[880, 0, 0.13, 1], [587, 0.09, 0.22, 1]] },
    { id: 'suaveMutou', label: 'Suave · toque curto descendo', synth: [[659, 0, 0.07, 0.8], [523, 0.055, 0.11, 0.8]] },
    { id: 'suaveDesmutou', label: 'Suave · toque curto subindo', synth: [[523, 0, 0.07, 0.8], [659, 0.055, 0.11, 0.8]] },
    { id: 'suaveFoneDesligou', label: 'Suave · grave descendo', synth: [[440, 0, 0.09, 0.8], [330, 0.07, 0.16, 0.8]] },
    { id: 'suaveFoneLigou', label: 'Suave · grave subindo', synth: [[330, 0, 0.09, 0.8], [440, 0.07, 0.16, 0.8]] },
    { id: 'suaveTransmitiu', label: 'Suave · três tons subindo', synth: [[523, 0, 0.1, 0.9], [659, 0.08, 0.1, 0.9], [784, 0.16, 0.22, 0.9]] },
    { id: 'suaveParouTransmitir', label: 'Suave · três tons descendo', synth: [[784, 0, 0.1, 0.9], [659, 0.08, 0.1, 0.9], [523, 0.16, 0.22, 0.9]] },
    { id: 'suaveMencao', label: 'Suave · chamado agudo', synth: [[988, 0, 0.08, 1], [1319, 0.07, 0.08, 1], [988, 0.2, 0.08, 1], [1319, 0.27, 0.16, 1]] },
  ];
  // mute/unmute: o seu microfone (o apertar para falar não conta); deafen/undeafen: o seu fone (Silenciar vozes);
  // shareStart/shareStop: a sua transmissão; mention: alguém escreveu @seu nome no chat
  const events = ['join', 'leave', 'chat', 'mention', 'voiceJoin', 'voiceLeave', 'mute', 'unmute', 'deafen', 'undeafen', 'shareStart', 'shareStop'];
  // Cores: as 4 primeiras sempre valem; as outras começam vazias ('' = automático, calculada das 4) e só
  // passam a valer quando a pessoa escolhe
  const optionalColors = ['text', 'live', 'speaking', 'warn', 'line'];
  // Aparência: o material das superfícies (como o Liquid Glass do iOS) e a fonte da interface
  const glassModes = ['opaque', 'clear', 'liquid'];
  const borderModes = ['solid', 'clear', 'liquid']; // bordas: cor cheia, translúcidas ou com brilho de vidro
  const glassLevel = { clear: 70, liquid: 55 }; // transparência inicial de cada modo (0 = quase opaco, 100 = quase invisível)
  // Imagem de fundo atrás do app: as incluídas no app (nenhuma por enquanto) ou 'custom', a imagem que a pessoa
  // escolheu, guardada à parte (wallpaperKey) por ser grande. blur em px; dim = quanto a cor Principal cobre a imagem, em %.
  const wallpapers = [];
  const wallpaperKey = 'appWallpaper.v1';
  const wallpaperLimits = { blur: 40, dim: 90 };
  const wallpaperUrl = id => wallpapers.find(w => w.id === id)?.file || '';
  // Só data URL de imagem em base64 (vira url("...") no CSS): nada de endereço externo nem aspas
  const cleanWallpaperData = v => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : '';
  // Fontes do Windows 10 e 11. Cada pilha termina na fonte padrão, então letra que faltar cai nela.
  const baseStack = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  const fonts = [
    { id: 'system', group: 'Padrão', label: 'Padrão do app · Segoe UI Variable', family: '', display: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif' },
    { id: 'segoe', group: 'Clássicas', label: 'Segoe UI', family: '"Segoe UI"' },
    { id: 'arial', group: 'Clássicas', label: 'Arial', family: 'Arial, Helvetica' },
    { id: 'verdana', group: 'Clássicas', label: 'Verdana', family: 'Verdana' },
    { id: 'tahoma', group: 'Clássicas', label: 'Tahoma · console do chat', family: 'Tahoma' },
    { id: 'trebuchet', group: 'Clássicas', label: 'Trebuchet MS', family: '"Trebuchet MS"' },
    { id: 'calibri', group: 'Clássicas', label: 'Calibri', family: 'Calibri' },
    { id: 'candara', group: 'Clássicas', label: 'Candara', family: 'Candara' },
    { id: 'corbel', group: 'Clássicas', label: 'Corbel', family: 'Corbel' },
    { id: 'bahnschrift', group: 'Clássicas', label: 'Bahnschrift · condensada', family: 'Bahnschrift' },
    { id: 'georgia', group: 'Com serifa', label: 'Georgia', family: 'Georgia' },
    { id: 'cambria', group: 'Com serifa', label: 'Cambria', family: 'Cambria' },
    { id: 'constantia', group: 'Com serifa', label: 'Constantia', family: 'Constantia' },
    { id: 'palatino', group: 'Com serifa', label: 'Palatino Linotype', family: '"Palatino Linotype", Palatino' },
    { id: 'sitka', group: 'Com serifa', label: 'Sitka Text', family: '"Sitka Text"' },
    { id: 'times', group: 'Com serifa', label: 'Times New Roman', family: '"Times New Roman", Times' },
    { id: 'segoePrint', group: 'Estilizadas', label: 'Segoe Print · manuscrita', family: '"Segoe Print"' },
    { id: 'segoeScript', group: 'Estilizadas', label: 'Segoe Script · cursiva', family: '"Segoe Script"' },
    { id: 'inkFree', group: 'Estilizadas', label: 'Ink Free · caneta', family: '"Ink Free"' },
    { id: 'comic', group: 'Estilizadas', label: 'Comic Sans MS', family: '"Comic Sans MS"' },
    { id: 'gabriola', group: 'Estilizadas', label: 'Gabriola · decorativa', family: 'Gabriola' },
    { id: 'franklin', group: 'Estilizadas', label: 'Franklin Gothic', family: '"Franklin Gothic Medium"' },
    { id: 'impact', group: 'Estilizadas', label: 'Impact · títulos', family: 'Impact' },
    { id: 'cascadia', group: 'Monoespaçadas', label: 'Cascadia Code', family: '"Cascadia Code", "Cascadia Mono", Consolas' },
    { id: 'consolas', group: 'Monoespaçadas', label: 'Consolas', family: 'Consolas' },
    { id: 'courier', group: 'Monoespaçadas', label: 'Courier New', family: '"Courier New"' },
    { id: 'lucidaConsole', group: 'Monoespaçadas', label: 'Lucida Console', family: '"Lucida Console"' },
    // Vêm com o app (assets/fontes, licença OFL; @font-face em styles.css): funcionam em qualquer PC
    { id: 'chakra', group: 'Incluídas no app', label: 'Chakra Petch · painel de controle', family: '"Chakra Petch"', files: ['assets/fontes/chakra-petch-400.woff2', 'assets/fontes/chakra-petch-600.woff2', 'assets/fontes/chakra-petch-700.woff2'] },
    { id: 'shareTech', group: 'Incluídas no app', label: 'Share Tech Mono · terminal', family: '"Share Tech Mono"', files: ['assets/fontes/share-tech-mono-400.woff2'] },
    // A máquina de escrever de Serial Experiments Lain (Dixie's Delights, 1996; versão web de AKIRA-MIYAKE, MIT)
    { id: 'loveLetter', group: 'Incluídas no app', label: 'Love Letter Typewriter · Lain', family: '"Love Letter Typewriter", "Courier New"', files: ['assets/fontes/love-letter-typewriter.woff2'] },
    { id: 'japanese', group: 'Outros idiomas', label: '日本語 · Yu Gothic UI', family: '"Yu Gothic UI", "Meiryo UI", Meiryo', sample: 'こんにちは、配信中です' },
    { id: 'chineseSimplified', group: 'Outros idiomas', label: '简体中文 · Microsoft YaHei UI', family: '"Microsoft YaHei UI", "Microsoft YaHei"', sample: '你好，正在直播' },
    { id: 'chineseTraditional', group: 'Outros idiomas', label: '繁體中文 · Microsoft JhengHei UI', family: '"Microsoft JhengHei UI", "Microsoft JhengHei"', sample: '你好，正在直播' },
    { id: 'korean', group: 'Outros idiomas', label: '한국어 · Malgun Gothic', family: '"Malgun Gothic"', sample: '안녕하세요, 방송 중입니다' },
    { id: 'hindi', group: 'Outros idiomas', label: 'हिन्दी · Nirmala UI', family: '"Nirmala UI"', sample: 'नमस्ते, लाइव है' },
    { id: 'thai', group: 'Outros idiomas', label: 'ไทย · Leelawadee UI', family: '"Leelawadee UI"', sample: 'สวัสดี กำลังถ่ายทอดสด' },
    { id: 'arabic', group: 'Outros idiomas', label: 'العربية · Sakkal Majalla', family: '"Sakkal Majalla", "Segoe UI"', sample: 'مرحبا، البث مباشر' },
    { id: 'georgian', group: 'Outros idiomas', label: 'ქართული · Sylfaen', family: 'Sylfaen', sample: 'გამარჯობა, პირდაპირი ეთერი' },
    { id: 'ethiopic', group: 'Outros idiomas', label: 'አማርኛ · Ebrima', family: 'Ebrima', sample: 'ሰላም' },
    { id: 'cherokee', group: 'Outros idiomas', label: 'ᏣᎳᎩ · Gadugi', family: 'Gadugi', sample: 'ᎣᏏᏲ' },
    { id: 'tibetan', group: 'Outros idiomas', label: 'བོད་ཡིག · Microsoft Himalaya', family: '"Microsoft Himalaya"', sample: 'བཀྲ་ཤིས་བདེ་ལེགས།' },
    { id: 'myanmar', group: 'Outros idiomas', label: 'မြန်မာ · Myanmar Text', family: '"Myanmar Text"', sample: 'မင်္ဂလာပါ' },
  ];
  // Nome de fonte digitado ou vindo da lista do PC: só letras, números, espaço e pontuação simples (vira string CSS)
  function fontName(value) {
    if (typeof value !== 'string') return '';
    const s = value.trim().replace(/\s+/g, ' ');
    return /^[\p{L}\p{N} ._'&+-]{1,64}$/u.test(s) ? s : '';
  }
  // Fonte do nome: vai para a sala (só o id da lista, nunca um nome livre) e cada um desenha com as fontes do
  // próprio PC. '' ou id desconhecido = fonte padrão do app.
  const cleanNameFont = id => typeof id === 'string' && id !== 'system' && fonts.some(f => f.id === id) ? id : '';
  function nameFontStack(id) {
    const f = fonts.find(x => x.id === cleanNameFont(id));
    return f ? `${f.family}, ${baseStack}` : '';
  }
  function fontStacks(font) {
    const f = fonts.find(x => x.id === font?.family);
    let family = f?.family || '';
    if (font?.family === 'custom' && fontName(font.custom)) family = `"${fontName(font.custom)}"`;
    const body = family ? `${family}, ${baseStack}` : baseStack;
    const display = family ? body : fonts[0].display;
    return { body, display, console: font?.chat && family ? body : 'Tahoma, Verdana, sans-serif' };
  }
  const defaults = { colors: { main: '#22271E', secondary: '#2D3327', detail1: '#D6C45C', detail2: '#A6D089', text: '', live: '', speaking: '', warn: '', line: '' },
    appearance: { glass: 'opaque', level: glassLevel.clear, border: 'solid', wallpaper: '', blur: 0, dim: 40, ambient: true },
    font: { family: 'system', custom: '', chat: false }, nameFont: '',
    sounds: { join: 'notification035', leave: 'whoosh', chat: 'wood', voiceJoin: 'suaveEntrou', voiceLeave: 'suaveSaiu',
      mute: 'suaveMutou', unmute: 'suaveDesmutou', deafen: 'suaveFoneDesligou', undeafen: 'suaveFoneLigou',
      shareStart: 'suaveTransmitiu', shareStop: 'suaveParouTransmitir', mention: 'suaveMencao',
      chatMuted: false, volume: 50, levels: { join: 100, leave: 100, chat: 100, mention: 100, voiceJoin: 100, voiceLeave: 100, mute: 100, unmute: 100, deafen: 100, undeafen: 100, shareStart: 100, shareStop: 100 } } };
  // Temas prontos (Aparência > Temas): cores e material de uma vez. As cores de detalhe que não aparecem aqui
  // voltam ao automático. Mantêm a leitura do app: destaque = você/ao vivo, detalhe 2 = quem fala.
  const themes = [
    { id: 'lanhouse', label: 'Lan house', colors: { main: '#22271E', secondary: '#2D3327', detail1: '#D6C45C', detail2: '#A6D089' }, appearance: { glass: 'opaque', border: 'solid' } },
    { id: 'meianoite', label: 'Meia-noite', colors: { main: '#0E1220', secondary: '#1A2036', detail1: '#7AA2F7', detail2: '#9ECE6A' }, appearance: { glass: 'liquid', level: 55, border: 'liquid' } },
    { id: 'neon', label: 'Neon', colors: { main: '#0B0A14', secondary: '#1A1730', detail1: '#FF4FB3', detail2: '#3EF0C8' }, appearance: { glass: 'clear', level: 70, border: 'clear' } },
    { id: 'grafite', label: 'Grafite', colors: { main: '#1B1D22', secondary: '#2A2D35', detail1: '#E6A55A', detail2: '#7CC6A4' }, appearance: { glass: 'liquid', level: 45, border: 'solid' } },
    { id: 'claro', label: 'Claro', colors: { main: '#EEF2F8', secondary: '#FFFFFF', detail1: '#3455DB', detail2: '#147D55' }, appearance: { glass: 'opaque', border: 'solid' } },
    { id: 'contraste', label: 'Alto contraste', colors: { main: '#000000', secondary: '#0D0D0D', detail1: '#FFD400', detail2: '#00FF6E', text: '#FFFFFF', line: '#FFFFFF' }, appearance: { glass: 'opaque', border: 'solid' } },
  ];
  // Temas (Configurações > Tema): mudam o desenho do app inteiro, não só as cores. Escolher um aplica as cores dele
  // (dá para ajustar depois na aba Cores sem perder o desenho). '' = o visual padrão. O desenho do Arasaka
  // (Cyberpunk 2077) fica em styles-arasaka.css, sob html[data-skin=arasaka].
  const skins = [
    { id: '', label: 'Padrão', note: 'O visual normal do app, com as cores que você escolher.' },
    { id: 'arasaka', label: 'Arasaka', note: 'Cyberpunk 2077: preto, vermelho em listras de monitor, cantos retos e o emblema da corporação.',
      colors: { main: '#000000', secondary: '#080B0C', detail1: '#FF1F4F', detail2: '#5DE4C7', text: '#CFD6D4', line: '#233031' }, appearance: { glass: 'opaque', border: 'solid' } },
    // E.V.A by Asock: dentro do Entry Plug do EVA-01. Roxo da armadura nos painéis, laranja do HUD no destaque
    // (você/ao vivo), verde de quem fala e amarelo de alerta. O desenho fica em styles-eva.css (html[data-skin=eva]).
    { id: 'eva', label: 'E.V.A by Asock', note: 'Evangelion: o cockpit do EVA-01. Roxo e laranja, HUD de sincronia, letreiros em japonês e o chat num terminal.',
      colors: { main: '#07040C', secondary: '#170C29', detail1: '#FF8A1F', detail2: '#A3F43C', warn: '#FFD23F', text: '#EFE6FF', line: '#3F2468' }, appearance: { glass: 'opaque', border: 'solid' } },
  ];
  const cleanSkin = (id) => skins.some((k) => k.id && k.id === id) ? id : '';
  // Preferências com o tema aplicado (o resto, como fontes e sons, fica como está)
  function applyTheme(prefs, id) {
    const t = themes.find(x => x.id === id) || skins.find(x => x.id && x.id === id);
    if (!t) return normalize(prefs);
    const colors = { ...defaults.colors, text: '', live: '', speaking: '', warn: '', line: '', ...t.colors };
    // Tema sem fundo próprio: a imagem da pessoa (custom) fica, com o desfoque dela; a de outro tema sai
    const before = normalize(prefs).appearance;
    const keep = !t.appearance.wallpaper && before.wallpaper === 'custom' ? { wallpaper: 'custom', blur: before.blur, dim: before.dim } : {};
    const appearance = { ...defaults.appearance, level: glassLevel[t.appearance.glass] ?? defaults.appearance.level, ambient: before.ambient, ...keep, ...t.appearance };
    return normalize({ ...prefs, colors, appearance });
  }
  // Qual tema pronto bate com as preferências atuais ('' = personalizado). Desfoque, escurecer e fonte não contam.
  // Material, bordas e imagem de fundo ficam livres: trocar Opaco, Transparente, Líquido ou Normal não tira o tema;
  // se bater exato com um tema, é ele, senão o primeiro com as mesmas cores.
  function currentTheme(prefs) {
    const p = normalize(prefs);
    const same = keys => t => {
      const n = applyTheme(p, t.id);
      return JSON.stringify(n.colors) === JSON.stringify(p.colors) && keys.every(k => n.appearance[k] === p.appearance[k]);
    };
    return (themes.find(same(['glass', 'border', 'wallpaper'])) || themes.find(same([])))?.id || '';
  }
  function hex(value) {
    if (typeof value !== 'string') return null;
    const s = value.trim().replace(/^#/, '');
    if (/^[\da-f]{3}$/i.test(s)) return '#' + [...s].map(c => c + c).join('').toUpperCase();
    return /^[\da-f]{6}$/i.test(s) ? '#' + s.toUpperCase() : null;
  }
  function normalize(raw) {
    const result = { colors: { ...defaults.colors }, appearance: { ...defaults.appearance }, font: { ...defaults.font },
      nameFont: cleanNameFont(raw?.nameFont), sounds: { ...defaults.sounds, levels: { ...defaults.sounds.levels } } };
    if (borderModes.includes(raw?.appearance?.border)) result.appearance.border = raw.appearance.border;
    if (glassModes.includes(raw?.appearance?.glass)) result.appearance.glass = raw.appearance.glass;
    const level = raw?.appearance?.level;
    if (typeof level === 'number' && Number.isFinite(level)) result.appearance.level = Math.max(0, Math.min(100, Math.round(level)));
    const wall = raw?.appearance?.wallpaper;
    if (wall === 'custom' || wallpapers.some(w => w.id === wall)) result.appearance.wallpaper = wall;
    for (const k of ['blur', 'dim']) {
      const v = raw?.appearance?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) result.appearance[k] = Math.max(0, Math.min(wallpaperLimits[k], Math.round(v)));
    }
    if (typeof raw?.appearance?.ambient === 'boolean') result.appearance.ambient = raw.appearance.ambient;
    const custom = fontName(raw?.font?.custom);
    if (raw?.font?.family === 'custom' ? !!custom : fonts.some(f => f.id === raw?.font?.family)) result.font.family = raw.font.family;
    result.font.custom = custom;
    if (typeof raw?.font?.chat === 'boolean') result.font.chat = raw.font.chat;
    for (const field of Object.keys(result.colors)) result.colors[field] = hex(raw?.colors?.[field]) || result.colors[field];
    for (const event of events) {
      const id = raw?.sounds?.[event];
      if (id === 'none' || sounds.some(s => s.id === id)) result.sounds[event] = id;
      const level = raw?.sounds?.levels?.[event];
      if (typeof level === 'number' && Number.isFinite(level)) result.sounds.levels[event] = Math.max(0, Math.min(100, Math.round(level)));
    }
    if (typeof raw?.sounds?.chatMuted === 'boolean') result.sounds.chatMuted = raw.sounds.chatMuted;
    const volume = raw?.sounds?.volume;
    if (typeof volume === 'number' && Number.isFinite(volume)) result.sounds.volume = Math.max(0, Math.min(100, Math.round(volume)));
    return result;
  }
  function read(storage) { try { return normalize(JSON.parse(storage.getItem(key))); } catch { return normalize(null); } }
  function write(storage, value) { const normalized = normalize(value); storage.setItem(key, JSON.stringify(normalized)); return normalized; }
  const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  function mix(a, b, ratio) {
    const other = rgb(b);
    return '#' + rgb(a).map((x, i) => Math.round(x * (1 - ratio) + other[i] * ratio).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  // Texto preto ou branco sobre uma cor: o que tiver mais contraste pelo APCA (o contraste perceptivo do WCAG 3).
  // O limiar antigo (luminância 0,179, do WCAG 2) punha preto cedo demais em tons médios: #787878 ficava com texto
  // preto apagado, e azul, verde e rosa médios também. Pelo APCA, o cinza só passa para texto preto em #A4A4A4.
  function apcaY(c) {
    const [r, g, b] = rgb(c).map(v => (v / 255) ** 2.4);
    const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    return y < 0.022 ? y + (0.022 - y) ** 1.414 : y;
  }
  function apcaContrast(text, bg) {
    const t = apcaY(text), b = apcaY(bg);
    if (b > t) { const s = (b ** 0.56 - t ** 0.57) * 1.14; return s < 0.1 ? 0 : (s - 0.027) * 100; }
    const s = (b ** 0.65 - t ** 0.62) * 1.14; return s > -0.1 ? 0 : (s + 0.027) * 100;
  }
  const ink = c => Math.abs(apcaContrast('#000000', c)) > Math.abs(apcaContrast('#FFFFFF', c)) ? '#000000' : '#FFFFFF';
  const alpha = (c, a) => `rgba(${rgb(c).join(', ')}, ${a})`;
  function palette(colors) {
    const c = normalize({ colors }).colors;
    const text = c.text || ink(c.main), surface = c.text || ink(c.secondary), muted = mix(surface, c.secondary, .32);
    const live = c.live || c.detail1, speaking = c.speaking || c.detail2, warn = c.warn || c.detail2;
    const line = c.line || mix(c.secondary, surface, .18);
    return {
      '--bg': c.main, '--bg-solid': c.main, '--panel': c.secondary, '--sunken': mix(c.secondary, '#000000', .15),
      '--panel-2': mix(c.secondary, surface, .07), '--panel-3': mix(c.secondary, surface, .13),
      '--text': text, '--text-2': mix(text, c.main, .15), '--muted': mix(text, c.main, .3),
      '--surface-text': surface, '--surface-text-2': mix(surface, c.secondary, .15), '--surface-muted': muted,
      '--line': line, '--line-strong': c.line ? mix(c.line, surface, .15) : mix(c.secondary, surface, .3), '--field-line': c.line ? mix(c.line, surface, .3) : mix(c.secondary, surface, .45),
      '--primary': c.detail1, '--primary-hover': mix(c.detail1, ink(c.detail1), .12), '--primary-ink': ink(c.detail1),
      '--accent': c.detail1, '--accent-ink': ink(c.detail1), '--accent-soft': alpha(c.detail1, .14),
      '--live': live, '--live-fill': live, '--live-ink': ink(live),
      '--ok': speaking, '--ok-soft': alpha(speaking, .1), '--warn': warn, '--warn-soft': alpha(warn, .12),
      '--thumb': mix(c.secondary, '#000000', .15), '--theme-glass': alpha(c.secondary, .94),
      '--on-video': '#FFFFFF', '--scrim': 'rgba(0, 0, 0, .65)',
      'color-scheme': ink(c.main) === '#000000' ? 'light' : 'dark', // barras de rolagem e campos seguem o texto
    };
  }
  // Superfícies de vidro: as mesmas cores, com transparência. level 0 = quase opaco, 100 = quase invisível.
  // "clear" é o vidro limpo (muito transparente, pouco desfoque); "liquid" desfoca e satura mais, com brilho nas bordas.
  function glass(colors, appearance) {
    const c = normalize({ colors }).colors, a = normalize({ appearance }).appearance;
    if (a.glass === 'opaque') return null;
    const t = a.level / 100, liquid = a.glass === 'liquid';
    const panel = +(0.92 - t * (liquid ? 0.7 : 0.8)).toFixed(3);
    const round = n => +Math.max(0, Math.min(1, n)).toFixed(3);
    return {
      '--bg': alpha(c.main, round(panel * 0.55)), '--panel': alpha(c.secondary, panel),
      '--panel-2': alpha(mix(c.secondary, ink(c.secondary), .07), round(panel + .08)),
      '--panel-3': alpha(mix(c.secondary, ink(c.secondary), .13), round(panel + .14)),
      '--sunken': alpha(mix(c.secondary, '#000000', .15), round(panel + .1)),
      '--theme-glass': alpha(c.secondary, round(panel + .1)),
      // Onde se lê bastante (diálogos, listas de opções, cartões, avisos): nunca abaixo de 78%, para o texto
      // não se misturar com o que está atrás, por mais transparente que o resto esteja
      '--panel-strong': alpha(c.secondary, round(Math.max(.78, panel + .2))),
      '--scrim': `rgba(0, 0, 0, ${round(.2 + panel * .3)})`,
      '--glass-base': c.main, '--glass-blur': liquid ? '24px' : '12px',
      '--glass-saturate': liquid ? '1.9' : '1.25',
      '--glass-edge': alpha(ink(c.secondary), liquid ? .28 : .16),
      '--glass-sheen': alpha('#FFFFFF', liquid ? .22 : .08),
    };
  }
  // Bordas de vidro: "clear" deixa a cor das bordas translúcida; "liquid" clareia a borda e acende o alto dela
  // (--edge-sheen), como a luz batendo na quina de um vidro. Valem em qualquer material, inclusive no Opaco.
  function borders(colors, appearance) {
    const c = normalize({ colors }).colors, a = normalize({ appearance }).appearance;
    if (a.border === 'solid') return null;
    const p = palette(colors), liquid = a.border === 'liquid';
    const edge = (color, amount) => liquid ? alpha(mix(color, '#FFFFFF', .35), amount) : alpha(color, amount * .8);
    return {
      '--line': edge(p['--line'], .45), '--line-strong': edge(p['--line-strong'], .6), '--field-line': edge(p['--field-line'], .7),
      '--edge-sheen': liquid ? alpha('#FFFFFF', .42) : alpha(ink(c.secondary), .18),
    };
  }
  // Toca um som "Suave" pelo Web Audio; devolve um objeto com pause() para o stop() funcionar igual
  function synthTone(notes, volume) {
    const ctx = synthTone.ctx || (synthTone.ctx = new AudioContext());
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.02;
    const nodes = [];
    for (const [f, start, dur, rel] of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      const s = t0 + start, peak = Math.max(0.0002, 0.9 * rel * volume);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(peak, s + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(s); o.stop(s + dur + 0.02);
      nodes.push(o);
    }
    return { pause() { for (const o of nodes) try { o.stop(); } catch {} }, currentTime: 0 };
  }
  class SoundPlayer {
    constructor({ settings, createAudio = url => new Audio(url), synth = synthTone, now = () => Date.now() }) {
      Object.assign(this, { settings, createAudio, synth, now }); this.players = new Map(); this.last = new Map();
    }
    stop(event) {
      const player = this.players.get(event);
      if (player) { player.pause(); player.currentTime = 0; this.players.delete(event); }
    }
    async play(event, preview = false) {
      const config = this.settings().sounds;
      if (!events.includes(event) || (!preview && event === 'chat' && config.chatMuted)) return false;
      const sound = sounds.find(s => s.id === config[event]);
      const volume = config.volume / 100 * (config.levels?.[event] ?? 100) / 100;
      if (!sound || !volume) return false;
      const slot = preview ? 'preview' : event;
      const time = this.now();
      if (!preview && time - (this.last.get(slot) ?? -Infinity) < 180) return false;
      this.last.set(slot, time);
      this.stop(slot);
      let player;
      try {
        if (sound.synth) { this.players.set(slot, this.synth(sound.synth, volume)); return true; }
        player = this.createAudio('assets/audio/' + sound.file);
        player.volume = volume;
        this.players.set(slot, player);
        player.onended = () => { if (this.players.get(slot) === player) this.players.delete(slot); };
        await player.play(); return true;
      } catch { if (this.players.get(slot) === player) this.stop(slot); return false; }
    }
    stopAll() { for (const event of [...this.players.keys()]) this.stop(event); }
  }
  return { key, sounds, events, defaults, optionalColors, glassModes, glassLevel, borderModes, fonts,
    wallpapers, wallpaperKey, wallpaperLimits, wallpaperUrl, cleanWallpaperData, fontName, fontStacks, cleanNameFont, nameFontStack, borders, themes, skins, cleanSkin, applyTheme, currentTheme, hex, normalize, read, write, palette, glass, SoundPlayer };
})();
if (typeof module !== 'undefined') module.exports = AppPreferences;
