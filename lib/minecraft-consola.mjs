/**
 * Consola del servidor de Minecraft para el mantenedor, y registro de auditoría del panel.
 *
 * POR QUÉ HAY CONSOLA AHORA
 * -------------------------
 * Con MythicMobs y compañía hay que recargar y probar comandos todo el rato; las acciones de un
 * clic (`ACCIONES` en `lib/minecraft-rcon.mjs`) no alcanzan. La regla anterior («no hay consola
 * libre») protegía de `op`, `execute`, etc. Se mantiene para quien no es admin y se abre para quien sí:
 *
 * - `admin`: cualquier comando de una línea. Es lo mismo que tener `mc-rcon` en la VPS.
 * - `mantenedor`: solo comandos cuyo PRIMER token esté en `PREFIJOS_MANTENEDOR`. Es una lista
 *   blanca: lo que no se nombra no pasa. No incluye `op`, `deop`, `execute`, `stop`, `lp`
 *   (daría permisos a quien quiera), `rcon`, `ban`, ni `function`.
 *
 * TRAMPAS QUE ESTO CIERRA
 * -----------------------
 * - `minecraft:op` / `bukkit:op`: el prefijo de espacio de nombres se salta una lista basada en el
 *   nombre. Un token con `:` se rechaza para el mantenedor.
 * - Una barra inicial (`/mm reload`) se quita; saltos de línea y caracteres de control se
 *   rechazan: RCON recibe UNA línea.
 * - Todo comando queda en el registro con quién, rol, cuándo y el resultado, también el de un admin.
 *   El registro jamás guarda la respuesta del servidor (puede traer IP de jugadores).
 *
 * Honestidad sobre el alcance: editar archivos de MythicMobs (skills con `command` de consola) ya
 * permite ejecutar comandos de consola recargando. La lista blanca frena el uso directo, no cierra
 * esa vía: quien pueda editar esos archivos tiene, de hecho, confianza de operador.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { ROL_ADMIN } from "./minecraft-admin.mjs";
import { enviarRcon } from "./minecraft-rcon.mjs";

export const LARGO_MAXIMO_COMANDO = 256;

/** Primer token permitido al mantenedor. Se amplía con `VTUBERDEX_MINECRAFT_CONSOLA_PREFIJOS`. */
export const PREFIJOS_MANTENEDOR = [
  "mm",
  "mythicmobs",
  "reload",
  "list",
  "tps",
  "mspt",
  "plugins",
  "version",
  "whitelist",
  "say",
  "tell",
  "msg",
  "time",
  "weather",
  "save-all",
  "kick",
];

const CORTAR = /\s+/;

function prefijosPermitidos(env) {
  const extra = String(env.VTUBERDEX_MINECRAFT_CONSOLA_PREFIJOS ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    // Aunque el entorno lo pida, estos nunca se abren al mantenedor.
    .filter((p) => /^[a-z0-9_-]+$/.test(p) && !PROHIBIDOS_SIEMPRE.has(p));
  return new Set([...PREFIJOS_MANTENEDOR, ...extra]);
}

const PROHIBIDOS_SIEMPRE = new Set([
  "op",
  "deop",
  "execute",
  "stop",
  "rcon",
  "function",
  "lp",
  "luckperms",
  "ban",
  "ban-ip",
  "pardon",
  "restart",
]);

/**
 * Valida un comando. Devuelve `{ ok, comando }` (sin barra inicial, recortado) o el rechazo.
 * `rol` decide si aplica la lista blanca.
 */
export function prepararComando(entrada, rol, env = process.env) {
  const texto = String(entrada ?? "")
    .trim()
    .replace(/^\/+/, "");
  if (!texto) {
    return { ok: false, status: 400, cuerpo: { error: "comando_vacio" } };
  }
  if (texto.length > LARGO_MAXIMO_COMANDO) {
    return {
      ok: false,
      status: 400,
      cuerpo: {
        error: "comando_demasiado_largo",
        detail: `máximo ${LARGO_MAXIMO_COMANDO}`,
      },
    };
  }
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0);
    if (codigo <= 0x1f || codigo === 0x7f) {
      return {
        ok: false,
        status: 400,
        cuerpo: {
          error: "comando_invalido",
          detail: "una sola línea, sin caracteres de control",
        },
      };
    }
  }
  if (rol === ROL_ADMIN) return { ok: true, comando: texto };

  const primero = texto.split(CORTAR)[0].toLowerCase();
  if (!prefijosPermitidos(env).has(primero)) {
    return {
      ok: false,
      status: 403,
      cuerpo: {
        error: "comando_no_permitido",
        detail: "ese comando es solo de admin",
      },
    };
  }
  return { ok: true, comando: texto };
}

