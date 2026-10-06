# RazzeAPI

A RazzeAPI é o serviço central do Tela P2P. Ela guarda contas, amizades, redes, convites, dispositivos WireGuard e endpoints públicos descobertos por STUN. O cliente Electron inclui o binário oficial assinado do WireGuard para criar a interface VPN no Windows.

## Executar localmente

O servidor requer Node.js 24 ou superior. Usa `node:sqlite`, incluído no Node; esse módulo ainda é experimental nesta versão do runtime. Na raiz do repositório, execute `npm run razze-api`. Para implantar só o serviço central, copie a pasta `razze-api` para a VPS e execute `npm start` dentro dela; o servidor não depende das bibliotecas Electron do cliente.

```powershell
$env:RAZZE_ADMIN_TOKEN = 'gere-um-segredo-aleatorio-com-mais-de-30-caracteres'
$env:RAZZE_API_HOST = '127.0.0.1'
$env:RAZZE_API_PORT = '8787'
$env:RAZZE_STUN_HOST = '0.0.0.0'
$env:RAZZE_STUN_PORT = '3478'
$env:RAZZE_DB_PATH = 'D:\razze\data\razze.sqlite'
npm run razze-api
```

Por padrão, a API escuta em `127.0.0.1:8787`, o STUN UDP em `0.0.0.0:3478` e o banco em `razze-api/data/razze.sqlite`. Em produção, publique a API atrás de um proxy TLS e exponha UDP 3478 para STUN. Use disco persistente para o banco e restrinja o acesso ao banco e aos backups.

## Publicar numa VPS com Docker Compose

O diretório `razze-api` inclui um Compose com a API, banco persistente, STUN UDP e Caddy para emitir e renovar HTTPS automaticamente. Aponte um registro DNS `A` para o IP da VPS antes de subir os containers.

```sh
cd razze-api
cp .env.example .env
```

Edite `.env`: defina o hostname real em `API_DOMAIN` e substitua o valor de exemplo de `RAZZE_ADMIN_TOKEN` por um segredo novo. Gere-o com `openssl rand -base64 36`. Libere no firewall da VPS as portas TCP 80 e 443, além da UDP 3478; UDP 443 só é usada para HTTP/3.

```sh
docker compose up -d --build
docker compose logs -f razze-api caddy
curl -fsS https://api.seudominio.com/v1/health
```

O serviço HTTP fica apenas na rede interna do Compose; o Caddy publica HTTPS e sobrescreve `X-Forwarded-For` com o IP do cliente para o limite de tentativas por endereço funcionar sem confiar em cabeçalhos enviados pelo próprio cliente. O SQLite, os dados TLS do Caddy e sua configuração ficam em volumes persistentes. Guarde `.env` e backups fora do controle de versão.

Para aprovar contas pela rota administrativa, use `RAZZE_ADMIN_TOKEN` apenas na máquina de administração. Configure-o temporariamente no terminal onde executará as chamadas abaixo; não o coloque no Tela P2P.

Por padrão, o cadastro fica pendente até aprovação administrativa. O painel `/admin/` permite ativar aprovação automática para novos cadastros; contas já pendentes continuam aguardando aprovação. Configure `RAZZE_ADMIN_TOKEN` com um segredo aleatório de pelo menos 30 caracteres antes de iniciar o serviço. Guarde esse segredo fora do cliente Electron.

O serviço limita tentativas de cadastro por IP e login por IP. Se estiver atrás de proxy reverso, habilite `RAZZE_TRUST_PROXY=1` somente quando o proxy sobrescrever `X-Forwarded-For` com o endereço real do cliente.

Exemplo para listar usuários e aprovar uma conta pelo PowerShell:

```powershell
$headers = @{ Authorization = "Bearer $env:RAZZE_ADMIN_TOKEN" }
Invoke-RestMethod -Headers $headers -Uri 'https://api.seudominio.com/v1/admin/users'
Invoke-RestMethod -Method Post -Headers $headers -Uri 'https://api.seudominio.com/v1/admin/users/ID_DA_CONTA/approve'
Invoke-RestMethod -Headers $headers -Uri 'https://api.seudominio.com/v1/admin/networks'
```

