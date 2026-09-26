Motor oficial WireGuard for Windows 1.1.1, amd64 (WireGuard LLC).
Fonte: https://git.zx2c4.com/wireguard-windows/
Pacote: https://download.wireguard.com/windows-client/wireguard-amd64-1.1.1.msi
SHA-256 do MSI: 7bfed60ad61b785c914b38b61555a975488e1d3ec472dbfb2fcdf498fca75242

`npm run vpn:prepare` extrai `wireguard.exe` e verifica hash e assinatura Authenticode.
O executável não é armazenado no Git. É incluído no `.exe` do Tela P2P e no pacote de atualização quando preparado.
O app gerencia apenas seu próprio serviço `WireGuardTunnel$TelaP2PSelfVPN`, sem abrir a interface externa do WireGuard.
WireGuard é marca registrada de Jason A. Donenfeld. Este projeto não é afiliado ao WireGuard.
