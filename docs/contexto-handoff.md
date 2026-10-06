# Contexto para continuar em outra IA (05/10/2026)

Cole este arquivo no início da conversa. Projeto: **Tela P2P / AmostradinhoScreenShare** (Electron, Windows; transmitir a tela e voz de PC para PC).
Pasta: `C:\Users\andri\AmostradinhoScreenShare`. Repositório: `MateusMunhoz/AmostradinhoScreenShare`. Dono da conversa: Andrick (`andrickneer@gmail.com`).
Idioma de tudo (código, comentários, docs, commits, textos da interface): **português do Brasil**. O Andrick pede respostas **curtas, só o resultado**.

## Regras do projeto que não podem ser quebradas (`AGENTS.md`, `.claude/rules/`)
- Agente **nunca** roda: `npm run publicar`, `node publicar.js`, `git push`, `git tag`, `gh release`. Commit só quando pedirem.
- Arquivo novo de runtime entra em `PACK_FILES` (`publicar.js`) **e** em `build.files` (`package.json`, já cobre `renderer/**` e `main/**`).
- Renderer: scripts clássicos, escopo global único; só `renderer/inicio.js` roda código na carga (os outros só declaram). Ordem dos `<script>` do `index.html` importa. Sem `style=""` no HTML (CSP), cores só por `var(--...)`, sem animação contínua.
- IPC: `ipcMain.handle` em `main.js` + função em `preload.js`; todo argumento da página é não confiável (converter e limitar).
- Não mexer em `boot.js` nem na versão do Electron (só chegam com `.exe` novo).
- Antes de mexer em IPC/`main/razze-*`/`publicar.js`/protocolo da sala: apresentar plano e esperar aprovação (já aprovado para o que foi feito abaixo).
- Testes: `npm test` (node:test, ~3 s), `npx electron tests/e2e/carga.cjs` (app abre sem erro, 12 ok), `npm run test:settings`.
  Se `npm test` falhar o teste "nuvem…" de `comando-voz-ia`, é só dependência faltando: `npm install`.

## Estado do git (agora)
- Branch `tema/top-gun`, PR **#27** aberto contra `main` (já tem CI verde antes do último merge). `origin/main` está na **1.17.0**.
- Local tem 7 commits à frente do remoto, incluindo os merges `origin/tema/top-gun` (1.16.1) e `origin/main` (1.17.0) já resolvidos. **Falta o `git push origin tema/top-gun` (do Andrick)**, depois aprovar/mergear o PR.
- `docs/razze-api.md` tem uma alteração ainda **não commitada** (seção "Atualizar a VPS"), e este arquivo é novo.
- Verificação do último estado: `npm test` = 216 passando, 0 falhando; carga = 12 ok; test:settings ok.
- Um `/code-review high origin/main` foi disparado e **falhou por limite de sessão** (não achou nada, não rodou). Vale rodar de novo.

## O que foi feito nesta sessão (tudo no working tree/branch)
1. **Tema Top Gun** (`styles-topgun.css`, `assets/temas/`, `renderer/configuracoes.js`, `renderer/preferencias-modelo.js`):
   fundo preto; fora da sala, blueprint verde de um caça (F-16 e F-15 e A-10 com corte da fuselagem + AIM-9L desmontado; F/A-18 e F-22 em 3 vistas), um por abertura do app; dentro da sala só preto; HUD novo (estilo F/A-18) só no palco sem transmissão (`.empty-stage`);
   placa do Início só com nome do avião e crédito; removidos "TOP GUN" escrito, miniatura do caça, fotos, Su-57/F-35/MiG-29/AC-130; rádio sem chiado/clique (só voz, `assets/temas/gerar-radio.js`, "Copy." no chat), removido "Bravo six", "Good kill" único (som de entrar = Radio check); ícone da janela = asas de piloto (`drawTopGunIcon` em `renderer/icone-app.js`).
   Origens e licenças dos desenhos: `assets/temas/OBRAS.md` (Wikimedia Commons; F-22 CC BY-SA 2.0, F-16 e F-15 CC0). **Pendência pedida pelo Andrick: depois do release, trocar/complementar o F-22 por avião antigo com blueprint bom e real, sem inventar nada** (não existe corte técnico livre do F-22).
