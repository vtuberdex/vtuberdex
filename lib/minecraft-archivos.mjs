// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
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

import {
  LIMITE_CONFIG_BYTES,
  ROL_ADMIN,
  conUnSaltoFinal,
} from "./minecraft-admin.mjs";

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

/**
 * Lo que comparten las rutas de archivo y de carpeta: largo, profundidad y cada segmento. Devuelve
 * el rechazo, o `null` si la forma es válida.
 */
function rechazoDeForma(relativa) {
  if (relativa.length > 400) {
    return rechazo(400, "ruta_invalida", "demasiado larga");
  }
  const trozos = relativa.split("/");
  if (trozos.length > PROFUNDIDAD_MAXIMA) {
    return rechazo(400, "ruta_invalida", "demasiado profunda");
  }
  if (!trozos.every((t) => SEGMENTO.test(t) && !t.includes(".."))) {
    return rechazo(400, "ruta_invalida", "segmento no permitido");
  }
  return null;
}

/**
 * ¿Es uno de los archivos que se pueden abrir? Los de la raíz por su ruta exacta, y bajo `plugins/`
 * cualquier archivo de texto: dentro de la carpeta de un plugin (3+ segmentos) o suelto
 * (`plugins/archivo.yml`, dos segmentos, que también valía antes).
 */
function esArchivoPermitido(relativa) {
  if (ARCHIVOS_RAIZ.includes(relativa)) {
    return true;
  }
  const trozos = relativa.split("/");
  return (
    trozos[0] === "plugins" &&
    trozos.length >= 2 &&
    EXTENSIONES.test(trozos.at(-1))
  );
}

/** Valida una ruta relativa de la petición. Devuelve `{ ok, relativa }` o el rechazo. */
export function validarRutaRelativa(entrada, rol) {
  const relativa = String(entrada ?? "")
    .normalize("NFC")
    .trim();
  if (!relativa) {
    return rechazo(400, "ruta_invalida", "falta la ruta");
  }
  const malFormada = rechazoDeForma(relativa);
  if (malFormada) {
    return malFormada;
  }
  if (!esArchivoPermitido(relativa)) {
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
    const desdeRaiz = path.relative(raiz, p);
    return (
      desdeRaiz && !desdeRaiz.startsWith("..") && !path.isAbsolute(desdeRaiz)
    );
  };
  if (!dentro(ruta)) {
    return rechazo(400, "ruta_invalida", "se sale de la base");
  }
  // Se resuelve el archivo si existe; si no (archivo nuevo), su carpeta: el enlace simbólico
  // puede estar en cualquiera de las dos.
  const objetivo = await fs
    .realpath(ruta)
    .catch(() =>
      debeExistir ? null : fs.realpath(path.dirname(ruta)).catch(() => null),
    );
  if (!objetivo) {
    return rechazo(404, "no_existe", path.basename(ruta));
  }
  const raizReal = await fs.realpath(raiz).catch(() => raiz);
  const r = path.relative(raizReal, objetivo);
  if (r.startsWith("..") || path.isAbsolute(r)) {
    return rechazo(400, "ruta_invalida", "enlace fuera de la base");
  }
  return { ok: true, ruta };
}

const filaDeArchivo = (ruta, st) => ({
  ruta,
  bytes: st.size,
  modificado: st.mtime.toISOString(),
});

const esArchivoDeTexto = (entrada) =>
  entrada.isFile() && EXTENSIONES.test(entrada.name);

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
      archivos.push(filaDeArchivo(relativa, st));
    }
  }

  /** Una entrada que no se recorre: nombre raro, de admin, o una carpeta omitida del primer nivel. */
  const omitir = (entrada, hija, nivel) =>
    !SEGMENTO.test(entrada.name) ||
    !puedeVer(hija, rol) ||
    (entrada.isDirectory() &&
      nivel === 1 &&
      CARPETAS_OMITIDAS.has(entrada.name.toLowerCase()));

  const recorrer = async (relativa, nivel) => {
    if (truncado || nivel > PROFUNDIDAD_MAXIMA - 1) {
      return;
    }
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
      if (omitir(entrada, hija, nivel)) {
        continue;
      }
      if (entrada.isDirectory()) {
        await recorrer(hija, nivel + 1);
      } else if (esArchivoDeTexto(entrada)) {
        const st = await fs.stat(path.join(raiz, hija)).catch(() => null);
        if (st) {
          archivos.push(filaDeArchivo(hija, st));
        }
      } else {
        // Ni carpeta ni archivo de texto (binarios, enlaces a nada): no se lista.
      }
    }
  };
  await recorrer("plugins", 1);
  return { archivos, truncado };
}

