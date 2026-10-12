# Confirmação de e-mail e verificação em dois fatores

Status: Implementada em 12/10/2026 (branch `conta-identificador-2fa`), com as recomendações das decisões em aberto. Falta o deploy da RazzeAPI na VPS e o teste manual em dois PCs.
Complementa [identificador-nome-tag.md](identificador-nome-tag.md).

## Objetivo
Manter o login por senha com segurança: o e-mail de uma conta só vale depois de confirmado (ninguém prende o e-mail de
outra pessoa) e quem quiser liga um segundo fator (código do celular) para a senha sozinha não bastar. Também permite que
uma conta criada pelo Google defina senha e troque o e-mail.

## Escopo
- Entra: envio de e-mail pelo servidor, código de confirmação no cadastro e na troca de e-mail, "esqueci a senha" por
  e-mail, 2FA por app autenticador (TOTP) com códigos de recuperação, código pedido em ações sensíveis e no painel.
- Fica de fora: SMS (custo e golpe de troca de chip), chave física/passkey (fica para depois), 2FA por e-mail como
  segundo fator (o e-mail já é o que se recupera; não protege contra quem tomou o e-mail).

## Comportamento esperado

### Envio de e-mail
- A RazzeAPI manda e-mail por **SMTP do Gmail** (decidido em 12/10/2026), com um Gmail só do app (ex.:
  `nebula.app.codigos@gmail.com`), verificação em duas etapas ligada nele e uma **senha de app**. Não precisa de domínio
  próprio e o e-mail chega bem (sai do Google). Limite de ~500 envios por dia, que sobra para o grupo.
- **Cliente SMTP próprio** (`razze-api/email.js`), sem dependência: `node:tls` direto em `smtp.gmail.com:465`
  (TLS desde o início), `EHLO`, `AUTH PLAIN`, `MAIL FROM`, `RCPT TO`, `DATA` (com os pontos no início de linha
  dobrados), `QUIT`. Mensagem em texto puro UTF-8 (`Content-Type: text/plain; charset=utf-8`,
  `Content-Transfer-Encoding: base64`, assunto em `=?UTF-8?B?...?=`), com `Date` e `Message-ID`. Confere o código de
  cada resposta do servidor e desiste em 15 s. Certificado verificado (sem `rejectUnauthorized: false`).
- Envio fora do caminho da resposta: o pedido responde na hora e o e-mail vai numa fila em memória com 3 tentativas
  (1, 10 e 60 s). Falhou de vez: fica no log do servidor (sem o código) e a pessoa usa "Reenviar".
- Configuração no `.env` da VPS: `RAZZE_SMTP_HOST` (padrão `smtp.gmail.com`), `RAZZE_SMTP_PORT` (padrão `465`),
  `RAZZE_SMTP_USER`, `RAZZE_SMTP_PASS` (a senha de app) e `RAZZE_EMAIL_FROM` (padrão: o próprio usuário, com o nome
  "Nebula"). Como é SMTP comum, trocar depois por outro provedor (Brevo, SES, e-mail da Hostinger com domínio próprio) é
  só mudar essas variáveis.
- Se o Google bloquear a conta por envio automático, os envios falham e o painel mostra "E-mail com erro"; até resolver,
  vale o código do administrador.
- Sem `RAZZE_SMTP_USER` configurado, o servidor funciona como hoje: sem confirmação, e "esqueci a senha" só pelo código do
  administrador. O painel mostra "E-mail não configurado".
- Texto simples, em português, sem links (o código é digitado no app): "Seu código do Nebula é 482 913. Vale por
  15 minutos. Se não foi você, ignore este e-mail."

### Código de e-mail
- 6 dígitos, vale **15 minutos**, **5 tentativas**; guardado só o hash. Reenviar depois de 60 s, no máximo 5 envios por
  hora por conta e por IP (o mesmo `enforceAuthLimit` do login).
- Um código por finalidade (`cadastro`, `trocar-email`, `senha`): o de uma não serve para outra.

### Cadastro por senha
1. A pessoa preenche nome do identificador, nome de exibição, e-mail e senha.
2. O servidor cria a conta **sem e-mail confirmado** e manda o código; o app mostra "Enviamos um código para
   l•••s@gmail.com".
3. Com o código certo, o e-mail fica confirmado e a conta entra.
4. **Conta não confirmada em 24 h é apagada**, e o e-mail e o identificador ficam livres. Antes disso, outra pessoa que
   confirme o mesmo e-mail (pelo código ou pelo Google) **ganha**: a conta não confirmada é apagada. Assim ninguém prende
   o e-mail de outra pessoa.

