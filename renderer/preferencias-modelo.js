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
  ];
  // mute/unmute: o seu microfone (o apertar para falar não conta)
  const events = ['join', 'leave', 'chat', 'voiceJoin', 'voiceLeave', 'mute', 'unmute'];
  // Cores: as 4 primeiras sempre valem; as outras começam vazias ('' = automático, calculada das 4) e só
  // passam a valer quando a pessoa escolhe
  const optionalColors = ['text', 'live', 'speaking', 'warn', 'line'];
  const defaults = { colors: { main: '#22271E', secondary: '#2D3327', detail1: '#D6C45C', detail2: '#A6D089', text: '', live: '', speaking: '', warn: '', line: '' },
    sounds: { join: 'notification035', leave: 'whoosh', chat: 'wood', voiceJoin: 'suaveEntrou', voiceLeave: 'suaveSaiu',
      mute: 'suaveMutou', unmute: 'suaveDesmutou',
      chatMuted: false, volume: 50, levels: { join: 100, leave: 100, chat: 100, voiceJoin: 100, voiceLeave: 100, mute: 100, unmute: 100 } } };
  function hex(value) {
    if (typeof value !== 'string') return null;
    const s = value.trim().replace(/^#/, '');
    if (/^[\da-f]{3}$/i.test(s)) return '#' + [...s].map(c => c + c).join('').toUpperCase();
    return /^[\da-f]{6}$/i.test(s) ? '#' + s.toUpperCase() : null;
  }
  function normalize(raw) {
    const result = { colors: { ...defaults.colors }, sounds: { ...defaults.sounds, levels: { ...defaults.sounds.levels } } };
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
  function luminance(c) { return rgb(c).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0); }
  const ink = c => luminance(c) > 0.179 ? '#000000' : '#FFFFFF';
  const alpha = (c, a) => `rgba(${rgb(c).join(', ')}, ${a})`;
  function palette(colors) {
    const c = normalize({ colors }).colors;
    const text = c.text || ink(c.main), surface = c.text || ink(c.secondary), muted = mix(surface, c.secondary, .32);
    const live = c.live || c.detail1, speaking = c.speaking || c.detail2, warn = c.warn || c.detail2;
    const line = c.line || mix(c.secondary, surface, .18);
    return {
      '--bg': c.main, '--panel': c.secondary, '--sunken': mix(c.secondary, '#000000', .15),
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
      'color-scheme': luminance(c.main) > 0.179 ? 'light' : 'dark',
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
  return { key, sounds, events, defaults, optionalColors, hex, normalize, read, write, palette, SoundPlayer };
})();
if (typeof module !== 'undefined') module.exports = AppPreferences;