## Endpoints

Todas as respostas usam JSON. Erros seguem `{ "error": { "code": "...", "message": "..." } }`. Após login, envie `Authorization: Bearer <accessToken>`.

| Método e rota | Uso |
|---|---|
| `GET /v1/health` | Disponibilidade e porta STUN anunciada |
| `POST /v1/auth/register`, `POST /v1/auth/login` | Cadastro pendente e login após aprovação |
| `POST /v1/auth/logout`, `GET /v1/me` | Encerrar sessão e consultar conta |
| `GET /v1/admin/users`, `GET /v1/admin/networks` | Listagens administrativas com `RAZZE_ADMIN_TOKEN` |
| `POST /v1/admin/users/:id/approve` | Aprovar conta pendente com `RAZZE_ADMIN_TOKEN` |
| `GET /v1/friends`, `GET /v1/friends/requests` | Listar amizades e solicitações; cada amigo vem com `dmKey` (a chave pública das mensagens criptografadas, ou `null`) e `sala` (em que sala está, ou `null`; veja abaixo) |
| `PUT /v1/me/dm-key` (`{ publicKey }`) | Publicar a chave pública X25519 (32 bytes em base64) das mensagens criptografadas desta conta; vale a do último PC que publicou |
| `POST /v1/friends/requests`, `POST /v1/friends/requests/:id/accept`, `DELETE /v1/friends/:userId` | Gerenciar amizades. O pedido acha a pessoa por `userId` (a conta, usada pelo perfil de quem está na sala), `nickname` ou `email` |
| `POST /v1/friends/links`, `GET /v1/friends/links`, `DELETE /v1/friends/links/:id` | Links de amigo: criar (devolve `token`, `code` curto `ABCD-EFGH-JK`, `url` e `appLink`; vale 7 dias e 1 pessoa; até 5 ativos por conta), listar os ativos e revogar |
| `GET /v1/friends/links/preview?token=`, `POST /v1/friends/links/accept` (`{ token }`) | Ver quem convidou (`displayName`) e aceitar: os dois viram amigos na hora. `token` aceita o segredo ou o código curto. Recusa o próprio link, expirado, usado ou revogado (`link_invalid`, `own_link`); 30 tentativas a cada 10 min por IP |
| `GET /a/<token>` | Página pública de abertura do convite (sem login, sem script, sem consultar o banco): "Abrir no Tela P2P" (`telap2p://amigo/<token>`) e "Baixar" |
| `PATCH /v1/me` (`{ bio }`), `POST /v1/me/password` (`{ currentPassword, newPassword }`) | A frase do perfil (até 128 caracteres; os amigos recebem em `/v1/friends` como `bio`) e a troca de senha (pede a atual; mínimo 8 caracteres; 10 tentativas a cada 15 min por IP) |
| `PUT /v1/me/activity` (`{ game, artist, title }`) | Atividade no perfil: o jogo e a música que a pessoa deixou ligados (cada campo até 80 caracteres; tudo vazio apaga; 12 envios por minuto). Só os amigos veem, em `/v1/friends` como `activity` (`null` sem nada); some 2 minutos depois do último envio |
| `GET /v1/auth/google/config`, `POST /v1/auth/google` (`{ code, codeVerifier, redirectUri }`) | Entrar com Google: a config diz se está ligado e o client ID; o login troca o código do Google (que voltou para `127.0.0.1` no PC) pela conta. Cria a conta se o e-mail (confirmado pelo Google) é novo; se já existe conta com esse e-mail, responde `account_exists` (409) e **não junta sozinho**. 10 tentativas erradas a cada 10 min por IP |
| `POST /v1/me/google`, `DELETE /v1/me/google` | Vincular o Google à conta logada e desvincular (só quem tem senha desvincula; quem entrou só pelo Google define a primeira senha em `POST /v1/me/password` sem a atual) |
| `POST /v1/admin/users/:id/reset-code`, `POST /v1/auth/reset` (`{ email, code, password }`) | Esqueci a senha **sem e-mail**: o administrador gera um código (`ABCD-EFGH`, vale 1 hora, uso único, só o hash fica no banco; botão **Código de senha** no painel) e passa para a pessoa, que redefine a senha. 5 erros queimam o código; redefinir derruba as sessões da conta |
| `POST /v1/messages` (`{ to, text }`) | Mandar mensagem direta para um amigo (até 2000 caracteres, ou até 9000 se for cifrada, `e2e1:<base64url>`; 30 mensagens a cada 10 s por conta). O app só manda cifrada ([spec](spec/mensagens-criptografadas.md)) |
| `GET /v1/messages?after=<seq>` | Mensagens diretas (enviadas e recebidas) depois do número de sequência `after`, 200 por vez (`more` diz se há mais) |
| `POST /v1/signals` (`{ to, text }`) | Sinal da conexão direta das mensagens privadas para um amigo: só cifrado (`e2e1:`), até 16000 caracteres, 30 a cada 10 s por conta ([spec](spec/mensagens-conexao-direta.md)) |
| `GET /v1/signals` | Os sinais que chegaram para esta conta; cada um é entregue uma vez só. Ficam só na memória e somem em 2 minutos |
| `GET /v1/networks`, `POST /v1/networks` | Listar redes visíveis e criar rede |
| `GET/PATCH/DELETE /v1/networks/:id` | Consultar, editar ou excluir rede própria |
| `GET /v1/networks/:id/members` | Listar membros da rede |
| `DELETE /v1/networks/:id/members/:userId` | Sair da rede (`userId` = `me`) ou o dono tirar alguém; os dispositivos da pessoa na rede saem junto |
| `POST /v1/networks/:id/invites`, `POST /v1/invites/accept` | Criar e aceitar convite de uso limitado |
| `GET/POST /v1/networks/:id/devices` | Listar peers e registrar dispositivo/chave pública |
| `PATCH /v1/networks/:id/devices/:deviceId/endpoint` | Atualizar endpoint UDP reflexivo descoberto por STUN |
| `DELETE /v1/networks/:id/devices/:deviceId` | Remover dispositivo da rede |

