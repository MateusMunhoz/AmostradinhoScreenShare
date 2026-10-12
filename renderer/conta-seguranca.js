'use strict';
// Conta: identificador nome#1234, código por e-mail, verificação em dois fatores e as formas de entrar
// (docs/spec/identificador-nome-tag.md, docs/spec/email-e-dois-fatores.md). Script clássico: só declara; quem liga é
// renderer/inicio.js (setupContaSeguranca). Usa: util (toast, copiar, load, save), qr (qrSvg), conectividade
// (razzeUser, refreshRazzeState, sairDaConta), primeira-entrada (erroDoServico), conta (google, googleAplicarModo, abrirSenha).

// ---------- Nome do identificador (as mesmas regras do servidor, razze-api/identificador.js) ----------
const ID_RESERVADOS = ['admin', 'administrador', 'nebula', 'razze', 'suporte', 'sistema', 'moderador', 'moderacao', 'staff', 'equipe', 'telap2p'];
function problemaDoNomeId(nome) {
  const n = String(nome || '').trim();
  if (!n) return 'Escolha um nome para o identificador.';
  if (!/^[A-Za-z0-9]*$/.test(n)) return 'Use só letras sem acento e números, sem espaço.';
  if (n.length < 2 || n.length > 32) return 'O nome precisa ter de 2 a 32 letras ou números.';
  if (ID_RESERVADOS.some((r) => n.toLowerCase().startsWith(r))) return 'Esse nome é reservado. Escolha outro.';
  return '';
}
// Sugestão a partir do nome de exibição: sem acento, espaço nem símbolo
function sugerirNomeId(texto) {
  const limpo = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  return limpo.length >= 2 && !problemaDoNomeId(limpo) ? limpo : '';
}
// Texto digitado no Adicionar amigo: nome#1234? (o servidor confere de novo)
const pareceIdentificador = (texto) => /^[A-Za-z0-9]{2,32}#\d{4}$/.test(String(texto || '').trim());

// ---------- Janela de pergunta: código, nome, senha (uma por vez, por cima do resto) ----------
// campos: [{ id, rotulo, tipo, valor, mono, dica, autocomplete }]; corpo: nós extras (QR, lista de códigos);
// extras: links embaixo [{ rotulo, acao(status) }] — se a ação devolver algo, a janela fecha com isso.
// enviar(valores, status) faz o pedido; o que devolver (diferente de undefined/false) fecha a janela e vira o resultado.
// Erro do pedido aparece na própria janela. Cancelar devolve null.
let perguntaAberta = null;
function perguntar({ titulo, texto = '', campos = [], corpo = [], ok = 'Continuar', perigo = false, extras = [], enviar, semCancelar = false }) {
  if (perguntaAberta) perguntaAberta(null);
  return new Promise((resolve) => {
    const dlg = $('contaDialog');
    const status = $('contaDialogStatus');
    const fechar = (valor) => { if (perguntaAberta !== fim) return; perguntaAberta = null; dlg.hidden = true; resolve(valor); };
    const fim = (valor) => fechar(valor);
    perguntaAberta = fim;
    $('contaDialogTitulo').textContent = titulo;
    const box = $('contaDialogCorpo');
    box.replaceChildren();
    if (texto) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = texto; box.append(p); }
    box.append(...corpo);
    const inputs = {};
    for (const c of campos) {
      const label = document.createElement('label');
      label.className = 'field';
      const span = document.createElement('span');
      span.textContent = c.rotulo;
      const input = document.createElement('input');
      input.type = c.tipo || 'text';
      input.value = c.valor || '';
      input.autocomplete = c.autocomplete || 'off';
      input.spellcheck = false;
      if (c.mono) input.className = 'mono';
      if (c.max) input.maxLength = c.max;
      if (c.placeholder) input.placeholder = c.placeholder;
      label.append(span, input);
      if (c.dica) { const d = document.createElement('small'); d.className = 'hint'; d.textContent = c.dica; label.append(d); }
      box.append(label);
      inputs[c.id] = input;
    }
    status.textContent = '';
    const acoes = $('contaDialogAcoes');
    acoes.replaceChildren();
    let ocupado = false;
    const mandar = async () => {
      if (ocupado) return;
      ocupado = true;
      botaoOk.disabled = true;
      status.textContent = 'Enviando…';
      try {
        const valores = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.type === 'password' ? i.value : i.value.trim()]));
        const r = await enviar(valores, (t) => { status.textContent = t; });
        if (r !== undefined && r !== false) return fim(r);
        if (status.textContent === 'Enviando…') status.textContent = '';
      } catch (err) {
        status.textContent = erroDoServico(err);
      } finally { ocupado = false; botaoOk.disabled = false; }
    };
    if (!semCancelar) {
      const cancelar = document.createElement('button');
      cancelar.type = 'button';
      cancelar.className = 'btn ghost';
      cancelar.textContent = 'Cancelar';
      cancelar.onclick = () => fim(null);
      acoes.append(cancelar);
    }
    const botaoOk = document.createElement('button');
    botaoOk.type = 'button';
    botaoOk.className = 'btn ' + (perigo ? 'danger' : 'primary');
    botaoOk.textContent = ok;
    botaoOk.onclick = () => void mandar();
    acoes.append(botaoOk);
    const links = $('contaDialogLinks');
    links.replaceChildren(...extras.map((x) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link-btn';
      b.textContent = x.rotulo;
      b.onclick = async () => {
        try { const r = await x.acao((t) => { status.textContent = t; }); if (r !== undefined) fim(r); }
        catch (err) { status.textContent = erroDoServico(err); }
      };
      return b;
    }));
    dlg.onkeydown = (e) => {
      if (e.key === 'Escape' && !semCancelar) { e.preventDefault(); fim(null); }
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); void mandar(); }
    };
    dlg.hidden = false;
    (Object.values(inputs)[0] || botaoOk).focus();
  });
}

