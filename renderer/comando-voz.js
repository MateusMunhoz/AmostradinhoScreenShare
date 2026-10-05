'use strict';
// Comando de voz (recurso extra, docs/spec/comando-de-voz.md): segurar a tecla (Ctrl+Shift+V) e falar. Enquanto ela
// está apertada, a call não ouve você. Soltou: o áudio (16 kHz, na memória) vai para o Whisper deste PC
// (main/comando-voz.js), o texto vira um comando pelas regras (comando-voz-regras.js) e o app faz o que foi pedido.
// Configurações › Recursos extras liga, baixa o Whisper e escolhe o modelo. Desligado, nada roda e nada é baixado.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado, voz, microfone,
// subsalas, assistir, pip, transmitir.

const comandoVoz = {
  ligado: load('comandoVoz', '0') === '1',
  modelo: load('comandoVozModelo', 'leve') === 'preciso' ? 'preciso' : 'leve',
  // Como o app confirma: 'som' (toque de feito ou de recusa, o padrão), 'voz' (a voz do Windows fala) ou 'nada'
  confirmar: ['som', 'voz', 'nada'].includes(load('comandoVozConfirmar', 'som')) ? load('comandoVozConfirmar', 'som') : 'som',
  estado: null,      // o que o processo principal tem baixado: { suportado, programa, modelos, baixando }
  gravando: false,   // a tecla está apertada: a call não ouve (applyMicGate, microfone.js)
  entendendo: false,
  rec: null,         // gravando agora: { mic, pedacos, timer }
  espera: null,      // na voz: o microfone do comando já aberto, guardando só os últimos instantes (anel)
  abrindo: false,
  // Pedidos livres (etapa B): '' (desligado), 'local' (Ollama, LM Studio) ou 'nuvem' (Claude pela API da Anthropic)
  ia: {
    provedor: ['local', 'nuvem'].includes(load('comandoVozIa', '')) ? load('comandoVozIa', '') : '',
    url: load('comandoVozIaUrl', 'http://localhost:11434'),
    modeloLocal: load('comandoVozIaModeloLocal', 'qwen2.5:7b'),
    modeloNuvem: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'].includes(load('comandoVozIaModeloNuvem', '')) ? load('comandoVozIaModeloNuvem', '') : 'claude-opus-5-5',
  },
  iaEstado: { temChave: false, nuvem: true }, // do processo principal: se há chave guardada e se esta instalação tem a parte da nuvem
  coletando: null,   // fazendo várias ações de um pedido livre: os avisos se juntam num só
  pendente: null,    // ação esperando "sim" (parar a sua transmissão): { acao, ate }
  ultimo: '',        // o último texto ouvido (só na memória): aparece em Recursos extras, para conferir o que o Whisper entendeu
  erro: '',
};
const VOZ_CMD_MIN = 0.5;  // s: menos que isso é só um toque na tecla (Ctrl+Shift+V para colar texto): ignora calado
const VOZ_CMD_MAX = 10;   // s: depois disso, para de gravar sozinho
const VOZ_CMD_ANTES = 0.6; // s de antes da tecla que entram no comando (a primeira palavra não se perde)
const VOZ_CMD_DEPOIS = 150; // ms que continua gravando depois de soltar (o fim da última palavra)
const VOZ_CMD_MODELOS = { leve: 'Leve · 60 MB', preciso: 'Preciso · 190 MB' };

const vozCmdPronto = () => !!comandoVoz.estado?.programa && !!comandoVoz.estado?.modelos?.includes(comandoVoz.modelo);
// A tecla só fica ligada com o recurso ligado, tudo baixado e numa sala
function syncComandoVozTecla() {
  if (!window.api?.vozCmdTecla) return;
  window.api.vozCmdTecla(comandoVoz.ligado && vozCmdPronto() && !!state.myId).catch(() => {});
  void syncComandoVozMic();
}

