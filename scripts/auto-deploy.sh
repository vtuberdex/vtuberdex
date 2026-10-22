#!/usr/bin/env bash
# Publica solo lo que llega a `master` de los CUATRO repos de la organización.
#
#   web      : clon propio -> npm ci -> scripts/release.sh -> comprueba que responde -> si no, vuelve al release anterior
#   java     : plugin principal (vtuberdex-minecraft)  -> gradlew build ┐
#   mochilas : plugin de mochilas (vtuberdex-mochilas) -> gradlew build ├ los jars quedan EN ESPERA hasta que el servidor
#   entregas : plugin de entregas (vtuberdex-entregas) -> gradlew build ┘ esté VACÍO -> se instalan TODOS juntos y un solo reinicio
#
# POR QUÉ entregas se recompila cuando cambia java o mochilas: compila contra los jars de los otros dos (`compileOnly`),
# así que un cambio de API en ellos lo rompe aunque su propio código no se haya tocado. Su build.gradle.kts los busca en
# `../vtuberdex-mochilas/` y `../vtuberdex/minecraft/`: por eso los clones de los plugins viven en `$ESTADO/arbol/` con esos
# nombres (la carpeta `vtuberdex/minecraft` es un enlace al clon `java`; Gradle resuelve `..` desde la ruta REAL del cwd,
# así que entregas y mochilas tienen que ser carpetas de verdad y no enlaces).
#
# POR QUÉ clones propios y no el checkout de desarrollo: ahí vive vps-base-local con cambios a medias y
# `next dev` comparte .next/ con el build (ver AGENTS.md). Aquí nunca se toca el árbol de trabajo de nadie.
# POR QUÉ el jar espera: reiniciar Minecraft echa a quien está jugando; sin RCON se pregunta por el ping de
# estado (lo que ve la lista de servidores) y, si hay gente, se reintenta en la siguiente vuelta.
# POR QUÉ la primera vuelta solo anota: no hay forma de saber qué commit corre hoy, y publicar a ciegas
# `master` (que puede ir por detrás de la rama que sirve la VPS) sería un retroceso. Desde ahí, solo lo NUEVO.
# POR QUÉ un commit fallido no se reintenta: cada intento es un build entero; se espera al commit siguiente.
#
# Se instala en /usr/local/sbin/vtuberdex-autodeploy (ver scripts/systemd/LEEME.md): no corre desde un
# checkout que él mismo actualiza. VTD_AUTO_DRY=1 solo informa.
set -uo pipefail

ESTADO="${VTD_ESTADO:-$HOME/.local/share/vtuberdex-auto}"
REPO_WEB="${REPO_WEB:-git@github.com:vtuberdex/vtuberdex.git}"
REPO_JAVA="${REPO_JAVA:-git@github.com:vtuberdex/vtuberdex-minecraft.git}"
RAMA="${RAMA:-master}"
BUILD="$HOME/.local/share/vtuberdex-build"
REPO_MOCHILAS="${REPO_MOCHILAS:-git@github.com:vtuberdex/vtuberdex-mochilas.git}"
REPO_ENTREGAS="${REPO_ENTREGAS:-git@github.com:vtuberdex/vtuberdex-entregas.git}"
PLUGINS_DIR="/srv/minecraft/plugins"
SERVICIO_MC="vtuberdex-minecraft"
PUERTO_MC="${PUERTO_MC:-25565}"
SALUD_WEB="${SALUD_WEB:-http://127.0.0.1:3100/api/vtubers?perPage=1}"
DRY="${VTD_AUTO_DRY:-0}"

mkdir -p "$ESTADO"
exec 9>"$ESTADO/.cerrojo"
flock -n 9 || { echo "otra vuelta sigue en marcha"; exit 0; }
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

log() { echo "[$(date '+%F %T')] $*"; }
leer() { [ -f "$ESTADO/$1" ] && cat "$ESTADO/$1" || true; }
anotar() { printf '%s' "$2" > "$ESTADO/$1"; }

# Dónde vive el clon de cada repo (ver la cabecera: los plugins van en `arbol/` con el nombre que espera Gradle).
dir_de() {
  case "$1" in
    mochilas) echo "$ESTADO/arbol/vtuberdex-mochilas" ;;
    entregas) echo "$ESTADO/arbol/vtuberdex-entregas" ;;
    *) echo "$ESTADO/$1" ;;
  esac
}
# Nombre del jar instalado en el servidor y archivo de espera. java conserva los nombres de siempre (hay estado en disco).
jar_instalado() {
  case "$1" in
    java) echo "$PLUGINS_DIR/VTuberDex.jar" ;;
    *) echo "$PLUGINS_DIR/vtuberdex-$1-0.1.0.jar" ;;
  esac
}
jar_espera() { if [ "$1" = java ]; then echo "$ESTADO/pendiente.jar"; else echo "$ESTADO/pendiente-$1.jar"; fi; }

