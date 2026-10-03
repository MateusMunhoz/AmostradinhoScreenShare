# Salas dos amigos pelo modo Internet

Status: Implementada (1.13.0)

## Objetivo
No modo Internet as salas só eram achadas por código + senha passados por fora. Agora os amigos do Razze veem as
salas uns dos outros na tela inicial e entram com um clique, sem precisar da VPN Razze.

## Escopo
- Entra: anúncio da sala Internet na presença da RazzeAPI, lista só para amigos aceitos, entrada por passe de
  convite (etapa B) e volta para a senha quando o passe não vale ou o servidor é antigo (etapa A).
- Fica de fora: lista pública no servidor da VPS (sem contas lá, todo mundo veria tudo); anúncio por quem não criou
  a sala; mostrar as salas Internet com o app em Radmin ou Razze.

## Comportamento
1. **Criar:** no modo Internet, a caixinha **Mostrar esta sala para meus amigos do Razze** (marcada por padrão, a
   mesma preferência `sessaoVisivel` do Radmin). Marcada, o app de quem criou:
   - gera um passe (32 bytes aleatórios, base64url, 43 caracteres) e manda `{ type: 'passe', passe }` ao servidor,
     se o welcome trouxer a feature `passe`;
   - manda `{ servidor, codigo, pessoas, passe }` ao processo principal (`razze-internet-room`), que vai na batida
     da presença (`internetRoom`). Abrir, fechar ou trocar o passe dispara a batida na hora; o número de pessoas
     vai na batida seguinte.
2. **API:** guarda o anúncio em `live_presence.internet_room` e devolve em `GET /v1/rooms` → `internet`, só para
   amigos aceitos, com o nome de quem anunciou. Some com a presença (70 s) ou na batida sem `internetRoom`.
3. **Lista:** no modo Internet, a seção da tela inicial vira **Salas dos seus amigos**, e o HUB › Salas mostra as
   mesmas (menos a sala em que você está). Sem conta Razze, a lista explica como ver.
4. **Entrar:** `hello { room, passe }` no servidor da sala do amigo. Se a resposta for "O convite não vale mais",
   abre o Entrar com código com o código preenchido, e a senha vai para o servidor da sala do amigo
   (`salasAmigos.alvo`), não para o da aba Rede.
5. **Voltar depois de a conexão cair:** quem entrou pelo passe volta com o mesmo passe (`resume`), mesmo que quem
   convidou já tenha saído, enquanto o servidor guarda o lugar dela.

## Servidor (servidor-internet/server.js)
- `passe { passe }`: só quem entrou com a senha registra; um por pessoa; `null` tira. Guardado como HMAC com uma
  chave da sala; conferido contra todos, sem parar no primeiro.
- `hello { room, passe }`: entra se o passe estiver ativo, ou se `resume` apontar para quem entrou com esse mesmo
  passe. Passe errado conta no limite de tentativas por IP. Com passe e sem senha, o erro é "O convite não vale
  mais. Peça a senha da sala." (o mesmo para sala inexistente: não revela códigos).
- O passe sai quando quem o registrou sai da sala.

## Segurança
- A RazzeAPI vê o passe (é ela que entrega aos amigos), mas ele só serve para aquela sala, enquanto quem convidou
  estiver nela. A senha da sala nunca sai do PC de quem criou.
- O painel de administração não mostra `internet_room`.
- App e API só aceitam endereço `ws://`/`wss://` sem usuário, senha ou parâmetros, e o código no alfabeto do
  servidor.

## Compatibilidade
- Servidor antigo: sem a feature `passe`, o anúncio vai com `passe: null` e o amigo digita a senha.
- RazzeAPI antiga: não devolve `internet`; a lista fica vazia.
- App antigo: ignora `internet` na resposta.

## Testes
- Automáticos: `tests/servidor-internet.test.js` (passe: entra, só quem entrou com senha cria, sai com quem
  convidou, volta com o mesmo passe, `null` tira), `tests/razze-control.test.js` (só amigos veem, validação,
  expira, admin não vê), `tests/razze-presence.test.js` (`cleanInternetRoom`, batida e lista).
- Manuais: dois PCs em casas diferentes, amigos no Razze, VPS e RazzeAPI atualizadas: criar, ver na lista do
  outro, entrar com um clique; quem criou sai e o outro tenta de novo (pede a senha); VPS antiga (pede a senha).