const CAMPO_CODIGO_EMAIL = { id: 'code', rotulo: 'Código de 6 dígitos', mono: true, autocomplete: 'one-time-code', max: 7, placeholder: '123 456' };
const CAMPO_2FA = { id: 'code2fa', rotulo: 'Código do app autenticador', mono: true, autocomplete: 'one-time-code', max: 9, placeholder: '123 456', dica: 'Perdeu o celular? Use um dos códigos de recuperação.' };
const CAMPO_SENHA_ATUAL = { id: 'currentPassword', rotulo: 'Sua senha', tipo: 'password', autocomplete: 'current-password' };
const logadoAgora = () => typeof razzeUser !== 'undefined' && !!razzeUser;

// Ação sensível (docs/spec/email-e-dois-fatores.md): com 2FA pede o código do app; sem ele, a senha (se tiver).
// Os campos entram na mesma janela da ação; conf(valores) separa o que vai para o servidor.
function camposDeConfirmacao() {
  if (!logadoAgora()) return [];
  if (razzeUser.twoFactor) return [CAMPO_2FA];
  return razzeUser.hasPassword ? [CAMPO_SENHA_ATUAL] : [];
}
const conf = (v) => ({ currentPassword: v.currentPassword || '', code2fa: v.code2fa || '' });

// ---------- Entrar, criar conta e confirmar o e-mail ----------
// Entrar com a senha: cuida do 2FA e do e-mail ainda não confirmado. Devolve o resultado (status 'active' ou
// 'pending_approval') ou null se a pessoa desistir no meio.
async function entrarComSenha(login, senha) {
  let r = await window.api.razzeLogin(login, senha);
  if (r.status === '2fa_required') {
    r = await perguntar({
      titulo: 'Verificação em dois fatores', texto: 'Digite o código de 6 dígitos do app autenticador.',
      campos: [{ ...CAMPO_2FA, id: 'code', rotulo: 'Código' }], ok: 'Entrar',
      enviar: (v) => window.api.razzeLogin2fa(v.code),
    });
  } else if (r.status === 'email_unconfirmed') {
    if (!r.email) throw new Error('Confirme seu e-mail antes de entrar: entre pelo e-mail (não pelo identificador) para receber o código de novo.');
    r = await confirmarCadastro('', true);
  }
  if (r?.status === 'active') await aposEntrar(r);
  return r;
}

