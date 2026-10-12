# Proteções por padrão (ECA Digital)

Issue: — · Roadmap: —

## Objetivo
O ECA Digital (Lei 15.211/2025, em vigor desde 17/03/2026; fiscalização da ANPD focada em idade a partir de janeiro de 2027)
pede que serviços de provável acesso por crianças e adolescentes protejam por padrão e verifiquem a idade de forma proporcional
ao risco. Em vez de verificar a idade de todo mundo (caro e invasivo), o Nebula trata **toda conta como se pudesse ser de um
menor**: nada no app expõe a pessoa a desconhecidos sem ela escolher, e existem bloquear, denunciar e excluir a conta. Assim o
risco fica baixo para qualquer idade e não sobra recurso que precise de verificação de verdade.

Isto é o plano técnico. O enquadramento (se o Nebula conta como "rede social", idade mínima nos termos, comunicação às
autoridades) precisa ser confirmado com um advogado antes de publicar os termos.

## Escopo
- Entra:
  1. Fechar o que hoje abre contato com desconhecidos (redes públicas, "amigos dos amigos" na sala, pedidos sem limite).
  2. Padrões mais fechados para quem instala agora (atividade no perfil).
  3. **Bloquear** e **Denunciar** pessoas, com a fila de denúncias no painel de administração.
  4. **Excluir a minha conta** dentro do app.
  5. Termos de uso e política de privacidade em linguagem simples, com idade mínima, e um canal para responsáveis.
- Fica de fora:
  - Verificação de idade (selfie, documento, sinal da loja). Pode vir depois, só se surgir recurso para adultos.
  - Data de nascimento no cadastro (fica como opção futura; ver "Perguntas em aberto").
  - Moderação automática de conteúdo da transmissão ou do chat da sala (passa de PC para PC, o servidor não vê).
  - Vínculo de conta com responsável (só se o advogado disser que o Nebula é rede social para menores de 16).

## Comportamento esperado

### 1. Contato com desconhecidos
| Hoje | Passa a ser |
|---|---|
| Rede Razze pode ser **pública** (qualquer conta vê e entra). | A opção **Pública** some ao criar e editar. Redes públicas que já existem viram **Amigos** na migração, e o dono recebe um aviso uma vez. O servidor recusa `visibility: 'public'` com 400. |
| **Amigos de quem estiver na sala também podem entrar** vem marcado em Criar sala. | Vem **desmarcado**. Quem marca vê a frase: "Pessoas que você não conhece vão poder entrar sem senha." A escolha não fica salva para a próxima sala. |
| Pedido de amizade sem limite. | No máximo 20 pedidos enviados por dia e 50 pendentes por conta. Passou, o servidor responde 429 com "Muitos pedidos hoje. Tente amanhã." |
| Quem tem o identificador sempre pode mandar pedido. | Nova opção em **Conta e segurança**, **Quem pode me mandar pedido de amizade**: **Quem tiver meu identificador** (padrão) ou **Só por link de convite**. Com a segunda, o servidor responde ao remetente o mesmo "Pedido enviado." de sempre, sem criar o pedido, para não confirmar que a conta existe. |

Mensagens diretas, ligações, convites para a sala e "em que sala estou" continuam **só entre amigos aceitos**, como hoje.

### 2. Padrões para quem instala agora
- **Mostrar o jogo que estou jogando** e **Mostrar a música que estou ouvindo** passam a vir **desligados** numa instalação nova.
  O passo **Quem é você?** da primeira entrada continua oferecendo ligar, com uma frase do que os outros veem.
- Quem já usa o app **não muda**: o que estava ligado continua ligado.
- **Mostrar esta sala para quem está na rede** (salas abertas na Radmin/LAN) continua como está. Ver "Perguntas em aberto".

