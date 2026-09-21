#!/usr/bin/env bash
# Levanta VTuberDex en modo desarrollo publicado a la LAN, para revisarlo desde
# otra máquina.
#
# Por qué contenedores: Hermes corre dentro de un contenedor cuyos puertos no
# están publicados al host. Como /home/madkoding/proyectos es un bind-mount del
# host, el daemon de Docker resuelve esa ruta y sí puede publicar puertos de
# verdad (0.0.0.0 en el host).
#
# DOS BLOQUEOS FRECUENTES, ya contemplados aquí:
#   1. Vite 7 rechaza un `Host` que no sea IP (DNS rebinding) y responde
#      "Blocked request. This host ("fuchikoma") is not allowed". Se resuelve con
#      allowedHosts: vite.config.ts ya acepta fuchikoma/.local/localhost, y
#      `--host <nombre>` agrega cualquiera extra.
#   2. El firewall del host. Con ufw activo (política DROP) solo el 22 está
#      abierto; desde otro PC hay que abrir el puerto o usar túnel SSH. El script
#      lo recuerda al terminar.
#
# Uso:
#   ./scripts/dev-docker.sh                    # API (4000) + Vite (5173)
#   ./scripts/dev-docker.sh --host fuchikoma   # permite ese hostname en Vite
#   ./scripts/dev-docker.sh --down             # los detiene
#   ./scripts/dev-docker.sh --logs             # sigue los logs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="vtuberdex-dev"
API_NAME="vtuberdex-api"
WEB_NAME="vtuberdex-web"
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-5173}"
IMAGE="${VTUBERDEX_IMAGE:-node:24-bookworm-slim}"
UID_GID="$(id -u):$(id -g)"
ALLOWED_HOSTS="fuchikoma,.local,localhost"

host_ip() {
  # IP LAN del host: la obtenemos desde un contenedor en modo host, porque
  # dentro de nuestra red bridge solo veríamos 172.18.0.x.
  docker run --rm --network host --entrypoint sh "$IMAGE" -c \
    "hostname -I | tr ' ' '\n' | grep -E '^(192\\.168|10\\.|172\\.(1[6-9]|2[0-9]|3[01]))' | grep -v '^172\\.1[78]\\.' | head -1" 2>/dev/null || echo "localhost"
}

down() {
  for name in "$WEB_NAME" "$API_NAME"; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
      docker rm -f "$name" >/dev/null && echo "✖ detenido $name"
    fi
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --down) down; exit 0 ;;
    --logs) docker logs -f "$WEB_NAME" & docker logs -f "$API_NAME"; wait; exit 0 ;;
    --host) ALLOWED_HOSTS="${ALLOWED_HOSTS},$2"; shift ;;
    --web-port) WEB_PORT="$2"; shift ;;
    --api-port) API_PORT="$2"; shift ;;
    *) echo "opción desconocida: $1" >&2; exit 1 ;;
  esac
  shift
done

# --- requisitos ---------------------------------------------------------------
[[ -f "$ROOT/data/vtuberdex.db" ]] || { echo "✖ falta data/vtuberdex.db (cd server && npm run seed)"; exit 1; }
[[ -d "$ROOT/web/node_modules" ]] || { echo "✖ falta web/node_modules (cd web && npm install)"; exit 1; }
[[ -d "$ROOT/server/node_modules" ]] || { echo "✖ falta server/node_modules (cd server && npm install)"; exit 1; }

down

# --- red compartida -----------------------------------------------------------
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

# --- API ----------------------------------------------------------------------
# Se publica también, además de por la red interna, para poder pegarle directo
# con curl o abrir /api/... desde el navegador de la otra máquina.
docker run -d --name "$API_NAME" --network "$NETWORK" \
  -u "$UID_GID" \
  -v "$ROOT:/app" -w /app/server \
  -e PORT="$API_PORT" -e HOST=0.0.0.0 \
  -p "0.0.0.0:${API_PORT}:${API_PORT}" \
  "$IMAGE" node src/index.mjs >/dev/null

# --- Web (Vite dev) -----------------------------------------------------------
# El navegador solo habla con Vite; el proxy interno manda /api y /images al
# contenedor de la API por nombre de servicio, así funciona desde cualquier IP.
# allowedHosts va por env para no editar el config al cambiar de máquina.
docker run -d --name "$WEB_NAME" --network "$NETWORK" \
  -u "$UID_GID" \
  -v "$ROOT:/app" -w /app/web \
  -e VTUBERDEX_API="http://${API_NAME}:${API_PORT}" \
  -e VTUBERDEX_ALLOWED_HOSTS="$ALLOWED_HOSTS" \
  -p "0.0.0.0:${WEB_PORT}:${WEB_PORT}" \
  "$IMAGE" npx vite --host 0.0.0.0 --port "$WEB_PORT" --strictPort >/dev/null

# --- verificación (contra la IP del host, que es quien publica) ---------------
echo "▶ esperando a que respondan…"
IP="$(host_ip)"
ok_api=0; ok_web=0
for _ in $(seq 1 40); do
  if [[ "$ok_api" == 0 ]] && curl -sf -m 3 "http://${IP}:${API_PORT}/api/health" >/dev/null 2>&1; then ok_api=1; fi
  if [[ "$ok_web" == 0 ]] && curl -sf -m 3 "http://${IP}:${WEB_PORT}/" >/dev/null 2>&1; then ok_web=1; fi
  [[ "$ok_api" == 1 && "$ok_web" == 1 ]] && break
  sleep 1
done

# Prueba con un Host que no es IP: es el caso "abrir por nombre de máquina".
hosts_check="n/a"
if [[ "$ok_web" == 1 ]]; then
  for h in ${ALLOWED_HOSTS//,/ }; do
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' -H "Host: ${h}" "http://${IP}:${WEB_PORT}/" 2>/dev/null || echo 'err')"
    hosts_check+=" ${h}=${code}"
  done
fi

echo
if [[ "$ok_api" == 1 && "$ok_web" == 1 ]]; then
  echo "✔ servicios arriba"
  echo "    Front : http://${IP}:${WEB_PORT}/"
  echo "    Admin : http://${IP}:${WEB_PORT}/admin"
  echo "    API   : http://${IP}:${API_PORT}/api/health"
  echo "    Hosts en Vite ->${hosts_check}   (200 = aceptado)"
  echo
  echo "⚠ Si desde otra máquina no carga, casi siempre es el firewall del host."
  echo "  Con ufw activo (política DROP) solo el 22 está abierto:"
  echo "      sudo ufw allow ${WEB_PORT}/tcp"
  echo "  Alternativa sin sudo, por túnel SSH:"
  echo "      ssh -L ${WEB_PORT}:localhost:${WEB_PORT} \$USER@${IP}"
  echo "      luego abre http://localhost:${WEB_PORT}/ en esa máquina"
else
  echo "✖ algo no respondió (api=$ok_api web=$ok_web). Logs:"
  echo "    docker logs ${API_NAME}; docker logs ${WEB_NAME}"
  exit 1
fi
