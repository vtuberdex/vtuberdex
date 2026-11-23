#!/usr/bin/env bash
# Instala o actualiza el agente en la VPS. Idempotente. Uso: sudo minecraft-agente/instalar.sh
# - copia agente.mjs y pty-puente.py a /opt/vtuberdex-mc-agente (root, solo lectura para minecraft)
# - crea /etc/vtuberdex-mc-agente.env con un token nuevo si no existe (AGENTE_TOKEN y VTUBERDEX_MC_AGENTE_TOKEN)
# - instala el servicio y el drop-in de la web, y reinicia el agente (la web hay que reiniciarla aparte
#   la PRIMERA vez, para que lea el token).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "ejecútalo con sudo" >&2; exit 1; }
aqui="$(cd "$(dirname "$0")" && pwd)"

install -d -o root -g root -m 0755 /opt/vtuberdex-mc-agente
install -o root -g root -m 0644 "$aqui/agente.mjs" "$aqui/pty-puente.py" /opt/vtuberdex-mc-agente/

if [ ! -s /etc/vtuberdex-mc-agente.env ]; then
  token="$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 64)"
  umask 077
  printf 'AGENTE_TOKEN=%s\nVTUBERDEX_MC_AGENTE_TOKEN=%s\n' "$token" "$token" > /etc/vtuberdex-mc-agente.env
  chmod 600 /etc/vtuberdex-mc-agente.env
  echo "token nuevo en /etc/vtuberdex-mc-agente.env"
fi

install -o root -g root -m 0644 "$aqui/vtuberdex-mc-agente.service" /etc/systemd/system/
install -d -m 0755 /etc/systemd/system/vtuberdex.service.d
install -o root -g root -m 0644 "$aqui/web-mc-agente.conf" /etc/systemd/system/vtuberdex.service.d/mc-agente.conf
systemctl daemon-reload
systemctl enable --now vtuberdex-mc-agente
systemctl restart vtuberdex-mc-agente
systemctl --no-pager --lines=5 status vtuberdex-mc-agente