### 3. Bloquear
- Onde: no **⋯** da linha do amigo, no topo da conversa, no perfil de alguém na sala e num pedido recebido (**Recusar e bloquear**).
- O que faz, nos dois sentidos e sem avisar a pessoa bloqueada:
  - desfaz a amizade e apaga pedidos pendentes entre os dois;
  - novos pedidos, mensagens, ligações e convites não chegam (o remetente vê a resposta genérica de sempre);
  - a sala de um não aparece para o outro e o passe de amigo não abre;
  - na sala (que é de PC para PC), quem bloqueou deixa de ouvir a voz e de ver o chat da pessoa bloqueada, só no próprio PC.
- **Conta e segurança › Bloqueados** lista quem está bloqueado, com **Desbloquear** (não refaz a amizade).
- Sem conta Razze, só a parte da sala funciona (por nome e chave do PC, até fechar a sala).

### 4. Denunciar
- Onde: nos mesmos lugares de Bloquear e numa mensagem da conversa (**Denunciar mensagem**).
- A janela pede o motivo: **Assédio ou ameaça**, **Conteúdo sexual**, **Envolve criança ou adolescente**, **Golpe ou spam**,
  **Conta falsa**, **Outro**. Tem um campo de texto opcional e um **Anexar print** (o mesmo do Feedback).
- **Mensagens:** as mensagens diretas são cifradas de ponta a ponta. Ao denunciar, o app mostra as últimas 20 mensagens da
  conversa, decifradas no seu PC, e você marca quais vão junto. Só as marcadas vão ao servidor, e a janela diz isso com clareza.
- Ao mandar, a janela oferece **Bloquear também** (marcado).
- No servidor, a denúncia guarda quem denunciou, quem foi denunciado (id e identificador), o motivo, o texto, o print e as
  mensagens escolhidas. Ela é apagada 180 dias depois de resolvida, exceto as do motivo **Envolve criança ou adolescente**, que
  ficam guardadas enquanto houver procedimento com as autoridades.
- **Painel de administração:** uma aba **Denúncias** nova, com os motivos graves no topo. As ações são **Arquivar**,
  **Avisar a pessoa** (chega como notificação no app), **Suspender a conta** (o `status = 'disabled'` que já existe) e
  **Excluir a conta**. Cada ação fica no histórico com quem a tomou.
- Motivo **Envolve criança ou adolescente**: o painel mostra o passo a passo de preservar o material e comunicar às autoridades
  (o procedimento exato vem do advogado). Quem denunciou recebe um link para a SaferNet.

### 5. Excluir a minha conta
- **Conta e segurança › Excluir a conta**: pede a senha e, com dois fatores, o código. Conta só do Google confirma pelo Google.
- A conta fica suspensa por 7 dias. Entrar nesse prazo pergunta se a pessoa quer cancelar a exclusão. Depois dos 7 dias, a conta
  é apagada, com amizades, mensagens no servidor, redes de que ela é dona e login do Google. O identificador fica livre só
  30 dias depois. Denúncias contra ela continuam guardadas pelo prazo do item 4.
- Um responsável que não tem acesso à conta pede a exclusão pelo e-mail de contato dos termos; o administrador faz pelo painel.

### 6. Termos e privacidade
- Duas páginas no site do link de convite (`/termos` e `/privacidade`), em linguagem simples, e um link para elas na tela de
  criar conta ("Ao criar a conta você aceita os **Termos** e a **Política de privacidade**").
- Elas explicam:
  - a idade mínima: 13 anos, a confirmar com o advogado;
  - quais dados o servidor guarda e por quanto tempo;
  - que mensagens diretas são cifradas e que a sala passa de PC para PC;
  - como bloquear, denunciar e excluir a conta;
  - o e-mail para responsáveis e para pedidos da LGPD.
- O guia ganha uma seção **Segurança** com o mesmo resumo.

## Restrições
- O servidor nunca recebe conteúdo da sala, nem mensagem que a pessoa não escolheu mandar na denúncia.
- Respostas para quem foi bloqueado ou tem pedidos fechados são iguais às normais (não revelar bloqueio nem existência de conta).
- Compatível com versão antiga: o servidor aplica bloqueio e limites sozinho. App antigo numa sala não sabe do bloqueio local,
  o que não abre nada novo, porque o bloqueio na sala é só no PC de quem bloqueou.
