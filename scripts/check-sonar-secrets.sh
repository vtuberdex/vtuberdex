#!/usr/bin/env bash
# Guarda de secretos del job `sonar`.
#
# Un PR desde un fork NO recibe los secretos del repositorio base: alli el
# escaneo se omite con un aviso, porque no hay forma de inyectarlos. En
# cualquier otro caso (push, workflow_dispatch o PR del mismo repositorio,
# incluidos los que abre Dependabot) la falta de SONAR_TOKEN o SONAR_HOST_URL
# es un error de configuracion: el job falla en vez de publicar un check en
# verde con el escaneo y el quality gate saltados.
#
# Entradas (variables de entorno):
#   SONAR_TOKEN        secreto con el token de SonarQube.
#   SONAR_HOST_URL     secreto con la URL del servidor SonarQube.
#   GITHUB_EVENT_NAME  evento del run (pull_request, push, workflow_dispatch...).
#   GITHUB_REPOSITORY  repositorio donde corre el workflow (owner/repo).
#   GITHUB_HEAD_REPO   repositorio de origen del PR (owner/repo); vacio si no es PR.
#   GITHUB_OUTPUT      fichero de salida del runner; recibe `skip=true|false`.
#
# Salida: exit 0 si hay secretos o si es un PR desde un fork sin ellos;
# exit 1 si faltan en un run que si podia recibirlos.
set -euo pipefail

faltan=()
[ -n "${SONAR_TOKEN:-}" ] || faltan+=("SONAR_TOKEN")
[ -n "${SONAR_HOST_URL:-}" ] || faltan+=("SONAR_HOST_URL")

es_fork=false
if [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ] \
  && [ -n "${GITHUB_HEAD_REPO:-}" ] \
  && [ "${GITHUB_HEAD_REPO}" != "${GITHUB_REPOSITORY:-}" ]; then
  es_fork=true
fi

publicar_salto() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "skip=$1" >> "$GITHUB_OUTPUT"
  fi
}

if [ "${#faltan[@]}" -eq 0 ]; then
  echo "Secretos de Sonar presentes: se ejecuta el escaneo y el quality gate."
  publicar_salto false
  exit 0
fi

lista=""
for variable in "${faltan[@]}"; do
  lista="${lista:+$lista, }$variable"
done

if [ "$es_fork" = true ]; then
  echo "::warning::PR desde un fork sin ${lista}: se omite el escaneo de Sonar (los forks no reciben secretos del repositorio base)."
  publicar_salto true
  exit 0
fi

echo "::error::Faltan ${lista} en ${GITHUB_REPOSITORY:-este repositorio}: el escaneo de Sonar no puede ejecutarse. Configura los secretos SONAR_TOKEN y SONAR_HOST_URL del repositorio y, si el run lo abre Dependabot, anadelos tambien en los secretos de Dependabot."
exit 1