Os links de amigo guardam só o hash do segredo e do código (tabela `friend_links`). O endereço do link vem de `RAZZE_PUBLIC_URL` (ex.: `https://api.exemplo.com`; se faltar, usa o `Host` da requisição, com https atrás do proxy com `RAZZE_TRUST_PROXY=1`) e o botão "Baixar" de `RAZZE_DOWNLOAD_URL` (padrão: a última release no GitHub). Plano e motivos: `docs/spec/convite-por-link.md`.

As mensagens diretas ficam no banco por 30 dias (tabela `direct_messages`), para chegar a quem está offline e aos outros PCs da mesma conta. O histórico completo fica no PC de cada pessoa (`%APPDATA%\Tela P2P\mensagens`). O texto fica guardado sem criptografia de ponta a ponta: quem administra o servidor consegue ler.

Redes podem ser `private`, `friends` ou `public`; para entrar, use um convite. Os convites armazenam apenas o hash do token e aceitam limite de usos e validade configuráveis. Cada rede recebe um bloco privado `/24` e os dispositivos recebem IPs overlay exclusivos.

O cliente HTTP fica em `main/razze-api-client.js`; `main/razze-service.js` persiste a sessão e protege o token com `safeStorage` do Electron. O cliente exige HTTPS fora de localhost e rejeita redirecionamentos. Nas Configurações, o app permite criar/entrar na conta, criar redes, aceitar convites, administrar redes próprias e iniciar o WireGuard.

## Atualizar a VPS (passo a passo)

Vale para a VPS que já roda a RazzeAPI com Docker Compose (hoje `https://srv2015370.hstgr.cloud`). O servidor novo continua
funcionando com apps antigos; atualize **antes** de publicar o app novo.

1. **Entrar na VPS** (no PowerShell do seu PC): `ssh root@srv2015370.hstgr.cloud` (ou o usuário que você usa).
2. **Achar a pasta do servidor**: `cd ~/AmostradinhoScreenShare/razze-api`. Se não for esse o caminho:
   `find / -name compose.yaml -path "*razze-api*" 2>/dev/null`. Confira que o `.env` está nela: `ls -la`.