// ---------- O microfone do comando ----------
// Aberto à parte do da call (com a supressão de ruído do Chromium): a porta de sensibilidade da call cortaria palavras
// baixas. 16 kHz direto (o Chromium converte); o ScriptProcessor é simples e só existe enquanto o microfone está aberto.
async function abrirMicComandoVoz() {
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: voiceCfg.micId ? { ...audio, deviceId: { ideal: voiceCfg.micId } } : audio });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const node = ctx.createScriptProcessor(2048, 1, 1);
  const mic = { stream, ctx, node, anel: new Float32Array(Math.round(16000 * VOZ_CMD_ANTES)), pos: 0, cheio: false };
  // Gravando: o pedaço vai para o comando; esperando: só fica no anel (os últimos 0,6 s, sobrescritos sem parar)
  node.onaudioprocess = (e) => {
    const x = e.inputBuffer.getChannelData(0);
    if (comandoVoz.rec?.mic === mic) return void comandoVoz.rec.pedacos.push(new Float32Array(x));
    for (let i = 0; i < x.length; i++) { mic.anel[mic.pos] = x[i]; mic.pos = (mic.pos + 1) % mic.anel.length; }
    if (x.length && mic.pos < x.length) mic.cheio = true;
  };
  ctx.createMediaStreamSource(stream).connect(node);
  node.connect(ctx.destination); // sem isso o Chromium não chama o onaudioprocess (a saída é silêncio)
  return mic;
}
function fecharMicComandoVoz(mic) {
  if (!mic) return;
  mic.node.onaudioprocess = null;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close().catch(() => {});
}
// O que o anel guardou, em ordem: o começo da frase, dito antes (ou no instante) de apertar a tecla
function anelComandoVoz(mic) {
  if (!mic.cheio) return mic.anel.slice(0, mic.pos);
  return Float32Array.from([...mic.anel.subarray(mic.pos), ...mic.anel.subarray(0, mic.pos)]);
}
// Na voz, o microfone já está em uso pela call: o do comando fica aberto junto, esperando a tecla, para a primeira
// palavra não se perder enquanto ele abriria. O que ele ouve fica só nesse anel de 0,6 s na memória (nada vai para a sala
// nem para o disco) e só entra num comando quando você aperta a tecla. Fora da voz, ele abre só quando você aperta.
async function syncComandoVozMic() {
  const quer = comandoVoz.ligado && vozCmdPronto() && !!state.myId && !!voice.session;
  if (quer === !!comandoVoz.espera || comandoVoz.abrindo) return;
  if (!quer) {
    if (comandoVoz.rec?.mic === comandoVoz.espera) comandoVoz.rec.dono = true; // gravando: fecha quando terminar
    else fecharMicComandoVoz(comandoVoz.espera);
    comandoVoz.espera = null;
    return;
  }
  comandoVoz.abrindo = true;
  try {
    const mic = await abrirMicComandoVoz();
    comandoVoz.espera = mic;
  } catch {} finally { comandoVoz.abrindo = false; }
  void syncComandoVozMic(); // mudou algo enquanto abria
}

