# Servidor da VPN própria

Esta branch adiciona uma rede WireGuard integrada ao Tela P2P 1.8.9. É necessário hospedar este servidor antes de conectar PCs pela internet. Nenhum servidor de produção está incluído ou provisionado automaticamente.

## Arquitetura e limites

- Uma VPS Linux funciona como hub: cada PC inicia um túnel UDP para ela, inclusive atrás de CGNAT. Todos os pacotes entre PCs passam pela VPS. Redes que bloqueiam esse UDP ainda podem impedir a conexão; não há fallback TCP/TURN.
- Rede fixa `10.77.0.0/24`, servidor `10.77.0.1`, clientes `.2` a `.254`; limite inicial de 12 dispositivos cadastrados. Não há rota padrão, NAT para a internet, alteração de DNS ou encaminhamento para outras redes da VPS.
- Cada instalação Windows gera sua chave privada localmente. Só a pública chega ao controlador por HTTPS. O convite é a credencial de entrada em um único grupo de confiança, não uma senha de sala.
- Todos os membros da rede podem acessar as portas dos demais pela interface VPN. O app cria uma regra de entrada limitada à interface `TelaP2PSelfVPN` e a essa faixa. Use convites somente com pessoas de confiança. O WireGuard é uma rede IP de camada 3: jogos precisam aceitar conexão por IP; descoberta por broadcast de LAN não é implementada.
- O hub termina os túneis WireGuard; portanto ele é um ponto de confiança e pode observar o tráfego IP encaminhado. O WebRTC mantém a própria criptografia. O chat/sinalização `ws:` do app não ganha criptografia ponta a ponta adicional.
- A troca de host da sala da versão 1.8.9 continua funcionando com os IPs da VPN. Se a VPS cair, a rede inteira fica indisponível.

## Preparar uma VPS (Debian/Ubuntu com systemd)

Pré-requisitos: um domínio com registro A apontado ao IPv4 público da VPS, Node.js 20 ou superior, WireGuard (`wg`, `wg-quick`), `iptables` e Caddy. Instale os pacotes pelos repositórios adequados à sua distribuição. Confira `node --version`, `wg --version` e `caddy version` antes de continuar.

No firewall do provedor e do sistema, permita **UDP 51820** e **TCP 80/443** de entrada. Preserve sua regra de SSH. A API administrativa em **127.0.0.1:8788 não deve ser exposta**; o teste de conectividade em **10.77.0.1:8789** deve ser acessível somente pela interface `tela0`. Se houver UFW, além das portas públicas, permita `ufw allow in on tela0 to 10.77.0.1 port 8789 proto tcp`. As regras de encaminhamento entre clientes são criadas pelo `wg-quick`.

1. Coloque o código desta branch em `/opt/tela-selfvpn`, incluindo `server/` e `selfvpn/protocol.js`. Não é preciso instalar Electron ou dependências npm no servidor: o controlador usa apenas módulos nativos do Node.

   ```bash
   sudo git clone --branch naitsi_selfvpn https://github.com/MateusMunhoz/AmostradinhoScreenShare.git /opt/tela-selfvpn
   cd /opt/tela-selfvpn
   sudo node server/configure.js vpn.seudominio.com
   ```

   O comando recusa sobrescrever uma configuração existente. Ele cria as chaves e os tokens em arquivos acessíveis apenas ao administrador. O domínio de exemplo precisa ser substituído pelo seu.

2. Habilite encaminhamento IPv4 e os serviços:

   ```bash
   echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/90-tela-selfvpn.conf
   sudo sysctl --system
   sudo cp server/tela-selfvpn.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now wg-quick@tela0
   sudo systemctl enable --now tela-selfvpn
   ```

