'use strict';
// Feedback e bugs (ícone na barrinha, acima da engrenagem): janela com três abas de perguntas curtas — Reportar bug,
// Sugestão e Avaliar o app. Vai para a RazzeAPI por window.api.razzeFeedback (POST /v1/feedback); precisa da conta
// Razze. Versão e sistema quem põe é o processo principal, só com "Enviar dados técnicos" marcado.
// O administrador lê na aba Feedback da Administração (renderer/admin.js).
// Script clássico: só declara; quem liga é renderer/inicio.js (setupFeedback). Usa: util ($, toast, setIcon),
// conectividade (razzeUser), estado (state).

const FB_OPCOES = {
  area: [['chat', 'Chat'], ['voz', 'Voz'], ['transmissao', 'Transmissão'], ['musica', 'Música'], ['mapa', 'Mapa'], ['conta', 'Conta e login'], ['temas', 'Temas'], ['outro', 'Outro']],
  frequencia: [['sempre', 'Sempre'], ['as-vezes', 'Às vezes'], ['uma-vez', 'Uma vez']],
  impacto: [['pouco', 'Pouco'], ['bastante', 'Bastante'], ['bloqueia', 'Não dá pra usar']],
  uso: [['as-vezes', 'De vez em quando'], ['semana', 'Toda semana'], ['dia', 'Todo dia']],
  usa: [['voz', 'Voz'], ['transmissao', 'Transmissão'], ['chat', 'Chat'], ['musica', 'Música'], ['mapa', 'Mapa'], ['gamer', 'Modo gamer']],
  nota: Array.from({ length: 11 }, (_, i) => [String(i), String(i)]),
};
// Nomes das opções para o painel do administrador (renderer/admin.js)
const FB_NOMES = Object.fromEntries(Object.entries(FB_OPCOES).map(([campo, lista]) => [campo, Object.fromEntries(lista)]));
// Sem "Temas" no bug (vira "Outro"); a sugestão pode ser sobre tema
const FB_AREA_BUG = ['chat', 'voz', 'transmissao', 'musica', 'mapa', 'conta', 'outro'];
const FB_IMAGEM_MAX = 440 * 1024; // a RazzeAPI aceita até 450 KB
const fb = { tipo: 'bug', imagem: '', enviando: false, voltarFoco: null };

function fbPane(tipo = fb.tipo) { return document.querySelector(`.fb-pane[data-tipo="${tipo}"]`); }

// Monta os grupos de opções (rádio ou, em "usa", caixas de marcar) a partir de FB_OPCOES
function fbMontarOpcoes() {
  for (const grupo of document.querySelectorAll('#feedbackForm .fb-chips')) {
    const campo = grupo.dataset.campo;
    const multi = campo === 'usa';
    const nome = 'fb-' + (grupo.closest('.fb-pane')?.dataset.tipo || '') + '-' + campo;
    let lista = FB_OPCOES[campo];
    if (campo === 'area' && grupo.dataset.tipoCampo === 'bug') lista = lista.filter(([v]) => FB_AREA_BUG.includes(v));
    grupo.setAttribute('role', multi ? 'group' : 'radiogroup');
    grupo.textContent = '';
    for (const [valor, texto] of lista) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = multi ? 'checkbox' : 'radio';
      input.name = nome;
      input.value = valor;
      // Clicar de novo na opção marcada desmarca (os campos opcionais podem ficar em branco)
      if (!multi) input.onclick = () => { if (input.dataset.marcado === '1') input.checked = false; for (const o of grupo.querySelectorAll('input')) o.dataset.marcado = o.checked ? '1' : ''; fbLimparErro(); };
      else input.onchange = fbLimparErro;
      label.append(input, texto);
      grupo.append(label);
    }
  }
}

function fbMudarTipo(tipo) {
  fb.tipo = tipo;
  for (const b of $('feedbackTabs').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tipo === tipo));
  for (const p of document.querySelectorAll('.fb-pane')) p.hidden = p.dataset.tipo !== tipo;
  fbLimparErro();
}

