# Mensagens diretas criptografadas de ponta a ponta

Status: Implementada (1.14.0)

## Objetivo
As mensagens diretas passavam em texto pela RazzeAPI: quem cuida do servidor conseguia ler. Agora só quem manda e
quem recebe leem. O histórico guardado no PC também fica protegido.

## Escopo
- Entra: chave por conta em cada PC, publicação da chave pública, cifrar no envio, decifrar na busca, aviso de chave
  trocada, recusa de mandar para quem não tem chave, histórico local cifrado.
- Fica de fora: ler no PC novo as mensagens que foram para a chave antiga; a mesma conta em dois PCs lendo tudo
  (cada PC tem a própria chave e só o último que publicou recebe as novas); "código de segurança" para comparar
  chaves; cifrar as mensagens antigas que já estão no servidor (somem em até 30 dias).

## Como funciona
- **Onde:** `main/mensagens-cripto.js`, no processo principal, entre o IPC (`razze-send-message`, `razze-messages`)
  e a RazzeAPI. A janela continua mandando e recebendo texto normal; a chave privada nunca sai do processo principal.
- **Chaves:** um par X25519 por conta, em `mensagens/<conta>/chave.json`; a privada selada com o `safeStorage` (sem
  ele, como no Linux sem chaveiro, fica só com permissão 600). Também ficam ali as chaves fixadas dos amigos.
  A pública vai uma vez por conta para `PUT /v1/me/dm-key` (servidor antigo responde 404: o app só lembra).
- **Mensagem:** ECDH(privada minha, pública do amigo) → HKDF-SHA256 (sal aleatório de 16 bytes, info
  `telap2p-dm-v1|<de>|<para>`) → AES-256-GCM (iv de 12 bytes). Texto enviado: `e2e1:` + base64url de
  `[1][pública de quem manda 32][pública de quem recebe 32][sal 16][iv 12][cifrado][tag 16]`, com o cabeçalho como
  dado autenticado. Quem mandou também abre (o mesmo segredo), então as enviadas voltam legíveis neste PC.
- **Envio:** busca a chave atual do amigo (`/v1/friends`) a cada envio. Sem chave: não manda e o erro pede para o
  amigo atualizar (ou o servidor, se ele não tem a rota).
- **Chave do amigo:** fixada na primeira vez (TOFU). Se a do servidor ou a de uma mensagem que abriu for outra, a
  mensagem vem com `keyChanged` e a conversa mostra o aviso. A chave de quem mandou só é fixada depois de a mensagem
  abrir (o cabeçalho só é confiável depois da autenticação).
- **Marcas para a janela:** `e2e` (veio cifrada), `plain` (veio em texto: de antes), `locked` (não abre neste PC,
  ou foi mexida), `keyChanged`. Ficam também no histórico local.
- **Histórico local** (`main/mensagens.js`): arquivo `{ v: 2, sealed }` com o `safeStorage`; o arquivo antigo em
  texto ainda abre e é cifrado na próxima gravação.
- **RazzeAPI:** tabela `dm_keys` (uma pública por conta), `dmKey` em `/v1/friends`, e mensagens `e2e1:` até 9000
  caracteres (texto comum continua até 2000).

## Compatibilidade
- App antigo (sem chave): não recebe mensagens de quem atualizou; quem atualizou vê o aviso para ele atualizar.
- App antigo recebendo de quem atualizou: não acontece (a mensagem não sai sem a chave dele).
- RazzeAPI antiga: sem a rota da chave nem o `dmKey`; nenhuma mensagem sai, com o aviso para atualizar o servidor.
- Mensagens antigas no servidor e no histórico: continuam legíveis; as do servidor aparecem com "sem criptografia".

## Testes
- Automáticos: `tests/mensagens-cripto.test.js` (o servidor só vê `e2e1:`, os dois leem, a privada fica selada,
  amigo sem chave, chave trocada, mensagem para a chave antiga não abre no PC novo, mensagem mexida não abre, antiga
  marcada, e o caminho completo com a RazzeAPI e o cliente de verdade), `tests/mensagens.test.js` (histórico cifrado
  e o antigo ainda abre), `tests/razze-control.test.js` (rota da chave, só para amigos, limites de tamanho).
- Manuais: dois PCs com contas amigas e a RazzeAPI atualizada: mandar e receber; um deles reinstala (aviso de
  chave trocada); um amigo ainda na versão antiga (a mensagem não sai, com o aviso).
