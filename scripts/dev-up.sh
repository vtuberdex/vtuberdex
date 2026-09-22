#!/usr/bin/env bash
# Levanta la app Next y el servidor del mantenedor en local.
#
# La app Next sirve el catálogo, la API de lectura y las imágenes. El mantenedor
# (subidas, borrado, edición) NO está en Next: necesita escribir en disco y por eso
# vive en `server/src/index.mjs` (Express), que Next reenvía vía
# `VTUBERDEX_ADMIN_URL` desde `app/api/admin/[...path]`.
#
# Uso: ./scripts/dev-up.sh [--admin-only|--web-only] [--port 4000]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_PORT="${ADMIN_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
MODE="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-only) MODE="admin" ;;
    --web-only) MODE="web" ;;
    --port) ADMIN_PORT="$2"; shift ;;
    *) echo "opción desconocida: $1" >&2; exit 1 ;;
  esac
  shift
done

if [[ ! -f "$ROOT/data/vtuberdex.db" ]]; then
  echo "✖ falta la base de datos. Corre primero: cd server && npm run seed"
  exit 1
fi

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

if [[ "$MODE" != "web" ]]; then
  if [[ ! -d "$ROOT/server/node_modules" ]]; then
    echo "✖ falta server/node_modules. Corre: cd server && npm install"
    exit 1
  fi
  echo "▶ mantenedor (Express) en http://0.0.0.0:${ADMIN_PORT}"
  (cd "$ROOT/server" && PORT="$ADMIN_PORT" HOST=0.0.0.0 npm start) &
  pids+=($!)
fi

if [[ "$MODE" != "admin" ]]; then
  if [[ ! -d "$ROOT/node_modules" ]]; then
    echo "✖ falta node_modules en la raíz. Corre: npm install"
    exit 1
  fi
  echo "▶ app Next en http://0.0.0.0:${WEB_PORT}"
  # Next reenvía /api/admin/* al Express; sin esta variable esas rutas dan 404
  # (el comportamiento de producción), así que el mantenedor no funcionaría.
  #
  # `--hostname 0.0.0.0` es DELIBERADO: sin él, Next escucha en todas las
  # interfaces igualmente, pero dejarlo explícito evita que un cambio de versión
  # lo restrinja a localhost y rompa el acceso desde otra máquina de la LAN, que
  # es justo para lo que se usa este script.
  (cd "$ROOT" && PORT="$WEB_PORT" VTUBERDEX_ADMIN_URL="http://127.0.0.1:${ADMIN_PORT}" \
    npm run dev -- --hostname 0.0.0.0 --port "$WEB_PORT") &
  pids+=($!)
fi

wait
