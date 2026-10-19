# Assistir pelo navegador (celular, só assistir)

Issue: a abrir · Roadmap: D2 (item 6) · **Rascunho.** Esta spec nasceu da linha do roadmap; o que está em "Perguntas em aberto" precisa de decisão antes de começar.

## Objetivo
Convidar alguém para ver uma transmissão sem pedir que instale o Nebula. A pessoa abre um endereço no celular, entra com o código e a senha da sala (ou por um link com passe) e assiste. Também é a porta de entrada do B0 (briefing para 50+ pessoas).

## Escopo
- Entra: página estática servida pela VPS, por HTTPS; entrada por código e senha ou por link com passe; uma transmissão em WebRTC comum (H.264).
- Fica de fora (primeira versão): voz, chat, login e conta, transmitir pelo navegador, várias telas ao mesmo tempo.

## Comportamento esperado
1. Quem transmite copia o link da sala no app; ele abre a página no navegador do celular.
2. A página pede código e senha (ou já entra, se o link traz o passe).
3. Entrando, aparece a transmissão em tela cheia, com um botão para sair. Sem transmissão, "Ninguém está transmitindo agora".
4. Senha errada, sala fechada e sem rede mostram mensagem clara em português e deixam tentar de novo.

## Restrições
- Só funciona atrás de HTTPS (item 4 do roadmap): navegador de celular exige contexto seguro para WebRTC.
- A sinalização é a mesma do modo Internet (`servidor-internet/`, `sala-protocolo.js`): quem assiste entra como membro somente-leitura e não aparece como pessoa na voz.
- CSP sem CDN. Sem coleta de dados.
- O vídeo sai do PC de quem transmite (ou do TURN). Cada espectador no navegador conta como mais um no upload (veja `docs/desempenho.md`); com muitos, depende do P3 (espectadores repassando).

## Dependências
- Item 4 (HTTPS/Caddy na VPS), `servidor-internet/server.js`, `sala-protocolo.js` (papel "espectador"), `renderer/rtc.js` (H.264 primeiro).

## Perguntas em aberto
- Quem assiste conta na lista da sala? Aparece com um nome genérico ou invisível?
- Limite de espectadores no navegador enquanto não existe o P3.
- O passe do link vale por quanto tempo e pode ser revogado? (a ideia segue o passe das salas dos amigos: `docs/spec/salas-dos-amigos.md`)
- Áudio da transmissão (som do jogo) vai junto?

## Critérios de aceitação
- [ ] Do celular, sem instalar nada, com código e senha, vejo a transmissão em até 10 s.
- [ ] Senha errada e sala inexistente dão mensagens diferentes e claras.
- [ ] Sair da página não derruba a transmissão nem aparece como erro para quem transmite.

## Testes
- Automáticos: servidor com espectador somente-leitura (papel não manda `voice-state`, `chat` nem `signal` de voz); página estática carrega sob a CSP.
- Manuais: celular Android e iPhone na rede de dados, com e sem TURN.