// Código do cadastro (ou do login de quem ainda não confirmou): com Reenviar
function confirmarCadastro(enviadoPara, reenviarJa = false) {
  if (reenviarJa) void window.api.razzeResendConfirmation().catch(() => {});
  return perguntar({
    titulo: 'Confirme seu e-mail',
    texto: (enviadoPara ? 'Mandamos um código para ' + enviadoPara + '.' : 'Mandamos um código para o seu e-mail.') + ' Ele vale por 15 minutos. Não chegou? Olhe a caixa de spam.',
    campos: [CAMPO_CODIGO_EMAIL], ok: 'Confirmar',
    extras: [{ rotulo: 'Mandar outro código', acao: async (status) => { await window.api.razzeResendConfirmation(); status('Código novo enviado.'); } }],
    enviar: (v) => window.api.razzeConfirmEmail(v.code),
  });
}

// Criar conta por senha. Devolve o resultado final ('active', 'pending_approval') ou null.
async function cadastrar(email, senha, nomeExibicao, nomeId) {
  const r = await window.api.razzeRegister(email, senha, nomeExibicao, nomeId);
  if (r.status === 'confirm_email') {
    const fim = await confirmarCadastro(r.enviadoPara);
    if (fim?.status === 'active') await aposEntrar(fim);
    return fim;
  }
  return r;
}

// Entrou: carrega a conta, vincula o Google que estava esperando ("Entrar e vincular") e avisa do identificador
async function aposEntrar(r) {
  razzeUser = r.user;
  await refreshRazzeState();
  if (await window.api.razzeGooglePending().catch(() => false)) await vincularGooglePendente();
  avisarIdentificador();
}

// Identificador gerado automaticamente (conta de antes dele, ou criada por app antigo): pede para escolher o nome, uma
// vez por abertura do app, até a pessoa salvar um ou manter o gerado. Escolhido: um aviso só, com Copiar.
let identificadorPedido = '';
function avisarIdentificador() {
  if (!logadoAgora() || !razzeUser.handle) return;
  if (razzeUser.handleChosen === false) {
    if (identificadorPedido === razzeUser.id) return;
    identificadorPedido = razzeUser.id;
    return void escolherIdentificador();
  }
  if (load('identificadorVisto', '') === razzeUser.id) return;
  save('identificadorVisto', razzeUser.id);
  toast('Sua conta é ' + razzeUser.handle + '. É por ele que seus amigos te adicionam.', 'info',
    { label: 'Copiar', run: () => void copiarIdentificador() });
}
async function escolherIdentificador() {
  const atual = razzeUser.handle;
  const r = await perguntar({
    titulo: 'Escolha seu identificador',
    texto: 'Agora cada conta tem um identificador no formato nome#1234: é por ele que os amigos te adicionam e você pode entrar com ele. '
      + 'O seu foi criado automaticamente: ' + atual + '. Escolha o nome (só letras sem acento e números); o número depois do # fica o mesmo se estiver livre.',
    campos: [{ id: 'nome', rotulo: 'Nome', valor: atual.split('#')[0], max: 32 }], ok: 'Salvar',
    extras: [{ rotulo: 'Manter ' + atual, acao: () => window.api.razzeKeepHandle() }],
    enviar: (v) => { const p = problemaDoNomeId(v.nome); if (p) throw new Error(p); return window.api.razzeSetHandle(v.nome); },
  });
  if (!r?.user) return; // Cancelar: pergunta de novo na próxima vez que abrir o app
  atualizarUsuario(r.user);
  save('identificadorVisto', r.user.id);
  toast('Seu identificador é ' + r.user.handle + '.', 'info', { label: 'Copiar', run: () => void copiarIdentificador() });
}
async function copiarIdentificador() {
  if (!logadoAgora() || !razzeUser.handle) return toast('Entre na sua conta para ter um identificador.', 'error');
  try { await copiar(razzeUser.handle); toast('Identificador copiado: ' + razzeUser.handle); }
  catch { toast('Não deu para copiar. Seu identificador é ' + razzeUser.handle, 'error'); }
}

