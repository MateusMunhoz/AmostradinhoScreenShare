# Comando de voz

Roadmap: (ainda não está; entra como recurso extra, desligado por padrão)

## Objetivo
Controlar o app falando, sem sair do jogo: "assistir o Fulano", "janela flutuante no canto esquerdo de cima", "parar de
assistir". Quem joga em tela cheia hoje precisa dar Alt+Tab para clicar em Assistir e arrumar a janela flutuante.
É um **recurso extra**: só funciona para quem liga, e só baixa o que precisa depois de ligar.

## Escopo
- Entra (etapa A):
  - Seção **Recursos extras** em Configurações gerais (aba nova), com **Comando de voz** desligado por padrão.
  - Ligar baixa o reconhecimento de fala (Whisper local) uma vez só, com progresso; desligar pode apagar o download.
  - Tecla de comando global, segurar para falar (Ctrl+Shift+V, trocável em **Voz e atalhos**), também dentro do jogo.
  - Transcrição local (whisper.cpp, pelo processador), sem internet depois do download.
  - Entender por regras (sem modelo de linguagem) estes comandos:
    1. Assistir alguém: "assistir / abrir a live / ver a tela do <nome>".
    2. Parar de assistir alguém ou todo mundo: "parar de assistir <nome>", "fechar todas".
    3. Janela flutuante de alguém num canto: "<nome> na janela flutuante no canto <esquerdo|direito> de <cima|baixo>"
       (abre a transmissão antes, se precisar).
    4. Tirar alguém da janela flutuante: "tirar <nome> da janela flutuante".
    5. Voz: "entrar na voz", "sair da voz", "silenciar / ligar o microfone".
    6. Mudar de canal: "ir para a subsala <N>", "ir para a voz geral".
  - Confirmação: aviso na tela e, se ligado, uma frase curta falada pela voz do Windows ("Assistindo Fulano").
- Fica de fora (etapas seguintes):
  - Modelo de linguagem local (Ollama / LM Studio) para frases livres e pedidos com várias etapas.
  - Servidor MCP local para Claude ou outros modelos controlarem o app.
  - Palavra de ativação ("ei, Tela"): ouvir sempre custa processador e microfone ligado o tempo todo.
  - Chat e mensagens por voz (ler ou mandar mensagem).
  - Recurso pago ou ligado à conta Razze. A seção **Recursos extras** já separa o que é extra, para isso ser fácil
    depois (a RazzeAPI diria quem tem o recurso).
  - Linux (a etapa A é só Windows, como o `teclas.exe`).

## Comportamento esperado
- **Ligar:** Configurações › Recursos extras › Comando de voz. A primeira vez explica o que é, o tamanho do download
  (~150 MB, modelo "base" multilíngue; "small", ~470 MB, como opção de mais precisão) e que o áudio do comando nunca sai
  do PC. Botão **Baixar e ligar**: barra de progresso; dá para cancelar. Falhou (sem internet, disco cheio, hash
  diferente): aviso e o recurso continua desligado.
- **Desligado** (padrão): nada é baixado, a tecla não é registrada, nenhum texto sobre comando de voz aparece fora da
  seção Recursos extras.
- **Falar um comando:** segurar a tecla de comando. Enquanto ela está apertada:
  - o seu microfone **não vai para a call** (os outros não ouvem o comando), mesmo em modo aberto;
  - aparece um indicador pequeno "Ouvindo…" (na janela e, com o jogo por cima, no chat flutuante/overlay, se aberto);
  - som curto de início e de fim (dos Sons, desligável).
  Soltou: transcreve (alvo: até ~1,5 s para uma frase de 3 s no processador), interpreta e executa.
- **Resultado:**
  - Entendeu e fez: aviso "Assistindo Fulano no canto esquerdo de cima" (e a voz, se ligada).
  - Nome ambíguo (dois parecidos): não executa; aviso "Mateus ou Matias? Fale de novo com o nome." e lista os dois.
  - Não entendeu: aviso com o que foi ouvido ("Ouvi: 'abre a lata do fulano'") e um exemplo de comando.
  - Não dá (Fulano não está transmitindo, transmissão só para o canal dele, fora de uma sala): o mesmo aviso que o
    clique daria.
- **Nomes:** compara o que foi ouvido com os nomes da sala sem acento e sem maiúsculas, por semelhança (distância de
  edição + "soa parecido": Matheus/Mateus, Gui/Guilherme pelo começo do nome). Só executa com um candidato claro.
- **Fora de uma sala:** a tecla responde "Entre numa sala para usar o comando de voz." (exceto comandos que não
  dependem dela, nenhum na etapa A).
