# Conta só pelo Google, lista de convidados e painel de administração dentro do app

Roadmap: fluxo, conta e perfil (`docs/spec/primeira-entrada-e-perfil.md`) · Rotas: `docs/razze-api.md`
*Plano de 05/10/2026. Fase 1 (servidor) pronta e testada; as fases 2 e 3 mexem em IPC (`main.js`, `preload.js`,
`main/razze-*`) e esperam aprovação (AGENTS.md).*

## Decisões (já combinadas)
- **Uma conta por pessoa, só pelo Google.** E-mail verificado pelo Google; sem senha para recuperar e sem conta duplicada.
- **Modo convidado continua**: sem conta dá para criar e entrar em sala por código e senha. A conta só existe para amigos,
  mensagens e redes.
- **Todo mundo começa do zero**: o banco da VPS é apagado depois de um backup. Amizades, mensagens do servidor, perfil,
  redes e convites se perdem. As mensagens salvas em cada PC (`%APPDATA%\Tela P2P\mensagens`) ficam órfãs.
- **O administrador continua entrando por senha** (só ele): o painel web `/admin/` e o `RAZZE_ADMIN_TOKEN` seguem valendo.

## Dá para fazer sem zerar o banco
Dá. As mudanças do servidor só acrescentam tabelas e colunas (nada se migra à mão). Sem reset: ligue `googleOnly` (fecha o cadastro por
senha) e deixe `legacyPasswordLogin` ligado: quem já tem conta continua entrando por senha e vincula o Google em HUB › Rede.
Quando o painel mostrar que todos vincularam (`withGoogle` = contas ativas), desligue `legacyPasswordLogin`. O que **não** se resolve sem
reset: contas duplicadas que já existem (a mesma pessoa em dois e-mails); elas ficam e você desativa a sobra em Pessoas.

## Como as pessoas entram (servidor, fase 1)
| Situação | O que acontece |
|---|---|
| E-mail **na lista de convidados** | Conta criada **já ativa**, no grupo combinado (`amigo` ou `teste`) ou como administrador (`admin`) |
| E-mail fora da lista, aprovação ligada | Conta **pendente**; aparece em "Pedidos" para você aprovar ou recusar |
| E-mail fora da lista, `onlyAllowlist` ligado | Recusa: "Este e-mail não está na lista de convidados" |
| Cadastro e login por senha com `googleOnly` ligado | Recusa (403 `google_only`), exceto contas de administrador |

Ligadas na VPS pelo painel: `googleOnly = true`, `requireApproval = true`, `onlyAllowlist = false` no começo
(mude para `true` quando quiser fechar de vez). Pôr na lista alguém que já pediu conta libera na hora.

## Painel de administração no app (fase 2, só para `role = admin`)
Entrada: HUB › **Admin** (a aba nem existe para quem não é administrador; o servidor confere o papel em toda chamada).

| Aba | O que mostra e faz |
|---|---|
| **Visão geral** | Online agora; ativos hoje, 7 e 30 dias; pico do dia; contas novas e as que voltaram na semana; quem criou conta e nunca abriu; amizades e quem está sem amigo; mensagens e salas abertas; versões do app em uso; gráfico de 14 dias (ativos, pico e cadastros) |
| **Pedidos** | Contas pendentes com **Aprovar** e **Recusar**, e o grupo (amigo/teste) ao aprovar |
| **Convidados** | Lista de e-mails com grupo (amigo / teste / admin), "já entrou" ou "ainda não", **Adicionar** e **Remover** |
| **Pessoas** | Todas as contas com filtro **Todos · Amigos · Teste · Admin · Pendentes · Desativados**; trocar grupo, desativar e revogar sessões |
| **Servidor** | Interruptores `googleOnly`, `requireApproval`, `onlyAllowlist`, `registrationOpen` |

Implementação: um IPC só, `razzeAdmin(rota, método, corpo)`, que aceita **somente** caminhos `/v1/admin/…` de uma lista
fechada, usa a sessão do próprio administrador (sem guardar o `RAZZE_ADMIN_TOKEN` no app) e limita o tamanho do corpo.
O renderer só declara funções (`renderer/admin.js`), como os outros. O app manda `appVersion` no heartbeat
(`main/razze-presence.js`) para a tabela de versões.

## Primeira entrada e conta (fase 3)
- Tela 3 da primeira entrada: **Entrar com Google** e **Usar sem conta**. Saem os formulários de e-mail e senha, "Esqueci a
  senha", "Trocar senha" e "Vincular Google" para quem não é administrador.
- Se o servidor responder 401 por conta apagada (depois do reset), o app volta à tela de entrada e limpa a sessão, o
  `amigoPendente` e os volumes por conta.
- "Aguardando aprovação": mensagem clara com o nome do administrador e o app segue como sala rápida.

## Roteiro de comandos (para você executar; eu não publico nem faço push)

### 1. Google Cloud (uma vez, no navegador)
1. https://console.cloud.google.com › o projeto do Tela P2P › **APIs e serviços › Tela de permissão OAuth**.
2. Tipo **Externo**, escopos só `openid`, `email`, `profile`. Se estiver em **Teste**, ou publique ("Em produção", sem
   escopos sensíveis costuma dispensar a verificação do Google; confira no console) ou adicione cada e-mail em **Usuários de teste**.
