# Passo a passo guiado: entrar e criar sala pela internet

Issue: — · Roadmap: —

## Objetivo
Quem abre o Nebula pela primeira vez não sabe por onde entrar numa sala de um amigo nem como configurar a própria.
Em vez de um tutorial com fotos, o próprio app guia a pessoa: escurece a janela, acende o botão certo e avança quando ela
faz a ação de verdade. Como é o app real, o passo a passo nunca fica desatualizado.

## Escopo
- Entra:
  - um mecanismo de passo a passo (destaque, balão, avançar quando a ação acontece);
  - quatro roteiros:
    - **Entrar com código e senha**;
    - **Criar sala e chamar os amigos** (host);
    - **Entrar pela lista de amigos**;
    - **Entrar por um convite**;
  - um jeito de abrir os roteiros no Início, e a oferta depois da primeira entrada.
- Fica de fora:
  - roteiros de Radmin e Razze (só o modo Internet);
  - transmitir tela, voz e subsalas (podem virar roteiros depois, com o mesmo mecanismo);
  - vídeo ou animação gravada.

## Comportamento esperado

### Onde abre
- **Início:** um link **Como entrar numa sala?** embaixo de Criar sala / Entrar numa sala. Abre um menu pequeno com os
  quatro roteiros, cada um com uma linha do que faz e quanto tempo leva ("Entrar com código e senha · 4 passos").
- **Primeira entrada:** ao terminar (com ou sem conta), um aviso oferece **Ver o passo a passo** ou **Agora não**. Aparece uma
  vez; depois, só pelo link do Início.
- **Configurações › Ajuda** (ou o balão de Feedback e bugs): a mesma lista, para quem quiser rever.

### Como o passo a passo aparece
- A janela escurece, menos o botão ou campo do passo, que fica aceso com um anel verde. Só ele recebe clique; o resto não
  responde, para a pessoa não se perder.
- Um balão ao lado do alvo diz o que é e o que fazer: título, uma ou duas frases, "Passo 2 de 5", **Voltar** e **Sair do
  passo a passo**. O balão muda de lado para não sair da janela.
- O passo avança quando a pessoa faz a ação de verdade: clicar no botão, preencher o campo, abrir o painel. Passos que só
  explicam (o que é a caixinha "Amigos de quem estiver na sala") têm **Entendi**.
- Esc ou **Sair do passo a passo** fecha tudo e deixa o app como está. Nada fica pela metade: um painel aberto pelo roteiro
  continua aberto, como se a pessoa tivesse aberto.
- Se a janela muda de tamanho, ou um painel rola, o destaque acompanha o alvo.
- Se o alvo some (a pessoa entrou numa sala por outro caminho, a conexão caiu), o balão diz o que aconteceu e oferece
  **Recomeçar** ou **Sair**.

### Roteiro 1: Entrar com código e senha (4 passos, sem conta)
1. **Rede:** acende o botão Rede, no topo do Início. Se não estiver em Internet, explica e pede para escolher Internet
   (o roteiro espera a troca). Se já estiver, **Entendi**.
2. **Entrar numa sala:** acende o cartão. Avança quando o painel de entrar abre.
3. **Código e senha:** acende o campo do código, depois o da senha. O balão sugere um exemplo (`ABC234` / `pizza-azul-marte`) com
   **Preencher exemplo**.
4. **Entrar:** acende o botão. No modo de ensaio (quem não tem um código de verdade) o clique não entra: o balão diz "Com um
   código de verdade, aqui você entraria na sala" e termina. Se a pessoa digitou um código e uma senha de verdade, o clique
   entra de fato, e o roteiro termina com o **Entrar na voz** aceso.

### Roteiro 2: Criar sala e chamar os amigos (6 passos, host)
1. **Opções da sala**, no cartão Criar sala. Avança quando a tela Criar sala abre.
2. **Senha:** acende o campo e explica que pela internet ela é obrigatória (mínimo 4). **Entendi**.
3. **As duas caixinhas:** acende cada uma com o que muda. "Mostrar esta sala para meus amigos" põe a sala na lista deles.
   "Amigos de quem estiver na sala" deixa entrar gente que você não conhece.
4. **Criar sala:** cria a sala de verdade no servidor da equipe. O balão avisa antes: "Isso abre uma sala real. Ela fecha
   quando você sair."
5. **Menu da sala:** acende o nome da sala; quando o menu abre, acende o código com **Copiar**, a senha (olho, Copiar, Mudar)
   e a caixinha "Amigos de quem está na sala podem entrar".
6. **Chamar:** com conta e amigos online, abre o envelope › Adicionar amigo › Amigos e acende **Convidar**. Sem conta, explica
   que dá para mandar o código e a senha, e acende o **Convidar** da barrinha da direita (copia o código).
   No fim: **Ficar na sala** ou **Encerrar a sala de teste**.

