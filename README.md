# AmostradinhoScreenShare (Tela P2P)

Compartilhamento de tela com áudio do PC, de computador para computador, usando a Radmin VPN. Não precisa de nenhum servidor pago: o app de quem transmite faz a "apresentação" entre os PCs, e o vídeo e o áudio vão direto para cada amigo.

**Baixar:** pegue o `.exe` da versão mais nova em [Releases](https://github.com/MateusMunhoz/AmostradinhoScreenShare/releases/latest). Não precisa instalar: é só abrir. Depois disso, o próprio app avisa quando sair uma versão nova.

## 1. Preparar a Radmin VPN (todos)

1. Instale a Radmin VPN em todos os PCs.
2. Uma pessoa cria a rede (Rede > Criar rede) e passa o nome e a senha.
3. Os outros entram nela (Rede > Entrar em uma rede existente).
4. Cada um fica com um IP que começa com 26.

## 2. Abrir o app (todos)

Baixe o `.exe` em [Releases](https://github.com/MateusMunhoz/AmostradinhoScreenShare/releases/latest) e abra.

**Rodar pelo código** (para quem vai mexer no projeto): instale o Node.js (versão LTS) em https://nodejs.org e, dentro da pasta do projeto, rode:

```
npm install
npm start
```

Para gerar um `.exe` portátil sem publicar nada: `npm run dist` (o arquivo aparece na pasta `dist`). O `.exe` tem sempre o mesmo nome, `Tela P2P.exe`, sem a versão: cada publicação troca o anterior em vez de juntar um arquivo por versão.

## 3. Usar

**Quem cria a sala:** clique em Criar sala, escolha a porta e, se quiser, uma senha. O app mostra um endereço tipo `26.12.34.56:8765`. Mande esse endereço para os amigos. Quem cria a sala é o **host** (aparece "Host" ao lado do nome).

**Troca de host:** se o host sai, ou se o app dele fecha ou trava, a sala não acaba. Quem está nela há mais tempo vira o host sozinho, abre a sala de novo na mesma porta e todo mundo se reconecta em poucos segundos. As transmissões em andamento não caem, a conversa continua e a senha é a mesma. Quem entrar depois usa o endereço do novo host, que aparece na tela dele. Ao sair, o host pode escolher **Sair** (a sala continua) ou **Encerrar para todos**. Isso só funciona com a sala criada na versão 1.8.4 ou mais nova e com todo mundo nessa versão.

**Quem entra:** clique em Entrar numa sala, cole o endereço e clique em Entrar.

**Dentro da sala:**

- **Transmitir:** qualquer pessoa pode clicar em Transmitir minha tela, e várias pessoas podem transmitir ao mesmo tempo.
- **Assistir:** na lista de pessoas, quem está transmitindo aparece com um botão Assistir. O vídeo só começa a ser baixado depois que você clica nele, e você pode assistir a várias telas lado a lado.
- **Parar de assistir:** clique em Parar na lista ou no X da própria tela. A conexão é fechada e o download para na hora.
- **Barra do vídeo:** aparece nos primeiros segundos, ao passar o mouse ou ao navegar com Tab. Tem o alto-falante (silenciar), o volume, a tela cheia (as duas setinhas) e o X. Também dá para entrar em tela cheia clicando duas vezes no vídeo. Cada tela tem o próprio volume.
- **Destacar uma tela:** assistindo duas ou mais pessoas, o botão de destacar (um quadro dentro do outro) na barra do vídeo faz essa tela ocupar toda a área de vídeo. As outras ficam em pausa só para você, sem vídeo e sem som. Quem transmite para de mandar o vídeo para você, e o seu PC deixa de decodificar. A faixa de cima mostra quem está em pausa: clique num nome para trocar o destaque na hora, ou em Mostrar todas (ou Esc) para voltar ao lado a lado.
- **Painel e barra da sala:**
  - **Painel à direita:** o endereço (com Copiar), quem está na sala, a sua transmissão (prévia e detalhes) e o chat, sempre à vista.
  - **Barra embaixo dos vídeos:** Transmitir minha tela (vira "Ao vivo · N assistindo" com Parar), a janela flutuante aberta (com o atalho e o X), Estatísticas, o balão do chat e Sair.
  - **O balão recolhe o painel,** e os vídeos ocupam a largura toda. Recolhido, ele mostra quantas mensagens chegaram, e o endereço da sala passa para a barra.
- **Chat:** mensagens seguidas da mesma pessoa ficam juntas. As que chegam enquanto você não está olhando ganham a linha "N mensagens novas" e o botão "Ir para as mensagens novas".
  - **Mensagens:** Enter envia e Shift+Enter quebra a linha. Links abrem no navegador.
  - **Arquivos:** use o clipe ou arraste o arquivo para o chat, até 200 MB. Quem clica em **Baixar** recebe direto de quem mandou, vê a barra de progresso (dá para cancelar) e depois clica em **Salvar**. Imagens pequenas aparecem sozinhas no chat.
  - O arquivo fica disponível enquanto quem mandou estiver na sala. Quem entra depois vê as últimas 100 mensagens.
  - Funciona se quem criou a sala tiver a versão 1.7.0 ou mais nova.
- **Janela flutuante (para ver enquanto joga):** o botão da janelinha na barra do vídeo abre essa transmissão numa janela pequena que fica sempre por cima, até do jogo. Ela abre no modo de ajuste: arraste para mover e puxe as bordas para redimensionar. Depois clique em **Travar** ou aperte **Ctrl+Shift+E**. Travada, o mouse passa direto por ela: o clique vai para o jogo, e ela nunca tira o foco dele. Aperte Ctrl+Shift+E de novo, até de dentro do jogo, para ajustar. No modo de ajuste há tamanhos rápidos (P, M, G) e a transparência da janela. Enquanto a janela estiver aberta, o quadro dessa pessoa no app mostra "Picture in picture ativado, transmissão pausada", com **Trazer de volta** e **Ajustar janela**. Dá para abrir uma janela para cada pessoa ao mesmo tempo: elas nascem empilhadas no canto, uma sem cobrir a outra, e **Travar** ou Ctrl+Shift+E valem para todas juntas. O app lembra a posição, o tamanho e a transparência de cada uma (da 1ª, da 2ª janela aberta...), e o X da barra fecha todas. Com 2 ou mais janelas, o modo de ajuste mostra também **Todas do mesmo tamanho** (redimensionar uma, com o mouse ou pelos tamanhos P, M e G, muda todas e reorganiza a fila) e como enfileirar: em **Coluna** ou em **Linha**, a partir de qual canto da tela (↖ ↗ ↙ ↘). Quando a fila não cabe na tela, ela continua ao lado. O som continua saindo pelo app, com o volume daquela tela, e o vídeo continua chegando com o app minimizado. Não aparece por cima de jogo em tela cheia **exclusiva**: use o modo janela sem bordas do jogo.

## Chat de voz

Na sala, clique em **Entrar na voz** (na barra de baixo) para ligar o microfone padrão do Windows e conversar com quem também entrou. A conversa funciona sem transmitir ou assistir a telas e continua ao parar uma transmissão. Todo mundo precisa da versão 1.8.4 ou mais nova. O chat de voz foi feito pelo Cristian.

- Na voz, a barra mostra o seu indicador (acende quando você fala), **microfone** (liga e desliga), **silenciar as vozes** (só o que você ouve, sem mexer no seu microfone nem no som das telas) e **sair da voz**.
- **Quem está falando** ganha um anel verde na bolinha e barrinhas que mexem ao lado do nome, na lista "Na sala", no vídeo dessa pessoa (borda verde), nas janelas flutuantes e no chat por cima do jogo. Microfone desligado aparece com um ícone amarelo.
- **Volume de cada pessoa:** o botão de volume ao lado do nome abre um cartão com **Voz** (0 a 200%, para ouvir quem tem o microfone baixo) e **Som da transmissão** (0 a 100%), mais **Silenciar para mim** e **Voltar para 100%**. Só muda o que você ouve. O botão mostra o valor quando não está em 100%, e o app lembra o volume de cada pessoa pelo nome, para a próxima sala. Com o painel recolhido, as bolinhas de quem está na voz ficam na barra de baixo; clicar numa abre o mesmo cartão.
- Se o Windows negar o microfone, permita o acesso para aplicativos de desktop nas configurações de privacidade. Use fones para reduzir eco.
- Se a captura que exclui o som do próprio app falhar durante a conversa, a tela é transmitida sem áudio do PC para evitar retransmitir as vozes. Se uma transmissão já estiver capturando todo o som do PC, pare-a, entre na voz e depois reinicie a transmissão.

- **Voz e atalhos** (o botão de controles na barra de voz):
  - **Supressão de ruído:** **Forte, com IA** (padrão) passa sua voz pelo [RNNoise](https://github.com/xiph/rnnoise), uma IA que roda no seu PC e tira teclado, ventilador, barulho da rua e respiração; **Básica** usa o filtro do Chrome (só chiado constante); **Desligada**.
  - **Cancelamento de eco:** tira da sua voz o que sai das suas caixas (as vozes dos outros e o som das telas). O app usa o cancelamento de eco do app inteiro, então vale também para o som que passa pelo volume de cada pessoa. Com fone, pode desligar.
  - Dá para trocar os dois no meio da conversa, sem sair da voz. Um medidor mostra o que o seu microfone está mandando.
  - **Como falar:** **Detecção de voz** (o microfone fica aberto) ou **Apertar para falar**: o microfone só manda som enquanto você segura a tecla escolhida, de qualquer lugar, até de dentro do jogo. Vale tecla do teclado ou botão do mouse (meio, Mouse 4 e Mouse 5). Ao soltar, fica aberto mais 200 ms para não cortar a última palavra. Quem cuida da tecla é o `bin/teclas.exe`, que só consulta se a tecla está apertada (não intercepta o teclado).
  - **Atalhos:** escrever no chat por cima do jogo (Ctrl+Enter), ligar/desligar o microfone (Ctrl+Shift+M), ajustar/travar as janelas por cima do jogo (Ctrl+Shift+E) e esconder/mostrar o chat por cima do jogo (Ctrl+Shift+O). Cada um pode ser trocado ou tirado; o app recusa combinações sem Ctrl ou Alt (menos F1 a F24) e avisa se outro programa já usa a combinação.

A voz usa WebRTC direto pela Radmin, com uma conexão por par de participantes. Não usa servidor adicional. Usa o microfone padrão, sem escolher o dispositivo.

## Chat por cima do jogo

O botão da barra com a tela e as linhas de texto abre o chat da sala numa janela transparente, sempre por cima, até do jogo (em janela sem bordas). Ela mostra as últimas mensagens, que somem 20 s depois de chegar, e quem está falando na voz. Abre no modo de ajuste: arraste para mover, puxe as bordas para redimensionar e escreva no campo para responder. Depois clique em **Travar** ou aperte **Ctrl+Shift+E** (o mesmo das janelas flutuantes): travada, o clique passa direto para o jogo e ela não pega o teclado. **Ctrl+Shift+O** esconde e mostra de novo, de dentro do jogo. O app lembra a posição e o tamanho.

**Ctrl+Enter** (dentro de uma sala; dá para trocar em Voz e atalhos), de dentro do jogo: o chat por cima do jogo aparece (abre sozinho se estiver fechado) com o campo de escrever. Digite e aperte **Enter** para mandar, ou **Esc** para cancelar; nos dois casos o teclado volta para o jogo. Enquanto você está numa sala, o Ctrl+Enter fica reservado para isso em todos os programas.

Verificações de desenvolvimento: `npm test`. O teste adicional `npm run test:rtc` usa duas janelas ocultas do Electron e áudio sintético para verificar o transporte WebRTC local, sem abrir seu microfone. A validação de microfones reais e Radmin entre computadores continua necessária.

## Atualizações

Ninguém precisa baixar o `.exe` de novo para atualizar. A versão nova chega de dois jeitos, e os dois usam o mesmo pacote assinado (cerca de 500 KB):

- **Pelo GitHub (a partir da 1.1.2):** ao abrir, o app procura a última versão em Releases. Se houver uma mais nova, aparece **Baixar atualização** na tela inicial. Também dá para clicar em **Procurar atualização**, ao lado do número da versão.
- **Pela sala (a partir da 1.1.0):** quando alguém da sala tem uma versão mais nova, o app baixa dessa pessoa pela própria Radmin, em menos de um segundo. Quem atualizou também repassa para os próximos.

Nos dois casos, o app confere a assinatura e mostra **Reiniciar agora**.

- **Segurança:** o app só aceita atualizações assinadas com a chave de quem publica. Pacote alterado, de outra pessoa ou mais velho que o atual é recusado, mesmo que venha do GitHub. Se uma versão nova não abrir, o app volta sozinho para a versão do `.exe`.
- **Versões antigas:** quem tem a 1.0.0 precisa baixar o `.exe` uma vez. Quem tem a 1.1.0 ou a 1.1.1 recebe a 1.1.2 pela sala e, dali em diante, também pelo botão do GitHub.
- **Nada se acumula:** atualizar não cria outro `.exe`. A versão nova fica em `%APPDATA%\Tela P2P\atualizacoes`, e as pastas das versões mais velhas que a que está rodando são apagadas quando o app abre.
- **Quando precisa do `.exe` de novo:** só se mudar a versão do Electron ou o `boot.js`. O app avisa que aquela versão "precisa do .exe novo" e abre a página dela no GitHub.

### Para publicar uma versão (só quem tem a chave)

A chave fica em `C:\Users\<você>\.tela-p2p\chave-de-atualizacao.pem`, fora do projeto. **Faça uma cópia dela** (pen drive, nuvem): sem ela não dá mais para publicar atualizações para quem já tem o app. **Nunca mande para ninguém**, porque quem tiver a chave consegue publicar no seu nome.

Depois de mexer no código:

```
npm run publicar
```

Isso faz tudo de uma vez:

1. sobe a versão (1.1.2 → 1.1.3);
2. assina o pacote e deixa a versão pronta no seu app;
3. gera o `.exe`;
4. manda para o GitHub: commit de tudo que mudou, a tag `v1.1.3` e uma Release com o `.exe` e o pacote assinado.

A partir daí, o app dos amigos mostra **Baixar atualização**.

Outras formas de rodar:

- **Escolher o número:** `npm run publicar -- 1.2.0`
- **Texto da Release:** `npm run publicar -- --notas "o que mudou"`. Sem ele, o GitHub lista os commits.
- **Sem mandar nada para o GitHub:** `npm run publicar -- --sem-github`

Para mandar para o GitHub, o PC precisa do Git e do [GitHub CLI](https://cli.github.com) logado (`gh auth login`) na conta dona do repositório.

A chave foi criada uma vez com `node publicar.js --gerar-chave`, que também grava a parte pública no `boot.js`. Não rode de novo: uma chave nova faria os apps dos amigos recusarem suas atualizações.

## Firewall do Windows

Na primeira vez que alguém transmitir, o Windows vai perguntar se o app pode acessar a rede. Marque **redes privadas e públicas** e clique em Permitir. A rede da Radmin às vezes é tratada como pública; se só a privada for marcada, os amigos não conseguem conectar.

Faça o mesmo nos PCs de quem assiste, caso o Windows pergunte.

## Dicas e limites

- **Upload:** quem transmite manda uma cópia do vídeo para cada pessoa que está assistindo. Em 1080p 30 fps são cerca de 4,5 Mbps por pessoa, então 3 pessoas assistindo usam uns 14 Mbps de upload. Se travar, use 720p.
- **Codec:** o app usa H.264 (ou VP8, se o PC não tiver H.264). Durante a transmissão, o painel mostra o codec e se a codificação está na placa de vídeo ou no processador. Atenção: nesta versão do Electron (33), o WebRTC codifica pelo processador mesmo com placa NVIDIA. Isso foi medido numa RTX 4060, que o Chromium reconhece como capaz de codificar H.264 e AV1. Por isso a qualidade escolhida pesa bastante no jogo.
- **Download:** cada tela que você assiste soma no seu download. O painel da sala mostra quanto você está baixando no total.
- **Tamanho da sala:** até 12 pessoas.
- **Áudio:** no modo "Todo o som do PC", o app captura tudo, mesmo se você escolher só uma janela. A única exceção é o som das telas que você está assistindo no próprio app, que nunca vai para a sua transmissão (assim seus amigos não se ouvem de volta).

## Desempenho enquanto joga

O app já faz isto sozinho:

- **Janela minimizada ou coberta pelo jogo:** depois de 3 segundos, o app para de baixar o vídeo das telas que você assiste e fica só com o som. Quem transmite deixa de codificar vídeo para você, e o seu PC deixa de decodificar. Ao voltar para a janela, o vídeo volta na hora. Quem transmite vê "(vídeo pausado)" ao lado do seu nome.
- **Prévia da sua tela:** só roda com a janela do app em foco. Enquanto você está no jogo ela para, e a transmissão continua normal.
- **Som:** o capturador de áudio usa a prioridade de áudio do Windows e tem uma folga maior, então não picota quando o jogo pesa.
- **Prioridade e modo de eficiência:** com a janela minimizada, o Chromium (o motor do app) jogava a página de quem assiste para prioridade *ociosa* e *modo de eficiência* (núcleos lentos). Enquanto alguém jogava, o som picotava e as respostas para quem transmite atrasavam, e quem transmitia baixava a qualidade achando que a internet estava ruim. Agora todos os processos do app ficam **acima do normal** e com o modo de eficiência desligado, mesmo minimizados.

### Estatísticas

Na sala, clique no ícone de pulso ao lado de Sair da sala. Enquanto você está numa sala, o app mede tudo uma vez por segundo, com a janela aberta ou não, e guarda os últimos 10 minutos. Dá para jogar uma partida e abrir as Estatísticas depois para ver como foi.

Cada cartão mostra o número de agora, a **média dos últimos 30 s** com o mínimo e o pico, e um **gráfico dos últimos 10 minutos**. A faixa no fim do gráfico marca os 30 s da média.

- **Uso do app:** processador, placa de vídeo 3D, codificação e decodificação de vídeo. Mostra quanto o app usa de cada um e, embaixo, a média de 30 s do PC inteiro (inclui o jogo e outros programas). São os mesmos números do Gerenciador de Tarefas.
- **Transmissão:** quadros capturados, quadros enviados, Mbps enviando e Mbps recebendo. Se "capturados" cai durante o jogo, a placa de vídeo estava ocupada. Se "enviados" cai e "capturados" não, o problema é a internet ou a codificação.
- **Cada processo do app:** quem captura a tela, quem codifica, quem decodifica, a rede e os ajudantes. Também mostra a memória de vídeo de cada um.
- **O codificador de verdade:** por exemplo "H.264 com OpenH264 (processador)". Para quem só assiste, o Chromium não diz qual é o decodificador, então aparecem só o codec, a resolução e os fps.

Se "Codificação de vídeo, PC inteiro" estiver alta com o app parado, é outro programa usando o codificador da placa (por exemplo, o Replay Instantâneo da NVIDIA ou uma live do Discord).

### Codificar uma vez só (experimental)

No modo normal, cada pessoa que assiste tem uma conexão própria, e o WebRTC codifica o vídeo uma vez para cada conexão, pelo processador. Com 3 amigos assistindo, são 3 codificações.

Na tela de transmitir, **Codificação > Uma vez só para todos (experimental)** codifica o vídeo uma vez só e manda o mesmo vídeo para todos. O peso não aumenta quando mais gente entra. O app escolhe o motor sozinho, nesta ordem:

1. **NVENC direto** (placas NVIDIA com driver 522 ou mais novo): o ajudante `videocap.exe` captura a tela pelo Windows e codifica no NVENC. A imagem nem passa pelo processador. No teste com 2 pessoas assistindo, o app usou 0,6% do processador, contra 1,5% no WebCodecs e 2,4% no modo normal. Nesse motor, a prévia da sua tela é a própria transmissão decodificada.
2. **WebCodecs** (qualquer placa): a captura é a do Chromium, e a codificação vai para a placa de vídeo (AMD e Intel também) ou para o processador.
3. **Modo normal**, se os dois falharem.

Como funciona:

- **Se o app de quem assiste é de uma versão antiga,** essa pessoa recebe no modo normal, na mesma transmissão. No NVENC direto, a captura do Chromium só liga enquanto alguém assim estiver assistindo.
- **Se a internet de alguém não dá conta,** só essa pessoa pula quadros até o próximo quadro completo. Os outros não travam.
- **Se ninguém estiver com o vídeo aberto,** por exemplo com todos jogando e com o app minimizado, o NVENC pausa.
- **Se o motor parar no meio,** o app troca sozinho: NVENC direto → WebCodecs → processador → modo normal. A transmissão não cai.
- **Para conferir,** abra **Estatísticas**. Ela mostra, por exemplo, "H.264 com NVENC direto (placa de vídeo), 1 codificação para N pessoas". A tabela mostra o processo "Captura e NVENC".

Se o PC não conseguir codificar desse jeito, a opção fica desativada.

Os ajudantes nativos são compilados com `native\build.cmd` (Visual Studio Build Tools com C++). `native\build.cmd videocap` compila só o de vídeo. O cabeçalho do NVENC (`native/third_party/nvEncodeAPI.h`) é do projeto nv-codec-headers e tem licença MIT.

### Jogo em tela cheia

Com o jogo em tela cheia, a taxa de envio pode cair por três motivos:

- **Placa de vídeo em 100%:** o jogo usa a placa inteira, e a captura da tela (que copia a imagem pela placa) perde a vez. Ela entrega menos quadros por segundo, e menos quadros viram menos dados enviados. O app agora usa a mesma prioridade escolhida (acima do normal ou alta) também na placa de vídeo, como o OBS faz. Mesmo assim, o que mais ajuda é **limitar o FPS do jogo** para sobrar uns 10% da placa. Dá para fazer nas opções do jogo ou em Painel de controle da NVIDIA > Taxa de quadros máxima.
- **Captura da *janela* do jogo em tela cheia exclusiva:** a janela pode congelar ou ficar preta. Imagem parada ocupa quase nada, e o envio despenca. Nesse caso, use o modo **janela sem bordas** (*borderless*) do jogo ou transmita a **Tela inteira**.
- **Processador:** veja a prioridade, abaixo.

Para saber qual foi, volte para o app depois de jogar. Embaixo da prévia aparece o resumo de como a transmissão foi enquanto o app estava escondido: quadros capturados, quadros enviados, Mbps e o que limitou (placa de vídeo, processador ou internet).

O que você pode ajustar:

- **Prioridade do app** (na tela de transmitir; vale para o app inteiro e fica salva):
  - *Normal*: o jogo vem primeiro.
  - *Acima do normal* (recomendado): a transmissão vence os programas comuns sem atrapalhar o Windows.
  - *Alta*: a transmissão vem antes do jogo, que pode perder alguns FPS.
  - Não existe "Tempo real" de propósito. Sem administrador o Windows ignora; com administrador, pode travar mouse, teclado e o som do próprio jogo.

- **Qualidade:** 720p 60 fps tem menos da metade dos pixels de 1080p 60 fps e continua fluido para jogos. É a opção mais leve para quem joga e transmite ao mesmo tempo.
- **Cada pessoa assistindo é uma codificação a mais** no modo normal. Com 3 pessoas, são 3 codificações. Se pesar, use **Uma vez só para todos** (acima), 720p ou 30 fps.
- **Transmita a janela do jogo** em vez da tela inteira quando der. Se o monitor for maior que 1080p (1440p ou 4K), o app precisa reduzir a imagem antes de codificar, e isso usa o processador.
- **Codificação pelo processador:** hoje o painel deve dizer "pelo processador" (veja Codec, acima). Enquanto for assim, 720p é o ajuste que mais alivia o jogo.
- **Senha:** é opcional, mas recomendada se a rede da Radmin tiver mais gente.

## Ignorar apps (Discord, Spotify...)

Na tela de transmitir, deixe **Áudio** em **Todo o som do PC** e marque, em **Ignorar o som destes apps**, quantos apps quiser (por exemplo Discord e Spotify). O Discord já vem marcado na primeira vez. A lista mostra o nome de cada programa (ex.: "Wallpaper Engine" em vez de `wallpaper64.exe`) e esconde processos do Windows e de drivers. O jogo, o vídeo e o resto do som vão para a transmissão, mas o som desses apps não vai. Com o Discord marcado, a voz de vocês na call não vai, então ninguém se escuta com atraso.

- **Apps abertos depois:** um app marcado fica de fora mesmo se for aberto depois de a transmissão começar. Um app novo que não está marcado entra no som em até 2 segundos.
- **Sons do Windows:** nesse modo, os sons de notificação do próprio Windows não vão para a transmissão.
- **Como funciona:** o Windows só sabe ignorar um programa por vez. Com dois ou mais, o app captura em separado cada programa que está tocando som (menos os marcados) e junta tudo.
- **Requisito:** Windows 10 versão 2004 (maio de 2020) ou mais novo, ou Windows 11.
- **Outros apps:** a lista mostra o Discord e os programas que estão usando som agora. Clique em Atualizar se o app não aparecer.
- **Discord PTB ou Canary:** eles aparecem na lista com o próprio nome quando estão tocando algum som.

O som vem de um pequeno programa na pasta `bin` (`audiocap.exe`), cujo código está em `native/audiocap.cpp`. Se ele falhar sem nenhum app marcado, o app volta para a captura comum do Windows e avisa que quem você assiste pode se ouvir de volta. Com apps marcados, transmite sem som, para não vazar a call. Como é um executável novo e sem assinatura digital, o Windows Defender ou o SmartScreen podem desconfiar dele. Se preferir compilar você mesmo, instale o MinGW-w64 e rode:

```
x86_64-w64-mingw32-g++ -O2 -std=c++17 -static -s -o bin/audiocap.exe native/audiocap.cpp -lole32 -luuid -lshell32
```
## Problemas comuns

| Problema | O que fazer |
| --- | --- |
| "Não foi possível conectar" | Confira se a Radmin está ligada nos dois PCs e se o endereço está certo. Teste com um ping no IP 26.x. |
| Conecta, mas o vídeo não aparece | Libere o app no Firewall do Windows (redes públicas) nos dois PCs. |
| "A porta já está em uso" | Troque a porta (ex.: 8766) e passe o novo endereço. |
| Borda amarela em volta do que está sendo transmitido (Windows 10) | Resolvido na 1.5.2. É o aviso da captura moderna do Windows, que o Windows 10 não deixa esconder. Nele, o app passa a usar as capturas antigas, sem borda: a tela inteira pela Duplicação da Área de Trabalho (também no NVENC direto, com o cursor desenhado pelo app) e as janelas pela captura do Chromium. Alguma janela de jogo pode sair preta: nesse caso, transmita a Tela inteira. |
| Sem áudio | Verifique se há som tocando no dispositivo de saída padrão do Windows. |
| "Não foi possível ignorar os apps escolhidos" ou "Não deu para separar o som deste app" | Confira a versão do Windows (Configurações > Sistema > Sobre) e se o antivírus não bloqueou o `audiocap.exe`. |
| O painel diz "pelo processador" | É o esperado nesta versão (veja Codec). Use 720p 60 fps ou 30 fps para aliviar o processador. |
| A voz do Discord ainda aparece | Confira se o Discord está marcado em "Apps ignorados". Discord PTB e Canary aparecem com o próprio nome. |
| O jogo perde FPS enquanto transmito | Use 720p 60 fps (ou 30 fps) e transmita a janela do jogo. Veja "Desempenho enquanto joga". |
