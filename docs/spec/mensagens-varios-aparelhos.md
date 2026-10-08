# Mensagens criptografadas em vários aparelhos

Status: Proposta (07/10/2026). Mexe na RazzeAPI, em `main/mensagens-cripto.js` e no IPC: precisa de plano aprovado
(`AGENTS.md`). Base: [mensagens-criptografadas.md](mensagens-criptografadas.md) e
[mensagens-conexao-direta.md](mensagens-conexao-direta.md). Motivo imediato: o app de Android (repositório
`nebula_app_android`, `docs/spec/00-proposta.md`).

## Objetivo
Hoje a chave pública das mensagens é **uma por conta** (`dm_keys`), e vale a do último aparelho que publicou. Com a
mesma conta em dois aparelhos, só um deles recebe as mensagens novas, e o outro passa a ver tudo como "não abre
neste PC". Com esta mudança, **cada aparelho tem a própria chave** e cada mensagem é cifrada para todos os
aparelhos de quem recebe e para os outros aparelhos de quem manda. PC, celular e um segundo PC leem as mesmas
conversas, e o servidor continua sem conseguir ler.

## Escopo
- **Entra:**
  - Lista de aparelhos por conta na RazzeAPI.
  - Formato `e2e2:` com a chave da mensagem embrulhada para cada aparelho.
  - Confiança (TOFU) por aparelho, com o aviso de aparelho novo.
  - **Conta › Aparelhos**, com Remover.
  - Sinais da conexão direta endereçados a um aparelho.
  - Convivência com os apps antigos (`e2e1:`).
- **Fica de fora:**
  - Ler num aparelho novo as mensagens de antes de ele existir. Se fizer falta, vira outra spec: trazer o
    histórico do PC por QR.
  - Sigilo das mensagens passadas se uma chave vazar (*forward secrecy*, que exige o protocolo do Signal).
  - Grupos.
  - Recifrar o que já está no servidor.
  - Verificar chaves por código de segurança.

## Comportamento esperado
1. **Atualizar o app de PC** não muda nada para a pessoa:
   - O PC registra a chave que **já tem** como o aparelho "PC" (`plataforma: "windows"` ou `"linux"`).
   - A chave é a mesma, então os amigos não veem "chave trocada".
2. **Entrar no celular com a mesma conta:**
   - O celular cria a chave dele e se registra como "Android".
   - A partir daí, as mensagens novas chegam e abrem no PC e no celular, inclusive as que a própria pessoa manda de
     qualquer um dos dois.
3. **O amigo ganha um aparelho:** na conversa aparece "Ana entrou num aparelho novo: Android". É uma linha de
   aviso, como a de chave trocada, só que neutra. As mensagens seguem normalmente.
4. **Conta › Aparelhos** lista os aparelhos da conta:
   - Nome, plataforma e quando foi visto pela última vez.
   - "Este aparelho" marcado; "Remover" nos outros, com confirmação.
   - Removido: as mensagens novas não vão mais para ele. O que ele já tinha baixado continua nele (avisar isso na
     confirmação).
5. **Perdeu o celular:** Remover pelo PC. O celular perdido não recebe mais nada novo. Se ele voltar a se
   registrar, por exemplo porque a sessão ainda vale, os amigos veem "aparelho novo". Para cortar de vez: remover o
   aparelho **e** revogar as sessões da conta (hoje só pela Administração; um "Sair de todos os aparelhos" para a
   própria pessoa pode entrar junto).
6. **Mensagem antiga (`e2e1`) num aparelho que não é o dono da chave:** aparece como hoje, "Não abre neste
   aparelho", com a dica "Abra no PC" quando a conta tiver um PC.
7. **Amigo em versão antiga (sem `dmKeys`):**
   - A mensagem sai em `e2e1` para a chave antiga dele, como hoje.
   - Ela não chega aos meus outros aparelhos. A conversa mostra uma vez: "Fulano está numa versão antiga: esta
     conversa só aparece neste aparelho até ele atualizar".

## Como funciona

### RazzeAPI
- **Tabela `dm_devices`:** `(user_id, device_id, public_key, nome, plataforma, created_at, seen_at)`.
  - Chave primária `(user_id, device_id)`; `public_key` única.
  - `device_id`: 16 hex, gerado pelo aparelho.
  - Até **10 aparelhos por conta**.
