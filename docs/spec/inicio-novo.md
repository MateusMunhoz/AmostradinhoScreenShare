# Início novo: criar, entrar e a rede à vista

Status: Implementada em 09/10/2026 (branch `inicio-novo`), com as sugestões das quatro decisões; falta o teste manual com
pessoas que nunca usaram o app. Só interface: não mexe em servidor, IPC, protocolo da sala nem `boot.js`.
Desenho: canvas "Nebula · Início novo" (claude.ai, privado do Cristian; quatro telas: dentro de uma sala, trocar de rede,
fora de sala, atualização disponível).

## Objetivo
Quem abre o app não acha onde **criar** e **entrar** numa sala, nem **em que rede está** e **como trocar**. O Início
hoje mostra a mesma sala até quatro vezes (faixa do topo, resumo, lista e "Última sala"), deixa Criar e Entrar cinza
quando há sala na lista, chama a mesma coisa de "Sala" e "Sessão" e esconde a rede em Configurações › Rede. A versão,
o aviso de atualização e as novidades ficam em três lugares diferentes.

## Escopo
- Entra: o layout do Início (as quatro telas do desenho), o botão da rede no topo com o menu de troca, a sala atual
  uma vez só, Criar e Entrar fixos, "Sala" em todo lugar, a coluna de amigos, o rodapé da versão, o botão "Nova
  versão" com o painel de atualização, o cartão "Novo na versão" no lugar do cartão de novidades, e os temas.
- Fica de fora: "Trocar e entrar" num amigo que está numa sala de outra rede (precisa trocar de modo sozinho: fase 2 de
  [entrar-pelos-amigos.md](entrar-pelos-amigos.md)); nome embaixo dos ícones da barra da direita (decisão 4); a tela da
  sala; a primeira entrada; Configurações › Rede (continua, como "Avançado").

## Comportamento esperado

### Topo
1. **Botão da rede**, sempre à vista no topo do Início: bolinha de estado + "Rede" + nome + detalhe curto.
   - Radmin: "Radmin · 26.12.34.56"; sem IP 26.x: bolinha vermelha e "Radmin · sem IP 26.x".
   - Internet: "Internet · [servidor da equipe | endereço do servidor]".
   - Razze: "Razze · [nome da rede]"; desconectada: bolinha âmbar e "desconectada".
   - Cores: verde = pronta, âmbar = conectando ou desligada, vermelha = não dá para usar. A cor nunca é o único sinal:
     o texto diz o estado.
2. **Menu da rede** (clicar no botão): as três redes, cada uma com o nome, o estado à direita e uma frase do que muda
   ("Os amigos entram pelo seu endereço", "Sem VPN, pelo servidor da equipe", "Escolher liga a VPN dessa rede"). A
   em uso fica marcada. Embaixo: "Trocar de rede tira você da sala atual." e o link **Avançado** (Configurações › Rede).
   - Escolher outra: usa `usarModoRede(modo)`. Se não dá (`motivoModoIndisponivel`), mostra o motivo na própria linha,
     sem trocar. Numa sala: pergunta antes (decisão 3).
   - Fecha com Esc, clique fora ou escolha; abre e navega pelo teclado (setas, Enter).
3. **Botão "Nova versão"** (âmbar), ao lado da rede, só quando há versão nova (`updateMode()` não nulo). Abre o painel
   da atualização (abaixo). "Depois" esconde o botão até a próxima versão (`update.dismissed`, como hoje).

### Sala em andamento
4. Numa sala: a faixa "Você está na sala" (a `homeCall` de hoje: microfone, som, sair, **Voltar para a sala**) é o
   **único** lugar onde essa sala aparece. Ela sai:
   - da lista de salas abertas (pelo endereço ou, no modo Internet, servidor + código);
   - do resumo embaixo da saudação;
   - do "Última sala" (que só aparece fora de sala, e não repete uma sala que já está na lista).

### Saudação
5. A foto do perfil (`homeAvatar`) ao lado de "Boa noite, Naitsi", como hoje. A linha de baixo:
   - numa sala: "O que você quer fazer agora?";
   - fora: o resumo de hoje ("Ear Dog e Tulera estão com sala aberta agora", "2 amigos online").

### Criar e entrar
6. Dois cartões grandes, lado a lado, **sempre visíveis e nunca cinza**, no mesmo lugar com ou sem sala na lista:
   - **Criar sala** (`goQuick`): "Abre na hora, com senha gerada…" e, dentro dele, o link **Opções da sala** (`goCreate`:
     porta, senha própria, quem vê). Fora de sala é o cartão de destaque (ícone preenchido, borda azul). Numa sala,
     pergunta antes de sair dela.
   - **Entrar numa sala** (`goJoin`): o texto muda com a rede: "Cole o endereço…, tipo 26.12.34.56:8765" (Radmin e
     Razze) ou "Digite o código e a senha da sala" (Internet).
   - Some: o `goQuickSub` ("Fulano vê a sua sala") vira a frase do cartão Criar quando houver amigos; o ícone solto
     `goCreate` com casinha e engrenagem.

