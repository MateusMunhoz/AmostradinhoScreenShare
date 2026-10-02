// Ponte da sala pela DHT pública da Holepunch (HyperDHT, a base do Hyperswarm), sem servidor do projeto.
// - Host: anuncia na DHT uma chave derivada do código de convite e liga cada conexão que chega ao servidor da sala.
// - Convidado: abre uma porta em 127.0.0.1 e liga cada conexão local a uma conexão nova com o host. O app conecta em
//   ws://127.0.0.1:<porta> e não sabe que existe túnel.
// Cada conexão é criptografada (Noise) e fura o NAT por UDP quando dá; quando não dá, a DHT tenta retransmitir.
// Protótipo: fora do pacote do app (não está em PACK_FILES nem em build.files).
const crypto = require('node:crypto');
const net = require('node:net');
const DHT = require('hyperdht');

// 16 caracteres de um alfabeto sem letras que se confundem ditando (sem I, L, O, U): 16 × 5 bits = 80 bits
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function novoCodigo() {
  const bytes = crypto.randomBytes(16);
  return [...bytes].map((b) => ALFABETO[b % 32]).join('');
}
// Aceita minúsculas, espaços e traços; troca as letras parecidas pelas do alfabeto
function normalizar(codigo) {
  return String(codigo || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
function formatar(codigo) {
  return normalizar(codigo).match(/.{1,4}/g)?.join('-') || '';
}
function valido(codigo) {
  const c = normalizar(codigo);
  return c.length === 16 && [...c].every((ch) => ALFABETO.includes(ch));
}
// Par de chaves que os dois lados conseguem calcular só com o código
function chaves(codigo) {
  const seed = crypto.createHash('sha256').update('tela-p2p/convite/v1:' + normalizar(codigo)).digest();
  return DHT.keyPair(seed);
}

// Liga dois fluxos nos dois sentidos; se um cai, derruba o outro
function ligar(a, b) {
  const fim = () => { a.destroy(); b.destroy(); };
  a.on('error', fim); b.on('error', fim);
  a.on('close', fim); b.on('close', fim);
  a.pipe(b).pipe(a);
}

async function abrirHost({ codigo, porta, endereco = '127.0.0.1', aoConectar = () => {} }) {
  const dht = new DHT();
  const server = dht.createServer((conn) => {
    aoConectar(conn.remotePublicKey?.toString('hex').slice(0, 8), conn.rawStream?.remoteHost);
    ligar(conn, net.connect(porta, endereco));
  });
  await server.listen(chaves(codigo));
  return {
    fechar: async () => { await server.close(); await dht.destroy(); },
  };
}

async function entrar({ codigo, portaLocal = 0, aoConectar = () => {} }) {
  const dht = new DHT();
  const { publicKey } = chaves(codigo);
  const local = net.createServer((sock) => {
    const conn = dht.connect(publicKey);
    conn.on('open', () => aoConectar(conn.rawStream?.remoteHost, conn.rawStream?.remotePort));
    ligar(sock, conn);
  });
  await new Promise((resolve, reject) => { local.once('error', reject); local.listen(portaLocal, '127.0.0.1', resolve); });
  return {
    porta: local.address().port,
    fechar: async () => { local.close(); await dht.destroy(); },
  };
}

module.exports = { novoCodigo, normalizar, formatar, valido, chaves, abrirHost, entrar };
