# Desenvolvimento

Para quem vai mexer no código, testar ou publicar uma versão.

## Rodar pelo código

Instale o [Node.js](https://nodejs.org) (versão LTS) e, na pasta do projeto:

```
npm install
npm start
```

Para gerar um `.exe` portátil sem publicar: `npm run dist`. O arquivo aparece em `dist\Tela P2P.exe`, sempre com esse nome, e cada geração troca o anterior.

## Como o app funciona

- **Sala:** quem cria a sala roda um servidor pequeno de sinalização (`signaling.js`, WebSocket) dentro do próprio app. Ele só apresenta as pessoas umas às outras e guarda as últimas 100 mensagens do chat.
- **Vídeo, áudio, voz e arquivos:** vão direto de PC para PC, por WebRTC, pela rede da Radmin. Não passam por servidor.
- **Troca de host:** cada um sabe a ordem de chegada e os endereços dos outros. Se o servidor some, o mais antigo abre outro na mesma porta, e todo mundo volta com o mesmo número. Por isso as conexões diretas (quem assiste quem) não caem.
- **Arquivos principais:**

  | Arquivo | O que faz |
  |---------|-----------|
  | `boot.js` | Início do app. Confere a assinatura das atualizações e escolhe qual versão rodar. Só muda com um `.exe` novo. |
  | `main.js` | Processo principal: janelas, janelas flutuantes, chat por cima do jogo, atalhos globais, ajudantes nativos, prioridade. |
  | `preload.js` | A ponte segura entre a página e o processo principal. |
  | `renderer.js` | A interface e quase toda a lógica da sala: transmitir, assistir, chat, voz, volume, troca de host, estatísticas. |
  | `encode-once.js` | O modo "uma vez só" (NVENC direto e WebCodecs). |
  | `voice.js` | A voz: conexões WebRTC de áudio entre as pessoas (feito pelo Cristian). |
  | `signaling.js` | O servidor da sala. |
  | `publicar.js` | Assina, gera o `.exe` e publica. |
  | `native/` | Código dos ajudantes nativos em C++. |
  | `bin/` | Os ajudantes compilados: `audiocap.exe` (som), `videocap.exe` (captura e NVENC), `teclas.exe` (apertar para falar). |
  | `vendor/` | Arquivos de terceiros usados pelo app: a IA de ruído (RNNoise) e as fontes. |

## Testes

| Comando | O que testa | Abre janelas? |
|---------|-------------|---------------|
| `npm test` | Voz e servidor da sala, rápido | Não |
| `npm run test:rtc` | Áudio WebRTC de verdade entre duas janelas ocultas, sem o seu microfone | Não |
| `npm run test:e2e` | Tudo de ponta a ponta (uns 8 minutos) | Sim |

Sobre o `npm run test:e2e` (`tests/e2e/`):
- **Como funciona:** abre várias cópias do app no seu PC, cada uma como uma pessoa, e confere:
  - o chat;
  - a troca de host;
  - as janelas flutuantes;
  - a arrumação das telas;
  - a voz e o volume;
  - o chat por cima do jogo;
  - o aviso de atualização;
  - trocar a tela no meio da transmissão (nos três modos);
  - o microfone com IA e os atalhos.
- **Só um teste:** `npm run test:e2e -- chat` (o nome do arquivo, sem `.js`).
- **Jogo aberto:** os testes não começam se houver um jogo em tela cheia na frente, porque abrem janelas que tiram o foco. `set TELA_E2E_FORCE=1` pula essa trava.
- **Perfis e fotos** ficam em `%TEMP%\tela-p2p-e2e`, nunca no seu perfil de verdade. A limpeza no fim fecha só as cópias de teste.
- **O teste do Ctrl+Enter** digita de verdade, então fica de fora: `node tests/e2e/ctrl-enter.js`. Ele só manda teclas se a janela da frente for a janela de teste ou o chat.
- **Para escrever um teste novo,** use `tests/e2e/ajuda.js`: `openApp`, `createRoom`, `joinRoom`, `share`, `check`, `winStyle` e `run`.

O que os testes automáticos não pegam (eco, ruído, apertar para falar com tecla de verdade, troca de host entre PCs diferentes) está no [roteiro de teste da call](roteiro-de-teste.md).

## Ajudantes nativos

- **Compilar:** `native\build.cmd`, com o Visual Studio Build Tools (C++ e o SDK do Windows).
- **Só um:** `native\build.cmd audiocap`, `native\build.cmd videocap` ou `native\build.cmd teclas`.
- **Licença de terceiros:** o cabeçalho do NVENC (`native/third_party/nvEncodeAPI.h`) é do nv-codec-headers, licença MIT.
- **Antivírus:** como os `.exe` não têm assinatura digital, o Windows Defender ou o SmartScreen podem desconfiar.
- **Alternativa ao Visual Studio:** o `audiocap.exe` também compila com MinGW-w64:

```
x86_64-w64-mingw32-g++ -O2 -std=c++17 -static -s -o bin/audiocap.exe native/audiocap.cpp -lole32 -luuid -lshell32
```

## Atualizações

Ninguém precisa baixar o `.exe` de novo para atualizar. A versão nova chega por dois caminhos, com o mesmo pacote assinado (cerca de 2 MB):

- **Pelo GitHub:** o app procura a última versão ao abrir e a cada 30 minutos. Se houver uma mais nova, aparece o aviso no canto da tela com **Atualizar agora**, que baixa e reinicia. Também dá para clicar em **Procurar atualização**, na tela inicial.
- **Pela sala:** quando alguém da sala tem uma versão mais nova, o app baixa dessa pessoa pela Radmin, e quem atualizou repassa para os próximos.

Detalhes:

- **Segurança:** o app só aceita pacotes assinados com a chave de quem publica. Pacote alterado, de outra pessoa ou mais velho que o atual é recusado, mesmo vindo do GitHub. Se uma versão nova não abrir, o app volta sozinho para a do `.exe`.
- **Nada se acumula:** a versão nova fica em `%APPDATA%\Tela P2P\atualizacoes`, e as pastas de versões mais velhas são apagadas quando o app abre.
- **Quando precisa do `.exe` novo:** só se mudar a versão do Electron ou o `boot.js`. O app avisa e abre a página da versão no GitHub.
- **Versões muito antigas:** quem tem a 1.0.0 precisa baixar o `.exe` uma vez.

## Publicar uma versão (só quem tem a chave)

A chave fica em `C:\Users\<você>\.tela-p2p\chave-de-atualizacao.pem`, fora do projeto.
- **Faça uma cópia offline** (pendrive ou gerenciador de senhas). Sem ela, não dá mais para mandar atualizações para quem já tem o app.
- **Nunca mande para ninguém:** quem tiver a chave publica no seu nome.

Feche o `dist\Tela P2P.exe` se estiver aberto e rode:

```
npm run publicar
```

Isso:
1. sobe a versão (ex.: 1.8.9 → 1.8.10);
2. assina o pacote e deixa a versão pronta no seu app;
3. gera o `.exe`;
4. manda para o GitHub: o commit, a tag e uma Release com o `.exe` e o pacote assinado.

Opções:

- **Escolher o número:** `npm run publicar -- 1.9.0`
- **Texto da Release:** `npm run publicar -- --notas "o que mudou"`. Sem isso, o GitHub lista os commits.
- **Sem GitHub:** `npm run publicar -- --sem-github`

Para mandar para o GitHub, o PC precisa do Git e do [GitHub CLI](https://cli.github.com), logado (`gh auth login`) na conta dona do repositório.

A chave foi criada uma vez com `node publicar.js --gerar-chave`, que grava a parte pública no `boot.js`. **Não rode de novo:** uma chave nova faria os apps dos amigos recusarem as suas atualizações.

## Contribuir (PR e merge)

- **Faça num ramo próprio** e abra um Pull Request no GitHub.
- **Antes de pedir o merge:**
  - rode `npm test` e `npm run test:e2e`;
  - se mexeu em voz, janelas ou atalhos, passe o [roteiro de teste](roteiro-de-teste.md) numa call.
- **Depois que um PR é aceito no GitHub,** rode `git pull` na pasta do projeto antes de mexer em mais coisa, para trazer o código novo.
- **Arquivos novos** que o app precisa em tempo de execução entram em `PACK_FILES` (`publicar.js`) e em `build.files` (`package.json`). Sem isso, eles não vão nas atualizações nem no `.exe`.
