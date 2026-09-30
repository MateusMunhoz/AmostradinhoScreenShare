# Servidor do modo Internet

Com ele, ninguém precisa de Radmin nem de VPN. A sala fica numa VPS, os amigos entram com **código + senha**, e o vídeo, o áudio e a voz vão direto de um PC para o outro. Quando a internet de alguém não deixa a conexão direta (CGNAT de operadora, 4G, firewall), eles passam pelo **TURN** da VPS. Tudo vai criptografado de ponta a ponta (DTLS-SRTP): nem a VPS consegue ver a tela de ninguém.

São duas peças na VPS:

| Peça | O que faz | Porta |
|---|---|---|
| `server.js` (este) | Cria as salas, confere a senha, troca os "bilhetes" entre os PCs e entrega a cada pessoa um acesso temporário ao TURN | TCP 8765 |
| coturn | STUN (cada PC descobre o próprio endereço de fora) e TURN (carrega o vídeo quando o direto falha) | UDP e TCP 3479, UDP 49160–49999 |

A senha do TURN nunca fica dentro do app: o `server.js` e o coturn dividem um segredo (`TURN_SECRET` = `static-auth-secret`), e cada pessoa recebe, ao entrar na sala, um usuário que vence em 24 h.

## Instalar numa VPS (Ubuntu 22.04 ou 24.04)

O jeito fácil: um comando só, como root. Ele instala o Node e o coturn, baixa este ramo do GitHub para `/opt/tela-p2p`, gera o segredo do TURN, configura tudo, libera as portas no `ufw` (se ele estiver ligado) e confere se subiu. Pode rodar de novo para atualizar: o segredo é mantido.

```sh
curl -fsSL https://raw.githubusercontent.com/MateusMunhoz/AmostradinhoScreenShare/modo-internet/servidor-internet/vps/instalar.sh | sudo bash
```

No fim ele mostra o endereço para colocar no app (`ws://IP:8765`) e as portas para liberar no firewall do painel da hospedagem.

### Passo a passo manual (o que o script faz)

Tudo como root. Troque `IP_DA_VPS` pelo IP público da VPS.

```sh
# 1. Programas
apt update
apt install -y coturn git curl openssl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 2. Código (só a pasta do servidor e o sala-protocolo.js são usados)
git clone --depth 1 -b modo-internet https://github.com/MateusMunhoz/AmostradinhoScreenShare /opt/tela-p2p
cd /opt/tela-p2p/servidor-internet && npm ci --omit=dev

# 3. Segredo compartilhado entre o servidor e o coturn
SECRET=$(openssl rand -hex 32)
IP=IP_DA_VPS

# 4. coturn
cp vps/turnserver.conf /etc/turnserver.conf
sed -i "s/IP_DA_VPS/$IP/; s/SEGREDO_DO_TURN/$SECRET/" /etc/turnserver.conf
mkdir -p /var/log/turnserver && chown turnserver:turnserver /var/log/turnserver
grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn 2>/dev/null || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
systemctl enable coturn && systemctl restart coturn

# 5. Servidor das salas
cp vps/tela-p2p-internet.env /etc/tela-p2p-internet.env
sed -i "s/IP_DA_VPS/$IP/; s/SEGREDO_DO_TURN/$SECRET/" /etc/tela-p2p-internet.env
chmod 600 /etc/tela-p2p-internet.env /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf && chmod 640 /etc/turnserver.conf
cp vps/tela-p2p-internet.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now tela-p2p-internet

# 6. Firewall (e as mesmas portas no firewall do painel da hospedagem, se ele estiver ligado)
ufw allow 22/tcp
ufw allow 8765/tcp
ufw allow 3479/tcp
ufw allow 3479/udp
ufw allow 49160:49999/udp
ufw --force enable
```

Se a VPS também roda a RazzeAPI com Docker, ela já usa a 80, a 443 e a UDP 3478. Por isso o coturn fica na **3479**: não mexa na 3478.