3. **Ver o que está rodando e a versão atual**:
   `docker compose ps` e `curl -s https://srv2015370.hstgr.cloud/v1/auth/google/config` (antes da atualização dá erro 401: normal).
4. **Backup do banco** (contas, amigos e redes ficam no volume `razze-data`; o banco usa WAL, então pare o servidor um instante):
   ```sh
   docker volume ls | grep razze-data          # anote o nome inteiro, por exemplo razze-api_razze-data
   docker compose stop razze-api
   docker run --rm -v razze-api_razze-data:/data -v "$PWD":/backup busybox tar czf /backup/razze-data-$(date +%F).tgz -C /data .
   ls -lh razze-data-*.tgz
   docker compose start razze-api
   ```
   Guarde esse `.tgz` também fora da VPS (`scp` para o seu PC).
5. **Trazer o código novo** (depois do merge do PR na `main`): `git pull`. Se a pasta não for um clone do repositório, copie a
   pasta `razze-api` do projeto para a VPS (`scp -r razze-api root@srv2015370.hstgr.cloud:~/`), **sem apagar o `.env`**.
6. **Conferir o `.env`**: `API_DOMAIN` e `RAZZE_ADMIN_TOKEN` já existentes. As linhas `RAZZE_GOOGLE_CLIENT_ID` e
   `RAZZE_GOOGLE_CLIENT_SECRET` são opcionais (veja "Entrar com Google"); vazias, o botão do Google fica escondido. O
   `RAZZE_PUBLIC_URL` já vem do Compose (`https://$API_DOMAIN`).
7. **Subir a versão nova**: `docker compose up -d --build`, depois `docker compose logs --tail=50 razze-api`. Não deve haver erro;
   a primeira subida cria as tabelas e colunas novas sozinha (nada precisa ser migrado à mão).
8. **Conferir**:
   ```sh
   curl -s https://srv2015370.hstgr.cloud/v1/health
   curl -s https://srv2015370.hstgr.cloud/v1/auth/google/config     # {"enabled":false,"clientId":""} (ou true com o Google ligado)
   curl -s -o /dev/null -w "%{http_code}\n" https://srv2015370.hstgr.cloud/a/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA   # 200
   ```
   Abra também `https://srv2015370.hstgr.cloud/admin/`: o painel deve entrar e, na lista de usuários, cada conta tem o botão
   **Código de senha**.
9. **Se algo der errado, voltar** (o banco antigo não perde dados, só ganha colunas):
   ```sh
   git log --oneline -5                         # veja o commit anterior
   git checkout <commit-anterior> -- .          # ou: git revert
   docker compose up -d --build
   ```
   Para restaurar o backup: `docker compose stop razze-api`, apague o conteúdo do volume e extraia o `.tgz` nele
   (`docker run --rm -v razze-api_razze-data:/data -v "$PWD":/backup busybox sh -c "rm -rf /data/* && tar xzf /backup/razze-data-AAAA-MM-DD.tgz -C /data"`), depois `docker compose start razze-api`.

Depois da VPS atualizada: faça o teste "Conta, amigos e perfil" do `docs/roteiro-de-teste.md` e só então publique o app.

## Entrar com Google (opcional)

O app abre o navegador do sistema, o Google devolve um código para uma porta local (`http://127.0.0.1:<porta>/callback`) e a
RazzeAPI troca o código pela identidade (PKCE; o servidor confere emissor, cliente, validade e e-mail confirmado). O app não leva
nenhuma credencial: o client ID vem de `GET /v1/auth/google/config`. Sem as variáveis abaixo, o botão não aparece.

