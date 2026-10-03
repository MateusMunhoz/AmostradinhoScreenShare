# Fundo do perfil (imagem ou GIF)

Issue: — · Roadmap: — · **Implementada** (o que mudou em relação ao plano está em "Como ficou", no fim)

## Objetivo
Cada pessoa escolhe uma imagem ou um GIF como fundo do próprio perfil: a caixinha que abre ao clicar na linha dela na
lista da voz e o perfil no mapa. Quem abre o seu perfil vê o seu fundo.

## Escopo
- Entra: escolher, trocar e tirar o fundo no Perfil; mostrar o fundo na caixinha da lista e no perfil do mapa
  (`renderSkyProfile`, `renderer/ceu-voz.js`), o seu e o dos outros.
- Fica de fora: fundo no cartão de volume (`#personCard`), no chat e na lista de pessoas; vídeo (MP4/WebM).

## Comportamento esperado
1. Perfil (painel do perfil) › nova linha **Fundo do perfil**, embaixo da foto: **Escolher imagem ou GIF**, e com um
   fundo escolhido, uma miniatura, **Trocar** e **Tirar**.
2. **Imagem** (PNG, JPG, WebP): recortada no formato da caixinha (cobrindo, centralizada), até 520×520, regravada em
   WebP (tira os metadados), diminuindo a qualidade até caber no limite.
3. **GIF**: vai do jeito que é (o navegador não regrava GIF animado), se couber no limite. Maior que o limite: "Este
   GIF é grande demais (máx. X). Tente um menor ou mais curto." Conferido antes de aceitar: cabeçalho GIF, abre como
   imagem, até 1024 px no lado maior.
4. Na caixinha e no mapa, o fundo cobre a área toda, com um véu escuro por cima (`var(--scrim)`) para o nome, os
   botões e o volume continuarem legíveis em qualquer imagem.
5. Quem ainda não tem o fundo de alguém vê a caixinha normal e o fundo aparece quando chega (sem travar a caixinha).
6. Versão antiga na sala: não pede nem responde; para ela, nada muda.

## Como o fundo viaja (a parte que precisa de aprovação)
Igual à foto de perfil (`renderer/fotos.js`), mas **sem mudar o servidor**: só mensagens diretas entre os PCs
(`sendSignal`, `{ type: 'signal', to, data }`, que o servidor da sala e o da VPS já repassam sem olhar o conteúdo).
- Ao abrir o perfil de alguém: `{ side: 'fundo', want: 'hash' }` → o dono responde `{ side: 'fundo', hash }` (vazio
  sem fundo).
- Se esse hash não está neste PC: `{ side: 'fundo', want: <hash> }` → `{ side: 'fundo', hash, data }` (base64).
- Quem recebe confere: só o que pediu, tamanho, base64 puro, SHA-256 igual ao hash, abre como imagem dentro dos
  limites (mesmas regras de `onPhotoSignal`). Guarda na memória por hash (não enche o PC); o seu fica em
  `localStorage` (`fundoPerfil`).
- Trocar o fundo com alguém olhando: quem está com a sua caixinha aberta pede de novo ao reabrir (o hash mudou).

## Restrições
- **Tamanho:** uma mensagem da sala tem até 256 KB, então o fundo (já em base64) cabe em **170 KB** de arquivo, o
  mesmo limite da foto inteira. Para imagem é folgado; para GIF é pouco (GIFs costumam ter de 1 a 5 MB). Ver
  "Decisão pendente".
- **Animação contínua** (regra do renderer: o app roda junto com jogos): o GIF só anima **enquanto a caixinha está
  aberta**, e some da página ao fechar. Com "reduzir movimento" do Windows, mostra só o primeiro quadro.
- CSP: o fundo entra como `data:` URL num `background-image` definido por JS (como a foto), sem estilo inline no
  HTML. Cores só por tokens.
- Validação de tudo que chega (invariante 5 do AGENTS.md), como acima.

## Decisão pendente
- **Limite do GIF.** (a) 170 KB numa mensagem só: simples, mas só GIFs pequenos. (b) até ~1 MB em pedaços de 150 KB
  (`{ side: 'fundo', hash, part, of, data }`), remontados e conferidos pelo hash no fim: GIFs comuns cabem, mais
  código e mais tráfego na sala na primeira vez que alguém abre o seu perfil.
- **Celular:** levar o fundo junto nas configurações do celular (`renderer/celular-modelo.js`, item `fundoPerfil`)?

## Dependências
`renderer/fotos.js` (ou `renderer/fundo-perfil.js` novo, depois de `fotos.js`, em `PACK_FILES`), `renderer/sala.js`
(roteia `side: 'fundo'`), `renderer/ceu-voz.js` (`renderSkyProfile`), `index.html` (linha no Perfil), `styles.css`,
`publicar.js` se houver arquivo novo, `docs/guia.md`.

## Critérios de aceitação
- [ ] Escolher imagem ou GIF no Perfil; a miniatura aparece; Tirar volta ao normal; fica salvo ao reabrir.
- [ ] Outra pessoa na sala, abrindo o meu perfil (lista ou mapa), vê o meu fundo; o GIF anima só com a caixinha aberta.
- [ ] Hash errado, arquivo que não é imagem, acima do limite ou não pedido: ignorado.
- [ ] Sala com versão antiga: nada quebra.

## Testes
- Automáticos: validação do fundo recebido (hash, tamanho, tipo) e, se for por pedaços, remontagem fora de ordem e
  pedaço faltando; `npx electron tests/e2e/carga.cjs`; foto da caixinha com fundo numa janela invisível.
- Manuais: dois PCs na sala com imagem e com GIF; "reduzir movimento" ligado; sala com versão antiga.

## Como ficou
- Limite: **1 MB**, em pedaços de 200 mil caracteres de base64 (`{ side: 'fundo', hash, mime, part, of, data }`),
  remontados e conferidos pelo hash (opção b da decisão pendente). Em `renderer/fundo-perfil.js`, depois de `fotos.js`.
- Imagem vira um quadrado de 520 px em WebP (até 300 KB); GIF vai como é, até 1024 px de lado.
- Quem manda não repete o mesmo arquivo para a mesma pessoa em menos de 10 s; quem recebe guarda até 30 fundos na
  memória e desiste de um arquivo incompleto depois de 30 s (pede de novo ao reabrir o perfil).
- O primeiro quadro do GIF (para "reduzir movimento" e o modo gamer) é feito no PC de quem vê.
- Vai nas configurações do celular (`fundoPerfil`, conferido pelo hash); o limite do arquivo do celular subiu para 4 MB.
- Na caixinha da lista, o botão **Perfil** saiu (abria outro perfil por cima) e no lugar dele ficou **Voltar ao padrão**
  (o volume da pessoa). No mapa, o perfil continua como era, com **Perfil**.
