#!/usr/bin/env bash
# Levanta VTuberDex en modo desarrollo publicado a la LAN, para revisarlo desde
# otra máquina.
#
# Por qué contenedores: Hermes corre dentro de un contenedor cuyos puertos no
# están publicados al host. Como /home/madkoding/proyectos es un bind-mount del
# host, el daemon de Docker resuelve esa ruta y sí puede publicar puertos de
# verdad (0.0.0.0 en el host).
#
# Arquitectura: DOS contenedores sobre una red interna.
#   · `vtuberdex-web`   — la app Next: catálogo, API de lectura e imágenes.
#   · `vtuberdex-admin` — el servidor Express de `server/`, que es el que ESCRIBE
#                         (subidas con `sharp`, edición). Next le reenvía
#                         `/api/admin/*` por el nombre del contenedor.
# Van separados porque el mantenedor necesita el FS escribible y `sharp`, que no
# tienen sitio en el bundle de una función de Vercel; en local sí, y así el
# `/admin` funciona igual que siempre.
#
# BLOQUEO FRECUENTE, ya contemplado: el firewall del host. Con ufw activo
# (política DROP) solo el 22 está abierto; desde otro PC hay que abrir el puerto
# o usar túnel SSH. El script lo recuerda al terminar.
#
# Uso:
#   ./scripts/dev-docker.sh                    # Next (3000) + mantenedor (4000)
#   ./scripts/dev-docker.sh --down             # los detiene
#   ./scripts/dev-docker.sh --logs             # sigue los logs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="vtuberdex-dev"
WEB_NAME="vtuberdex-web"
ADMIN_NAME="vtuberdex-admin"
WEB_PORT="${WEB_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-4000}"
IMAGE="${VTUBERDEX_IMAGE:-node:24-bookworm-slim}"
UID_GID="$(id -u):$(id -g)"

host_ip() {
  # IP LAN del host: la obtenemos desde un contenedor en modo host, porque
  # dentro de nuestra red bridge solo veríamos 172.18.0.x.
  docker run --rm --network host --entrypoint sh "$IMAGE" -c \
    "hostname -I | tr ' ' '\n' | grep -E '^(192\\.168|10\\.|172\\.(1[6-9]|2[0-9]|3[01]))' | grep -v '^172\\.1[78]\\.' | head -1" 2>/dev/null || echo "localhost"
}

down() {
  for name in "$WEB_NAME" "$ADMIN_NAME"; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
      docker rm -f "$name" >/dev/null && echo "✖ detenido $name"
    fi
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --down) down; exit 0 ;;
    --logs) docker logs -f "$WEB_NAME" & docker logs -f "$ADMIN_NAME"; wait; exit 0 ;;
    --web-port) WEB_PORT="$2"; shift ;;
    --admin-port) ADMIN_PORT="$2"; shift ;;
    *) echo "opción desconocida: $1" >&2; exit 1 ;;
  esac
  shift
done

# --- requisitos ---------------------------------------------------------------
[[ -f "$ROOT/data/vtuberdex.db" ]] || { echo "✖ falta data/vtuberdex.db (cd server && npm run seed)"; exit 1; }
[[ -d "$ROOT/node_modules" ]] || { echo "✖ falta node_modules en la raíz (npm install)"; exit 1; }
[[ -d "$ROOT/server/node_modules" ]] || { echo "✖ falta server/node_modules (cd server && npm install)"; exit 1; }

down

# --- red compartida -----------------------------------------------------------
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

# --- mantenedor (Express, con escritura) --------------------------------------
docker run -d --name "$ADMIN_NAME" --network "$NETWORK" \
  -u "$UID_GID" \
  -v "$ROOT:/app" -w /app/server \
  -e PORT="$ADMIN_PORT" -e HOST=0.0.0.0 \
  -p "0.0.0.0:${ADMIN_PORT}:${ADMIN_PORT}" \
  "$IMAGE" node src/index.mjs >/dev/null

# --- app Next -----------------------------------------------------------------
# El navegador habla solo con Next; sus rutas /api y /images las sirve la propia
# app, así que funciona desde cualquier IP sin tocar CORS. `/api/admin/*` se
# reenvía al mantenedor por el nombre del contenedor en la red interna.
docker run -d --name "$WEB_NAME" --network "$NETWORK" \
  -u "$UID_GID" \
  -v "$ROOT:/app" -w /app \
  -e PORT="$WEB_PORT" \
  -e VTUBERDEX_ADMIN_URL="http://${ADMIN_NAME}:${ADMIN_PORT}" \
  -p "0.0.0.0:${WEB_PORT}:${WEB_PORT}" \
  "$IMAGE" npx next dev --hostname 0.0.0.0 --port "$WEB_PORT" >/dev/null

# --- verificación (contra la IP del host, que es quien publica) ---------------
echo "▶ esperando a que respondan…"
IP="$(host_ip)"
ok_web=0; ok_admin=0
for _ in $(seq 1 60); do
  if [[ "$ok_web" == 0 ]] && curl -sf -m 3 "http://${IP}:${WEB_PORT}/api/health" >/dev/null 2>&1; then ok_web=1; fi
  if [[ "$ok_admin" == 0 ]] && curl -sf -m 3 "http://${IP}:${ADMIN_PORT}/api/health" >/dev/null 2>&1; then ok_admin=1; fi
  [[ "$ok_web" == 1 && "$ok_admin" == 1 ]] && break
  sleep 1
done

echo
if [[ "$ok_web" == 1 ]]; then
  echo "✔ servicios arriba"
  echo "    Front : http://${IP}:${WEB_PORT}/"
  echo "    Admin : http://${IP}:${WEB_PORT}/admin"
  echo "    API   : http://${IP}:${WEB_PORT}/api/health"
  echo
  echo "⚠ Si desde otra máquina no carga, casi siempre es el firewall del host."
  echo "  Con ufw activo (política DROP) solo el 22 está abierto:"
  echo "      sudo ufw allow ${WEB_PORT}/tcp"
  echo "  Alternativa sin sudo, por túnel SSH:"
  echo "      ssh -L ${WEB_PORT}:localhost:${WEB_PORT} \$USER@${IP}"
  echo "      luego abre http://localhost:${WEB_PORT}/ en esa máquina"
else
  echo "✖ la app no respondió (next=$ok_web admin=$ok_admin). Logs:"
  echo "    docker logs ${WEB_NAME}; docker logs ${ADMIN_NAME}"
  exit 1
fi
