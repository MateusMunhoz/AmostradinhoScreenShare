# Configurações guardadas no celular

Issue: — · Roadmap: — · **Implementada** (o que mudou em relação ao plano está em "Como ficou", no fim)

## Objetivo
Cada pessoa guarda as configurações do Tela P2P no **próprio celular** e as traz de volta em qualquer PC, sem
servidor do projeto e sem conta. O celular funciona como o "pendrive" da pessoa: guarda um arquivo cifrado e o
entrega ao PC novo. Não precisa instalar nada no celular (é o navegador dele, Android ou iPhone).

## Escopo
- Entra: guardar as configurações num arquivo cifrado no celular, restaurar num PC (o mesmo ou outro), pela rede
  local (Wi-Fi), com QR code e senha.
- Fica de fora: sincronização automática (é uma foto do momento), guardar no servidor Razze, app de celular, senha
  da conta Razze e chaves (nunca vão no arquivo), histórico das mensagens diretas (fica para uma v2, como opção
  desligada por padrão).

## Comportamento esperado

### Guardar no celular
1. Configurações gerais › nova seção **Celular** › **Guardar no celular**.
2. O app pede uma **senha** (mínimo 6 caracteres, digitada duas vezes) no PC. Ela não é guardada em lugar nenhum.
3. O app cifra as configurações no PC e mostra um **QR code** com o endereço da página na rede local
   (`http://<IP-local>:<porta>/c/<chave de uso único>`), mais o endereço escrito, para quem não tiver câmera.
4. A pessoa lê o QR com a câmera do celular. Abre uma página simples (servida pelo próprio app) com o botão
   **Baixar arquivo**; o celular salva `tela-p2p-config-AAAA-MM-DD.tp2p` (Downloads no Android, Arquivos no iPhone).
5. O PC mostra "Arquivo entregue ao celular" e fecha o QR. A chave do QR deixa de valer.

### Trazer do celular
1. Em qualquer PC, Configurações gerais › Celular › **Trazer do celular** (também no Início, na primeira vez que o
   app abre, como um link discreto).
