# Mensagens privadas: conexão direta, arquivos, prazo do histórico e backup no celular

Status: Implementada (ainda sem versão publicada)

## Objetivo
Na mensagem privada, mandar imagens e arquivos como no chat da sala, sem que eles passem pelo servidor. Para isso a
conversa ganha uma conexão direta entre os dois PCs; a RazzeAPI fica só como reserva para o texto. Cada pessoa
escolhe se o histórico neste PC dura 30 dias ou para sempre, e pode levar o histórico no backup do celular.

## Escopo
- Entra: conexão direta por conversa (texto e arquivos), volta para a RazzeAPI só com texto, anexar e arrastar
  arquivos/imagens na conversa, aba **Mensagens privadas** nas Configurações (prazo do histórico e backup no celular),
  histórico no arquivo do celular (opcional, desligado por padrão).
- Fica de fora: arquivos pela RazzeAPI (nunca), arquivos para quem está offline, conversa em grupo, imagens no
  backup do celular (só o texto), sincronizar o histórico entre PCs.

## Comportamento
1. **Dois modos.** Ao abrir uma conversa com um amigo online, o app tenta a conexão direta. Enquanto ela está de pé,
   texto e arquivos vão por ela. Se não der (amigo offline, rede que não deixa, app antigo do outro lado), o texto
   vai pela RazzeAPI, cifrado de ponta a ponta como hoje. O chip da conversa mostra o modo: "Direto" ou "Pelo servidor".
2. **Arquivos.** Botão de anexar (clipe), colar (Ctrl+V) e arrastar, como no chat da sala, até 200 MB. Só com a
   conexão direta: sem ela, o anexar fica desativado com o motivo ("Arquivos só pela conexão direta: Fulano está
   offline"). Imagem (png, jpeg, gif, webp) até 8 MB chega sozinha e aparece na conversa; outro arquivo chega como
   cartão com **Baixar** (vem direto do PC de quem mandou, enquanto ele estiver com a conexão aberta) e **Salvar**.
3. **Prazo do histórico** (Configurações › Mensagens privadas): **Guardar para sempre** (padrão, como hoje) ou
   **Apagar depois de 30 dias**. Vale só para este PC: mensagens e imagens guardadas com mais de 30 dias saem ao
   abrir o app e a cada gravação.
4. **Backup no celular** (mesma aba): caixinha **Levar as mensagens privadas no backup do celular** (desligada por
   padrão). Ligada, o "Guardar no celular" inclui o texto das conversas da conta Razze atual (sem imagens nem
   arquivos), cifrado com a mesma senha. No "Trazer do celular", o resumo mostra "N conversas" e o Aplicar junta com
   o histórico deste PC (pela id de cada mensagem; nada é apagado). Só junta se a conta Razze for a mesma.

## Como funciona
- **Por que não uma sala comum:** o app só fica em uma sala por vez; uma sala escondida para a conversa tiraria a
  pessoa da sala em que está (ou impediria de entrar em outra). A "sala só da conexão" é então uma
  `RTCPeerConnection` própria da conversa (`renderer/mensagens-direto.js`), fora do estado da sala, com um
  `RTCDataChannel` ordenado. Funciona com a Razze, a Radmin e a rede local (candidatos do próprio PC); no modo
  Internet usa o STUN que o servidor da aba Rede passa no `info` (o TURN só dentro de uma sala Internet, que traz as
  credenciais dele).
- **Sinalização:** a oferta e a resposta (SDP e candidatos) vão cifradas de ponta a ponta (`mensagens-cripto.js`,
  info `telap2p-dm-sinal-v1`) por uma rota nova e curta da RazzeAPI, `POST/GET /v1/signals`: só entre amigos, até
  16 KB, apagada ao ser lida ou em 2 minutos, fora do histórico. Como a impressão digital DTLS vai dentro da
  oferta cifrada, só o amigo dono da chave fixada consegue fechar a conexão. RazzeAPI antiga (404): só o modo pelo
  servidor, sem arquivos.
- **Quem liga:** quem tem a id menor oferece (evita duas ofertas cruzadas); a outra ponta só responde. Tenta ao abrir
  a conversa, ao ver o amigo ficar online e ao mandar algo; desiste depois de 15 s e tenta de novo em 1 min.
- **Protocolo no canal** (validado como em `sala-protocolo.js`): `msg { id, text, createdAt }` (até 2000 caracteres),
  `ack { id }`, `msg` com `file { id, name, size, mime }` (o anúncio do arquivo), `quero { id }`, `parte { id, n,
  total }` + bytes (64 KB, com controle de `bufferedAmount`), `cancela { id }`, `indisponivel { id }`. Mensagem sem
  `ack` em 5 s (ou com o canal caindo) vai pela RazzeAPI e a cópia direta dá lugar à do servidor. Se o `ack` só se
  perdeu, quem recebe pode ver a mensagem duas vezes (raro: precisa a conexão cair nesse meio segundo).
- **Histórico:** as mensagens diretas entram no mesmo arquivo cifrado (`main/mensagens.js`) com a marca `direto`.
  Imagens recebidas ficam em `mensagens/<conta>/anexos/<id>`, cifradas (AES-256-GCM com uma chave guardada com o
  `safeStorage`), até 8 MB cada; outros arquivos não ficam guardados pelo app.
- **IPC novo** (`preload.js`/`main.js`): `dm-signal-send`, `dm-signals` (cifra e decifra no main, como as mensagens),
  `dm-retencao` (dias: 0 ou 30), `dm-imagem-salvar`/`dm-imagem-ler` (id validada, só png/jpeg/gif/webp, até 8 MB),
  `dm-exportar`/`dm-importar` (texto das conversas da conta, para o backup).
- **Imagens guardadas:** com o `safeStorage`, como o histórico (`{ v: 2, sealed }`), em vez de uma chave AES própria.
- **Backup:** `renderer/celular-modelo.js` ganha o item `mensagens` (só com a caixinha ligada); o limite do arquivo
  sobe de 4 MB para 16 MB (`celular-modelo.js` e o envio em `main/celular.js`). Passando disso, vão as mensagens
  mais novas e o resumo avisa quantas ficaram de fora.

## Compatibilidade
- Amigo com app antigo: não responde à oferta; tudo vai pela RazzeAPI, sem arquivos.
- RazzeAPI antiga: sem `/v1/signals`; só texto pelo servidor, como hoje.
- Arquivo de backup antigo (sem `mensagens`) continua abrindo; app antigo abrindo arquivo novo ignora o item.

## Testes
- Automáticos: `tests/mensagens.test.js` (prazo de 30 dias, imagens guardadas, exportar e juntar), `tests/mensagens-cripto.test.js`
  (sinal cifrado, entregue uma vez, chave trocada recusa o sinal), `tests/razze-control.test.js` (rota `/v1/signals`: só
  amigos, só cifrado, tamanho, some depois de lida e em 2 min), `tests/celular.test.js` (item `mensagens`, limite e
  as mais novas primeiro), `tests/preferencias.test.js` (prazo e caixinha do backup), e2e
  `npx electron tests/e2e/mensagens-direto.js` (dois apps na mesma máquina, sinais por uma ponte do teste: conexão
  direta, texto, imagem que chega sozinha, arquivo com Baixar, queda e o clipe apagado).
- Manuais: dois PCs com contas amigas pela Razze, pela Radmin e pelo modo Internet; um deles sem a RazzeAPI nova;
  backup no celular com histórico e restauração em outro PC.
