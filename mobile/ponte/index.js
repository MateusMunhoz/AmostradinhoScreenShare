// O window.api do iPhone (no desktop é o preload.js). Carrega antes de renderer/util.js (montar-www.mjs põe o <script>).
// Fase 0: só o que não depende de conta nem de código nativo funciona de verdade (platform, copiar, abrir link, versão,
// ruído); o resto são as respostas "indisponível" de stubs.js. A lista de chaves é conferida contra o preload.js em
// mobile/testes/ponte.test.mjs: função nova no desktop sem par aqui faz o teste falhar.
import { Clipboard } from '@capacitor/clipboard';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { STUBS, criarStub } from './stubs.js';

const api = { platform: 'ios' };
for (const [nome, definicao] of Object.entries(STUBS)) api[nome] = criarStub(nome, definicao);

// Copiar: o plugin nativo e, se ele falhar, o do navegador (como o desktop faz com o clipboard da página)
api.copyText = async (text) => {
  const t = String(text || '').slice(0, 4096);
  try { await Clipboard.write({ string: t }); } catch { await navigator.clipboard.writeText(t); }
  return true;
};

// Só endereços http(s), como o main.js (open-link)
api.openLink = async (url) => {
  if (typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url)) await Browser.open({ url });
};

api.getVersion = async () => __VERSAO__; // vem do package.json do desktop, por montar-www.mjs

// O .wasm da supressão de ruído (o desktop lê do disco; aqui ele vem do pacote do app)
api.noiseWasm = async (simd) => {
  try {
    const r = await fetch(simd ? 'vendor/noise/rnnoise_simd.wasm' : 'vendor/noise/rnnoise.wasm');
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch { return null; }
};

window.api = api;

// Link de convite (telap2p://sala?d=...): abre o app (ou o traz para a frente) e entra na sala pelo mesmo caminho do desktop.
// Espera o renderer carregar (lerConvite e aceitarConvite são globais de renderer/salas-amigos.js).
function abrirConvite(url) {
  const tentar = (n) => {
    if (typeof window.lerConvite !== 'function') return n < 50 ? setTimeout(() => tentar(n + 1), 200) : undefined;
    const cv = window.lerConvite(url);
    if (cv) window.aceitarConvite(cv, 'quem te convidou');
  };
  tentar(0);
}
try {
  App.addListener('appUrlOpen', (e) => abrirConvite(e && e.url));
  App.getLaunchUrl().then((r) => { if (r && r.url) abrirConvite(r.url); }).catch(() => {});
} catch { /* sem o plugin (testes no navegador) */ }