- **Modo gamer:** o comando de voz continua funcionando (é para isso que ele serve); a transcrição roda com prioridade
  baixa para não roubar o jogo.

## Restrições
- **Privacidade:** o áudio do comando só existe na memória enquanto é transcrito; não vai para disco, para a sala nem
  para servidor nenhum. Texto ouvido não é guardado (só o último, no aviso).
- **Nada para quem não liga:** sem download, sem processo extra, sem tecla registrada, sem custo de CPU.
- **Desempenho:** o whisper.cpp só roda entre soltar a tecla e o resultado, pelo processador (não disputa a placa
  com o jogo e o NVENC), com prioridade abaixo do normal e número de threads limitado.
- **Download seguro:** o modelo e o executável vêm de endereços fixos no código, conferidos por SHA-256 também fixo no
  código, e são gravados só na pasta de dados do app (`userData/comando-de-voz/`). Nada é executado sem bater o hash.
- **Executável:** o `whisper-cli.exe` (licença MIT) não vai no `.exe` nem na atualização (pesaria para todos); é baixado
  só por quem liga. Por isso, a atualização assinada não cobre esse arquivo: o hash fixo no código é a garantia.
- **Segurança do Electron:** a página não escolhe caminho nem comando; o processo principal roda só o executável que ele
  baixou e conferiu, com argumentos montados por ele, e devolve só o texto. IPC novo e `preload.js` seguem a regra
  da área crítica (plano aprovado antes).
- Textos em pt-BR, sem animação contínua no "Ouvindo…" (indicador parado; no máximo uma transição curta).

## Dependências
- Página: `renderer/comando-voz.js` (novo: gravar da tecla, interpretar, executar), `renderer/microfone.js` (cortar
  o microfone da call enquanto grava), `renderer/configuracoes.js` + `index.html` (aba Recursos extras, atalho em
  Voz e atalhos), `renderer/assistir.js`, `renderer/pip.js`, `renderer/voz.js`, `renderer/subsalas.js` (as ações).
- Processo principal: `main/comando-voz.js` (novo: baixar, conferir hash, rodar o whisper.cpp), `main/atalhos.js`
  (tecla de segurar, pelo `teclas.exe` como o apertar para falar), `main/janela-flutuante.js` (canto pedido por
  janela, além do `corner` do grupo), IPC em `main.js` e `preload.js`.
- Publicação: arquivos novos em `PACK_FILES` (`publicar.js`) e `build.files` (`package.json`). O Whisper e o modelo não.
- Interpretação por regras isolada em um módulo sem DOM (`comando-voz-regras.js`), para testar em `node:test`.

## Critérios de aceitação
- [x] Desligado por padrão; com ele desligado, nada é baixado e nenhum atalho novo é registrado.
- [x] Ligar baixa, confere o SHA-256 e recusa arquivo diferente; cancelar e falha deixam desligado e sem lixo.
- [x] Segurar a tecla não manda a sua voz para a call; soltar volta ao estado de antes (mudo continua mudo).
- [x] Os 6 comandos funcionam com frases de exemplo e variações comuns (com e sem "o/a", "live/tela/transmissão").
- [x] Nome ambíguo não executa e pergunta; nome inexistente diz o que foi ouvido.
- [x] "Fulano na janela flutuante no canto esquerdo de cima" abre a transmissão (se preciso) e põe a janela no canto.
- [x] Transcrição de uma frase de ~3 s em até ~1,5 s num PC médio. Medido (modelo leve, 4 threads, i7 de 16 threads):
      0,6 a 0,9 s só a transcrição; 0,9 a 1,5 s de soltar a tecla até o comando feito (`tests/e2e/comando-voz.cjs`).
- [ ] O jogo não perde FPS visível ao usar o comando (teste manual com um jogo e transmitindo).
- [ ] Teste manual com microfone de verdade, numa call com outro PC (o outro não ouve o comando).

## Como ficou (diferenças da etapa A para o plano)
- O Whisper é o `whisper-bin-x64.zip` do whisper.cpp (b5130, CPU). Ficam 13 arquivos (o `whisper-cli.exe`, as DLLs e
  uma DLL por família de processador), cada um com SHA-256 fixo em `main/comando-voz.js`, conferidos ao instalar e de
  novo antes do primeiro uso de cada sessão. O zip é aberto pelo `tar.exe` do próprio Windows.
- Modelos: **Leve** = `ggml-base-q5_1` (60 MB) e **Preciso** = `ggml-small-q5_1` (190 MB), do repositório do
  whisper.cpp no Hugging Face, preso a uma versão. A dica (`--prompt`) leva as palavras dos comandos e os nomes da sala.