### Roteiros 3 e 4: pela lista de amigos e por um convite
Dependem de alguém do outro lado. O roteiro usa o que existir de verdade e, se não houver, um **exemplo** marcado:
- **Lista de amigos:**
  - Sem conta, o primeiro passo leva a Perfil › Conta e espera a pessoa entrar ou criar a conta (pode pular: segue em modo
    de exemplo).
  - Sem amigos, acende o envelope › Adicionar amigo e explica o identificador `nome#1234` e o link de convite.
  - Se algum amigo está numa sala, acende o **Entrar** de verdade.
  - Se não, mostra em "Salas dos seus amigos" um cartão **Sala de exemplo**, com a etiqueta "Exemplo do passo a passo". Ele
    usa o mesmo desenho dos cartões de verdade, e clicar nele só avança o roteiro.
- **Convite:** abre uma conversa de exemplo, "Passo a passo do Nebula", com o cartão "Convite para a sala de exemplo".
  Clicar em **Entrar** avança e explica o que aconteceria. Se já existir um convite de verdade nas mensagens, usa ele.
- Os exemplos ficam só na tela, não vão ao servidor, não ficam salvos e somem ao sair do roteiro.

## Restrições
- O roteiro nunca faz por conta própria nada que a pessoa não clicou. A única ação real que ele pede é Criar sala (roteiro
  2) e Entrar com um código de verdade (roteiro 1), e as duas avisam antes.
- O mesmo app, sem modo especial: os alvos são os elementos de sempre (`#homeRede`, `#goJoin`, `#roomAddr`,
  `#joinPassword`, `#joinBtn`, `#goCreate`, `#roomPassword`, `#roomVisible`, `#roomAmigosMembros`, `#createBtn`,
  `#roomMenuBtn`, `#roomAddress`, `#dmBarLabel`, `#dmAddOpen`...). Renomear um deles quebra o roteiro: o teste e2e pega.
- CSP sem estilo inline (posição do destaque por `style.setProperty` em variáveis CSS, como o resto do app), sem animação
  contínua no modo gamer, respeitando "reduzir movimento".
- Acessível: o balão é um `dialog` não modal com `aria-live`; o foco vai para o alvo; Tab circula entre o alvo e os botões
  do balão; leitor de tela lê o passo.
- Funciona nas larguras do app (a janela mínima) e com o painel da sala recolhido.

## Dependências
- `renderer/tour.js` (novo): o mecanismo (`iniciarTour(roteiro)`, destaque, balão, esperar a ação) e os quatro roteiros.
  Precisa da tag `<script>` no `index.html` e de entrar no `PACK_FILES` de `publicar.js`.
- `index.html`: a camada do passo a passo (`#tour`), o link no Início e a lista dos roteiros.
- `renderer/inicio.js` (ligar), `renderer/primeira-entrada.js` (oferta no fim), `renderer/sessoes.js` e `renderer/mensagens.js`
  (aceitar um cartão de exemplo, marcado e local).
- `styles.css`: a camada, o anel e o balão.
- Nada muda no servidor.

## Critérios de aceitação
- [ ] Início › Como entrar numa sala? lista os quatro roteiros; a primeira entrada oferece uma vez.
- [ ] Roteiro 1 completo em modo de ensaio sem entrar em sala; com código real, entra e acende Entrar na voz.
- [ ] Roteiro 2 cria uma sala real, mostra código, senha e a caixinha, e termina com Ficar ou Encerrar.
- [ ] Roteiros 3 e 4 usam amigos, salas e convites de verdade quando existem, e exemplos marcados quando não existem.
- [ ] Esc e Sair fecham em qualquer passo sem deixar a tela travada; o destaque acompanha resize e rolagem.
- [ ] Alvo que some mostra Recomeçar/Sair.
- [ ] Nenhum exemplo chega ao servidor.

## Testes
- Automáticos: `tests/e2e/tour.js` (novo), com o servidor do modo Internet local:
  - roteiro 1 em ensaio e com código real;
  - roteiro 2 até o menu da sala;
  - roteiros 3 e 4 com exemplos;
  - Esc no meio;
  - o alvo some.
- Manuais: janela pequena, painel recolhido, modo gamer, leitor de tela (Narrador) no roteiro 1.

## Andamento
- Fase 1 feita: mecanismo, roteiros 1 e 2 e o link no Início (`renderer/tour.js`, `tests/e2e/tour.js`). No roteiro 2, o passo
  "Chamar" acende o Convidar da barrinha e só cita a aba Amigos (o caminho completo pelo envelope fica para a fase 2).

- Fase 2 feita: roteiros "Entrar pela lista de amigos" e "Entrar por um convite", e o Convidar da aba Amigos no roteiro do
  host. Passos que não se aplicam (já tem conta, já tem amigos, sem convite de verdade) ficam de fora sozinhos. Mudança em
  relação ao plano: sem convite de verdade, o cartão de exemplo aparece no próprio balão, e não numa conversa de exemplo nas
  mensagens (uma conversa de mentira deixaria digitar e mandar mensagem para ninguém).

## Fases
1. Mecanismo + roteiros 1 e 2 + link no Início.
2. Roteiros 3 e 4 com os exemplos.
3. Oferta no fim da primeira entrada e a lista em Configurações.
