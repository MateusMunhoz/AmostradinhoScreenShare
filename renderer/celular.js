'use strict';
// Configurações › Celular (docs/spec/config-no-celular.md): guardar as configurações num arquivo cifrado no
// celular e trazer de volta em qualquer PC, pelo Wi-Fi, com QR code e senha. A senha só existe neste PC; o celular
// guarda e devolve o arquivo (main/celular.js serve a página dele). O que vai e a validação: renderer/celular-modelo.js.
// Script clássico: divide o escopo global com os outros (ordem no index.html). Usa de: util, preferencias-modelo, qr,
// celular-modelo, estado, configuracoes. Só declara: setupPhone() roda no inicio.js.

const phone = {
  modo: '',        // '' | 'guardar' | 'trazer'
  urls: [],        // [{ name, url }] da rede local
  aberto: false,   // o celular abriu a página
  semAcesso: null, // aviso de "mesmo Wi-Fi" depois de 30 s sem o celular abrir
  arquivo: '',     // o que chegou do celular, ainda cifrado
  erros: 0,        // senhas erradas seguidas
  pronto: null,    // { itens, fora } decifrado e validado, esperando o Aplicar
};

// Um passo da janela de cada vez: 'senha', 'qr', 'resumo' ou nenhum
function phoneStep(step) {
  $('phoneFlow').hidden = !step && !$('phoneStatus').textContent;
  $('phonePassForm').hidden = step !== 'senha';
  $('phoneQrBox').hidden = step !== 'qr';
  $('phoneSummary').hidden = step !== 'resumo';
  $('phoneActions').hidden = !!step;
}
function phoneStatus(text, kind = '') {
  $('phoneStatus').textContent = text;
  $('phoneStatus').className = 'hint phone-status' + (kind ? ' ' + kind : '');
  if (text) $('phoneFlow').hidden = false;
}
function resetPhone() {
  clearTimeout(phone.semAcesso);
  Object.assign(phone, { modo: '', urls: [], aberto: false, semAcesso: null, arquivo: '', erros: 0, pronto: null });
  $('phonePass').value = $('phonePass2').value = '';
  $('phonePassError').textContent = '';
}
// Cancelar (ou fechar as configurações): fecha o servidor da rede local e volta ao começo
function cancelPhone(keepStatus = false) {
  window.api?.celularFechar?.().catch(() => {});
  resetPhone();
  if (!keepStatus) phoneStatus('');
  phoneStep('');
}

function askPhonePass(modo) {
  const guardar = modo === 'guardar';
  $('phonePassTitle').textContent = guardar ? 'Escolha uma senha para o arquivo' : 'Senha do arquivo';
  $('phonePassHint').textContent = guardar
    ? 'Ela protege o arquivo no celular. Não fica guardada em lugar nenhum: sem ela, o arquivo não abre.'
    : 'A mesma senha que você escolheu ao guardar.';
  $('phonePass2Field').hidden = !guardar;
  $('phonePassGo').textContent = guardar ? 'Continuar' : 'Abrir';
  $('phonePass').autocomplete = guardar ? 'new-password' : 'current-password';
  $('phonePassError').textContent = '';
  phoneStatus('');
  phoneStep('senha');
  $('phonePass').focus();
}

function showPhoneQr(urls, hint) {
  phone.urls = urls;
  const select = $('phoneIp');
  select.replaceChildren(...urls.map((u, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: `${u.url.split('/')[2].split(':')[0]} (${u.name})` })));
  select.hidden = urls.length < 2;
  $('phoneIpLabel').hidden = urls.length < 2;
  renderPhoneQr(0);
  $('phoneQrHint').textContent = hint;
  phoneStatus('');
  phoneStep('qr');
  // Sem o celular abrir a página em 30 s: quase sempre é outra rede (4G, outro Wi-Fi) ou o firewall
  clearTimeout(phone.semAcesso);
  phone.semAcesso = setTimeout(() => {
    if (!phone.aberto && phone.modo) phoneStatus('O celular precisa estar no mesmo Wi-Fi deste PC. Se mesmo assim a página não abrir, confira se o Windows deixa o Nebula receber conexões na rede privada.', 'warn');
  }, 30000);
}
function renderPhoneQr(i) {
  const u = phone.urls[i] || phone.urls[0];
  if (!u) return;
  $('phoneQr').innerHTML = qrSvg(u.url);
  $('phoneUrl').textContent = u.url;
}

