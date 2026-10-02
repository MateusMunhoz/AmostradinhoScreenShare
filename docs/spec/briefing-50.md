# Briefing para 50+ pessoas (teste de carga)

Issue: — · Roadmap: **B0, prioridade máxima** (ver [roadmap](../roadmap.md#b0-briefing-para-50-pessoas))

> **Por que é a meta mais importante:** é o primeiro uso real em escala. Se 50 pessoas assistirem a um briefing
> de missão do DCS sem travar e sem servidor obrigatório, o Tela P2P prova o que o Discord não entrega de graça.
> Tudo o que vem antes no roadmap (cripto, amigos, entrar sem VPN) existe para esse dia funcionar.

## Objetivo
Uma pessoa mostra a tela do briefing (mapa F10, kneeboard, slides) e fala. **50+ pessoas** assistem e ouvem, e quem
tem pergunta levanta a mão. Tudo **sem servidor obrigatório**: a VPS do modo Internet entra só como último recurso.

## O cenário (não é o jogo, é o briefing)
- Tela quase parada, com texto pequeno que precisa ficar legível. Pede **nitidez**, não fps.
- Uma voz principal. Perguntas pontuais, uma por vez.
- Chat ativo (50 pessoas digitando).
- Duração típica de 30 a 90 min.

## Estratégia em camadas (servidor só no fim)
| Camada | O que é | Situação no código |
|---|---|---|
| 1. Modo Briefing | 1080p a 5–10 fps, `contentHint = 'detail'`, modo "uma vez só" (codifica 1 vez e manda os mesmos pedaços para todos) | `encode-once.js` existe; falta o perfil leve |
| 2. Host forte | Quem apresenta manda 1 cópia para o amigo com a melhor fibra, e ele distribui | Não existe |
| 3. Corrente de espectadores | Quem tem folga repassa para mais 2–3 (é o P3 do roadmap) | Não existe |
| 4. Voz "palco" | Só o apresentador fala; a voz vai junto com o vídeo; "levantar a mão" dá o microfone na vez | `renderer/palco.js` existe (conferir o que já faz); a voz hoje é malha (`voz.js`) |
| 5. Reserva | VPS (TURN/SFU) só para quem não conecta direto | `servidor-internet/` (TURN) existe |

**Conta de banda (estimativa, a medir):** briefing leve ≈ 1 Mbps × 50 ≈ **50–60 Mbps de upload** com a camada 1
sozinha. Uma fibra boa de casa aguenta; com as camadas 2 e 3, qualquer upload aguenta.

## Escopo
- Entra: perfil Modo Briefing, voz palco, distribuição por host forte e corrente, teste forjado com 50 clientes,
  teste real.
- Fica de fora: várias câmeras ao mesmo tempo, celular (D2), gravação do briefing (P4 pode ajudar depois).

## Fatos confirmados no código
- `MAX_MEMBERS = 50` em `sala-protocolo.js` (o roadmap ainda fala em 12, está desatualizado). Para **50+**, subir
  para uns 60 e testar.
- Sinalização: no PC do host (`signaling.js`) ou na VPS (`servidor-internet/server.js`), as duas com o mesmo
  `sala-protocolo.js`.
- A voz é malha: com 50 pessoas seriam 49 conexões por PC. **Inviável sem o modo palco.**

## A validar com teste (ainda é hipótese)
- Bitrate real de um briefing do DCS no perfil leve (meta ≤ 1,5 Mbps com o texto legível).
- CPU e memória do PC de quem distribui com 50 DataChannels.
- Upload real da melhor fibra do grupo.
- Atraso de ponta a ponta na corrente (meta ≤ 2 s, o que basta para briefing).
- O servidor da sala aguenta 50+ sockets e o chat com rajadas.

## Plano de teste
**Fase A, forjado (antes de chamar gente):**
1. Medir o bitrate de um briefing gravado (vídeo do F10/kneeboard) passado pelo perfil leve.
2. "Robôs espectadores": vários clientes headless por PC (e2e com Electron ou um cliente Node só de DataChannel)
   até somar 50+, em 3 ou 4 PCs.
3. Medir no distribuidor: upload, CPU, quadros perdidos, atraso (A2 ajuda) e o tempo para um espectador entrar.
4. Derrubar 10% dos robôs no meio e ver a corrente se recompor em < 2 s.

**Fase B, gente de verdade (depois dos protocolos de rede prontos):**
1. 15 amigos em redes diferentes (fibra, 4G/CGNAT).
2. 50+ pessoas num briefing real, com roteiro em `docs/roteiro-de-teste.md`.

## Critérios de aceitação
- [ ] 50 robôs recebem o briefing legível por 30 min sem travar (Fase A).
- [ ] Upload do apresentador ≤ 60 Mbps no modo leve, ou ≤ 10 Mbps com host forte ou corrente.
- [ ] Voz do apresentador chega a todos; levantar a mão funciona; nenhuma malha de 50.
- [ ] Ninguém precisa de Radmin/Hamachi; VPS só para quem não conectou direto (contado e mostrado).
- [ ] 50+ pessoas reais num briefing de verdade (Fase B).

## Dependências
A1 (cripto), Hyperswarm/entrar sem VPN (P1 fase 2), amigos e lobby novos, P3 (corrente). Ver a ordem no roadmap.
