'use strict';
// Sons da call (estilo "Suave"): entrar e sair da voz (você ou quem está na voz com você) e mutar e desmutar
// o seu microfone. Gerados na hora pelo próprio app, sem arquivo de som. O volume fica em "Voz e atalhos".
// O apertar para falar não toca som (seria um a cada frase).
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: estado, voz, microfone.

// [frequência (Hz), início (s), duração (s), volume relativo]
const CUES = {
  entrou: [[660, 0, 0.13, 1], [880, 0.09, 0.2, 1]],          // dois tons subindo
  saiu: [[880, 0, 0.13, 1], [587, 0.09, 0.22, 1]],           // dois tons descendo
  mutou: [[659, 0, 0.07, 0.8], [523, 0.055, 0.11, 0.8]],     // terça curta descendo
  desmutou: [[523, 0, 0.07, 0.8], [659, 0.055, 0.11, 0.8]],  // terça curta subindo
};
const CUE_PEAK = 0.6; // pico de cada nota com o volume em 100%

const cues = { ctx: null, inVoice: false, others: new Set(), muted: false };

function playCue(name) {
  const vol = (voiceCfg.cues ?? 80) / 100;
  const notes = CUES[name];
  if (!notes || vol <= 0) return;
  try {
    cues.ctx = cues.ctx || new AudioContext();
    if (cues.ctx.state === 'suspended') cues.ctx.resume().catch(() => {});
    const t0 = cues.ctx.currentTime + 0.02;
    for (const [f, start, dur, rel] of notes) {
      const o = cues.ctx.createOscillator();
      const g = cues.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const s = t0 + start;
      const peak = Math.max(0.0002, CUE_PEAK * rel * vol);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(peak, s + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      o.connect(g);
      g.connect(cues.ctx.destination);
      o.start(s);
      o.stop(s + dur + 0.02);
    }
  } catch (e) {
    console.warn('Som da call:', e.message);
  }
}

// Chamado a cada mudança da voz: compara com o que era antes e toca o som certo
function syncCues() {
  const me = !!voice.session;
  const others = new Set([...voice.members].filter(([id, m]) => m.session && state.members.has(id)).map(([id]) => id));
  if (me && !cues.inVoice) playCue('entrou');
  else if (!me && cues.inVoice) playCue('saiu');
  else if (me) {
    if ([...others].some((id) => !cues.others.has(id))) playCue('entrou');
    else if ([...cues.others].some((id) => !others.has(id))) playCue('saiu');
    if (voice.muted !== cues.muted) playCue(voice.muted ? 'mutou' : 'desmutou');
  }
  cues.inVoice = me;
  cues.others = others;
  cues.muted = me && voice.muted;
}
