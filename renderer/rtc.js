'use strict';
// Ajustes do WebRTC: Opus em estéreo, H.264 primeiro, nome do codec, placa de vídeo ou processador, bitrate.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, estado.

// Pede Opus em estéreo e com bitrate alto (melhor para música e jogos)
function enhanceOpus(sdp) {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!m) return sdp;
  const pt = m[1];
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (line, params) =>
    params.includes('stereo=1') ? line : `a=fmtp:${pt} ${params};stereo=1;sprop-stereo=1;maxaveragebitrate=192000`);
}

// Coloca o H.264 em primeiro lugar (a placa de vídeo codifica, a CPU fica livre).
// Se o PC não tiver H.264, fica o padrão do WebRTC (VP8).
function preferH264(pc) {
  const tr = pc.getTransceivers().find((t) => t.sender.track && t.sender.track.kind === 'video');
  if (!tr || !tr.setCodecPreferences || !RTCRtpReceiver.getCapabilities) return;
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs || [];
  if (!codecs.some((c) => c.mimeType.toLowerCase() === 'video/h264')) return;
  const rank = (c) => {
    const mime = c.mimeType.toLowerCase();
    if (mime === 'video/h264') return (c.sdpFmtpLine || '').includes('packetization-mode=1') ? 0 : 1;
    if (mime === 'video/vp8') return 2;
    if (['video/rtx', 'video/red', 'video/ulpfec', 'video/flexfec-03'].includes(mime)) return 9;
    return 5;
  };
  try { tr.setCodecPreferences([...codecs].sort((a, b) => rank(a) - rank(b))); } catch (e) { console.warn(e); }
}

function codecName(report, codecId) {
  const mime = (codecId && report.get(codecId)?.mimeType) || '';
  return { 'video/h264': 'H.264', 'video/vp8': 'VP8', 'video/vp9': 'VP9', 'video/av1': 'AV1' }[mime.toLowerCase()] || '';
}

// true = placa de vídeo, false = processador, null = não deu para saber
function usesHardware(efficient, impl) {
  if (typeof efficient === 'boolean') return efficient;
  if (!impl) return null;
  if (/mediafoundation|accelerator|external|nvenc|d3d/i.test(impl)) return true;
  if (/openh264|libvpx|libaom|ffmpeg|software/i.test(impl)) return false;
  return null;
}

// videoOff: quem assiste está com a janela minimizada, então o vídeo para (só o som continua)
// e a placa de vídeo deixa de codificar para essa pessoa.
async function applyBitrate(link) {
  const q = QUALITY[state.quality];
  for (const sender of link.pc.getSenders()) {
    if (!sender.track || sender.track.kind !== 'video') continue;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = q.bitrate;
    params.encodings[0].maxFramerate = q.fps;
    params.encodings[0].active = !link.videoOff;
    try { await sender.setParameters(params); } catch (e) { console.warn(e); }
  }
}
