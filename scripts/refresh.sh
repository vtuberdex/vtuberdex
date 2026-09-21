#!/usr/bin/env bash
# Re-extrae el catálogo, reimporta la base y opcionalmente recompila el front.
# Uso: ./scripts/refresh.sh [--no-images] [--no-build]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRAPE_ARGS=()
BUILD=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-images) SCRAPE_ARGS+=(--no-images) ;;
    --no-build) BUILD=0 ;;
    *) echo "opción desconocida: $1" >&2; exit 1 ;;
  esac
  shift
done

echo "▶ 1/6 scrape (puede reutilizar la caché de HTML)"
(cd "$ROOT/scraper" && node src/scrape.mjs "${SCRAPE_ARGS[@]}")

# Los emblemas de facción viven en facciones/<Nombre>.png del sitio, con nombres de
# archivo irregulares (erratas incluidas): se recogen del HTML cacheado.
echo "▶ 2/6 emblemas de facción"
(cd "$ROOT/scraper" && node src/get-faction-logos.mjs)

# Los logos solo vienen en las 211 páginas de detalle; para el resto hay que
# recortarlos de la imagen de la carta. Sin este paso, 574 VTubers quedan sin logo.
echo "▶ 3/6 logos de las cartas sin ficha de detalle"
(cd "$ROOT/scraper" && node src/extract-logo2.mjs)

# Igual con la imagen del PERSONAJE: la ficha de detalle la trae aparte en 211
# casos; en los demás hay que rescatarla del panel izquierdo de la carta.
echo "▶ 4/6 personajes de las cartas"
(cd "$ROOT/scraper" && node src/extract-character.mjs)

echo "▶ 5/6 seed SQLite"
(cd "$ROOT/server" && node src/seed.mjs)

if [[ "$BUILD" == "1" ]]; then
  echo "▶ 6/6 build del front"
  (cd "$ROOT/web" && npm run build)
else
  echo "▶ 6/6 build omitido"
fi

echo "✔ listo"
