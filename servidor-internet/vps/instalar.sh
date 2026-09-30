#!/usr/bin/env bash
# Instala (ou atualiza) o modo Internet do Tela P2P numa VPS Ubuntu: servidor das salas + coturn (STUN/TURN).
# Pode rodar de novo quantas vezes quiser: mantém o segredo do TURN e só atualiza o código e as configurações.
#
#   sudo bash instalar.sh                  # usa o IP público detectado
#   sudo IP_PUBLICO=203.0.113.10 bash instalar.sh
#   sudo RAMO=main bash instalar.sh        # outro ramo do GitHub
set -euo pipefail

REPO="${REPO:-https://github.com/MateusMunhoz/AmostradinhoScreenShare}"
RAMO="${RAMO:-modo-internet}"
DIR=/opt/tela-p2p
ENV_FILE=/etc/tela-p2p-internet.env
SALA_PORT="${SALA_PORT:-8765}"
TURN_PORT="${TURN_PORT:-3479}"

passo() { printf '\n==> %s\n' "$*"; }
falha() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || falha "rode como root (sudo bash instalar.sh)"
command -v apt-get >/dev/null || falha "este script é para Ubuntu/Debian"

passo "Programas (coturn, git, Node.js)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q || echo "Aviso: algum repositório do apt falhou no update; seguindo com o que já está disponível."
apt-get install -y -q coturn git curl openssl ca-certificates iproute2 >/dev/null
NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -q nodejs >/dev/null
fi
echo "Node $(node -v), coturn $(turnserver --version 2>/dev/null | head -1 || echo instalado)"

passo "IP público"
IP="${IP_PUBLICO:-}"
[ -n "$IP" ] || IP=$(curl -fsS4 --max-time 5 https://api.ipify.org || true)
[ -n "$IP" ] || IP=$(hostname -I | awk '{print $1}')
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || falha "não consegui descobrir o IP público; rode com IP_PUBLICO=x.x.x.x"
echo "$IP"

passo "Portas livres"
porta_ocupada() { ss -H -lntup 2>/dev/null | awk '{print $5}' | grep -Eq "[:.]$1\$"; }
if porta_ocupada "$SALA_PORT" && ! systemctl is-active --quiet tela-p2p-internet; then
  falha "a porta $SALA_PORT já está em uso por outro programa (ss -lntup | grep $SALA_PORT). Rode com SALA_PORT=outra"
fi
if porta_ocupada "$TURN_PORT" && ! systemctl is-active --quiet coturn; then
  falha "a porta $TURN_PORT já está em uso por outro programa. Rode com TURN_PORT=outra"
fi
porta_ocupada 3478 && echo "A 3478 já está em uso (provavelmente o STUN da RazzeAPI): tudo bem, o coturn usa a $TURN_PORT."
echo "ok"

passo "Código ($REPO, ramo $RAMO)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q --depth 1 origin "$RAMO"
  git -C "$DIR" checkout -q -B "$RAMO" FETCH_HEAD
else
  rm -rf "$DIR"
  git clone -q --depth 1 -b "$RAMO" "$REPO" "$DIR"
fi
cd "$DIR/servidor-internet"
npm ci --omit=dev --no-audit --no-fund --silent
echo "versão $(git -C "$DIR" log -1 --format='%h %s')"

passo "Segredo do TURN"
SECRET=""
[ -f "$ENV_FILE" ] && SECRET=$(grep -E '^TURN_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
if [ ${#SECRET} -lt 32 ] || [ "$SECRET" = "SEGREDO_DO_TURN" ]; then SECRET=$(openssl rand -hex 32); echo "gerado"; else echo "mantido"; fi

passo "coturn (STUN/TURN na porta $TURN_PORT)"
sed -e "s/IP_DA_VPS/$IP/" -e "s/SEGREDO_DO_TURN/$SECRET/" -e "s/^listening-port=.*/listening-port=$TURN_PORT/" \
  vps/turnserver.conf > /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf && chmod 640 /etc/turnserver.conf
mkdir -p /var/log/turnserver && chown turnserver:turnserver /var/log/turnserver
if [ -f /etc/default/coturn ]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
fi
systemctl enable -q coturn
systemctl restart coturn

passo "Servidor das salas (porta $SALA_PORT)"
sed -e "s/IP_DA_VPS/$IP/" -e "s/SEGREDO_DO_TURN/$SECRET/" -e "s/^PORT=.*/PORT=$SALA_PORT/" -e "s/^TURN_PORT=.*/TURN_PORT=$TURN_PORT/" \
  vps/tela-p2p-internet.env > "$ENV_FILE"
chmod 600 "$ENV_FILE"
cp vps/tela-p2p-internet.service /etc/systemd/system/tela-p2p-internet.service
systemctl daemon-reload
systemctl enable -q tela-p2p-internet
systemctl restart tela-p2p-internet

passo "Firewall do sistema (ufw)"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "$SALA_PORT/tcp" >/dev/null
  ufw allow "$TURN_PORT/tcp" >/dev/null
  ufw allow "$TURN_PORT/udp" >/dev/null
  ufw allow 49160:49999/udp >/dev/null
  echo "portas liberadas no ufw"
else
  echo "ufw desligado: nada a fazer aqui (confira o firewall do painel da hospedagem)"
fi

passo "Conferindo"
sleep 2
systemctl is-active --quiet coturn || { journalctl -u coturn -n 20 --no-pager; falha "o coturn não subiu"; }
systemctl is-active --quiet tela-p2p-internet || { journalctl -u tela-p2p-internet -n 20 --no-pager; falha "o servidor das salas não subiu"; }
SAUDE=$(curl -fsS --max-time 5 "http://127.0.0.1:$SALA_PORT/health" || true)
echo "$SAUDE" | grep -q '"turn":true' || falha "o servidor respondeu sem TURN: $SAUDE"
ss -H -lnu | grep -q ":$TURN_PORT " || falha "o coturn não está ouvindo na UDP $TURN_PORT"

cat <<FIM

PRONTO.
  Servidor das salas: ws://$IP:$SALA_PORT   ($SAUDE)
  STUN/TURN:          $IP:$TURN_PORT (UDP e TCP), relay UDP 49160-49999

No firewall do painel da hospedagem, libere (entrada):
  TCP $SALA_PORT, TCP $TURN_PORT, UDP $TURN_PORT, UDP 49160-49999

No app: aba Rede > Internet (servidor) > ws://$IP:$SALA_PORT > Testar e salvar.
FIM
