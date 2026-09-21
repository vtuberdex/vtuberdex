#!/usr/bin/env bash
# Levanta la API y el servidor de desarrollo del front.
# Uso: ./scripts/dev-up.sh [--api-only|--web-only] [--port 4000]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-4000}"
MODE="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-only) MODE="api" ;;
    --web-only) MODE="web" ;;
    --port) API_PORT="$2"; shift ;;
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
  echo "▶ API en http://localhost:${API_PORT}"
  (cd "$ROOT/server" && PORT="$API_PORT" npm start) &
  pids+=($!)
fi

if [[ "$MODE" != "api" ]]; then
  if [[ ! -d "$ROOT/web/node_modules" ]]; then
    echo "✖ falta web/node_modules. Corre: cd web && npm install"
    exit 1
  fi
  echo "▶ Web en http://localhost:5173"
  (cd "$ROOT/web" && VTUBERDEX_API="http://localhost:${API_PORT}" npm run dev) &
  pids+=($!)
fi

wait