### Salas abertas
7. Título com a rede: "Salas abertas na Radmin · 2", "Salas dos seus amigos" (Internet), "Salas abertas na rede
   [nome]" (Razze). Cada sala: rosto, "Sala de X", selo AO VIVO, pessoas, voz, jogo, "com Fulano", e **Entrar**
   (contornado: o azul cheio é só de Criar e de Voltar para a sala).
8. "Sessão" sai de todos os textos do Início ("Sessão de X", "Sessões abertas na sua rede", "Procurando sessões…").
9. Vazia: "Nenhuma sala aberta na Radmin agora. Crie uma e chame os amigos." (e os textos de hoje para Internet sem
   conta e Razze sem rede).
10. **Última sala**: uma linha só de informação ("Última sala: Sala de Ear Dog, hoje às 18h17") com **Entrar de novo**
    quando ela não está na lista; "já está na lista acima" quando está.

### Amigos
11. Coluna à direita (320 px): "Amigos online · N", **Convidar**, e cada amigo com foto, nome, onde está ("Na sua sala ·
    na voz", "Na sala de Tulera · Radmin") e **Entrar** quando dá (o `salaDoAmigo` de hoje). Mensagem e Ligar continuam
    nos ícones de cada linha. Sem conta: o cartão "Entre na sua conta para ver seus amigos" (`homeSignin`) nesse lugar.
12. **Novidades depois de atualizar:** o cartão "Novo na 1.18.10" fica no pé da coluna de amigos, com o primeiro item
    da versão, **Ver todas as novidades** (abre a lista completa de hoje, `homeNews`) e o X. Fechado, não volta até a
    próxima versão. Substitui o cartão de novidades que hoje aparece no meio do Início.
13. A constelação (`homeCeu`): decisão 2.

### Rodapé da versão
14. Uma linha fina no pé do Início: "Nebula 1.18.10 · atualizado" (ou "· 1.18.11 disponível", em âmbar) à esquerda;
    **Procurar atualização** e **Novidades** à direita. O estado da Radmin que hoje divide essa linha (`radminTitle`)
    sai: ele vive no botão da rede.

### Painel da atualização
15. Abre pelo "Nova versão" ou por "1.18.11 disponível" no rodapé:
    - "Nova versão pronta" (já baixada) ou "Nova versão disponível"; "Nebula 1.18.11"; "Você está na 1.18.10 · saiu em
      [data]";
    - **Ver o que mudou no GitHub** (a página da versão). Mudou do plano: as novidades da versão nova só chegam dentro do
      pacote dela (`renderer/novidades.js`), então o app antigo não tem como mostrá-las antes de atualizar;
    - o que vai acontecer, com os textos de hoje (`renderUpdateBanner`): "O app fecha e abre de novo sozinho" ou "Você sai
      da sala e o app abre de novo sozinho"; versão que pede `.exe` novo: "Baixe na página do GitHub…";
    - **Depois** e **Atualizar e reiniciar** (ou **Abrir no GitHub**). Baixando: o botão mostra "Baixando…" e o painel
      não fecha sozinho.
16. O `updateBanner` flutuante: decisão 1.

### Tamanhos
17. Janela larga (≥ 1100 px de área útil): duas colunas, como no desenho. Mais estreita: a coluna de amigos desce para
    baixo das salas, e os cartões Criar e Entrar ficam um embaixo do outro abaixo de 640 px. O botão da rede encolhe
    para bolinha + nome.

## Decisões (aprovadas: as sugestões)
1. **O aviso flutuante de atualização** (aparece em qualquer tela, por cima de tudo).
   - Sugestão: sai. Fica o botão "Nova versão" no topo do Início e um botão igual na barra de cima da sala, os dois
     abrindo o mesmo painel. Motivo: não cobre o jogo nem a transmissão, e fica sempre no mesmo lugar.
   - Alternativa: o aviso continua só fora do Início (na sala), e no Início vira o botão.
2. **A constelação** (você e os amigos online ligados por pontilhados), que não está no desenho.
   - Sugestão: continua, pequena, à direita da saudação (o espaço existe na coluna da esquerda). É a marca do tema e
     do roadmap ("Constelação = amigos online").
   - Alternativa: só no tema Estelar.
3. **Trocar de rede numa sala.** Sugestão: pergunta "Trocar para a Internet? Você sai da sala de Ear Dog." e, com sim,
   sai e troca. Alternativa: deixa trocar sem sair (a sala continua na rede antiga até você sair), como Configurações
   › Rede faz hoje.
4. **Nome embaixo dos ícones da barra da direita** (Amigos, Mensagens, Voz, Telas, Ajustes). Sugestão: outro PR, logo
   depois deste (mexe na barra de todas as telas e nos sete temas). Alternativa: junto.

## Mudanças
- `index.html`: o `home-top` ganha o botão da rede (`homeRede`), o menu (`homeRedeMenu`) e o "Nova versão"
  (`homeVersaoNova`); `home-main` vira duas colunas (`home-col` e `home-amigos`); os cartões Criar e Entrar mantêm os ids
  `goQuick`, `goCreate` e `goJoin` (os testes usam); o `home-status` vira o rodapé (`homeRodape`); o painel da
  atualização (`homeVersaoPainel`). `homeNews` continua para a lista completa. Sem script novo: nada muda em
  `PACK_FILES` nem em `build.files`.
- `renderer/conectividade.js`: `renderRedeTopo()` (nome, detalhe e estado da rede, com o que `renderRadmin` e a aba Rede
  já calculam), chamado onde a rede muda. O menu chama `usarModoRede` e `motivoModoIndisponivel` (`chamada.js`).
- `renderer/sessoes.js`: `listaSessoes()` tira a sala em que você está; textos sem "Sessão"; título com a rede.
- `renderer/inicio.js` (`renderLastRoom`) e `renderer/primeira-entrada.js` (`renderHomeTopo`, `renderHomeAmigos`): sem a
  sala atual, saudação de dentro da sala, amigos na coluna, o cartão "Novo na versão".
- `renderer/navegacao.js` (`renderHomeCall`): sem mudança de comportamento; só o lugar.
- `renderer/atualizacao.js`: o painel e o botão "Nova versão" com `updateMode()`, `runUpdate()` e `renderNews()` de hoje;
  o `updateBanner` conforme a decisão 1.
- `styles.css` e os temas (`styles-arasaka.css`, `-diluna`, `-dusol`, `-estelar`, `-eva`, `-renascenca`, `-topgun`):
  revisar os seletores `home-*`, `#home` e `session*` de cada tema (skill `revisar-ui`).
- Docs: `docs/guia.md` (Início, Rede, Atualizar) e o README ("Começar", passos 2 e 3).

## O que mudou do plano na implementação
- Painel da atualização: link para a página da versão no GitHub no lugar da lista de novidades (item 15).
- Fora do Início, o botão de versão nova fica na barra da direita (`navUpdate`) e leva ao painel no Início.
- O `goJoin` virou cartão: o texto que muda com a rede está em `goJoinSub`; o `createBlockHint` saiu.
- Temas com desenho à esquerda (Arasaka, Di'Luna, Du'Sol): em janela larga, o conteúdo começa depois do desenho.
- "Última sala" reconhece a sala na lista também pelo host e pela porta (a lista mostra o IP da rede; o endereço
  guardado pode ser 127.0.0.1).

## Restrições
- Funciona igual nos três modos e sem conta.
- Sem animação contínua (regra do renderer): o menu e o painel abrem sem transição longa.
- Contraste 4.5:1 nos textos (o cinza das legendas do desenho foi escolhido para isso), alvos de 44 px nos botões
  principais, tudo pelo teclado com foco visível.
- Os ids que os testes usam continuam (`goQuick`, `goCreate`, `goJoin`, `sessionList`, `updateBanner`/`ubGo` até a
  decisão 1, `appVersion`).

## Critérios de aceitação
- [ ] Numa sala, ela aparece só na faixa do topo; nenhum "Entrar" leva à sala em que você já está.
- [ ] Criar sala e Entrar numa sala ficam no mesmo lugar, com o mesmo peso e habilitados, com ou sem salas na lista.
- [ ] A rede em uso e o estado dela estão no topo do Início em qualquer tema; trocar leva dois cliques.
- [ ] "Sessão" não aparece em nenhum texto do Início.
- [ ] Versão, atualização e novidades: rodapé, botão "Nova versão" com painel e cartão "Novo na versão" depois de
      atualizar; nada disso cobre a tela da sala.
- [ ] Janela estreita: nada some nem corta; a coluna de amigos desce.

## Testes
- Automáticos:
  - `npm test` e `npx electron tests/e2e/carga.cjs` (o Início abre sem erro e com os botões ligados);
  - `npm run test:settings` (temas e aparência);
  - e2e afetados: `sessoes`, `sala-host-sozinho`, `internet`, `entrar-pelos-amigos`, `atualizacao`, `razze`;
  - e2e novo `inicio.js`: rede no topo (troca e motivo quando não dá), sala atual fora da lista, Criar e Entrar sempre
    habilitados, painel da atualização com versão falsa, cartão "Novo na versão" fecha e não volta.
- Manuais: os sete temas em janela larga e estreita (skill `revisar-ui`), e duas pessoas que nunca usaram o app
  tentando criar, entrar e trocar de rede sem ajuda.