const existe = (ruta) =>
  fs.stat(ruta).then(
    () => true,
    () => false,
  );

/** ¿Se puede escribir aquí? Un servicio con la carpeta en solo lectura lista pero no guarda. */
const puedeEscribir = (ruta) =>
  fs.access(ruta, fs.constants.W_OK).then(
    () => true,
    () => false,
  );

/**
 * Quita las `/` del principio y del final. Sin `/^\/+|\/+$/g`: la segunda mitad reintentaba desde
 * cada barra y era cuadrática con una ruta llena de ellas.
 */
function sinBarrasExtremas(texto) {
  let inicio = 0;
  let fin = texto.length;
  while (inicio < fin && texto[inicio] === "/") {
    inicio += 1;
  }
  while (fin > inicio && texto[fin - 1] === "/") {
    fin -= 1;
  }
  return texto.slice(inicio, fin);
}

/**
 * Valida la ruta de una CARPETA que se quiere navegar. El juego de carpetas navegables es corto a
 * propósito: la raíz, `config/` (los yml de Paper) y cualquier carpeta dentro de `plugins/`.
 * `world/`, `logs/` y compañía siguen fuera.
 */
export function validarCarpetaRelativa(entrada, rol) {
  const relativa = sinBarrasExtremas(
    String(entrada ?? "")
      .normalize("NFC")
      .trim(),
  );
  if (!relativa) {
    return { ok: true, relativa: "" };
  }
  const malFormada = rechazoDeForma(relativa);
  if (malFormada) {
    return malFormada;
  }
  if (relativa !== "config" && relativa.split("/")[0] !== "plugins") {
    return rechazo(403, "ruta_no_permitida", "solo plugins/ y config/");
  }
  if (!puedeVer(`${relativa}/`, rol)) {
    return rechazo(403, "solo_admin", "esa carpeta lleva credenciales");
  }
  return { ok: true, relativa };
}

/**
 * Contenido de UNA carpeta para el explorador: subcarpetas, archivos editables y si la carpeta
 * admite escritura. Antes llegaba una lista plana con todo el servidor (hasta 4000 entradas) y
 * había que buscar por texto; navegar por carpetas deja cada plugin en su sitio y evita que un
 * guardado fallido sorprenda: la pantalla sabe de antemano si puede guardar.
 */
export async function listarCarpeta({ ruta, dir, rol } = {}) {
  const valida = validarCarpetaRelativa(ruta, rol);
  if (!valida.ok) {
    return valida;
  }
  const raiz = base(dir);
  const relativa = valida.relativa;
  // La raíz es la propia base: no hay segmento que validar. `realpath` se resuelve igual para no
  // listar a través de un enlace simbólico.
  const real = relativa
    ? await resolverReal(relativa, raiz, { debeExistir: true })
    : { ok: true, ruta: await fs.realpath(raiz).catch(() => raiz) };
  if (!real.ok) {
    return real;
  }
  const carpeta = real.ruta;
  const migas = migasDe(relativa);
  const describir = descriptorEn(carpeta);

  // La raíz no es una carpeta del servidor: son los archivos de Paper/Bukkit/Spigot y las dos
  // carpetas por las que se empieza a navegar.
  const contenido = relativa
    ? await contenidoDeCarpeta(carpeta, relativa, rol, describir)
    : await contenidoDeRaiz(carpeta, describir);
  if (!contenido) {
    return {
      ok: true,
      ruta: relativa,
      migas,
      carpetas: [],
      archivos: [],
      escribible: false,
      legible: false,
    };
  }
  return {
    ok: true,
    ruta: relativa,
    migas,
    ...contenido,
    escribible: await puedeEscribir(carpeta),
    legible: true,
  };
}

