'use strict';
// Gera as chamadas de rádio do tema Top Gun (assets/audio/radio-*.wav). Cada som tem várias falas (o app sorteia uma,
// sem repetir a última: preferencias-modelo.js › sounds[].files), ditas por pilotos diferentes: as vozes em inglês
// instaladas no Windows (as masculinas primeiro: David e Mark; a Zira se for a única), cada uma num tom um pouco
// diferente. A voz passa por um rádio UHF de avião: filtro de banda (400 a 2800 Hz), saturada e comprimida, com
// chiado de fundo, o clique do botão de falar no começo e o chiado do squelch no fim.
// Também gera o radio-squelch.wav (só o clique e o chiado, para o chat). Só roda no Windows:
//   node assets/temas/gerar-radio.js
// Para ter as vozes masculinas, instale a voz em inglês (PowerShell como administrador):
//   Add-WindowsCapability -Online -Name "Language.TextToSpeech~~~en-US~0.0.1.0"
// Mudou uma fala, uma voz ou o efeito? Rode de novo; os .wav entram no pacote pela lista de sons.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RATE = 22050;
const OUT = path.join(__dirname, '..', 'audio');
// Nome do som → as falas (o id do som em preferencias-modelo.js usa o mesmo nome, em camelCase, com "radio" na frente)
const LINES = {
  'fox': ['Fox one!', 'Fox two!', 'Fox three!'],
  'splash': ['Splash one.', 'Splash two.', 'Good kill, good kill.'],
  'radio-check': ['Radio check.', 'Radio check, how copy?', 'Comm check, comm check.'],
  'rtb': ['R. T. B.', 'Returning to base.', 'Bingo fuel. R. T. B.'],
  'going-hot': ['Going hot.', 'Hot mic.', 'Master arm, on.'],
  'going-cold': ['Going cold.', 'Cold mic.', 'Master arm, safe.'],
  'radio-silence': ['Radio silence.', 'Going silent.', 'Comms out.'],
  'loud-and-clear': ['Loud and clear.', 'Five by five.', 'Read you five by five.'],
  'tally-ho': ['Tally ho!', 'Tally one.', 'Visual. Got eyes on you.'],
  'bravo-six': ['Bravo six, going dark.', 'Bravo six. Going dark.'],
};
// Os pilotos: a voz e o tom (a fala toca k vezes mais devagar: mais grave)
const PREFERRED = ['Microsoft David', 'Microsoft Mark', 'Microsoft Guy', 'Microsoft Zira'];

// Sorteio fixo: os arquivos saem iguais toda vez que o script roda
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;

