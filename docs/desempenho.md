# Desempenho

Para quem transmite e joga ao mesmo tempo. Para o uso geral, veja o [Guia](guia.md).

## Quanto a transmissão usa

- **Upload:** no modo normal, quem transmite manda uma cópia do vídeo para cada pessoa. Em 1080p 30 fps são cerca de 4,5 Mbps por pessoa: com 3 assistindo, uns 14 Mbps de upload. Se travar, use 720p ou [Uma vez só para todos](#codificar-uma-vez-só).
- **Download:** cada tela que você assiste soma no seu download. A lista de pessoas mostra quanto você está baixando no total.
- **Codec:** H.264 (ou VP8, se o PC não tiver H.264). A lista de pessoas, em "Sua transmissão", mostra o codec e se a codificação está na placa de vídeo ou no processador.
- **Electron 33 codifica pelo processador:** nesta versão, o WebRTC codifica pelo processador mesmo com placa NVIDIA. Isso foi medido numa RTX 4060, que o Chromium reconhece como capaz de codificar H.264 e AV1. Por isso a qualidade pesa bastante no jogo, e o modo [Uma vez só](#codificar-uma-vez-só) ajuda tanto.

## O que o app já faz sozinho

- **Janela minimizada ou coberta:** depois de 3 segundos, o app para de baixar o vídeo das telas que você assiste e fica só com o som. Quem transmite deixa de codificar para você, e o seu PC deixa de decodificar.
- **Som sem picotar:** o capturador de áudio usa a prioridade de áudio do Windows e tem uma folga maior.
- **Prioridade:** o Chromium jogava a página minimizada para prioridade *ociosa* e para o *modo de eficiência* (núcleos lentos). Aí o som picotava e as respostas para quem transmite atrasavam. Agora todos os processos do app ficam **acima do normal**, sem modo de eficiência, mesmo minimizados.
- **Placa de vídeo:** a prioridade escolhida vale também na placa, como o OBS faz.

## O que você pode ajustar

- **Prioridade do app** (na tela de transmitir; vale para o app inteiro e fica salva):
  - *Normal*: o jogo vem primeiro.
  - *Acima do normal* (recomendado): a transmissão vence os programas comuns sem atrapalhar o Windows.
  - *Alta*: a transmissão vem antes do jogo, que pode perder alguns FPS.
  - Não existe "Tempo real" de propósito. Sem administrador o Windows ignora; com administrador, pode travar o mouse, o teclado e o som do jogo.
- **Qualidade:** 720p 60 fps tem menos da metade dos pixels de 1080p 60 fps e continua fluido para jogos. É a opção mais leve para quem joga e transmite.
- **Pessoas assistindo:** no modo normal, cada pessoa assistindo é uma codificação a mais. Se pesar, use Uma vez só para todos, 720p ou 30 fps.
- **Janela em vez de tela:** transmita a janela do jogo em vez da tela inteira quando der. Em monitor maior que 1080p, o app precisa reduzir a imagem, e isso usa o processador.
- **Limite de FPS no jogo:** limite o FPS do jogo para sobrar uns 10% da placa. Isso é o que mais ajuda quando a placa está em 100%. Dá para fazer nas opções do jogo ou em Painel de controle da NVIDIA > Taxa de quadros máxima.

## Codificar uma vez só

Na tela de transmitir, **Codificação > Uma vez só para todos (experimental)** codifica o vídeo uma vez e manda o mesmo vídeo para todos. O peso não aumenta quando mais gente entra. O app escolhe o motor sozinho, nesta ordem:

1. **NVENC direto** (NVIDIA com driver 522 ou mais novo): o `videocap.exe` captura a tela pelo Windows e codifica no NVENC, sem passar pelo processador. No teste com 2 pessoas assistindo, o app usou:
   - 0,6% do processador no NVENC direto;
   - 1,5% no WebCodecs;
   - 2,4% no modo normal.
2. **WebCodecs** (qualquer placa): a captura é a do Chromium, e a codificação vai para a placa de vídeo (AMD e Intel também) ou para o processador.
3. **Modo normal,** se os dois falharem.

Detalhes:

- **Quem tem versão antiga** recebe no modo normal, na mesma transmissão. No NVENC direto, a captura do Chromium só liga enquanto alguém assim estiver assistindo.
- **Internet lenta de alguém:** só essa pessoa pula quadros até o próximo quadro completo. Os outros não travam.
- **Ninguém com o vídeo aberto** (todos jogando com o app minimizado): o NVENC pausa.
- **Se o motor parar no meio,** o app troca sozinho (NVENC direto → WebCodecs → processador → modo normal), sem derrubar a transmissão.
- **Para conferir,** abra Estatísticas. Aparece, por exemplo, "H.264 com NVENC direto (placa de vídeo), 1 codificação para N pessoas".
- **PC sem suporte:** a opção fica desativada.

## Jogo em tela cheia

A taxa de envio pode cair por três motivos:

- **Placa de vídeo em 100%:** o jogo usa a placa inteira, e a captura da tela perde a vez. Ela entrega menos quadros, que viram menos dados enviados. Limite o FPS do jogo (acima).
- **Janela do jogo em tela cheia exclusiva:** a janela pode congelar ou ficar preta, e imagem parada quase não gera envio. Use o modo **janela sem bordas** (*borderless*) do jogo ou transmita a **Tela inteira**.
- **Processador:** veja Prioridade, acima.

Para saber qual foi, volte para o app depois de jogar. Na lista de pessoas, em "Sua transmissão", aparece um resumo de como a transmissão foi enquanto o app estava escondido:
- quadros capturados;
- quadros enviados;
- Mbps;
- o que limitou (placa de vídeo, processador ou internet).

## Windows 10: borda amarela

A captura moderna do Windows desenha uma borda amarela em volta do que está sendo transmitido, e o Windows 10 não deixa esconder. Nele, o app usa as capturas antigas, sem borda:
- **Tela inteira:** pela Duplicação da Área de Trabalho, também no NVENC direto, com o cursor desenhado pelo app.
- **Janelas:** pela captura do Chromium.

Alguma janela de jogo pode sair preta. Nesse caso, transmita a Tela inteira.