function fbLimparErro() {
  $('feedbackStatus').textContent = '';
  $('feedbackStatus').classList.remove('warn');
  for (const e of document.querySelectorAll('#feedbackForm [aria-invalid="true"]')) e.removeAttribute('aria-invalid');
}
function fbErro(texto, alvo) {
  $('feedbackStatus').textContent = texto;
  $('feedbackStatus').classList.add('warn');
  if (alvo) { alvo.setAttribute('aria-invalid', 'true'); (alvo.querySelector?.('input') || alvo).focus(); }
}

function fbValor(campo) {
  const pane = fbPane();
  const grupo = pane.querySelector(`.fb-chips[data-campo="${campo}"]`);
  if (grupo) {
    const marcados = [...grupo.querySelectorAll('input:checked')].map((i) => i.value);
    return campo === 'usa' ? marcados : marcados[0];
  }
  const el = pane.querySelector(`[data-campo="${campo}"]`);
  return el ? el.value.trim() : undefined;
}

function fbLogado() { return typeof razzeUser !== 'undefined' && !!razzeUser; }

function abrirFeedback() {
  fb.voltarFoco = document.activeElement;
  $('feedbackDialog').hidden = false;
  $('navFeedback').setAttribute('aria-expanded', 'true');
  const logado = fbLogado();
  $('feedbackLogin').hidden = logado;
  $('feedbackSubmit').disabled = !logado;
  fbLimparErro();
  $('feedbackTabs').querySelector('[aria-selected="true"]').focus();
}
function fecharFeedback() {
  $('feedbackDialog').hidden = true;
  $('navFeedback').setAttribute('aria-expanded', 'false');
  (fb.voltarFoco && document.contains(fb.voltarFoco) ? fb.voltarFoco : $('navFeedback')).focus();
}
function fbLimpar() {
  $('feedbackForm').reset();
  for (const i of document.querySelectorAll('#feedbackForm .fb-chips input')) i.dataset.marcado = '';
  fbTirarImagem();
  fbMudarTipo('bug');
}

// Print: reduz no próprio PC (no máximo 1600 px de largura, JPEG) até caber no limite da RazzeAPI
async function fbCarregarImagem(arquivo) {
  if (!arquivo || !/^image\//.test(arquivo.type)) { toast('Escolha uma imagem (print da tela).', 'error'); return; }
  if (arquivo.size > 40 * 1024 * 1024) { toast('Essa imagem é grande demais.', 'error'); return; }
  $('feedbackDropText').textContent = 'Preparando o print…';
  try {
    const bitmap = await createImageBitmap(arquivo);
    let largura = Math.min(1600, bitmap.width);
    let dados = '';
    for (let qualidade = 0.82; ; qualidade -= 0.12) {
      const escala = largura / bitmap.width;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * escala));
      canvas.height = Math.max(1, Math.round(bitmap.height * escala));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      dados = canvas.toDataURL('image/jpeg', Math.max(0.4, qualidade));
      if (dados.length * 0.75 <= FB_IMAGEM_MAX) break;
      if (qualidade <= 0.5) { largura = Math.round(largura * 0.75); qualidade = 0.94; }
      if (largura < 320) throw new Error('grande');
    }
    bitmap.close();
    fb.imagem = dados;
    $('feedbackPreview').src = dados;
    $('feedbackPreview').hidden = false;
    $('feedbackImageRemove').hidden = false;
    $('feedbackDropText').textContent = 'Print anexado';
  } catch {
    fbTirarImagem();
    toast('Não deu para usar essa imagem.', 'error');
  }
}
function fbTirarImagem() {
  fb.imagem = '';
  $('feedbackPreview').removeAttribute('src');
  $('feedbackPreview').hidden = true;
  $('feedbackImageRemove').hidden = true;
  $('feedbackDropText').textContent = 'Cole com Ctrl+V, arraste aqui ou clique para escolher';
  $('feedbackFile').value = '';
}