// ---------- Google ----------
// Entrar com Google: conta nova escolhe o nome antes; "Já tenho conta" mostra o formulário de senha e o Google é
// vinculado logo depois de entrar. mostrarSenha(texto): abre o formulário de senha da tela atual com o aviso.
async function googleEntrarFluxo(statusEl, depois, mostrarSenha) {
  const r = await window.api.razzeGoogleLogin();
  if (r.status === 'pending_approval') {
    statusEl.textContent = 'Pedido enviado. Avise o administrador para aprovar; quando ele aprovar, toque em Entrar com Google de novo. Enquanto isso, use sem conta.';
    return;
  }
  if (r.status === 'account_exists') return mostrarSenha(r.message.replace(/ Entre com a senha e vincule.*$/, '') + ' Entre com a senha dela: o Google é vinculado logo em seguida.');
  let fim = r;
  if (r.status === 'choose_handle') {
    fim = await perguntar({
      titulo: 'Seu identificador',
      texto: 'É por ele que os amigos te adicionam (' + r.email + '). Use só letras sem acento e números; o número depois do # é sorteado.',
      campos: [{ id: 'nome', rotulo: 'Nome', valor: r.suggestion, max: 32, dica: 'Dá para trocar depois em Perfil › Conta.' }],
      ok: 'Criar conta',
      extras: [{ rotulo: 'Já tenho conta no Nebula: entrar e vincular este Google', acao: () => 'vincular' }],
      enviar: (v) => { const p = problemaDoNomeId(v.nome); if (p) throw new Error(p); return window.api.razzeGoogleFinish(v.nome); },
    });
    if (!fim) { statusEl.textContent = 'Conta não criada.'; return; }
    if (fim === 'vincular') return mostrarSenha('Entre com o e-mail (ou identificador) e a senha da sua conta. O Google é vinculado logo em seguida.');
    if (fim.status === 'pending_approval') { statusEl.textContent = 'Conta criada. O administrador ainda precisa aprovar; quando aprovar, entre com o Google de novo.'; return; }
  }
  await aposEntrar(fim);
  statusEl.textContent = '';
  depois();
  toast(r.status === 'choose_handle' ? 'Conta criada: ' + (razzeUser?.handle || '') : 'Você entrou com o Google.');
}

// O Google confirmado antes de entrar ("Entrar e vincular" ou e-mail que já tinha conta)
async function vincularGooglePendente() {
  const campos = camposDeConfirmacao().filter((c) => c.id === 'code2fa'); // vincular só pede o 2FA (a senha acabou de ser digitada)
  let r;
  if (campos.length) {
    r = await perguntar({ titulo: 'Vincular o Google', texto: 'Para ligar o Google à sua conta, digite o código do app autenticador.', campos, ok: 'Vincular', enviar: (v) => window.api.razzeGoogleLinkPending(conf(v)) });
    if (!r) return;
  } else r = await window.api.razzeGoogleLinkPending({}).catch((err) => { toast('Não deu para vincular o Google: ' + erroDoServico(err), 'error'); return null; });
  if (r?.status === 'linked') { razzeUser = r.user; toast('Google vinculado à sua conta.'); }
  else if (r?.status === 'google_taken') await googleTomado(r);
}

// Esse Google é de outra conta: mostra o que ela tem e oferece mover (excluindo a outra se ela só entrava por ele)
async function googleTomado(info) {
  if (info.bloqueio) return void perguntar({ titulo: 'Esse Google é de outra conta', texto: info.message, ok: 'Entendi', semCancelar: true, enviar: () => true });
  const tem = [info.amigos + (info.amigos === 1 ? ' amigo' : ' amigos'), info.mensagens + (info.mensagens === 1 ? ' mensagem' : ' mensagens')];
  if (info.redes) tem.push(info.redes + (info.redes === 1 ? ' rede' : ' redes'));
  const texto = 'Esse Google entra na conta ' + info.handle + ' (' + tem.join(', ') + '). '
    + (info.excluir ? 'Ela só entra por esse Google: ao mover, a conta ' + info.handle + ' é excluída. Amizades e mensagens dela não passam para esta conta.'
      : 'Ela tem senha: só perde o Google e continua existindo.');
  const r = await perguntar({ titulo: 'Mover o Google para esta conta?', texto, campos: camposDeConfirmacao(), ok: info.excluir ? 'Mover e excluir a outra' : 'Mover', perigo: info.excluir,
    enviar: (v) => window.api.razzeGoogleMove(conf(v)) });
  if (r?.status === 'moved') { razzeUser = r.user; toast(r.deleted ? 'Google movido; a outra conta foi excluída.' : 'Google movido para esta conta.'); }
}

