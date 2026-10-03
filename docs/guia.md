# Guia de uso

Tudo o que dá para fazer no Tela P2P, com os detalhes. Para começar do zero, veja o [README](../README.md).

- [Sala](#sala)
- [VPN Tela P2P](#vpn-tela-p2p)
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
- **Tamanho:** até 12 pessoas.
- **Senha:** é opcional, mas recomendada se a rede da Radmin tiver mais gente.
- **Painel à direita:** só o chat. O **botão de pessoas** no topo mostra o total e acende uma bolinha verde quando alguém fala. Ele abre a lista por cima do chat, com:
  - quem está na sala, com **Assistir** e o volume de cada pessoa;
  - os detalhes da sua transmissão;
  - o endereço da sala, com **Copiar**.

  Clicar fora ou apertar Esc fecha a lista.
- **Barra de baixo:**
  - **Transmitir minha tela** (vira o bloco **Ao vivo**: a miniatura do que você transmite, que abre a sua tela no palco, o nome da tela e quem está assistindo, com **Trocar** e **Parar**);
  - a voz;
  - o chat por cima do jogo;
  - as janelas flutuantes abertas;
  - **Estatísticas**;
  - o balão do chat;
  - **Sair**.
- **Recolher o painel:** o balão do chat recolhe o painel, e os vídeos ocupam a largura toda. Recolhido, ele mostra quantas mensagens chegaram, e o endereço da sala passa para a barra.

### VPN Tela P2P

Para usar uma rede virtual sem Radmin, todos precisam usar a mesma instalação da RazzeAPI. O administrador
hospeda a API, configura a aprovação de contas e fornece o endereço HTTPS do servidor.

1. Abra **Configurações gerais**, escolha **VPN Razze (WireGuard)** e informe o endereço HTTPS.
2. Crie uma conta. O administrador precisa aprová-la; depois disso, entre com e-mail e senha.
3. Crie uma rede ou aceite um convite enviado pelo dono. Todos os PCs precisam entrar na mesma rede.
4. Clique em **Conectar WireGuard**. O Windows pedirá permissão administrativa para criar a interface
   VPN. O app guarda a chave privada localmente e publica somente a chave pública no servidor.
5. Depois de conectar, crie ou entre numa sala normalmente; o endereço privado da rede Razze aparece
   junto do endereço Radmin. A descoberta de salas pela lista inicial continua disponível apenas em LAN/Radmin.

O dono pode copiar um link `telap2p://invite/...` na configuração da rede. No PC que receber o link, abra
o Tela P2P pelo link e entre na conta Razze para aceitar o convite. Também é possível colar o link no campo
**Entrar por convite**.

A conexão P2P WireGuard depende dos NATs dos dois lados permitirem hole punching. Redes com CGNAT restritivo
  podem não conectar nesta versão; um relay WireGuard ainda não está incluído. Com o app aberto, a lista de peers
  sincroniza a cada 30 segundos; depois de reabrir o Tela P2P, clique em **Atualizar peers** para sincronizar de novo.
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
- **Cada tela** tem uma faixa em cima com o nome da pessoa. Quando ela fala na voz, a borda pisca em verde e aparecem 3 barrinhas ao lado do nome.
- **Barra do vídeo:** fica por cima do vídeo, em cima. Aparece ao mexer o mouse na tela (ou ao navegar com Tab) e some com o mouse parado por uns 2 segundos ou fora da tela; com o mouse em cima dela, fica. Tem silenciar, volume, janela flutuante, destacar, tela cheia e o X. Clicar duas vezes no vídeo também põe em tela cheia. Resolução, quadros e Mbps de cada tela ficam em [Estatísticas](#estatísticas), na aba Transmissão.
- **Várias telas:** com duas ou mais, uma fica grande à esquerda e as outras numa coluna ao lado, todas ao vivo. Clique numa pequena (ou Enter nela) para trocar o destaque.
- **Só esta:** o botão de destacar deixa só essa tela ocupando tudo. As outras ficam em pausa só para você, sem vídeo e sem som: quem transmite para de mandar o vídeo para você, e o seu PC deixa de decodificar. A faixa de cima mostra quem está em pausa. Clique num nome para trocar, ou em **Mostrar todas** (ou Esc) para voltar.
- **Transmissão sem som:** se quem transmite está sem o som do PC (desligou em "Som do PC" ou a captura falhou), a faixa da tela mostra **sem som** e o controle de volume some. Quem transmite vê "sem som" no **Ao vivo**; para ter som, é parar e transmitir de novo com "Som do PC" ligado.
- **Som das telas:** toda transmissão começa **sem som** (0%). Para ouvir, role a roda do mouse para cima em cima da tela (5% por clique), use o controle da barra do vídeo ou clique no alto-falante (liga em 100%). O volume de cada pessoa fica guardado pelo nome.
- **Volume por pessoa:** veja [Voz](#voz).
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
- **Organização:** cada linha fica no formato do console do jogo, "21:02 Nome : mensagem", com o nome na cor da pessoa. Mensagens seguidas da mesma pessoa ficam juntas, sem repetir o nome. As que chegam enquanto você não está olhando ganham a linha "N mensagens novas" e o botão "Ir para as mensagens novas".
- **Arquivos:** use o clipe, arraste para o chat ou cole com **Ctrl+V** (um print da tela ou um arquivo copiado), até 200 MB. O print colado ganha um nome com a hora, tipo `imagem-colada-21-07-45.png`.
  - **Baixar:** quem clica em **Baixar** recebe direto de quem mandou, vê a barra de progresso (dá para cancelar) e depois clica em **Salvar**.
  - **Imagens pequenas** aparecem sozinhas.
  - **Imagens** aparecem só como a imagem, sem o nome e o tamanho do arquivo. Com o mouse em cima (ou com o foco pelo Tab), aparece o selo **Só nesta sala**. Para salvar uma imagem, clique nela e use **Salvar** na imagem grande.
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
- **Quem está falando** ganha 3 barrinhas verdes que mexem ao lado do nome, sem texto. Isso aparece na lista de pessoas, na tela dessa pessoa (a borda pisca em verde), nas janelas flutuantes e no chat por cima do jogo. Microfone desligado aparece com um ícone laranja.
- **Volume de cada pessoa:** o botão de volume ao lado do nome abre um cartão com:
  - **Voz** (0 a 200%, para ouvir quem tem o microfone baixo);
  - **Som da transmissão** (0 a 100%, começa em 0%);
  - **Silenciar para mim** e **Voltar ao padrão** (voz em 100% e a transmissão sem som).

  Só muda o que você ouve. O botão mostra o valor quando não está no padrão. O app lembra o volume de cada pessoa pelo nome, para a próxima sala.
- **Painel recolhido:** na barra de baixo, ao lado de **Entrar na voz**, ficam até três fotos de quem está na voz (quem fala acende em verde) e quantos são ("6 na voz"). Clicar abre uma lista para cima com cada pessoa (clicar nela abre o volume; a roda do mouse em cima também muda), **Entrar na voz** (se você está fora) e **Abrir o painel da voz**. Esc ou um clique fora fecha.
- **Roda do mouse:** em cima do nome na barra da voz ou do botão de volume na lista, muda a voz da pessoa (ou o som da tela, se ela não estiver na voz), de 5 em 5%. Em cima da tela da pessoa ou da janela flutuante (no modo de ajuste), muda o som da tela. Um balãozinho mostra o valor.
- **Sons da voz:** dois tons subindo quando alguém entra na voz (ou você), dois descendo quando sai, e um toque curto quando você muta ou desmuta o microfone. Os de quem entra e sai só tocam enquanto você está na voz; quem muta do outro lado e o apertar para falar não tocam. O som e o volume de cada um ficam em **Configurações gerais** (a engrenagem no topo).
- **Microfone negado:** se o Windows negar o microfone, permita o acesso para aplicativos de desktop nas configurações de privacidade.
- **Voz e transmissão juntas:** se a captura que exclui o som do app falhar durante a conversa, a tela é transmitida sem áudio do PC, para não retransmitir as vozes. Se uma transmissão já estiver capturando todo o som do PC, pare, entre na voz e recomece a transmissão.
- **Como funciona:** a voz usa WebRTC direto pela Radmin, uma conexão por par de pessoas, sem servidor. Usa o microfone padrão.

### Subsalas de voz

No painel **Chat de voz**, a voz fica dividida em canais: a **Voz geral** e as subsalas.

- **Criar:** fora da voz, clique em **+ Nova subsala**, ao lado de **Entrar na Voz geral**; na voz, em **+ Subsala**, na faixa de baixo do painel. A subsala é criada e você já entra nela. Os nomes são sempre `Subsala_1`, `Subsala_2`, e assim por diante: a nova recebe o número seguinte ao da maior que existe.
- **Entrar:** clique em **Entrar** no canal. Fora da voz, isso liga o microfone já naquele canal; na voz, você muda de canal sem sair.
- **Quem ouve quem:** só quem está no mesmo canal se ouve. O chat de texto e as transmissões continuam valendo para a sala toda.
- **Apagar:** o **X** ao lado da subsala. Quem estava nela volta para a Voz geral.
- **Mudar alguém de canal:** arraste a pessoa (ou você) até outro canal. Qualquer um pode mover quem está na voz; o app da pessoa troca de canal sozinho. Precisa do host (ou do servidor da VPS) na versão nova; sem isso, só dá para arrastar você mesmo.
- **Lista ou Mapa:** os dois ícones ao lado do título (três linhas para a Lista, um planeta para o Mapa) trocam a visão (fica salva neste PC). No **Mapa**, cada canal é um sol e quem está nele orbita como planeta. Cada canal com gente fica numa nebulosa de fumaça com a cor dele, e embaixo do nome aparece quantos estão nele. Quem fala solta ondas verdes, quem transmite solta ondas na cor de destaque e o canal com música solta notinhas. Ao fundo, uma galáxia em espiral gira bem devagar. Com o mouse em cima de um canal, os anéis e a nebulosa dele acendem e o sol cresce; em cima de uma pessoa, o planeta cresce e aparece uma linha até o sol. Quem entra chega como cometa, quem sai escapa da órbita, quem muda de canal faz um arco até o outro sol, quem começa a transmitir solta um anel, e a subsala nova acende com uma onda (a que é apagada se apaga). Com o Tela P2P fora de foco, só as órbitas continuam se mexendo. Clicar no sol abre um cartão preso a ele: o nome do canal, com quantos estão nele e quantos ao vivo (clicar no nome entra no canal), a música (no seu canal sem música, a linha tracejada **Sem música · Pôr uma**) e, numa subsala, o **X** de apagar. Embaixo, quem está no canal: quem transmite tem **AO VIVO** e o olho de **Assistir**; clicar na pessoa abre o perfil dela (volume e amizade). Esc ou um clique no mapa fecha; arrastar o planeta até outro sol muda a pessoa de canal. A roda do mouse (ou **+** e **−**) aproxima até caber uma subsala e afasta até ver todas; arrastar o fundo anda pelo mapa.
- **Mapa grande:** com o chat e a voz na barra da direita, deixe o mouse parado no mapa: o chat encolhe e o mapa ocupa a barra toda. Do chat fica uma faixa em cima, com as mensagens novas; clicar nela traz o chat de volta. Tirando o mouse do painel de voz, o chat volta sozinho (menos enquanto você põe uma música, mexe no volume de alguém ou está no perfil de alguém). O **alfinete** ao lado de Lista e Mapa fixa o mapa aberto até você soltar. Com o mouse chegando perto de um sol, a órbita dele vai desacelerando até parar; as outras seguem girando; com o Tela P2P fora de foco, o céu em cima da Lista não é desenhado (o Mapa continua girando).
- **Pessoa no mapa:** clicar num planeta aproxima até a pessoa. Em volta dela ficam, só com o ícone (o nome aparece ao parar o mouse em cima), **Assistir**, **Perfil** (volume e amizade), **Silenciar para mim** e **Mudar de canal**, e embaixo o volume da voz dela. No seu planeta: microfone, fone e **Mudar de canal**. A setinha **‹**, Esc ou um clique fora dos botões volta para o mapa.
- **Céu na Lista:** na Lista, o céu pequeno em cima é só enfeite. Para escondê-lo ou mostrá-lo, use **Configurações › Aparência › Céu da voz em cima da lista**. O Mapa não muda.
- **Troca de host:** as subsalas continuam, e cada um fica no canal em que estava.
- **Modo Internet:** o servidor da VPS precisa estar atualizado para ter subsalas; sem isso, o painel mostra só a lista de sempre.

### Música junto (YouTube)

Uma música por canal (Voz geral ou subsala), que todo mundo ouve junto, no mesmo ponto.

- **Pôr:** no cabeçalho do canal em que você está (fora da voz, a Voz geral), clique na **nota musical** e cole o link de um vídeo do YouTube (`youtube.com/watch`, `youtu.be`, `shorts` ou `music.youtube.com`). A tela da música abre para você.
- **Pelo chat:** escreva `/musica` e o link (ou `/tocar`). Antes de mandar, aparece a prévia do vídeo (capa e título) e onde ele vai tocar; **Enter** põe a música no seu canal, ou troca a que está tocando. Só `/` mostra os comandos; texto com `/` que não é comando vai como mensagem normal.
- **Ouvir:** a música aparece embaixo do canal, no painel de voz (e no balão do sol, no Mapa), com **Ouvir**. Ela vira uma tela no palco, ao lado das transmissões: dá para pôr em destaque, tela cheia e arrastar. Os controles dela (tocar, pausar, o progresso, Trocar e Parar) ficam embaixo, por cima do vídeo, e somem junto com a barra de cima quando o mouse fica parado. As legendas do YouTube vêm desligadas; o botão **CC**, na barra de cima, liga e desliga (só para você, e fica salvo). Ao ligar, o player recarrega no mesmo ponto da música (1 a 2 s). Com **Configurações › Aparência › Luz ambiente** ligada, as barras em volta do vídeo pegam as cores dele, como nas transmissões; com o app fora de foco (no jogo), elas param de atualizar.
- **Controles de todos:** tocar e pausar, o ponto da música, **Trocar** e **Parar a música** valem para todo mundo. Só quem está naquele canal (ou quem pôs a música) controla.
- **Só seus:** o volume (fica salvo neste PC) e o **X**, que para de ouvir sem parar para os outros.
- **Como funciona:** cada pessoa toca no player oficial do YouTube, no próprio PC; a sala só combina o que tocar e em que ponto. Cada um vê os próprios anúncios.
- **Fim:** quando a música acaba, ela sai sozinha e o canal fica livre para outra.
- **Vídeo que não toca:** quem publicou pode não deixar tocar fora do YouTube; a tela avisa para trocar por outro.
- **Modo Internet:** o servidor da VPS precisa estar atualizado; sem isso, a nota musical não aparece.

## Amigos

No HUB (a barra fina na borda esquerda), aba **Amigos**. Precisa de conta Razze.

- **Buscar:** o campo do topo filtra a lista pelo nome. Os chips **Todos**, **Online** e **Pedidos** mudam o que aparece; o número no **Pedidos** conta os pedidos recebidos e enviados.
- **Adicionar:** clique em **Adicionar**, digite o nickname exato e **Enviar pedido** (ou Enter). Se der errado, o motivo aparece embaixo do campo. Quando der certo, o pedido vai para **Pedidos enviados**.
- **Convidar:** aparece só para quem está online; copia o endereço (ou o código) da sua sala.
- **Remover:** no **⋯** da linha, **Remover [nome]**. A própria linha pergunta se é isso mesmo; **Não** ou Esc desiste.

## Mensagens diretas

Conversa com um amigo (conta Razze), dentro ou fora da sala.

- **Abrir:** clique em **Mensagens**, na barra de baixo: a lista das conversas abre para cima, com busca, a última mensagem e as não lidas. Ou, no HUB, aba **Amigos**, no balão ao lado do nome.
- **Barra de conversas:** fica embaixo da tela. Cada conversa aberta vira um chip. Clicar no chip abre a janela; o **—** minimiza de volta para o chip; o **X** tira da barra.
- **Muitas conversas:** as que não cabem na largura vão para o **+N** no canto direito (fica destacado se alguma tem mensagem não lida). Clicar nele lista as escondidas; escolher uma traz ela de volta para a barra.
- **Ordem:** arraste um chip para a esquerda ou para a direita de outro (ou **Alt+←** / **Alt+→** com ele selecionado). A ordem fica salva.
- **Histórico:** fica salvo neste PC, um arquivo por amigo. Fechar a conversa no X não apaga nada: ao abrir de novo, tudo volta.
- **Amigo offline:** a mensagem fica no servidor Razze por até 30 dias e chega quando ele abrir o app.
- **Mensagem nova:** a conversa aparece na barra, minimizada, com o número de mensagens não lidas. O total aparece no **Mensagens** da barra.
- **Arquivos:** por enquanto só texto (os arquivos do chat da sala vão direto de PC para PC, e o amigo pode não estar na mesma rede).

## Voz e atalhos

O botão de controles na barra de voz.

- **Testar o microfone:** **Ouvir minha voz** toca no seu fone o som do seu microfone, do jeito que a sala ouve: depois da supressão de ruído e da sensibilidade. Funciona fora da voz (abre o microfone só para o teste) e dentro dela; na voz, desligue o microfone para testar sem os outros ouvirem. Dá para mexer nos filtros enquanto ouve. Use fone de ouvido: com caixa de som, o microfone pega o próprio som e apita. O teste para ao fechar a janela.
- **Supressão de ruído:**
  - **Avançado** (padrão): passa sua voz pelo [RNNoise](https://github.com/xiph/rnnoise), uma IA que roda no seu PC e tira teclado, ventilador, barulho da rua e respiração.
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
Tem duas abas: **Desempenho** e **Transmissão**.

### Desempenho

- **Cada cartão** mostra o número de agora, a **média dos últimos 30 s** com mínimo e pico, e um **gráfico dos últimos 10 minutos**. A faixa no fim do gráfico marca os 30 s da média.
- **Uso do app:** processador, placa de vídeo 3D, codificação e decodificação. Mostra quanto o app usa e, embaixo, a média do PC inteiro (inclui o jogo). São os mesmos números do Gerenciador de Tarefas.
- **Rede:** quadros capturados, quadros enviados, Mbps enviando e recebendo.
  - Se "capturados" cai durante o jogo, a placa de vídeo estava ocupada.
  - Se "enviados" cai e "capturados" não, o problema é a internet ou a codificação.
- **Cada processo do app:** captura, codificação, decodificação, rede e os ajudantes, com a memória de vídeo de cada um.
- **O codificador de verdade:** por exemplo, "H.264 com OpenH264 (processador)". Para quem só assiste, o Chromium não diz qual é o decodificador.
- **Codificação alta com o app parado:** se "Codificação de vídeo, PC inteiro" estiver alta, é outro programa usando o codificador da placa (ex.: o Replay Instantâneo da NVIDIA ou uma live do Discord).

### Transmissão

Um cartão para cada pessoa que está transmitindo (você primeiro, se estiver):
- **Configuração de quem transmite:** a qualidade escolhida, a codificação (uma vez só para todos ou uma por pessoa, e se é pela placa de vídeo) e se o som do PC vai junto.
- **O que chega até você,** nas telas que você está assistindo: resolução, quadros por segundo, Mbps, codec e pacotes perdidos. Atualiza a cada segundo.
- **A sua transmissão:** quantas pessoas estão assistindo, quadros capturados e o que sai daqui.

A configuração de outra pessoa só aparece se ela e o host estiverem na versão 1.9.0 ou mais nova.

## Tema

Abra **Configurações gerais** pela engrenagem no topo direito. A barra fica na mesma posição no início e dentro de uma sala.

O botão **Perfil** mostra seu nome salvo neste dispositivo; ele pode ser editado fora da sala. Dentro da sala, **Chat**, **Voz** e **Transmissão** são alternadores independentes: clique para exibir ou ocultar cada painel. Os selecionados permanecem visíveis juntos, dividindo o espaço. Perfil e configurações também podem ficar abertos ao mesmo tempo. Cada painel tem sua própria rolagem quando necessário. A seleção dos três painéis da sala é lembrada ao reabrir o app.

O painel **Voz** mostra os participantes, seus controles de volume e botões para entrar, sair, mutar e silenciar as vozes. Mostrar ou ocultar esse painel não liga nem desliga o microfone. Da mesma forma, ocultar **Transmissão** não encerra uma transmissão em andamento; use o botão **Parar** para encerrá-la.

- **Principal:** fundo do aplicativo.
- **Secundária:** painéis e cartões.
- **Detalhes 1:** botões, seleção e destaques.
- **Detalhes 2:** indicadores de voz, conexão e avisos.

Digite um hexadecimal de três ou seis dígitos, com ou sem `#`, ou use a amostra de cor. A mudança aparece imediatamente, inclusive nas janelas flutuantes abertas. Textos e tons de apoio se adaptam às cores escolhidas. Valores inválidos não substituem a última cor válida. **Restaurar cores padrão** recupera o tema oliva e amarelo, sem alterar os sons.

Na mesma tela, escolha o som de **entrada na sala**, **saída da sala**, **mensagem no chat**, **entrada no chat de voz**, **saída do chat de voz**, **mutar o microfone** e **desmutar o microfone**. Há os oito MP3 incluídos no app e quatro sons **Suave**, gerados na hora pelo próprio app (os padrões da voz e do microfone). Os da voz dos outros só tocam enquanto você está na voz. Os arquivos já vêm dentro do app; não é preciso manter a pasta original ao lado do executável. **Ouvir** toca uma prévia. **Sem som** desativa um evento específico, e **Silenciar som do chat** mantém os outros avisos ativos. A prévia continua disponível com o chat silenciado.

Cada evento tem seu próprio volume de 0 a 100%. O **volume geral dos avisos** multiplica esses valores: geral em 50% e um evento em 40% resultam em 20% para aquele evento. Geral em 0% silencia todos sem apagar os ajustes individuais. Os volumes dos avisos são independentes do volume da voz e das transmissões.

Mensagens enviadas e recebidas fazem som quando chegam confirmadas pelo servidor. Carregar o histórico não faz som. Entrar ou sair da sala também avisa no próprio PC. Na voz, os avisos acompanham a entrada e saída das pessoas: mutar, desmutar ou reconectar alguém que já estava na voz não repete o som. Carregar os participantes existentes também é silencioso. Retornos de participantes já conhecidos durante uma troca de host não repetem o aviso de entrada.

Todas essas escolhas são salvas automaticamente no perfil local do app e continuam ao fechá-lo e abri-lo de novo. Cada pessoa pode usar suas próprias cores e sons.

Fontes do próprio Windows: Segoe UI Variable no app e Tahoma no chat.

## Atualizações

- **Sozinho:** o app procura versão nova no GitHub e com quem está na sala. Quando acha, um aviso no canto oferece **Atualizar agora**.
- **Na mão:** **Procurar atualização**, no rodapé do Início.
- **Novidades:** depois de atualizar, o Início mostra uma vez o que mudou na versão. Para ver de novo, ou ver as versões anteriores, clique em **Novidades** no rodapé.
