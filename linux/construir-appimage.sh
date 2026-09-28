#!/usr/bin/env bash
# Gera o Tela-P2P.AppImage (Linux). Roda dentro do Linux: no Windows, o publicar.js chama pelo WSL (Ubuntu).
# O Electron do Linux é outro, então o projeto é copiado para uma pasta do Linux, com node_modules próprio.
#   bash linux/construir-appimage.sh /mnt/c/.../AmostradinhoScreen
# Precisa do Node.js no Linux (sudo apt install nodejs npm).
set -euo pipefail
SRC="${1:?informe a pasta do projeto}"
DEST="$HOME/tela-p2p-linux"
mkdir -p "$DEST"
# Copia tudo menos o que é deste PC ou gerado (node_modules do Linux fica, para não baixar de novo)
find "$DEST" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
tar -C "$SRC" --exclude=./node_modules --exclude=./dist --exclude=./.git --exclude=./prototipo-ui \
  --exclude=./backup-antes-dos-popups --exclude=./.claude --exclude=./servidor/dados -cf - . | tar -C "$DEST" -xf -
cd "$DEST"
npm ci --no-audit --no-fund
npx electron-builder --linux AppImage --publish never
mkdir -p "$SRC/dist"
cp dist/Tela-P2P.AppImage "$SRC/dist/Tela-P2P.AppImage"
echo "AppImage pronto: dist/Tela-P2P.AppImage"