- **Rotas novas:**
  - `PUT /v1/me/dm-devices/:deviceId` `{ publicKey, nome, plataforma }`:
    - Registra o aparelho ou atualiza o `seen_at`.
    - `nome` até 40 caracteres, sem caracteres de controle.
    - `plataforma` só `windows`, `linux` ou `android`.
    - A chave tem 32 bytes em base64.
    - Erros: o 11º aparelho responde 409 `too_many_devices`, com a dica de remover um em Conta › Aparelhos; uma
      chave que já é de outro aparelho responde 409.
    - O app chama ao abrir e uma vez por dia.
  - `GET /v1/me/dm-devices` → `{ devices: [{ id, publicKey, nome, plataforma, createdAt, seenAt }] }`.
  - `DELETE /v1/me/dm-devices/:deviceId`, que vai para o `audit_log`.
- **Limpeza:** aparelho sem `PUT` há 180 dias sai sozinho.
- **`GET /v1/friends`:**
  - Cada amigo ganha `dmKeys: [{ id, publicKey, nome, plataforma }]`, ou `[]` se ele ainda não tem aparelhos.
  - O `dmKey` de hoje continua (para os apps antigos).
- **`PUT /v1/me/dm-key`** (de hoje) continua como está. Só o PC chama, e o Android nunca.
  - Ele é a chave legada: a que os amigos em versão antiga usam.
  - O PC novo continua publicando nela a mesma chave do aparelho dele.
- **Mensagens:** `POST /v1/messages` aceita `e2e2:<base64url>` até **12000** caracteres; o `e2e1:` continua até
  9000.
- **Sinais:** `POST /v1/signals` ganha `toDevice` e `fromDevice` opcionais (16 hex).
  - `GET /v1/signals?device=<id>` entrega e apaga só os sinais desse aparelho e os sem `toDevice` (apps antigos).
  - Hoje o primeiro aparelho que busca apaga a fila inteira, inclusive o que era do outro.
  - Limite: sobe de 30 para 60 sinais a cada 10 s por conta, porque a oferta vai para cada aparelho do amigo.

### Formato `e2e2`
```
e2e2: + base64url(
  [versão 2]
  [pública do aparelho que manda 32]
  [sal 16] [iv do corpo 12]
  [n 1]  n × ( [impressão do aparelho 8] [iv 12] [chave embrulhada 32 + tag 16] )
  [corpo cifrado] [tag do corpo 16]
)
```
- **Chave da mensagem:** `K` tem 32 bytes aleatórios. O corpo é AES-256-GCM(K) do texto, com todo o cabeçalho
  (até o fim da lista) como dado autenticado.
- **Embrulho para cada aparelho de destino:**
  - Destinos: todos os `dmKeys` do amigo e todos os meus aparelhos (`GET /v1/me/dm-devices`), inclusive este, para
    a enviada abrir aqui.
  - Chave do embrulho: `HKDF-SHA256(ECDH(privada deste aparelho, pública do destino), sal, "telap2p-dm-v2|<de>|<para>|<impressão>")`.
  - A chave do embrulho cifra `K` com AES-256-GCM.
  - **Impressão** = os 8 primeiros bytes do SHA-256 da chave pública do destino.
- **Abrir:**
  1. Achar a minha impressão na lista. Não está: `locked`, "não foi para este aparelho".
  2. Desembrulhar `K` com `ECDH(minha privada, pública de quem manda)`.
  3. Abrir o corpo.
  4. Só depois disso, confiar na pública de quem manda que veio no cabeçalho.
- **Limites ao abrir:** `n` entre 1 e 20; tamanho total coerente com `n`. Fora disso: `locked`, sem tentar.
- **Tamanho:** cada aparelho custa 68 bytes. Com 20 destinos, o cabeçalho tem uns 1,5 KB; 2000 caracteres de texto
  cabem em 12000.

### Escolha do formato ao mandar
| Amigo tem `dmKeys` | Amigo só tem `dmKey` | Amigo sem nenhum |
|---|---|---|
| `e2e2` para todos os aparelhos dele e os meus | `e2e1` para o `dmKey` (como hoje), só daqui | Não manda; pede para ele atualizar (como hoje) |

Abrir `e2e1` continua para sempre (histórico e amigos antigos).

### Confiança (TOFU) por aparelho
- **O que fica guardado:** em `mensagens/<conta>/chave.json`, `amigos[<conta>]` passa de uma chave para
  `{ aparelhos: { <impressão>: { publicKey, nome, plataforma, visto } } }`. Na migração, a chave antiga entra como
  um aparelho "PC".
- **Aparelho novo:** aparece na lista do servidor ou como remetente de uma mensagem que abriu. É fixado com a marca
  `aparelhoNovo` (o aviso do item 3).
- **Aparelho que sumiu da lista:** sai da lista local sem aviso. Se ele voltar com a mesma chave, conta como novo
  (aviso de novo).
- **`keyChanged` (o aviso de hoje):** fica só para quando a chave legada (`dmKey`) do amigo muda sem ele ter
  `dmKeys`.