## Conferir

```sh
systemctl status coturn tela-p2p-internet --no-pager
curl -s http://127.0.0.1:8765/health          # {"ok":true,"app":"tela-p2p-internet","salas":0,"turn":true}
journalctl -u tela-p2p-internet -f             # salas criadas e fechadas
tail -f /var/log/turnserver/turnserver.log     # uso do TURN
```

No app: aba **Rede** (ícone de servidor) → **Internet (servidor)** → `ws://IP_DA_VPS:8765` → **Testar e salvar**. Tem que aparecer "Servidor ok, com TURN".

Para provar que o TURN funciona, peça a alguém para entrar pelo 4G do celular (roteado para o PC). Ou, no DevTools do app de quem assiste, rode `RTC_CONFIG.iceTransportPolicy = 'relay'` antes de clicar em Assistir: com isso o vídeo só pode passar pelo TURN.

## Atualizar

Rode o `instalar.sh` de novo (o mesmo comando do começo). Ou, à mão:

```sh
cd /opt/tela-p2p && git pull && cd servidor-internet && npm ci --omit=dev && systemctl restart tela-p2p-internet
```

As salas abertas caem na reinicialização; os apps tentam voltar sozinhos por uns 18 s.

## Configuração (`/etc/tela-p2p-internet.env`)

| Variável | Padrão | O que é |
|---|---|---|
| `PORT` | 8765 | Porta do WebSocket das salas |
| `TURN_HOST` | vazio (sem TURN) | IP ou domínio público do coturn |
| `TURN_PORT` | 3479 | Porta do coturn |
| `TURN_SECRET` | — | O mesmo `static-auth-secret` do coturn (16+ caracteres) |
| `TURN_TTL_SECONDS` | 86400 | Validade do acesso ao TURN que cada pessoa recebe |
| `TURNS_URL` | vazio | Opcional: `turns:turn.seudominio.com:5349` (TURN com TLS, para firewalls que só liberam HTTPS) |
| `STUN_URLS` | `stun:stun.l.google.com:19302` | STUN extra, separados por vírgula |
| `MAX_ROOMS` | 200 | Salas abertas ao mesmo tempo |
| `CREATE_PER_IP_PER_HOUR` | 20 | Salas criadas por IP por hora |
| `FAIL_PER_IP` / `FAIL_WINDOW_MS` | 10 / 10 min | Tentativas erradas (código ou senha) antes de bloquear o IP |
| `RECONNECT_GRACE_MS` | 20000 | Quanto tempo o lugar de quem caiu fica guardado |
| `TRUST_PROXY` | 0 | 1 só atrás de Caddy/nginx (para o limite por IP usar o IP real) |

## Banda da VPS

Quando o vídeo passa pelo TURN, a VPS recebe e manda de novo: uma transmissão de 8 Mbit/s vista por 3 pessoas via TURN usa uns 24 Mbit/s de entrada e de saída. Na maioria das conexões o caminho é direto e a VPS não gasta nada com vídeo. O `max-bps` do `turnserver.conf` limita cada relay; confira o limite de tráfego do seu plano.

## Segurança, resumido

- Sala só com senha (mínimo 4, use uma forte); sala inexistente e senha errada respondem igual e no mesmo tempo; o IP é bloqueado depois de várias tentativas erradas.
- A senha fica guardada só como HMAC, em memória. Nada é gravado em disco.
- Pela internet, os IPs da casa de cada um não são repassados aos outros da sala.
- O coturn recusa relay para redes internas (10.x, 192.168.x, 127.x, a VPN Razze…).
- O WebSocket é `ws://` (sem TLS). A mídia continua criptografada, mas o nome, o chat e os arquivos do chat passam sem TLS até a VPS. Para fechar isso, publique atrás do Caddy com um domínio (`wss://sala.seudominio.com`) e `TRUST_PROXY=1`; o app já aceita `wss://`.
