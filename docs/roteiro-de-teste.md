# Roteiro de teste na call (uns 15 minutos)

Para ver com gente e microfone de verdade o que os testes automáticos só simulam. Todo mundo na mesma
versão do app, numa sala com pelo menos 3 pessoas, todas na voz. Anote o número de cada item que falhar,
quem estava fazendo e o que aconteceu.

## Voz

1. **Eco.** Uma pessoa tira o fone e deixa o som sair pela caixa. Os outros falam.
   Deve acontecer: ninguém ouve a própria voz voltando.
2. **Supressão de ruído (IA).** Uma pessoa digita forte no teclado, bate na mesa ou liga um ventilador perto
   do microfone, sem falar.
   Deve acontecer: os outros não ouvem quase nada. Depois, em Voz e atalhos, troque para **Básica** e repita:
   deve passar mais barulho.
3. **Sensibilidade automática.** Fique em silêncio por 10 segundos.
   Deve acontecer: o seu indicador na barra ("Na voz", com as barrinhas) não acende. Fale baixinho: ele acende e
   os outros te ouvem.
4. **Apertar para falar.** Em Voz e atalhos, escolha **Apertar para falar** e uma tecla (ou o Mouse 4). Vá para
   o jogo.
   Deve acontecer: sem apertar, ninguém te ouve; segurando, ouvem. A barra mostra "Segure …" e "Falando".
5. **Quem está falando.** Cada um fala uma frase.
   Deve acontecer: acende o anel verde de quem fala na lista de pessoas e a bolinha verde no botão de pessoas.

## Volume e atenuação

6. **Volume de uma pessoa.** Abra a lista de pessoas (o botão no topo do chat), clique no volume de alguém e
   coloque 50%. Em outra pessoa, 150%.
   Deve acontecer: uma fica mais baixa e a outra mais alta, só para você.
7. **Atenuação.** Alguém transmite um jogo com som. Em Voz e atalhos, coloque a atenuação em 60%.
   Deve acontecer: enquanto alguém fala na voz, o som da transmissão abaixa; volta sozinho meio segundo depois.

## Chat por cima do jogo e atalhos

8. **Ctrl+Enter no jogo.** Abra o chat por cima do jogo (o botão com a tela e as linhas), trave com
   Ctrl+Shift+E e vá para o jogo (em modo janela sem bordas). Aperte **Ctrl+Enter**, escreva e aperte **Enter**.
   Deve acontecer: a mensagem chega para todos e o teclado volta sozinho para o jogo. Repita apertando **Esc**
   no lugar do Enter: não manda nada e volta para o jogo.
9. **Trocar um atalho.** Em Voz e atalhos, troque o Ctrl+Enter por outro (por exemplo Ctrl+Alt+T) e repita o 8.
   Deve acontecer: o atalho novo funciona e o Ctrl+Enter volta a ser livre.

## Sala

10. **Troca de host de verdade.** Quem criou a sala **fecha o app** no meio da call (sem clicar em Sair).
    Deve acontecer: em uns 5 a 15 segundos, a pessoa que entrou primeiro vira host sozinha. A voz e as
    transmissões continuam, e o botão de pessoas mostra "Host" nela.

11. **Sessões abertas.** Uma pessoa cria uma sala; as outras ficam na tela inicial, sem entrar.
    Deve acontecer: em até 5 segundos, aparece "Sessão de <nome>" na lista de todo mundo, com o número de
    pessoas. Clique em **Entrar** e confira que entra direto. Se não aparecer para alguém, anote quem (é o
    aviso pela Radmin que não passou) e se o Windows pediu permissão do firewall ao abrir o app.
12. **Sessão oculta.** Crie outra sala com **Mostrar esta sessão** desmarcado. Deve acontecer: ela não
    aparece na lista de ninguém, mas dá para entrar pelo endereço.

## Anotações

| Item | Quem | O que aconteceu |
|------|------|-----------------|
|      |      |                 |
