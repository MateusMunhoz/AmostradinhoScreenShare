# Convite de amigo por link

Roadmap: fluxo, conta e perfil (`docs/spec/primeira-entrada-e-perfil.md`) · Auditoria: `docs/auditoria-fluxo.md` (problemas 1 e 5)
*Plano em 05/10/2026, aprovado com as recomendações (7 dias e 1 pessoa, confirmar ao aceitar, Baixar = última release do GitHub, endereço do link = o domínio da API). Fases 1 a 3 prontas (servidor, receber e gerar); falta a fase 4 (teste manual em dois PCs e deploy do servidor). Mexe em `main.js`, `preload.js`, `main/razze-api-client.js` e `razze-api/server.js`:
precisa de aprovação antes de codar (AGENTS.md).*

## Objetivo
Hoje, para virar amigo de alguém é preciso digitar o **nickname exato** e esperar a pessoa aceitar; e convidar para uma
sala depende de copiar um endereço e mandar por outro app. O link resolve os dois: um clique de quem convida, um clique
de quem recebe, e os dois já são amigos.

## Como funciona (visão da pessoa)
1. **Quem convida:** Início › **Adicionar amigo** › **Copiar meu link**. O app copia
   `https://<servidor>/a/<código>` e avisa "Link copiado. Vale 7 dias e 1 pessoa."
2. **Quem recebe, com o app instalado:** clica no link, abre uma página curta com **Abrir no Tela P2P**. O app abre e
   mostra "**Cristian** quer ser seu amigo. [Aceitar] [Agora não]". Aceitou: vira amigo na hora, nos dois lados.
3. **Quem recebe, sem o app:** a mesma página mostra **Baixar o Tela P2P**. Depois de instalar, abre o app, cria a conta
   na primeira entrada e **cola o link ou o código** em Adicionar amigo (o app não consegue lembrar o link sozinho
   depois da instalação).
4. **Quem recebe, sem conta:** o app guarda o convite, leva para a tela de conta da primeira entrada e, ao entrar,
   retoma o "quer ser seu amigo" de onde parou.
5. **Código curto:** o campo de Adicionar amigo aceita o link inteiro ou só o código (`ABCD-EFGH-JK`), para quando o
   app de mensagem não deixa o link clicável.

## Escopo
- Entra: link de amigo (https + `telap2p://amigo/…`), página de abertura/baixar, aceitar com confirmação, código curto,
  retomada depois de criar conta, revogar links, mensagens de erro claras (expirou, já usado, versão antiga do servidor).
- Fica de fora: convite de **sala** por link (já existe `telap2p://sala?d=…` pelas mensagens diretas; vira a Fase 2
  se quiser link https também), convite para rede Razze (já existe `telap2p://invite/…`), login com Google.

## Desenho técnico
**Servidor (`razze-api/server.js`, tabela nova `friend_links`):**
- `POST /v1/friends/links` → `{ token, code, expiresAt }`. Guarda só o **hash** do token (como `invites`). Padrão:
  7 dias, 1 uso; máximo de 5 links ativos por conta.
- `GET /v1/friends/links/preview?token=` → `{ displayName }` de quem criou (precisa estar logado; só para mostrar a
  confirmação).
- `POST /v1/friends/links/accept` `{ token }` → cria a amizade já aceita (a pessoa que gerou o link consentiu ao gerá-lo;
  quem clicou, ao confirmar). Recusa o próprio link, link expirado, usado ou revogado; limite de tentativas por IP e
  por conta (`enforceAuthLimit`).
- `DELETE /v1/friends/links/:id` e `GET /v1/friends/links` (listar/revogar).
- `GET /a/:token` (HTML estático, sem login): "Abrir no Tela P2P" (`telap2p://amigo/<token>`) e "Baixar". **Não** revela o
  nome de quem convidou (só o app logado vê pelo preview). `Caddyfile` já serve a API; só roteia o `/a/`.