async function startPhoneSave() {
  const a = $('phonePass').value, b = $('phonePass2').value;
  if (a.length < 6) { $('phonePassError').textContent = 'Use pelo menos 6 caracteres.'; return; }
  if (a !== b) { $('phonePassError').textContent = 'As duas senhas não são iguais.'; return; }
  $('phonePassGo').disabled = true;
  $('phonePassError').textContent = 'Cifrando…';
  try {
    const keys = await window.api.getShortcuts().catch(() => null);
    // Mensagens privadas (Configurações › Mensagens privadas): só com a caixinha ligada e a conta Razze aberta
    let mensagensItem = '', aviso = '';
    if (appPreferences.mensagens.backup && dm.account) {
      const b = CelularModelo.mensagensBackup(dm.account, await window.api.dmExportar(dm.account).catch(() => []));
      mensagensItem = b.item;
      if (b.fora) aviso = ` Das mensagens privadas, ${b.fora} das mais antigas ficaram de fora (o arquivo tem limite de 16 MB).`;
    } else if (appPreferences.mensagens.backup) aviso = ' As mensagens privadas não foram: entre na conta Razze para levá-las.';
    const itens = CelularModelo.juntar(localStorage, keys, mensagensItem);
    const texto = await CelularModelo.cifrar(itens, a, { appVersion: await window.api.getVersion().catch(() => '') });
    const res = await window.api.celularEntregar(texto);
    if (!res?.ok) throw new Error(res?.error || 'Não foi possível abrir a conexão com o celular.');
    $('phonePass').value = $('phonePass2').value = '';
    showPhoneQr(res.urls, 'Leia com a câmera do celular e toque em Baixar arquivo. O código vale por 5 minutos e serve uma vez.' + aviso);
  } catch (err) {
    $('phonePassError').textContent = err.message;
  } finally {
    $('phonePassGo').disabled = false;
  }
}
async function startPhoneLoad() {
  const res = await window.api.celularReceber().catch((err) => ({ ok: false, error: err.message }));
  if (!res?.ok) { phoneStatus(res?.error || 'Não foi possível abrir a conexão com o celular.', 'warn'); phoneStep(''); resetPhone(); return; }
  showPhoneQr(res.urls, 'Leia com a câmera do celular e escolha o arquivo .tp2p que você guardou. O código vale por 5 minutos.');
}
async function openPhoneFile() {
  const senha = $('phonePass').value;
  if (!senha) { $('phonePassError').textContent = 'Digite a senha.'; return; }
  $('phonePassGo').disabled = true;
  $('phonePassError').textContent = 'Abrindo…';
  try {
    const { items, novo } = await CelularModelo.decifrar(phone.arquivo, senha);
    phone.pronto = await CelularModelo.limpar(items);
    $('phonePass').value = '';
    const linhas = CelularModelo.resumo(phone.pronto.itens);
    $('phoneSummaryList').replaceChildren(...linhas.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    const conta = phone.pronto.itens.mensagens ? JSON.parse(phone.pronto.itens.mensagens).conta : '';
    $('phoneSummaryNote').textContent = [novo || phone.pronto.fora.length ? 'Parte do arquivo não serve para esta versão do app e fica de fora.' : '',
      conta && conta !== dm.account ? 'As mensagens privadas são de outra conta Razze (ou você não entrou nela neste PC) e ficam de fora.' : '',
      conta && conta === dm.account ? 'As mensagens privadas se juntam às deste PC; nada é apagado.' : ''].filter(Boolean).join(' ');
    phoneStatus('');
    phoneStep('resumo');
    $('phoneApply').focus();
  } catch (err) {
    if (err.code === 'senha' && ++phone.erros < 5) { $('phonePassError').textContent = err.message + ' Tente de novo.'; $('phonePass').select(); return; }
    cancelPhone(true);
    phoneStatus(err.code === 'senha' ? 'Senha errada 5 vezes: o arquivo foi descartado. Envie de novo pelo celular.' : err.message, 'warn');
  } finally {
    $('phonePassGo').disabled = false;
  }
}
// Aplicar: grava as configurações neste PC (o clientId daqui não muda) e recarrega a interface
async function applyPhoneConfig() {
  const itens = phone.pronto?.itens;
  if (!itens) return;
  if (state.myId) { phoneStatus('Saia da sala para aplicar: a interface recarrega.', 'warn'); return; }
  $('phoneApply').disabled = true;
  for (const [k, v] of Object.entries(itens)) if (k !== 'atalhos' && k !== 'mensagens') save(k, v);
  if (itens.mensagens) {
    const o = JSON.parse(itens.mensagens);
    if (o.conta === dm.account) await window.api.dmImportar(o.conta, o.conversas).catch(() => 0);
  }
  if (itens.atalhos) {
    // Primeiro solta todos (dois atalhos podem trocar de lugar entre si), depois põe os do arquivo
    const novos = JSON.parse(itens.atalhos);
    for (const a of Object.keys(novos)) await window.api.setShortcut(a, '').catch(() => {});
    for (const [a, accel] of Object.entries(novos)) await window.api.setShortcut(a, accel).catch(() => {});
  }
  cancelPhone(true);
  location.reload();
}

function setupPhone() {
  $('phoneSave').onclick = () => { resetPhone(); phone.modo = 'guardar'; askPhonePass('guardar'); };
  $('phoneLoad').onclick = () => {
    resetPhone();
    if (state.myId) { phoneStatus('Saia da sala para trazer as configurações: a interface recarrega no fim.', 'warn'); return; }
    phone.modo = 'trazer';
    void startPhoneLoad();
  };
  $('phonePassForm').onsubmit = (e) => { e.preventDefault(); void (phone.modo === 'guardar' ? startPhoneSave() : openPhoneFile()); };
  for (const id of ['phonePassCancel', 'phoneQrCancel', 'phoneSummaryCancel']) $(id).onclick = () => cancelPhone();
  $('phoneIp').onchange = () => renderPhoneQr(Number($('phoneIp').value));
  $('phoneApply').onclick = () => void applyPhoneConfig();
  window.api.onCelular?.((m) => {
    if (!phone.modo || !m || typeof m !== 'object') return;
    if (m.tipo === 'aberto') {
      phone.aberto = true;
      phoneStatus(phone.modo === 'guardar' ? 'Celular conectado. Toque em Baixar arquivo.' : 'Celular conectado. Escolha o arquivo nele.');
    } else if (m.tipo === 'entregue' && phone.modo === 'guardar') {
      cancelPhone(true);
      phoneStatus('Arquivo entregue ao celular. Guarde ele: é ele (com a senha) que traz suas configurações de volta.', 'ok');
    } else if (m.tipo === 'recebido' && phone.modo === 'trazer' && typeof m.texto === 'string') {
      clearTimeout(phone.semAcesso);
      phone.arquivo = m.texto;
      askPhonePass('trazer');
    } else if (m.tipo === 'expirou') {
      cancelPhone(true);
      phoneStatus('O código expirou. Gere outro.', 'warn');
    }
  });
}
