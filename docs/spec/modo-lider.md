# Modo Líder (subsala que fala para a sala toda)

Status: implementada (fases 1, 2 e 3). Falta o deploy do servidor da VPS para o modo Internet.

Decisões: quem aceita os pedidos é quem está transmitindo na Líder; o grupo e a Líder tocam juntos, com o volume da
Líder à parte; sem limite de pessoas com a palavra, com o líder no controle; quem está fora da voz pode ouvir sem
microfone.

## Objetivo
Dar um "aulão" dentro da sala: uma subsala em **Modo Líder** transmite a tela e a voz para todas as outras subsalas e
para a Voz geral. Quem está fora dela continua conversando com o próprio grupo e pode **pedir para falar**. Quem
está transmitindo na subsala Líder aceita ou recusa os pedidos.

## Escopo
- Entra:
  - escolher o modo ao criar a subsala: **Padrão** (como hoje) ou **Líder**;
  - a voz de quem está na subsala Líder chega à sala toda, e a tela transmitida lá fica aberta para todos;
  - os pedidos para falar, com a fila e as ações Aceitar, Recusar e Tirar a palavra, nas mãos de quem transmite;
  - **Ouvir a Líder** sem entrar na voz, sem microfone;
  - o volume da Líder separado do volume do grupo.
- Fica de fora:
  - trocar o modo de uma subsala que já existe (para isso, apaga e cria outra);
  - relay de áudio na VPS para salas muito grandes (fase futura, se for preciso);
  - mudanças no **mapa estelar**: a subsala Líder aparece como um sol comum;
  - comando de voz ("pedir para falar"), numa fase depois.

## Papéis
| Quem | O que faz |
|---|---|
| **Quem transmite na subsala Líder** (o líder) | Transmite para a sala toda, fala livre, recebe os pedidos e decide |
| **Quem está na subsala Líder** | Fala livre, sem pedir, e a sala toda ouve |
| **Quem está nas outras subsalas e na Voz geral** | Conversa com o próprio grupo e ouve a Líder junto, com o volume dela à parte. Pode pedir para falar |
| **Quem recebeu a palavra** | Continua no próprio canal; a voz vai também para a sala toda, até devolver ou o líder tirar |
| **Quem está na sala fora da voz** | Pode clicar em **Ouvir a Líder** e escutar sem microfone. Para pedir a palavra, entra na voz |

Mais de uma pessoa transmitindo na subsala Líder: qualquer uma delas pode aceitar, recusar e tirar a palavra.

## Comportamento esperado

### Criar
1. **+ Subsala** (e **Nova subsala** fora da voz) abre uma escolha de modo:
   - **Padrão:** "Só quem está nela se ouve" (como hoje);
   - **Líder:** "Quem está nela fala para a sala toda. Os outros pedem para falar".
2. A subsala é criada com o nome de sempre (`Subsala_N`) e você entra nela.
3. No máximo **uma subsala Líder por sala**. Com uma já existindo, a opção Líder fica desativada e explica:
   "Já existe uma subsala Líder (Subsala_2)".
4. Servidor antigo (sem a feature `lider`): a escolha não aparece e o botão cria uma subsala Padrão, como hoje.

### No painel de voz
- O canal Líder tem um ícone próprio e o selo **LÍDER**; com transmissão, **AO VIVO**.
- Embaixo dele, quem está dentro e, numa seção **Com a palavra**, quem recebeu a palavra (em qualquer canal).
- Para o líder, mais uma seção, **Pedidos (N)**, com **Aceitar** e **Recusar** em cada pessoa, na ordem em que
  pediram. Em quem tem a palavra, **Tirar a palavra**.
- Pedido novo: o líder ouve um som curto e a aba **Voz** ganha um número.

### Para quem está fora da subsala Líder
- O cartão **Seu sinal** ganha uma linha: "Líder ao vivo", o **volume da Líder** e **✋ Pedir para falar**.
  - Pedido feito: "Pedido enviado · Cancelar".
  - Com a palavra: "Você está falando para a sala toda · Devolver a palavra". O microfone desligado mostra
    "Ligue o microfone para falar".
  - Recusado: um aviso "Ana recusou o pedido para falar", e o botão volta.
