// Comando de voz de ponta a ponta, numa janela invisível (só Windows, precisa de internet na primeira vez):
// liga em Recursos extras (baixa o Whisper e o modelo leve de verdade), entra numa sala de mentira e "segura a tecla"
// com um microfone de mentira que toca uma frase gerada pela voz do Windows. Confere que a call fica sem a sua voz
// enquanto grava, e que a frase vira o comando certo (assistir e janela flutuante no canto pedido).
// O download fica guardado no perfil de teste (pasta temporária): a segunda vez já não baixa.
// Roda com: npx electron tests/e2e/comando-voz.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const comandoVoz = require('../../main/comando-voz');
const { criarIa, buscarYoutube } = require('../../main/comando-voz-ia');
const http = require('node:http');
const APP = path.resolve(__dirname, '..', '..');
const PERFIL = path.join(os.tmpdir(), 'tela-p2p-e2e', 'perfil-comando-voz');
app.setPath('userData', PERFIL);
console.log('\n== Comando de voz (janela invisível)');
let ok = 0, bad = 0;
const check = (n, c, x = '') => { c ? ok++ : bad++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${x !== '' ? '  (' + x + ')' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('TEMPO ESGOTADO'); app.exit(1); }, 180000);

// A frase, falada pela voz do Windows em português, vira o microfone de mentira do Chromium
const FRASE = 'Coloca o Mateus na janela flutuante no canto esquerdo de cima';
const WAV = path.join(PERFIL, 'frase.wav');
fs.mkdirSync(PERFIL, { recursive: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; `
  + `$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | Select-Object -First 1; if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; `
  + `$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, 16, 1); $s.SetOutputToWaveFile('${WAV}', $f); $s.Speak('${FRASE}'); $s.Dispose()`]);
const segundos = (fs.statSync(WAV).size - 44) / 96000;
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', WAV);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  const pipGroups = [];
  const teclas = [];
  for (const [channel, value] of Object.entries({
    'get-ips': [], 'razze-pending-invite': '', 'razze-presence-state': { friends: [], networks: [], rooms: [], error: '' }, 'get-version': '1.9.2', 'github-check': { ok: false }, 'set-priority': true, 'stats-start': true, 'stats-stop': true,
    'stop-app-audio': true, 'stop-server': true, 'room-keys': true, 'sessoes-observar': true, 'capture-exclude': true, 'ptt': true,
    'get-shortcuts': { voiceCmd: 'CommandOrControl+Shift+V' }, 'pip-edit': true, 'pip-size': true, 'pip-opacity': true,
  })) ipcMain.handle(channel, () => value);
  ipcMain.handle('pip-group', (_e, id, patch) => { pipGroups.push({ id, ...patch }); return true; });
  // O comando de voz de verdade (o mesmo do main.js), menos a tecla, que o teste "aperta" direto
  const vozCmd = comandoVoz.criar(PERFIL);
  ipcMain.handle('voz-cmd-estado', () => vozCmd.estado());
  ipcMain.handle('voz-cmd-instalar', (e, modelo) => vozCmd.instalar(String(modelo || ''), (p) => { if (!e.sender.isDestroyed()) e.sender.send('voz-cmd', p); }));
  ipcMain.handle('voz-cmd-cancelar', () => vozCmd.cancelar());
  ipcMain.handle('voz-cmd-remover', () => vozCmd.remover());
  ipcMain.handle('voz-cmd-transcrever', (_e, wav, modelo, dica) => vozCmd.transcrever(wav, String(modelo || ''), String(dica || '')));
  ipcMain.handle('voz-cmd-tecla', (_e, on) => { teclas.push(!!on); return true; });
  // Pedidos livres no modo Local, com um servidor de mentira no lugar do Ollama (resposta escolhida pelo teste)
  let respostaIa = null;
  const srvIa = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(respostaIa)); }); });
  await new Promise((r) => srvIa.listen(0, '127.0.0.1', r));
  const vozIa = criarIa(PERFIL, { storage: { isEncryptionAvailable: () => false } });
  ipcMain.handle('voz-ia-estado', () => ({ temChave: false, nuvem: true }));
  ipcMain.handle('voz-ia-entender', (_e, texto, ctx, opcoes) => vozIa.entender(texto, ctx, opcoes));
  ipcMain.handle('voz-ia-testar', (_e, opcoes) => vozIa.testar(opcoes));
  ipcMain.handle('voz-cmd-youtube', (_e, busca) => buscarYoutube(busca));

  const win = new BrowserWindow({ show: false, width: 1200, height: 780, webPreferences: { preload: path.join(APP, 'preload.js') } });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) errors.push(message + ' @' + src + ':' + line); });
  const run = (code) => win.webContents.executeJavaScript(code);
  const until = async (code, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await run(code)) return true; await sleep(200); } return false; };
  try {
    await win.webContents.session.clearStorageData({ storages: ['localstorage'] }); // começa desligado (o download fica)
    await win.loadFile(path.join(APP, 'index.html'));
    await sleep(800);
    check('Abre sem erro no console', errors.length === 0, errors.join(' | '));
    await run(`(() => { $('generalSettingsDialog').hidden = false; showSettingsTab('extras'); })()`);
    check('Recursos extras: comando de voz desligado', await until(`!$('settingsPanel-extras').hidden && !$('vozCmdOn').checked && !comandoVoz.ligado`, 3000));

    // Ligar: confirma o download e espera baixar (ou já estar baixado de outra vez)
    await run(`(() => { $('vozCmdOn').checked = true; $('vozCmdOn').dispatchEvent(new Event('change')); })()`);
    const precisou = await until(`!!document.querySelector('.app-confirm')`, 3000);
    if (precisou) await run(`document.querySelector('.app-confirm .btn.primary').click()`);
    check('Liga e baixa o Whisper e o modelo leve', await until(`comandoVoz.ligado && vozCmdPronto()`, 150000), precisou ? 'baixou agora' : 'já estava baixado');
    check('Status diz que está ligado', await run(`$('vozCmdStatus').textContent.startsWith('Ligado')`));

    await run(`enterRoom({ id: '1', features: ['chat', 'voice', 'handoff'], members: [{ id: '2', name: 'Mateus', sharing: true, version: '1.15.6' }, { id: '3', name: 'Ana', sharing: false, version: '1.15.6' }], chat: [] }, false, '127.0.0.1', 8765)`);
    await sleep(500);
    check('Na sala, a tecla do comando é ligada', teclas.at(-1) === true, JSON.stringify(teclas));
    check('Voz e atalhos mostra a tecla do comando', await run(`(() => { openVoiceDialog(); return true; })()`) && await until(`$('shortcutRows').textContent.includes('Comando de voz')`, 2000));
    await run(`closeVoiceDialog()`);

    // Segura a tecla pelo tempo da frase e solta
    await run(`onComandoVozTecla(true)`);
    check('Segurando: selo Ouvindo e a call sem a sua voz', await until(`comandoVoz.gravando && !$('voiceCmdBadge').hidden && $('voiceCmdBadge').textContent === 'Ouvindo…'`, 2000));
    await sleep(segundos * 1000 + 400);
    const t0 = Date.now();
    await run(`(() => { window.__avisos = []; const t = toast; toast = (m, k) => { window.__avisos.push(m); return t(m, k); }; window.__sons = []; const s = tocarComandoVoz; tocarComandoVoz = (n) => { window.__sons.push(n); return s(n); }; onComandoVozTecla(false); })()`);
    check('Soltou: entende e faz o comando', await until(`window.__avisos.length > 0 && !comandoVoz.entendendo`, 30000), `${Date.now() - t0} ms`);
    const avisos = await run(`window.__avisos`);
    check('O aviso diz o que foi feito', avisos.some((a) => /Mateus na janela flutuante no canto esquerdo de cima/.test(a)), avisos.join(' | '));
    check('Assiste o Mateus e abre a janela flutuante', await run(`state.in.has('2') && state.pips.has('2')`));
    check('Confirmação padrão é som: toque de fim e o de feito', JSON.stringify(await run(`window.__sons`)) === '["fim","ok"]', JSON.stringify(await run(`window.__sons`)));
    await run(`(() => { window.__sons = []; executarComandoVoz(ComandoVozRegras.interpretar('qual é a previsão do tempo', {}), 'qual é a previsão do tempo'); })()`);
    check('Comando que não deu toca o som de recusa', JSON.stringify(await run(`window.__sons`)) === '["recusa"]', JSON.stringify(await run(`window.__sons`)));
    await sleep(800);
    check('A janela vai para o canto esquerdo de cima', pipGroups.some((g) => g.id === '2' && g.corner === 'tl'), JSON.stringify(pipGroups));
    check('Depois de soltar, a call volta a ouvir e o selo some', await run(`!comandoVoz.gravando && $('voiceCmdBadge').hidden`));

    // Um toque curto na tecla (Ctrl+Shift+V para colar texto) não faz nada
    await run(`(() => { window.__avisos = []; onComandoVozTecla(true); })()`);
    await sleep(200);
    await run(`onComandoVozTecla(false)`);
    await sleep(1500);
    check('Toque curto na tecla é ignorado, sem aviso', (await run(`window.__avisos.length`)) === 0);

    // Na voz: o microfone do comando já espera aberto, então a gravação começa na hora, com o que veio logo antes
    await run(`(() => { for (const id of [...state.pips.keys()]) closePip(id); stopWatching('2'); voice.session = 'teste'; void syncComandoVozMic(); })()`);
    check('Na voz, o microfone do comando espera aberto', await until(`!!comandoVoz.espera`, 3000));
    await sleep(1000);
    await run(`onComandoVozTecla(true)`);
    check('Na voz, começa a ouvir na hora, com o que veio antes da tecla', await run(`comandoVoz.gravando && $('voiceCmdBadge').textContent === 'Ouvindo…' && comandoVoz.rec.mic === comandoVoz.espera && comandoVoz.rec.pedacos[0].length > 0`));
    await sleep(segundos * 1000);
    await run(`(() => { window.__avisos = []; onComandoVozTecla(false); })()`);
    check('Na voz, entende e faz o comando', await until(`window.__avisos.length > 0 && !comandoVoz.entendendo`, 30000));
    const avisosVoz = await run(`window.__avisos`);
    check('Na voz, o aviso diz o que foi feito', avisosVoz.some((a) => /Mateus na janela flutuante/.test(a)), avisosVoz.join(' | '));
    check('Depois do comando, o microfone continua esperando', await run(`!!comandoVoz.espera && !comandoVoz.rec`));
    await run(`(() => { voice.session = ''; void syncComandoVozMic(); })()`);
    check('Fora da voz, o microfone do comando fecha', await until(`!comandoVoz.espera`, 2000));

    // Pedido livre (Local): o modelo devolve duas ações; o app faz as duas e confirma num aviso só
    const chamada = (name, args) => ({ function: { name, arguments: JSON.stringify(args) } });
    respostaIa = { choices: [{ message: { role: 'assistant', content: '', tool_calls: [chamada('assistir', { pessoa: 'Mateus' }), chamada('janela_flutuante', { pessoa: 'Mateus', canto: 'direita_baixo' })] } }] };
    await run(`(() => { for (const id of [...state.pips.keys()]) closePip(id); stopWatching('2'); comandoVoz.ia.provedor = 'local'; comandoVoz.ia.url = 'http://127.0.0.1:${srvIa.address().port}'; comandoVoz.ia.modeloLocal = 'teste'; renderComandoVozConfig(); })()`);
    check('Pedidos livres: Local mostra endereço, modelo e Testar', await run(`!$('vozIaLocal').hidden && $('vozIaNuvem').hidden && !$('vozIaTestarLinha').hidden`));
    await run(`(() => { window.__avisos = []; window.__sons = []; void pedidoLivreComandoVoz('deixa o Mateus num cantinho de baixo pra eu ver'); })()`);
    check('Pedido livre: faz as ações do modelo', await until(`state.in.has('2') && state.pips.has('2') && window.__avisos.length > 0`, 5000));
    await sleep(800);
    const avisosIa = await run(`window.__avisos`);
    check('Pedido livre: um aviso só, com as duas ações', avisosIa.length === 1 && /Assistindo Mateus\. Mateus na janela flutuante no canto direito de baixo/.test(avisosIa[0]), avisosIa.join(' | '));
    check('Pedido livre: som de feito e janela no canto pedido', JSON.stringify(await run(`window.__sons`)) === '["ok"]' && pipGroups.some((g) => g.id === '2' && g.corner === 'br'), JSON.stringify(pipGroups));
    respostaIa = { choices: [{ message: { role: 'assistant', content: 'Não consigo pedir pizza.' } }] };
    await run(`(() => { window.__avisos = []; window.__sons = []; void pedidoLivreComandoVoz('pede uma pizza'); })()`);
    check('Pedido livre sem ação: recusa com a resposta do modelo', await until(`window.__avisos[0] === 'Não consigo pedir pizza.'`, 5000) && JSON.stringify(await run(`window.__sons`)) === '["recusa"]');
    respostaIa = { choices: [{ message: { role: 'assistant', content: '', tool_calls: [chamada('assistir', { pessoa: 'Pessoa Inventada' })] } }] };
    await run(`(() => { window.__avisos = []; void pedidoLivreComandoVoz('abre a live do Zé'); })()`);
    check('Pedido livre com pessoa fora da sala: não faz nada e avisa', await until(`window.__avisos.length > 0`, 5000) && /fora da sala/.test((await run(`window.__avisos`))[0]));
    const teste = await run(`window.api.vozIaTestar({ provedor: 'local', modelo: 'teste', url: comandoVoz.ia.url })`);
    check('Testar com um modelo que escolhe errado diz que não deu', teste.ok === false, teste.erro);
    srvIa.close();

    // Os comandos novos: música, som, destaque, tela cheia, clipe e a sua transmissão (pelas regras)
    await run(`(() => {
      for (const id of [...state.pips.keys()]) closePip(id);
      comandoVoz.ia.provedor = '';
      window.__enviados = []; const s0 = send; send = (m) => { window.__enviados.push(m); return s0(m); };
      window.cmd = async (frase) => {
        window.__avisos = []; window.__sons = [];
        const pessoas = [...state.members].map(([id, m]) => ({ id, name: m.name }));
        await executarComandoVoz(ComandoVozRegras.interpretar(frase, { pessoas, subsalas: state.subsalas || [] }), frase);
        return { avisos: window.__avisos, sons: window.__sons };
      };
    })()`);
    const cmd = (frase) => run(`window.cmd(${JSON.stringify(frase)})`);
    let r = await cmd('abaixa o Mateus');
    check('"abaixa o Mateus": voz dele em 70%', (await run(`volOf('2').voice`)) === 70, r.avisos.join(' | '));
    await run(`watch('2')`);
    r = await cmd('liga o som da live do Mateus');
    check('"liga o som da live do Mateus": live com som', (await run(`volOf('2').screen === 70 && !state.in.get('2').tile.userMuted`)), r.avisos.join(' | '));
    r = await cmd('desliga o som da tela do Mateus');
    check('"desliga o som da tela do Mateus": live muda', await run(`state.in.get('2').tile.userMuted`), r.avisos.join(' | '));
    r = await cmd('deixa a do Mateus grande');
    check('"deixa a do Mateus grande": destaque (com uma tela só, ela já ocupa tudo)', /Mateus (em destaque|já ocupa a tela toda)/.test(r.avisos[0] || '') && r.sons[0] === 'ok', r.avisos.join(' | '));
    r = await cmd('tira o destaque');
    check('"tira o destaque"', (await run(`state.focus`)) === null, r.avisos.join(' | '));
    r = await cmd('tela cheia do Mateus');
    check('"tela cheia do Mateus": tela cheia ou, se o Chromium não deixar, destaque', /tela cheia|destaque/.test(r.avisos[0] || ''), r.avisos.join(' | '));
    await run(`document.fullscreenElement ? document.exitFullscreen() : null`).catch(() => {});
    r = await cmd('salva um clipe');
    check('"salva um clipe" sem nada para clipar: recusa explicando', /Nada para clipar/.test(r.avisos[0] || '') && r.sons[0] === 'recusa', r.avisos.join(' | '));
    r = await cmd('silencia todo mundo');
    check('"silencia todo mundo" fora da voz: recusa', /não está na voz/.test(r.avisos[0] || ''), r.avisos.join(' | '));
    await run(`state.musicaOn = true`);
    r = await cmd('toca Evidências do Chitãozinho e Xororó');
    const enviado = await run(`window.__enviados.find((m) => m.type === 'musica-set')`);
    check('"toca Evidências…": busca no YouTube e põe a música', /^[\w-]{11}$/.test(enviado?.videoId || '') && /Tocando:/.test(r.avisos[0] || ''), `${r.avisos.join(' | ')} · ${JSON.stringify(enviado)}`);
    await run(`state.musicas.set('', { ch: '', videoId: ${JSON.stringify(enviado?.videoId || 'dQw4w9WgXcQ')}, by: state.myId, playing: true, pos: 0, at: Date.now() })`);
    r = await cmd('pausa a música');
    check('"pausa a música": manda pausar', (await run(`window.__enviados.some((m) => m.type === 'musica-ctl' && m.action === 'pause')`)) && r.sons[0] === 'ok', r.avisos.join(' | '));
    await run(`(() => { state.sharing = true; window.__parou = false; stopSharing = () => { window.__parou = true; state.sharing = false; }; })()`);
    r = await cmd('deixa minha live só pro meu canal');
    check('"deixa minha live só pro meu canal"', (await run(`state.shareOpen`)) === false, r.avisos.join(' | '));
    r = await cmd('para a minha live');
    check('"para a minha live": pergunta antes (não para ainda)', r.sons[0] === 'pergunta' && !(await run(`window.__parou`)), r.avisos.join(' | '));
    r = await cmd('sim');
    check('"sim": aí sim para a transmissão', await run(`window.__parou`), r.avisos.join(' | '));
    r = await cmd('sim');
    check('"sim" de novo, sem pergunta: nada a confirmar', /Nada para confirmar/.test(r.avisos[0] || ''), r.avisos.join(' | '));

    // Com um modelo de verdade (opcional): OLLAMA_MODELO=qwen2.5:7b npx electron tests/e2e/comando-voz.cjs
    if (process.env.OLLAMA_MODELO) {
      await run(`(() => { for (const id of [...state.pips.keys()]) closePip(id); stopWatching('2'); comandoVoz.ia.url = 'http://localhost:11434'; comandoVoz.ia.modeloLocal = ${JSON.stringify(process.env.OLLAMA_MODELO)}; window.__avisos = []; void pedidoLivreComandoVoz('deixa o Mateus num cantinho lá embaixo na esquerda pra eu ver enquanto jogo'); })()`);
      const t0 = Date.now();
      check(`Modelo real (${process.env.OLLAMA_MODELO}): pedido livre vira janela flutuante`, await until(`state.pips.has('2') && window.__avisos.length > 0`, 60000), `${Date.now() - t0} ms · ${(await run(`window.__avisos`)).join(' | ')}`);
    }

    await run(`leaveRoom ? leaveRoom() : null`).catch(() => {});
    await sleep(300);
    check('Nenhum erro depois de usar', errors.length === 0, errors.join(' | '));
  } catch (e) {
    check('Sem exceção', false, e.message);
  }
  console.log(`${ok} ok, ${bad} falhas`);
  app.exit(bad ? 1 : 0);
});
