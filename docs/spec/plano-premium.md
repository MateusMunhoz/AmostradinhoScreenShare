# Plano premium (Nebula+)

Issue: (a abrir) · Roadmap: (a incluir) · Rotas: `docs/razze-api.md`
*Rascunho de 12/10/2026. Espera o ok dos três titulares (Mateus, Cristian e Andrick). Mexe em `razze-api/`, IPC
(`main.js`, `preload.js`, `main/razze-*`) e no protocolo da sala: apresentar o plano antes de implementar (AGENTS.md).*

## Objetivo
Cobrir os custos da VPS e do tempo da equipe com uma assinatura mensal opcional, **sem tirar nada de quem não paga**.
Transmitir, assistir, voz, chat e a conexão pelo TURN continuam de graça para todo mundo. O pago é "a mais": cosméticos,
limites maiores e um selo de apoiador.

## Decisões
- **Transmissão e TURN são gratuitos.** Qualidade, resolução, quadros por segundo, número de transmissões, modo Internet
  e relay pelo TURN não dependem de plano, em nenhum modo (Radmin, Razze, Internet).
- **Nada que é de graça hoje vira pago.** Os limites atuais são o piso do plano gratuito: sala até 50 pessoas
  (`MAX_MEMBERS`), clipes até 2 min, arquivos até 200 MB, fundo do perfil em imagem ou GIF.
- **Premium exige conta** (Google). Sala rápida sem conta continua igual.
- **Sem anúncio e sem coleta de dados.** O servidor guarda só o estado da assinatura, nunca dados de cartão: o pagamento
  fica no provedor.
- **Temas pagos são originais.** Arasaka, E.V.A, Top Gun e a fonte de Lain usam marcas de terceiros: ficam de graça como
  estão (ou saem, se for preciso) e **nunca** entram no pacote pago.
- **Antes de cobrar:** licença assinada pelos três ([licenca.md](licenca.md)), MEI ou CNPJ, termos de uso e política de
  privacidade (LGPD), HTTPS/wss na VPS (roadmap item 4) e `.exe` com assinatura de código.

## Escopo

### Gratuito (todo mundo)
| Área | O que vale |
|---|---|
| Transmissão | Tudo: qualquer resolução e fps, NVENC, várias transmissões, som do PC, janelas flutuantes |
| Conexão | Radmin, Razze, modo Internet e relay pelo TURN sem limite de plano |
| Sala | Até 50 pessoas, subsalas, chat, voz, música junto |
| Clipes | Até 2 min |
| Arquivos | Até 200 MB, no chat da sala e nas mensagens diretas |
| Perfil | Foto, fundo em imagem ou GIF, temas atuais |

### Nebula+ (assinatura)
| Área | O que ganha | Quem confere |
|---|---|---|
| Selo | "Apoiador" no perfil e na lista da sala | Servidor (o selo vem assinado, veja Restrições) |
| Temas | Temas originais exclusivos e cores extras de nome | App (cosmético; quem não paga vê o tema padrão) |
| Perfil | Fundo animado em vídeo curto (MP4/WebM), hoje fora do escopo de [fundo-do-perfil.md](fundo-do-perfil.md) | Servidor guarda o arquivo da conta |
| Sala | **Sala fixa** no modo Internet: código e senha que não expiram, com nome | Servidor de salas (`servidor-internet/`) |
| Sala | Até 100 pessoas, só em sala fixa de assinante no modo Internet | Servidor de salas |
| Clipes | 5 min | App |
| Arquivos | Até 1 GB | App de quem manda e de quem recebe |

Fica de fora (desta spec): servidor dedicado para comunidades, plano anual, preço regional, loja de itens avulsos.

## Comportamento esperado
1. **Assinar:** Perfil › Conta › **Nebula+**. Mostra o que vem no plano e o preço. **Assinar** abre a página de
   pagamento do provedor no navegador do sistema (não dentro do app). Pix ou cartão.
2. **Confirmação:** o provedor avisa a RazzeAPI por webhook. Em até 1 min o app mostra "Nebula+ ativo até DD/MM" (ele
   confere ao voltar o foco e no heartbeat de `main/razze-presence.js`). Botão **Já paguei** força a conferência.
3. **Renovação:** o Pix é mensal (aviso 3 dias antes, no app); o cartão renova sozinho.
4. **Venceu ou cancelou:** 3 dias de folga. Depois disso, os extras somem sem apagar nada: tema volta ao padrão (a
   escolha fica guardada), fundo em vídeo some mas o arquivo fica 30 dias, a sala fixa fica pausada 30 dias (quem
   tentar entrar vê "Esta sala está pausada"), arquivos acima de 200 MB e clipes acima de 2 min deixam de ser oferecidos.
5. **Cancelar:** Perfil › Conta › Nebula+ › **Cancelar**, que vale até o fim do mês pago. Sem pergunta de retenção.
6. **Erros:** sem internet ou RazzeAPI fora: o app usa o último estado conhecido (válido por até 3 dias) e não tira nada
   no meio de uma sala. Pagamento recusado: mensagem do provedor e nada muda.
