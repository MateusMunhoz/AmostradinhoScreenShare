# Tela P2P (AmostradinhoScreenShare)

Transmita a tela e converse por voz com os amigos, de PC para PC, pela Radmin VPN. Não precisa de servidor pago: o app de quem cria a sala apresenta as pessoas, e o vídeo, o áudio e a voz vão direto de um PC para o outro.

**Baixar:** pegue o `Tela P2P.exe` da versão mais nova em [Releases](https://github.com/MateusMunhoz/AmostradinhoScreenShare/releases/latest). Não precisa instalar: é só abrir. Depois disso, o próprio app avisa quando sair uma versão nova, e um botão atualiza.

## Começar

1. **Radmin VPN (todos):** instale a [Radmin VPN](https://www.radmin-vpn.com). Uma pessoa cria a rede (Rede > Criar rede) e passa o nome e a senha. Os outros entram nela. Cada um fica com um IP que começa com 26.
2. **Criar a sala (uma pessoa):** abra o app, digite seu nome e clique em **Criar sala**. Mande para os amigos o endereço que aparece (tipo `26.12.34.56:8765`).
3. **Entrar (os outros):** clique em **Entrar numa sala**, cole o endereço e clique em **Entrar**.
4. **Firewall:** na primeira vez, o Windows pergunta se o app pode acessar a rede. Marque **redes privadas e públicas** e permita, em todos os PCs.

## O que dá para fazer

- **Transmitir e assistir:** várias pessoas transmitindo ao mesmo tempo, com o som do PC. Dá para trocar a tela ou janela no meio da transmissão, sem parar. Dá para deixar de fora o som do Discord e de outros apps. Com várias telas abertas, uma fica em destaque e as outras numa coluna ao lado.
- **Ver enquanto joga:** janelas flutuantes, uma por pessoa, sempre por cima do jogo e com o clique passando direto.
- **Chat:** mensagens e arquivos até 200 MB. Também tem uma versão por cima do jogo: **Ctrl+Enter** escreve sem sair do jogo.
- **Voz:** supressão de ruído com IA, cancelamento de eco, apertar para falar, volume de cada pessoa e indicador de quem está falando.
- **A sala não cai quando o host sai:** outra pessoa assume sozinha.

Detalhes de cada coisa no [Guia de uso](docs/guia.md).

## Documentação

| Para | Leia |
|------|------|
| Usar tudo (sala, transmitir, janelas flutuantes, chat, voz, atalhos, estatísticas) | [docs/guia.md](docs/guia.md) |
| Jogar e transmitir sem pesar (qualidade, NVENC, tela cheia, Windows 10) | [docs/desempenho.md](docs/desempenho.md) |
| Mexer no código, testar e publicar | [docs/desenvolvimento.md](docs/desenvolvimento.md) |
| Testar numa call com gente de verdade | [docs/roteiro-de-teste.md](docs/roteiro-de-teste.md) |

## Problemas comuns

| Problema | O que fazer |
| --- | --- |
| "Não foi possível conectar" | Confira se a Radmin está ligada nos dois PCs e se o endereço está certo. Teste com um ping no IP 26.x. |
| Conecta, mas o vídeo não aparece | Libere o app no Firewall do Windows (redes públicas) nos dois PCs. |
| "A porta já está em uso" | Troque a porta (ex.: 8766) e passe o endereço novo. |
| Sem áudio na transmissão | Veja se há som tocando no dispositivo de saída padrão do Windows. |
| A voz do Discord aparece na transmissão | Marque o Discord em "Ignorar o som destes apps", na tela de transmitir. |
| "Não foi possível ignorar os apps escolhidos" | Confira a versão do Windows (precisa do 10 versão 2004 ou mais novo) e se o antivírus não bloqueou o `audiocap.exe`. |
| O microfone não funciona na voz | Permita o microfone para aplicativos de desktop nas configurações de privacidade do Windows. |
| O jogo perde FPS enquanto transmito | Use 720p 60 fps (ou 30 fps), transmita a janela do jogo e experimente "Uma vez só para todos". Veja [Desempenho](docs/desempenho.md). |
| A janela flutuante ou o chat não aparecem por cima do jogo | Coloque o jogo em modo janela sem bordas (tela cheia exclusiva fica por cima de tudo). |
| Borda amarela em volta da transmissão (Windows 10) | Já resolvido. Se alguma janela de jogo sair preta, transmita a Tela inteira. |

## Quem fez

Projeto de [MateusMunhoz](https://github.com/MateusMunhoz), com o chat de voz feito pelo Cristian ([Nyon0k](https://github.com/Nyon0k)). Usa [RNNoise](https://github.com/xiph/rnnoise) (supressão de ruído) e as fontes Bricolage Grotesque e Atkinson Hyperlegible. As licenças estão em `vendor/` e `native/third_party/`.