/** Las migas de pan de una carpeta: cada tramo con la ruta hasta él (vacías en la raíz). */
function migasDe(relativa) {
  if (!relativa) {
    return [];
  }
  return relativa.split("/").map((nombre, i, trozos) => ({
    nombre,
    ruta: trozos.slice(0, i + 1).join("/"),
  }));
}

/** Describe un archivo de `carpeta` para el explorador, o `null` si ya no está. */
function descriptorEn(carpeta) {
  return async (nombre, rutaRelativa) => {
    const completa = path.join(carpeta, nombre);
    const st = await fs.stat(completa).catch(() => null);
    if (!st) {
      return null;
    }
    return {
      nombre,
      ruta: rutaRelativa,
      bytes: st.size,
      modificado: st.mtime.toISOString(),
      escribible: await puedeEscribir(completa),
    };
  };
}

/** La raíz: los archivos sueltos de `ARCHIVOS_RAIZ` y las carpetas `plugins` y `config`. */
async function contenidoDeRaiz(carpeta, describir) {
  const archivos = [];
  for (const nombre of ARCHIVOS_RAIZ.filter((r) => !r.includes("/"))) {
    const descrito = await describir(nombre, nombre);
    if (descrito) {
      archivos.push(descrito);
    }
  }
  const carpetas = [];
  if (await existe(path.join(carpeta, "plugins"))) {
    carpetas.push({ nombre: "plugins", ruta: "plugins" });
  }
  if (ARCHIVOS_RAIZ.some((r) => r.startsWith("config/"))) {
    carpetas.push({ nombre: "config", ruta: "config" });
  }
  return { carpetas, archivos };
}

/**
 * Subcarpetas y archivos editables de una carpeta ya validada, o `null` si no se puede leer
 * (el servicio no tiene permiso: la pantalla lo muestra como «no legible»).
 */
async function contenidoDeCarpeta(carpeta, relativa, rol, describir) {
  const entradas = await fs
    .readdir(carpeta, { withFileTypes: true })
    .catch(() => null);
  if (!entradas) {
    return null;
  }
  entradas.sort((a, b) => a.name.localeCompare(b.name));
  const carpetas = [];
  const archivos = [];
  for (const entrada of entradas) {
    const hija = `${relativa}/${entrada.name}`;
    const tipo = tipoDeEntrada(entrada, hija, relativa, rol);
    if (tipo === "carpeta") {
      carpetas.push({ nombre: entrada.name, ruta: hija });
    } else if (tipo === "archivo") {
      const descrito = await describir(entrada.name, hija);
      if (descrito) {
        archivos.push(descrito);
      }
    } else {
      // Ni carpeta navegable ni archivo editable: no se ofrece.
    }
  }
  return { carpetas, archivos };
}

/** Qué es una entrada para el explorador: `'carpeta'`, `'archivo'` o `null` si no se muestra. */
function tipoDeEntrada(entrada, hija, relativa, rol) {
  if (!SEGMENTO.test(entrada.name)) {
    return null;
  }
  if (!puedeVer(hija, rol) || !puedeVer(`${hija}/`, rol)) {
    return null;
  }
  if (entrada.isDirectory()) {
    const omitida =
      relativa === "plugins" &&
      CARPETAS_OMITIDAS.has(entrada.name.toLowerCase());
    return omitida ? null : "carpeta";
  }
  if (!esArchivoDeTexto(entrada)) {
    return null;
  }
  // `config/` solo abre su lista cerrada: el resto de la carpeta no se ofrece.
  if (relativa === "config" && !ARCHIVOS_RAIZ.includes(hija)) {
    return null;
  }
  return "archivo";
}

