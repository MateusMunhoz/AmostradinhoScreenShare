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
| `GET /v1/friends`, `GET /v1/friends/requests` | Listar amizades e solicitações; cada amigo vem com `dmKey` (a chave pública das mensagens criptografadas, ou `null`) |
| `PUT /v1/me/dm-key` (`{ publicKey }`) | Publicar a chave pública X25519 (32 bytes em base64) das mensagens criptografadas desta conta; vale a do último PC que publicou |
| `POST /v1/friends/requests`, `POST /v1/friends/requests/:id/accept`, `DELETE /v1/friends/:userId` | Gerenciar amizades |
| `POST /v1/messages` (`{ to, text }`) | Mandar mensagem direta para um amigo (até 2000 caracteres, ou até 9000 se for cifrada, `e2e1:<base64url>`; 30 mensagens a cada 10 s por conta). O app só manda cifrada ([spec](spec/mensagens-criptografadas.md)) |
| `GET /v1/messages?after=<seq>` | Mensagens diretas (enviadas e recebidas) depois do número de sequência `after`, 200 por vez (`more` diz se há mais) |
| `GET /v1/networks`, `POST /v1/networks` | Listar redes visíveis e criar rede |
| `GET/PATCH/DELETE /v1/networks/:id` | Consultar, editar ou excluir rede própria |
| `GET /v1/networks/:id/members` | Listar membros da rede |
| `DELETE /v1/networks/:id/members/:userId` | Sair da rede (`userId` = `me`) ou o dono tirar alguém; os dispositivos da pessoa na rede saem junto |
| `POST /v1/networks/:id/invites`, `POST /v1/invites/accept` | Criar e aceitar convite de uso limitado |
| `GET/POST /v1/networks/:id/devices` | Listar peers e registrar dispositivo/chave pública |
| `PATCH /v1/networks/:id/devices/:deviceId/endpoint` | Atualizar endpoint UDP reflexivo descoberto por STUN |
| `DELETE /v1/networks/:id/devices/:deviceId` | Remover dispositivo da rede |

As mensagens diretas ficam no banco por 30 dias (tabela `direct_messages`), para chegar a quem está offline e aos outros PCs da mesma conta. O histórico completo fica no PC de cada pessoa (`%APPDATA%\Tela P2P\mensagens`). O texto fica guardado sem criptografia de ponta a ponta: quem administra o servidor consegue ler.

Redes podem ser `private`, `friends` ou `public`; para entrar, use um convite. Os convites armazenam apenas o hash do token e aceitam limite de usos e validade configuráveis. Cada rede recebe um bloco privado `/24` e os dispositivos recebem IPs overlay exclusivos.

O cliente HTTP fica em `main/razze-api-client.js`; `main/razze-service.js` persiste a sessão e protege o token com `safeStorage` do Electron. O cliente exige HTTPS fora de localhost e rejeita redirecionamentos. Nas Configurações, o app permite criar/entrar na conta, criar redes, aceitar convites, administrar redes próprias e iniciar o WireGuard.

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

Online confirma contato recente com a API; não prova conectividade P2P. As salas incluem endereço VPN, porta, número de participantes e indicação de senha, sem publicar a senha. A API valida a associação do dispositivo à rede e restringe a consulta das salas aos membros, mesmo em redes públicas.

| Rota | Uso |
|---|---|
| `POST /v1/presence/heartbeat` | `{connections:[{networkId,deviceId}], room:null ou {id,networkId,host,porta,pessoas,senha}, internetRoom?:{servidor,codigo,pessoas,passe}}` |
| `DELETE /v1/presence` | Retirar a presença da sessão atual |
| `GET /v1/rooms?networkId=ID` | `rooms`: salas visíveis das redes de que o usuário é membro; `internet`: salas do modo Internet dos amigos aceitos |
| `GET /v1/admin/me`, `GET /v1/admin/overview` | Identidade administrativa e resumo |
| `GET/PATCH /v1/admin/settings` | `requireApproval`, `registrationOpen`, `presenceTimeoutSeconds` persistentes |
| `PATCH /v1/admin/users/:id` | Papel `user/admin`, status `pending/active/disabled` e `banReason` |
| `POST /v1/admin/users/:id/revoke-sessions` | Revogar todas as sessões e dispositivos do usuário |
| `GET /v1/admin/clients`, `DELETE /v1/admin/clients/:id` | Consumo por sessão e desconexão individual |
| `DELETE /v1/admin/networks/:id` | Excluir rede como administrador |
| `DELETE /v1/admin/networks/:id/invites` | Invalidar os convites da rede |
| `GET /v1/admin/database` | Tabelas permitidas para consulta |
| `GET /v1/admin/database/:table?offset=0&limit=50` | Consulta sanitizada; limite máximo 100 linhas |

O painel distingue usuários de clientes (duas sessões da mesma conta contam como um usuário e dois clientes). Os contadores representam corpos HTTP autenticados recebidos/enviados pela API; não incluem STUN, TLS, CPU individual ou mídia P2P. O histórico está na tabela `audit_log`.

Atualizações do TelaP2P procuram `wireguard.exe` também no diretório da atualização assinada, além dos resources do executável e da instalação do Windows. Assim, um executável anterior pode utilizar o binário recebido pelo atualizador.