// ---------- Esqueci a senha ----------
// Com e-mail no servidor: código no e-mail confirmado (e o 2FA, se ligado). Sem: o código do administrador (conta.js).
async function esqueciSenha(login) {
  if (!google.emailConfirmacao) return abrirSenha('esqueci', login);
  const pedido = await perguntar({
    titulo: 'Esqueci a senha', texto: 'Mandamos um código para o e-mail confirmado da conta.',
    campos: [{ id: 'login', rotulo: 'E-mail ou identificador', valor: login, autocomplete: 'username' }], ok: 'Mandar código',
    extras: [{ rotulo: 'Tenho um código do administrador', acao: () => 'admin' }],
    enviar: async (v) => { if (!v.login) throw new Error('Digite o e-mail ou o identificador.'); return { ...(await window.api.razzeForgot(v.login)), login: v.login }; },
  });
  if (pedido === 'admin') return abrirSenha('esqueci', login);
  if (!pedido) return;
  const fim = await perguntar({
    titulo: 'Senha nova', texto: 'Se o e-mail ou identificador tiver conta com e-mail confirmado, o código chega em instantes. Vale por 15 minutos.',
    campos: [CAMPO_CODIGO_EMAIL, { id: 'senha', rotulo: 'Senha nova (mínimo 8 caracteres)', tipo: 'password', autocomplete: 'new-password' },
      { id: 'senha2', rotulo: 'Repita a senha nova', tipo: 'password', autocomplete: 'new-password' }, ...(pedido.twoFactor ? [CAMPO_2FA] : [])],
    ok: 'Trocar a senha',
    enviar: async (v) => {
      if (v.senha.length < 8) throw new Error('A senha nova precisa de pelo menos 8 caracteres.');
      if (v.senha !== v.senha2) throw new Error('As duas senhas novas não são iguais.');
      await window.api.razzeForgotReset({ login: pedido.login, code: v.code, password: v.senha, code2fa: v.code2fa || '' });
      return { senha: v.senha };
    },
  });
  if (!fim) return;
  // Entra sozinho com a senha nova
  try {
    const r = await entrarComSenha(pedido.login, fim.senha);
    if (r?.status === 'active') { if (!$('onboarding').hidden) fecharPrimeiraEntrada(); else void retomarConviteAmigo(); toast('Senha trocada. Você já está dentro.'); }
  } catch { toast('Senha trocada. Entre com a senha nova.'); }
}

// ---------- aba Conta do Perfil ----------
function segLinha(titulo, valor, botoes = [], dica = '') {
  const sec = document.createElement('section');
  sec.className = 'seg-item';
  const topo = document.createElement('div');
  topo.className = 'seg-item-topo';
  const h = document.createElement('h3');
  h.textContent = titulo;
  const v = document.createElement('span');
  v.className = 'seg-valor';
  v.textContent = valor;
  topo.append(h, v);
  const acoes = document.createElement('div');
  acoes.className = 'seg-acoes';
  for (const [rotulo, acao, extra] of botoes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small' + (extra?.perigo ? ' danger' : '');
    b.textContent = rotulo;
    b.disabled = !!extra?.desligado;
    if (extra?.titulo) b.title = extra.titulo;
    b.onclick = async () => {
      b.disabled = true;
      try { await acao(); } catch (err) { toast('Não deu: ' + erroDoServico(err), 'error'); }
      finally { b.disabled = false; renderSeguranca(); }
    };
    acoes.append(b);
  }
  sec.append(topo);
  if (dica) { const d = document.createElement('p'); d.className = 'hint'; d.textContent = dica; sec.append(d); }
  if (botoes.length) sec.append(acoes);
  return sec;
}

const atualizarUsuario = (u) => { if (u) razzeUser = u; void refreshRazzeState(); };
const dataCurta = (ms) => new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });

// O que falta na conta, para o aviso no alto da aba Conta e a bolinha na aba (um de cada vez, o mais importante antes)
function pendenciaDaConta() {
  if (!logadoAgora()) return null;
  const u = razzeUser;
  if (u.handleChosen === false && u.handle) return { texto: 'Escolha o nome do seu identificador. Hoje ele é ' + u.handle + '.', botao: 'Escolher', acao: escolherIdentificador };
  if (!u.emailVerified && google.emailConfirmacao) return { texto: 'Confirme seu e-mail para poder recuperar a senha por ele.', botao: 'Enviar código', acao: confirmarEmailAtual };
  return null;
}
const contaPrecisaAtencao = () => !!pendenciaDaConta();