/**
 * Archivo del registro. La ruta es FIJA: no sale de la petición ni del entorno, porque escribir en
 * disco a partir de un dato de fuera es exactamente lo que no se quiere (Sonar y CodeQL lo marcan
 * como vulnerabilidad). En producción la web corre desde `/var/lib/vtuberdex`, así que el registro
 * queda en `data/` de ese directorio.
 */
const ARCHIVO_AUDITORIA = path.join(
  process.cwd(),
  "data",
  "minecraft-auditoria.log",
);

/** Ruta vigente del registro. Solo las pruebas la cambian, hacia un archivo temporal. */
let archivoAuditoria = ARCHIVO_AUDITORIA;

/** Apunta el registro a otro archivo (pruebas). Sin argumento vuelve a la ruta de siempre. */
export function usarArchivoDeAuditoria(ruta) {
  archivoAuditoria = ruta ? path.resolve(ruta) : ARCHIVO_AUDITORIA;
}

/** Quita saltos de línea y límites: el registro es una línea JSON por evento y no se deja forjar otra. */
const limpiar = (v) =>
  String(v ?? "")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll(String.fromCharCode(0), " ")
    .slice(0, 400);

/**
 * Anota un evento del panel. NUNCA lanza ni bloquea la operación: si el disco falla, el comando ya
 * se ejecutó y fallar ahora sería peor que perder una línea (el fallo sí va a la consola del servicio).
 */
export async function anotarAuditoria(evento, env = process.env) {
  try {
    const ruta = rutaAuditoria(env);
    await fs.mkdir(path.dirname(ruta), { recursive: true });
    const linea = JSON.stringify({
      cuando: new Date().toISOString(),
      quien: limpiar(evento.quien),
      rol: limpiar(evento.rol),
      tipo: limpiar(evento.tipo),
      detalle: limpiar(evento.detalle),
      ok: Boolean(evento.ok),
    });
    await fs.appendFile(ruta, `${linea}\n`, { mode: 0o600 });
  } catch (e) {
    console.error(
      "[minecraft-admin] no se pudo escribir la auditoría:",
      e instanceof Error ? e.message : e,
    );
  }
}

/** Últimos `cuantos` eventos, el más reciente primero. */
export async function leerAuditoria({ cuantos = 50, env = process.env } = {}) {
  const texto = await fs.readFile(rutaAuditoria(env), "utf8").catch(() => "");
  const salida = [];
  const lineas = texto.split("\n").filter(Boolean);
  for (let i = lineas.length - 1; i >= 0 && salida.length < cuantos; i -= 1) {
    try {
      salida.push(JSON.parse(lineas[i]));
    } catch {
      // Línea rota: se salta, no se inventa.
    }
  }
  return salida;
}

/** Valida, ejecuta por RCON y anota. */
export async function ejecutarComando({
  comando,
  sesion,
  env = process.env,
  opciones,
} = {}) {
  const preparado = prepararComando(comando, sesion?.role, env);
  if (!preparado.ok) {
    await anotarAuditoria(
      {
        quien: sesion?.email,
        rol: sesion?.role,
        tipo: "consola-rechazada",
        detalle: String(comando ?? ""),
        ok: false,
      },
      env,
    );
    return preparado;
  }
  const resultado = await enviarRcon(preparado.comando, { env, ...opciones });
  await anotarAuditoria(
    {
      quien: sesion?.email,
      rol: sesion?.role,
      tipo: "consola",
      detalle: preparado.comando,
      ok: resultado.ok,
    },
    env,
  );
  return resultado.ok
    ? { ok: true, comando: preparado.comando, respuesta: resultado.respuesta }
    : resultado;
}