function ps(script) { return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }); }
// Vozes em inglês dos dois motores do Windows: a SAPI (Desktop) e a OneCore (WinRT, a das vozes novas)
function voices() {
  const sapi = ps(`Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture }`)
    .split(/\r?\n/).filter((l) => /\|en-/i.test(l)).map((l) => ({ engine: 'sapi', name: l.split('|')[0] }));
  const winrt = ps(`[Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime] | Out-Null; [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | % { $_.DisplayName + '|' + $_.Language }`)
    .split(/\r?\n/).filter((l) => /\|en-/i.test(l)).map((l) => ({ engine: 'winrt', name: l.split('|')[0] }));
  const all = [...winrt, ...sapi];
  const rank = (v) => { const i = PREFERRED.findIndex((p) => v.name.startsWith(p)); return i < 0 ? PREFERRED.length : i; };
  const seen = new Set(), list = [];
  for (const v of all.sort((a, b) => rank(a) - rank(b))) { const key = v.name.replace(/ Desktop$/, ''); if (!seen.has(key)) { seen.add(key); list.push(v); } }
  if (!list.length) throw new Error('Nenhuma voz em inglês instalada no Windows.');
  return list;
}
function speak(voice, text, file) {
  const t = text.replace(/'/g, "''"), f = file.replace(/'/g, "''");
  if (voice.engine === 'sapi') {
    ps(`Add-Type -AssemblyName System.Speech
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('${voice.name}'); $s.Rate = 2
$s.SetOutputToWaveFile('${f}', $fmt); $s.Speak('${t}'); $s.Dispose()`);
    return;
  }
  ps(`Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
$s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$s.Voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ? { $_.DisplayName -eq '${voice.name}' } | Select-Object -First 1
$s.Options.SpeakingRate = 1.15
$stream = Await ($s.SynthesizeTextToStreamAsync('${t}')) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) | Out-Null
$bytes = New-Object byte[] ([int]$stream.Size); $reader.ReadBytes($bytes); [IO.File]::WriteAllBytes('${f}', $bytes)`);
}
// WAV de 16 bits (qualquer taxa e canais) → mono em RATE
function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12, rate = RATE, ch = 1;
  while (p < b.length && b.toString('ascii', p, p + 4) !== 'data') {
    if (b.toString('ascii', p, p + 4) === 'fmt ') { ch = b.readUInt16LE(p + 10); rate = b.readUInt32LE(p + 12); }
    p += 8 + b.readUInt32LE(p + 4);
  }
  const n = Math.floor(b.readUInt32LE(p + 4) / 2 / ch), src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = b.readInt16LE(p + 8 + i * 2 * ch) / 32768;
  return rate === RATE ? src : resample(src, RATE / rate);
}
function writeWav(file, data) {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  fs.writeFileSync(file, b);
}
// Filtro biquad (RBJ): 'hp' passa-alta, 'lp' passa-baixa
function biquad(data, type, f, q = 0.707) {
  const w = 2 * Math.PI * f / RATE, a = Math.sin(w) / (2 * q), c = Math.cos(w);
  const [b0, b1, b2] = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const [a0, a1, a2] = [1 + a, -2 * c, 1 - a];
  const out = new Float32Array(data.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}
const band = (d) => biquad(biquad(biquad(biquad(d, 'hp', 400), 'hp', 400), 'lp', 2800), 'lp', 2800);
const noise = (n, level) => Float32Array.from({ length: n }, () => rand() * level);
// O clique do botão de falar: um estalo curto e seco
const click = () => Float32Array.from({ length: Math.round(RATE * 0.012) }, (_, i) => (i < 3 ? 0.9 * (i % 2 ? -1 : 1) : rand() * 0.5 * Math.exp(-i / 40)));
// O chiado do squelch: ruído de banda larga que some em ~0,18 s
function squelch(seconds = 0.18, level = 0.35) {
  const n = Math.round(RATE * seconds), d = noise(n, level);
  for (let i = 0; i < n; i++) d[i] *= Math.min(1, (n - i) / (n * 0.6));
  return biquad(d, 'hp', 900);
}
function concat(...parts) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function trim(d, th = 0.01) {
  let a = 0, b = d.length - 1;
  while (a < b && Math.abs(d[a]) < th) a++;
  while (b > a && Math.abs(d[b]) < th) b--;
  return d.slice(Math.max(0, a - 200), Math.min(d.length, b + 400));
}
// Toca k vezes mais devagar (k > 1: mais grave e mais lento), por interpolação linear
function resample(d, k) {
  const out = new Float32Array(Math.floor(d.length * k));
  for (let i = 0; i < out.length; i++) {
    const x = i / k, j = Math.floor(x), f = x - j;
    out[i] = (d[j] ?? 0) * (1 - f) + (d[j + 1] ?? 0) * f;
  }
  return out;
}
function radio(voice, k) {
  let v = band(resample(trim(voice), k));
  const peak = v.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1;
  v = v.map((x) => Math.tanh((x / peak) * 3.2) * 0.8); // saturado e comprimido, como o rádio do avião
  const hiss = band(noise(v.length, 0.06));
  v = v.map((x, i) => x + hiss[i]);
  const carrier = band(noise(Math.round(RATE * 0.05), 0.08));
  return concat(click(), carrier, v, squelch(), click());
}

const crew = voices();
console.log('Pilotos: ' + crew.map((v) => v.name).join(', '));
// Cada fala com um piloto diferente (girando pela lista) e um tom: com uma voz só, o tom muda mais para variar
const tones = crew.length > 1 ? [1.04, 1.1, 1.0] : [1.06, 1.16, 0.98];
for (const f of fs.readdirSync(OUT)) if (/^radio-.*\.wav$/.test(f)) fs.rmSync(path.join(OUT, f));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-'));
let turn = 0;
for (const [name, texts] of Object.entries(LINES)) {
  texts.forEach((text, i) => {
    const voice = crew[turn++ % crew.length], raw = path.join(tmp, `${name}-${i}.wav`);
    speak(voice, text, raw);
    const file = `radio-${name}-${i + 1}.wav`;
    writeWav(path.join(OUT, file), radio(readWav(raw), tones[i % tones.length]));
    console.log(`${file}  (${voice.name}: "${text}")`);
  });
}
writeWav(path.join(OUT, 'radio-squelch.wav'), concat(click(), squelch(0.14, 0.3), click()));
console.log('radio-squelch.wav');
fs.rmSync(tmp, { recursive: true, force: true });
