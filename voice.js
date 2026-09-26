'use strict';

// Uma conexão bidirecional por par, independente das conexões das telas.
class VoiceChat {
  constructor({ send, changed, error, media = navigator.mediaDevices,
    makePeer = () => new RTCPeerConnection({ iceServers: [] }),
    makeAudio = () => new Audio(), token = () => crypto.randomUUID(), mixer = null }) {
    // mixer (opcional): o app toca as vozes por ele, com volume por pessoa e medidor de quem fala.
    // Sem mixer, cada voz toca direto no seu <audio>.
    Object.assign(this, { send, changed, error, media, makePeer, makeAudio, token, mixer });
    this.peers = new Map();
    this.members = new Map();
    this.epoch = 0;
    this.session = '';
    this.pending = false;
    this.muted = false;
    this.deafened = false;
  }
  reset(welcome) {
    this.leave(false);
    this.id = welcome?.id;
    this.supported = welcome?.features?.includes('voice') || false;
    this.members = new Map((welcome?.members || []).map(m => [m.id, { session: m.voiceSession || '', muted: !!m.muted }]));
    this.changed();
  }
  async join() {
    if (!this.supported || this.session || this.pending) return;
    const epoch = ++this.epoch;
    this.pending = true;
    this.changed();
    try {
      const stream = await this.media.getUserMedia({ video: false, audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      if (epoch !== this.epoch) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      this.mixer?.local(stream);
      this.session = this.token();
      this.muted = false;
      for (const track of stream.getAudioTracks()) track.onended = () => {
        this.leave();
        this.error('O microfone foi desconectado. Conecte-o e entre na voz novamente.');
      };
      this.announce(); // Espera a confirmação do servidor antes de iniciar ofertas.
    } catch (err) {
      if (epoch === this.epoch) {
        this.leave();
        this.error(err.name === 'NotAllowedError' ? 'Permita o acesso ao microfone nas configurações do Windows.'
          : err.name === 'NotFoundError' ? 'Nenhum microfone encontrado.' : `Não foi possível entrar na voz: ${err.message}`);
      }
    } finally {
      if (epoch === this.epoch) { this.pending = false; this.changed(); }
    }
  }
  announce() { this.send({ type: 'voice-state', session: this.session, muted: this.muted }); }
  leave(notify = true) {
    ++this.epoch;
    this.pending = false;
    const wasActive = !!this.session;
    this.session = '';
    if (this.stream) for (const track of this.stream.getTracks()) { track.onended = null; track.stop(); }
    this.stream = null;
    this.mixer?.local(null);
    for (const id of [...this.peers.keys()]) this.close(id);
    this.muted = false;
    this.deafened = false;
    this.mixer?.deafen(false);
    if (notify && wasActive) this.announce();
    this.changed();
  }
  mute() {
    if (!this.session) return;
    this.muted = !this.muted;
    this.stream.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
    this.announce();
    this.changed();
  }
  deafen() {
    this.deafened = !this.deafened;
    if (this.mixer) this.mixer.deafen(this.deafened);
    else for (const p of this.peers.values()) p.audio.muted = this.deafened;
    this.changed();
  }
  update(id, session, muted) {
    if (id === this.id) {
      if (session === this.session && session) this.sync();
      return;
    }
    if (this.members.get(id)?.session !== session) this.close(id);
    this.members.set(id, { session, muted });
    this.sync();
    this.changed();
  }
  remove(id) { this.close(id); this.members.delete(id); this.changed(); }
  sync() {
    if (!this.session) return;
    for (const [id, member] of this.members) {
      if (member.session && !this.peers.has(id) && Number(this.id) < Number(id)) {
        const p = this.connect(id, member.session, this.token());
        this.enqueue(p, async () => {
          await p.pc.setLocalDescription(await p.pc.createOffer());
          if (this.peers.get(id) === p) this.signal(id, p, { sdp: p.pc.localDescription });
        });
      }
    }
  }
  signal(id, p, data) {
    this.send({ type: 'signal', to: id, data: { side: 'voice', session: this.session,
      targetSession: p.session, call: p.call, ...data } });
  }
  connect(id, session, call) {
    const pc = this.makePeer();
    const audio = this.makeAudio();
    audio.autoplay = true;
    // Com mixer, o <audio> fica mudo (só mantém a voz chegando); o som sai pelo mixer
    audio.muted = this.mixer ? true : this.deafened;
    const p = { pc, audio, session, call, chain: Promise.resolve(), candidates: [], status: 'conectando' };
    this.peers.set(id, p);
    this.stream.getAudioTracks().forEach(t => pc.addTrack(t, this.stream));
    pc.onicecandidate = e => {
      if (e.candidate && this.peers.get(id) === p) this.signal(id, p, { candidate: e.candidate });
    };
    pc.ontrack = e => {
      audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      this.mixer?.attach(id, audio.srcObject);
      audio.play().catch(() => {
        if (this.peers.get(id) === p) this.error('Não foi possível reproduzir a voz. Saia e entre na voz novamente.');
      });
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== p) return;
      p.status = pc.connectionState === 'connected' ? 'conectado'
        : ['failed', 'disconnected'].includes(pc.connectionState) ? 'conexão interrompida — entre novamente' : 'conectando';
      this.changed();
    };
    this.changed();
    return p;
  }
  enqueue(p, task) {
    p.chain = p.chain.then(async () => {
      if ([...this.peers.values()].includes(p)) await task();
    }).catch(err => {
      if (![...this.peers.values()].includes(p)) return;
      console.warn('Falha na conexão de voz:', err);
      p.status = 'falha — entre novamente';
      this.changed();
    });
  }
  receive(id, data) {
    if (!this.session || data.targetSession !== this.session || !data.session ||
        this.members.get(id)?.session !== data.session || typeof data.call !== 'string') return;
    let p = this.peers.get(id);
    if (!p) {
      // O menor ID inicia: evita duas ofertas concorrentes.
      if (Number(id) >= Number(this.id)) return;
      p = this.connect(id, data.session, data.call);
    }
    if (p.call !== data.call || p.session !== data.session) return;
    this.enqueue(p, async () => {
      if (data.sdp) {
        const expected = Number(id) < Number(this.id) ? 'offer' : 'answer';
        if (data.sdp.type !== expected) return;
        await p.pc.setRemoteDescription(data.sdp);
        for (const c of p.candidates.splice(0)) await p.pc.addIceCandidate(c);
        if (expected === 'offer') {
          await p.pc.setLocalDescription(await p.pc.createAnswer());
          if (this.peers.get(id) === p) this.signal(id, p, { sdp: p.pc.localDescription });
        }
      } else if (data.candidate) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate);
        else if (p.candidates.length < 128) p.candidates.push(data.candidate);
      }
    });
  }
  close(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.pc.ontrack = p.pc.onicecandidate = p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.audio.pause();
    p.audio.srcObject = null;
    this.mixer?.detach(id);
  }
}
if (typeof module !== 'undefined') module.exports = { VoiceChat };