/** Lee un archivo permitido. */
export async function leerArchivo({ ruta, dir, rol } = {}) {
  const valida = validarRutaRelativa(ruta, rol);
  if (!valida.ok) {
    return valida;
  }
  const raiz = base(dir);
  const real = await resolverReal(valida.relativa, raiz, { debeExistir: true });
  if (!real.ok) {
    return real;
  }
  // Un solo descriptor: se mide y se lee EL MISMO archivo. Con `stat` y luego `readFile` por ruta,
  // el archivo podía cambiar (o ser un enlace nuevo) entre las dos llamadas.
  const manejador = await fs.open(real.ruta, "r").catch(() => null);
  if (!manejador) {
    return rechazo(404, "no_existe", path.basename(real.ruta));
  }
  try {
    const st = await manejador.stat();
    if (!st.isFile()) {
      return rechazo(404, "no_existe", path.basename(real.ruta));
    }
    if (st.size > LIMITE_CONFIG_BYTES) {
      return rechazo(413, "archivo_demasiado_grande", `${st.size} bytes`);
    }
    const contenido = await manejador.readFile("utf8");
    return { ok: true, ruta: valida.relativa, contenido };
  } finally {
    await manejador.close();
  }
}

/** Revisa que el contenido sea cargable según su extensión. */
export function validarContenido(relativa, texto) {
  const contenido = String(texto ?? "").replaceAll("\r\n", "\n");
  if (Buffer.byteLength(contenido, "utf8") > LIMITE_CONFIG_BYTES) {
    return rechazo(413, "configuracion_demasiado_grande");
  }
  if (contenido.includes("\u0000")) {
    return rechazo(400, "contenido_invalido");
  }
  if (/\.json$/i.test(relativa)) {
    try {
      JSON.parse(contenido);
    } catch (e) {
      return rechazo(400, "json_invalido", e instanceof Error ? e.message : "");
    }
  }
  if (/\.(yml|yaml)$/i.test(relativa)) {
    const yaml = rechazoDeYaml(contenido);
    if (yaml) {
      return yaml;
    }
  }
  return { ok: true, contenido };
}

/** Lo que rompe un yml al cargarlo, línea a línea: indentación con tabulador o líneas absurdas. */
function rechazoDeYaml(contenido) {
  for (const [i, linea] of contenido.split("\n").entries()) {
    if (/^ *\t/.test(linea)) {
      return rechazo(
        400,
        "yaml_invalido",
        `línea ${i + 1}: tabulador de indentación`,
      );
    }
    if (linea.length > 4096) {
      return rechazo(400, "linea_demasiado_larga", `línea ${i + 1}`);
    }
  }
  return null;
}

/**
 * Traduce un fallo del sistema de archivos al rechazo del panel. `EACCES`/`EPERM`/`EROFS` no son
 * «error del servidor»: la web está leyendo la carpeta del servidor pero el servicio no tiene
 * permiso de escritura sobre ella, y el mensaje tiene que decirlo para que nadie lo busque en el
 * código. El resto de fallos se devuelve como 500 con el código, sin la ruta completa.
 */
export function falloDeEscritura(error) {
  const codigo = String(error?.code ?? "");
  if (codigo === "EACCES" || codigo === "EPERM" || codigo === "EROFS") {
    return rechazo(
      403,
      "sin_permiso_escritura",
      "el servicio web puede leer esa carpeta pero no escribir en ella",
    );
  }
  if (codigo === "ENOSPC") {
    return rechazo(507, "sin_espacio", "no queda disco");
  }
  return rechazo(500, "no_se_pudo_guardar", codigo || "error de escritura");
}

/** Guarda un archivo permitido, con copia `.bak` del anterior. */
export async function guardarArchivo({ ruta, contenido, dir, rol } = {}) {
  const valida = validarRutaRelativa(ruta, rol);
  if (!valida.ok) {
    return valida;
  }
  const revision = validarContenido(valida.relativa, contenido);
  if (!revision.ok) {
    return revision;
  }
  const raiz = base(dir);
  const real = await resolverReal(valida.relativa, raiz, {
    debeExistir: false,
  });
  if (!real.ok) {
    return real;
  }
  const texto = conUnSaltoFinal(revision.contenido);
  try {
    // Una copia de lo anterior; si el archivo no existía no hay nada que copiar.
    await fs.copyFile(real.ruta, `${real.ruta}.bak`).catch(() => {});
    await fs.mkdir(path.dirname(real.ruta), { recursive: true });
    await fs.writeFile(real.ruta, texto);
  } catch (e) {
    return falloDeEscritura(e);
  }
  return {
    ok: true,
    ruta: valida.relativa,
    bytes: Buffer.byteLength(texto, "utf8"),
  };
}