1. No [Google Cloud Console](https://console.cloud.google.com/): crie um projeto › **APIs e serviços** › **Tela de permissão OAuth**
   (tipo Externo; escopos `openid`, `email`, `profile`; em teste, adicione os e-mails dos amigos como usuários de teste, ou publique o app).
2. **Credenciais** › **Criar credenciais** › **ID do cliente OAuth** › tipo **App para computador**. Copie o ID e o segredo.
3. No `.env` da VPS: `RAZZE_GOOGLE_CLIENT_ID=...` e `RAZZE_GOOGLE_CLIENT_SECRET=...` (o segredo de app para computador não é secreto de
   verdade, mas o Google exige no pedido). Suba de novo: `docker compose up -d`.
4. Conta: e-mail novo cria a conta (respeita a aprovação do administrador, se estiver ligada); e-mail que já tem conta com senha pede
   entrar com a senha e **Vincular Google** no Perfil › Conta Razze.

## WireGuard e limites atuais

O cliente gera a chave privada localmente, protege a identidade com `safeStorage` e envia somente a chave pública para o servidor. Ao conectar, usa STUN para descobrir o mapeamento UDP público, registra o endpoint, atribui um IP overlay e instala um serviço de túnel WireGuard no Windows. A configuração que o serviço local precisa fica no perfil do usuário; a API nunca recebe a chave privada.

**Administrador:** o app roda sem administrador. Quando precisa mexer no túnel, ele abre um ajudante (`main/razze-ajudante.js`) com a janela de permissão do Windows, uma vez por sessão; o ajudante fecha junto com o app. O ajudante só aceita três pedidos (instalar, remover e atualizar a lista de pessoas de um túnel `Razze…` da pasta de túneis do perfil) e roda o `wireguard.exe` e o `wg.exe` de uma cópia em `C:\Program Files\Tela P2P\WireGuard`: o serviço do túnel roda como SYSTEM e guarda esse caminho, então ele fica numa pasta em que só administrador escreve. Com o app aberto como administrador, faz tudo direto, sem o ajudante.

A primeira versão tenta conexões P2P diretas com STUN e keepalive. Ela envia sondagens IP aos peers para iniciar o handshake e ajudar na abertura simultânea do NAT. Enquanto o Tela P2P está aberto, consulta a lista de dispositivos a cada 30 segundos e, quando chaves ou endpoints mudam, troca a lista de pessoas com o túnel ligado (`wg syncconf`): as conexões de quem já estava não caem. Só se o `wg.exe` falhar o túnel é reinstalado (reinicia por alguns segundos). Ao abrir o app com o túnel já ligado, a sincronização volta sozinha. Se uma conexão da tela ou da voz cair, o app refaz o caminho sozinho (ICE restart na tela; chamada nova na voz). NAT simétrico e CGNAT restritivo ainda podem impedir a conexão; não há relay nesta versão. O overlay opera em camada IP unicast; não emula broadcast Ethernet/L2. Em LAN/Radmin, a descoberta continua por UDP. No modo Razze, salas visíveis são anunciadas no heartbeat e listadas pela API somente para membros da mesma rede.

A Radmin permanece independente para quem já usa esse caminho. A Razze não instala nem controla NetBird.

## Testes

```powershell
npm run test:razze-api
npm test
```

## Painel administrativo e presença

O módulo web separado fica em `razze-api/admin/` e abre em `https://SEU_DOMINIO/admin/`. Veja [primeiro acesso, ferramentas e implantação](../razze-api/admin/README.md). O painel usa as mesmas contas da API, com papel `admin`; o `RAZZE_ADMIN_TOKEN` permite configurar o primeiro administrador. Administradores podem consultar dados sanitizados, gerenciar contas/redes, revogar sessões e mudar a política de cadastro sem reiniciar.

O processo principal do TelaP2P envia uma batida a cada 20 segundos, inclusive minimizado. A presença expira após 70 segundos sem contato (ajustável de 45 a 300 no painel). Amigos mostram Online/Offline; a rede mostra pessoas conectadas e salas abertas; a tela inicial lista as salas da rede selecionada. A publicação respeita a opção de sala oculta. Ao sair, o cliente retira sua presença; se cair ou a conexão falhar, o prazo remove os anúncios. A presença é por sessão, então sair em um dispositivo não apaga a presença de outro.

**Salas dos amigos (modo Internet):** quem cria uma sala no servidor do modo Internet (e deixou "Mostrar esta sala para meus amigos do Razze") manda `internetRoom` na batida: endereço do servidor (`ws://` ou `wss://`), código, número de pessoas e o passe de convite (43 caracteres base64url, ou `null` num servidor antigo). Não precisa de rede Razze nem de VPN. A API devolve essas salas em `internet` só para os amigos aceitos (nunca para o próprio usuário nem no painel de administração) e elas somem com a presença. Detalhes em [spec/salas-dos-amigos.md](spec/salas-dos-amigos.md).

**Em que sala o amigo está (qualquer modo):** quem está numa sala (host ou não) manda `salaAtual` na batida: `modo` (`radmin`, `razze` ou `internet`), `host` (o nome de quem hospeda, até 32 caracteres), `pessoas` e `voz` (booleano). Nada de endereço, código ou senha; qualquer outro campo é recusado (400). A API devolve em `/v1/friends` como `sala`, só para os amigos (os membros das redes e a administração não recebem), e some com a presença ou com `salaAtual: null`. Servidor antigo ignora o campo. Detalhes em [spec/sala-do-amigo.md](spec/sala-do-amigo.md).

Online confirma contato recente com a API; não prova conectividade P2P. As salas incluem endereço VPN, porta, número de participantes e indicação de senha, sem publicar a senha. A API valida a associação do dispositivo à rede e restringe a consulta das salas aos membros, mesmo em redes públicas.

| Rota | Uso |
|---|---|
| `POST /v1/presence/heartbeat` | `{connections:[{networkId,deviceId}], room:null ou {id,networkId,host,porta,pessoas,senha}, internetRoom?:{servidor,codigo,pessoas,passe}, salaAtual?:{modo,host,pessoas,voz}}` |
| `DELETE /v1/presence` | Retirar a presença da sessão atual |
| `GET /v1/rooms?networkId=ID` | `rooms`: salas visíveis das redes de que o usuário é membro; `internet`: salas do modo Internet dos amigos aceitos |
| `GET /v1/admin/me`, `GET /v1/admin/overview` | Identidade administrativa e resumo |
| `GET/PATCH /v1/admin/settings` | `requireApproval`, `registrationOpen`, `presenceTimeoutSeconds`, `googleOnly` (ninguém cria conta por senha; o administrador mantém a senha), `legacyPasswordLogin` (padrão ligado: com `googleOnly`, quem já tinha conta com senha ainda entra por ela; desligue quando todos tiverem vinculado o Google) e `onlyAllowlist` (só e-mails da lista de convidados criam conta) persistentes |
| `GET/POST /v1/admin/allowlist` (`{ email, grupo: amigo|teste|admin, label? }`), `DELETE /v1/admin/allowlist/:email` | Lista de convidados: quem está nela entra já ativo (sem aprovação) com o grupo ou papel combinado; pôr na lista alguém que já criou conta (pendente) libera e ajusta. Tirar da lista não apaga a conta. Até 500 e-mails |
| `GET /v1/admin/analytics` | Só contagens: contas por situação e grupo, online agora, ativos hoje/7/30 dias, pico do dia, voltaram na semana, nunca abriram, amizades, mensagens dos últimos 7 dias, versões do app em uso e 14 dias de ativos, pico e cadastros. Nenhum e-mail |
| `PATCH /v1/admin/users/:id` | Papel `user/admin`, grupo `amigo/teste`, status `pending/active/disabled` e `banReason` |
| `POST /v1/admin/users/:id/revoke-sessions` | Revogar todas as sessões e dispositivos do usuário |
| `GET /v1/admin/clients`, `DELETE /v1/admin/clients/:id` | Consumo por sessão e desconexão individual |
| `DELETE /v1/admin/networks/:id` | Excluir rede como administrador |
| `DELETE /v1/admin/networks/:id/invites` | Invalidar os convites da rede |
| `GET /v1/admin/database` | Tabelas permitidas para consulta |
| `GET /v1/admin/database/:table?offset=0&limit=50` | Consulta sanitizada; limite máximo 100 linhas |

O painel distingue usuários de clientes (duas sessões da mesma conta contam como um usuário e dois clientes). Os contadores representam corpos HTTP autenticados recebidos/enviados pela API; não incluem STUN, TLS, CPU individual ou mídia P2P. O histórico está na tabela `audit_log`.

Atualizações do TelaP2P procuram `wireguard.exe` também no diretório da atualização assinada, além dos resources do executável e da instalação do Windows. Assim, um executável anterior pode utilizar o binário recebido pelo atualizador.
