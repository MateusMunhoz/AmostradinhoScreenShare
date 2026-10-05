# Auditoria do fluxo: da primeira abertura até estar na chamada

*05/10/2026. Feita lendo `index.html`, `renderer/inicio.js`, `hub.js`, `chamada.js`, `salas-amigos.js`, `mensagens.js` e
`razze-api/server.js`, e o `docs/guia.md`. Não foi medido com gente usando; os números de cliques são contados no código.
Ainda não mudei nada no app.*

## Como é hoje

**Peças que existem:** Início (nome, sessões abertas, Criar sala, Entrar com endereço, Última sala, Novidades) · tela
Criar sala (porta, senha, visível) · sala · **HUB** (barra fina na borda; abas Salas, Amigos, Rede) · conta Razze
(e-mail + senha, dentro de HUB › Rede) · mensagens diretas (barra embaixo) · perfil (barrinha da direita).

**Não existe:** tela de primeira abertura, escolha de "como vou usar", convite de amigo por link, "esqueci a senha",
trocar senha, bio. O app começa no modo Internet com o servidor da equipe, mas a conta não é pedida em lugar nenhum.

## Cenários (cliques contados no código)

### A. Primeira abertura, sem conta, criar uma sala e chamar um amigo
1. Início abre com o título "Sua tela, direto no PC dos amigos.", campo de nome (vazio), cartão de sessões ("Procurando
   sessões abertas na rede…") e dois botões.
2. **Criar sala** → tela *Criar sala* (porta 8765, senha, "mostrar na rede") → **Criar sala** de novo. **2 cliques e 3
   campos que o iniciante não sabe o que são** (porta).
3. Dentro da sala, o endereço (`26.50.x.x:8765`) está no botão do rodapé. Para o amigo entrar, **você copia e manda por
   fora do app** (Discord, WhatsApp).
4. Amigo: Início → **Entrar com endereço** → cola endereço + senha → **Entrar**. 3 passos, e só funciona se ele tiver
   a mesma VPN (Radmin) ou se a porta estiver aberta.
- **Veredito:** funciona, mas o app depende de outro app para convidar. É o ponto mais fraco.

### B. Primeira abertura, com conta Razze (o caminho "bom")
1. Achar a conta: ela está em **HUB › Rede**, junto com servidor, VPN, WireGuard e mapa de conexões. O HUB é uma barra
   fina com a palavra "HUB"; **nada no Início diz que existe conta nem para quê**.
2. Criar conta: nome na rede + e-mail + senha. Se o servidor exige aprovação (`status: pending`), a pessoa recebe
   "aguarda aprovação" e **fica sem poder usar amigos até alguém aprovar**: beco sem saída na primeira experiência.
3. Entrar → HUB › **Amigos** → **Adicionar** → digitar o **nickname exato** → Enviar pedido.
4. O amigo precisa **ter conta, estar com o app aberto e aceitar** (aba Pedidos). Só depois aparece na lista.
5. **Ligar** (ícone de telefone na linha do amigo): o app pergunta o modo, sai da sala atual se houver, cria uma sala,
   entra na voz e manda o convite pelas mensagens; o amigo vê o cartão e clica **Entrar**.
- **Cliques até a primeira chamada com um amigo novo:** ~12 (achar HUB, Rede, criar conta, entrar, Amigos, Adicionar,
  nickname, Enviar, espera, Ligar, escolher modo) **+ a espera do outro lado.**

### C. Já tem conta e amigos (uso diário)
- Início mostra "Salas dos seus amigos" (se estiverem criando sala) → **Entrar** direto (passe de convite): **1 clique.**
  É o melhor trecho do app.
- Chamar alguém: HUB › Amigos › telefone (3 cliques), ou o ícone de telefone no chip da conversa.
- Voltar à última sala: **Entrar de novo** (1 clique, só no Início).

### D. Ir e voltar (os ciclos que você notou)
- Para ver o Início dentro de uma sala existem **4 botões diferentes**: `dockHome` (casinha da barrinha), "Menu inicial"
  no HUB, "Voltar para a sala" na barrinha e na faixa verde do Início. São a mesma ideia com nomes diferentes.
- Em chamada, **Criar sala e Entrar com endereço ficam desabilitados** e só o *tooltip* explica ("volte e saia antes").
- Ligar para alguém estando numa sala abre uma confirmação ("Sair desta sala e ligar…?").
- Criar sala é uma tela à parte com botão **Voltar**; entrar com endereço é um painel que abre e fecha no mesmo lugar.
  Dois padrões para a mesma família de ação.

## O que está redundante ou confuso (em ordem de dor)

1. **Convidar depende de app externo** (copiar endereço). Falta link/código de convite do próprio app.
2. **Conta escondida** em "Rede" e sem explicar o benefício; é a porta dos amigos, mas parece configuração técnica.
3. **Aprovação manual de conta** trava o primeiro uso.
4. **Três identidades:** "Você entra como" no Início, "Seu nome na rede" na conta e o *nickname exato* para ser achado.
5. **Adicionar amigo por nickname exato:** sem busca, sem link, sem "meu código". Errar uma letra = "não achou".
6. **Criar sala pede porta/senha/visível** para quem só quer abrir uma chamada.
7. **Início com 6 blocos** na primeira vez (título, nome, sessões vazias, 2 botões, última sala, novidades, rodapé).
8. **Quatro "voltar ao início/sala"** e botões desabilitados sem aviso visível.
9. **Sem recuperação de senha** nem troca de senha.
10. **O HUB** é uma barra de uma palavra que reúne coisas sem relação (salas, amigos, rede técnica). O nome não diz o que há.

## Como deveria ficar (proposta)

### Primeira abertura (3 telas, uma por vez, sem voltar)
1. **"Como você quer usar?"** Duas escolhas grandes, e fica fixada (muda em Configurações):
   - **Com amigos (recomendado)** → pede conta (Google depois; por enquanto e-mail) com nome.
   - **Só uma sala rápida** → só o nome, sem conta (P2P por endereço, como hoje).
2. **Nome e foto** (foto opcional, pode pular).
3. **Pronto**: cai no Início já com a ação principal da escolha feita.

### Início depois de logado (um bloco principal)
```
 [foto] Andrick  ·  "bio curta aqui"                       [HUB]  [⚙]
 ┌──────────────────────────────────────────────────────────────┐
 │  AMIGOS ONLINE (3)                                           │
 │   ● Cristian   Jogando Valorant        [📞 Ligar] [💬]        │
 │   ● Mateus     Ouvindo Metallica       [📞 Ligar] [💬]        │
 │   ○ + Convidar amigo (copiar link)                           │
 ├──────────────────────────────────────────────────────────────┤
 │  SALAS ABERTAS DOS AMIGOS         [Entrar]                   │
 ├──────────────────────────────────────────────────────────────┤
 │  [ Abrir minha sala ]     Última sala: Entrar de novo        │
 └──────────────────────────────────────────────────────────────┘
```
- **Abrir minha sala** em 1 clique com padrões bons (porta automática, sem senha ou senha gerada, visível para amigos);
  "Opções" recolhido para quem quer porta/senha.
- **Convidar amigo:** gera **link/código do app** (`telap2p://amigo/...`) para copiar; quem recebe abre o app, entra
  na conta e o pedido de amizade já vai pronto. Sem digitar nickname.
- Amigos e salas **à vista no Início**; o HUB fica para o que é técnico (rede, mapa) e para quem quer a lista completa.

### Estar na chamada (um caminho por intenção)
- Amigo online → **Ligar** (1 clique, já entra na voz).
- Sala de amigo aberta → **Entrar** (1 clique).
- Minha sala → **Abrir** (1 clique) → **Copiar convite** (link do app, não endereço cru).
- Dentro da sala só **um** botão para o Início ("Início") e **uma** faixa para voltar, nunca os dois.

### Meta de usabilidade
- Do app novo até estar numa chamada com alguém: **≤ 3 telas e ≤ 8 cliques** (hoje ~12 + espera).
- Rotina diária (já com amigos): **1 clique** para ligar ou entrar.

## Comparação honesta com o Discord
- **Onde o Discord é melhor hoje:** convite por link, "entrar no canal" sempre à vista, amigos na tela principal,
  recuperação de conta, bio/status.
- **Onde o Tela P2P já é melhor:** passe de convite sem senha entre amigos (1 clique), mensagens com criptografia de
  ponta a ponta, transmissão direta de PC para PC, nada de loja de assinaturas.
- **O que falta para empatar o essencial:** convite por link, conta explicada, amigos no Início e primeira entrada guiada.
  Isso está no plano `docs/spec/primeira-entrada-e-perfil.md`.