7. **Sala com gente de plano diferente:** quem não assina vê o tema e o selo dos outros normalmente. Arquivo acima de
   200 MB só pode ser mandado por assinante e baixado por qualquer pessoa com versão nova; versão antiga recusa
   (já recusa hoje, pelo limite de `sala-protocolo.js`) e quem mandou vê "Fulano está numa versão antiga".
8. **Painel de administração:** aba Pessoas mostra o plano; o administrador pode dar Nebula+ por cortesia (amigos e
   teste) com data de fim.

## Restrições
- **O que custa ou dá vantagem, o servidor confere.** O código e os releases são públicos: trava só no app se burla.
  Sala fixa, 100 pessoas e fundo em vídeo são conferidos na RazzeAPI ou no servidor de salas.
- **O que é local, o app confere e a gente aceita que dá para burlar** (clipes de 5 min, temas). Não vale complicar.
- **Selo e limite de arquivo na sala:** a RazzeAPI emite um comprovante curto assinado (conta, plano, validade de 24 h)
  com uma chave própria, diferente da chave de atualização do `boot.js`. O app manda o comprovante na sala; os outros
  conferem a assinatura com a chave pública que vem no app. Sem comprovante válido, não aparece selo e o limite volta a
  200 MB. Validar e limitar tudo que chega (padrão de `sala-protocolo.js`).
- **Webhook do provedor:** conferir a assinatura do webhook, ser idempotente (o mesmo evento duas vezes não estende o
  plano duas vezes) e consultar o provedor antes de liberar.
- **Compatível com versão antiga:** quem não atualizou continua na sala sem erro; campos novos são opcionais.
- **Windows e Linux** iguais. CSP sem domínio novo: o pagamento abre fora do app (`shell.openExternal`, com URL que vem da
  RazzeAPI e é conferida contra o domínio do provedor).
- Nenhum dado de pagamento no app nem no banco além de: id do cliente no provedor, plano, status e validade.

## Dependências
- **Provedor de pagamento** (decidir): Mercado Pago, Asaas ou Stripe, todos com Pix e assinatura recorrente no Brasil.
  Critérios: taxa do Pix, assinatura com Pix automático, webhook assinado, emissão de nota.
- `razze-api/server.js`: tabela `subscriptions (user_id, provider, provider_customer_id, plano, status, valido_ate,
  atualizado_em)` e `subscription_events (provider_event_id PRIMARY KEY, ...)` para idempotência; rotas
  `GET /v1/plano`, `POST /v1/plano/checkout`, `POST /v1/plano/cancelar`, `POST /v1/webhooks/<provedor>`,
  `GET /v1/plano/comprovante`; no admin, plano em Pessoas e cortesia. Documentar em `docs/razze-api.md`.
- `servidor-internet/server.js`: sala fixa (persistida) e limite de 100 conferido pelo comprovante do dono.
- `sala-protocolo.js`: campo opcional `plano` (comprovante) no membro; `MAX_MEMBERS` vira limite por sala;
  `CHAT_MAX_FILE` passa a depender do comprovante de quem manda.
- App: `main/razze-*` (consulta do plano e comprovante), `preload.js` (IPC fechado), `renderer/` (tela Nebula+, selo,
  temas, clipes, chat e `mensagens-direto.js`), `docs/guia.md`.
- VPS: variáveis do provedor no `.env` (o humano configura), HTTPS antes de tudo.

## Critérios de aceitação
- [ ] Sem assinatura, nada que funciona hoje deixa de funcionar (transmissão, TURN, 50 pessoas, 2 min, 200 MB, GIF).
- [ ] Nenhuma opção de transmissão ou de conexão aparece bloqueada por plano.
- [ ] Assinar por Pix e por cartão ativa o Nebula+ em até 1 min, sem reiniciar o app.
- [ ] O mesmo webhook recebido duas vezes não estende o plano duas vezes; webhook com assinatura errada é recusado.
- [ ] Vencido há mais de 3 dias, os extras somem sem apagar escolhas nem arquivos, e voltam ao renovar.
- [ ] Comprovante adulterado ou vencido na sala: sem selo e limite de 200 MB, sem erro para os outros.
- [ ] Sala fixa: o código continua valendo depois de reiniciar o servidor; pausada quando o plano vence.
- [ ] Cliente em versão antiga entra numa sala com assinantes sem erro.
- [ ] Administrador dá e tira cortesia pelo painel.
- [ ] Termos de uso e política de privacidade publicados e linkados na tela Nebula+.

## Testes
- Automáticos: `tests/razze-*.test.js` para rotas, webhook (assinatura, idempotência, vencimento e folga) e cortesia;
  `tests/*.test.js` para o comprovante (válido, vencido, adulterado) e para os limites de `sala-protocolo.js`; teste do
  servidor de salas para sala fixa e limite de 100. Provedor sempre simulado nos testes.
- Manuais: pagamento real no ambiente de teste (sandbox) do provedor, Pix e cartão; sala com um assinante, um não
  assinante e um em versão antiga (roteiro de teste); vencimento simulado pelo painel.

## Em aberto
- Preço. Antes de decidir: quantas pessoas usam fora do grupo de amigos e quanto a VPS custa por mês.
- Nome: "Nebula+" é provisório.
- Divisão da receita e conta que recebe (depende da licença).
