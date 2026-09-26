# Guia de uso

Tudo o que dá para fazer no Tela P2P, com os detalhes. Para começar do zero, veja o [README](../README.md).

- [Sala](#sala)
- [Transmitir](#transmitir)
- [Assistir](#assistir)
- [Janela flutuante](#janela-flutuante)
- [Chat](#chat)
- [Chat por cima do jogo](#chat-por-cima-do-jogo)
- [Voz](#voz)
- [Voz e atalhos](#voz-e-atalhos)
- [Estatísticas](#estatísticas)
- [Tema](#tema)

## Sala

- **Criar:** clique em **Criar sala**, escolha a porta e, se quiser, uma senha. O app mostra um endereço tipo `26.12.34.56:8765`. Mande para os amigos. Quem cria é o **host**, e aparece "Host" ao lado do nome.
- **Entrar:** clique em **Entrar numa sala**, cole o endereço e clique em **Entrar**.
- **Tamanho:** até 12 pessoas.
- **Senha:** é opcional, mas recomendada se a rede da Radmin tiver mais gente.
- **Painel à direita:** só o chat. O **botão de pessoas** no topo mostra o total e acende uma bolinha verde quando alguém fala. Ele abre a lista por cima do chat, com:
  - quem está na sala, com **Assistir** e o volume de cada pessoa;
  - os detalhes da sua transmissão;
  - o endereço da sala, com **Copiar**.

  Clicar fora ou apertar Esc fecha a lista.
- **Barra de baixo:**
  - **Transmitir minha tela** (vira "Ao vivo · N assistindo", com **Parar**);
  - a voz;
  - o chat por cima do jogo;
  - as janelas flutuantes abertas;
  - **Estatísticas**;
  - o balão do chat;
  - **Sair**.
- **Recolher o painel:** o balão do chat recolhe o painel, e os vídeos ocupam a largura toda. Recolhido, ele mostra quantas mensagens chegaram, e o endereço da sala passa para a barra.

### Troca de host

Se o host sai, ou se o app dele fecha ou trava, a sala não acaba.

- **Quem assume:** quem está na sala há mais tempo vira o host sozinho e abre a sala de novo na mesma porta. Todo mundo se reconecta em poucos segundos.
- **O que continua:** as transmissões em andamento não caem, a conversa e a voz continuam, e a senha é a mesma.
- **Quem entrar depois** usa o endereço do novo host, que aparece na lista de pessoas dele.
- **Ao sair,** o host escolhe **Sair** (a sala continua) ou **Encerrar para todos**.
- **Versão:** só funciona com a sala criada na 1.8.4 ou mais nova, e com todo mundo nessa versão.

## Transmitir

- **Várias ao mesmo tempo:** qualquer pessoa pode clicar em **Transmitir minha tela**, e várias podem transmitir juntas.
- **O que transmitir:** na janela de transmitir, escolha a tela inteira ou uma janela, a qualidade e o áudio.
- **Sem prévia:** a prévia da sua própria tela não aparece na sala. Você vê o que escolheu ao começar.
- **Trocar sem parar:** enquanto transmite, clique em **Trocar**, ao lado de "Ao vivo", e escolha outra tela ou janela (por exemplo, de uma janela do Chrome para a do Firefox, ou de uma janela para a tela inteira). Quem assiste passa a ver a fonte nova em um instante, sem reconectar. A qualidade, o som e a codificação continuam os mesmos. Funciona nos três modos (normal, WebCodecs e NVENC direto).
- **Firewall:** na primeira vez, o Windows pergunta se o app pode acessar a rede. Marque **redes privadas e públicas**.

### Áudio e apps ignorados

- **Todo o som do PC:** o app captura tudo, mesmo se você escolher só uma janela. O som das telas que você está assistindo no app nunca vai para a sua transmissão, então ninguém se ouve de volta.
- **Ignorar o som destes apps:** marque quantos apps quiser (Discord, Spotify...). O Discord já vem marcado na primeira vez. O jogo, o vídeo e o resto do som vão para a transmissão, mas o som desses apps não vai. Com o Discord marcado, a voz de vocês na call não vai, e ninguém se escuta com atraso.
  - **A lista** mostra o nome de cada programa (ex.: "Wallpaper Engine" em vez de `wallpaper64.exe`) e esconde processos do Windows e de drivers.
  - **Apps abertos depois:** um app marcado fica de fora mesmo se abrir depois de a transmissão começar. Um app novo, não marcado, entra no som em até 2 segundos.
  - **Sons do Windows:** nesse modo, os sons de notificação do Windows não vão para a transmissão.
  - **Discord PTB e Canary** aparecem com o próprio nome quando estão tocando algum som. Se um app não aparecer, clique em **Atualizar**.
  - **Requisito:** Windows 10 versão 2004 (maio de 2020) ou mais novo, ou Windows 11.
- **Se a captura separada falhar:** o som vem do `bin/audiocap.exe`. Sem nenhum app marcado, o app volta para a captura comum do Windows e avisa que quem você assiste pode se ouvir de volta. Com apps marcados, transmite sem som, para não vazar a call.

Qualidade, codificação e jogo em tela cheia estão em [Desempenho](desempenho.md).

## Assistir

- **Assistir:** na lista de pessoas, quem está transmitindo aparece com **Assistir**. O vídeo só começa a ser baixado depois do clique.
- **Parar:** clique em **Parar** na lista ou no X da própria tela. A conexão fecha e o download para na hora.
- **Barra do vídeo:** aparece nos primeiros segundos, ao passar o mouse ou ao navegar com Tab. Tem silenciar, volume, janela flutuante, destacar, tela cheia e o X. Clicar duas vezes no vídeo também põe em tela cheia.
- **Várias telas:** com duas ou mais, uma fica grande à esquerda e as outras numa coluna ao lado, todas ao vivo. Clique numa pequena (ou Enter nela) para trocar o destaque.
- **Só esta:** o botão de destacar deixa só essa tela ocupando tudo. As outras ficam em pausa só para você, sem vídeo e sem som: quem transmite para de mandar o vídeo para você, e o seu PC deixa de decodificar. A faixa de cima mostra quem está em pausa. Clique num nome para trocar, ou em **Mostrar todas** (ou Esc) para voltar.
- **Volume por pessoa:** veja [Voz](#voz). O som da transmissão de cada pessoa também tem volume próprio.
- **App minimizado:** com a janela minimizada ou coberta pelo jogo por 3 segundos, o app para de baixar o vídeo e fica só com o som. Ao voltar, o vídeo volta na hora. Quem transmite vê "(vídeo pausado)" ao lado do seu nome.

## Janela flutuante

Para ver uma transmissão enquanto joga.

- **Abrir:** o botão da janelinha na barra do vídeo abre a transmissão numa janela pequena, sempre por cima, até do jogo.
- **Ajustar:** a janela abre no modo de ajuste. Arraste para mover e puxe as bordas para redimensionar. Há tamanhos rápidos (P, M, G) e a transparência.
- **Travar:** clique em **Travar** ou aperte **Ctrl+Shift+E**. Travada, o mouse passa direto: o clique vai para o jogo, e ela nunca tira o foco dele. Aperte Ctrl+Shift+E de novo, até de dentro do jogo, para ajustar.
- **No app,** o quadro dessa pessoa mostra "Picture in picture ativado, transmissão pausada", com **Trazer de volta** e **Ajustar janela**. O som continua saindo pelo app, e o vídeo continua chegando com o app minimizado.
- **Quem está falando:** a janela ganha uma borda verde quando a pessoa dela fala. Embaixo aparece quem mais está falando na voz.
- **Várias janelas:** dá para abrir uma para cada pessoa. Elas nascem empilhadas no canto, sem uma cobrir a outra, e Travar ou Ctrl+Shift+E valem para todas. O app lembra a posição, o tamanho e a transparência da 1ª, da 2ª... janela, e o X da barra fecha todas.
- **Arrumar em grupo** (com 2 ou mais):
  - **Todas do mesmo tamanho:** redimensionar uma, com o mouse ou pelo P, M e G, muda todas e reorganiza a fila.
  - **Como enfileirar:** em **Coluna** ou em **Linha**, a partir de um canto da tela (↖ ↗ ↙ ↘). Quando a fila não cabe, continua ao lado.
- **Tela cheia exclusiva:** a janela não aparece por cima de jogo em tela cheia **exclusiva**. Use o modo janela sem bordas do jogo.

## Chat

- **Mensagens:** Enter envia e Shift+Enter quebra a linha. Links abrem no navegador.
- **Organização:** mensagens seguidas da mesma pessoa ficam juntas, com a cor e a inicial dela. As que chegam enquanto você não está olhando ganham a linha "N mensagens novas" e o botão "Ir para as mensagens novas".
- **Arquivos:** use o clipe ou arraste para o chat, até 200 MB.
  - **Baixar:** quem clica em **Baixar** recebe direto de quem mandou, vê a barra de progresso (dá para cancelar) e depois clica em **Salvar**.
  - **Imagens pequenas** aparecem sozinhas.
  - **Disponibilidade:** o arquivo fica disponível enquanto quem mandou estiver na sala.
- **Histórico:** quem entra depois vê as últimas 100 mensagens.

## Chat por cima do jogo

O botão da barra com a tela e as linhas de texto abre o chat numa janela transparente, sempre por cima, até do jogo (em janela sem bordas).

- **O que mostra:** as últimas mensagens, que somem 20 s depois de chegar, e quem está falando na voz.
- **Ajustar:** abre no modo de ajuste. Arraste para mover, puxe as bordas para redimensionar e escreva no campo para responder.
- **Travar:** clique em **Travar** ou aperte **Ctrl+Shift+E** (o mesmo das janelas flutuantes). Travado, o clique passa para o jogo e ele não pega o teclado.
- **Ctrl+Shift+O** esconde e mostra de novo, de dentro do jogo. O app lembra a posição e o tamanho.
- **Ctrl+Enter no jogo** (dentro de uma sala): o chat por cima do jogo aparece com o campo de escrever, e abre sozinho se estiver fechado. **Enter** manda, **Esc** cancela, e nos dois casos o teclado volta para o jogo. Enquanto você está numa sala, o Ctrl+Enter fica reservado para isso em todos os programas.

## Voz

Clique em **Entrar na voz**, na barra de baixo, para ligar o microfone padrão do Windows e conversar com quem também entrou. A voz funciona sem transmitir nem assistir e continua ao parar uma transmissão. Todo mundo precisa da versão 1.8.4 ou mais nova. A voz foi feita pelo Cristian.

- **Barra da voz:**
  - o seu indicador (acende quando você fala);
  - **microfone** (liga e desliga);
  - **silenciar as vozes** (só o que você ouve, sem mexer no seu microfone nem no som das telas);
  - **sair da voz**.
- **Quem está falando** ganha um anel verde na bolinha e barrinhas ao lado do nome. Isso aparece na lista de pessoas, no vídeo dessa pessoa (borda verde), nas janelas flutuantes e no chat por cima do jogo. Microfone desligado aparece com um ícone amarelo.
- **Volume de cada pessoa:** o botão de volume ao lado do nome abre um cartão com:
  - **Voz** (0 a 200%, para ouvir quem tem o microfone baixo);
  - **Som da transmissão** (0 a 100%);
  - **Silenciar para mim** e **Voltar para 100%**.

  Só muda o que você ouve. O botão mostra o valor quando não está em 100%. O app lembra o volume de cada pessoa pelo nome, para a próxima sala.
- **Painel recolhido:** as bolinhas de quem está na voz ficam na barra de baixo, e clicar numa abre o mesmo cartão.
- **Microfone negado:** se o Windows negar o microfone, permita o acesso para aplicativos de desktop nas configurações de privacidade.
- **Voz e transmissão juntas:** se a captura que exclui o som do app falhar durante a conversa, a tela é transmitida sem áudio do PC, para não retransmitir as vozes. Se uma transmissão já estiver capturando todo o som do PC, pare, entre na voz e recomece a transmissão.
- **Como funciona:** a voz usa WebRTC direto pela Radmin, uma conexão por par de pessoas, sem servidor. Usa o microfone padrão.

## Voz e atalhos

O botão de controles na barra de voz.

- **Supressão de ruído:**
  - **Forte, com IA** (padrão): passa sua voz pelo [RNNoise](https://github.com/xiph/rnnoise), uma IA que roda no seu PC e tira teclado, ventilador, barulho da rua e respiração.
  - **Básica:** o filtro do Chrome, só para chiado constante.
  - **Desligada.**
- **Cancelamento de eco:** tira da sua voz o que sai das suas caixas (as vozes dos outros e o som das telas). Com fone, pode desligar. Dá para trocar este e o anterior no meio da conversa, sem sair da voz.
- **Sensibilidade do microfone:** abaixo do limite, o microfone fica fechado, e o barulho baixo entre as falas não passa.
  - **Automática** (padrão): mede o ruído de fundo e fica 12 dB acima dele.
  - **Manual:** desmarcando, você escolhe o limite, vendo a marca no medidor. A barra fica verde quando o microfone abre.
- **Atenuação:** abaixa o som das transmissões enquanto alguém fala na voz, de 0 (desligada) a 100%, e volta suave meio segundo depois. Dá para abaixar também quando você fala. Não mexe em outros programas do PC.
- **Como falar:**
  - **Detecção de voz:** o microfone fica aberto.
  - **Apertar para falar:** o microfone só manda som enquanto você segura a tecla escolhida, de qualquer lugar, até de dentro do jogo. Vale tecla ou botão do mouse (meio, Mouse 4, Mouse 5). Ao soltar, fica aberto mais 200 ms, para não cortar a última palavra.
- **Atalhos:** cada um pode ser trocado ou tirado.

  | Ação | Padrão |
  |------|--------|
  | Escrever no chat por cima do jogo | Ctrl+Enter |
  | Ligar/desligar o microfone | Ctrl+Shift+M |
  | Ajustar/travar as janelas por cima do jogo | Ctrl+Shift+E |
  | Esconder/mostrar o chat por cima do jogo | Ctrl+Shift+O |

  O app recusa combinações sem Ctrl ou Alt (menos F1 a F24), para não atrapalhar quando você digita, e avisa se outro programa já usa a combinação.

## Estatísticas

Na sala, o ícone de pulso na barra.

- **Medição:** enquanto você está numa sala, o app mede tudo uma vez por segundo, com a janela aberta ou não, e guarda os últimos 10 minutos. Dá para jogar e abrir depois para ver como foi.
- **Cada cartão** mostra o número de agora, a **média dos últimos 30 s** com mínimo e pico, e um **gráfico dos últimos 10 minutos**. A faixa no fim do gráfico marca os 30 s da média.
- **Uso do app:** processador, placa de vídeo 3D, codificação e decodificação. Mostra quanto o app usa e, embaixo, a média do PC inteiro (inclui o jogo). São os mesmos números do Gerenciador de Tarefas.
- **Transmissão:** quadros capturados, quadros enviados, Mbps enviando e recebendo.
  - Se "capturados" cai durante o jogo, a placa de vídeo estava ocupada.
  - Se "enviados" cai e "capturados" não, o problema é a internet ou a codificação.
- **Cada processo do app:** captura, codificação, decodificação, rede e os ajudantes, com a memória de vídeo de cada um.
- **O codificador de verdade:** por exemplo, "H.264 com OpenH264 (processador)". Para quem só assiste, o Chromium não diz qual é o decodificador.
- **Codificação alta com o app parado:** se "Codificação de vídeo, PC inteiro" estiver alta, é outro programa usando o codificador da placa (ex.: o Replay Instantâneo da NVIDIA ou uma live do Discord).

## Tema

Paleta escura minimalista:
- **Base:** grafite quase neutro, com texto claro.
- **Azul-lavanda,** a única cor de destaque: seleção, "você", "transmitindo" e "ao vivo".
- **Verde** só para "falando" e conectado.
- **Âmbar** para parar, encerrar e erros. Sem vermelho.

Fontes: Bricolage Grotesque nos títulos e Atkinson Hyperlegible no texto, dentro do app em `vendor/fonts/` (licença SIL OFL 1.1).
