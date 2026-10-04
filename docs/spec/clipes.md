# Clipe dos últimos segundos

Roadmap: P4. Clipe dos últimos 30 s

## Objetivo
Salvar no PC os últimos segundos de uma transmissão, como o "replay" do ShadowPlay/Medal: aconteceu algo, a pessoa
aperta o atalho e o que **já passou** vira um arquivo. Ninguém precisa apertar "gravar" antes da jogada.

## Escopo
- Entra (etapa A): modo "uma vez só" (`encode-once.js`), vídeo sem recodificar, MP4 em `Vídeos\Tela P2P\Clipes`;
  atalho global (Ctrl+Shift+C, em Voz e atalhos), tesoura na barra de cada transmissão, item no ícone da bandeja e
  aviso com **Mostrar na pasta**. Vale para quem você assiste e para a sua própria transmissão.
- Fica de fora (etapa B e depois): som da transmissão no clipe, duração configurável (15/30/60 s), modo "uma por
  pessoa" (WebRTC, precisaria de `MediaRecorder`), voz da call no clipe, "Mandar no chat".

## Comportamento esperado
- Enquanto chega vídeo no modo "uma vez só", o app guarda os últimos ~30 s na memória (`ClipBuffer`), sempre a partir de
  um quadro-chave. Nada vai para o disco até a pessoa salvar.
- A tesoura aparece na barra da transmissão quando já há pelo menos 1 s guardado.
- O atalho salva a transmissão em destaque; sem destaque, a única com clipe; senão a principal; senão a primeira de
  outra pessoa (a sua fica por último).
- O clipe começa no último quadro-chave antes dos 30 s: dura de 30 a ~38 s (quadro-chave a cada 4 s no WebCodecs e a
  cada 8 s, pedido pelo clipe, no NVENC).
- Salvo: aviso "Clipe salvo (32 s): Clipe - Ana - 2026-10-03 21-14-05.mp4" com **Mostrar na pasta**. Nome repetido
  ganha " (2)".
- Sem nada para clipar (modo "uma por pessoa", vídeo pausado, acabou de começar): aviso explicando.
- Vídeo pausado para você (app minimizado/coberto, "Só esta") não chega: o buffer recomeça quando o vídeo volta. A sua
  própria transmissão é sempre guardada no NVENC: ele não pausa mais sem ninguém assistindo (chip dedicado, quase sem
  custo). No WebCodecs ele continua parando sem ninguém, então sozinho não há clipe da própria tela.

## Restrições
- Sem recodificar e sem CPU extra: os pedaços H.264 (Annex B) que já chegam são convertidos para AVCC na hora de salvar.
- Pedir quadro-chave custa banda de quem transmite: no máximo um pedido a cada 8 s, e só se não veio nenhum nesse tempo.
- Memória: até ~38 s por transmissão, limite de 160 MB por buffer.
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
- [ ] Teste manual: clipe da própria transmissão (NVENC e WebCodecs) e de um amigo, abrindo no player do Windows.

## Testes
- Automáticos: `tests/clipes.test.js` (Annex B, avcC, buffer, MP4, gravação) e `npm run test:clipe` (WebCodecs de verdade).
- Manuais: transmitir em "Uma vez só", apertar Ctrl+Shift+C e abrir o arquivo no player do Windows; repetir assistindo
  um amigo.
