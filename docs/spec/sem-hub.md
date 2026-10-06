# Sem o HUB

Status: Feito

## Objetivo
O HUB (a barra fina da esquerda, com as abas Salas, Amigos e Rede) sai. Cada parte vai para onde a pessoa já procura:
a conta para o Perfil, a rede para as Configurações e os amigos para junto das mensagens privadas.

## Escopo
- Entra: Conta Razze no fim do **Perfil**; grupo **Rede** nas **Configurações** (como os PCs se conectam, servidores,
  redes Razze e o Mapa de conexões); aba **Amigos** no painel do envelope, ao lado de **Conversas**; tirar o HUB (HTML,
  CSS dos temas, `--hub-w`, a interface espelhada) e os textos que mandavam para "HUB › Rede".
- Fica de fora: a aba **Salas** do HUB (a sala atual e trocar de sala): as salas abertas continuam no **Início**
  (o botão Início da barrinha volta para lá sem sair da sala). O arquivo `renderer/hub.js` mantém o nome (trocar
  mexeria no `PACK_FILES` do `publicar.js`).

## Comportamento esperado
- **Envelope:** abre o painel com duas abas, **Conversas** e **Amigos**, cada uma com o seu número (não lidas; pedidos
  recebidos). O número do envelope soma os dois. Pedido de amizade que chegou aparece em cima das conversas; clicar
  leva para Amigos › Pedidos. Na aba Amigos, o balão abre a conversa (e fecha o painel). Setas trocam de aba; Esc fecha
  primeiro o menu "⋯", a pergunta de remover ou o formulário de adicionar, depois o painel.
- **Sem conta:** o envelope não aparece. "Ver todos", "Adicionar amigo", o Adicionar do perfil de alguém e o clique
  direito numa pessoa levam ao **Perfil › Conta Razze**, no login.
- **Perfil › Conta Razze:** entrar, criar conta, Google, trocar senha, sair. Sem servidor Razze configurado, um botão
  **Abrir Configurações › Rede**.
- **Configurações › Rede:** o mesmo conteúdo da antiga aba Rede. O mapa só atualiza com o grupo à vista e para ao trocar
  de grupo ou fechar as Configurações. Convite de rede que chega por link abre aqui.

## Dependências
`index.html`, `styles.css` e `styles-*.css`, `renderer/hub.js`, `mensagens.js`, `conectividade.js`, `configuracoes.js`,
`mapa-conexoes.js`, `navegacao.js`, `sessoes.js`, `voz.js`, `chamada.js`, `salas-amigos.js`. Nada muda no protocolo nem no IPC.

## Testes
- Automáticos: `tests/settings-smoke.cjs` (onde mora cada parte, login pelo Perfil, Rede nas Configurações, mapa),
  `tests/e2e/mensagens-barra.js` (abas, pedido em cima das conversas, números, setas), `inicio-ceu.js`, `barra.js`.
- Manuais: com conta de verdade, aceitar um pedido pela aba Amigos e mandar mensagem pelo balão; entrar e sair da conta
  pelo Perfil; conectar uma rede Razze em Configurações › Rede.