// ---------- Gravar enquanto a tecla está apertada ----------
function onComandoVozTecla(down) {
  if (down) void comecarComandoVoz();
  else void terminarComandoVoz();
}
// Sons gerados na hora: [frequência Hz, início s, duração s]. Feito sobe; recusa desce, grave
const SONS_COMANDO_VOZ = {
  comeco: { tipo: 'sine', notas: [[880, 0, 0.12]] },
  fim: { tipo: 'sine', notas: [[660, 0, 0.12]] },
  ok: { tipo: 'sine', notas: [[660, 0, 0.09], [990, 0.08, 0.16]] },
  recusa: { tipo: 'triangle', notas: [[330, 0, 0.13], [220, 0.12, 0.24]] },
  pergunta: { tipo: 'sine', notas: [[740, 0, 0.1], [740, 0.14, 0.1]] }, // dois toques iguais: falta confirmar
};
function tocarComandoVoz(nome) {
  const som = SONS_COMANDO_VOZ[nome];
  if (!som) return;
  try {
    const ctx = new AudioContext();
    let fim = 0;
    for (const [freq, ini, dur] of som.notas) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = som.tipo;
      o.frequency.value = freq;
      const t = ctx.currentTime + ini;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(som.tipo === 'triangle' ? 0.16 : 0.09, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.01);
      fim = Math.max(fim, ini + dur);
    }
    setTimeout(() => ctx.close().catch(() => {}), (fim + 0.2) * 1000);
  } catch {}
}
// Toque de começo e fim da gravação (com a confirmação em Sons ou Voz)
function bipComandoVoz(freq) {
  if (comandoVoz.confirmar !== 'nada') tocarComandoVoz(freq > 700 ? 'comeco' : 'fim');
}
async function comecarComandoVoz() {
  if (!comandoVoz.ligado || comandoVoz.rec || comandoVoz.gravando) return;
  if (!state.myId) return toast('Entre numa sala para usar o comando de voz.');
  if (comandoVoz.entendendo) return;
  comandoVoz.gravando = true; // já corta a call, antes mesmo do microfone abrir
  applyMicGate();
  // Na voz, o microfone já está aberto: começa na hora, com o que foi dito logo antes da tecla
  if (comandoVoz.espera) {
    const mic = comandoVoz.espera;
    comandoVoz.rec = { mic, pedacos: [anelComandoVoz(mic)], timer: setTimeout(() => void terminarComandoVoz(), VOZ_CMD_MAX * 1000) };
    renderComandoVozSelo('Ouvindo…');
    return bipComandoVoz(880);
  }
  // Fora da voz: abre agora. O toque e o "Ouvindo…" só vêm quando ele abriu (fale depois do toque)
  renderComandoVozSelo('Abrindo o microfone…');
  let mic;
  try {
    mic = await abrirMicComandoVoz();
  } catch {
    pararGravacaoComandoVoz();
    renderComandoVozSelo('');
    return avisoComandoVoz('Não consegui abrir o microfone para o comando de voz.', true);
  }
  if (!comandoVoz.gravando) return fecharMicComandoVoz(mic); // soltou antes de abrir
  comandoVoz.rec = { mic, pedacos: [], dono: true, timer: setTimeout(() => void terminarComandoVoz(), VOZ_CMD_MAX * 1000) };
  renderComandoVozSelo('Ouvindo…');
  bipComandoVoz(880);
}
function pararGravacaoComandoVoz() {
  const rec = comandoVoz.rec;
  comandoVoz.rec = null;
  comandoVoz.gravando = false;
  applyMicGate();
  if (!rec) return null;
  clearTimeout(rec.timer);
  if (rec.dono) fecharMicComandoVoz(rec.mic); // o microfone da espera continua aberto
  else { rec.mic.pos = 0; rec.mic.cheio = false; } // o anel recomeça: o comando que passou não entra no próximo
  return rec;
}
function wavComandoVoz(pedacos) {
  const n = pedacos.reduce((t, p) => t + p.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (const p of pedacos) for (const s of p) { v.setInt16(o, Math.max(-1, Math.min(1, s)) * 0x7fff, true); o += 2; }
  return new Uint8Array(buf);
}
async function terminarComandoVoz() {
  if (!comandoVoz.rec) { pararGravacaoComandoVoz(); return renderComandoVozSelo(''); }
  const atual = comandoVoz.rec;
  await new Promise((r) => setTimeout(r, VOZ_CMD_DEPOIS)); // o fim da última palavra ainda está chegando
  if (comandoVoz.rec !== atual) return;
  const rec = pararGravacaoComandoVoz();
  const segundos = rec.pedacos.reduce((t, p) => t + p.length, 0) / 16000;
  if (segundos < VOZ_CMD_MIN) return renderComandoVozSelo(''); // só um toque na tecla
  bipComandoVoz(660);
  comandoVoz.entendendo = true;
  renderComandoVozSelo('Entendendo…');
  try {
    const pessoas = [...state.members].map(([id, m]) => ({ id, name: m.name }));
    const r = await window.api.vozCmdTranscrever(wavComandoVoz(rec.pedacos), comandoVoz.modelo, ComandoVozRegras.dica(pessoas.map((p) => p.name)));
    if (!r?.ok) {
      if (r?.reinstalar) { comandoVoz.estado = await window.api.vozCmdEstado().catch(() => comandoVoz.estado); renderComandoVozConfig(); }
      return avisoComandoVoz(r?.erro || 'O comando de voz falhou.', true);
    }
    comandoVoz.ultimo = r.texto;
    renderComandoVozConfig();
    const c = ComandoVozRegras.interpretar(r.texto, { pessoas, subsalas: state.subsalas || [] });
    // As regras primeiro (instantâneo, sem custo). O que elas não entendem, ou um pedido com várias coisas, vai para o
    // modelo de linguagem, se os pedidos livres estiverem ligados
    if (iaPronta() && (!c.ok || ComandoVozRegras.composto(r.texto))) await pedidoLivreComandoVoz(r.texto);
    else await executarComandoVoz(c, r.texto);
  } finally {
    comandoVoz.entendendo = false;
    renderComandoVozSelo('');
  }
}

// ---------- Fazer o que foi pedido ----------
// tipo: 'ok' (foi feito), 'recusa' (nada a fazer: já estava assim) ou true/'erro' (não deu: aviso vermelho)
function avisoComandoVoz(texto, tipo = 'ok') {
  if (comandoVoz.coletando) return void comandoVoz.coletando.push({ texto, tipo });
  const erro = tipo === true || tipo === 'erro';
  toast(texto, erro ? 'error' : undefined);
  if (comandoVoz.confirmar === 'som') return tocarComandoVoz(tipo === 'ok' || tipo === 'pergunta' ? tipo : 'recusa');
  if (comandoVoz.confirmar !== 'voz' || !window.speechSynthesis) return;
  try {
    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = 'pt-BR';
    const voz = speechSynthesis.getVoices().find((v) => /^pt(-|_)BR/i.test(v.lang));
    if (voz) fala.voice = voz;
    speechSynthesis.cancel();
    speechSynthesis.speak(fala);
  } catch {}
}
// Como o botão Entrar na voz, já no canal pedido
function entrarNaVozComando(ch = '') {
  if (state.systemLoopback) { avisoComandoVoz('Pare sua transmissão antes de entrar na voz: a captura atual inclui todo o som do PC.', true); return false; }
  mixer.ensure();
  voice.join(ch);
  return true;
}
const CANTOS = { tl: 'no canto esquerdo de cima', tr: 'no canto direito de cima', bl: 'no canto esquerdo de baixo', br: 'no canto direito de baixo' };
// ---------- Pedidos livres: o modelo de linguagem escolhe as ações (main/comando-voz-ia.js) ----------
const iaPronta = () => comandoVoz.ia.provedor === 'local' || (comandoVoz.ia.provedor === 'nuvem' && comandoVoz.iaEstado.temChave && comandoVoz.iaEstado.nuvem);
const opcoesIa = () => ({ provedor: comandoVoz.ia.provedor, modelo: comandoVoz.ia.provedor === 'nuvem' ? comandoVoz.ia.modeloNuvem : comandoVoz.ia.modeloLocal, url: comandoVoz.ia.url });
const canalDe = (id) => (voice.members.get(id)?.session ? channelName(voice.members.get(id).channel || '') : '');
// O estado da sala, para o modelo: quem está, quem transmite, o que você assiste, os canais e onde você está
function contextoIa() {
  return {
    pessoas: [...state.members].map(([id, m]) => ({ nome: m.name, transmitindo: !!m.sharing, assistindo: state.in.has(id), flutuante: state.pips.has(id), canal: canalDe(id) })),
    canais: ['Voz geral', ...(state.subsalas || []).map((s) => channelName(s.id))],
    eu: { canal: channelName(voice.session ? voice.channel : ''), naVoz: !!voice.session, mudo: !!voice.muted, transmitindo: !!state.sharing },
    musica: (() => { const e = musicaDoComando(); return e ? { tocando: !!e.playing, titulo: musicTitle(e) } : null; })(),
  };
}
async function pedidoLivreComandoVoz(texto) {
  renderComandoVozSelo('Pensando…');
  const ctx = contextoIa();
  const r = await window.api.vozIaEntender(texto, ctx, opcoesIa()).catch((err) => ({ ok: false, erro: String(err?.message || err) }));
  if (!r?.ok) return avisoComandoVoz(r?.erro || 'O modelo não respondeu.', true);
  if (!r.acoes?.length) return avisoComandoVoz(r.texto || 'Não sei fazer isso.', 'recusa');
  const limpo = ComandoVozAcoes.limparContexto(ctx);
  const idDe = (nome) => [...state.members].find(([, m]) => ComandoVozAcoes.limparNome(m.name) === nome)?.[0];
  const chDe = (canal) => (canal === 'Voz geral' ? '' : (state.subsalas || []).find((s) => channelName(s.id) === canal)?.id);
  const itens = (comandoVoz.coletando = []);
  try {
    for (const a of r.acoes) {
      const c = ComandoVozAcoes.converter(a.nome, a.input, limpo);
      if (!c.ok) { itens.push({ texto: c.erro, tipo: 'erro' }); continue; }
      const cmd = { ...c };
      if (c.pessoa) cmd.id = idDe(c.pessoa);
      if ('canal' in c) cmd.ch = chDe(c.canal);
      if ((c.pessoa && !cmd.id) || ('canal' in c && cmd.ch === undefined)) { itens.push({ texto: 'A sala mudou enquanto o modelo pensava.', tipo: 'erro' }); continue; }
      await executarComandoVoz(cmd, texto);
    }
  } finally {
    comandoVoz.coletando = null;
  }
  const tipo = itens.some((i) => i.tipo === true || i.tipo === 'erro') ? 'erro' : itens.some((i) => i.tipo === 'pergunta') ? 'pergunta' : itens.every((i) => i.tipo === 'ok') ? 'ok' : 'recusa';
  avisoComandoVoz(itens.map((i) => i.texto).join(' '), tipo);
}

async function executarComandoVoz(c, texto) {
  if (!c.ok) {
    if (c.motivo === 'ambiguo') return avisoComandoVoz(`${c.candidatos.slice(0, -1).join(', ')} ou ${c.candidatos.at(-1)}? Fale de novo com o nome.`, true);
    if (c.motivo === 'pessoa') return avisoComandoVoz(c.ouvido ? `Não achei ${c.ouvido} na sala.` : 'De quem? Fale o nome junto.', true);
    if (c.motivo === 'subsala') return avisoComandoVoz(c.numero ? `Não existe a Subsala_${c.numero}.` : 'Qual subsala? Fale o número.', true);
    if (c.motivo === 'musica') return avisoComandoVoz('Qual música? Fale o nome junto ("toca Evidências").', true);
    // Sem os pedidos livres, diz onde ligar: com eles, o modelo entenderia do jeito que foi falado
    const dica = comandoVoz.ia.provedor ? 'Tente: "assistir o Fulano".' : 'Para pedir do seu jeito, ligue Pedidos livres em Recursos extras.';
    return avisoComandoVoz(`Não entendi. Ouvi: "${texto}". ${dica}`, true);
  }
  const nome = c.id ? nameOf(c.id) : '';
  const transmitindo = c.id && state.members.get(c.id)?.sharing;
  switch (c.acao) {
    case 'assistir':
      if (state.in.has(c.id)) return avisoComandoVoz(`Você já está assistindo ${nome}.`, 'recusa');
      if (!transmitindo) return avisoComandoVoz(`${nome} não está transmitindo.`, true);
      if (!canWatch(c.id)) return avisoComandoVoz(closedShareText(c.id), true);
      watch(c.id);
      return avisoComandoVoz(`Assistindo ${nome}.`);
    case 'parar':
      if (!state.in.has(c.id)) return avisoComandoVoz(`Você não está assistindo ${nome}.`, 'recusa');
      stopWatching(c.id);
      return avisoComandoVoz(`Parou de assistir ${nome}.`);
    case 'parar-todos': {
      const ids = [...state.in.keys()].filter((id) => state.members.has(id));
      if (!ids.length) return avisoComandoVoz('Você não está assistindo ninguém.', 'recusa');
      for (const id of ids) stopWatching(id);
      return avisoComandoVoz('Parou de assistir todo mundo.');
    }
    case 'flutuante': {
      if (!state.in.has(c.id)) {
        if (!transmitindo) return avisoComandoVoz(`${nome} não está transmitindo.`, true);
        if (!canWatch(c.id)) return avisoComandoVoz(closedShareText(c.id), true);
        watch(c.id);
      }
      if (!state.pips.has(c.id)) togglePip(c.id);
      // O processo principal só conhece a janela depois de ela abrir: o canto vem logo depois
      if (c.canto) setTimeout(() => window.api.pipGroup(c.id, { corner: c.canto }).catch(() => {}), 600);
      return avisoComandoVoz(`${nome} na janela flutuante${c.canto ? ` ${CANTOS[c.canto]}` : ''}.`);
    }
    case 'tirar-flutuante':
      if (!state.pips.has(c.id)) return avisoComandoVoz(`${nome} não está na janela flutuante.`, 'recusa');
      closePip(c.id);
      return avisoComandoVoz(`${nome} saiu da janela flutuante.`);
    case 'voz-entrar':
      if (voice.session || voice.pending) return avisoComandoVoz('Você já está na voz.', 'recusa');
      if (entrarNaVozComando()) avisoComandoVoz('Entrando na voz.');
      return;
    case 'voz-sair':
      if (!voice.session && !voice.pending) return avisoComandoVoz('Você não está na voz.', 'recusa');
      voice.leave();
      return avisoComandoVoz('Saiu da voz.');
    case 'mic-off':
    case 'mic-on': {
      if (!voice.session) return avisoComandoVoz('Você não está na voz.', 'recusa');
      const desligar = c.acao === 'mic-off';
      if (voice.muted !== desligar) voice.mute();
      return avisoComandoVoz(desligar ? 'Microfone desligado.' : 'Microfone ligado.');
    }
    case 'canal':
      if (voice.session && voice.channel === c.ch) return avisoComandoVoz(`Você já está em ${channelName(c.ch)}.`, 'recusa');
      if (voice.session) voice.setChannel(c.ch);
      else if (voice.pending || !entrarNaVozComando(c.ch)) return;
      return avisoComandoVoz(`Indo para ${channelName(c.ch)}.`);
    case 'canal-pessoa': {
      const v = voice.members.get(c.id);
      if (!v?.session) return avisoComandoVoz(`${nome} não está na voz.`, 'recusa');
      return executarComandoVoz({ ok: true, acao: 'canal', ch: v.channel || '' }, texto);
    }

    // ---------- Música (renderer/musica.js): a do seu canal, ou a que você está ouvindo ----------
    case 'musica-pausar':
    case 'musica-continuar':
    case 'musica-parar': {
      const e = musicaDoComando();
      if (!e) return avisoComandoVoz('Não tem música tocando no seu canal.', 'recusa');
      if (!canControlMusic(e)) return avisoComandoVoz(`Só quem está em ${channelName(e.ch)} controla essa música.`, true);
      if (c.acao === 'musica-parar') { musicCtl(e, 'stop'); return avisoComandoVoz('Música parada.'); }
      const tocar = c.acao === 'musica-continuar';
      if (e.playing === tocar) return avisoComandoVoz(tocar ? 'A música já está tocando.' : 'A música já está pausada.', 'recusa');
      musicCtl(e, tocar ? 'play' : 'pause', { pos: musicPos(e) });
      return avisoComandoVoz(tocar ? 'Música tocando.' : 'Música pausada.');
    }
    case 'musica-por': {
      if (!state.musicaOn) return avisoComandoVoz('O host desta sala não tem a música junto (versão antiga).', true);
      const r = await window.api.vozCmdYoutube(c.busca).catch(() => null);
      if (!r?.ok) return avisoComandoVoz(r?.erro || 'Não consegui buscar no YouTube.', true);
      const ch = myVoiceChannel();
      const e = state.musicas.get(ch);
      if (e) {
        if (!canControlMusic(e)) return avisoComandoVoz(`Só quem está em ${channelName(ch)} troca a música de lá.`, true);
        musicCtl(e, 'trocar', { videoId: r.videoId, title: r.title });
      } else {
        musica.wantOpen = ch; // a tela da música abre quando a sala confirmar
        send({ type: 'musica-set', videoId: r.videoId, title: r.title });
      }
      return avisoComandoVoz(`Tocando: ${r.title}.`);
    }

    // ---------- Som: a voz ou a transmissão de alguém, e todas as vozes (o fone) ----------
    case 'volume': {
      const v = volOf(c.id);
      if (c.alvo === 'live') {
        const link = state.in.get(c.id);
        if (!link || link.music) return avisoComandoVoz(`Você não está assistindo ${nome}.`, 'recusa');
        if (c.mudanca === 'silenciar') { link.tile.userMuted = true; applyScreenVolume(c.id); return avisoComandoVoz(`Live de ${nome} sem som.`); }
        const screen = c.mudanca === 'abaixar' ? Math.max(0, v.screen - 25) : c.mudanca === 'aumentar' ? Math.min(100, v.screen + 25) : v.screen > 0 ? v.screen : 70;
        link.tile.userMuted = screen === 0;
        setVol(c.id, { screen, muted: false });
        return avisoComandoVoz(`Som da live de ${nome}: ${screen}%.`);
      }
      if (c.mudanca === 'silenciar') { setVol(c.id, { muted: true }); return avisoComandoVoz(`${nome} silenciado para você.`); }
      const voz = c.mudanca === 'abaixar' ? Math.max(0, v.voice - 30) : c.mudanca === 'aumentar' ? Math.min(200, v.voice + 30) : v.voice || DEFAULT_VOICE;
      setVol(c.id, { voice: voz, muted: false });
      return avisoComandoVoz(`Voz de ${nome}: ${voz}%.`);
    }
    case 'fone': {
      if (!voice.session) return avisoComandoVoz('Você não está na voz.', 'recusa');
      if (voice.deafened === c.silenciar) return avisoComandoVoz(c.silenciar ? 'As vozes já estão silenciadas.' : 'Você já está ouvindo todo mundo.', 'recusa');
      voice.deafen();
      return avisoComandoVoz(c.silenciar ? 'Vozes silenciadas (o microfone desliga junto).' : 'Ouvindo todo mundo de novo.');
    }

    // ---------- Destaque, tela cheia e clipe ----------
    case 'destaque':
    case 'tela-cheia': {
      if (!c.id) {
        if (c.acao === 'tela-cheia') { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); return avisoComandoVoz('Saiu da tela cheia.'); }
        if (!state.focus) return avisoComandoVoz('Nenhuma tela está em destaque.', 'recusa');
        setFocus(null);
        return avisoComandoVoz('Destaque desligado.');
      }
      if (!state.in.has(c.id)) {
        if (!transmitindo) return avisoComandoVoz(`${nome} não está transmitindo.`, true);
        if (!canWatch(c.id)) return avisoComandoVoz(closedShareText(c.id), true);
        watch(c.id);
      }
      setFocus(c.id);
      // Com uma tela só, não existe destaque: ela já ocupa a área toda
      if (c.acao === 'destaque') return avisoComandoVoz(state.in.size < 2 ? `${nome} já ocupa a tela toda (é a única aberta).` : `${nome} em destaque.`);
      const el = state.in.get(c.id)?.tile?.el;
      if (el && document.fullscreenElement !== el) await el.requestFullscreen().catch(() => {});
      return avisoComandoVoz(document.fullscreenElement === el ? `${nome} em tela cheia.` : `${nome} em destaque (a tela cheia não abriu).`);
    }
    case 'clipe': {
      const id = c.id || clipTargetId();
      if (!id || !clipReady(id)) return avisoComandoVoz(`Nada para clipar${c.id ? ` de ${nome}` : ''} agora. Abra uma transmissão (ou transmita) e espere uns segundos.`, true);
      void saveClip(id); // o aviso com "Mostrar na pasta" vem dele
      return avisoComandoVoz(`Salvando o clipe de ${id === state.myId ? 'você' : nameOf(id)}.`);
    }

    // ---------- A sua transmissão (renderer/transmitir.js) ----------
    case 'parar-transmissao':
      if (!state.sharing) return avisoComandoVoz('Você não está transmitindo.', 'recusa');
      // Não dá para desfazer: só com "sim" no comando seguinte, em até 15 s
      comandoVoz.pendente = { acao: 'parar-transmissao', ate: Date.now() + 15000 };
      return avisoComandoVoz('Parar a sua transmissão? Segure a tecla e diga "sim".', 'pergunta');
    case 'confirmar': {
      const p = comandoVoz.pendente;
      comandoVoz.pendente = null;
      if (!p || p.ate < Date.now()) return avisoComandoVoz('Nada para confirmar agora.', 'recusa');
      if (p.acao === 'parar-transmissao' && state.sharing) { stopSharing(); return avisoComandoVoz('Transmissão encerrada.'); }
      return avisoComandoVoz('Nada para confirmar agora.', 'recusa');
    }
    case 'cancelar':
      if (!comandoVoz.pendente) return avisoComandoVoz('Nada para cancelar.', 'recusa');
      comandoVoz.pendente = null;
      return avisoComandoVoz('Cancelado.');
    case 'transmissao-canal':
      if (!state.sharing) return avisoComandoVoz('Você não está transmitindo.', 'recusa');
      if ((state.shareOpen !== false) === c.aberta) return avisoComandoVoz(c.aberta ? 'Sua transmissão já está aberta para a sala toda.' : `Sua transmissão já é só para ${channelName(myVoiceChannel())}.`, 'recusa');
      state.shareOpen = c.aberta;
      sendShareInfo();
      syncShareOpen();
      return avisoComandoVoz(c.aberta ? 'Sua transmissão está aberta para a sala toda.' : `Agora só quem está em ${channelName(myVoiceChannel())} assiste você.`);
  }
}
// A música que o comando controla: a do seu canal; sem ela, a que você está ouvindo
function musicaDoComando() {
  const ch = myVoiceChannel();
  if (state.musicas.has(ch)) return state.musicas.get(ch);
  const ouvindo = [...state.in.values()].find((l) => l.music)?.music;
  return ouvindo ? state.musicas.get(ouvindo.ch) || null : null;
}