### Conta criada pelo Google definir senha e trocar o e-mail
- Em Conta → Formas de entrar → **"Entrar também com senha"**: a pessoa escolhe a senha e o e-mail que quer usar
  (vem preenchido com o atual).
  - Mesmo e-mail: só define a senha (o e-mail já foi confirmado pelo Google).
  - E-mail novo: manda o código para o e-mail novo; a senha e o e-mail só mudam depois do código certo.
- Depois disso a conta tem duas formas de entrar e pode **desvincular o Google e vincular outro** (fluxo de
  [Trocar uma forma de login](identificador-nome-tag.md#trocar-uma-forma-de-login-por-outra)).

### Trocar o e-mail (conta com senha)
- Em Conta → E-mail: pede a senha (e o código do 2FA, se ligado), manda o código para o e-mail novo, troca só depois.
- O e-mail antigo recebe um aviso: "O e-mail da sua conta lucas#0420 foi trocado. Se não foi você, fale com o
  administrador."
- O e-mail novo não pode ser de outra conta confirmada. A entrada na lista de convidados acompanha a conta.

### Esqueci a senha
- No login: "Esqueci a senha" → e-mail ou identificador → código no e-mail confirmado → senha nova. Derruba as outras
  sessões. Com 2FA ligado, pede também o código do autenticador (ou de recuperação).
- O código do administrador continua existindo como último recurso.

### Contas que já existem
- Conta de senha com e-mail não confirmado: aviso no app "Confirme seu e-mail" com Enviar código. Pode continuar usando,
  mas não troca o e-mail nem usa "esqueci a senha" por e-mail até confirmar. Nada é apagado.
- Contas do Google já estão confirmadas (`email_verificado = 1`).

### Login por senha e o modo "só Google"
- O login por senha aceita **e-mail ou identificador** (`lucas#0420`) e a senha.
- Muda o significado do modo "só Google" (`googleOnly`): passa a valer só para **cadastro novo**. Conta com senha e
  e-mail confirmado entra por senha mesmo com ele ligado. O `legacyPasswordLogin` deixa de ser necessário e o plano de
  desligá-lo (roadmap, "Futuro") sai.

### Dois fatores (2FA) por app autenticador
- **Ligar:** Conta → Segurança → "Verificação em dois fatores" → pede a senha → mostra o QR code (`renderer/qr.js`, já
  existe) e a chave em texto → a pessoa digita um código do app (Google Authenticator, Microsoft Authenticator, 2FAS,
  Authy...) para confirmar → mostra **10 códigos de recuperação** de uso único, uma vez só, com Copiar e Salvar em
  arquivo.
- **TOTP padrão** (RFC 6238: 6 dígitos, 30 s, SHA-1), feito com `node:crypto`, sem dependência. Aceita o código anterior
  e o seguinte (relógio do celular adiantado ou atrasado) e não aceita o mesmo código duas vezes.
- A chave fica cifrada no banco (AES-GCM com `RAZZE_TOTP_KEY` do `.env`); os códigos de recuperação, só o hash.
- **Login por senha com 2FA:** senha certa → o servidor responde `2fa_required` com um desafio que vale 5 min →
  o app pede o código (ou "Usar código de recuperação") → entra. 5 erros no mesmo desafio: volta para a senha.
- **Login pelo Google:** não pede o 2FA do Nebula (o Google já tem o dele). *Decisão em aberto, abaixo.*
- **Ações sensíveis** pedem o código do 2FA (ou a senha, se o 2FA estiver desligado): trocar e-mail, trocar senha,
  vincular, desvincular ou mover forma de login, desligar o 2FA, gerar códigos de recuperação novos e excluir a conta.
- **Administradores:** 2FA **obrigatório** para entrar no painel (`/admin/` e o painel do app).
- **Perdeu o celular e os códigos:** o administrador pode desligar o 2FA da conta pelo painel, com o aviso de confirmar
  por outro canal que é a pessoa; fica no log de auditoria (`2fa.reset`) e a pessoa recebe um e-mail avisando.
- Ligar, desligar e usar código de recuperação mandam e-mail de aviso para o dono da conta.

### Versões antigas do app e Android
- App antigo com 2FA ligado na conta: o login por senha responde `2fa_required` com a mensagem "Atualize o app para
  entrar com verificação em dois fatores", que o app antigo já mostra. Entrar pelo Google continua funcionando.
- Respostas novas (`emailVerified`, `twoFactor`) entram como acréscimo no `publicUser`.

## Restrições
- RazzeAPI sem dependências novas (e-mail por SMTP com `node:tls`, TOTP por `node:crypto`).
- Nada de e-mail de marketing; só os códigos e avisos de segurança.
- Códigos e chaves nunca vão para log; e-mail mascarado nas telas (`l•••s@gmail.com`).
- Textos em português; sem `style=""` (CSP); IPC com argumentos validados no `main`.

## Dependências
- Um Gmail só do app com verificação em duas etapas e senha de app (sem custo).
- `razze-api/email.js` (novo): cliente SMTP e fila de envio; entra no `COPY` do `razze-api/Dockerfile` (hoje ele copia arquivo por arquivo).
- `razze-api/server.js`: tabelas `email_codes(user_id, finalidade, email, code_hash, tentativas, expires_at)`,
  `two_factor(user_id, secret_enc, enabled_at, last_step)`, `recovery_codes(user_id, code_hash, used_at)`,
  `login_challenges`; rotas `/v1/auth/register` (com confirmação), `/v1/auth/confirm-email`, `/v1/auth/login`
  (identificador e desafio), `/v1/auth/login/2fa`, `/v1/auth/forgot`, `/v1/me/email`, `/v1/me/password`,
  `/v1/me/2fa` (ligar, confirmar, desligar, novos códigos); limpeza das contas não confirmadas.
- `razze-api/control.js` e `razze-api/admin/`: 2FA obrigatório para admin, "Desligar 2FA" da conta, status do e-mail.
- `main/razze-api-client.js`, `main/razze-service.js`, `main.js`, `preload.js`; `renderer/conta.js`,
  `renderer/primeira-entrada.js`, `renderer/admin.js`, `renderer/qr.js`.
- `docs/razze-api.md`: criar o Gmail e a senha de app, e configurar `RAZZE_SMTP_*` e `RAZZE_TOTP_KEY` na VPS.

## Decisões em aberto (com recomendação)
1. ~~Provedor de e-mail~~ Decidido (12/10/2026): Gmail por SMTP com cliente próprio.
2. **Pedir o 2FA do Nebula também no login pelo Google?** Recomendo não (o Google já protege); quem quiser mais
   segurança liga o 2FA no próprio Google.
3. **2FA obrigatório para todos?** Recomendo opcional, obrigatório só para administradores.
4. **"Lembrar este PC" (não pedir 2FA por 30 dias)?** Recomendo não por enquanto: o 2FA só é pedido em login novo, e a
   sessão do PC já dura.

## Critérios de aceitação
- [ ] Cadastro por senha só entra com o código do e-mail; conta não confirmada some em 24 h e não prende o e-mail.
- [ ] Conta do Google define senha e e-mail novo; o e-mail só muda com o código; depois troca de Google normalmente.
- [ ] Trocar e-mail e esqueci a senha funcionam pelo código; o e-mail antigo recebe aviso.
- [ ] Login por senha aceita e-mail ou identificador, inclusive com o modo "só Google" ligado.
- [ ] 2FA liga com QR code, pede código no login por senha e nas ações sensíveis; códigos de recuperação funcionam uma
      vez só; admin sem 2FA não entra no painel.
- [ ] Sem SMTP configurado, o servidor funciona como hoje.
- [ ] App antigo recebe mensagem clara quando a conta tem 2FA.

## Testes
- Automáticos (`tests/razze-*.test.js`, com relógio e envio de e-mail falsos injetados): cliente SMTP contra um
  servidor SMTP falso local (TLS com certificado de teste): conversa certa, `AUTH` recusado, resposta de erro no
  `RCPT`, tempo esgotado, ponto no início de linha e assunto com acento; fila com novas tentativas; código certo, errado, vencido,
  5 tentativas, reenvio e limite por hora; conta não confirmada apagada em 24 h e quando outra confirma o e-mail; troca de
  e-mail com aviso ao antigo; esqueci a senha com e sem 2FA; TOTP com os vetores da RFC 6238, janela ±1, código repetido
  recusado; códigos de recuperação de uso único; ações sensíveis sem código recusadas; admin sem 2FA recusado; servidor
  sem SMTP.
- Manuais: e-mail real chegando na caixa de entrada (Gmail e Outlook, não no spam); ligar o 2FA com Google
  Authenticator no celular; login em dois PCs; app antigo com conta de 2FA.