// Aba Conta do Perfil: o identificador no cartão, o aviso do que falta, as linhas da conta e o Sair no rodapé
function renderSeguranca() {
  const box = $('segurancaCorpo');
  const logado = logadoAgora();
  const pend = pendenciaDaConta();
  $('profileTabDot').hidden = !pend;
  $('contaPendente').hidden = !pend;
  if (pend) {
    $('contaPendenteTexto').textContent = pend.texto;
    $('contaPendenteBtn').textContent = pend.botao;
    $('contaPendenteBtn').onclick = () => void pend.acao();
  }
  $('profileContaRodape').hidden = !logado;
  $('profileCardIdLinha').hidden = !(logado && razzeUser.handle);
  $('profileCardId').textContent = logado ? razzeUser.handle || '' : '';
  if (!logado) { box.replaceChildren(); return; }
  const u = razzeUser;
  const podeTrocarNome = !u.handleChangeAt || u.handleChangeAt <= Date.now();
  const linhas = [
    segLinha('Identificador', u.handle || '—', [
      ['Copiar', copiarIdentificador],
      ['Trocar o nome', trocarNomeId, { desligado: !podeTrocarNome, titulo: podeTrocarNome ? '' : 'Dá para trocar de novo em ' + dataCurta(u.handleChangeAt) }],
    ], 'É por ele que os amigos te adicionam. ' + (podeTrocarNome ? 'O nome pode ser trocado a cada 7 dias.' : 'Dá para trocar de novo em ' + dataCurta(u.handleChangeAt) + '.')),
    segLinha('E-mail', u.email + (u.emailVerified ? ' · confirmado' : ' · não confirmado'), [
      ...(!u.emailVerified && google.emailConfirmacao ? [['Confirmar', confirmarEmailAtual]] : []),
      ...(u.hasPassword && google.emailConfirmacao ? [['Trocar e-mail', trocarEmail]] : []),
    ], !google.emailConfirmacao ? 'Este servidor ainda não manda e-mail.' : u.hasPassword ? '' : 'Para trocar o e-mail, primeiro use "Entrar também com senha".'),
    segLinha('Senha', u.hasPassword ? 'definida' : 'sem senha (entra pelo Google)', [
      u.hasPassword ? ['Trocar senha', () => abrirSenha('trocar')] : ['Entrar também com senha', entrarTambemComSenha],
    ]),
    segLinha('Google', u.googleLinked ? 'vinculado' : 'não vinculado', !google.ligado ? [] : u.googleLinked
      ? [['Trocar Google', vincularGoogle], ...(u.hasPassword ? [['Desvincular', desvincularGoogle, { perigo: true }]] : [])]
      : [['Vincular Google', vincularGoogle]],
    u.googleLinked && !u.hasPassword ? 'Para desvincular o Google, primeiro defina uma senha.' : ''),
    segLinha('Verificação em dois fatores', u.twoFactor ? 'ligada' : 'desligada', !google.doisFatores ? [] : u.twoFactor
      ? [['Novos códigos de recuperação', novosCodigos], ...(u.role === 'admin' ? [] : [['Desligar', desligar2fa, { perigo: true }]])]
      : [['Ligar', ligar2fa]],
    !google.doisFatores ? 'Este servidor ainda não tem a verificação em dois fatores.'
      : u.twoFactor ? 'Entrar com a senha pede também o código do app autenticador.' + (u.role === 'admin' ? ' Administradores não podem desligar.' : '')
      : 'Além da senha, pede um código do app autenticador do celular (Google Authenticator, Microsoft Authenticator…).'),
  ];
  box.replaceChildren(...linhas);
}

// Abriu a aba Conta: busca a conta e o que o servidor tem ligado (e-mail, Google, 2FA) antes de desenhar
async function atualizarAbaConta() {
  if (logadoAgora()) {
    try { const { user } = await window.api.razzeMe(); razzeUser = user; } catch { /* mostra o que tem */ }
    if (typeof googleAtualizar === 'function') await googleAtualizar();
  }
  renderSeguranca();
}

async function trocarNomeId() {
  const r = await perguntar({
    titulo: 'Trocar o nome do identificador', texto: 'Use só letras sem acento e números. O número depois do # fica o mesmo se estiver livre no nome novo.',
    campos: [{ id: 'nome', rotulo: 'Nome', valor: (razzeUser.handle || '').split('#')[0], max: 32 }], ok: 'Trocar',
    enviar: (v) => { const p = problemaDoNomeId(v.nome); if (p) throw new Error(p); return window.api.razzeSetHandle(v.nome); },
  });
  if (r?.user) { atualizarUsuario(r.user); toast('Seu identificador agora é ' + r.user.handle); }
}

