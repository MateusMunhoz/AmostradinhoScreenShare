# Guia de uso

Tudo o que dá para fazer no Nebula, com os detalhes. Para começar do zero, veja o [README](../README.md).

- [Sala](#sala)
- [VPN Nebula](#vpn-nebula)
- [Sessões abertas](#sessões-abertas)
- [Transmitir](#transmitir)
- [Assistir](#assistir)
- [Janela flutuante](#janela-flutuante)
- [Chat](#chat)
- [Chat por cima do jogo](#chat-por-cima-do-jogo)
- [Voz](#voz)
- [Voz e atalhos](#voz-e-atalhos)
- [Estatísticas](#estatísticas)
- [Tema](#tema)
- [Atualizações](#atualizações)

## Sala

- **Criar:** clique em **Criar sala**, escolha a porta e, se quiser, uma senha. O app mostra um endereço tipo `26.12.34.56:8765`. Mande para os amigos. Quem cria é o **host**, e aparece "Host" ao lado do nome.
- **Entrar:** clique em **Entrar numa sala**, cole o endereço e clique em **Entrar**.
- **Carregando:** criando ou entrando (pelo endereço, pelo código, na sala de um amigo, por um convite ou numa chamada), aparece **Entrando na sala…** com o passo da conexão até a sala abrir. Enquanto isso, clicar de novo não abre outra conexão. **Cancelar** (ou Esc) desiste da entrada.
- **Tamanho:** até 12 pessoas.
- **Senha:** é opcional, mas recomendada se a rede da Radmin tiver mais gente.
- **Painel à direita:** só o chat. O **botão de pessoas**, na barrinha da direita, mostra o total e acende uma bolinha verde quando alguém fala. Ele abre a lista por cima do chat, com:
  - quem está na sala, com **Assistir** e o volume de cada pessoa;
  - os detalhes da sua transmissão;
  - o endereço da sala, com **Copiar**;
  - a **senha** da sala (para quem entrou com ela e para o host), escondida, com o **olho** para mostrar, **Copiar** e
    **Mudar**. Só o host muda: quem já está continua na sala e recebe a nova; quem entrar depois precisa dela. Vazia,
    a sala fica sem senha (no modo Internet, mínimo 4 caracteres). No modo Internet, mudar também cancela os convites
    sem senha (pelas mensagens e pela lista dos amigos), e se o host sai, quem está há mais tempo assume. Numa sala
    cujo servidor é antigo, o **Mudar** fica desativado e explica.

  Clicar fora ou apertar Esc fecha a lista.
- **Perfil de alguém:** o mesmo cartão em todo lugar (Pessoas da sala, voz em lista e voz no mapa): fundo, foto, nome, onde a pessoa está, as ações (assistir, adicionar como amigo, mandar mensagem para amigos, silenciar e mudar de canal na voz) e o volume.
- **Barra flutuante:** uma pílula por cima das telas, embaixo e no meio. Some sozinha com o mouse parado e volta ao mexer o mouse (com o mouse em cima dela, fica); com uma música do YouTube no palco, fica acima dos controles do player. Tem:
  - **Transmitir minha tela** (vira o bloco **Ao vivo**: a miniatura do que você transmite, que abre a sua tela no palco, e o nome da tela, com **Trocar** e **Parar**);
  - a voz: dentro dela, microfone, fone e sair no meio e, no fim, as bolinhas de quem está na chamada com você; fora dela, as bolinhas de quem já está conversando e **Entrar** (entra no canal com mais gente; sem ninguém, o botão diz **Voz**). Com gente em mais de uma subsala, a setinha ao lado abre a lista desses canais para escolher onde entrar;
  - as janelas flutuantes abertas.
  As **Estatísticas** ficam nas Configurações, e o chat abre pela barrinha da direita.
- **Barrinha da direita:** em cima, o perfil; logo abaixo, separados por uma linha, o **botão de pessoas** (o total e uma bolinha verde quando alguém fala; abre a lista de quem está na sala), **Chat**, **Voz** e **Transmissão**. Ouvindo uma música, aparece também o botão de **música**: clicar mostra **Pausar** ou **Continuar** (para todos, se você pode controlar) e **Sair da música** (a música continua para os outros). No pé, **Início** (vai para o saguão sem sair da sala) e, depois de uma linha, o **chat por cima do jogo**, o **modo gamer** (o controle), **Voz e atalhos**, **Feedback e bugs** (o balão com exclamação) e a engrenagem; por último, depois de outra linha, **Sair**, em vermelho. No saguão, com a sala aberta, o pé mostra **Voltar para a sala**, com o número de mensagens novas.
- **Recolher o painel:** o balão do chat recolhe o painel, e os vídeos ocupam a largura toda. Recolhido, ele mostra quantas mensagens chegaram, e o endereço da sala passa para a barra.

### Como os PCs se conectam

Em **Configurações › Rede**. O padrão é **Internet (servidor)**: sem VPN, a sala fica num servidor (VPS) e os amigos
entram por código e senha, pela lista de salas dos amigos ou por um convite nas mensagens. Também dá para usar
**Radmin ou rede local** e **Razze (WireGuard)**. Quem já usava o app antes do modo Internet virar o padrão, sem
ter escolhido outro, continua na Radmin.

### VPN Nebula

Para usar uma rede virtual sem Radmin, todos precisam usar a mesma instalação da RazzeAPI. O administrador
hospeda a API, configura a aprovação de contas e fornece o endereço HTTPS do servidor.

1. Abra **Configurações**, escolha **VPN Razze (WireGuard)** e informe o endereço HTTPS.
2. Crie uma conta. O administrador precisa aprová-la; depois disso, entre com e-mail e senha.
3. Crie uma rede ou aceite um convite enviado pelo dono. Todos os PCs precisam entrar na mesma rede.
4. Clique em **Conectar WireGuard**. O Windows pedirá permissão administrativa para criar a interface
   VPN. O app guarda a chave privada localmente e publica somente a chave pública no servidor.
5. Depois de conectar, crie ou entre numa sala normalmente; o endereço privado da rede Razze aparece
   junto do endereço Radmin. A descoberta de salas pela lista inicial continua disponível apenas em LAN/Radmin.

O dono pode copiar um link `telap2p://invite/...` na configuração da rede. No PC que receber o link, abra
o Nebula pelo link e entre na conta Razze para aceitar o convite. Também é possível colar o link no campo
**Entrar por convite**.

O **Mapa de conexões** fica no mesmo lugar, em **Configurações › Rede**: este PC em cima e, embaixo, o servidor Razze e cada
rede, em verde (conectado), vermelho (sem conexão) ou cinza (indisponível). Atualiza sozinho a cada 5 segundos
enquanto a aba está aberta. Transmitindo, o app sai da sua transmissão enquanto a aba está aberta, para os
endereços não aparecerem para quem assiste.

A conexão P2P WireGuard depende dos NATs dos dois lados permitirem hole punching. Redes com CGNAT restritivo
  podem não conectar nesta versão; um relay WireGuard ainda não está incluído. Com o app aberto, a lista de peers
  sincroniza a cada 30 segundos; depois de reabrir o Nebula, clique em **Atualizar peers** para sincronizar de novo.
  A senha da sala continua sendo independente das permissões da VPN.

### Sessões abertas

A tela inicial mostra as **sessões abertas** na rede da Radmin: as salas que alguém criou, com o nome de
quem está com ela, quantas pessoas estão dentro e um cadeado se tiver senha.

- **Entrar:** o botão ao lado da sessão entra direto. Se ela tiver senha, abre o **Entrar numa sala** com
  o endereço preenchido, e é só digitar a senha.
- **Como aparece:** quem tem uma sala aberta avisa a rede a cada 3 segundos. A sessão some da lista quando
  a sala é encerrada, ou depois de uns 10 segundos sem aviso (PC desligado, Radmin caiu).
- **Troca de host:** a sessão continua a mesma na lista, com o nome do novo host.
- **Não mostrar a sua:** ao criar a sala, desmarque **Mostrar esta sessão para quem está na rede**. Ela
  continua funcionando pelo endereço, só não aparece para os outros (e continua assim se o host mudar).
- **Se nada aparecer:** algumas redes não deixam passar o aviso. O app também pergunta direto aos
  endereços das salas em que você já esteve, então elas aparecem mesmo assim. Se ainda não aparecer,
  entre pelo endereço, como antes.
- **O que os outros veem:** o seu nome, quantas pessoas estão na sala e se ela tem senha. A senha nunca vai
  no aviso, e continua sendo pedida para entrar.

### Salas dos amigos (modo Internet)

No modo Internet, a lista da tela inicial vira **Salas dos seus amigos**: as salas que os seus amigos do Razze
abriram pela internet. Basta estar logado na conta Razze (no seu **Perfil**, em **Conta Razze**); a VPN Razze não precisa estar ligada.
Quando há uma sala aberta (de amigo ou, nos outros modos, na sua rede), ela sobe para cima dos amigos com o selo
**AO VIVO**, quantas pessoas, se a voz está ligada, o jogo do dono e os rostos dos seus amigos que já estão dentro.
**Entrar na sala** vira o botão principal; **Abrir minha sala** e **Entrar com código** ficam como botões comuns.

- **Quem instala agora:** o app já começa no modo Internet, com o servidor da equipe e a conta Razze prontos. É só criar
  a conta na aba Rede, adicionar os amigos e criar ou entrar nas salas. Quem já usava o app continua na Radmin; para
  mudar, escolha **Internet (servidor)** em **Como os PCs se conectam**.

- **Entrar:** o botão **Entrar** entra direto, sem senha, por um **passe de convite** que o app de quem criou a
  sala manda só para os amigos dele. Se o passe não valer mais (quem convidou saiu da sala) ou o servidor for
  antigo, abre o **Entrar com código** com o código preenchido, e é só digitar a senha. O servidor usado é o da
  sala do amigo, mesmo que o da sua aba Rede seja outro.
- **A sua aparece para os seus amigos:** ao criar a sala, deixe marcado **Mostrar esta sala para meus amigos do
  Razze**. Desmarcado, ela só funciona pelo código e senha.
- **Quanto tempo fica:** enquanto você está na sala. Saiu (ou fechou o app), ela some da lista dos amigos na hora;
  se o PC cair, em até 70 segundos. Se você sair e a sala continuar com os outros, o seu convite para de valer.
- **Quem vê:** só os amigos aceitos no Razze. Nenhum IP vai junto, só o servidor, o código e quantas pessoas estão.
- **Quem não tem conta Razze:** continua entrando pelo código e senha.

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
- **Só para o seu canal:** na janela de transmitir, **Outros canais podem assistir** diz se quem está em outra subsala (ou na Voz geral, se você está numa subsala) pode assistir. Vem ligado e fica salvo. Durante a transmissão, o ícone ao lado de **Trocar** (globo = a sala toda, cadeado = só o seu canal) abre **Quem pode assistir**, com as duas opções; a escolha muda só a transmissão atual; a próxima começa como está na janela. Fechada, quem está fora do seu canal vê o **Assistir** desligado, e quem já assistia de fora para de ver (também quando você ou a pessoa muda de canal).
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
- **Cada tela** tem uma faixa em cima com o nome da pessoa. Quando ela fala na voz, a borda pisca em verde e aparecem 3 barrinhas ao lado do nome.
- **Barra do vídeo:** fica por cima do vídeo, em cima. Aparece ao mexer o mouse na tela (ou ao navegar com Tab) e some com o mouse parado por uns 2 segundos ou fora da tela; com o mouse em cima dela, fica. Tem silenciar, volume, janela flutuante, destacar, tela cheia e o X. Clicar duas vezes no vídeo também põe em tela cheia. Resolução, quadros e Mbps de cada tela ficam em [Estatísticas](#estatísticas), na aba Transmissão.
- **Várias telas:** com duas ou mais, uma fica grande à esquerda e as outras numa coluna ao lado, todas ao vivo. Clique numa pequena (ou Enter nela) para trocar o destaque.
- **Só esta:** o botão de destacar deixa só essa tela ocupando tudo. As outras ficam em pausa só para você, sem vídeo e sem som: quem transmite para de mandar o vídeo para você, e o seu PC deixa de decodificar. A faixa de cima mostra quem está em pausa. Clique num nome para trocar, ou em **Mostrar todas** (ou Esc) para voltar.
- **Transmissão sem som:** se quem transmite está sem o som do PC (desligou em "Som do PC" ou a captura falhou), a faixa da tela mostra **sem som** e o controle de volume some. Quem transmite vê "sem som" no **Ao vivo**; para ter som, é parar e transmitir de novo com "Som do PC" ligado.
- **Som das telas:** toda transmissão começa **sem som** (0%). Para ouvir, role a roda do mouse para cima em cima da tela (5% por clique), use o controle da barra do vídeo ou clique no alto-falante (liga em 100%). O volume de cada pessoa fica guardado pelo nome.
- **Volume por pessoa:** veja [Voz](#voz).
- **App minimizado:** com a janela minimizada ou coberta pelo jogo por 3 segundos, o app para de baixar o vídeo e fica só com o som. Ao voltar, o vídeo volta na hora. Quem transmite vê "(vídeo pausado)" ao lado do seu nome.

## Clipes

Salva os últimos segundos de uma transmissão, com o som dela, num arquivo de vídeo, como o replay do ShadowPlay: aconteceu algo legal, você aperta e o que **já passou** fica guardado.

- **Como salvar:** **Ctrl+Shift+C** (dá para trocar em [Voz e atalhos](#voz-e-atalhos); funciona com o jogo na frente), a **tesoura** na barra de cima da transmissão ou **Salvar clipe da transmissão** no [ícone da bandeja](#ícone-na-bandeja).
- **Quanto tempo:** 15 s, 30 s (padrão), 1 min ou 2 min, em **Voz e atalhos › Clipe**. Mais tempo usa mais memória (2 min em 1080p: uns 100 a 200 MB por transmissão).
- **Qual transmissão:** a que está em destaque; sem destaque, a que você assiste. A sua própria transmissão também vale: transmitindo seu jogo, o atalho salva a sua jogada (com placa NVIDIA, mesmo sem ninguém assistindo; nas outras, só com alguém assistindo).
- **Onde fica:** `Vídeos\Tela P2P\Clipes`, em MP4, com o nome de quem transmitia e a hora. O aviso tem **Mostrar na pasta**.
- **Som:** o som da transmissão (o jogo, a música) vai junto. A voz da call só entra com **Gravar a voz da call nos clipes** ligado (em **Voz e atalhos › Clipe**, desligado por padrão): aí vai o que você ouve na voz, no volume que você deu a cada um, e o seu microfone (mutado não entra). Avise quem está na call. No [modo gamer](#modo-gamer) a voz não é gravada.
- **Qualidade:** no modo **Uma vez só** (o padrão), a mesma que chegou para você, sem perder nada. No modo **Uma por pessoa**, o app codifica o vídeo de novo só para o clipe: pela placa de vídeo no tamanho que chega ou, sem ela, pelo processador em até 720p a 30 quadros, para pesar pouco. O clipe começa no último quadro inteiro antes do tempo escolhido: pode ter alguns segundos a mais.
- **Vídeo pausado não entra:** com o app minimizado ou coberto pelo jogo, o vídeo de quem você assiste para de chegar, e o clipe recomeça quando ele volta. Para clipar alguém enquanto joga, deixe a transmissão numa [janela flutuante](#janela-flutuante).
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
- **Organização:** cada linha fica no formato do console do jogo, "21:02 Nome : mensagem", com o nome na cor da pessoa. Mensagens seguidas da mesma pessoa ficam juntas, sem repetir o nome. As que chegam enquanto você não está olhando ganham a linha "N mensagens novas" e o botão "Ir para as mensagens novas".
- **Arquivos:** use o clipe, arraste para o chat ou cole com **Ctrl+V** (um print da tela ou um arquivo copiado), até 200 MB. O print colado ganha um nome com a hora, tipo `imagem-colada-21-07-45.png`.
  - **Baixar:** quem clica em **Baixar** recebe direto de quem mandou, vê a barra de progresso (dá para cancelar) e depois clica em **Salvar**.
  - **Imagens pequenas** aparecem sozinhas.
  - **Imagens** aparecem só como a imagem, sem o nome e o tamanho do arquivo. Com o mouse em cima (ou com o foco pelo Tab), aparece o selo **Só nesta sala**. Para salvar uma imagem, clique nela e use **Salvar** na imagem grande.
  - **Disponibilidade:** o arquivo fica disponível enquanto quem mandou estiver na sala.
- **Histórico:** quem entra depois vê as últimas 100 mensagens.

## Chat por cima do jogo

O botão da barrinha da direita com a tela e as linhas de texto (acima do modo gamer) abre o chat numa janela transparente, sempre por cima, até do jogo (em janela sem bordas).

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
- **No seu perfil** (clique no seu nome na voz), **Microfone** e **Fone** ficam lado a lado; desligado ou silenciado, o botão
  fica laranja e mostra "Desligado" ou "Silenciado" embaixo.
- **No perfil dos outros**, ao lado do nome aparecem ícones: microfone riscado (microfone desligado) e fone riscado (fone
  silenciado), em laranja, e um alto-falante com X, em cinza, se você silenciou a pessoa. Passe o mouse para ver o que é.
- **Quem está transmitindo**, no perfil, ganha um anel azul e o selo **Ao vivo** na foto, e uma barra no pé do perfil
  ("Rafa está transmitindo") com o botão **Assistir** (ou **Parar**, se você já está assistindo).
- **Quem está falando** ganha 3 barrinhas verdes que mexem ao lado do nome, sem texto. Isso aparece na lista de pessoas, na tela dessa pessoa (a borda pisca em verde), nas janelas flutuantes e no chat por cima do jogo. Microfone desligado aparece com um ícone laranja.
- **Volume de cada pessoa:** o botão de volume ao lado do nome abre um cartão com:
  - **Voz** (0 a 200%, para ouvir quem tem o microfone baixo);
  - **Som da transmissão** (0 a 100%, começa em 0%);
  - **Silenciar para mim** e **Voltar ao padrão** (voz em 100% e a transmissão sem som).

  Só muda o que você ouve. O botão mostra o valor quando não está no padrão. O app lembra o volume de cada pessoa para a próxima sala: pela conta Razze dela (vale mesmo se ela trocar o nome na sala ou o nick da conta); sem conta, pelo nome da sala.
- **Painel recolhido:** na barra de baixo, ao lado de **Entrar na voz**, ficam até três fotos de quem está na voz (quem fala acende em verde) e quantos são ("6 na voz"). Clicar abre uma lista para cima com cada pessoa (clicar nela abre o volume; a roda do mouse em cima também muda), **Entrar na voz** (se você está fora) e **Abrir o painel da voz**. Esc ou um clique fora fecha.
- **Roda do mouse:** em cima do nome na barra da voz ou do botão de volume na lista, muda a voz da pessoa (ou o som da tela, se ela não estiver na voz), de 5 em 5%. Em cima da tela da pessoa ou da janela flutuante (no modo de ajuste), muda o som da tela. Um balãozinho mostra o valor.
- **Sons da voz:** dois tons subindo quando alguém entra na voz (ou você), dois descendo quando sai, e um toque curto quando você muta ou desmuta o microfone. Os de quem entra e sai só tocam enquanto você está na voz; quem muta do outro lado e o apertar para falar não tocam. O som e o volume de cada um ficam em **Configurações** (a engrenagem no topo).
- **Microfone negado:** se o Windows negar o microfone, permita o acesso para aplicativos de desktop nas configurações de privacidade.
- **Voz e transmissão juntas:** se a captura que exclui o som do app falhar durante a conversa, a tela é transmitida sem áudio do PC, para não retransmitir as vozes. Se uma transmissão já estiver capturando todo o som do PC, pare, entre na voz e recomece a transmissão.
- **Como funciona:** a voz usa WebRTC direto pela Radmin, uma conexão por par de pessoas, sem servidor. Usa o microfone padrão.

### Subsalas de voz

No painel **Chat de voz**, a voz fica dividida em canais: a **Voz geral** e as subsalas.

- **Criar:** fora da voz, clique em **+ Nova subsala**, ao lado de **Entrar na Voz geral**; na voz, em **+ Subsala**, na faixa de baixo do painel. Na voz, o **Sair** (vermelho) fica no título do painel, ao lado de Lista e Mapa. A subsala é criada e você já entra nela. Os nomes são sempre `Subsala_1`, `Subsala_2`, e assim por diante: a nova recebe o número seguinte ao da maior que existe.
- **Entrar:** clique na faixa com o nome do canal. Fora da voz, isso liga o microfone já naquele canal; na voz, você muda de canal sem sair.
- **Quem ouve quem:** só quem está no mesmo canal se ouve. O chat de texto e as transmissões continuam valendo para a sala toda.
- **Apagar:** o **X** ao lado da subsala. Quem estava nela volta para a Voz geral.
- **Mudar alguém de canal:** arraste a pessoa (ou você) até outro canal. Qualquer um pode mover quem está na voz; o app da pessoa troca de canal sozinho. Precisa do host (ou do servidor da VPS) na versão nova; sem isso, só dá para arrastar você mesmo.
- **Lista ou Mapa:** os dois ícones ao lado do título (três linhas para a Lista, um planeta para o Mapa) trocam a visão (fica salva neste PC). No **Mapa**, cada canal é um sol e quem está nele orbita como planeta. Cada canal com gente fica numa nebulosa de fumaça com a cor dele, e embaixo do nome aparece quantos estão nele. Quem fala solta ondas verdes, quem transmite solta ondas na cor de destaque e o canal com música solta notinhas. Ao fundo, uma galáxia em espiral gira bem devagar. Com o mouse em cima de um canal, os anéis e a nebulosa dele acendem e o sol cresce; em cima de uma pessoa, o planeta cresce e aparece uma linha até o sol. Quem entra chega como cometa, quem sai escapa da órbita, quem muda de canal faz um arco até o outro sol, quem começa a transmitir solta um anel, e a subsala nova acende com uma onda (a que é apagada se apaga). Com o Nebula fora de foco, só as órbitas continuam se mexendo. Clicar no sol abre um cartão preso a ele: o nome do canal, com quantos estão nele e quantos ao vivo (clicar no nome entra no canal), a música (no seu canal sem música, a linha tracejada **Sem música · Pôr uma**) e, numa subsala, o **X** de apagar. Embaixo, quem está no canal: quem transmite tem **AO VIVO** e o olho de **Assistir**; clicar na pessoa abre o perfil dela (volume e amizade). Esc ou um clique no mapa fecha; arrastar o planeta até outro sol muda a pessoa de canal. A roda do mouse (ou **+** e **−**) aproxima até caber uma subsala e afasta até ver todas; arrastar o fundo anda pelo mapa.
- **Mapa grande:** com o chat e a voz na barra da direita, deixe o mouse parado no mapa: o chat encolhe e o mapa ocupa a barra toda. Do chat fica uma faixa em cima, com as mensagens novas; clicar nela traz o chat de volta. Tirando o mouse do painel de voz, o chat volta sozinho (menos enquanto você põe uma música, mexe no volume de alguém ou está no perfil de alguém). O **alfinete** ao lado de Lista e Mapa fixa o mapa aberto até você soltar. Com o chat e a voz abertos juntos, arraste o puxador entre os dois para mudar o tamanho de cada um (ou use as setas com ela selecionada); o tamanho fica salvo, e o clique duplo na linha volta ao automático. A seta ao lado do título recolhe o chat ou a voz numa faixa (o chat recolhido mostra as mensagens novas) e o outro ocupa a coluna toda; clique na faixa ou na seta para abrir de novo. Com o mouse dentro da órbita mais de fora de um sol, as órbitas dele param; as outras seguem girando; com o Nebula fora de foco, o céu em cima da Lista não é desenhado (o Mapa continua girando).
- **Pessoa no mapa:** clicar num planeta abre o mesmo cartão de perfil da lista, subindo do pé do painel de voz (o mapa continua à vista em cima). Em volta da foto ficam, só com o ícone (o nome aparece ao parar o mouse em cima), **Assistir**, **Perfil** (volume e amizade), **Silenciar para mim** e **Mudar de canal**, e ao lado o canal, o nome e o volume da voz dela. No seu planeta: microfone, fone e **Mudar de canal**. O **X**, Esc ou um clique fora da faixa fecha. Na **Lista**, clicar na linha de quem está na voz (foto, nome ou estado) transforma o painel de voz na página da pessoa: o fundo do perfil em cima (ou a cor dela), a foto grande, o nome, o canal e as ações com nome (**Adicionar como amigo**, **Silenciar para mim**, **Mudar de canal**; no seu, microfone e fone), mais o volume. O **X** ao lado do nome, Esc ou um clique fora do painel volta para a lista. Se a pessoa escolheu um **fundo do perfil**, ele aparece atrás, só dentro da faixa ou da caixinha.
- **Os nomes da pessoa:** quem está na conta Razze aparece no perfil com os dois nomes: **Nome na sala** (o que ela escolheu no app) e **Nome da conta** (o do servidor Razze). Se vocês já são amigos, o nome da conta vem da sua lista; senão, aparece "informado pelo app da pessoa". **Adicionar como amigo** manda o pedido para essa conta, não para o nome da sala (então funciona mesmo com os nomes diferentes ou com outro usuário de mesmo nome). Com um host ou servidor da sala em versão antiga, a conta não chega e vale o nome da sala, como antes.
- **Céu na Lista:** na Lista, o céu pequeno em cima é só enfeite. Para escondê-lo ou mostrá-lo, use **Configurações › Aparência › Céu da voz em cima da lista**. O Mapa não muda.
- **Troca de host:** as subsalas continuam, e cada um fica no canal em que estava.
- **Modo Internet:** o servidor da VPS precisa estar atualizado para ter subsalas; sem isso, o painel mostra só a lista de sempre.

### Música junto (YouTube)

Uma música por canal (Voz geral ou subsala), que todo mundo ouve junto, no mesmo ponto.

- **Pôr:** no cabeçalho do canal em que você está (fora da voz, a Voz geral), clique na **nota musical** e cole o link de um vídeo do YouTube (`youtube.com/watch`, `youtu.be`, `shorts` ou `music.youtube.com`). A tela da música abre para você.
- **Pelo chat:** escreva `/musica` e o link (ou `/tocar`). Antes de mandar, aparece a prévia do vídeo (capa e título) e onde ele vai tocar; **Enter** põe a música no seu canal, ou troca a que está tocando. Só `/` mostra os comandos; texto com `/` que não é comando vai como mensagem normal.
- **Ouvir:** a música aparece no canal, depois de quem está nele, no painel de voz (e no balão do sol, no Mapa), com **Ouvir**. Ela vira uma tela no palco, ao lado das transmissões: dá para pôr em destaque, tela cheia e arrastar. Os controles dela (tocar, pausar, o progresso, Trocar e Parar) ficam embaixo, por cima do vídeo, e somem junto com a barra de cima quando o mouse fica parado. As legendas do YouTube vêm desligadas; o botão **CC**, na barra de cima, liga e desliga (só para você, e fica salvo). Ao ligar, o player recarrega no mesmo ponto da música (1 a 2 s). Com **Configurações › Aparência › Luz ambiente** ligada, as barras em volta do vídeo pegam as cores dele, como nas transmissões; com o app fora de foco (no jogo), elas param de atualizar.
- **Música esquecida sai sozinha:** pausada por mais de 4 minutos, ou 1 minuto sem ninguém no canal dela e sem ninguém ouvindo (tocando ou não), a sala tira a música.
- **Controles de todos:** tocar e pausar, o ponto da música, **Trocar** e **Parar a música** valem para todo mundo. Só quem está naquele canal (ou quem pôs a música) controla.
- **Só seus:** o volume (fica salvo neste PC) e o **X**, que para de ouvir sem parar para os outros.
- **Como funciona:** cada pessoa toca no player oficial do YouTube, no próprio PC; a sala só combina o que tocar e em que ponto. Cada um vê os próprios anúncios.
- **Fim:** quando a música acaba, ela sai sozinha e o canal fica livre para outra.
- **Live do YouTube:** o progresso e o contador dão lugar ao selo **Ao vivo** e cada um assiste na ponta da transmissão, sem pausas para acertar o ponto. Tocar, pausar, **Trocar** e **Parar** continuam valendo para todos; a live não sai sozinha.
- **Vídeo que não toca:** quem publicou pode não deixar tocar fora do YouTube; a tela avisa para trocar por outro.
- **Modo Internet:** o servidor da VPS precisa estar atualizado; sem isso, a nota musical não aparece.

## Primeira entrada

Na primeira vez que o app abre, uma tela de cada vez (três no máximo):

1. **Como você quer usar?** *Com amigos* (conta, lista de amigos, ligar com um clique) ou *Sala rápida* (só um nome, sem conta).
2. **Quem é você?** O nome (obrigatório), a foto (opcional) e se o perfil mostra o jogo e a música (os dois vêm marcados).
3. **Sua conta** (só em *Com amigos*): entrar ou criar conta com e-mail e senha. **Continuar sem conta por enquanto** leva
   direto ao Início. Se o servidor exigir aprovação da conta, o app avisa e você usa como sala rápida até ser aprovado.

Quem já usava o app não vê essa tela. Quem escolheu *Com amigos* e ainda não entrou vê no Início uma faixa **Entrar na conta**.

No **Início**, com conta: **Amigos online** (até 5, com **Mensagem** e **Ligar** em ícones), **Convidar** (um menu com **Copiar meu link** e **Adicionar amigo**) e **Ver todos** (abre o envelope na aba **Amigos**).
Cada amigo mostra em etiquetas onde está, o jogo e a música (clique na música para ver a faixa). Passando o mouse na linha
aparece **Chamar para minha sala**: manda o convite da sala em que você está pelas mensagens; fora de sala, abre a sua antes.

O topo diz **Bom dia/Boa tarde/Boa noite** e o seu nome (o lápis ao lado muda o nome; sem nome, aparece o campo), com um
resumo do momento: quantos amigos estão online, quem está jogando ou quem abriu uma sala. Ao lado, numa janela larga,
uma constelação parada: você no meio e os amigos online em volta; quem está numa sala brilha na cor de "ao vivo".
No modo Internet, **Abrir minha sala** diz quais amigos online vão ver a sala; as opções da sala ficam no ícone ao lado.
**Última sala** mostra de quem era, quando e o modo (o endereço fica na dica), e a barra de baixo mostra a última conversa:
clicar abre ela.
**Abrir minha sala** cria a sala em um clique (com senha gerada e visível para os amigos); **Opções da sala** abre a tela
de antes, com porta, senha e visibilidade.

## Senha e frase do perfil

- **Entrar com Google:** no passo 3 da primeira entrada e no **Perfil**, em **Conta Razze**, **Entrar com Google** abre o navegador, você escolhe a conta
  e volta ao app. O botão só aparece se o servidor tiver o Google ligado. Se já existe uma conta com o mesmo e-mail e senha, o app avisa:
  entre com a senha e use **Vincular Google** (Perfil › Conta Razze). **Desvincular Google** só funciona se a conta tiver senha;
  quem entrou só pelo Google define a primeira senha em **Trocar senha**, sem precisar da atual.
- **Servidor só com Google:** quando o administrador liga essa opção, o passo 3 e o Perfil › Conta Razze mostram só **Entrar com Google** (sem formulário de e-mail e senha, e sem **Criar conta**). Quem já tinha conta com senha toca em **Tenho uma conta com e-mail e senha** para entrar como antes. Conta nova de um e-mail que não está na lista de convidados fica **pendente**: avise o administrador e, depois que ele aprovar, toque em **Entrar com Google** de novo. Sem conta, o app continua funcionando por código e senha da sala.
- **Administração (só administradores):** em Perfil › Conta Razze, na sua conta, o botão **Administração** abre uma tela com **Visão geral** (online agora, ativos em 1, 7 e 30 dias, pico, contas novas, quem voltou, amizades, mensagens, versões em uso e 14 dias de gráfico), **Pedidos** (aprovar ou recusar contas pendentes), **Convidados** (e-mails que entram direto, com grupo Amigo, Teste ou Administrador), **Pessoas** (filtro Todos, Amigos, Teste, Admin, Pendentes e Desativados; mudar grupo, tornar administrador, desativar; quem ainda não vinculou o Google aparece com **Sem Google**: vincule todos antes de desligar a senha antiga), **Feedback** (o que chegou pelo ícone de feedback: filtro Abertos, Bugs, Sugestões, Avaliações, Resolvidos e Todos; ver o print, marcar como Novo, Visto ou Resolvido e apagar; o número na aba conta os novos) e **Servidor** (interruptores de só Google, senha antiga, aprovação e lista de convidados). Quem não é administrador não vê o botão, e o servidor recusa as chamadas dele.
- **Trocar a senha:** Perfil › Conta Razze › **Trocar senha** (pede a senha atual; mínimo 8 caracteres).
- **Esqueci a senha:** na tela de entrar (Perfil › Conta Razze ou o passo 3 da primeira entrada), **Esqueci a senha**. O servidor não
  manda e-mail: peça um código ao **administrador**, que o gera em Perfil › Conta Razze › **Administração › Pessoas** (botão **Código de senha**; também no painel web `/admin/`). Digite o e-mail, o
  código (vale 1 hora e funciona uma vez) e a senha nova. Depois de redefinir, o app já entra na conta sozinho.
- **Excluir uma conta (administrador):** Administração › Pessoas › **Desativar** e, na linha da conta desativada, **Excluir**. Apaga também
  as amizades, mensagens e salas dela e não dá para desfazer. O app pergunta se o e-mail sai da lista de convidados; sem isso, a pessoa
  cria a conta de novo ao entrar com o Google. Cada pessoa mostra **Google** ou **Só senha**, para ver quem ainda não vinculou.
- **Frase do perfil:** no seu perfil, **Frase** (até 128 caracteres). Os amigos veem embaixo do seu nome no Início, e quem está na sala vê no seu cartão (ao abrir o seu perfil na voz); ela só passa entre os dois, na hora em que o cartão abre. Sem conta,
  ela fica salva neste PC e vai para o servidor quando você entrar.

## Feedback e bugs

O balão com exclamação na barrinha da direita, logo acima da engrenagem, abre **Fale com a gente**. Precisa estar com a conta Razze entrada (Perfil › Conta). São três abas:

- **Reportar bug:** onde aconteceu (Chat, Voz, Transmissão, Música, Mapa, Conta e login ou Outro), o que deu errado, como fazer acontecer de novo (opcional), com que frequência e quanto atrapalha. Dá para anexar um **print**: cole com Ctrl+V, arraste para a caixa ou clique para escolher. O app reduz a imagem antes de mandar.
- **Sugestão:** qual é a ideia, que problema ela resolve, a parte do app e quanto você usaria.
- **Avaliar o app:** a nota de 0 a 10 (quanto você indicaria para um amigo), o que você mais usa, o que mais gosta e o que mais incomoda.

No rodapé, **Enviar dados técnicos** (marcado) manda a versão do app, o sistema, o tema e se você estava numa sala; **Pode me chamar para tirar dúvidas** avisa o administrador que ele pode falar com você sobre isso. Clicar de novo numa opção marcada desmarca. Dá para mandar até 5 por hora. Quem lê é o administrador, na aba **Feedback** da Administração.

## Atividade no perfil

Em **Configurações › Atividade** (ou pelo botão **Configurar a atividade** em Seu perfil), cada coisa que aparece no seu perfil é
uma escolha sua. O jogo e a música vêm **ligados por padrão** (dá para desligar já na primeira entrada, no passo **Quem é você?**,
ou aqui a qualquer hora); os jogos da Steam só aparecem depois que você marca cada um:

- **Mostrar o jogo que estou jogando:** o app reconhece o jogo pelo nome do programa aberto, numa lista de jogos conhecidos (Valorant,
  Counter-Strike 2, League of Legends, Fortnite, GTA V e outros; a lista está em `main/atividade.js`). Programa que não está
  na lista não aparece, e nenhum outro nome de programa sai do PC.
- **Jogos da Steam:** o app lê os jogos instalados na sua Steam e mostra cada um com a imagem da sua biblioteca. Você marca quais
  podem aparecer, vários de uma vez (**Marcar todos**, **Mostrar os marcados**, **Não mostrar nenhum**), e muda quando quiser em
  **Seus jogos**. Jogo que você não marcou não aparece. Quando o app acha um jogo novo, um aviso pergunta se você quer mostrar
  (**Escolher** abre essa tela). Vale para jogo aberto pela Steam; no perfil, ele aparece com a imagem dele. Ferramentas da
  Steam que não são jogos (redistribuíveis, Proton) ficam de fora.
- **Mostrar a música que estou ouvindo (Spotify e outros players):** lê o que está tocando nos controles de mídia do Windows (os
  mesmos da tela de volume), com a capa do álbum, só quando está tocando. Vale para Spotify, Apple Music, Deezer, TIDAL, Amazon
  Music, Windows Media Player, foobar2000, MusicBee, AIMP e outros players de música; o que toca no navegador não aparece.

Embaixo das caixinhas, o app mostra **o que os amigos veem agora**. Só os amigos aceitos veem, no Início: "Jogando Valorant" ou
"Ouvindo Metallica"; **clicar em "Ouvindo…" mostra a música**. Some em até 2 minutos depois que você para ou desliga. Para os
amigos precisa de conta; sem conta nada vai ao servidor. Vale no Windows.

Numa sala, quem está nela também vê (com ou sem conta): no seu perfil aparece a caixa **Ouvindo agora** (a capa, com um disco de vinil saindo dela e girando, a faixa, o artista e o álbum; pausou, o disco volta para dentro da capa, a caixa diz **Pausada** e some depois de 3 minutos; no modo gamer e com "reduzir movimento" do Windows o disco fica parado; com o mouse em cima aparece o nome inteiro, e clicar abre a música no Spotify, pelo navegador) e
**Jogando** (o nome do jogo, há quanto tempo você joga e, se a Steam estiver rodando esse jogo, a imagem dele, mesmo sem marcar o jogo na lista da Steam), e na sua linha da lista vem a música (com a capinha) ou o jogo embaixo do nome; com os dois, a linha mostra a música
e um controle azul, junto dos ícones de microfone e fone, avisa que você está jogando (o nome do jogo aparece com o mouse em cima). Passa direto de PC para PC, não fica guardado e atualiza em até 30 s.

## Amigos

No **envelope**, no começo da barra de baixo, aba **Amigos** (ao lado de **Conversas**). Precisa de conta Razze: sem ela,
o envelope não aparece e a conta se faz no **Perfil**, em **Conta Razze**. Pedido de amizade que chegou aparece também em
cima das conversas e no número do envelope; clicar leva para **Pedidos**. O **balão** ao lado do nome abre a conversa.

- **Buscar:** o campo do topo filtra a lista pelo nome. Os chips **Todos**, **Online** e **Pedidos** mudam o que aparece; o número no **Pedidos** conta os pedidos recebidos e enviados.
- **Adicionar:** clique em **Adicionar**, digite o nickname exato e **Enviar pedido** (ou Enter). Se der errado, o motivo aparece embaixo do campo. Quando der certo, o pedido vai para **Pedidos enviados**.
- **Copiar meu link:** no Início (**Copiar meu link**) ou no formulário de **Adicionar** (**Copiar meu link de convite**). O app
  copia uma mensagem pronta com o link e o código curto e avisa até quando vale (7 dias, 1 pessoa; até 5 links ativos).
  Os links ativos aparecem no formulário de Adicionar, cada um com **Revogar**.
- **Convite por link:** quem recebe o link (`https://…/a/…`, ou o `telap2p://amigo/…`) abre o app, vê "**Fulano quer ser
  seu amigo. Aceitar?**" e, aceitando, os dois viram amigos na hora. Sem conta, o app leva para a tela de conta e retoma o
  convite depois de entrar. Quem não tem o app instalado baixa pela página do link e depois **cola o link ou o código**
  (`ABCD-EFGH-JK`, com os hífens) no campo de **Adicionar**. Cada link vale 7 dias e 1 pessoa. Se o servidor ainda não
  tem links de amigo, o app avisa e o nickname continua funcionando.
- **Ligar:** o **telefone** ao lado do balão (só com o amigo online). Veja [Ligar](#ligar).
- **Convidar:** aparece só para quem está online, com você numa sala. Manda um **convite** nas mensagens diretas do
  amigo, que aparece como um cartão com **Entrar** (veja abaixo).
- **Remover:** no **⋯** da linha, **Remover [nome]**. A própria linha pergunta se é isso mesmo; **Não** ou Esc desiste.
  Remover desfaz a amizade dos dois lados: some também da lista do outro, sem precisar reabrir o app.
- **Em que sala o amigo está:** no lugar de "Online", aparece "Na sala de Ciclano · Radmin · 4 pessoas" (ou "na voz"), em qualquer modo e mesmo que o amigo não seja o host; na mesma sala que você, "Na sua sala". Também nos **Amigos online** do Início. É só para saber onde ele está: não vai endereço, e para entrar continua o convite ou o endereço. Quem não quer mostrar desliga em **Configurações › Atividade › Mostrar aos amigos em que sala estou** (ligado por padrão). Salas escondidas e chamadas não aparecem.

## Mensagens diretas

Conversa com um amigo (conta Razze), dentro ou fora da sala.

- **Criptografadas de ponta a ponta:** só você e o amigo leem. O servidor Razze (e quem cuida dele) vê só texto
  embaralhado. Cada PC tem a própria chave, guardada com a proteção da sua conta do Windows; o histórico neste PC
  também fica protegido.
  - **Amigo numa versão antiga:** a mensagem não sai. A janela avisa que ele precisa atualizar o Nebula, e o texto
    volta para o campo.
  - **Chave trocada:** quando o amigo troca de PC ou reinstala o app, a conversa avisa "A chave de segurança de
    [nome] mudou". Se não foi isso, confirme com ele por outro meio.
  - **"Não dá para abrir aqui":** a mensagem foi cifrada para outro PC da sua conta (ou para este PC antes de uma
    reinstalação). Cada PC só lê o que chegou para a chave dele.
  - **"sem criptografia":** marca as mensagens de antes, que o servidor ainda guarda por até 30 dias.
- **Clicar fora** da janelinha minimiza a conversa. O **alfinete** no chip trava a janela aberta (clique de novo
  para destravar). A escolha fica salva.

- **Convite para a sala:** o **Convidar** da aba Amigos manda um cartão "Convite para a sala de [nome]", com
  quantas pessoas estão, o modo e um **Entrar**. Só entra quando você clica, nunca sozinho.
  - **Pela internet:** entra direto, sem senha (o convite leva um passe que só abre aquela sala enquanto quem
    convidou está nela). Se o passe não valer mais, abre o **Entrar com código** já preenchido para a senha.
  - **Radmin ou Razze:** preenche o endereço e entra; se a sala tiver senha, pede a senha (ela nunca vai no
    convite). Na Razze, precisa estar com a mesma rede ligada.
  - **Outro modo:** se você estiver em outro modo (por exemplo, na Radmin e o convite é pela internet), o cartão
    avisa qual usar, em Configurações › Rede. O app não troca o modo sozinho.
  - **Já numa sala:** pergunta se quer sair dela e entrar na do amigo.
  - **App antigo:** quem ainda não atualizou vê o convite como texto, com o código ou o endereço, e entra à mão.

### Ligar

O **telefone** no chip da conversa (ou ao lado do nome, na aba **Amigos** do envelope) liga para o amigo.

- **A única escolha:** o modo de rede (Internet, Radmin ou rede local, Razze). Vem marcado o que você usa agora; o
  que não está pronto (sem servidor, sem conta Razze, VPN desligada) aparece desativado, com o motivo.
- **O app faz o resto:** passa a usar esse modo, cria uma sala **escondida** (fora da lista de sessões e da lista dos
  amigos) com uma **senha gerada** (como `K7P-4MX-Q2R`), te põe na voz e manda a chamada pela mensagem privada. A
  senha vai junto, porque a mensagem é criptografada de ponta a ponta. Já numa sala, pergunta antes de sair dela.
- **Quem recebe:** o aviso "[nome] está te ligando" com **Atender** (e um som), mesmo com a conversa fechada, e o
  cartão na conversa. Depois de 10 minutos o cartão vira "Chamada de [nome]", com **Entrar**.
- **Atender:** entra com a senha da mensagem e vai direto para a voz. Se você estiver em outro modo, pergunta antes
  de trocar. Na Razze, precisa estar com a mesma rede ligada.
- **Os dois veem a senha** no Painel da sala (botão de pessoas), para passar a outra pessoa ou mudar.
- **App antigo:** vê o convite comum, e o texto da mensagem traz o código ou o endereço e a senha.

- **Abrir:** clique no **envelope**, no começo da barra de baixo: o painel abre para cima na aba **Conversas**, com busca, a última mensagem e as não lidas. Ou, na aba **Amigos** do mesmo painel, no balão ao lado do nome.
- **Barra de conversas:** fica embaixo da tela. Cada conversa aberta vira um chip. Clicar no chip abre a janela; o **—** minimiza de volta para o chip; o **X** tira da barra.
- **Muitas conversas:** as que não cabem na largura vão para o **+N** no canto direito (fica destacado se alguma tem mensagem não lida). Clicar nele lista as escondidas; escolher uma traz ela de volta para a barra.
- **Ordem:** arraste um chip para a esquerda ou para a direita de outro (ou **Alt+←** / **Alt+→** com ele selecionado). A ordem fica salva.
- **Histórico:** fica salvo neste PC, um arquivo por amigo. Fechar a conversa no X não apaga nada: ao abrir de novo, tudo volta.
- **Conexão direta:** com os dois online, abrir a conversa liga uma conexão direta entre os PCs, só da conversa (não tira ninguém da sala em que está). A linha acima do campo diz o modo: **Conexão direta** (texto e arquivos vão direto) ou **Pelo servidor** (só texto, criptografado). Funciona com a Razze, a Radmin e a rede local; no modo Internet, com o STUN do servidor da aba Rede (atrás de algumas redes, não dá e fica pelo servidor).
- **Amigo offline:** a mensagem fica no servidor Razze por até 30 dias e chega quando ele abrir o app.
- **Prazo do histórico** (Configurações › **Mensagens privadas**): **Guardar para sempre** (padrão) ou **Apagar depois de 30 dias**. Vale só para este PC; com 30 dias, o que passou do prazo (mensagens e imagens guardadas) sai na hora.
- **Backup no celular:** na mesma aba, **Levar as mensagens no backup do celular** (desligado por padrão). Ligado, o **Guardar no celular** leva o texto das conversas da conta Razze, cifrado com a senha do backup (imagens e arquivos não vão). Ao trazer, se for a mesma conta Razze, junta com o histórico deste PC sem apagar nada. O arquivo tem até 16 MB: passando disso, vão as mensagens mais novas e o app avisa.
- **Mensagem nova:** a conversa aparece na barra, minimizada, com o número de mensagens não lidas. O total aparece no envelope da barra.
- **Arquivos e imagens:** pelo clipe, colando (Ctrl+V) ou arrastando para a janela, até 200 MB, sem metadados (como no chat da sala). Só pela conexão direta: arquivo nunca passa pelo servidor, então sem ela o clipe fica apagado. Imagem de até 8 MB chega sozinha, aparece na conversa e fica guardada, protegida, neste PC; outro arquivo chega com **Baixar**, que traz direto do PC de quem mandou enquanto o app dele estiver aberto, e depois **Salvar**.

## Voz e atalhos

Fica nas **Configurações** (a engrenagem), no grupo **Voz e atalhos**, com as abas **Voz** e **Atalhos**. 

- **Testar o microfone:** **Ouvir minha voz** toca no seu fone o som do seu microfone, do jeito que a sala ouve: depois da supressão de ruído e da sensibilidade. Funciona fora da voz (abre o microfone só para o teste) e dentro dela; na voz, desligue o microfone para testar sem os outros ouvirem. Dá para mexer nos filtros enquanto ouve. Use fone de ouvido: com caixa de som, o microfone pega o próprio som e apita. O teste para ao fechar a janela.
- **Supressão de ruído:**
  - **Avançado** (padrão): passa sua voz pelo [RNNoise](https://github.com/xiph/rnnoise), uma IA que roda no seu PC e tira teclado, ventilador, barulho da rua e respiração.
  - **Básica:** o filtro do Chrome, só para chiado constante.
  - **Desligada.**
- **Cancelamento de eco:** tira da sua voz o que sai das suas caixas (as vozes dos outros e o som das telas). Com fone, pode desligar. Dá para trocar este e o anterior no meio da conversa, sem sair da voz.
- **Sensibilidade do microfone:** abaixo do limite, o microfone fica fechado, e o barulho baixo entre as falas não passa.
  - **Automática** (padrão): mede o ruído de fundo e fica 12 dB acima dele. O ruído vem das pausas entre as falas (os últimos ~4 s), então falar sem parar não faz o limite subir e cortar sílabas. Um barulho novo e constante (ventilador, ar-condicionado) passa a contar como ruído em uns 3 s. Ao abrir o microfone, ele se ajusta ao ambiente em meio segundo, começando do último ruído medido naquele microfone. Com a supressão por IA, o limite nunca fica abaixo de −60 dB, para que qualquer estalo não abra o microfone, e a IA também diz se o som é voz: barulho alto que não é voz não abre, e voz clara abre um pouco antes do limite, sem cortar a primeira sílaba. Embaixo do medidor aparece o **Ruído do ambiente** medido (o som antes da IA).
  - O microfone abre no limite e só fecha 3 dB abaixo dele, depois de 300 ms: perto do limite ele não fica abrindo e fechando (vale também no manual).
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

Fica nas **Configurações**, no grupo **Estatísticas** (abas **Desempenho** e **Transmissão**). Os números só são medidos com o grupo à vista.

- **Medição:** enquanto você está numa sala, o app mede tudo uma vez por segundo, com a janela aberta ou não, e guarda os últimos 10 minutos. Dá para jogar e abrir depois para ver como foi.
Tem duas abas: **Desempenho** e **Transmissão**.

### Desempenho

- **Cada cartão** mostra o número de agora, a **média dos últimos 30 s** com mínimo e pico, e um **gráfico dos últimos 10 minutos**. A faixa no fim do gráfico marca os 30 s da média.
- **À vista:** quanto o app usa do **processador** e da **placa de vídeo**, e quanto está **enviando** e **recebendo** pela rede (Mbps). São os mesmos números do Gerenciador de Tarefas.
- **Mais detalhes** (fechado, clique para abrir): codificação e decodificação de vídeo (com a média do PC inteiro, que inclui o jogo), quadros capturados e enviados, o codificador de verdade (por exemplo, "H.264 com OpenH264 (processador)"; para quem só assiste, o Chromium não diz qual é o decodificador) e cada processo do app com a memória de vídeo.
  - Se "capturados" cai durante o jogo, a placa de vídeo estava ocupada.
  - Se "enviados" cai e "capturados" não, o problema é a internet ou a codificação.
- **Codificação alta com o app parado:** se "Codificação de vídeo, PC inteiro" estiver alta, é outro programa usando o codificador da placa (ex.: o Replay Instantâneo da NVIDIA ou uma live do Discord).

### Transmissão

Um cartão para cada pessoa que está transmitindo (você primeiro, se estiver):
- **Configuração de quem transmite:** a qualidade escolhida, a codificação (uma vez só para todos ou uma por pessoa, e se é pela placa de vídeo) e se o som do PC vai junto.
- **O que chega até você,** nas telas que você está assistindo: resolução, quadros por segundo, Mbps, codec e pacotes perdidos. Atualiza a cada segundo.
- **A sua transmissão:** quantas pessoas estão assistindo, quadros capturados e o que sai daqui.

A configuração de outra pessoa só aparece se ela e o host estiverem na versão 1.9.0 ou mais nova.

## Tema

Abra **Configurações** pela engrenagem no pé da barrinha da direita. A barrinha fica na borda direita da janela, no início e dentro de uma sala. À esquerda da janela ficam os grupos (**Voz e atalhos**, **Aparência**, **Sons**, **Celular** e **Estatísticas**); em cima, as abas do grupo escolhido. Tema, **Janela e fonte** (transparência e fonte) e Cores ficam juntos em **Aparência**. Cada grupo lembra a última aba aberta.

Prefere tudo do outro lado? **Configurações › Aparência › Espelhar a interface** troca os lados: a barrinha, o chat e a voz vão para a esquerda. O resto continua igual, e a escolha fica salva (trocar de tema não desfaz).

**Largura do chat e da voz:** passe o mouse no vão entre o painel e o vídeo até aparecer uma linha; arraste para alargar ou estreitar (de 300 px até pouco mais da metade da janela). O vídeo se ajusta e a largura fica salva. Dois cliques na linha voltam ao tamanho automático. Pelo teclado: Tab até a linha e as setas.

O botão **Perfil** (no alto da barrinha) abre **Seu perfil**: em cima, uma prévia de como os outros te veem na voz (o fundo, a foto e o nome na fonte escolhida); clicar na foto troca a foto e **Trocar fundo** fica no canto do fundo. Embaixo, **Aparência** (foto, fundo e fonte do nome; a lixeira tira a foto ou o fundo) e **Nome**, que só pode ser editado fora da sala (na sala aparece com um cadeado). Nele também fica o **Fundo do perfil**: uma imagem (recortada em quadrado) ou um GIF de até 1 MB, que aparece atrás do seu perfil para quem clicar em você na voz; **Tirar fundo** volta ao normal. Ao escolher a foto ou uma imagem de fundo, abre o **editor de recorte**: arraste a imagem para enquadrar e use o zoom (roda do mouse, controle, setas e + / -); na foto a bolinha mostra o resultado, e no fundo a faixa tracejada é a parte que mais aparece no cartão. **Ajustar**, ao lado de Trocar, abre de novo o editor com o enquadramento anterior, sem escolher a imagem outra vez (GIF não corta, então não tem Ajustar). O GIF só se mexe com o perfil aberto. Dentro da sala, **Chat**, **Voz** e **Transmissão** ficam logo abaixo deles, num grupo separado, só com o ícone (o nome aparece ao parar o mouse em cima), e são alternadores independentes: clique para exibir ou ocultar cada painel. Chat e voz abrem se desdobrando ao lado da barrinha. Os selecionados permanecem visíveis juntos, dividindo o espaço. Perfil e configurações também podem ficar abertos ao mesmo tempo. Cada painel tem sua própria rolagem quando necessário. A seleção dos três painéis da sala é lembrada ao reabrir o app.

O painel **Voz** mostra os participantes, seus controles de volume e botões para entrar, sair, mutar e silenciar as vozes. Mostrar ou ocultar esse painel não liga nem desliga o microfone. Da mesma forma, ocultar **Transmissão** não encerra uma transmissão em andamento; use o botão **Parar** para encerrá-la.

- **Principal:** fundo do aplicativo.
- **Secundária:** painéis e cartões.
- **Detalhes 1:** botões, seleção e destaques.
- **Detalhes 2:** indicadores de voz, conexão e avisos.

Digite um hexadecimal de três ou seis dígitos, com ou sem `#`, ou use a amostra de cor. A mudança aparece imediatamente, inclusive nas janelas flutuantes abertas. Textos e tons de apoio se adaptam às cores escolhidas. Valores inválidos não substituem a última cor válida. **Restaurar cores padrão** recupera o tema oliva e amarelo, sem alterar os sons.

No tema **Du'Sol** (aba Tema), o fundo é o Sol: um pedaço gigante dele à esquerda, com manchas e a borda brilhando, e o espaço com estrelas no resto. As cores ficam entre o preto, o amarelo e o laranja, e o nome **Du'Sol** aparece como no Arasaka: em pé no saguão, grande no palco sem transmissão e na barra de título. O fundo é parado e some no modo gamer.

O tema **Di'Luna** é o irmão do Du'Sol, com a Lua cheia: um pedaço gigante dela à esquerda, com crateras e a borda acesa em ciano, e a noite com véus roxos e faíscas de luz no resto. As cores ficam entre o branco, o ciano, o azul e o roxo, e os letreiros têm serifa. O nome **Di'Luna** aparece nos mesmos lugares do Du'Sol, em pé do lado de fora da Lua no saguão.
O tema **Renascença** transforma o app numa galeria: o fundo é uma pintura famosa da Renascença (A Escola de Atenas, A Anunciação, A Última Ceia e A Criação de Adão, uma a cada vez que o app abre), com o tom amarelado de verniz antigo e uma etiqueta de museu no canto dizendo qual é. O cartão do Início, o palco e cada transmissão ganham uma moldura dourada entalhada. Créditos das obras em `assets/temas/OBRAS.md`.
O tema **Top Gun** é a cabine de um caça: cada painel vira um MFD, com fósforo verde no preto, moldura de bezel, colchetes nos cantos e letras de painel em caixa alta; o botão principal fica em inverso de vídeo, e os botões de entrar e sair da voz ganham as faixas amarelas e pretas do convés do porta-aviões. Fora da sala, o fundo é preto com o blueprint técnico de um caça em verde (cortes da fuselagem do F-16, F-15 e A-10 e desenhos em 3 vistas do F/A-18 e do F-22; um a cada vez que o app abre), com o nome do avião no canto do Início. Dentro da sala, o fundo é só preto. Na voz, o céu vira um **radar**: anéis de distância, rumos e a varredura girando em volta de você (o canal onde você está na voz; fora dela, a Voz geral); cada pessoa e cada subsala acende quando a varredura passa por ela e vai apagando até a próxima volta (você, quem fala e o seu canal ficam sempre acesos). A varredura gira mesmo com "reduzir movimento" do Windows e para com o app fora de foco e no modo gamer. O tema também troca os sons pelas chamadas de rádio, ditas por pilotos diferentes, só a voz (sem chiado), e com várias falas para cada aviso (o app sorteia uma e não repete a última): **"Radio check"** quando você entra numa sala, **"Fox one/two/three!"** quando alguém entra, **"Splash one."** ou **"Good kill."** quando alguém sai, **"Radio check."** e **"R T B."** quando você começa e para de transmitir, **"Going hot."** e **"Going cold."** ao ligar e desligar o microfone, **"Radio silence."** e **"Loud and clear."** ou **"Five by five."** ao silenciar e voltar a ouvir as vozes, **"Tally ho!"** quando te mencionam e o clique do rádio nas mensagens do chat. Ao trocar para outro tema, os seus sons de antes voltam. Créditos das fotos em `assets/temas/OBRAS.md`.

No tema Padrão, a tela inicial tem um céu ao fundo; de vez em quando (a cada 20 a 90 segundos, ao acaso) uma estrela cadente cruza esse céu. Ela só aparece com a janela do app em foco e não aparece se o Windows estiver com os efeitos de animação desligados.

Na mesma tela, escolha o som de **entrada na sala**, **saída da sala**, **mensagem no chat**, **entrada no chat de voz**, **saída do chat de voz**, **mutar o microfone** e **desmutar o microfone**. Há os oito MP3 incluídos no app e quatro sons **Suave**, gerados na hora pelo próprio app (os padrões da voz e do microfone). Os da voz dos outros só tocam enquanto você está na voz. Os arquivos já vêm dentro do app; não é preciso manter a pasta original ao lado do executável. **Ouvir** toca uma prévia. **Sem som** desativa um evento específico, e **Silenciar som do chat** mantém os outros avisos ativos. A prévia continua disponível com o chat silenciado.

Cada evento tem seu próprio volume de 0 a 100%. O **volume geral dos avisos** multiplica esses valores: geral em 50% e um evento em 40% resultam em 20% para aquele evento. Geral em 0% silencia todos sem apagar os ajustes individuais. Os volumes dos avisos são independentes do volume da voz e das transmissões.

Mensagens enviadas e recebidas fazem som quando chegam confirmadas pelo servidor. Carregar o histórico não faz som. Entrar ou sair da sala também avisa no próprio PC. Na voz, os avisos acompanham a entrada e saída das pessoas: mutar, desmutar ou reconectar alguém que já estava na voz não repete o som. Carregar os participantes existentes também é silencioso. Retornos de participantes já conhecidos durante uma troca de host não repetem o aviso de entrada.

Todas essas escolhas são salvas automaticamente no perfil local do app e continuam ao fechá-lo e abri-lo de novo. Cada pessoa pode usar suas próprias cores e sons.

Fontes do próprio Windows: Segoe UI Variable no app e Tahoma no chat.

## Modo gamer

O controle na barrinha da direita (logo acima da engrenagem) liga o **modo gamer**, para o jogo ter o máximo do PC
enquanto o Nebula fica aberto. Ligado, o controle fica aceso e o app:

- baixa a própria prioridade para **normal** (a escolhida em Transmissão volta ao desligar);
- fica **opaco**, sem o vidro e o desfoque;
- para todas as animações e esconde o céu estrelado do fundo, o céu em cima da lista da voz e a luz ambiente das
  transmissões;
- deixa parado o GIF do fundo do perfil das pessoas.

Voz, chat, música, transmitir e assistir continuam funcionando. As suas escolhas de aparência não mudam: desligar
devolve tudo como era. Fica salvo neste PC.

## Comando de voz (recurso extra)

Controle o app falando, até dentro do jogo. É um recurso extra: fica desligado até você ligar, e só então o app baixa o
que precisa.

- **Ligar:** Configurações gerais (a engrenagem) › **Recursos extras** › **Comando de voz**. O app pede para baixar o
  reconhecimento de fala (Whisper), uns 70 MB no modo **Leve** ou 200 MB no **Preciso** (entende melhor, demora um
  pouco mais). Depois disso funciona sem internet. Desligar não apaga o download; o botão **Apagar o download** apaga.
- **Usar:** numa sala, segure **Ctrl+Shift+V** (dá para trocar em **Voz e atalhos**), fale e solte. Aparece
  **Ouvindo…** em cima da janela e, depois de soltar, **Entendendo…** (cerca de 1 s). Enquanto você segura, a call não
  ouve você. Um toque rápido na tecla (como o Ctrl+Shift+V de colar texto) não faz nada.
  - **Na voz,** pode falar junto com a tecla: o microfone do comando já fica aberto e guarda o último meio segundo, só
    na memória (nada vai para a call nem para o disco; entra no comando só quando você aperta a tecla).
  - **Fora da voz,** o microfone abre quando você aperta (aparece **Abrindo o microfone…**): fale depois do toque.
  - Em **Recursos extras** aparece o último comando que o app ouviu, para conferir o que ele entendeu.
- **O que dá para pedir:**
  - "assistir o Fulano", "abre a live do Fulano";
  - "parar de assistir o Fulano", "fechar todas";
  - "Fulano na janela flutuante no canto esquerdo de cima" (abre a transmissão, se precisar);
  - "tirar o Fulano da janela flutuante";
  - "entrar na voz", "sair da voz", "desligar o microfone", "ligar o microfone";
  - "ir para a subsala 2", "voltar para a voz geral", "me leva pra sala da Débora" (o canal em que ela está);
  - **música:** "toca Evidências", "põe aquela música do Coldplay", "pausa a música", "continua a música", "para a
    música" (a do seu canal; "toca" busca no YouTube e põe o primeiro vídeo, ou troca a que estiver tocando);
  - **som:** "abaixa o Mateus", "aumenta o volume da Ana", "silencia o Lucas" (a voz, só para você); "liga o som da
    live da Ana", "desliga o som da tela do Mateus"; "silencia todo mundo", "volta a ouvir todo mundo" (o fone);
  - **destaque e tela cheia:** "deixa a do Lucas grande", "tira o destaque", "tela cheia da Ana", "sai da tela cheia";
  - **clipe:** "salva um clipe", "salva um clipe do Mateus";
  - **a sua transmissão:** "deixa minha live só pro meu canal", "abre minha live pra todo mundo", "para a minha live".
    Parar pergunta antes (dois toques iguais): segure a tecla de novo e diga "sim" (ou "não") em até 15 s.
- **Resposta:** um aviso na tela e a **Confirmação** escolhida em Recursos extras:
  - **Sons** (o padrão): um toque ao começar e ao terminar de gravar; depois, dois tons subindo quando o comando foi
    feito, um som grave descendo (recusa) quando não deu ou não havia nada a fazer, e dois toques iguais quando o app
    pergunta antes ("Parar a sua transmissão?");
  - **Voz:** os toques e a voz do Windows dizendo o que foi feito ("Assistindo Fulano");
  - **Nenhuma:** só o aviso na tela.
  Escolher uma opção já toca um exemplo. Com dois nomes parecidos na sala, o app pergunta
  ("Daniel ou Daniela?") em vez de chutar; sem entender, ele diz o que ouviu.
- **Pedidos livres:** em Recursos extras › **Pedidos livres**, um modelo de linguagem entende o que as regras não
  entendem, dito do seu jeito ("deixa o Mateus num cantinho pra eu ver", "fecha tudo e me leva pra sala do Lucas").
  Ele escolhe entre as mesmas ações acima, uma ou várias em sequência, e o app confirma tudo num aviso só. Os pedidos
  simples continuam pelas regras (instantâneo); só o que elas não entendem, ou o que tem mais de uma coisa, vai para o
  modelo (aparece **Pensando…**).
  - **Local:** um modelo no seu PC pelo Ollama (`http://localhost:11434`) ou LM Studio (`http://localhost:1234`).
    Grátis e sem internet, mas usa o PC (a placa de vídeo, se tiver) enquanto pensa. O modelo precisa saber escolher
    ações ("tools"): o recomendado é o `qwen2.5:7b` (no Ollama: `ollama pull qwen2.5:7b`, uns 4,7 GB; responde em
    menos de 1 s numa RTX 3060). Modelos de raciocínio, como o `deepseek-r1`, não servem. O app pede para o Ollama
    tirar o modelo da placa de vídeo 1 minuto depois do último comando (sozinho, ele deixaria 5 minutos).
  - **Nuvem:** Claude, pela API da Anthropic, com a sua chave (cobrada na sua conta). Entende melhor e não pesa no PC.
    A chave fica cifrada neste PC e não volta para a tela. Vai para a Anthropic só o texto do pedido, os nomes de quem
    está na sala (e quem transmite) e dos canais; nunca o áudio. Precisa do instalador novo do Nebula.
  - **Testar** manda um pedido de mentira e diz se o modelo escolheu a ação certa e em quanto tempo.
- **Privacidade:** a voz é entendida neste PC. O áudio do comando não vai para o disco, para a sala nem para servidor
  nenhum.
- Por enquanto, só no Windows.

## Configurações no celular

Guarde suas configurações no celular e traga de volta em qualquer PC. Funciona com Android e iPhone, sem instalar nada
no celular, e nada passa pela internet: o celular precisa estar no mesmo Wi-Fi do PC.

- **Guardar:** Configurações (a engrenagem) › **Celular** › **Guardar no celular**. Escolha uma senha (ela não
  fica guardada em lugar nenhum), leia o QR code com a câmera do celular e toque em **Baixar arquivo**. O celular
  guarda um arquivo `.tp2p` cifrado: sem a senha, ninguém abre.
- **Trazer:** em outro PC, **Celular** › **Trazer do celular**, leia o QR e escolha o arquivo no celular. Digite a senha
  no PC, confira o resumo e clique em **Aplicar**: as configurações deste PC são trocadas e a interface recarrega.
  Fora de uma sala, porque a interface recarrega.
- **O que vai:** tema e cores, nome, foto e fundo do perfil, microfone e voz, o volume de cada amigo, painéis, opções de transmissão e
  os atalhos de teclado. **Não vai:** a conta Razze (entre nela de novo; os amigos voltam sozinhos), as mensagens
  diretas e o endereço das salas.
- O código vale por 5 minutos e serve uma vez. Sem câmera, digite no navegador do celular o endereço que aparece ao
  lado do QR. Se a página não abrir, confira se o celular está no mesmo Wi-Fi e se o Windows deixa o Nebula
  receber conexões na rede privada.

## Ícone na bandeja

O Nebula fica com um ícone na bandeja do Windows (perto do relógio), na cor do tema.

- **O X da janela esconde, não fecha:** a call, a transmissão e as janelas flutuantes continuam. Na primeira vez, um aviso lembra onde o app ficou.
- **Clique no ícone:** abre a janela de novo.
- **Botão direito no ícone:** **Abrir o Nebula**, **Procurar atualização…**, **Mutar / desmutar microfone** e **Ensurdecer / voltar a ouvir** (só na sala), **Reiniciar o Nebula** e **Sair do Nebula**, que fecha de vez.

## Atualizações

- **Sozinho:** o app procura versão nova no GitHub e com quem está na sala. Quando acha, um aviso no canto oferece **Atualizar agora**.
- **Na mão:** **Procurar atualização**, no rodapé do Início ou no menu do ícone da bandeja.
- **Novidades:** depois de atualizar, o Início mostra uma vez o que mudou na versão. Para ver de novo, ou ver as versões anteriores, clique em **Novidades** no rodapé.