2. **Auditoria do fluxo** (`docs/auditoria-fluxo.md`) e plano (`docs/spec/primeira-entrada-e-perfil.md`).
3. **Primeira entrada em 3 telas** + **Início com amigos** (`renderer/primeira-entrada.js`): como usar (Com amigos / Sala rápida), nome e foto, conta; Início com amigos online (Mensagem, Ligar, Adicionar amigo, Copiar meu link), **Abrir minha sala** em 1 clique (senha gerada), "Opções da sala".
4. **Convite de amigo por link** (`docs/spec/convite-por-link.md`): servidor (`razze-api/server.js`: tabela `friend_links`, rotas `/v1/friends/links*`, página pública `/a/<token>`), app (`telap2p://amigo/<token>` em `main.js`, IPC/preload, cartão "quer ser seu amigo", código curto `ABCD-EFGH-JK`, retomada após criar conta, Copiar meu link e Revogar). Padrão: 7 dias, 1 uso, 5 ativos, confirma ao aceitar.
5. **Conta** (`renderer/conta.js`): trocar senha, esqueci a senha por **código gerado pelo administrador** (sem e-mail; botão "Código de senha" no painel `razze-api/admin`), frase do perfil (128 chars, aparece no Início e no cartão da pessoa na sala por sinal `{side:'bio'}`).
6. **Foto e fundo do perfil**: editor de recorte com arrastar/zoom (`renderer/recorte.js`), botão Ajustar com a original guardada (`fotoOrigem`/`fundoOrigem` no localStorage); GIF não corta.
7. **Atividade no perfil**: `main/atividade.js` (lê jogos por lista de executáveis e Spotify pelo título da janela via `tasklist`), `PUT /v1/me/activity`, tudo desligado por padrão, só amigos veem, some em 2 min, clicar em "Ouvindo X" mostra a faixa.
8. **Login com Google**: `main/google-login.js` (OAuth + PKCE no navegador, retorno em `127.0.0.1`), servidor troca o código (`/v1/auth/google`, `/v1/me/google`), não junta conta existente sozinho (`account_exists`), conta só-Google define a 1ª senha sem a atual. **Só liga com `RAZZE_GOOGLE_CLIENT_ID/SECRET` na VPS** (passo a passo em `docs/razze-api.md`).
9. Testes novos: `tests/razze-friend-links`, `razze-conta`, `razze-google`, `convite-amigo`, `conta`, `recorte`, `atividade`, `google-login`.
10. Docs atualizadas: `docs/guia.md`, `desenvolvimento.md`, `razze-api.md`, `roteiro-de-teste.md` (seção "Conta, amigos e perfil"), `pendencias-setup.md`, `roadmap.md`.

## O que falta (nesta ordem, o Andrick executa o que é proibido para agente)
1. `git push origin tema/top-gun`; conferir `gh pr checks --watch`; PR sem conflito; aprovar e `gh pr merge --merge` (idealmente o Mateus confere: ele mexe nas mesmas áreas).
2. **Atualizar a RazzeAPI na VPS** (`https://srv2015370.hstgr.cloud`, Docker Compose, pasta `razze-api`): ver "Atualizar a VPS (passo a passo)" em `docs/razze-api.md`. Hoje a VPS roda o código antigo (`/v1/auth/google/config` responde 401, `/a/...` 401).
3. (Opcional) criar o cliente OAuth "App para computador" no Google Cloud e pôr as duas variáveis no `.env` da VPS.
4. Na `main`: `npm run publicar -- --sem-github` (build local, abrir o `.exe` e testar), depois `npm run publicar -- --notas "..."`. O publicar sobe 1.17.0 → 1.17.1.
5. Testar em dois PCs (Windows) o roteiro "Conta, amigos e perfil". Não testado de verdade ainda: Spotify real, Google real, link aberto com app fechado, servidor atualizado.
6. Depois do release: blueprint melhor/antigo para o F-22 (e talvez mais modelos) com fonte real e licença livre.
7. Rodar o code review da branch de novo.

## Armadilhas deste ambiente (Windows + shell)
- Heredocs com `\` e aspas quebram: escreva scripts de patch com a ferramenta de arquivo (Write) e rode com `node arquivo.js`; para escapes use `String.fromCharCode(92)` quando precisar de barra invertida num CSS.
- No bash (msys) `>nul` vira `/dev/null` e `/v` é reescrito; para `cmd`/`tasklist` use PowerShell ou arquivo `.js`.
- Processos `electron.exe` presos: `taskkill //F //IM electron.exe`.
- Captura de tela dos testes: copiar `tests/e2e/carga.cjs` até `await sleep(800);` e acrescentar passos (`win.webContents.capturePage()`); o perfil de teste persiste `localStorage` entre execuções (`primeiraEntrada`), então abra telas com funções (`abrirPrimeiraEntrada(3)`), não por clique. Apague o arquivo temporário depois.
- O servidor só aceita 1 sessão por conta (login novo derruba a anterior) e o limite de tentativas erradas é por IP a cada 10 min (nos testes avance o relógio injetado).
- Não há `python` instalado.

## Preferências do Andrick (importantes)
- Quer o resultado, sem detalhar demais; avisa quando terminar e dá o comando para testar (`npm run dev`).
- Quer blueprints **reais e detalhados**, nada inventado; gostou do F/A-18 3 vistas e do F-16 corte; rejeitou silhuetas e 3 vistas pobres.
- Prefere decisões já tomadas com recomendação ("usa as recomendações") a perguntas.