3. **Credenciais › Criar credenciais › ID do cliente OAuth › App para computador**. Copie o **ID** e o **segredo**.

### 2. Backup e zerar o banco na VPS
```sh
ssh root@srv2015370.hstgr.cloud
cd ~/AmostradinhoScreenShare/razze-api
docker volume ls | grep razze-data                       # anote o nome (ex.: razze-api_razze-data)
docker compose stop razze-api
docker run --rm -v razze-api_razze-data:/data -v "$PWD":/backup busybox tar czf /backup/razze-data-$(date +%F).tgz -C /data .
ls -lh razze-data-*.tgz                                  # guarde uma cópia no seu PC: scp
docker run --rm -v razze-api_razze-data:/data busybox sh -c "rm -f /data/razze.sqlite*"   # ZERA contas, amigos, mensagens e redes
```

### 3. Subir o servidor novo (depois do merge do PR na `main`)
```sh
git pull
nano .env        # RAZZE_GOOGLE_CLIENT_ID=... e RAZZE_GOOGLE_CLIENT_SECRET=...  (não mexa em API_DOMAIN nem no RAZZE_ADMIN_TOKEN)
docker compose up -d --build
docker compose logs --tail=50 razze-api                  # sem erro
curl -s https://srv2015370.hstgr.cloud/v1/auth/google/config    # {"enabled":true,...}
```

### 4. Ligar as regras e pôr você e o Cristian na lista (no PowerShell do seu PC)
```powershell
$T = Read-Host "RAZZE_ADMIN_TOKEN"        # cole o token; ele não vai para o histórico nem para o app
$H = @{ Authorization = "Bearer $T"; "Content-Type" = "application/json" }
$U = "https://srv2015370.hstgr.cloud"
Invoke-RestMethod -Method Patch -Headers $H -Uri "$U/v1/admin/settings" -Body '{"googleOnly":true,"requireApproval":true}'
Invoke-RestMethod -Method Post  -Headers $H -Uri "$U/v1/admin/allowlist" -Body '{"email":"andrickneer@gmail.com","grupo":"admin","label":"Andrick"}'
Invoke-RestMethod -Method Post  -Headers $H -Uri "$U/v1/admin/allowlist" -Body '{"email":"EMAIL_DO_CRISTIAN@gmail.com","grupo":"admin","label":"Cristian"}'
```
Cada amigo: `-Body '{"email":"...","grupo":"amigo","label":"Nome"}'` (ou `"teste"`). Ver a lista:
`Invoke-RestMethod -Headers $H -Uri "$U/v1/admin/allowlist"`.

### 5. Primeiro acesso
Abra o app › **Entrar com Google** com `andrickneer@gmail.com`: a conta nasce **administradora e ativa**. Mesmo para o Cristian.
A partir daí, tudo (pedidos, convidados, grupos, números) é no HUB › Admin; os `curl` acima só servem de reserva.

### 6. Voltar atrás
O backup `razze-data-AAAA-MM-DD.tgz` restaura tudo (passo 9 de "Atualizar a VPS" em `docs/razze-api.md`). Para voltar a
aceitar senha: `Invoke-RestMethod -Method Patch ... -Body '{"googleOnly":false}'`.

## Fases
1. **Servidor** — **FEITA em 05/10/2026**: `googleOnly`, `onlyAllowlist`, lista de convidados (`/v1/admin/allowlist`),
   grupo (`amigo`/`teste`) em `PATCH /v1/admin/users/:id`, `GET /v1/admin/analytics`, `appVersion` no heartbeat; testes em
   `tests/razze-conta-google.test.js`. Falta o deploy na VPS (roteiro acima).
2. **Painel no app** — **FEITA em 05/10/2026** (IPC `razze-admin` com lista fechada de rotas, `renderer/admin.js`, botão **Administração** em HUB › Rede só para administradores, `appVersion` no heartbeat; teste em `tests/razze-admin-cliente.test.js`). Falta teste manual com o servidor real.
3. **Primeira entrada só Google** — **FEITA em 05/10/2026** (a config do Google diz `googleOnly` e `passwordLogin`; com `googleOnly`, o formulário de senha some e fica **Tenho uma conta com e-mail e senha**). Conta apagada (401): o app já desloga sozinho (`main/razze-presence.js`); falta conferir na prática depois do reset.
4. **Teste em dois PCs** (roteiro "Conta, amigos e perfil") e deploy.

## Critérios de aceitação
- [ ] Com `googleOnly`, cadastro e login por senha falham para quem não é administrador; o administrador entra em `/admin/`.
- [ ] E-mail na lista entra ativo sem aprovação; fora da lista fica pendente (ou é recusado com `onlyAllowlist`).
- [ ] Cristian e você entram como administradores na primeira vez, sem tocar no banco.
- [ ] O painel do app só aparece para administradores; um usuário comum recebe 403 em toda rota `/v1/admin/…`.
- [ ] Os números do painel não trazem e-mail, mensagem nem nome de sala.
- [ ] Depois do reset, um PC com sessão antiga volta à tela de entrada sem travar.
