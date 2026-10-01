---
name: sala-webrtc
description: Como a sala do Tela P2P funciona - sinalização WebSocket, protocolo comum (sala-protocolo.js), troca de host, conexões WebRTC de tela e de voz, subsalas e modo Internet com TURN. Use ao implementar ou investigar algo em sala, entrar/sair, host, chat da sala, voz, subsalas, transmissão/assistir, ICE/STUN/TURN ou conexão que cai.
---

# Sala e WebRTC

## Peças
| Peça | Arquivo | Papel |
|---|---|---|
| Servidor da sala (Radmin/LAN/Razze) | `signaling.js` | WebSocket no app de quem criou a sala; só apresenta as pessoas |
| Servidor da sala (modo Internet) | `servidor-internet/server.js` | O mesmo papel numa VPS, com código + senha e acesso temporário ao TURN |
| Protocolo comum | `sala-protocolo.js` | Valida e trata cada mensagem para os dois servidores (`MAX_MEMBERS` 50, chat com 100 últimas, arquivos até 200 MB) |
| Cliente da sala | `renderer/sala.js` | Criar/entrar/sair, `onRoomMessage`, `handleSignal`, troca de host |
| Ajustes WebRTC | `renderer/rtc.js` | Opus estéreo, H.264 primeiro, bitrate, codec em uso |
| Config ICE | `renderer/estado.js` (`RTC_CONFIG`) | `iceServers` vazio em LAN/Radmin; no modo Internet vem do servidor (`welcome.iceServers`) |
| Tela | `renderer/transmitir.js` (quem transmite), `renderer/assistir.js` (quem assiste) | Uma conexão por par transmissor→espectador |
| Voz | `voice.js` (`VoiceChat`), `renderer/voz.js`, `renderer/microfone.js` | Conexão de voz separada da tela, por canal |
| Subsalas | `renderer/subsalas.js` + `subsala-*` no protocolo | Canal `''` = Voz geral; número = subsala. Só quem está no mesmo canal se conecta |

## Fluxo de mensagens
- Tudo da sala é JSON pelo WebSocket. Tipos tratados em `sala-protocolo.js`: `voice-state`, `subsala-create`,
  `subsala-delete`, `subsala-move`, `avatar`, `name-font`, `share`, `chat`, `signal`.
- `signal` só repassa dados WebRTC entre duas pessoas. No cliente, `handleSignal` separa por `data.side`:
  `voice` → `voice.receive`; `viewer` → vem de quem assiste a minha tela (subscribe/unsubscribe/restart/sdp/candidate);
  `sharer` → vem de quem transmite a tela que eu assisto; `update`, `file`, `foto` → atualização, arquivo do chat e
  foto de perfil, em pedaços pela sala.
- Mídia (tela, áudio, voz, arquivos) vai direto entre os PCs; nunca passa pelo servidor (no modo Internet, pode passar
  pelo TURN, cifrada por DTLS-SRTP).

## Troca de host (`migrateRoom` em `renderer/sala.js`)
1. A conexão cai: se não foi `host-left`, tenta voltar ao mesmo host 2 vezes.
2. Todos calculam a mesma fila (`successors()`, ordem de chegada). O primeiro chama `becomeHost()`: abre servidor novo
   na mesma porta (`window.api.startServer`, com chat, subsalas e `nextId`) e volta por `127.0.0.1`.
3. Os outros tentam os endereços que esse sucessor avisou, por até ~15 s cada.
4. Cada um volta com o mesmo número → as conexões diretas continuam e a tela não cai.
- Modo Internet não troca host: `reconnectCloud` tenta voltar ao servidor da VPS por ~18 s.

## Regras ao mexer
- Mensagem nova ou mudada: valide em `sala-protocolo.js` (tipo, tamanho, formato) e lembre que os dois servidores
  e versões antigas do app conversam com ela.
- Estado novo da sala precisa sobreviver à troca de host: passe-o em `becomeHost()` / `startServer`.
- Voz e tela são conexões independentes: mexer numa não pode derrubar a outra.

## Testes
- `npm test`: `signaling.test.js`, `subsalas.test.js`, `voice.test.js`, `servidor-internet.test.js`.
- `npm run test:rtc`: áudio WebRTC real entre duas janelas invisíveis.
- Windows (humano): `npm run test:e2e -- troca-de-host` / `voz` / `subsalas` / `religar` / `internet` / `chat`.
- Call real: `docs/roteiro-de-teste.md` (itens 1–8 voz, 11–13 sala).