- Com o painel recolhido, a barrinha ganha o ✋ (e a mão acesa enquanto você tem a palavra).
- Fora da voz, a linha mostra **Ouvir a Líder**. Ouvindo, ela vira "Ouvindo a Líder · volume · Parar", e o
  **Pedir para falar** pede para entrar na voz antes.
- O palco vazio mostra a transmissão da Líder primeiro ("Líder ao vivo · Assistir Ana").

### O som
- O seu grupo e a Líder tocam juntos. O **volume da Líder** fica salvo neste PC.
- **Silenciar as vozes** também silencia a Líder.
- As vozes da Líder acendem o "falando" como as outras.
- O atalho de apertar para falar vale também para quem tem a palavra.

### Casos-limite
- **O líder para de transmitir:** quem tem a palavra continua com ela. Os pedidos ficam esperando, e ninguém
  aceita até alguém voltar a transmitir na subsala Líder.
- **Quem tem a palavra entra na subsala Líder:** deixa de precisar dela (já fala livre). A palavra é devolvida
  sozinha.
- **Saiu da voz, da sala ou caiu:** o pedido e a palavra somem. Na volta (`resume`), nada é restaurado.
- **A subsala Líder é apagada:** os pedidos e a palavra zeram e a sala volta ao normal.
- **Troca de host:** a subsala continua Líder, e os pedidos e a palavra seguem junto no `seed`.
- **Alguém na sala com versão antiga:** vê a Líder como uma subsala comum e não ouve a voz dela fora do canal.
  O líder vê um aviso "N pessoas precisam atualizar o app para ouvir".

## Como implementar

### Servidor da sala (`sala-protocolo.js`, usado pelo `signaling.js` e pelo `servidor-internet/server.js`)
- A subsala passa a ter o modo: `{ id, name, modo: 'padrao' | 'lider' }`. `subsala-create` aceita `modo`, e
  `createSubsalas` recusa uma segunda Líder. Os apps antigos ignoram o campo.
- Estado novo `lider = { pedidos: [ids], palavra: [ids] }`, mandado a todos numa mensagem `lider`.
- Mensagens:
  - `lider-pedir` e `lider-cancelar`, de quem está fora da subsala Líder;
  - `lider-devolver`, de quem tem a palavra;
  - `lider-responder { id, ok }` e `lider-tirar { id }`, aceitas só de quem está **transmitindo dentro da subsala
    Líder**.
- Limpa pedidos e palavra quando a pessoa sai da sala ou da voz, entra na subsala Líder, ou a subsala é apagada.
- `lider` vai no `seed` da troca de host. Feature nova `lider` no `welcome`. O modo Internet precisa de deploy na
  VPS.

### Voz (`voice.js`)
- Hoje só quem está no mesmo canal se conecta. Regra nova: as **fontes** são quem está na subsala Líder mais quem
  tem a palavra.
