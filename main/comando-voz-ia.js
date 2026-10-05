'use strict';
// Comando de voz, pedidos livres (docs/spec/comando-de-voz.md, etapa B): manda o texto do pedido e o estado da sala
// para um modelo de linguagem, com a lista de ações (renderer/comando-voz-acoes.js), e devolve as ações escolhidas.
// - Nuvem: Claude pela API da Anthropic (@anthropic-ai/sdk). A chave da pessoa fica cifrada (safeStorage) num arquivo
//   da pasta de dados e nunca volta para a página.
// - Local: um servidor no próprio PC com a API compatível com a da OpenAI (Ollama, LM Studio), só em localhost.
// Só usa módulos do Node e o que o main.js passa (storage), para os testes rodarem sem o Electron.
const fs = require('fs');
const path = require('path');
const Acoes = require('../renderer/comando-voz-acoes');

const MODELOS_NUVEM = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'];
// Opus 5.5 e Sonnet 5.5: esforço baixo (escolher uma ação é simples) e, se o modelo recusar, a API tenta de novo
// noutro (fallbacks "default"). O Haiku 4.5 não aceita esforço nem esse beta
const COM_ESFORCO = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const MAX_TEXTO = 500;
const TEMPO_NUVEM = 20000;
const TEMPO_LOCAL = 60000; // o servidor local pode estar carregando o modelo na primeira vez
const SOLTAR_PLACA = '60s';  // o Ollama tira o modelo da placa de vídeo 1 minuto depois do último comando

