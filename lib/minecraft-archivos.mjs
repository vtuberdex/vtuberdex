/**
 * Explorador de archivos del servidor de Minecraft para el mantenedor (`/minecraft-admin`).
 *
 * POR QUÉ EXISTE
 * --------------
 * El panel solo editaba `server.properties` y los `.yml` SUELTOS de `plugins/`. Casi todos los
 * plugins guardan su configuración en `plugins/<Plugin>/config.yml` (y MythicMobs en
 * `Mobs/`, `Skills/`, `Items/` a varios niveles), así que la lista salía vacía para ellos aunque el
 * archivo existiera. Tampoco había forma de tocar `bukkit.yml`, `spigot.yml` ni los de Paper.
 *
 * REGLAS (no se relajan sin pensar en qué se abre)
 * ------------------------------------------------
 * 1. LISTA CERRADA de qué se puede abrir: los archivos de la raíz y de `config/` que están en
 *    `ARCHIVOS_RAIZ`, y cualquier archivo de texto bajo `plugins/`. Nada más: ni `world/`, ni
 *    `logs/`, ni `.env`, ni jars (un jar es código, solo admin y por su ruta propia).
 * 2. Cada segmento de la ruta pasa por una regex estricta, sin `..`, sin segmentos ocultos y con
 *    profundidad máxima. Después se resuelve con `realpath` y se exige seguir dentro de la base:
 *    un enlace simbólico dentro de `plugins/` no puede sacar la lectura del directorio.
 * 3. Los archivos con secretos del propio proyecto (`plugins/VTuberDex*`, que lleva el token de la
 *    web) son SOLO de admin, tanto para leer como para escribir y para listar.
 * 4. Se valida antes de escribir (JSON parseable, YAML sin tabuladores de indentación) y se deja
 *    una copia `.bak` del contenido anterior: un yml roto deja un plugin sin arrancar y el error
 *    aparece en el reinicio, no al guardar.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { LIMITE_CONFIG_BYTES, ROL_ADMIN } from "./minecraft-admin.mjs";

const BASE_POR_DEFECTO = "deploy/minecraft";

/** Archivos fuera de `plugins/` que se pueden abrir, con su ruta exacta desde la base. */
export const ARCHIVOS_RAIZ = [
  "bukkit.yml",
  "spigot.yml",
  "commands.yml",
  "help.yml",
  "permissions.yml",
  "config/paper-global.yml",
  "config/paper-world-defaults.yml",
];

/** Extensiones de texto editables bajo `plugins/`. */
const EXTENSIONES = /\.(yml|yaml|json|txt|properties|conf|toml|csv|md)$/i;
const SEGMENTO = /^[\p{L}\p{N}_][\p{L}\p{N} ._+()-]*$/u;
const PROFUNDIDAD_MAXIMA = 8;
const ENTRADAS_MAXIMAS = 4000;
/** Carpetas bajo `plugins/` que no son configuración: voluminosas o con datos de runtime. */
const CARPETAS_OMITIDAS = new Set(["dynmap", "bluemap", "squaremap", "chunky"]);
const SOLO_ADMIN = /^plugins\/vtuberdex/i;

const base = (dir) =>
  path.resolve(dir || process.env.VTUBERDEX_MINECRAFT_DIR || BASE_POR_DEFECTO);

const rechazo = (status, error, detail) => ({
  ok: false,
  status,
  cuerpo: detail ? { error, detail } : { error },
});

const puedeVer = (relativa, rol) =>
  rol === ROL_ADMIN || !SOLO_ADMIN.test(relativa);

/** Valida una ruta relativa de la petición. Devuelve `{ ok, relativa }` o el rechazo. */
export function validarRutaRelativa(entrada, rol) {
  const relativa = String(entrada ?? "")
    .normalize("NFC")
    .trim();
  if (!relativa) return rechazo(400, "ruta_invalida", "falta la ruta");
  if (relativa.length > 400)
    return rechazo(400, "ruta_invalida", "demasiado larga");
  const trozos = relativa.split("/");
  if (trozos.length > PROFUNDIDAD_MAXIMA) {
    return rechazo(400, "ruta_invalida", "demasiado profunda");
  }
  if (!trozos.every((t) => SEGMENTO.test(t) && !t.includes(".."))) {
    return rechazo(400, "ruta_invalida", "segmento no permitido");
  }
  const enRaiz = ARCHIVOS_RAIZ.includes(relativa);
  const enPlugins =
    trozos[0] === "plugins" &&
    trozos.length >= 3 &&
    EXTENSIONES.test(trozos[trozos.length - 1]);
  // `plugins/archivo.yml` (suelto) también valía antes: dos segmentos.
  const sueltoEnPlugins =
    trozos[0] === "plugins" &&
    trozos.length === 2 &&
    EXTENSIONES.test(trozos[1]);
  if (!enRaiz && !enPlugins && !sueltoEnPlugins) {
    return rechazo(
      403,
      "ruta_no_permitida",
      "solo plugins/ y los archivos de Paper/Bukkit/Spigot",
    );
  }
  if (!puedeVer(relativa, rol)) {
    return rechazo(403, "solo_admin", "ese archivo lleva credenciales");
  }
  return { ok: true, relativa };
}

