# Clipe dos últimos segundos

Roadmap: P4. Clipe dos últimos 30 s (feito: etapas A e B)

## Objetivo
Salvar no PC os últimos segundos de uma transmissão, como o "replay" do ShadowPlay/Medal: aconteceu algo, a pessoa
aperta o atalho e o que **já passou** vira um arquivo. Ninguém precisa apertar "gravar" antes da jogada.

## Escopo
- Etapa A: modo "uma vez só" (`encode-once.js`), vídeo sem recodificar, MP4 em `Vídeos\Tela P2P\Clipes`; atalho global
  (Ctrl+Shift+C, em Voz e atalhos), tesoura na barra de cada transmissão, item no ícone da bandeja e aviso com
  **Mostrar na pasta**. Vale para quem você assiste e para a sua própria transmissão.
- Etapa B: som da transmissão (AAC; sem AAC, Opus), duração 15 s / 30 s / 1 min / 2 min (Voz e atalhos › Clipe,
  `localStorage.clipSeconds`), modo "uma por pessoa" (a faixa WebRTC é codificada de novo só para o clipe) e "Uma vez
  só" como padrão de transmissão (`localStorage.encodeMode2`; a chave antiga `encodeMode` guardava "uma por pessoa" só
  por ser o padrão de antes).
- Fica de fora: voz da call no clipe, "Mandar no chat".

## Comportamento esperado
- Enquanto chega vídeo no modo "uma vez só", o app guarda os últimos ~30 s na memória (`ClipBuffer`), sempre a partir de
  um quadro-chave. Nada vai para o disco até a pessoa salvar.
- A tesoura aparece na barra da transmissão quando já há pelo menos 1 s guardado.
- O atalho salva a transmissão em destaque; sem destaque, a única com clipe; senão a principal; senão a primeira de
  outra pessoa (a sua fica por último).
- O clipe começa no último quadro-chave antes do tempo escolhido: no "uma vez só", até 4 s a mais no WebCodecs e 8 s no
  NVENC (quadro-chave pedido pelo clipe); no "uma por pessoa", até 2 s (o codificador do clipe faz um a cada 2 s).
- Som: a faixa de som da transmissão passa por um `AudioEncoder`; entra alinhada pelo relógio deste PC (a hora de
  chegada de cada quadro e de cada pedaço de som). Sem som na transmissão, o clipe sai só com vídeo e o aviso diz
  "sem som".
- "Uma por pessoa": `MediaStreamTrackProcessor` + `VideoEncoder`, pela placa no tamanho que chega ou, sem ela, pelo
  processador em até 720p a 30 quadros. Os gravadores ligam e desligam a cada 2 s conforme as transmissões abertas
  (`syncClips`).
- Salvo: aviso "Clipe salvo (32 s): Clipe - Ana - 2026-10-03 21-14-05.mp4" com **Mostrar na pasta**. Nome repetido
  ganha " (2)".
- Sem nada para clipar (vídeo pausado, acabou de começar, PC sem codificador H.264 no "uma por pessoa"): aviso explicando.
- Vídeo pausado para você (app minimizado/coberto, "Só esta") não chega: o buffer recomeça quando o vídeo volta. A sua
  própria transmissão é sempre guardada no NVENC: ele não pausa mais sem ninguém assistindo (chip dedicado, quase sem
  custo). No WebCodecs ele continua parando sem ninguém, então sozinho não há clipe da própria tela.

## Restrições
- No "uma vez só", sem recodificar e sem CPU extra: os pedaços H.264 (Annex B) que já chegam são convertidos para AVCC na hora de salvar.
- Pedir quadro-chave custa banda de quem transmite: no máximo um pedido a cada 8 s, e só se não veio nenhum nesse tempo.
- Memória: a duração escolhida mais a folga do quadro-chave, limite de 400 MB por buffer (2 min em 1080p: 100 a 200 MB).
- "Uma por pessoa" recodifica enquanto você assiste, mesmo sem salvar: pela placa quase não pesa; pelo processador,
  720p a 30 quadros por transmissão assistida.
- CSP: o `mp4-muxer` fica em `vendor/` (sem CDN).
- A página não escolhe caminho: o processo principal grava só em `Vídeos\Tela P2P\Clipes`, com nome limpo, até 300 MB,
  e "mostrar na pasta" só abre clipes que ele mesmo salvou.

## Dependências
- `encode-once.js` (ganchos `clipFeed`, `clipGap`, `clipDrop`), `renderer/clipe-mp4.js`, `renderer/clipes.js`,
  `renderer/assistir.js` (tesoura), `renderer/util.js` (aviso com botão), `vendor/mp4-muxer/`.
- `main/clipes.js`, IPC `clip-save` e `clip-show` (`main.js`, `preload.js`), atalho `clip` (`main/atalhos.js`),
  item da bandeja (`main/bandeja.js`).

## Critérios de aceitação
- [x] O MP4 abre num `<video>` e termina no último segundo guardado (`tests/e2e/clipe.cjs`).
- [x] Começa num quadro-chave; tempo voltando, SPS novo e pedaço perdido não geram arquivo quebrado.
- [x] Gravação com nome limpo, sem sobrescrever, e "mostrar" só para clipes do app.
- [x] Som entra no arquivo e toca (`tests/e2e/clipe.cjs`).
- [x] "Uma por pessoa": faixa ao vivo vira MP4 com som; sem placa, 1080p sai em 720p (`tests/e2e/clipe-faixa.cjs`).
- [ ] Teste manual: clipe da própria transmissão (NVENC e WebCodecs) e de um amigo nos dois modos, com som, no player do Windows.

## Testes
- Automáticos: `tests/clipes.test.js` (Annex B, avcC, buffers de vídeo e som, MP4 com e sem som, gravação) e
  `npm run test:clipe` (WebCodecs de verdade: `clipe.cjs` e `clipe-faixa.cjs`).
- Manuais: transmitir em "Uma vez só", apertar Ctrl+Shift+C e abrir o arquivo no player do Windows; repetir assistindo
  um amigo.
