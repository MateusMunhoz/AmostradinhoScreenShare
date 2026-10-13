# Perfil em abas

Issue: — · Roadmap: —

## Objetivo
O **Seu perfil** era uma coluna só, com duas telas de altura, misturando como você aparece, o que mostra e a conta. A conta
(entrar, sair, Conta e segurança) ficava no fim, depois de rolar tudo, e metade dela numa janela separada. Agora são duas abas:
**Perfil** (como os outros te veem) e **Conta** (a conta Razze inteira).

## Escopo
- Entra: Perfil e Conta numa barra à esquerda, como em Configurações (em janela estreita, viram uma linha em cima; o lado direito rola sozinho); nome e frase editados no próprio cartão; identificador com Copiar no cartão; interruptores de
  jogo, música e sala no Perfil; a janela Conta e segurança vira a aba Conta, com o aviso do que falta e Trocar de conta e Sair da conta no rodapé.
- Fica de fora: mudanças no servidor; Steam e histórico continuam em Configurações › Atividade.

## Comportamento esperado
- **Abrir:** na Conta quando falta algo nela (identificador para escolher ou e-mail para confirmar, com o servidor mandando
  e-mail); senão na última aba usada. Quem chama "entrar na conta" (Amigos sem conta, convite de amigo) abre direto na Conta.
- **Aba Perfil:** o cartão de prévia (fundo, foto, nome na fonte escolhida, identificador com **Copiar**, conta da sala e
  frase). O lápis do nome e da frase abre o campo no lugar; Enter, Esc ou clicar fora fecha (Esc não fecha o perfil). Na sala o
  nome não abre: um aviso diz que só dá fora da sala. Frase vazia aparece como "Escreva uma frase". Embaixo, **Aparência** (foto,
  fundo, fonte do nome) e **O que os amigos veem** (jogo, música, em que sala estou), espelhando Configurações › Atividade nos
  dois sentidos, com um link para o resto.
- **Aba Conta:** sem conta, o formulário de entrar ou criar conta (e Google). Com conta: quem está conectado (e
  **Administração**, para administradores), o aviso do que falta (uma bolinha na aba e uma faixa com o botão: **Escolher** o
  identificador ou **Enviar código** do e-mail), as linhas identificador, e-mail, senha, Google e dois fatores, e **Sair da
  conta** num rodapé que fica sempre à vista.

## Restrições
- CSP sem estilo inline; classic scripts (`openProfilePopup`, `setProfileTab`, `pendenciaDaConta` globais).
- Os ids de antes continuam (`profileName`, `profileBio`, `razzeAuth`, `razzeLogout`...), para o resto do app e os testes.

## Dependências
`index.html` (`#profilePane`), `renderer/navegacao.js` (abas e edição no cartão), `renderer/conta-seguranca.js` (aba Conta),
`renderer/conta.js` (interruptores), `renderer/conectividade.js` (sair), `renderer/hub.js` (abrir na Conta), `styles.css`.

## Critérios de aceitação
- [x] Duas abas; a escolha fica salva; abre na Conta quando há pendência.
- [x] Nome e frase editam no cartão; Esc fecha só o campo; na sala o nome não abre.
- [x] Interruptores do Perfil e de Configurações › Atividade andam juntos.
- [x] Conta e segurança não é mais janela; Sair da conta sempre visível na aba Conta.

## Testes
- Automáticos: `npm test`, `npm run test:settings`, e2e `carga` e `fotos`.
- Manuais: conta nova com e-mail (aviso e bolinha), conta antiga sem identificador escolhido, nome travado na sala.