// Endereço do servidor local: só http(s) em localhost, 127.0.0.1 ou [::1], com porta; sem caminho
function urlLocal(texto) {
  let u;
  try { u = new URL(String(texto || '').trim()); } catch { return ''; }
  if (!/^https?:$/.test(u.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password) return '';
  return `${u.protocol}//${u.host}`;
}
const modeloLocalOk = (m) => typeof m === 'string' && /^[\w.:\/@-]{1,100}$/.test(m);

// opcoes (para os testes): Anthropic (a classe do SDK), baseURL (servidor de mentira no lugar da API)
function criarIa(pastaDados, { storage, Anthropic, baseURL } = {}) {
  const arquivoChave = path.join(pastaDados, 'comando-voz', 'chave-anthropic.bin');
  let ocupado = false;

  function lerChave() {
    try { return storage.decryptString(fs.readFileSync(arquivoChave)); } catch { return ''; }
  }
  function salvarChave(chave) {
    chave = String(chave || '').trim();
    if (!/^sk-ant-[\w-]{20,300}$/.test(chave)) return { ok: false, erro: 'Isso não parece uma chave da API da Anthropic (começa com sk-ant-).' };
    if (!storage?.isEncryptionAvailable?.()) return { ok: false, erro: 'O Windows não deixou guardar a chave cifrada neste PC.' };
    fs.mkdirSync(path.dirname(arquivoChave), { recursive: true });
    fs.writeFileSync(arquivoChave, storage.encryptString(chave));
    return { ok: true };
  }
  const temChave = () => !!lerChave();
  function apagarChave() { fs.rmSync(arquivoChave, { force: true }); return { ok: true }; }

  // Carrega o SDK só quando precisa: numa instalação antiga (atualizada pela sala), ele ainda não existe
  function sdk() {
    if (Anthropic) return Anthropic;
    try { const m = require('@anthropic-ai/sdk'); return m.default || m; } catch { return null; }
  }
  const nuvemDisponivel = () => !!sdk();

  async function nuvem(texto, ctx, modelo) {
    const A = sdk();
    if (!A) return { ok: false, erro: 'Esta instalação ainda não tem a parte da nuvem. Instale o Tela P2P pelo instalador novo.' };
    const apiKey = lerChave();
    if (!apiKey) return { ok: false, erro: 'Falta a chave da API da Anthropic (Recursos extras).' };
    if (!MODELOS_NUVEM.includes(modelo)) return { ok: false, erro: 'Modelo da nuvem desconhecido.' };
    const client = new A({ apiKey, timeout: TEMPO_NUVEM, maxRetries: 1, ...(baseURL ? { baseURL } : {}) });
    const pedido = {
      model: modelo,
      max_tokens: 1024,
      system: Acoes.sistema(ctx),
      tools: Acoes.ferramentas(ctx),
      messages: [{ role: 'user', content: texto }],
    };
    let resp;
    try {
      resp = COM_ESFORCO.has(modelo)
        ? await client.beta.messages.create({ ...pedido, output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(pedido);
    } catch (err) {
      if (err instanceof A.AuthenticationError) return { ok: false, erro: 'A chave da API da Anthropic foi recusada. Confira em Recursos extras.' };
      if (err instanceof A.PermissionDeniedError) return { ok: false, erro: 'A chave não tem acesso a esse modelo.' };
      if (err instanceof A.RateLimitError) return { ok: false, erro: 'A API da Anthropic pediu para esperar um pouco (limite de uso).' };
      if (err instanceof A.APIConnectionError) return { ok: false, erro: 'Sem conexão com a API da Anthropic.' };
      if (err instanceof A.APIError) return { ok: false, erro: `A API da Anthropic respondeu com erro (${err.status ?? 'sem status'}).` };
      return { ok: false, erro: String(err?.message || err).slice(0, 200) };
    }
    if (resp.stop_reason === 'refusal') return { ok: false, erro: 'O modelo recusou esse pedido.' };
    const acoes = resp.content.filter((b) => b.type === 'tool_use').map((b) => ({ nome: b.name, input: b.input }));
    const resposta = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    return { ok: true, acoes, texto: resposta };
  }

  async function local(texto, ctx, modelo, url) {
    const base = urlLocal(url);
    if (!base) return { ok: false, erro: 'O endereço do servidor local precisa ser localhost (ex.: http://localhost:11434).' };
    if (!modeloLocalOk(modelo)) return { ok: false, erro: 'Nome de modelo local inválido.' };
    const tools = Acoes.ferramentas(ctx).map((f) => ({ type: 'function', function: { name: f.name, description: f.description, parameters: f.input_schema } }));
    let resp;
    try {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(TEMPO_LOCAL),
        body: JSON.stringify({ model: modelo, temperature: 0, stream: false, tools,
          messages: [{ role: 'system', content: Acoes.sistema(ctx) }, { role: 'user', content: texto }] }),
      });
      resp = await r.json().catch(() => null);
      if (!r.ok) {
        const msg = String(resp?.error?.message || resp?.error || '').slice(0, 160);
        if (/does not support tools/i.test(msg)) return { ok: false, erro: `O modelo ${modelo} não sabe escolher ações (sem suporte a tools). Use outro, como qwen2.5 ou llama3.1.` };
        if (r.status === 404) return { ok: false, erro: `O servidor local não tem o modelo ${modelo}. Baixe ele antes (ex.: ollama pull ${modelo}).` };
        return { ok: false, erro: `O servidor local respondeu com erro (${r.status})${msg ? `: ${msg}` : ''}.` };
      }
    } catch (err) {
      if (err?.name === 'TimeoutError') return { ok: false, erro: 'O modelo local demorou demais para responder.' };
      return { ok: false, erro: `Não achei o servidor local em ${base}. O Ollama (ou o LM Studio) está aberto?` };
    }
    // O Ollama deixa o modelo na placa de vídeo por 5 minutos (uns 5 GB num 7B), e a API compatível com a da OpenAI
    // não muda isso: pede pela API dele para soltar 1 minuto depois do último comando (no jogo, a memória volta logo;
    // comandos em sequência continuam rápidos). Outro servidor (LM Studio) só responde que não conhece: tudo bem
    fetch(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ model: modelo, keep_alive: SOLTAR_PLACA }) }).then((r) => r.body?.cancel(), () => {});
    const msg = resp?.choices?.[0]?.message || {};
    const acoes = [];
    for (const c of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
      const fn = c?.function || {};
      let input = fn.arguments;
      if (typeof input === 'string') { try { input = JSON.parse(input || '{}'); } catch { input = null; } }
      acoes.push({ nome: String(fn.name || ''), input });
    }
    return { ok: true, acoes, texto: String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() };
  }

  // texto: o que o Whisper ouviu. ctx: o estado da sala (limpo aqui). opcoes: { provedor, modelo, url }
  async function entender(texto, ctx, opcoes = {}) {
    texto = String(texto || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, MAX_TEXTO);
    if (!texto) return { ok: false, erro: 'Pedido vazio.' };
    if (ocupado) return { ok: false, erro: 'Ainda estou pensando no pedido anterior.' };
    ocupado = true;
    try {
      const c = Acoes.limparContexto(ctx);
      const r = opcoes.provedor === 'nuvem' ? await nuvem(texto, c, String(opcoes.modelo || ''))
        : opcoes.provedor === 'local' ? await local(texto, c, String(opcoes.modelo || ''), opcoes.url)
        : { ok: false, erro: 'Pedidos livres estão desligados.' };
      if (r.ok) r.acoes = r.acoes.slice(0, 5); // um pedido, no máximo 5 ações
      if (r.texto) r.texto = r.texto.slice(0, 200);
      return r;
    } finally {
      ocupado = false;
    }
  }

  // Testar: um pedido de mentira, com uma pessoa de mentira, tem que virar "assistir"
  async function testar(opcoes) {
    const t0 = Date.now();
    const r = await entender('abre a live do Fulano de Teste', { pessoas: [{ nome: 'Fulano de Teste', transmitindo: true }], canais: ['Voz geral'] }, opcoes);
    if (!r.ok) return r;
    const certo = r.acoes.some((a) => a.nome === 'assistir' && a.input?.pessoa === 'Fulano de Teste');
    return certo ? { ok: true, ms: Date.now() - t0 } : { ok: false, erro: `O modelo respondeu, mas não escolheu a ação certa${r.texto ? ` ("${r.texto.slice(0, 80)}")` : ''}.` };
  }

  return { salvarChave, temChave, apagarChave, nuvemDisponivel, entender, testar };
}

// "Toca Evidências": o primeiro vídeo da busca do YouTube. Sem chave de API: lê a página pública de resultados
// (o JSON que vem nela), então pode parar de funcionar se o YouTube mudar a página; aí o aviso pede o link
const YOUTUBE = 'https://www.youtube.com';
async function buscarYoutube(busca, { base = YOUTUBE } = {}) {
  busca = String(busca || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 100);
  if (!busca) return { ok: false, erro: 'Qual música? Fale o nome junto.' };
  let html;
  try {
    const r = await fetch(`${base}/results?search_query=${encodeURIComponent(busca)}&hl=pt-BR&gl=BR`, {
      headers: { 'accept-language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { ok: false, erro: `O YouTube não respondeu (${r.status}).` };
    html = (await r.text()).slice(0, 4_000_000);
  } catch {
    return { ok: false, erro: 'Sem conexão com o YouTube.' };
  }
  const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,3000}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.){1,300})"/);
  if (!m) return { ok: false, erro: `Não achei "${busca}" no YouTube. Ponha pelo link (a nota musical no painel de voz).` };
  let title = '';
  try { title = JSON.parse(`"${m[2]}"`); } catch {}
  return { ok: true, videoId: m[1], title: title.replace(/[\x00-\x1f]/g, '').trim().slice(0, 100) || busca };
}

module.exports = { criarIa, urlLocal, MODELOS_NUVEM, buscarYoutube };
