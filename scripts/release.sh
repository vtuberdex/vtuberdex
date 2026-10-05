#!/usr/bin/env bash
# Build autocontenido (Next standalone) + release versionado + enlace simbólico dinámico.
#
#   ~/releases/vtuberdex/<fecha>/   <- cada build, nunca se toca después
#   /var/www/test.vtuberdex.com  -> ese release (ln -sfn: el cambio es atómico)
#
# Volver atrás = apuntar el enlace a un release anterior y reiniciar el servicio.
# Para el dev server antes (comparte .next/ con el build; ver AGENTS.md).
set -euo pipefail
cd "$(dirname "$0")/.."

DOMINIO="${DOMINIO:-test.vtuberdex.com}"
RELEASES="${RELEASES:-$HOME/releases/vtuberdex}"
SERVICIO="${SERVICIO:-vtuberdex-test}"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

VTUBERDEX_STANDALONE=1 npm run build

destino="$RELEASES/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$destino"
cp -a .next/standalone/. "$destino/"
mkdir -p "$destino/.next"
cp -a .next/static "$destino/.next/static"
# La base empaquetada la lee `fs` con una ruta construida: el trazado no la copia sola.
mkdir -p "$destino/deploy"
cp -a deploy/data "$destino/deploy/data"
[ -d public ] && cp -a public "$destino/public"

sudo ln -sfn "$destino" "/var/www/$DOMINIO"
echo "→ /var/www/$DOMINIO -> $destino"

if systemctl list-unit-files "$SERVICIO.service" >/dev/null 2>&1 && systemctl cat "$SERVICIO" >/dev/null 2>&1; then
  sudo systemctl restart "$SERVICIO"
  echo "→ $SERVICIO reiniciado"
fi
# Conserva los 5 últimos releases.
ls -1dt "$RELEASES"/*/ | tail -n +6 | xargs -r rm -rf