# Clona la primera vez, trae la rama y deja el clon en el commit remoto. Imprime el SHA.
sincronizar() { # $1 nombre, $2 url
  local d; d="$(dir_de "$1")"
  [ -d "$d/.git" ] || { mkdir -p "$(dirname "$d")" && git clone --quiet "$2" "$d"; } || return 1
  git -C "$d" fetch --quiet origin "$RAMA" || return 1
  git -C "$d" rev-parse "origin/$RAMA"
}
llevar_a() { local d; d="$(dir_de "$1")"; git -C "$d" checkout --quiet -f --detach "$2" && git -C "$d" clean -fdq; }

# Jugadores conectados por el ping de estado de Minecraft. 0 en stdout = vacío; "?" = no se pudo saber.
jugadores() {
  node -e '
const net = require("node:net");
const varint = (n) => { const b = []; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x); } while (n); return Buffer.from(b); };
const paquete = (id, cuerpo) => { const c = Buffer.concat([varint(id), cuerpo]); return Buffer.concat([varint(c.length), c]); };
const host = Buffer.from("127.0.0.1");
const port = Buffer.alloc(2); port.writeUInt16BE(Number(process.argv[1]));
const apret = paquete(0, Buffer.concat([varint(776), varint(host.length), host, port, varint(1)]));
const leerVarint = (b, o) => { let r = 0, s = 0, i = o; for (;;) { if (i >= b.length) return null; const x = b[i++]; r |= (x & 0x7f) << s; if (!(x & 0x80)) return [r, i]; s += 7; } };
let buf = Buffer.alloc(0);
const fin = (v) => { console.log(v); process.exit(0); };
const s = net.connect({ host: "127.0.0.1", port: Number(process.argv[1]) }, () => s.write(Buffer.concat([apret, paquete(0, Buffer.alloc(0))])));
s.setTimeout(5000, () => fin("?"));
s.on("error", () => fin("?"));
s.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  const l = leerVarint(buf, 0); if (!l) return;
  if (buf.length < l[1] + l[0]) return;
  const id = leerVarint(buf, l[1]); const n = leerVarint(buf, id[1]);
  try { fin(JSON.parse(buf.subarray(n[1], n[1] + n[0]).toString("utf8")).players.online); } catch { fin("?"); }
});
' "$PUERTO_MC" 2>/dev/null || echo "?"
}

# ---------- web ----------
desplegar_web() {
  local sha="$1" d="$ESTADO/web"
  log "web: publicando ${sha:0:7}"
  llevar_a web "$sha" || return 1
  ( cd "$d" && npm ci --no-audit --no-fund && (cd server && npm ci --no-audit --no-fund) && npm test ) || { log "web: tests/instalación fallaron"; return 1; }
  local previo; previo="$(readlink /var/www/vtuberdex.com || true)"
  ( cd "$d" && nice ./scripts/release.sh ) || { log "web: release.sh falló"; return 1; }
  local i
  for i in 1 2 3 4 5 6; do
    sleep 5
    curl -fsS -o /dev/null --max-time 10 "$SALUD_WEB" && { log "web: ${sha:0:7} publicado y respondiendo"; return 0; }
  done
  log "web: no responde tras publicar; vuelvo a $previo"
  if [ -n "$previo" ]; then sudo ln -sfn "$previo" /var/www/vtuberdex.com && sudo systemctl restart vtuberdex; fi
  return 1
}

# ---------- plugins (java, mochilas, entregas) ----------
construir_plugin() { # $1 nombre, $2 sha
  local n="$1" sha="$2" d; d="$(dir_de "$1")"
  log "$n: compilando ${sha:0:7}"
  llevar_a "$n" "$sha" || return 1
  if [ "$n" = entregas ]; then
    # Sus dependencias se leen de ../vtuberdex/minecraft/build/libs (ver la cabecera).
    mkdir -p "$ESTADO/arbol/vtuberdex" && ln -sfn "$ESTADO/java" "$ESTADO/arbol/vtuberdex/minecraft" || return 1
  fi
  ( cd "$d" && GRADLE_USER_HOME="$BUILD/gradle-home" JAVA_HOME="$BUILD/jdk25" nice ./gradlew build --no-daemon -q ) || return 1
  local jar; jar="$(ls -t "$d"/build/libs/*.jar 2>/dev/null | grep -v -- '-plain' | head -1)"
  [ -n "$jar" ] || return 1
  cp "$jar" "$(jar_espera "$n")" && anotar "$n.pendiente" "$sha"
}

