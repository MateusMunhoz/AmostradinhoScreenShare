# Licença do projeto

Status: Pendente (tarefa futura: precisa do ok dos três titulares)

## Objetivo
Deixar escrito o que quem recebe o Tela P2P pode e não pode fazer. Sem licença, já vale "todos os direitos
reservados" (Lei 9.609/1998 e Lei 9.610/1998), mas fica ambíguo para quem recebe o app. A licença não impede
tecnicamente ninguém de ler o código do `.exe` (o `app.asar` e o `pack.json` são legíveis); ela dá a base para
agir contra cópia, revenda ou versão modificada publicada como se fosse do projeto.

## Decisões já tomadas
- Licença **proprietária**: uso livre e de graça; copiar, modificar, redistribuir ou publicar versões derivadas só
  com autorização por escrito.
- **Três titulares, em partes iguais, de todo o projeto:** Cristian (Nyon0k), Mateus (MateusMunhoz) e Andrick.
- Os componentes de terceiros continuam com as licenças deles (os avisos já estão em `vendor/`, `bin/selfvpn/` e
  `native/third_party/`).

## O que falta
- [ ] Preencher no texto abaixo: o nome completo de cada um, o usuário do GitHub do Andrick e a cidade/UF do foro.
- [ ] Os três lerem e concordarem por escrito (mensagem no grupo serve).
- [ ] Opcional: uma revisão de alguém da área de propriedade intelectual, se o app for comercial.
- [ ] Criar `LICENSE` na raiz com o texto final.
- [ ] `README.md` › "Quem fez": os três como titulares, "todos os direitos reservados" e o link para o `LICENSE`.
- [ ] `package.json`: `"author"` com os três, `"license": "SEE LICENSE IN LICENSE"` e `"LICENSE"` em `build.files`
  (para ir dentro do `.exe` e do instalador).
- [ ] Opcional: mostrar os termos no app (no pé das Configurações, junto da versão).

## Rascunho do texto

```text
Copyright (c) 2025-2026 [Nome completo do Cristian] (Nyon0k), [Nome completo do Mateus] (MateusMunhoz)
e [Nome completo do Andrick] ([usuário do GitHub]). Todos os direitos reservados.

1. Titulares

O Tela P2P (o código-fonte, os executáveis, os pacotes de atualização, a interface, os textos, os ícones, os
temas e a documentação, chamados aqui de "Software") é obra conjunta dos três titulares acima, em partes iguais.
Os direitos são protegidos pela Lei nº 9.609/1998 (programas de computador) e pela Lei nº 9.610/1998 (direitos
autorais). Qualquer autorização além do que esta licença permite precisa ser dada por escrito pelos três titulares.

2. O que é permitido

Quem recebe o Software de um dos titulares, ou pela página oficial de versões do projeto, pode instalá-lo e usá-lo
de graça, para fins pessoais, em quantos computadores quiser, e receber as atualizações oficiais.

3. O que não é permitido sem autorização por escrito dos três titulares

a) copiar, extrair, ler para reaproveitar, modificar, traduzir ou adaptar o código-fonte, no todo ou em parte;
b) redistribuir, vender, alugar, sublicenciar ou disponibilizar o Software, ou versões modificadas dele, em
   qualquer lugar (sites, lojas, grupos, servidores de arquivos), fora dos canais oficiais do projeto;
c) publicar atualizações, pacotes ou versões derivadas usando o nome Tela P2P ou se passando pelo projeto;
d) remover ou alterar avisos de autoria, de direitos autorais ou de licença, inclusive os de terceiros;
e) usar o Software, ou partes dele, em outro produto.

4. Componentes de terceiros

O Software inclui componentes de outros autores, que continuam sob as licenças deles e não fazem parte desta
licença. Os avisos ficam junto com cada componente e devem acompanhar qualquer cópia autorizada:

- RNNoise, em WebAssembly (vendor/noise): licença MIT, ver vendor/noise/LICENSE.
- mp4-muxer (vendor/mp4-muxer): licença MIT, ver vendor/mp4-muxer/LICENSE.
- WireGuard for Windows, wireguard.exe (bin/selfvpn): licença MIT, ver bin/selfvpn/COPYING.
- wireguard-tools, wg.exe (bin/selfvpn): licença GPL-2.0; o código-fonte e os detalhes estão em
  bin/selfvpn/NOTICE.md. "WireGuard" é marca registrada de Jason A. Donenfeld.
- NVIDIA Video Codec SDK, cabeçalho nvEncodeAPI.h (native/third_party): licença MIT, aviso no próprio arquivo.
- Electron, Chromium e as bibliotecas do Node.js usadas pelo app: licenças próprias, que acompanham o executável.

5. Sem garantia

O Software é oferecido "como está", sem garantia de nenhum tipo. Na medida em que a lei permitir, os titulares
não respondem por danos, perda de dados ou problemas causados pelo uso do Software.

6. Fim da licença

Quem descumprir esta licença perde automaticamente a permissão de uso do item 2, sem prejuízo das medidas
previstas em lei.

7. Foro

Fica eleito o foro da comarca de [cidade/UF] para resolver questões sobre esta licença.
```