- Servidor antigo (sem as rotas) responde 404: o app mostra "Seu servidor ainda não tem links de amigo" e cai no
  nickname como hoje.

**App:**
- `main.js`: `consumeRazzeInvite` hoje só aceita `telap2p://invite/…`; passa a aceitar também `telap2p://amigo/<token>`
  (mesma validação: `[A-Za-z0-9_-]{20,120}`), guarda como pendente e avisa a janela (`razze-friend-link`).
- `preload.js` + `main/razze-api-client.js`: `razzeFriendLinkCreate/Preview/Accept/List/Revoke`, `razzeFriendPending`.
- `renderer/primeira-entrada.js` e `hub.js`: botão **Copiar meu link**, campo "colar link ou código", cartão
  "quer ser seu amigo", retomada depois do login (o pendente fica em `localStorage`, `amigoPendente`).
- Tudo que chega (link, código, resposta do servidor) é validado e limitado como em `sala-protocolo.js`.

## Restrições
- Sem servidor novo: é a mesma RazzeAPI da equipe. Precisa **atualizar o servidor na VPS** antes de liberar o botão.
- Compatível com app antigo: quem não tem a versão nova não abre `telap2p://amigo`; a página https avisa para atualizar.
- O link não carrega IP, e-mail nem senha. Só um segredo de uso único que expira.
- CSP do `index.html` e regras do renderer (`.claude/rules/renderer.md`) valem; sem animação contínua.

## Decisões que preciso de você
1. **Endereço público do link:** o domínio HTTPS da RazzeAPI (para `https://<servidor>/a/…`). Qual é?
2. **Para onde o "Baixar" leva:** a página de releases do GitHub do projeto ou outro endereço?
3. **Validade e uso padrão:** 7 dias e 1 pessoa (recomendado, mais seguro) ou 30 dias e várias pessoas (mais prático
   para grupo, mas um link vazado vira amigos indesejados).
4. **Aceitar sem confirmar?** Recomendado **confirmar** ("Cristian quer ser seu amigo") para quem recebe.

## Fases
1. **Servidor** — **FEITA em 05/10/2026** (tabela `friend_links`, rotas, página `/a/`, 7 testes em `tests/razze-friend-links.test.js`). Falta o deploy na VPS.
2. **App: receber** — **FEITA em 05/10/2026** (`telap2p://amigo` no `main.js`, IPC e preload, confirmação "quer ser seu amigo", retomada depois da conta, colar link ou código em Adicionar; testes em `tests/convite-amigo.test.js`). Falta teste manual no Windows.
3. **App: gerar** — **FEITA em 05/10/2026** (Copiar meu link no Início e no formulário de Adicionar, mensagem pronta com link e código, lista com Revogar; colar a mensagem inteira também funciona). Falta teste manual no Windows.
4. **Docs e teste manual** — docs e roteiro **FEITOS em 05/10/2026** (`docs/roteiro-de-teste.md`, seção Conta, amigos e perfil); falta executar o roteiro em dois PCs e o deploy na VPS.

## Critérios de aceitação
- [ ] Gerar link e copiar em 2 cliques a partir do Início.
- [ ] Quem recebe com app e conta vira amigo em 1 clique de confirmação; aparece na lista dos dois sem digitar nickname.
- [ ] Sem conta: cria a conta e o convite continua de onde parou.
- [ ] Link usado, expirado, revogado ou próprio mostra uma mensagem clara e não cria amizade.
- [ ] Servidor sem as rotas: o app avisa e o nickname continua funcionando.
- [ ] Nenhum dado pessoal na página `/a/` nem no link.

## Testes
- Automáticos: `tests/razze-api.test.js` (criar, preview, aceitar, expirar, uso único, próprio link, revogar, limite de
  tentativas, hash no banco); teste unitário da validação do link/código; `npx electron tests/e2e/carga.cjs`.
- Manuais (Windows): link com app aberto e fechado, sem conta, com servidor antigo, dois PCs.