# Instala TODOS los jars en espera con un solo reinicio, cuando el servidor está vacío. Si no levanta, restaura todos.
instalar_plugins() {
  local n lista=()
  for n in java mochilas entregas; do
    [ -n "$(leer "$n.pendiente")" ] && [ -f "$(jar_espera "$n")" ] && lista+=("$n")
  done
  [ "${#lista[@]}" -gt 0 ] || return 0
  local jugando; jugando="$(jugadores)"
  if [ "$jugando" != "0" ]; then
    systemctl is-active --quiet "$SERVICIO_MC" && { log "plugins: ${lista[*]} en espera ($jugando jugando, o sin saberlo)"; return 0; }
  fi
  log "plugins: instalando ${lista[*]}"
  local marca; marca="$(date +%Y%m%d-%H%M%S)"
  for n in "${lista[@]}"; do
    sudo cp -a "$(jar_instalado "$n")" "$(jar_instalado "$n").bak-auto-$marca" 2>/dev/null
    sudo install -o minecraft -g minecraft -m 640 "$(jar_espera "$n")" "$(jar_instalado "$n")" || return 1
  done
  sudo systemctl restart "$SERVICIO_MC"
  # POR QUÉ se sondea y no se mira una vez a los 45 s: este servidor (Paper + BlueMap + Chunky + Geyser, mundo grande)
  # tarda más en aceptar conexiones. Con un único chequeo fijo, el 17-oct-2026 DOS despliegues seguidos se dieron
  # por fallidos a los 54 s y se revirtieron (uno con código idéntico al ya instalado) aunque el plugin estaba bien.
  local esperado=0 vivo=0
  while [ "$esperado" -lt "${ESPERA_ARRANQUE_S:-300}" ]; do
    sleep 5; esperado=$((esperado + 5))
    if systemctl is-active --quiet "$SERVICIO_MC" && [ "$(jugadores)" != "?" ]; then vivo=1; break; fi
  done
  if [ "$vivo" = 1 ]; then
    for n in "${lista[@]}"; do
      anotar "$n.desplegado" "$(leer "$n.pendiente")"; rm -f "$ESTADO/$n.pendiente" "$(jar_espera "$n")"
    done
    log "plugins: ${lista[*]} instalados y el servidor responde"
  else
    log "plugins: el servidor no levantó con ${lista[*]}; restauro los jars anteriores"
    for n in "${lista[@]}"; do
      [ -f "$(jar_instalado "$n").bak-auto-$marca" ] && sudo cp -a "$(jar_instalado "$n").bak-auto-$marca" "$(jar_instalado "$n")"
      anotar "$n.fallido" "$(leer "$n.pendiente")"; rm -f "$ESTADO/$n.pendiente" "$(jar_espera "$n")"
    done
    sudo systemctl restart "$SERVICIO_MC"
    return 1
  fi
}

# ---------- vuelta ----------
vuelta_web() {
  local sha; sha="$(sincronizar web "$REPO_WEB")" || { log "web: no pude consultar GitHub"; return; }
  local hecho; hecho="$(leer web.desplegado)"
  if [ -z "$hecho" ]; then anotar web.desplegado "$sha"; log "web: punto de partida ${sha:0:7} (no se publica)"; return; fi
  [ "$sha" = "$hecho" ] || [ "$sha" = "$(leer web.fallido)" ] && return
  if [ "$DRY" = 1 ]; then log "web: [dry] publicaría ${sha:0:7} (hoy ${hecho:0:7})"; return; fi
  if desplegar_web "$sha"; then anotar web.desplegado "$sha"; else anotar web.fallido "$sha"; fi
}

# Devuelve por stdout "1" si compiló algo nuevo en esta vuelta. $3 = 1 fuerza recompilar (cambió una dependencia).
vuelta_plugin() { # $1 nombre, $2 url, $3 forzar
  local n="$1" forzar="${3:-0}"
  local sha; sha="$(sincronizar "$n" "$2")" || { log "$n: no pude consultar GitHub" >&2; return; }
  local hecho; hecho="$(leer "$n.desplegado")"
  if [ -z "$hecho" ]; then anotar "$n.desplegado" "$sha"; log "$n: punto de partida ${sha:0:7} (no se instala)" >&2; return; fi
  local nuevo=0
  [ "$sha" != "$hecho" ] && [ "$sha" != "$(leer "$n.fallido")" ] && [ "$sha" != "$(leer "$n.pendiente")" ] && nuevo=1
  # Una dependencia nueva obliga a recompilar aunque el código propio no cambie (solo si ya hay algo instalado que probar).
  if [ "$nuevo" = 1 ] || { [ "$forzar" = 1 ] && [ "$sha" != "$(leer "$n.fallido")" ]; }; then
    if [ "$DRY" = 1 ]; then log "$n: [dry] compilaría ${sha:0:7} (hoy ${hecho:0:7})" >&2; return; fi
    if construir_plugin "$n" "$sha" >&2; then echo 1; else log "$n: la compilación falló" >&2; anotar "$n.fallido" "$sha"; fi
  fi
}

vuelta_web
# Orden obligado: entregas compila contra los jars de java y mochilas.
cambio_java="$(vuelta_plugin java "$REPO_JAVA")"
cambio_mochilas="$(vuelta_plugin mochilas "$REPO_MOCHILAS")"
dep=0; [ -n "$cambio_java$cambio_mochilas" ] && dep=1
vuelta_plugin entregas "$REPO_ENTREGAS" "$dep" >/dev/null
[ "$DRY" = 1 ] || instalar_plugins
exit 0
