#!/usr/bin/env bash
# Publica solo lo que llega a `master` de los dos repos (web y plugin de Minecraft).
#
#   web  : clon propio -> npm ci -> scripts/release.sh -> comprueba que responde -> si no, vuelve al release anterior
#   java : clon propio -> gradlew build -> el jar queda EN ESPERA hasta que el servidor esté VACÍO -> instala y reinicia
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
JAR_DESTINO="/srv/minecraft/plugins/VTuberDex.jar"
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

# Clona la primera vez, trae la rama y deja el clon en el commit remoto. Imprime el SHA.
sincronizar() { # $1 nombre, $2 url
  local d="$ESTADO/$1"
  [ -d "$d/.git" ] || git clone --quiet "$2" "$d" || return 1
  git -C "$d" fetch --quiet origin "$RAMA" || return 1
  git -C "$d" rev-parse "origin/$RAMA"
}
llevar_a() { git -C "$ESTADO/$1" checkout --quiet -f --detach "$2" && git -C "$ESTADO/$1" clean -fdq; }

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

# ---------- java ----------
construir_java() {
  local sha="$1" d="$ESTADO/java"
  log "java: compilando ${sha:0:7}"
  llevar_a java "$sha" || return 1
  ( cd "$d" && GRADLE_USER_HOME="$BUILD/gradle-home" JAVA_HOME="$BUILD/jdk25" nice ./gradlew build --no-daemon -q ) || return 1
  local jar; jar="$(ls -t "$d"/build/libs/vtuberdex-mc-*.jar 2>/dev/null | grep -v -- '-plain' | head -1)"
  [ -n "$jar" ] || return 1
  cp "$jar" "$ESTADO/pendiente.jar" && anotar java.pendiente "$sha"
}

instalar_java() {
  local sha; sha="$(leer java.pendiente)"
  [ -n "$sha" ] && [ -f "$ESTADO/pendiente.jar" ] || return 0
  local n; n="$(jugadores)"
  if [ "$n" != "0" ]; then
    systemctl is-active --quiet "$SERVICIO_MC" && { log "java: ${sha:0:7} en espera ($n jugando, o sin saberlo)"; return 0; }
  fi
  log "java: instalando ${sha:0:7}"
  local resp; resp="$JAR_DESTINO.bak-auto-$(date +%Y%m%d-%H%M%S)"
  sudo cp -a "$JAR_DESTINO" "$resp" 2>/dev/null
  sudo install -o minecraft -g minecraft -m 640 "$ESTADO/pendiente.jar" "$JAR_DESTINO" || return 1
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
    anotar java.desplegado "$sha"; rm -f "$ESTADO/java.pendiente" "$ESTADO/pendiente.jar"
    log "java: ${sha:0:7} instalado y el servidor responde"
  else
    log "java: el servidor no levantó con ${sha:0:7}; restauro el jar anterior"
    [ -f "$resp" ] && sudo cp -a "$resp" "$JAR_DESTINO" && sudo systemctl restart "$SERVICIO_MC"
    anotar java.fallido "$sha"; rm -f "$ESTADO/java.pendiente" "$ESTADO/pendiente.jar"
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

vuelta_java() {
  local sha; sha="$(sincronizar java "$REPO_JAVA")" || { log "java: no pude consultar GitHub"; return; }
  local hecho; hecho="$(leer java.desplegado)"
  if [ -z "$hecho" ]; then anotar java.desplegado "$sha"; log "java: punto de partida ${sha:0:7} (no se instala)"; return; fi
  if [ "$sha" != "$hecho" ] && [ "$sha" != "$(leer java.fallido)" ] && [ "$sha" != "$(leer java.pendiente)" ]; then
    if [ "$DRY" = 1 ]; then log "java: [dry] compilaría ${sha:0:7} (hoy ${hecho:0:7})"; return; fi
    construir_java "$sha" || { log "java: la compilación falló"; anotar java.fallido "$sha"; return; }
  fi
  [ "$DRY" = 1 ] || instalar_java
}

vuelta_web
vuelta_java
exit 0