### Conexão direta (`renderer/mensagens-direto.js`)
- A oferta vai cifrada **em `e2e1` para cada aparelho do amigo**, um sinal por aparelho, com `toDevice`. O `e2e1`
  já tem um destino só, então serve para isso.
- Quem responder primeiro fica com a conversa. As respostas seguintes, de outro aparelho, são ignoradas.
- O resto dos sinais vai só para o aparelho que respondeu (`fromDevice` da resposta).
- Amigo sem `dmKeys`: como hoje, sem `toDevice`.

### Onde mexe
- **RazzeAPI:** `razze-api/server.js` (tabela, rotas, `dmKeys` em `/v1/friends`, `e2e2`, sinais por aparelho) e
  `razze-api/control.js` (aparelhos na visão do banco, sem a chave pública por inteiro).
- **Cliente HTTP e serviço:** `main/razze-api-client.js` e `main/razze-service.js` (rotas novas).
- **Criptografia:** `main/mensagens-cripto.js` (aparelho e `device_id`, `e2e2` para mandar e abrir, confiança por
  aparelho, migração do `chave.json`).
- **IPC:** `main.js` e `preload.js`, para listar e remover aparelhos.
- **Interface:** `renderer/conta.js` (Conta › Aparelhos) e `renderer/mensagens.js` (avisos de aparelho novo e de
  amigo antigo).
- **Conexão direta:** `renderer/mensagens-direto.js` (oferta por aparelho).
- **Docs:** `docs/razze-api.md` e `docs/guia.md`.

## Restrições
- A chave privada nunca sai do processo principal (PC) nem do aparelho (Android, guardada com uma chave do Android
  Keystore).
- Nada que o servidor mande decide a confiança sozinho:
  - A lista de aparelhos do amigo só serve para cifrar.
  - Um aparelho novo sempre gera aviso.
  - A pública de quem manda só vale depois de a mensagem abrir.
- Servidor antigo (sem `dm-devices`, responde 404): o PC novo faz tudo como hoje (`e2e1`). O Android exige o
  servidor novo.
- **Ordem de publicação:** primeiro a RazzeAPI, depois o app de PC. O Android vem só depois de o PC novo estar na
  maioria dos amigos, porque sem isso as conversas deles só aparecem no PC.

## Critérios de aceitação
- [ ] PC atualizado: as conversas antigas abrem, os amigos não veem "chave trocada", e o PC aparece em Conta ›
  Aparelhos.
- [ ] Dois PCs (ou PC e Android) na mesma conta: uma mensagem recebida abre nos dois, e a enviada de um aparece e
  abre no outro.
- [ ] O amigo ganha um aparelho: aparece o aviso de aparelho novo uma vez, e as mensagens seguem.
- [ ] Remover um aparelho: as mensagens enviadas depois não abrem nele ("não foi para este aparelho").
- [ ] Amigo em versão antiga: a mensagem sai em `e2e1`, ele lê, e aparece o aviso de "só neste aparelho".
- [ ] O 11º aparelho é recusado com a dica de remover um.
- [ ] Conexão direta com o amigo em dois aparelhos: conecta com o primeiro que responder; o outro não recebe nem
  rouba sinais.
- [ ] Mensagem `e2e2` mexida (cabeçalho, lista ou corpo) não abre (`locked`).
- [ ] Servidor antigo: o PC novo funciona exatamente como hoje.

## Testes
- **Automáticos:**
  - `tests/mensagens-cripto.test.js`:
    - `e2e2` com 1, 2 e 20 destinos.
    - Abre em cada aparelho; não abre em quem não está na lista.
    - Corpo, lista e cabeçalho mexidos.
    - `n` fora do limite.
    - Migração do `chave.json` sem aviso de chave trocada.
    - Aparelho novo e aparelho removido.
    - A escolha `e2e1`/`e2e2` pela tabela acima.
  - `tests/razze-control.test.js`:
    - Rotas de aparelhos: limite de 10, chave repetida, remover vai para o `audit_log`, limpeza de 180 dias.
    - `dmKeys` só para amigos.
    - `e2e2` até 12000.
    - Sinais por aparelho: um aparelho não apaga os sinais do outro.
  - **Contrato com o Android:** vetores de teste em JSON (chaves, sal, iv, mensagem e resultado esperado) em
    `tests/fixtures/e2e2-vetores.json`. O repositório do Android usa os mesmos vetores, para os dois lados cifrarem
    e abrirem igual.
- **Manuais:**
  - Dois PCs na mesma conta e um amigo: mandar e receber nos três, remover um aparelho, conexão direta.
  - Um amigo em versão antiga.
  - Servidor antigo.
  - Depois, o mesmo roteiro com o Android.