- Cada fonte abre uma conexão **só de envio** para cada ouvinte de outro canal (e para quem está em "Ouvir a
  Líder"), separada da conexão do grupo: chave `lider:<id>` no `peers`. Entrar e sair da Líder não derruba a
  conversa do canal.
- **Ouvir a Líder** sem entrar na voz: uma sessão só de escuta, sem `getUserMedia`, anunciada no `voice-state`.
- O mixer recebe as vozes da Líder com um **ganho próprio** (o volume da Líder).
- Custo: cerca de 40 kbps de envio por ouvinte para cada fonte (30 ouvintes ≈ 1,2 Mbps).

### Transmissão (`transmitir.js`, `assistir.js`, `membros.js`)
- `canWatch()` libera sempre quem transmite na subsala Líder. **Quem pode assistir** fica fixo em "a sala toda"
  ali, com o cadeado desligado e explicando.
- Com muitas pessoas assistindo, o app sugere o modo "codificar uma vez só" (`encode-once.js`).
- O palco vazio (`updateStage`) põe a Líder em primeiro.

### Interface (`subsalas.js`, `navegacao.js`, `voz.js`, `index.html`, `styles.css`)
- A escolha Padrão/Líder ao criar.
- O selo e as seções Com a palavra e Pedidos no canal.
- A linha da Líder no Seu sinal e o ✋ na barrinha.
- Os temas ganham o acabamento do selo e da linha.

## Fases
1. Servidor e o modo na criação, a voz da Líder chegando à sala toda, **Ouvir a Líder** e a tela aberta para todos.
2. Pedir para falar: a fila, Aceitar, Recusar, Tirar e Devolver.
3. Acabamento: volume da Líder, sons, temas, guia e roteiro de teste.

### O que mudou do plano na fase 1
- O **Entrar** da voz (o botão que vai para o canal com mais gente) nunca leva para a Líder: quem só queria entrar
  na voz cairia falando para a sala toda. Para entrar nela, clica-se no canal.
- A conexão da Líder é chamada por quem ouve (só de receber) e respondida pela fonte com o microfone. Assim a fonte
  não precisa saber de antemão quem ouve, e quem está fora da voz ouve sem abrir o microfone.
- O volume da Líder (linha do Seu sinal) já entrou na fase 1, junto com o Ouvir.

### Como ficou a fase 2
- O servidor guarda os pedidos e a palavra junto das subsalas (`createSubsalas`: `pedidos`, `palavra`, `liderMsg`,
  `liderSai`) e manda a mensagem `lider` a todos; quem pediu recebe `lider-aviso` (aceito, recusado, tirada).
  `memberGone` limpa quem sai da sala nos dois servidores.
- Quem tem a palavra vira fonte no `LiderAudio`: quem está fora do canal dela (inclusive dentro da Líder) chama e ouve.
- Dentro da Líder sem transmitir, a pessoa vê quantos pedidos esperam ("quem transmite decide"), sem os botões.
- O som do pedido e do aceite é o de menção; sons próprios ficam para a fase 3.

### Como ficou a fase 3
- Sons próprios: `liderPedido` (Suave · duas batidinhas) e `liderPalavra` (Suave · quatro tons subindo), com o grupo
  **Modo Líder** em Configurações › Sons. No Top Gun: "Copy" e "Loud and clear".
- O aviso de app antigo não compara versões (o app em desenvolvimento tem o mesmo número da última sem o Modo Líder):
  o app novo diz no `hello` que conhece o Modo Líder (`lider: true`), o servidor repassa no `memberInfo`, e quem
  não diz conta como antigo. Quem está dentro da Líder não conta (ouve pelo canal).
- Temas: o selo, a mão e as seções usam as cores de cada tema (`--accent`, `--ok`); conferido por fotos no Estelar,
  Arasaka, EVA, Top Gun, Du'Sol e Renascença. No Estelar, os rótulos usam a fonte fixa espaçada.

## Critérios de aceitação
- [ ] Ao criar uma subsala, dá para escolher Padrão ou Líder; Líder só uma por sala.
- [ ] Quem está em outra subsala ou na Voz geral ouve quem está na Líder, e o próprio grupo continua se ouvindo.
- [ ] Quem está fora da Líder não é ouvido por ela sem a palavra.
- [ ] Quem está fora da voz ouve a Líder pelo **Ouvir a Líder**, sem microfone.
- [ ] A tela transmitida na Líder pode ser assistida por todos.
- [ ] O pedido chega a quem transmite na Líder; Aceitar faz a sala toda ouvir a pessoa; Recusar avisa;
      Tirar e Devolver param.
- [ ] Só quem transmite na Líder consegue aceitar, recusar e tirar (o servidor confere).
- [ ] Sem limite de pessoas com a palavra.
- [ ] Pedidos e palavra somem ao sair, cair ou apagar a subsala, e seguem na troca de host.
- [ ] Servidor antigo: a subsala é criada Padrão, sem erro. App antigo na sala: nada quebra.
- [ ] O mapa estelar continua igual.

## Testes
- Automáticos:
  - unidade em `sala-protocolo`: criar com modo, uma Líder só, quem pode responder, limpeza e `seed`;
  - unidade em `voice.js`: quais conexões `lider:` abrem e fecham com cada mudança de canal e de palavra;
  - e2e novo `lider.js` com 4 apps: o líder transmitindo, alguém dentro da Líder, duas pessoas em outra subsala
    (uma pede, é aceita, fala, e tem a palavra tirada), mais alguém fora da voz em **Ouvir a Líder**;
  - os de sempre: `subsalas`, `voz`, `musica`, `transmitir-janela`, `troca-de-host`.
- Manuais: uma chamada real com 3 PCs (um transmitindo na Líder e dois em subsalas), no Windows; item novo no
  roteiro de teste.
