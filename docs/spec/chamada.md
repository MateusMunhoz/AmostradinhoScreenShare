# Ligar pela mensagem privada e mudar a senha da sala

Status: Implementada (ainda sem versão publicada)

## Objetivo
Chamar um amigo com um clique, como num telefone: o app cria a sala, a senha e a chamada; o amigo atende e cai na
voz. E poder trocar a senha de uma sala aberta.

## Escopo
- Entra: botão de ligar (chip da conversa e HUB › Amigos), a escolha do modo de rede, a sala escondida com senha
  gerada, a chamada pela mensagem privada, o aviso e o cartão de quem recebe, Atender; a senha no Painel da sala
  (ver, copiar, mudar) e a mensagem `senha` no protocolo.
- Fica de fora: chamada em grupo, recusar ou desligar a chamada pela mensagem, toque contínuo.

## Comportamento
1. **Ligar** (`renderer/chamada.js`, `ligarPara`): uma janelinha com os três modos. O que não está pronto
   (`motivoModoIndisponivel`) fica desativado com o motivo. Ao confirmar: sai da sala atual (pergunta antes), passa a
   usar o modo (como trocar em HUB › Rede), gera a senha (9 caracteres de um alfabeto sem 0/O/1/I/L, uns 44 bits:
   `K7P-4MX-Q2R`) e abre a sala:
   - Internet: `hello { create: true, password }`, com `amigos: false` (não anuncia na lista dos amigos);
   - Radmin e Razze: `startServer` com `sessao.oculta: true` (não aparece nas sessões abertas, nem depois de uma
     troca de host).
   Entra na voz (Voz geral) e manda a mensagem privada.
2. **A mensagem:** texto legível (com o código ou o endereço e a senha, para app antigo) e a linha
   `telap2p://sala?d=` do convite ([salas-dos-amigos.md](salas-dos-amigos.md)) com `chamada: true` e `chave` (a
   senha). Vai criptografada de ponta a ponta, como toda mensagem privada.
3. **Quem recebe:** `lerConvite` só aceita `chave` com 4 a 64 caracteres, sem caracteres de controle; senão, é um
   convite comum. Mensagem de chamada que chegou há menos de 2 min: som (`mention`) e aviso com **Atender**. O cartão
   diz "está te ligando" com **Atender** por 10 min; depois, "Chamada de [nome]" com **Entrar**.
4. **Atender** (`atenderChamada`): em outro modo, pergunta antes de trocar; na Razze, confere a conta, o túnel e a
   mesma rede. Entra com a senha e vai para a voz. Já na mesma sala, só abre a sala.
5. **Senha da sala** (Painel da sala, `renderSenhaSala`): aparece para quem sabe a senha e para o host. Escondida por
   padrão, com mostrar e copiar. **Mudar** só para o host e só se o servidor tiver a feature `senha`.

## Protocolo
- `senha { password }` (do app ao servidor): só do host; até 64 caracteres, sem caracteres de controle
  (`cleanSenha`, `sala-protocolo.js`).
  - Radmin e Razze (`signaling.js`): vazia tira a senha.
  - Internet (`servidor-internet/server.js`): mínimo `minPassword` (4); troca o HMAC da senha e limpa os passes (a
    chave dos passes fica, para quem entrou por um passe ainda voltar depois de a conexão cair).
- `senha { password, by }` (do servidor a todos): quem já está continua. No modo Internet, quem entrou por um passe
  recebe só `{ by }`, sem a senha.
- `senha-erro { message }`: não é o host, ou a senha não vale.
- `host { id }` (só Internet): o host saiu; assume quem está há mais tempo e entrou com a senha (senão, quem está há
  mais tempo). Antes, o host do modo Internet nunca mudava.
- Feature `senha` no welcome dos dois servidores.

## Compatibilidade
- App antigo ignora `senha`, `senha-erro` e `host`. Na Radmin/Razze, um app antigo que vire host depois de uma troca
  recria o servidor com a senha que ele tinha (a antiga).
- Servidor da VPS sem atualizar: sem a feature `senha`, o **Mudar** fica desativado e explica. A chamada funciona.
- App antigo que recebe a chamada vê o convite comum; o texto traz a senha.

## Segurança
- A senha vai na mensagem privada (criptografada de ponta a ponta); o servidor Razze não a vê. O convite comum
  continua sem senha.
- O servidor Internet continua guardando só o HMAC da senha.

## Testes
- Automáticos: `tests/signaling.test.js` e `tests/servidor-internet.test.js` (só o host muda; a antiga e os passes
  param de valer; quem entrou por passe não recebe a nova mas ainda volta; host novo no modo Internet);
  `tests/e2e/chamada.cjs` (dois apps: ligar e atender pelos modos Internet e Radmin, voz, aviso, cartão, mudar a
  senha, convites inválidos).
- Manuais: dois PCs em casas diferentes, em cada modo; VPS atualizada (Mudar no modo Internet) e antiga (desativado).
