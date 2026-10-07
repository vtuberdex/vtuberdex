#!/usr/bin/env bash
# Build autocontenido (Next standalone) + release versionado + enlaces simbólicos dinámicos.
#
#   /srv/vtuberdex/releases/<fecha>/          <- cada build, nunca se toca después
#       index.html, .well-known/              <- lo ÚNICO que nginx puede leer de forma estática
#       app/                                  <- la app (server.js, base, código): modo 700, solo madkoding
#   /var/www/<dominio> -> ese release         <- para cada dominio de DOMINIOS (ln -sfn: atómico)
#
# POR QUÉ `app/` va aparte y cerrada: el script ssl-dominios de la VPS genera, al emitir un
# certificado, un bloque HTTPS que sirve /var/www/<dominio> COMO ARCHIVOS ESTÁTICOS. Si la raíz del
# release fuese la app, esa ruta dejaría descargable `deploy/data/vtuberdex.db` y el código compilado
# (regla 6 del deploy). Con `app/` en 700, nginx (www-data) no puede leerla aunque ese bloque ganara.
# POR QUÉ /srv y no /home: www-data no atraviesa /home/madkoding, y Let's Encrypt recibía 404 al pedir
# el desafío (certbot escribe en /var/www/<dominio>/.well-known, que es el release).
#
# Volver atrás = apuntar los enlaces a un release anterior y reiniciar el servicio.
# Para el dev server antes (comparte .next/ con el build; ver AGENTS.md).
set -euo pipefail
cd "$(dirname "$0")/.."

DOMINIOS="${DOMINIOS:-vtuberdex.com}"   # www.vtuberdex.com comparte carpeta (nginx quita el www)
RELEASES="${RELEASES:-/srv/vtuberdex/releases}"
SERVICIO="${SERVICIO:-vtuberdex}"
# La home es ESTÁTICA: su canonical, OG y JSON-LD se congelan al compilar. Sin SITE_URL salían con
# http://localhost:3000. Debe estar definida AQUÍ (el build), no solo en el servicio.
export SITE_URL="${SITE_URL:-https://vtuberdex.com}"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

VTUBERDEX_STANDALONE=1 npm run build

destino="$RELEASES/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$destino/app" "$destino/.well-known/acme-challenge"
cp -a .next/standalone/. "$destino/app/"
mkdir -p "$destino/app/.next"
cp -a .next/static "$destino/app/.next/static"
# La base empaquetada la lee `fs` con una ruta construida: el trazado no la copia sola.
mkdir -p "$destino/app/deploy"
cp -a deploy/data "$destino/app/deploy/data"
[ -d public ] && cp -a public "$destino/app/public"

cat > "$destino/index.html" <<'H'
<!doctype html><meta charset="utf-8"><title>VTuberDex</title>
<p style="font:16px system-ui;padding:2rem">VTuberDex</p>
H
chmod 755 "$destino" "$destino/.well-known" "$destino/.well-known/acme-challenge"
chmod 644 "$destino/index.html"
chmod -R go-rwx "$destino/app"   # nginx no puede leer la app: solo el servicio (madkoding)

for dominio in $DOMINIOS; do
  sudo ln -sfn "$destino" "/var/www/$dominio"
  echo "→ /var/www/$dominio -> $destino"
done

if systemctl cat "$SERVICIO" >/dev/null 2>&1; then
  sudo systemctl restart "$SERVICIO"
  echo "→ $SERVICIO reiniciado"
fi
# Conserva los 5 últimos releases.
ls -1dt "$RELEASES"/*/ | tail -n +6 | xargs -r rm -rf