2. O app mostra o QR. No celular, a página tem **Escolher arquivo**: a pessoa escolhe o `.tp2p` e envia.
3. O PC pede a **senha**. Com a senha certa, mostra um resumo ("Tema Constelação, nome Cris, foto, microfone, 12
   volumes de amigos, atalhos") e o botão **Aplicar**. Aplicar troca as configurações deste PC e reinicia a interface.
4. Senha errada: "Senha errada. Tente de novo." (o arquivo continua recebido; 5 erros seguidos descartam o arquivo).

### Erros e casos-limite
- Celular em outra rede (4G, outro Wi-Fi): a página não abre. O PC mostra, depois de 30 s sem acesso: "O celular
  precisa estar no mesmo Wi-Fi deste PC."
- Vários IPs (Radmin, WireGuard, Wi-Fi): o QR usa o IP da rede local (192.168/10/172.16–31), não o da Radmin
  (26.x) nem o do Razze. Com mais de um IP local, uma lista para escolher embaixo do QR.
- QR aberto por mais de 5 minutos: expira e fecha ("O código expirou. Gere outro.").
- Arquivo de versão mais nova do app: aplica só o que esta versão entende e avisa.
- Arquivo que não é do Tela P2P, corrompido ou alterado: "Este arquivo não é uma configuração do Tela P2P." (a
  cifra autenticada recusa qualquer alteração).
- Restaurar dentro de uma sala: o nome não muda até sair (mesma regra de hoje no perfil); o resto aplica na hora.

## O que vai no arquivo
| Vai | Chave hoje |
|---|---|
| Tema, cores, aparência, fontes, sons e volumes dos avisos | `appPreferences.v1` (passa por `AppPreferences.normalize`) |
| Nome, foto de perfil e o encaixe dela | `name`, `fotoPerfil`, `fotoPerfilInteira`, `fotoEncaixe` |
| Microfone, ruído, eco, modo de fala, sensibilidade, atenuação | `vozConfig` (o `micId` vai, mas só vale se o mesmo microfone existir; senão, o padrão do Windows) |
| Volume de cada amigo, volume da música | `volumes`, `musicaVolume` |
| Painéis, palco, mapa da voz | `workspaceViews.v1`, `stageLayout`, `stageSide`, `vozVisao`, `mapaFixo`, `panelOpen` |
| Transmissão: qualidade, codificação, som, apps ignorados, mouse, prioridade | `quality`, `encodeMode`, `audioMode`, `excludeApps`, `mostrarMouse`, `priority` |
| Atalhos de teclado | `atalhos.json` no processo principal (`main/atalhos.js`) |

**Nunca vai:** `clientId` (identifica este PC; dois PCs com o mesmo id se confundem na sala), sessão e tokens da
conta Razze, chaves do WireGuard, `roomAddr`/`roomPort`, caches (`foto:*`, `fotosGuardadas`, `sessoesConhecidas`,
`connectionMapNetworks.v1`), estado de tela (`hubTab`, `settingsTab`, `dicas`, `novidadesVistas`).

## Formato do arquivo
JSON com `{ app: 'tela-p2p-config', v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt },
cipher: { name: 'AES-GCM', iv }, data }` (salt, iv e data em base64). Dentro de `data`, depois de decifrar:
`{ created, appVersion, items: { <chave>: <valor> } }`. Tamanho máximo: 2 MB (a foto é o item maior).

## Restrições
- **Sem servidor do projeto.** Só a rede local, PC ↔ celular.
- **A cifra é feita no PC, não no celular.** A página do celular é servida por `http://` num IP local, e os
  navegadores só liberam a WebCrypto em contexto seguro (https ou localhost): a página do celular só baixa e envia o
  arquivo, sem cripto. No PC, a WebCrypto do renderer funciona (página local do Electron).
- A senha é digitada **só no PC** e nunca sai dele.
- Chave de uso único no endereço (32 bytes aleatórios, base64url), válida por 5 minutos e por **um** download ou
  **um** envio. Sem a chave, o servidor responde 404 a tudo.
- O servidor da rede local só existe com a janela do QR aberta: abre numa porta livre e fecha ao terminar, expirar
  ou cancelar.
- A página do celular é um HTML fixo servido pelo app (sem CDN, sem script de fora), com CSP própria
  (`default-src 'none'; style-src 'unsafe-inline'; form-action 'self'`), legível no celular, claro e escuro.
- **Validação de tudo que chega** (invariante 5 do AGENTS.md): tamanho, formato, versão; cada item validado antes
  de aplicar (`AppPreferences.normalize`, os mesmos limites que o app já usa ao carregar cada chave, a foto pelo
  mesmo caminho de `setMyPhoto` em `renderer/fotos.js`). Chave desconhecida é ignorada.
- Firewall do Windows: o app já abre porta para a sala (`signaling.js`, `0.0.0.0`); conferir se a mesma regra
  cobre a porta nova. Se o Windows perguntar, o texto da janela explica.
- Sem animação contínua; o QR é estático.

## Plano para aprovação (processo principal e ponte)
Mexe em `main.js`/`preload.js`, então precisa de aprovação antes de implementar (AGENTS.md › Como trabalhar).

**Novo módulo `main/celular.js`** (entra em `PACK_FILES` e `build.files`):
- `abrirEntrega(arquivoCifrado)` → sobe um `http.createServer` em `0.0.0.0`, porta livre, gera a chave e devolve
  `{ urls: ['http://192.168.0.10:PORTA/c/CHAVE', ...], expira }`. `GET /c/CHAVE` → a página; `GET /c/CHAVE/arquivo`
  → o `.tp2p` (`Content-Disposition: attachment`). Depois do download, avisa a página (evento) e fecha.
- `abrirRecebimento()` → mesmo servidor; `GET /c/CHAVE` → página com o envio; `POST /c/CHAVE/arquivo` (até 2 MB,
  só JSON com `app: 'tela-p2p-config'`) → entrega o conteúdo à página do PC (evento) e fecha.
- `fechar()` → derruba o servidor (também ao sair do app).
- IPs: reaproveitar a lógica de `get-ips` e filtrar as faixas privadas, sem Radmin (26.0.0.0/8) e sem as interfaces
  Razze.

**Canais novos (`preload.js` › `window.api`)**, todos validados no `main.js`:
| Função | Faz |
|---|---|
| `celularEntregar(textoCifrado)` | string até 2 MB; abre a entrega; devolve `{ urls, expira }` |
| `celularReceber()` | abre o recebimento; devolve `{ urls, expira }` |
| `celularFechar()` | fecha o que estiver aberto |
| `onCelular(cb)` / `offCelular()` | eventos: `{ tipo: 'entregue' }`, `{ tipo: 'recebido', texto }`, `{ tipo: 'expirou' }` |
| `atalhosExportar()` / `atalhosImportar(obj)` | lê e grava `atalhos.json` pela validação que `main/atalhos.js` já faz |

**Renderer:** `renderer/celular.js` novo (depois de `configuracoes.js`, antes de `inicio.js`; `PACK_FILES` e
`build.files`): juntar os itens, cifrar e decifrar (WebCrypto), validar e aplicar, a janela do QR. O QR é gerado
localmente por um gerador pequeno em `vendor/qr/` (sem CDN; licença em `vendor/qr/LICENSE`).

## Dependências
`main.js`, `preload.js`, `main/celular.js` (novo), `main/atalhos.js`, `renderer/celular.js` (novo),
`renderer/configuracoes.js` (seção Celular), `renderer/preferencias-modelo.js` (`normalize`), `renderer/fotos.js`,
`index.html`, `styles.css`, `publicar.js` (`PACK_FILES`), `package.json` (`build.files`), `vendor/qr/`.

## Critérios de aceitação
- [ ] Guardar: com senha, o celular no mesmo Wi-Fi baixa um `.tp2p` pelo QR; a chave não serve uma segunda vez.
- [ ] Trazer: em outro PC, o arquivo enviado pelo celular com a senha certa restaura tema, nome, foto, voz, volumes,
      painéis, transmissão e atalhos; o `clientId` deste PC não muda.
- [ ] Senha errada, arquivo alterado, arquivo de outro app ou acima de 2 MB: recusados com a mensagem certa, nada
      aplicado.
- [ ] Sem a chave, qualquer endereço do servidor responde 404; depois de 5 min, de cancelar ou de terminar, a porta
      fecha.
- [ ] O QR usa o IP do Wi-Fi/rede local, não o da Radmin nem o do Razze.
- [ ] Nenhum item fora da lista "Vai" é lido do arquivo nem escrito neste PC.
- [ ] Funciona com Android (Chrome) e iPhone (Safari).

## Testes
- Automáticos (novos):
  - `tests/celular.test.js`: cifrar/decifrar ida e volta, senha errada, arquivo alterado (GCM recusa), itens
    desconhecidos ignorados, `clientId` e tokens nunca exportados, limite de 2 MB.
  - `tests/celular-servidor.test.js`: `main/celular.js` sem Electron: 404 sem chave, chave de uso único,
    expiração, POST acima do limite recusado.
  - `npx electron tests/e2e/carga.cjs` com o arquivo novo na página.
- Manuais: guardar num PC e trazer em outro, com Android e com iPhone; celular no 4G (mensagem de mesmo Wi-Fi); PC
  com Radmin e WireGuard ligados (IP certo no QR); firewall do Windows num PC limpo.

## Como ficou (diferenças do plano)
- O gerador de QR é próprio, em `renderer/qr.js` (não em `vendor/qr/`): é código do projeto, sem licença de fora.
  Conferido com o leitor de QR do OpenCV nas versões 1 a 10 e na tela do app.
- Os atalhos usam os canais que já existiam (`getShortcuts`/`setShortcut`, com a validação de `main/atalhos.js`): sem
  `atalhosExportar`/`atalhosImportar`. Ao aplicar, primeiro solta todos e depois põe os do arquivo (dois podem
  trocar de lugar).
- O modelo (lista, validação e cifra) ficou em `renderer/celular-modelo.js`, separado da interface
  (`renderer/celular.js`), para os testes rodarem no Node.
- Trazer exige estar fora de uma sala (aplicar recarrega a interface), em vez de aplicar parte na hora.
- Testes: `tests/celular.test.js` (modelo e QR) e `tests/celular-servidor.test.js` (servidor).
- O limite subiu de 2 para **4 MB** com o fundo do perfil (`fundoPerfil`, GIF ou WebP de até 1 MB; [spec](fundo-do-perfil.md)), que também vai no arquivo e é conferido pelo hash.
