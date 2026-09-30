'use strict';

// Uma conexão bidirecional por par, independente das conexões das telas.
// Canal: '' é a Voz geral; um número é uma subsala. Só quem está no mesmo canal se conecta (e se ouve).
class VoiceChat {
  constructor({ send, changed, error, media = navigator.mediaDevices,
    makePeer = () => new RTCPeerConnection(typeof RTC_CONFIG !== 'undefined' ? RTC_CONFIG : { iceServers: [] }),
    makeAudio = () => new Audio(), token = () => crypto.randomUUID(), mixer = null, activity = () => {} }) {
    // mixer (opcional): o app toca as vozes por ele, com volume por pessoa e medidor de quem fala.
    // Sem mixer, cada voz toca direto no seu <audio>.
    Object.assign(this, { send, changed, error, media, makePeer, makeAudio, token, mixer, activity });
    this.peers = new Map();
    this.members = new Map();
    this.epoch = 0;
    this.session = '';
    this.channel = '';
    this.pending = false;
    this.muted = false;
    this.deafened = false;
  }
  reset(welcome) {
    this.leave(false);
    this.id = welcome?.id;
    this.supported = welcome?.features?.includes('voice') || false;
    this.members = new Map((welcome?.members || []).map(m => [m.id, { session: m.voiceSession || '', channel: m.voiceSession ? String(m.voiceChannel || '') : '', muted: !!m.muted, deafened: !!m.deafened }]));
    this.changed();
  }
  async join(channel = '') {
    if (!this.supported || this.session || this.pending) return;
    this.channel = String(channel || '');
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
      this.activity('voiceJoin', this.id);
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
  announce() { this.send({ type: 'voice-state', session: this.session, channel: this.session ? this.channel : '', muted: this.muted, deafened: this.deafened }); }
  // Ir para outro canal (Voz geral ou uma subsala). Fora da voz, entra direto nele.
  setChannel(channel) {
    channel = String(channel || '');
    if (!this.session) return this.join(channel);
    if (channel === this.channel) return;
    this.moveTo(channel);
    this.announce(); // as conexões novas começam quando o servidor confirmar (update do próprio id)
  }
  moveTo(channel) {
    this.channel = channel;
    for (const id of [...this.peers.keys()]) this.close(id);
    this.activity('voiceJoin', this.id); // o som de entrar: você chegou num canal
    this.changed();
  }
  leave(notify = true) {
    ++this.epoch;
    this.pending = false;
    const wasActive = !!this.session;
    this.session = '';
    this.channel = '';
    if (this.stream) for (const track of this.stream.getTracks()) { track.onended = null; track.stop(); }
    this.stream = null;
    this.mixer?.local(null);
    for (const id of [...this.peers.keys()]) this.close(id);
    this.muted = false;
    this.deafened = false;
    this.mixer?.deafen(false);
    if (notify && wasActive) { this.announce(); this.activity('voiceLeave', this.id); }
    this.changed();
  }
  mute() {
    if (!this.session) return;
    // Ligar o microfone com o fone silenciado liga o fone também (falar sem ouvir não faz sentido)
    if (this.muted && this.deafened) { this.mutedBeforeDeafen = false; return this.deafen(); } // e o microfone fica ligado
    this.muted = !this.muted;
    this.stream.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
    this.announce();
    this.changed();
  }
  // Silenciar o fone desliga o microfone junto (como no Discord); voltar a ouvir devolve o microfone como estava
  deafen() {
    this.deafened = !this.deafened;
    if (this.mixer) this.mixer.deafen(this.deafened);
    else for (const p of this.peers.values()) p.audio.muted = this.deafened;
    if (this.session && this.stream) {
      if (this.deafened) { this.mutedBeforeDeafen = this.muted; this.muted = true; }
      else { this.muted = !!this.mutedBeforeDeafen; this.mutedBeforeDeafen = false; }
      this.stream.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
    }
    if (this.session) this.announce(); // os outros veem que você silenciou as vozes (fone)
    this.changed();
  }
  update(id, session, muted, deafened = false, channel = '') {
    channel = session ? String(channel || '') : '';
    if (id === this.id) {
      // O servidor pode mudar o seu canal (a subsala em que você estava foi apagada): segue o que ele diz
      if (session === this.session && session && channel !== this.channel) this.moveTo(channel);
      if (session === this.session && session) this.sync();
      return;
    }
    const before = this.members.get(id);
    const wasActive = !!before?.session;
    if (before?.session !== session || (before?.channel || '') !== channel) this.close(id);
    this.members.set(id, { session, channel, muted, deafened: !!session && !!deafened });
    // Na voz, o som de entrar e sair vale para o seu canal: alguém chegou nele ou saiu dele (trocar de subsala conta)
    const wasHere = wasActive && (before.channel || '') === this.channel, isHere = !!session && channel === this.channel;
    if (this.session ? wasHere !== isHere : wasActive !== !!session) this.activity((this.session ? isHere : session) ? 'voiceJoin' : 'voiceLeave', id);
    this.sync();
    this.changed();
  }
  remove(id) {
    const wasActive = !!this.members.get(id)?.session;
    this.close(id); this.members.delete(id);
    if (wasActive) this.activity('voiceLeave', id);
    this.changed();
  }
  sync() {
    if (!this.session) return;
    for (const [id, member] of this.members) {
      if (member.session && (member.channel || '') === this.channel && !this.peers.has(id) && Number(this.id) < Number(id)) {
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
      const s = pc.connectionState;
      clearTimeout(p.retry);
      p.status = s === 'connected' ? 'conectado' : ['failed', 'disconnected'].includes(s) ? 'reconectando' : 'conectando';
      // Caiu (a rede piscou, a VPN reiniciou): quem iniciou a chamada começa outra sozinho
      if (s === 'failed') this.recover(id, p);
      else if (s === 'disconnected') p.retry = setTimeout(() => this.recover(id, p), 5000);
      this.changed();
    };
    // Nem conectou em 20 s (a oferta pode ter se perdido com a sala reconectando): tenta de novo
    p.retry = setTimeout(() => this.recover(id, p), 20000);
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
  // Refaz a chamada com essa pessoa. Só quem inicia (o menor número) faz a oferta nova; o outro lado espera.
  recover(id, p) {
    if (this.peers.get(id) !== p || p.pc.connectionState === 'connected') return;
    if (Number(this.id) < Number(id)) { this.close(id); this.sync(); }
    else { clearTimeout(p.retry); p.retry = setTimeout(() => this.recover(id, p), 20000); }
  }
  receive(id, data) {
    if (!this.session || data.targetSession !== this.session || !data.session ||
        this.members.get(id)?.session !== data.session || (this.members.get(id)?.channel || '') !== this.channel ||
        typeof data.call !== 'string') return;
    let p = this.peers.get(id);
    // Oferta de uma chamada nova de quem inicia: a anterior caiu, troca por esta
    if (p && p.call !== data.call && data.sdp?.type === 'offer' && Number(id) < Number(this.id)) { this.close(id); p = null; }
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
    clearTimeout(p.retry);
    p.pc.ontrack = p.pc.onicecandidate = p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.audio.pause();
    p.audio.srcObject = null;
    this.mixer?.detach(id);
  }
}
if (typeof module !== 'undefined') module.exports = { VoiceChat };