// Selo "Ouvindo…" / "Entendendo…" no canto da janela (parado, sem animação)
function renderComandoVozSelo(texto) {
  const el = $('voiceCmdBadge');
  if (!el) return;
  el.textContent = texto;
  el.hidden = !texto;
}

// ---------- Configurações › Recursos extras ----------
function renderComandoVozConfig() {
  const e = comandoVoz.estado;
  const suportado = e ? e.suportado : window.api?.platform === 'win32';
  $('vozCmdOn').checked = comandoVoz.ligado;
  $('vozCmdOn').disabled = !suportado || !!e?.baixando;
  for (const r of document.querySelectorAll('input[name="vozCmdModelo"]')) { r.checked = r.value === comandoVoz.modelo; r.disabled = !!e?.baixando; }
  for (const r of document.querySelectorAll('input[name="vozCmdConfirmar"]')) r.checked = r.value === comandoVoz.confirmar;
  // Pedidos livres
  const ia = comandoVoz.ia;
  for (const r of document.querySelectorAll('input[name="vozIa"]')) {
    r.checked = r.value === ia.provedor;
    if (r.value === 'nuvem') {
      r.disabled = !comandoVoz.iaEstado.nuvem;
      r.parentElement.title = comandoVoz.iaEstado.nuvem ? 'Claude, pela API da Anthropic: entende melhor e não pesa no PC; precisa de internet e da sua chave' : 'Esta instalação ainda não tem a parte da nuvem: instale o Tela P2P pelo instalador novo';
    }
  }
  $('vozIaLocal').hidden = ia.provedor !== 'local';
  $('vozIaNuvem').hidden = ia.provedor !== 'nuvem';
  $('vozIaTestarLinha').hidden = !ia.provedor;
  if (document.activeElement !== $('vozIaUrl')) $('vozIaUrl').value = ia.url;
  if (document.activeElement !== $('vozIaModeloLocal')) $('vozIaModeloLocal').value = ia.modeloLocal;
  $('vozIaModeloNuvem').value = ia.modeloNuvem;
  $('vozIaChave').placeholder = comandoVoz.iaEstado.temChave ? 'Chave guardada (digite outra para trocar)' : 'sk-ant-…';
  $('vozIaApagarChave').hidden = !comandoVoz.iaEstado.temChave;
  window.api?.getShortcuts?.().then((k) => { $('vozCmdKey').textContent = accelLabel(k?.voiceCmd || ''); }).catch(() => {});
  $('vozCmdBaixar').hidden = !e?.baixando;
  const baixado = !!e && (e.programa || e.modelos.length > 0);
  $('vozCmdRemover').hidden = !baixado || !!e?.baixando || comandoVoz.ligado;
  let status = '';
  if (!suportado) status = 'Por enquanto, só no Windows.';
  else if (comandoVoz.erro) status = comandoVoz.erro;
  else if (e?.baixando) status = '';
  else if (comandoVoz.ligado && vozCmdPronto()) status = comandoVoz.ultimo ? `Ligado. Último comando ouvido: "${comandoVoz.ultimo}"` : 'Ligado. Funciona dentro de uma sala.';
  else if (!comandoVoz.ligado) status = baixado ? 'Desligado. O download continua guardado neste PC.' : 'Desligado. Nada foi baixado.';
  $('vozCmdStatus').textContent = status;
}
async function atualizarComandoVoz() {
  if (!window.api?.vozCmdEstado) return;
  comandoVoz.estado = await window.api.vozCmdEstado().catch(() => null);
  comandoVoz.iaEstado = await window.api.vozIaEstado?.().catch(() => null) || comandoVoz.iaEstado;
  // Ligado, mas o download sumiu (apagado à mão): desliga em vez de falhar na hora de usar
  if (comandoVoz.ligado && comandoVoz.estado && !vozCmdPronto() && !comandoVoz.estado.baixando) {
    comandoVoz.ligado = false;
    save('comandoVoz', '0');
  }
  renderComandoVozConfig();
  syncComandoVozTecla();
}
// Ligar (ou trocar de modelo com ele ligado): baixa o que falta, com a confirmação do tamanho
async function ligarComandoVoz() {
  comandoVoz.erro = '';
  if (!vozCmdPronto()) {
    const falta = (comandoVoz.estado?.programa ? 0 : 9) + (comandoVoz.modelo === 'preciso' ? 190 : 60);
    const ok = await appConfirm(`Para entender a sua voz neste PC, o app precisa baixar o reconhecimento de fala (Whisper), uns ${falta} MB. Depois disso, funciona sem internet e o áudio nunca sai do PC.`,
      { title: 'Comando de voz', ok: 'Baixar e ligar' });
    if (!ok) { comandoVoz.ligado = false; return renderComandoVozConfig(); }
    comandoVoz.estado = { ...(comandoVoz.estado || {}), baixando: true };
    renderComandoVozConfig();
    $('vozCmdProgresso').value = 0;
    $('vozCmdProgressoTexto').textContent = 'Começando…';
    const r = await window.api.vozCmdInstalar(comandoVoz.modelo).catch((err) => ({ ok: false, erro: String(err?.message || err) }));
    if (!r?.ok) {
      comandoVoz.ligado = false;
      save('comandoVoz', '0');
      comandoVoz.erro = r?.cancelado ? '' : `Não foi possível baixar: ${r?.erro || 'erro desconhecido'}`;
      return atualizarComandoVoz();
    }
  }
  comandoVoz.ligado = true;
  save('comandoVoz', '1');
  await atualizarComandoVoz();
  renderShortcutRows(); // a linha do atalho aparece ou some na aba Atalhos
  toast(`Comando de voz ligado. Numa sala, segure ${$('vozCmdKey').textContent} e fale.`);
}
function setupComandoVoz() {
  window.api?.onVozCmd?.((p) => {
    $('vozCmdProgresso').value = p.total ? p.feito / p.total : 0;
    const mb = (b) => Math.round(b / 1e6);
    $('vozCmdProgressoTexto').textContent = `${p.etapa === 'programa' ? 'Whisper' : 'Modelo'}: ${mb(p.feito)} de ${mb(p.total)} MB`;
  });
  $('vozCmdOn').onchange = () => {
    if ($('vozCmdOn').checked) return void ligarComandoVoz();
    comandoVoz.ligado = false;
    comandoVoz.erro = '';
    save('comandoVoz', '0');
    syncComandoVozTecla();
    renderComandoVozConfig();
    renderShortcutRows(); // a linha do atalho aparece ou some na aba Atalhos
  };
  for (const r of document.querySelectorAll('input[name="vozCmdModelo"]')) {
    r.onchange = () => {
      comandoVoz.modelo = r.value === 'preciso' ? 'preciso' : 'leve';
      save('comandoVozModelo', comandoVoz.modelo);
      if (comandoVoz.ligado && !vozCmdPronto()) void ligarComandoVoz();
      else { renderComandoVozConfig(); syncComandoVozTecla(); }
    };
  }
  // Escolher já mostra como fica: os dois sons (feito e recusa) ou a voz
  for (const r of document.querySelectorAll('input[name="vozCmdConfirmar"]')) {
    r.onchange = () => {
      comandoVoz.confirmar = r.value;
      save('comandoVozConfirmar', r.value);
      if (r.value === 'som') { tocarComandoVoz('ok'); setTimeout(() => tocarComandoVoz('recusa'), 550); }
      if (r.value === 'voz' && window.speechSynthesis) {
        const fala = new SpeechSynthesisUtterance('Assistindo Fulano.');
        fala.lang = 'pt-BR';
        const voz = speechSynthesis.getVoices().find((v) => /^pt(-|_)BR/i.test(v.lang));
        if (voz) fala.voice = voz;
        speechSynthesis.cancel();
        speechSynthesis.speak(fala);
      }
    };
  }
  $('vozCmdCancelar').onclick = () => window.api.vozCmdCancelar().catch(() => {});
  $('vozCmdRemover').onclick = async () => {
    const r = await window.api.vozCmdRemover().catch(() => null);
    if (r && !r.ok) comandoVoz.erro = r.erro;
    await atualizarComandoVoz();
  };
  // Pedidos livres: Desligado, Local ou Nuvem; endereço e modelo; a chave (só vai, nunca volta); Testar
  const statusIa = (t) => { $('vozIaStatus').textContent = t; };
  for (const r of document.querySelectorAll('input[name="vozIa"]')) {
    r.onchange = () => { comandoVoz.ia.provedor = r.value; save('comandoVozIa', r.value); statusIa(''); renderComandoVozConfig(); };
  }
  $('vozIaUrl').onchange = () => { comandoVoz.ia.url = $('vozIaUrl').value.trim() || 'http://localhost:11434'; save('comandoVozIaUrl', comandoVoz.ia.url); };
  $('vozIaModeloLocal').onchange = () => { comandoVoz.ia.modeloLocal = $('vozIaModeloLocal').value.trim() || 'qwen2.5:7b'; save('comandoVozIaModeloLocal', comandoVoz.ia.modeloLocal); };
  $('vozIaModeloNuvem').onchange = () => { comandoVoz.ia.modeloNuvem = $('vozIaModeloNuvem').value; save('comandoVozIaModeloNuvem', comandoVoz.ia.modeloNuvem); };
  $('vozIaSalvarChave').onclick = async () => {
    const r = await window.api.vozIaChave($('vozIaChave').value).catch(() => ({ ok: false, erro: 'Não foi possível guardar a chave.' }));
    $('vozIaChave').value = '';
    statusIa(r.ok ? 'Chave guardada.' : r.erro);
    await atualizarComandoVoz();
  };
  $('vozIaApagarChave').onclick = async () => { await window.api.vozIaApagarChave().catch(() => {}); statusIa('Chave apagada.'); await atualizarComandoVoz(); };
  $('vozIaTestar').onclick = async () => {
    $('vozIaTestar').disabled = true;
    statusIa('Testando…');
    const r = await window.api.vozIaTestar(opcoesIa()).catch((err) => ({ ok: false, erro: String(err?.message || err) }));
    $('vozIaTestar').disabled = false;
    statusIa(r.ok ? `Funcionou: entendeu o pedido de teste em ${(r.ms / 1000).toFixed(1)} s.` : r.erro);
  };
  void atualizarComandoVoz();
}