// Código mandado para um e-mail (trocar ou confirmar): pede e confirma
function codigoDoEmail(enviadoPara, purpose) {
  return perguntar({
    titulo: 'Código do e-mail', texto: 'Mandamos um código para ' + enviadoPara + '. Vale por 15 minutos.',
    campos: [CAMPO_CODIGO_EMAIL], ok: 'Confirmar',
    enviar: (v) => window.api.razzeConfirmEmailChange(v.code, purpose),
  });
}
async function confirmarEmailAtual() {
  const r = await window.api.razzeVerifyEmail();
  if (r.user) return atualizarUsuario(r.user);
  const fim = await codigoDoEmail(r.enviadoPara, 'confirmar');
  if (fim?.user) { atualizarUsuario(fim.user); toast('E-mail confirmado.'); }
}
async function trocarEmail() {
  const pedido = await perguntar({
    titulo: 'Trocar o e-mail', texto: 'O e-mail só muda depois do código que mandamos para o novo. O antigo recebe um aviso.',
    campos: [{ id: 'email', rotulo: 'E-mail novo', tipo: 'email', autocomplete: 'email' }, ...camposDeConfirmacao()], ok: 'Mandar código',
    enviar: async (v) => ({ ...(await window.api.razzeChangeEmail(v.email, conf(v))), email: v.email }),
  });
  if (!pedido) return;
  const fim = await codigoDoEmail(pedido.enviadoPara, 'trocar-email');
  if (fim?.user) { atualizarUsuario(fim.user); toast('E-mail trocado para ' + fim.user.email); }
}
// Conta do Google define uma senha; com outro e-mail, o e-mail e a senha só mudam com o código
async function entrarTambemComSenha() {
  const pedido = await perguntar({
    titulo: 'Entrar também com senha', texto: 'Escolha a senha e o e-mail para entrar com ela. Trocar o e-mail pede um código mandado para o novo.',
    campos: [{ id: 'email', rotulo: 'E-mail', tipo: 'email', valor: razzeUser.email, autocomplete: 'email' },
      { id: 'senha', rotulo: 'Senha (mínimo 8 caracteres)', tipo: 'password', autocomplete: 'new-password' },
      { id: 'senha2', rotulo: 'Repita a senha', tipo: 'password', autocomplete: 'new-password' }, ...camposDeConfirmacao()],
    ok: 'Continuar',
    enviar: async (v) => {
      if (v.senha.length < 8) throw new Error('A senha precisa de pelo menos 8 caracteres.');
      if (v.senha !== v.senha2) throw new Error('As duas senhas não são iguais.');
      if (v.email.toLowerCase() === String(razzeUser.email).toLowerCase()) { await window.api.razzeChangePassword('', v.senha, v.code2fa || ''); return { pronto: true }; }
      if (!google.emailConfirmacao) throw new Error('Este servidor ainda não manda e-mail: use o mesmo e-mail da conta.');
      return await window.api.razzePasswordSetup(v.senha, v.email, conf(v));
    },
  });
  if (!pedido) return;
  if (pedido.pronto) { atualizarUsuario((await window.api.razzeMe()).user); return toast('Senha criada. Agora dá para entrar com ela.'); }
  const fim = await codigoDoEmail(pedido.enviadoPara, 'trocar-email');
  if (fim?.user) { atualizarUsuario(fim.user); toast('Senha criada e e-mail trocado.'); }
}

async function vincularGoogle() {
  const campos = camposDeConfirmacao().filter((c) => c.id === 'code2fa');
  let r;
  if (campos.length) r = await perguntar({ titulo: razzeUser.googleLinked ? 'Trocar o Google' : 'Vincular o Google', texto: 'Digite o código do app autenticador. Depois o navegador abre no Google.', campos, ok: 'Abrir o Google', enviar: (v) => window.api.razzeGoogleLink(conf(v)) });
  else { toast('Abrindo o navegador… escolha a conta do Google e volte para cá.'); r = await window.api.razzeGoogleLink({}); }
  if (r?.status === 'linked') { atualizarUsuario(r.user); toast('Google vinculado à sua conta.'); }
  else if (r?.status === 'google_taken') { await googleTomado(r); atualizarUsuario(); }
}
async function desvincularGoogle() {
  const r = await perguntar({ titulo: 'Desvincular o Google', texto: 'O Google não vai mais entrar nesta conta. Você continua entrando com a senha.', campos: camposDeConfirmacao(), ok: 'Desvincular', perigo: true,
    enviar: (v) => window.api.razzeGoogleUnlink(conf(v)) });
  if (r?.user) { atualizarUsuario(r.user); toast('Google desvinculado.'); }
}

