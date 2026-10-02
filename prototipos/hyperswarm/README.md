# Protótipo: ponte da sala pela HyperDHT (Hyperswarm)

Item 0 da [ordem do roadmap](../../docs/roadmap.md#ordem-combinada-em-01102026-rumo-ao-b0): tirar cedo o maior risco
do P1 fase 2 (entrar pela internet sem Radmin e sem servidor do projeto). **Fora do pacote do app**: não está em
`PACK_FILES` nem em `build.files`, e tem o próprio `package.json`.

## Como funciona
- **Código de convite**: 16 caracteres (80 bits), sem letras que se confundem ditando (`XXXX-XXXX-XXXX-XXXX`).
- Dos dois lados, `sha256('tela-p2p/convite/v1:' + código)` vira a semente de um par de chaves. O host anuncia a chave
  pública na DHT pública da Holepunch; o convidado procura a mesma chave. Ninguém do projeto roda servidor.
- **Host**: cada conexão que chega pela DHT é ligada ao servidor da sala (`signaling.js`), sem mudar nada nele.
- **Convidado**: abre `127.0.0.1:<porta>`; cada conexão local vira uma conexão nova com o host. O app conectaria em
  `ws://127.0.0.1:<porta>` e não saberia que existe túnel.
- As conexões são criptografadas (Noise) e furam o NAT por UDP; a criptografia da sala (A1) continua valendo por cima.
- Usa `hyperdht` direto (a base do Hyperswarm): uma conexão por chave pública já basta, sem tópicos.

## Arquivos
| Arquivo | O quê |
|---|---|
| `ponte.js` | Código de convite, `abrirHost()` e `entrar()` |
| `teste-local.cjs` | Prova automática no mesmo PC, com a sala de verdade |
| `cli.js` | Teste manual entre dois PCs |

## Resultados (02/10/2026, Windows 11)
| Pergunta | Resultado |
|---|---|
| Carrega no Node? | **Sim** (Node 26) |
| Carrega no Electron do app? | **Sim** (Electron 33.4): `sodium-native` e `udx-native` vêm com binários prontos (N-API), sem compilar |
| A sala de verdade roda pelo túnel? | **Sim**: entra, recebe o `welcome`, o host vê a entrada, o chat vai e volta, duas conexões pelo mesmo convite |
| Tempo até entrar | 1,4–2,4 s (inclui achar o host na DHT) |
| Código errado | Recusado (não acha ninguém) |
| Tamanho no Windows | ~3,5 MB (0,8 MB de JS + 2,7 MB de `.node` win32-x64); a pasta toda tem 32 MB por causa dos binários de outras plataformas |
| **Entre redes diferentes (casa ↔ 4G/CGNAT)** | **Falta testar.** No mesmo PC o túnel passou pelo IP da Radmin; isso não prova o furo de NAT |

## Como chegaria aos amigos (decisão da equipe)
A atualização pela sala só leva os arquivos de `PACK_FILES`; o `node_modules` vai só no `.exe`.
1. **Dependência normal** (`dependencies` + `asarUnpack` dos `.node`): mais simples, mas **todo mundo baixa o `.exe`
   novo uma vez**.
2. **Embutido em `vendor/hyperdht/`** (JS num arquivo só + os dois `.node` do Windows, ~3,5 MB, como já é feito com
   `bin/*.exe` e o RNNoise): chega pela atualização normal. Falta provar que os `.node` carregam a partir dessa pasta
   e com a assinatura do pacote.

Recomendação: **opção 2**, para não depender de todo mundo trocar o `.exe`; validar num próximo passo.

## Teste entre dois PCs (o que falta)
Nos dois PCs: o repositório atualizado, `npm ci` na raiz e `npm ci` em `prototipos/hyperswarm`. **Radmin desligada.**

```sh
# PC 1 (host), por exemplo em casa
node prototipos/hyperswarm/cli.js host
# PC 2 (convidado), por exemplo no 4G do celular (roteado) ou na casa de outra pessoa
node prototipos/hyperswarm/cli.js entrar XXXX-XXXX-XXXX-XXXX
```

Anotar para cada par: entrou (sim/não), tempo até entrar, mediana do chat e o IP que aparece em "túnel aberto até".

| Host | Convidado | Entrou? | Tempo | Chat (mediana) |
|---|---|---|---|---|
| casa (fibra) | casa de outra pessoa | | | |
| casa (fibra) | 4G (CGNAT) | | | |
| 4G | 4G | | | |

Se o 4G ↔ 4G não entrar, é o caso que pede o TURN da VPS como reserva (P1 fase 3).

## Riscos que continuam
- DHT pública de terceiros (Holepunch): se cair ou mudar, o convite para; ter o TURN/VPS como reserva.
- Só a sinalização passa pela ponte. O vídeo e a voz continuam pelo WebRTC, que vai precisar de STUN (fase 1) para
  atravessar a internet sem a Radmin.
