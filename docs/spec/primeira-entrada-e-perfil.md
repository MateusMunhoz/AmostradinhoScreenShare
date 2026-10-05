# Primeira entrada, conta e perfil: plano

*Auditoria do fluxo atual: `docs/auditoria-fluxo.md`. Criado em 05/10/2026 a partir do pedido do Andrick. Nada abaixo foi implementado ainda; a ordem é a sugerida.
O tema Top Gun (fundo e HUD) foi feito antes e não faz parte deste plano.*

## Pontos que precisam de decisão antes de começar

1. **Conta já existe (Razze, e-mail e senha) e já é opcional na prática:** sem conta o app funciona por endereço e senha;
   com conta há amigos, mensagens, salas dos amigos e redes. A premissa "sem conta" do roadmap está desatualizada
   (ver `docs/auditoria-fluxo.md`). Decidir só duas coisas: reescrever a premissa para "conta só para amigos, sem
   telemetria, chat criptografado" e se o servidor da equipe deixa de exigir **aprovação manual** (hoje trava a
   primeira entrada).
2. **Login com Google é possível** no Electron: abrir o navegador do sistema (nunca uma janela embutida; o Google
   bloqueia), fluxo OAuth 2.0 com PKCE e redirecionamento em `127.0.0.1` (porta efêmera). O token do Google fica só na
   RazzeAPI, que devolve ao app uma sessão própria. Precisa de um projeto no Google Cloud (tela de consentimento e
   client ID de aplicativo "Desktop"). É mudança em IPC/`main/razze-*`: apresentar o plano e esperar aprovação.
3. **Atividade no perfil (não é transmissão de tela):** a pessoa escolhe o que aparece. Tudo desligado por padrão;
   interruptor por categoria (Jogo, Música) e quem pode ver (amigos ou ninguém). Só o nome do jogo ou "faixa e artista"
   é lido; nunca janela de documento, navegador ou título de aba.

## Fase 1: auditar o fluxo atual (FEITA em 05/10/2026: `docs/auditoria-fluxo.md`)

- Mapear no código e escrever em `docs/` o grafo de telas: primeira abertura → nome/foto → início → criar/entrar sala →
  sala → sair. Marcar cada ida e volta (ciclos) e cada tela com mais de uma decisão.
- Medir cliques até "estar numa chamada" em 3 caminhos: criar sala, entrar por endereço, "Entrar de novo".
- Comparar com o Discord: convite por link, "entrar na chamada" em um clique, lembrar do último canal.
- Saída: lista curta de cortes e fusões de tela, com o desenho do fluxo novo.

## Fase 2: primeira entrada enxuta (FEITA em 05/10/2026, falta teste manual no Windows e o convite por link)

- Uma tela por vez, no máximo 3: (1) como quer entrar (conta Google / só um nome), (2) nome e foto, (3) como quer
  usar (criar a sua sala ou entrar numa). A escolha **fica fixada** (Configurações permite mudar), sem perguntar de novo.
- "Novidades da versão" e "Sessões abertas" não aparecem na primeira vez; entram depois.
- Início com **uma ação principal** conforme o método escolhido (sala própria: "Abrir minha sala"; amigo: "Entrar com
  o convite"). Reduzir o hub: o que não é da ação principal vai para um menu.
- Entrar na chamada pronta em um clique: lembrar da última sala e do último canal de voz; link/convite colável.
- Critério: do primeiro clique do app novo até estar numa chamada em até 3 telas e 20 s.

## Fase 3: conta (senha FEITA em 05/10/2026: trocar senha e esqueci a senha por código do administrador, sem e-mail; login com Google FEITO em 05/10/2026, falta criar o cliente no Google Cloud e ligar na VPS)

- Cadastro e login: e-mail + senha e Google (conta opcional, ver decisão 1).
- Esqueci a senha: e-mail com link de redefinição de uso único (expira em 30 min); trocar senha logado, pedindo a atual.
  Limitar tentativas (padrão de `sala-protocolo.js` para tudo que chega de fora). Nada de senha em log.
- Vincular/desvincular o Google de uma conta existente.

## Fase 4: perfil

- **Frase na bio (FEITA em 05/10/2026, vista no Início e no cartão da pessoa na sala)** (até 128 caracteres, texto simples, validada e limitada no servidor e no cliente).
- **Foto (FEITA em 05/10/2026, editor de recorte com arrastar e zoom)**: o ajuste atual está ruim. Novo editor: recorte quadrado com arrastar e zoom, prévia redonda, limite de
  tamanho, reduzir e converter no cliente antes de enviar.
- **Fundo do perfil (FEITO em 05/10/2026: arrastar, zoom e Ajustar depois; GIF não corta)**: depois de colocar, dá para **arrastar e reposicionar** (e dar zoom) com prévia do cartão; salvar
  só o enquadramento (posição e escala), a imagem original fica intacta. Se ficar caro, o padrão menos ruim é
  "centralizar e preencher" com um único controle de posição vertical.

## Fase 5: atividade (opcional, desligada por padrão) — FEITA em 05/10/2026 para jogos (lista) e Spotify; falta teste manual no Windows e, se quiser, mais apps de música

- Monitor de atividade no Windows: lista curta de jogos reconhecidos (por nome do executável) e Spotify (música
  atual pela janela do Spotify ou pela API de "tocando agora" se o usuário conectar a conta).
- No perfil e na lista de pessoas: **"Jogando X"** ou **"Ouvindo [banda]"**; ao clicar, abre o cartão com a música
  (faixa e artista). Só aparece para quem o usuário permitir; interruptor por app em Configurações › Privacidade.
- Sem enviar nada além do texto exibido; sem histórico guardado.

## Ordem sugerida

1. Fase 1 (auditoria) e decisão 1 e 3.
2. Fase 2 (primeira entrada) com o método fixado; já entrega valor sem servidor novo.
3. Fase 4 (foto e fundo do perfil e bio): independe de conta.
4. Fase 3 (conta, Google, senha): depende da decisão 1 e da RazzeAPI.
5. Fase 5 (atividade).

## Testes e docs de cada fase

- Teste unitário de validação (bio, redefinição de senha, enquadramento da imagem) em `tests/`.
- `docs/guia.md` com o fluxo novo; `docs/desenvolvimento.md` se mudar arquivo ou arquitetura.
- Teste manual no Windows: primeira abertura limpa (apagar `localStorage`), segunda abertura, sair e voltar.