- CSP sem estilo inline, janelas pelo `perguntar()` de `renderer/conta-seguranca.js`, textos em português simples.

## Dependências
- `razze-api/server.js`:
  - tabelas novas `blocks(user_id, blocked_id, created_at)`, `reports(...)` e `account_deletions(user_id, apagar_em)`;
  - coluna `pedidos_de` em `users` (`'identificador' | 'link'`);
  - checar bloqueio em pedidos, links de amigo, mensagens, sinais (ligação), presença e passe da sala;
  - limites de pedidos e migração das redes públicas;
  - rotas `/v1/blocks`, `/v1/reports` e `DELETE /v1/me`.
- `razze-api/control.js` e `razze-api/admin/`: a aba Denúncias, as ações e o histórico.
- O app:
  - `main/razze-api-client.js`, `main/razze-service.js` e `preload.js`: as funções novas;
  - `renderer/conta-seguranca.js`: Bloqueados, Quem pode me mandar pedido e Excluir a conta;
  - renderer de amigos, conversas e perfil da sala: Bloquear e Denunciar;
  - `renderer/conectividade.js`: tirar **Pública**;
  - Criar sala: o padrão de "amigos dos amigos";
  - Atividade e primeira entrada: os padrões novos.
- O protocolo da sala não muda: o bloqueio na sala é só filtro local.
- Site do link de convite: `/termos` e `/privacidade`.

## Perguntas em aberto (para o advogado e para o time)
1. O Nebula é "rede social" pela lei? Se for, menores de 16 precisam de conta vinculada ao responsável e esta spec não basta.
2. Idade mínima nos termos: 13 ou 16?
3. Procedimento e prazo para comunicar às autoridades no motivo **Envolve criança ou adolescente**.
4. Salas abertas na Radmin/LAN: mostrar para a rede inteira deveria vir desligado? Redes Radmin podem ter desconhecidos, mas é o
   uso principal do app hoje.
5. Vale pedir a data de nascimento (só a faixa) no cadastro como reforço? Sozinha não é verificação, mas ajuda a mostrar boa-fé.

## Critérios de aceitação
- [ ] Não dá para criar nem editar rede Razze **Pública**. As que existiam viraram **Amigos**, e o dono foi avisado.
- [ ] **Amigos de quem estiver na sala** vem desmarcado e avisa ao marcar.
- [ ] O 21º pedido do dia recebe 429. Com **Só por link de convite**, o pedido pelo identificador não chega, e o remetente vê a resposta normal.
- [ ] Numa instalação nova, a atividade de jogo e música vem desligada. Quem já usava não mudou.
- [ ] Bloquear desfaz a amizade e impede pedido, mensagem, ligação, convite, presença e o passe da sala, nos dois sentidos, sem avisar.
- [ ] Na sala, quem bloqueou não ouve nem vê o chat da pessoa bloqueada.
- [ ] Desbloquear funciona pela lista e não refaz a amizade.
- [ ] A denúncia chega ao painel com motivo, texto, print e só as mensagens marcadas. As ações de suspender, avisar, excluir e arquivar funcionam e ficam no histórico.
- [ ] Excluir a conta suspende na hora, permite cancelar em até 7 dias e depois apaga tudo da lista.
- [ ] Os termos e a privacidade estão no ar e linkados na tela de criar conta.

## Testes
- Automáticos:
  - Servidor: bloqueio em cada rota (pedido, link, mensagem, sinal, presença, passe), limites de pedido, a preferência
    `pedidos_de`, a migração das redes públicas, as denúncias (criar, listar no admin, ações) e a exclusão (prazo, cancelar, apagar).
  - App: o `razze-service` com as funções novas, e o filtro local da sala.
- Manuais:
  - Dois PCs: bloquear no meio de uma conversa e de uma sala, denunciar com print e mensagens, conferir no painel.
  - Excluir uma conta de teste, cancelar a exclusão, e depois deixar passar os 7 dias com o relógio do servidor adiantado.