// Os códigos de recuperação aparecem uma vez só
function mostrarCodigos(codigos) {
  const lista = document.createElement('ol');
  lista.className = 'seg-codigos mono';
  for (const c of codigos) { const li = document.createElement('li'); li.textContent = c; lista.append(li); }
  return perguntar({
    titulo: 'Códigos de recuperação', texto: 'Guarde estes códigos num lugar seguro (gerenciador de senhas ou papel). Cada um entra uma vez se você perder o celular. Eles não aparecem de novo.',
    corpo: [lista], ok: 'Já guardei', semCancelar: true,
    extras: [
      { rotulo: 'Copiar os códigos', acao: async (status) => { await copiar(codigos.join('\n')); status('Copiados.'); } },
      { rotulo: 'Salvar em arquivo', acao: (status) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['Códigos de recuperação do Nebula (' + (razzeUser?.handle || '') + ')\n\n' + codigos.join('\n') + '\n'], { type: 'text/plain' }));
        a.download = 'nebula-codigos-de-recuperacao.txt';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        status('Arquivo salvo.');
      } },
    ],
    enviar: () => true,
  });
}
async function ligar2fa() {
  const setup = await perguntar({ titulo: 'Ligar a verificação em dois fatores', texto: 'Você vai precisar de um app autenticador no celular (Google Authenticator, Microsoft Authenticator, 2FAS…).',
    campos: camposDeConfirmacao(), ok: 'Continuar', enviar: (v) => window.api.razze2faSetup(conf(v)) });
  if (!setup) return;
  const qr = document.createElement('div');
  qr.className = 'seg-qr';
  qr.innerHTML = qrSvg(setup.otpauth); // SVG gerado aqui (renderer/qr.js), sem dado de fora
  const chave = document.createElement('p');
  chave.className = 'hint';
  chave.append('Sem câmera? Digite a chave no app: ');
  const mono = document.createElement('code');
  mono.className = 'mono seg-chave';
  mono.textContent = setup.secret.replace(/(.{4})/g, '$1 ').trim();
  chave.append(mono);
  const fim = await perguntar({ titulo: 'Leia o QR code com o app', texto: '1. No app autenticador, adicione uma conta pelo QR code. 2. Digite o código de 6 dígitos que aparecer.',
    corpo: [qr, chave], campos: [{ id: 'code', rotulo: 'Código do app', mono: true, autocomplete: 'one-time-code', max: 7 }], ok: 'Ligar',
    enviar: (v) => window.api.razze2faEnable(v.code) });
  if (!fim) return;
  atualizarUsuario(fim.user);
  await mostrarCodigos(fim.recoveryCodes);
  toast('Verificação em dois fatores ligada.');
}
async function desligar2fa() {
  const r = await perguntar({ titulo: 'Desligar a verificação em dois fatores', texto: 'Entrar com a senha volta a pedir só a senha.', campos: camposDeConfirmacao(), ok: 'Desligar', perigo: true,
    enviar: (v) => window.api.razze2faDisable(conf(v)) });
  if (r?.user) { atualizarUsuario(r.user); toast('Verificação em dois fatores desligada.'); }
}
async function novosCodigos() {
  const r = await perguntar({ titulo: 'Novos códigos de recuperação', texto: 'Os códigos antigos param de valer.', campos: camposDeConfirmacao(), ok: 'Gerar',
    enviar: (v) => window.api.razze2faRecovery(conf(v)) });
  if (r?.recoveryCodes) await mostrarCodigos(r.recoveryCodes);
}

function setupContaSeguranca() {
  $('profileCardIdCopy').onclick = () => void copiarIdentificador();
  for (const id of ['friendsIdCopy', 'homeFriendsId']) if ($(id)) $(id).onclick = () => { if (id === 'homeFriendsId') setHomeConvidarOpen(false); void copiarIdentificador(); };
}

if (typeof module !== 'undefined') module.exports = { problemaDoNomeId, sugerirNomeId, pareceIdentificador };
