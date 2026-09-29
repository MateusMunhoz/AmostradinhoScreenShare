# Razze Admin

Módulo web independente do Electron, servido pela RazzeAPI em `/admin/`.
Pode ser usado de qualquer navegador: acesse o domínio do servidor desejado seguido de `/admin/`.
Usa exclusivamente os endpoints `/v1/admin/*` e o login `/v1/auth/login`.

## Primeiro acesso

1. Cadastre sua conta pelo TelaP2P.
2. Abra `https://SEU_DOMINIO/admin/` e expanda **Primeiro acesso ou recuperação**.
3. Informe o `RAZZE_ADMIN_TOKEN` existente na configuração da VPS.
4. Em **Usuários**, aprove sua conta se necessário e clique **Tornar administrador**.
5. Saia do painel e entre com o e-mail e a senha da conta administradora.

Tokens ficam somente na memória da página. Recarregar ou fechar a aba exige novo login.
O token de recuperação deve permanecer na configuração da VPS; não o coloque no aplicativo dos usuários.

## Ferramentas

- Visão geral: usuários online, dispositivos/sessões conectadas, contas pendentes, redes, salas, memória e uptime do processo da API.
- Clientes: presença por sessão, quantidade de requisições, bytes recebidos/enviados pela API e revogação individual.
- Usuários: aprovar, promover/rebaixar administradores, banir/desbanir com motivo e revogar todas as sessões.
- Redes: consultar, excluir e revogar convites pendentes.
- Configurações: permitir cadastros, exigir aprovação e ajustar a expiração da presença.
- Banco: tabelas paginadas de somente leitura, com projeções que omitem hashes de senha e tokens. Não executa SQL arbitrário.
- Histórico: ator, data, ação e alvo de cada alteração administrativa.

Os contadores de clientes medem **corpos das requisições/respostas HTTP autenticadas**, acumulados desde a primeira requisição da sessão. Não medem cabeçalhos/TLS, tráfego STUN, CPU por cliente nem vídeo e voz P2P. Os contadores persistem no SQLite enquanto a sessão existe. A memória exibida é do processo inteiro da API.

**Forçar desconexão** revoga a sessão e remove seus dispositivos anunciados. O cliente oficial encerra a VPN ao detectar a revogação (heartbeat a cada 20 s); outros clientes retiram o peer na próxima sincronização (até 30 s com API acessível). A conta pode entrar novamente. Use **Banir** para bloquear novos logins. Não é uma garantia de bloqueio instantâneo de tráfego entre clientes modificados ou sem acesso ao coordenador.

## Implantação

O Dockerfile copia `control.js` e esta pasta automaticamente. Depois de atualizar o código da VPS, rode `docker compose up -d --build` na pasta `razze-api`. O volume existente é preservado e as novas tabelas/colunas são criadas automaticamente.

No desenvolvimento: `npm run razze-api` na raiz e abra `http://127.0.0.1:8787/admin/`.
Teste do painel com navegador Electron invisível, API real e dados temporários: `npm run test:razze-admin` na raiz.