async function enviarFeedback(ev) {
  ev.preventDefault();
  if (fb.enviando) return;
  fbLimparErro();
  if (!fbLogado()) { fbErro('Entre na sua conta Razze para mandar feedback.'); return; }
  const pane = fbPane();
  const dados = { tipo: fb.tipo };
  for (const campo of ['area', 'titulo', 'passos', 'detalhes', 'frequencia', 'impacto', 'uso', 'gosta', 'incomoda', 'usa', 'nota']) {
    const v = fbValor(campo);
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    dados[campo] = campo === 'nota' ? Number(v) : v;
  }
  // Obrigatórios: bug (onde e o que deu errado), sugestão (a ideia), avaliação (a nota)
  if (fb.tipo === 'bug' && !dados.area) return fbErro('Escolha onde aconteceu.', pane.querySelector('[data-campo="area"]'));
  if (fb.tipo !== 'nota' && !dados.titulo) return fbErro(fb.tipo === 'bug' ? 'Conte em poucas palavras o que deu errado.' : 'Escreva a sua ideia.', pane.querySelector('[data-campo="titulo"]'));
  if (fb.tipo === 'nota' && dados.nota === undefined) return fbErro('Escolha uma nota de 0 a 10.', pane.querySelector('[data-campo="nota"]'));
  if (fb.tipo === 'bug' && fb.imagem) dados.imagem = fb.imagem;
  dados.contato = $('feedbackContato').checked;
  if ($('feedbackTecnico').checked) dados.tecnico = { tema: document.documentElement.dataset.skin || 'padrao', naSala: !!state.myId };
  fb.enviando = true;
  $('feedbackSubmit').disabled = true;
  $('feedbackStatus').textContent = 'Enviando…';
  try {
    await window.api.razzeFeedback(dados);
    fbLimpar();
    fecharFeedback();
    toast('Valeu! Seu feedback chegou.');
  } catch (e) {
    fbErro(String(e?.message || 'Não deu para enviar. Tente de novo.').replace(/^.*RazzeApiError: /, ''));
  } finally {
    fb.enviando = false;
    $('feedbackSubmit').disabled = !fbLogado();
  }
}

function setupFeedback() {
  fbMontarOpcoes();
  setIcon($('feedbackClose'), 'close', 'Fechar');
  $('navFeedback').onclick = () => ($('feedbackDialog').hidden ? abrirFeedback() : fecharFeedback());
  $('feedbackClose').onclick = fecharFeedback;
  $('feedbackCancel').onclick = fecharFeedback;
  $('feedbackForm').onsubmit = enviarFeedback;
  $('feedbackForm').addEventListener('input', fbLimparErro);
  for (const b of $('feedbackTabs').querySelectorAll('button')) b.onclick = () => fbMudarTipo(b.dataset.tipo);
  // Setas trocam de aba, como nas outras abas do app
  $('feedbackTabs').onkeydown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const abas = [...$('feedbackTabs').querySelectorAll('button')];
    const i = abas.findIndex((b) => b.dataset.tipo === fb.tipo);
    const prox = abas[(i + (e.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
    fbMudarTipo(prox.dataset.tipo);
    prox.focus();
  };
  $('feedbackDialog').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.app-confirm:not([hidden])')) { e.stopPropagation(); fecharFeedback(); } });
  $('feedbackDialog').addEventListener('mousedown', (e) => { if (e.target === $('feedbackDialog')) fecharFeedback(); });
  // Print: clicar escolhe; colar (Ctrl+V em qualquer lugar da janela de bug) ou arrastar também
  const drop = $('feedbackDrop');
  drop.onclick = (e) => { if (e.target !== $('feedbackImageRemove')) $('feedbackFile').click(); };
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('feedbackFile').click(); } };
  $('feedbackFile').onchange = () => void fbCarregarImagem($('feedbackFile').files[0]);
  $('feedbackImageRemove').onclick = (e) => { e.stopPropagation(); fbTirarImagem(); };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); void fbCarregarImagem(e.dataTransfer.files[0]); };
  // Arquivo colado aqui nunca vai para o chat da sala (onChatPaste ignora o que já foi tratado)
  $('feedbackDialog').addEventListener('paste', (e) => {
    const itens = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file');
    if (!itens.length) return;
    e.preventDefault();
    const imagem = itens.find((i) => i.type.startsWith('image/'));
    if (fb.tipo === 'bug' && imagem) void fbCarregarImagem(imagem.getAsFile());
  });
}
