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
// A voz da subsala Líder para a sala toda (docs/spec/modo-lider.md). Fala para a sala toda quem está na voz, dentro da
// subsala Líder ou com a palavra (a fonte). Ouve cada fonte quem está em outro canal da voz, ou fora da voz com "Ouvir a
// Líder" (sem microfone).
// Quem ouve chama cada fonte numa conexão só de receber, e a fonte responde mandando o microfone. Essas conexões ficam
// separadas das do canal (VoiceChat): entrar e sair da Líder não derruba a conversa do grupo. No mixer, cada fonte
// entra como 'lider:<id>' (com o volume da Líder).
// Sinal: { side: 'lider', role: 'ouvir' (de quem ouve para a fonte) | 'falar' (da fonte para quem ouve), call,
// sessao (a sessão de voz da fonte), sdp | candidate | bye }. O servidor da sala só passa o sinal de/para uma fonte.
class LiderAudio {
  constructor({ voice, send, changed = () => {}, makePeer = () => new RTCPeerConnection(typeof RTC_CONFIG !== 'undefined' ? RTC_CONFIG : { iceServers: [] }),
    makeAudio = () => new Audio(), token = () => crypto.randomUUID(), mixer = null, retryMs = 20000 }) {
    Object.assign(this, { voice, send, changed, makePeer, makeAudio, token, mixer, retryMs });
    this.canal = '';          // o canal da subsala Líder ('' sem ela)
    this.ouvindo = false;     // Ouvir a Líder fora da voz
    this.palavra = new Set(); // quem tem a palavra (fala para a sala toda de fora da Líder)
    this.ouve = new Map();    // fonte -> conexão (eu ouço ela)
    this.fala = new Map();    // quem me ouve -> conexão (eu sou a fonte)
  }
  reset() { this.canal = ''; this.ouvindo = false; this.palavra = new Set(); this.sync(); }
  setCanal(ch) {
    this.canal = String(ch || '');
    if (!this.canal) { this.ouvindo = false; this.palavra = new Set(); }
    this.sync();
  }
  setPalavra(ids) { this.palavra = new Set((ids || []).map(String)); this.sync(); }
  setOuvindo(on) { this.ouvindo = !!on; this.sync(); this.changed(); }
  // Eu falo para a sala toda: na voz, dentro da Líder ou com a palavra
  souFonte() { return !!this.canal && !!this.voice.session && (this.voice.channel === this.canal || this.palavra.has(String(this.voice.id))); }
  // Ouço a Líder: na voz em outro canal, ou fora da voz com Ouvir a Líder ligado
  souOuvinte() { return !!this.canal && (this.voice.session ? this.voice.channel !== this.canal : this.ouvindo); }
  // Mesmo canal de voz que eu: lá a voz já chega pelo canal (VoiceChat), sem a Líder
  noMeuCanal(m) { return !!this.voice.session && !!m?.session && (m.channel || '') === this.voice.channel; }
  // As fontes, com a sessão de voz de cada uma
  fontes() {
    const out = new Map();
    if (!this.canal) return out;
    for (const [id, m] of this.voice.members) if (m.session && (m.channel === this.canal || this.palavra.has(id))) out.set(id, m.session);
    return out;
  }
  sync() {
    // Ouço quem está na Líder (de outro canal) e quem tem a palavra (fora do meu canal); dentro da Líder, só a palavra
    const want = new Map();
    if (this.canal && (this.voice.session || this.ouvindo)) {
      for (const [id, sessao] of this.fontes()) if (!this.noMeuCanal(this.voice.members.get(id))) want.set(id, sessao);
    }
    for (const [id, p] of [...this.ouve]) if (want.get(id) !== p.sessao) this.fechar('ouve', id, true);
    for (const [id, sessao] of want) if (!this.ouve.has(id)) this.chamar(id, sessao);
    // A fonte para de mandar para quem saiu da sala ou veio para o meu canal (lá se ouve pelo canal)
    for (const id of [...this.fala.keys()]) {
      const m = this.voice.members.get(id);
      if (!this.souFonte() || !m || this.noMeuCanal(m)) this.fechar('fala', id, true);
    }
  }
  sinal(id, role, p, data) { this.send({ type: 'signal', to: id, data: { side: 'lider', role, call: p.call, sessao: p.sessao, ...data } }); }
  nova(map, id, sessao, call) {
    const pc = this.makePeer(), audio = this.makeAudio();
    audio.autoplay = true;
    audio.muted = this.mixer ? true : this.voice.deafened;
    const p = { pc, audio, sessao, call, chain: Promise.resolve(), candidates: [], status: 'conectando' };
    map.set(id, p);
    const role = map === this.ouve ? 'ouvir' : 'falar';
    pc.onicecandidate = (e) => { if (e.candidate && map.get(id) === p) this.sinal(id, role, p, { candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (map.get(id) !== p) return;
      const s = pc.connectionState;
      p.status = s === 'connected' ? 'conectado' : ['failed', 'disconnected'].includes(s) ? 'reconectando' : 'conectando';
      if (s === 'connected') clearTimeout(p.retry);
      if (s === 'failed') this.refazer(map, id, p);
      this.changed();
    };
    // Quem ouve refaz a chamada se não conectou a tempo (a oferta pode ter se perdido)
    if (map === this.ouve) p.retry = setTimeout(() => this.refazer(map, id, p), this.retryMs);
    return p;
  }
  refazer(map, id, p) {
    if (map.get(id) !== p || p.pc.connectionState === 'connected') return;
    this.fechar(map === this.ouve ? 'ouve' : 'fala', id, map === this.ouve);
    this.sync();
  }
  chamar(id, sessao) {
    const p = this.nova(this.ouve, id, sessao, this.token());
    p.pc.addTransceiver?.('audio', { direction: 'recvonly' });
    p.pc.ontrack = (e) => {
      p.audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      this.mixer?.attach('lider:' + id, p.audio.srcObject);
      p.audio.play().catch(() => {});
    };
    this.fila(p, this.ouve, async () => {
      await p.pc.setLocalDescription(await p.pc.createOffer());
      if (this.ouve.get(id) === p) this.sinal(id, 'ouvir', p, { sdp: p.pc.localDescription });
    });
  }
  fila(p, map, task) {
    p.chain = p.chain.then(async () => { if ([...map.values()].includes(p)) await task(); }).catch((err) => {
      if (![...map.values()].includes(p)) return;
      console.warn('Falha na voz da Líder:', err);
      p.status = 'falha';
      this.changed();
    });
  }
  receive(id, data) {
    if (typeof data.call !== 'string') return;
    if (data.role === 'ouvir') {
      // Eu sou a fonte: alguém quer me ouvir (ou parou)
      let p = this.fala.get(id);
      if (data.bye) { if (p?.call === data.call) this.fechar('fala', id); return; }
      if (!this.souFonte() || data.sessao !== this.voice.session || !this.voice.stream) return;
      const m = this.voice.members.get(id);
      if (!m || this.noMeuCanal(m)) return;
      if (p && p.call !== data.call && data.sdp?.type === 'offer') { this.fechar('fala', id); p = null; }
      if (!p) {
        if (data.sdp?.type !== 'offer') return;
        p = this.nova(this.fala, id, this.voice.session, data.call);
        // Só o microfone vai; quem ouve não manda nada (a conexão é só de receber do lado dela)
        this.voice.stream.getAudioTracks().forEach((t) => p.pc.addTrack(t, this.voice.stream));
      }
      if (p.call !== data.call) return;
      this.fila(p, this.fala, async () => {
        if (data.sdp) {
          await p.pc.setRemoteDescription(data.sdp);
          for (const c of p.candidates.splice(0)) await p.pc.addIceCandidate(c);
          await p.pc.setLocalDescription(await p.pc.createAnswer());
          if (this.fala.get(id) === p) this.sinal(id, 'falar', p, { sdp: p.pc.localDescription });
        } else if (data.candidate) await this.candidato(p, data.candidate);
      });
    } else if (data.role === 'falar') {
      // Resposta da fonte que eu chamei
      const p = this.ouve.get(id);
      if (!p || p.call !== data.call) return;
      if (data.bye) { this.fechar('ouve', id); setTimeout(() => this.sync(), 1000); return; }
      this.fila(p, this.ouve, async () => {
        if (data.sdp?.type === 'answer') {
          await p.pc.setRemoteDescription(data.sdp);
          for (const c of p.candidates.splice(0)) await p.pc.addIceCandidate(c);
        } else if (data.candidate) await this.candidato(p, data.candidate);
      });
    }
  }
  async candidato(p, c) {
    if (p.pc.remoteDescription) await p.pc.addIceCandidate(c);
    else if (p.candidates.length < 128) p.candidates.push(c);
  }
  // avisar: manda o "tchau" para o outro lado fechar também
  fechar(lado, id, avisar = false) {
    const map = lado === 'ouve' ? this.ouve : this.fala, p = map.get(id);
    if (!p) return;
    map.delete(id);
    if (avisar) this.sinal(id, lado === 'ouve' ? 'ouvir' : 'falar', p, { bye: true });
    clearTimeout(p.retry);
    p.pc.ontrack = p.pc.onicecandidate = p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.audio.pause();
    p.audio.srcObject = null;
    if (lado === 'ouve') this.mixer?.detach('lider:' + id);
  }
  // Sem mixer (testes), o fone silenciado cala as vozes da Líder também
  deafen(on) { if (!this.mixer) for (const p of this.ouve.values()) p.audio.muted = !!on; }
}
if (typeof module !== 'undefined') module.exports = { VoiceChat, LiderAudio };