- O áudio vai pelo stdin (`-f -`); o `-of` é obrigatório nesse modo, senão o whisper-cli não escreve o texto. Nada é gravado.
- A tecla usa um segundo `teclas.exe` com cada tecla do atalho (sem recompilar o nativo); só roda com o recurso ligado,
  baixado e numa sala. Toque de menos de 0,5 s é ignorado calado (o Ctrl+Shift+V de colar texto).
- O microfone do comando é aberto à parte (com supressão de ruído do Chromium), não a cópia do da call: a porta de
  sensibilidade da call cortaria palavras baixas.
- **Começo da frase:** abrir o microfone ao apertar leva 0,1 a 0,4 s, e a primeira palavra se perdia. Num teste com 15
  frases × 2 velocidades, cortar 0,3 s do começo derrubou o acerto de 87% para 47%. Por isso, **na voz** (o microfone já
  está em uso pela call) o do comando fica aberto esperando, com um anel de 0,6 s na memória que entra no comando quando
  a tecla é apertada; continua gravando 150 ms depois de soltar. **Fora da voz**, abre ao apertar, com "Abrindo o
  microfone…" até o toque. Fecha ao sair da voz ou desligar o recurso.
- **Medido** (`scratchpad` de testes, voz do Windows, 30 gravações por condição, sala com 9 nomes):

  | | limpo | ruído (10 dB) | começo cortado | tempo |
  |---|---|---|---|---|
  | Leve (base) | 26/30 | 24/30 | 14/30 | 0,66 s |
  | Preciso (small) | 28/30 | 23/30 | 18/30 | 2,06 s |
  | Leve + gramática GBNF | 29/30 | 26/30 | 12/30 | 1,04 s |
  | Leve + correções nas regras | **30/30** | **27/30** | (resolvido pelo anel) | 0,63 s |

  A gramática foi descartada: com áudio ruim ela inventa um comando válido ("Assiste o Lucas aí" virou "Desliga o
  micro") em vez de falhar, o que faria o app executar a coisa errada. As correções nas regras cobrem o jeito como o
  Whisper escreve as palavras curtas ("Fesha todas", "Sai da col", "subsalatriz").
- O Whisper às vezes parte o nome ("o Mateus" → "uma teus"): as regras juntam o fim de uma palavra com a seguinte para
  nomes de 5 letras ou mais.
- **Confirmação:** o padrão são sons gerados na hora (toque de começo e de fim da gravação; dois tons subindo quando o
  comando foi feito; um som grave descendo, de recusa, quando não deu ou não havia nada a fazer). A voz do Windows
  ficou como opção (**Voz**), e dá para deixar só o aviso na tela (**Nenhuma**).
- Ficou para depois: o "Ouvindo…" também no chat por cima do jogo (hoje só na janela do app; o toque e a voz de
  confirmação servem de aviso dentro do jogo).

## Testes
- Automáticos:
  - `tests/comando-voz-regras.test.js` (novo): frases → comando + parâmetros; nomes parecidos, acentos, ambiguidade,
    frases que não são comando.
  - `tests/comando-voz.test.js` (novo): hash certo/errado, download cancelado, arquivo parcial apagado, WAV inválido,
    atalho → teclas virtuais.
  - `tests/e2e/comando-voz.cjs` (novo): de ponta a ponta com o Whisper de verdade e um microfone de mentira.
  - `npx electron tests/e2e/carga.cjs`: app abre com o recurso ligado e desligado.
- Manuais (Windows, sala com 2 PCs): ligar e baixar; assistir e mandar para a janela flutuante pelo comando dentro de
  um jogo em tela cheia; conferir que o outro PC não ouve o comando na call; nome parecido entre duas pessoas.

---

# Etapa B: pedidos livres (modelo de linguagem)

## Objetivo
Entender pedidos ditos do jeito que a pessoa quiser ("deixa o Mateus num cantinho pra eu ver enquanto jogo", "fecha
tudo e me leva pra sala do Lucas"), sem escrever regras de frase para cada comando. Comando novo passa a ser só uma
ação a mais na lista.

## Escopo
- Entra:
  - Lista única de ações (`renderer/comando-voz-acoes.js`, sem DOM): nome, descrição e parâmetros de cada uma, com os
    nomes da sala e os canais como opções fechadas. Serve ao modelo e, depois, ao servidor MCP.
  - Em Recursos extras › Comando de voz, **Pedidos livres**: Desligado (padrão), **Local** ou **Nuvem**.
    - Local: um servidor de modelo no próprio PC com a API compatível com a da OpenAI (Ollama ou LM Studio), só em
      `localhost`. Endereço e nome do modelo configuráveis; botão Testar.
    - Nuvem: Claude pela API da Anthropic (`@anthropic-ai/sdk`), com a chave da pessoa guardada cifrada pelo
      `safeStorage` no processo principal (a página nunca lê a chave de volta). Modelo escolhível (Opus 5.5 padrão,
      Sonnet 5.5, Haiku 4.5); botão Testar.
  - Ordem: as regras da etapa A tentam primeiro (instantâneo, sem custo); só o que elas não entendem vai para o modelo.
  - O modelo pode devolver várias ações em sequência; o app faz uma por uma e confirma tudo num aviso só.
- Fica de fora: conversa (o modelo só escolhe ações, não responde perguntas); ações que não dá para desfazer; mandar
  áudio para a nuvem (só o texto).

## Comportamento esperado
- Selo "Pensando…" enquanto o modelo decide. Feito: o som de feito e um aviso com o que fez. Nada que o app saiba
  fazer: som de recusa e "Não sei fazer isso" (ou a explicação curta do modelo).
- Sem chave, chave inválida, sem internet, servidor local fechado, modelo sem suporte a ações: aviso claro, som de
  recusa, e o comando não é feito.
- Nuvem numa instalação antiga (sem a biblioteca, que só chega com o `.exe` novo): a opção avisa que precisa do
  instalador novo.

## Restrições
- O que sai do PC na Nuvem: o texto do pedido, os nomes de quem está na sala (com quem transmite) e os nomes dos
  canais. Nunca o áudio. Tudo isso dito na tela antes de ligar.
- Nomes vêm de outros PCs: limpos e limitados (32 caracteres, sem controle) e só usados como opções fechadas; o modelo
  só consegue chamar as ações da lista, todas inofensivas e desfeitas com outro comando.
- A chave fica no processo principal, cifrada; IPC só grava, apaga e diz se existe. O endereço local só aceita
  `localhost`, `127.0.0.1` ou `[::1]`.
- `@anthropic-ai/sdk` é dependência nova: chega só com instalador (`.exe`) novo — dizer no PR.

## Critérios de aceitação
- [x] Pedido livre que as regras não entendem vira a ação certa, nos dois modos (servidores de mentira:
      `tests/comando-voz-ia.test.js` e `tests/e2e/comando-voz.cjs`).
- [x] Várias ações num pedido são feitas em ordem, com um aviso só.
- [x] Chave nunca volta para a página; endereço fora de localhost é recusado.
- [x] Erros (sem chave, 401, sem rede, servidor local fechado, recusa do modelo) viram aviso e som de recusa.
- [x] Teste real com um modelo local: `qwen2.5:7b` no Ollama 0.32.5 (RTX 3060 12 GB) acertou 12 de 12 pedidos
      livres (compostos, gírias, nome escrito diferente, e recusou pizza e previsão do tempo), média 0,8 s (3,2 s no
      primeiro, carregando). No app (`OLLAMA_MODELO=qwen2.5:7b npx electron tests/e2e/comando-voz.cjs`): 1,2 s até a
      janela flutuante abrir. O `deepseek-r1:8b` (tem "tools", mas é de raciocínio) não chamou nenhuma ação em 5
      pedidos e levou 10 s cada.
- [x] Placa de vídeo: o Ollama deixa o modelo carregado (4,7 GB) por 5 minutos e ignora o `keep_alive` na API
      compatível com a OpenAI; o app pede pela API dele (`/api/generate`) para soltar 1 minuto depois do último comando.
- [ ] Teste real com a nuvem (manual: precisa da chave da Anthropic; em Recursos extras › Testar).

## Etapa C: mais ações (música, som, destaque, clipe, a sua transmissão)
- Nas regras e na lista de ações: tocar música pelo nome (busca no YouTube pela página pública de resultados, sem
  chave: `buscarYoutube` em `main/comando-voz-ia.js`; pode quebrar se o YouTube mudar a página, e aí o aviso pede o
  link), pausar, continuar e parar a música do seu canal; volume da voz e da live de alguém, só para você; silenciar e
  voltar a ouvir todo mundo (o fone); destaque e tela cheia; salvar clipe; a sua transmissão só para o seu canal ou
  aberta; parar a sua transmissão, que pergunta antes e só para com "sim" no comando seguinte (15 s).
- O modelo recebe também se você está transmitindo e a música do seu canal (título, tocando ou pausada).
- Medido com `qwen2.5:7b` (12 pedidos livres das ações novas e antigas): 10 de 12; os 2 erros ("encerra minha live",
  "deixa todo mundo quieto") são frases que as regras já pegam antes do modelo.
- Com uma tela só aberta não existe destaque (ela já ocupa tudo): o aviso diz isso.
