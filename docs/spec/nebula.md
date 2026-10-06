# Novo nome: Nebula

Status: Em andamento

## Objetivo
O app passa a se chamar **Nebula**. A logo vira um N feito de constelação, com as mesmas estrelas, cores e
pontilhados da logo de antes; o resto da palavra ("ebula") vem logo depois, em Sora.

## Escopo
- Entra: logo nova (Início, barra de título, ícone da janela, ícone do .exe, tela vazia do tema Estelar), o nome
  em todos os textos que a pessoa vê (título, bandeja, avisos, páginas do celular e do login Google, convites), a
  fonte Sora no app, o nome do .exe e do instalador (`Nebula.exe`, `Nebula Instalador.exe`).
- Fica de fora: o nome do repositório; identificadores que quebrariam quem já usa (abaixo).

## A logo
- **N2, espaçamento "Próximo":** três estrelas de quatro pontas (as da logo de antes) nos cantos do N: lilás embaixo
  à esquerda, coral em cima à esquerda, ciano (a maior) embaixo à direita. Pontilhados levemente arqueados, que
  crescem perto das estrelas e misturam as cores no meio (`logo-c12`, `logo-c13`). A última perna do N sobe em
  pontos que diminuem até sumir. Inclinação pela posição das estrelas (as estrelas ficam retas).
- **Tamanho pequeno** (barra de título, ícone até 48 px): menos pontos e maiores (`logo-dots-p`), senão o N some.
- **Palavra:** "ebula" em Sora (peso 800 no Início, fino nas peças grandes), com a linha de base na altura das
  estrelas de baixo e um respiro do tamanho de um ponto depois da estrela ciano.
- Sempre nas cores da logo (`--logo-1..3`), como antes: os temas que trocam essas cores continuam trocando.
- Desenho gerado por fórmula (estrela de lados curvos `k = .075r`, `m = .367r`; pontos numa curva quadrática) e
  gravado em números fixos em `index.html`, `renderer/icone-app.js` e `styles-estelar.css`.

## O que não muda (de propósito)
| O quê | Por quê |
|---|---|
| Pasta de dados `%APPDATA%\Tela P2P` | Configurações, histórico das mensagens, login Razze e atualizações. O `boot.js` fixa essa pasta antes de tudo, então o `productName` novo não abre o app "zerado" |
| `telap2p://` | Convites já mandados nas conversas continuam abrindo |
| `appId` `com.telap2p.app` e `name` `tela-p2p` | O instalador reconhece a instalação antiga; o pacote de atualização (`app: 'tela-p2p'`) continua valendo |
| `tela-p2p-config` (backup no celular), `tela-p2p-internet` (servidor) | Arquivos e servidores de antes continuam valendo |
| Pasta dos clipes `Vídeos\Tela P2P\Clipes` e a do WireGuard em `Program Files\Tela P2P` | Os clipes antigos continuam na lista; os túneis instalados continuam achando o WireGuard |

## Como chega a quem usa
- Pela atualização (pacote assinado): a logo, os textos, a fonte.
- Só com o .exe ou instalador novo (`boot.js`, `productName`): o nome do arquivo, o ícone do .exe e a pasta do
  programa. Quem fica no .exe antigo vê "Tela P2P" só no nome do arquivo.

## Testes
- `npm test` (textos da bandeja, mensagens), `npx electron tests/e2e/carga.cjs`, e conferir a logo na tela
  (Início, barra de título, ícone da janela) em tamanho grande e pequeno.
- Manual: instalar o .exe novo por cima e conferir que as configurações, o histórico e o login continuam.