3. Integre o bloco gerado em `/etc/tela-selfvpn/Caddyfile` à configuração do Caddy. Em uma VPS dedicada recém-configurada, você pode copiá-lo para `/etc/caddy/Caddyfile`. Em servidor com outros sites, acrescente o bloco mantendo os sites existentes. Depois:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   sudo systemctl status tela-selfvpn --no-pager
   sudo wg show tela0
   ```

   O Caddy fornece HTTPS e só publica `/v1/enroll`. Não publique `/admin/*`. Não habilite logs de cabeçalhos de autorização.

4. Gere o convite e compartilhe-o de forma privada:

   ```bash
   sudo node /opt/tela-selfvpn/server/invite.js
   ```

   O convite contém o token de entrada. Não coloque a saída em commits, issues ou screenshots públicos. Em cada PC, cole em **VPN própria** e clique **Conectar VPN**; autorize o Windows. Espere **servidor acessível**, crie a sala e passe o endereço `10.77.0.x:8765` aos amigos que entraram na mesma VPN.

## Operação

- Configuração: `/etc/tela-selfvpn/server.json`; pares: `/var/lib/tela-selfvpn/peers.json`. Ambos são necessários para restaurar o servidor com os mesmos clientes. Guarde também `/etc/wireguard/tela0.conf` com proteção adequada.
- O campo `maxPeers` controla a capacidade (até 253); reinicie `tela-selfvpn` após alterar. O padrão é 12 dispositivos, incluindo cadastros offline.
- O convite é compartilhado e reutilizável. Para impedir novos cadastros com um convite vazado, substitua `inviteToken` por 32 bytes aleatórios em base64url (43 caracteres), reinicie o controlador e gere outro convite. A rotação não derruba dispositivos já cadastrados; revogue-os separadamente.
- Administração local: envie `Authorization: Bearer <adminToken>` a `GET http://127.0.0.1:8788/admin/peers` para listar e `POST http://127.0.0.1:8788/admin/revoke` com JSON `{"publicKey":"..."}` para revogar. Use um cliente que leia o token de `server.json`; não o coloque em histórico de shell. A revogação remove a chave do WireGuard e impede que a mesma chave se cadastre novamente. O endereço fica disponível para outro dispositivo. Um usuário que ainda possua o convite pode gerar uma nova identidade, portanto combine revogação com rotação do convite quando necessário.
- A API limita 120 pedidos por minuto para a rede inteira e no máximo 2 KiB por cadastro. Mantenha somente uma instância do controlador: não execute vários processos sobre o mesmo arquivo de pares.
- Estado **túnel ativo, servidor sem resposta**: confira DNS público, UDP 51820, encaminhamento IPv4, firewall, `systemctl status`, `journalctl -u tela-selfvpn`, `wg show tela0` e acesso ao TCP 8789 pela VPN. Um adaptador presente não comprova handshake.
- Não habilite `SaveConfig=true` no `wg-quick`: os pares são gerenciados pelo controlador e restaurados do registro ao reiniciar.

## Aplicativo Windows e distribuição

```powershell
npm ci
npm run vpn:prepare
npm start
```

`vpn:prepare` baixa o MSI oficial **WireGuard 1.1.1 amd64**, verifica SHA-256 e assinatura Authenticode e extrai o motor em `bin/selfvpn`. Não instala o WireGuard nem cria adaptador durante o build. `prestart`, `predist` e `prepublicar` também preparam o motor; offline, a cópia já verificada pode ser reutilizada. Gere o portátil com `npm run dist`.

O app usa o serviço de túnel oficial via CLI, empacotado como componente interno, sem depender da interface ou configuração manual do aplicativo WireGuard. Ele não implementa um novo protocolo criptográfico nem um driver próprio. Suporte inicial: **Windows x64**. ARM64 e x86 precisam de um pacote e testes específicos.

O renderer não recebe chaves privadas. A identidade é protegida com `safeStorage`/DPAPI em `selfvpn.json` no diretório de dados do app. A solicitação de elevação trafega por stdin e por um arquivo temporário cifrado com DPAPI, com ACL restrita. O helper valida novamente a configuração; só aceita a faixa privada fixa, sem scripts `PostUp`, DNS ou rotas arbitrárias.

O túnel usa exclusivamente `WireGuardTunnel$TelaP2PSelfVPN`. O motor e a configuração ativa ficam em `%ProgramData%\TelaP2P-SelfVPN`, acessíveis somente a Administradores e SYSTEM. A configuração ativa contém a chave privada sob essa ACL. **Desconectar** remove o serviço, a configuração ativa e a regra de firewall; mantém a identidade cifrada do app para reconectar. Não remove outros túneis ou drivers usados por outros apps.

Fechar o app mantém a VPN ativa, como indicado na interface. O serviço fica em inicialização manual e não volta sozinho depois de reiniciar o Windows. **Conectar VPN** substitui um serviço anterior que esteja parado. A VPN pode ser alterada apenas fora de uma sala. O Windows solicita UAC a cada conectar/desconectar; não é necessário executar o Electron inteiro como administrador.

## Validação antes de distribuir amplamente

- `npm test`: protocolo, convites, rejeição de configurações perigosas, chaves, persistência e concorrência de cadastros, autenticação, revogação, controlador PowerShell em modo de validação, voz e sinalização.
- `npm run test:rtc`: transporte WebRTC com áudio sintético e interface real em janelas ocultas. Não acessa o microfone real ou instala VPN.
- `npm run dist`: verifica o empacotamento do motor e scripts.

Ainda exige validação operacional em dois PCs e uma VPS: aceitar/cancelar UAC, instalar/remover o adaptador, handshake, revogar um PC ativo, reboot, conexão por redes distintas/CGNAT, transmitir tela/voz/arquivos e migrar o host pela VPN. Nenhum teste local com adaptadores simulados substitui esses testes.

Fontes: [WireGuard Windows enterprise](https://git.zx2c4.com/wireguard-windows/about/docs/enterprise.md), [WireGuard quickstart](https://www.wireguard.com/quickstart/), [pacotes oficiais](https://download.wireguard.com/windows-client/).
