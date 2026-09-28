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

O cadastro fica pendente até aprovação administrativa. Configure `RAZZE_ADMIN_TOKEN` com um segredo aleatório de pelo menos 30 caracteres antes de iniciar o serviço. Guarde esse segredo fora do cliente Electron.

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
| `GET /v1/friends`, `GET /v1/friends/requests` | Listar amizades e solicitações |
| `POST /v1/friends/requests`, `POST /v1/friends/requests/:id/accept`, `DELETE /v1/friends/:userId` | Gerenciar amizades |
| `GET /v1/networks`, `POST /v1/networks` | Listar redes visíveis e criar rede |
| `GET/PATCH/DELETE /v1/networks/:id` | Consultar, editar ou excluir rede própria |
| `GET /v1/networks/:id/members` | Listar membros da rede |
| `POST /v1/networks/:id/invites`, `POST /v1/invites/accept` | Criar e aceitar convite de uso limitado |
| `GET/POST /v1/networks/:id/devices` | Listar peers e registrar dispositivo/chave pública |
| `PATCH /v1/networks/:id/devices/:deviceId/endpoint` | Atualizar endpoint UDP reflexivo descoberto por STUN |
| `DELETE /v1/networks/:id/devices/:deviceId` | Remover dispositivo da rede |

Redes podem ser `private`, `friends` ou `public`; para entrar, use um convite. Os convites armazenam apenas o hash do token e aceitam limite de usos e validade configuráveis. Cada rede recebe um bloco privado `/24` e os dispositivos recebem IPs overlay exclusivos.

O cliente HTTP fica em `main/razze-api-client.js`; `main/razze-service.js` persiste a sessão e protege o token com `safeStorage` do Electron. O cliente exige HTTPS fora de localhost e rejeita redirecionamentos. Nas Configurações, o app permite criar/entrar na conta, criar redes, aceitar convites, administrar redes próprias e iniciar o WireGuard.

## WireGuard e limites atuais

O cliente gera a chave privada localmente, protege a identidade com `safeStorage` e envia somente a chave pública para o servidor. Ao conectar, usa STUN para descobrir o mapeamento UDP público, registra o endpoint, atribui um IP overlay e instala um serviço de túnel WireGuard no Windows. O Windows pode pedir permissão de administrador. A configuração que o serviço local precisa fica no perfil do usuário; a API nunca recebe a chave privada.

A primeira versão tenta conexões P2P diretas com STUN e keepalive. Ela envia sondagens IP aos peers para iniciar o handshake e ajudar na abertura simultânea do NAT. Enquanto o Tela P2P está aberto após conectar, consulta a lista de dispositivos a cada 30 segundos e atualiza o túnel somente quando chaves ou endpoints mudam; essa atualização reinicia brevemente o serviço WireGuard. Ao reabrir o app, use **Atualizar peers** uma vez para reconciliar a configuração e retomar a sincronização. NAT simétrico e CGNAT restritivo ainda podem impedir a conexão; não há relay nesta versão. O overlay opera em camada IP unicast; não emula broadcast Ethernet/L2. A descoberta de salas continua apenas em LAN/Radmin.

A Radmin permanece independente para quem já usa esse caminho. A Razze não instala nem controla NetBird.

## Testes

```powershell
npm run test:razze-api
npm test
```