/** Ruta absoluta de una relativa ya validada, comprobando que `realpath` no se sale de la base. */
async function resolverReal(relativa, raiz, { debeExistir }) {
  const ruta = path.resolve(raiz, relativa);
  const dentro = (p) => {
    const r = path.relative(raiz, p);
    return r && !r.startsWith("..") && !path.isAbsolute(r);
  };
  if (!dentro(ruta)) return rechazo(400, "ruta_invalida", "se sale de la base");
  // Se resuelve el archivo si existe; si no (archivo nuevo), su carpeta: el enlace simbólico
  // puede estar en cualquiera de las dos.
  const objetivo = await fs
    .realpath(ruta)
    .catch(() =>
      debeExistir ? null : fs.realpath(path.dirname(ruta)).catch(() => null),
    );
  if (!objetivo) return rechazo(404, "no_existe", path.basename(ruta));
  const raizReal = await fs.realpath(raiz).catch(() => raiz);
  const r = path.relative(raizReal, objetivo);
  if (r.startsWith("..") || path.isAbsolute(r)) {
    return rechazo(400, "ruta_invalida", "enlace fuera de la base");
  }
  return { ok: true, ruta };
}

/**
 * Árbol de archivos editables: raíz permitida y todo lo de texto bajo `plugins/`.
 * Devuelve `{ archivos: [{ ruta, bytes, modificado }], truncado }`.
 */
export async function listarArchivos({ dir, rol } = {}) {
  const raiz = base(dir);
  const archivos = [];
  let truncado = false;

  for (const relativa of ARCHIVOS_RAIZ) {
    const st = await fs.stat(path.join(raiz, relativa)).catch(() => null);
    if (st?.isFile()) {
      archivos.push({
        ruta: relativa,
        bytes: st.size,
        modificado: st.mtime.toISOString(),
      });
    }
  }

  const recorrer = async (relativa, nivel) => {
    if (truncado || nivel > PROFUNDIDAD_MAXIMA - 1) return;
    const entradas = await fs
      .readdir(path.join(raiz, relativa), { withFileTypes: true })
      .catch(() => []);
    entradas.sort((a, b) => a.name.localeCompare(b.name));
    for (const entrada of entradas) {
      if (archivos.length >= ENTRADAS_MAXIMAS) {
        truncado = true;
        return;
      }
      const hija = `${relativa}/${entrada.name}`;
      if (!SEGMENTO.test(entrada.name) || !puedeVer(hija, rol)) continue;
      if (entrada.isDirectory()) {
        if (nivel === 1 && CARPETAS_OMITIDAS.has(entrada.name.toLowerCase()))
          continue;
        await recorrer(hija, nivel + 1);
      } else if (entrada.isFile() && EXTENSIONES.test(entrada.name)) {
        const st = await fs.stat(path.join(raiz, hija)).catch(() => null);
        if (st) {
          archivos.push({
            ruta: hija,
            bytes: st.size,
            modificado: st.mtime.toISOString(),
          });
        }
      }
    }
  };
  await recorrer("plugins", 1);
  return { archivos, truncado };
}

/** Lee un archivo permitido. */
export async function leerArchivo({ ruta, dir, rol } = {}) {
  const valida = validarRutaRelativa(ruta, rol);
  if (!valida.ok) return valida;
  const raiz = base(dir);
  const real = await resolverReal(valida.relativa, raiz, { debeExistir: true });
  if (!real.ok) return real;
  const st = await fs.stat(real.ruta).catch(() => null);
  if (!st?.isFile()) return rechazo(404, "no_existe", path.basename(real.ruta));
  if (st.size > LIMITE_CONFIG_BYTES) {
    return rechazo(413, "archivo_demasiado_grande", `${st.size} bytes`);
  }
  const contenido = await fs.readFile(real.ruta, "utf8").catch(() => null);
  if (contenido === null)
    return rechazo(404, "no_existe", path.basename(real.ruta));
  return { ok: true, ruta: valida.relativa, contenido };
}

/** Revisa que el contenido sea cargable según su extensión. */
export function validarContenido(relativa, texto) {
  const contenido = String(texto ?? "").replace(/\r\n/g, "\n");
  if (Buffer.byteLength(contenido, "utf8") > LIMITE_CONFIG_BYTES) {
    return rechazo(413, "configuracion_demasiado_grande");
  }
  if (contenido.includes("\u0000")) return rechazo(400, "contenido_invalido");
  if (/\.json$/i.test(relativa)) {
    try {
      JSON.parse(contenido);
    } catch (e) {
      return rechazo(400, "json_invalido", e instanceof Error ? e.message : "");
    }
  }
  if (/\.(yml|yaml)$/i.test(relativa)) {
    const lineas = contenido.split("\n");
    for (let i = 0; i < lineas.length; i += 1) {
      if (/^[ ]*\t/.test(lineas[i])) {
        return rechazo(
          400,
          "yaml_invalido",
          `línea ${i + 1}: tabulador de indentación`,
        );
      }
      if (lineas[i].length > 4096) {
        return rechazo(400, "linea_demasiado_larga", `línea ${i + 1}`);
      }
    }
  }
  return { ok: true, contenido };
}

/** Guarda un archivo permitido, con copia `.bak` del anterior. */
export async function guardarArchivo({ ruta, contenido, dir, rol } = {}) {
  const valida = validarRutaRelativa(ruta, rol);
  if (!valida.ok) return valida;
  const revision = validarContenido(valida.relativa, contenido);
  if (!revision.ok) return revision;
  const raiz = base(dir);
  const real = await resolverReal(valida.relativa, raiz, {
    debeExistir: false,
  });
  if (!real.ok) return real;
  const texto = revision.contenido.replace(/\n*$/, "\n");
  // Una copia de lo anterior; si el archivo no existía no hay nada que copiar.
  await fs.copyFile(real.ruta, `${real.ruta}.bak`).catch(() => {});
  await fs.mkdir(path.dirname(real.ruta), { recursive: true });
  await fs.writeFile(real.ruta, texto);
  return {
    ok: true,
    ruta: valida.relativa,
    bytes: Buffer.byteLength(texto, "utf8"),
  };
}
