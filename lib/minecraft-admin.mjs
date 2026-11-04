/**
 * Mantenedor de plugins de Minecraft: rol, enlace mágico, subida de jars y configuración.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * El sitio ya tiene un mantenedor de catálogo (`lib/admin-auth.mjs`, `/admin`) con contraseña
 * y sesiones en Turso. Este es OTRO mantenedor: el de los plugins y la configuración del
 * servidor de Minecraft, en `/minecraft-admin`, y no comparte credenciales con el anterior.
 * La gente que lo usa no tiene por qué recordar una contraseña más, así que entra con un
 * enlace mágico: se pide el correo, se envía un enlace de un solo uso y ese enlace abre una
 * sesión con rol `mantenedor`.
 *
 * LAS REGLAS QUE NO SE PUEDEN RELAJAR
 * -----------------------------------
 * 1. Cada endpoint comprueba el rol. La página escondida no protege nada: quien tenga la URL
 *    llama a la API directamente, así que `autorizar()` se ejecuta en la ruta, no solo en la UI.
 * 2. El enlace caduca (15 min), es de un solo uso y NO se guarda en claro: se guarda su huella
 *    SHA-256. Quien lea el almacén no puede canjear los enlaces que encuentre.
 * 3. Un jar es código que se ejecuta en el servidor: se exige extensión `.jar`, nombre sin
 *    rutas y un tamaño máximo. Rechazar aquí es lo único que separa «subir un plugin» de
 *    «ejecutar lo que me dé la gana en la máquina».
 * 4. La configuración se valida ANTES de escribir: un `server.properties` con una línea rota
 *    deja el servidor sin arrancar y el error aparece mucho después, en el reinicio.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { enviarCorreo, urlDelSitio } from "./correo.mjs";

/** El rol nuevo. Se escribe una sola vez aquí para que no haya dos cadenas distintas. */
export const ROL_MANTENEDOR = "mantenedor";

/** Un jar de plugin ronda los pocos MB; 8 MB deja margen y corta un volcado accidental. */
export const LIMITE_JAR_BYTES = 8 * 1024 * 1024;

/** `server.properties` y los yml de plugin son texto: 256 KB es holgado. */
export const LIMITE_CONFIG_BYTES = 256 * 1024;

/** Quince minutos: lo que tarda alguien en abrir el correo y pulsar el botón. */
export const VIGENCIA_ENLACE_MS = 15 * 60 * 1000;

export const DESTINO_POR_DEFECTO = "deploy/minecraft";

/* ------------------------------------------------------------------ */
/* Rol                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Saca el rol de una sesión, aceptando las dos formas que hay en el proyecto:
 * `{ role }` (token del mantenedor) y `{ user: { role } }` (respuesta del login).
 */
export function rolDe(sesion) {
  if (!sesion || typeof sesion !== "object") return null;
  if (typeof sesion.role === "string") return sesion.role;
  const anidado = sesion.user?.role;
  return typeof anidado === "string" ? anidado : null;
}

/** ¿La sesión tiene el rol nuevo? */
export function esMantenedor(sesion) {
  return rolDe(sesion) === ROL_MANTENEDOR;
}

/**
 * La comprobación que hace CADA endpoint (y la página). Devuelve un objeto en vez de lanzar
 * para que la ruta decida el código HTTP, y para que la prueba pueda mirar el 403 sin montar
 * un servidor.
 */
export function autorizar(sesion) {
  if (!sesion) {
    return {
      ok: false,
      status: 401,
      cuerpo: { error: "sin_sesion", detail: "hace falta una sesión de mantenedor" },
    };
  }
  if (!esMantenedor(sesion)) {
    return {
      ok: false,
      status: 403,
      cuerpo: {
        error: "prohibido",
        detail: "esta sección requiere el rol mantenedor",
      },
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Enlace mágico                                                       */
/* ------------------------------------------------------------------ */

const enlaces = new Map();

const huella = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Solo para los tests: vacía los enlaces emitidos. */
export function __reiniciarEnlaces() {
  enlaces.clear();
}

/** Emite un enlace de un solo uso y devuelve el token EN CLARO (para el correo) y su caducidad. */
export function emitirEnlace({ email, ahora = Date.now() } = {}) {
  const limpio = String(email ?? "").trim().toLowerCase();
  if (!CORREO_VALIDO.test(limpio)) {
    return {
      ok: false,
      status: 400,
      cuerpo: { error: "correo_invalido", detail: "hace falta una dirección de correo" },
    };
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const caducaEn = ahora + VIGENCIA_ENLACE_MS;
  enlaces.set(huella(token), { email: limpio, caducaEn, usado: false });
  return { ok: true, token, email: limpio, caducaEn };
}

/**
 * Canjea el enlace. Devuelve la sesión de mantenedor o el motivo del rechazo: caducado,
 * ya usado o inventado. El token se quema en el mismo acto de canjearlo.
 */
export function canjearEnlace(token, { ahora = Date.now() } = {}) {
  const clave = huella(String(token ?? ""));
  const enlace = enlaces.get(clave);
  if (!enlace) {
    return { ok: false, status: 400, cuerpo: { error: "enlace_invalido" } };
  }
  if (enlace.caducaEn <= ahora) {
    enlaces.delete(clave);
    return { ok: false, status: 400, cuerpo: { error: "enlace_caducado" } };
  }
  enlace.usado = true;
  enlaces.delete(clave);
  return {
    ok: true,
    sesion: {
      username: enlace.email,
      email: enlace.email,
      role: ROL_MANTENEDOR,
    },
  };
}

/**
 * El alta del rol: valida el correo, emite el enlace y manda el correo con el enlace.
 * La URL sale de `SITE_URL` (no de la cabecera `Host`), igual que los demás correos del sitio.
 * El token va en el FRAGMENTO: no viaja al servidor ni aparece en los logs de nginx.
 */
export async function enviarEnlaceMantenedor({
  email,
  ahora = Date.now(),
  env = process.env,
} = {}) {
  const emision = emitirEnlace({ email, ahora });
  if (!emision.ok) return emision;

  const enlace = `${urlDelSitio(env)}/minecraft-admin#t=${emision.token}`;
  const texto = [
    "Hola:",
    "",
    "Has pedido entrar al mantenedor de plugins de VTuberDex.",
    `Abre este enlace para entrar: ${enlace}`,
    "",
    "El enlace sirve una sola vez y caduca en 15 minutos.",
    "Si no lo has pedido tú, ignora este mensaje: no se ha dado acceso a nadie.",
    "",
    "Con cariño, el equipo de VTuberDex ✦ vtuberdex.com",
  ].join("\n");

  try {
    await enviarCorreo(
      { para: emision.email, asunto: "Tu acceso al mantenedor de Minecraft", texto },
      env,
    );
  } catch (error) {
    return {
      ok: false,
      status: 502,
      cuerpo: {
        error: "correo_no_enviado",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
  return { ok: true, email: emision.email, enlace, caducaEn: emision.caducaEn };
}

/* ------------------------------------------------------------------ */
/* Subida de plugins                                                   */
/* ------------------------------------------------------------------ */

/**
 * Valida el jar ANTES de tocar el disco. Rechaza: nombre vacío, nombre con rutas
 * (`../../etc/passwd.jar`), extensión distinta de `.jar`, tamaño no numérico, cero y
 * por encima del límite.
 */
export function validarJar({ nombre, tamano } = {}) {
  const limpio = String(nombre ?? "").trim();
  if (!limpio) {
    return { ok: false, status: 400, cuerpo: { error: "falta_nombre" } };
  }
  if (path.basename(limpio) !== limpio || limpio.includes("\\")) {
    return {
      ok: false,
      status: 400,
      cuerpo: { error: "nombre_invalido", detail: "el nombre no puede llevar rutas" },
    };
  }
  if (!/\.jar$/i.test(limpio)) {
    return {
      ok: false,
      status: 415,
      cuerpo: {
        error: "extension_no_permitida",
        detail: "solo se aceptan archivos .jar",
      },
    };
  }
  const bytes = Number(tamano);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, status: 400, cuerpo: { error: "archivo_vacio" } };
  }
  if (bytes > LIMITE_JAR_BYTES) {
    return {
      ok: false,
      status: 413,
      cuerpo: {
        error: "archivo_demasiado_grande",
        detail: `el máximo son ${LIMITE_JAR_BYTES} bytes`,
        limite: LIMITE_JAR_BYTES,
      },
    };
  }
  return { ok: true, nombre: limpio, tamano: bytes };
}

/** Los metadatos que la API devuelve tras guardar el jar. */
export function metadatosJar({ nombre, tamano, ruta, ahora = Date.now() } = {}) {
  return {
    nombre,
    tamano,
    bytes: tamano,
    ruta,
    subidoEn: new Date(ahora).toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Rutas seguras                                                       */
/* ------------------------------------------------------------------ */

/** Más largo que esto no es un nombre de archivo: es un intento de otra cosa. */
export const LIMITE_NOMBRE_ARCHIVO = 128;

/**
 * Lo que puede llevar un nombre de archivo: letras (con acentos), números, espacio, punto,
 * guion, guion bajo, más y paréntesis. Fuera quedan las barras, los dos puntos (letra de
 * unidad de Windows), los bytes de control y todo lo que empiece por algo que no sea letra o
 * número (un punto inicial, un guion que un `rm` leería como opción).
 */
const NOMBRE_ARCHIVO_VALIDO = /^[\p{L}\p{N}][\p{L}\p{N} ._+()-]*$/u;

/** Rechazo con la forma del resto del módulo, para que la ruta devuelva su status. */
function nombreInvalido(detail) {
  return { ok: false, status: 400, cuerpo: { error: "nombre_invalido", detail } };
}

/**
 * ¿El texto lleva caracteres de control? Se mira por código, no con una regex, para no
 * escribir un rango de control literal (eslint `no-control-regex`).
 */
function tieneCaracteresDeControl(texto) {
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0);
    if (codigo <= 0x1f || codigo === 0x7f) return true;
  }
  return false;
}

/**
 * Sanea un nombre que viene de la red y devuelve la ruta final ya resuelta dentro de `base`
 * (y de `carpeta`, si se pasa). Rechaza vacíos, rutas absolutas, `..`, separadores y cualquier
 * nombre cuya ruta resuelta se salga del directorio permitido.
 *
 * Es el ÚNICO sitio donde un dato de la petición se convierte en ruta: si esto devuelve
 * `ok: true`, la ruta está dentro de la base; si devuelve `ok: false`, no hay ruta que usar.
 */
export function resolverRutaEnBase(nombre, { base, carpeta } = {}) {
  const original = typeof nombre === "string" ? nombre.normalize("NFC").trim() : "";
  if (!original) return nombreInvalido("hace falta un nombre de archivo");
  if (original.length > LIMITE_NOMBRE_ARCHIVO) {
    return nombreInvalido(`el nombre pasa de ${LIMITE_NOMBRE_ARCHIVO} caracteres`);
  }
  if (tieneCaracteresDeControl(original)) {
    return nombreInvalido("el nombre lleva caracteres de control");
  }
  if (original.includes("..")) return nombreInvalido('el nombre no puede llevar ".."');
  if (original.includes("/") || original.includes("\\")) {
    return nombreInvalido("el nombre no puede llevar separadores de ruta");
  }
  if (original.includes(":")) return nombreInvalido("el nombre no puede llevar dos puntos");
  if (path.isAbsolute(original) || path.basename(original) !== original) {
    return nombreInvalido("hace falta un nombre, no una ruta");
  }
  if (!NOMBRE_ARCHIVO_VALIDO.test(original)) {
    return nombreInvalido("solo letras, números, espacio, punto, guion, guion bajo, más y paréntesis");
  }

  const raiz = path.resolve(
    typeof base === "string" && base
      ? base
      : process.env.VTUBERDEX_MINECRAFT_DIR || DESTINO_POR_DEFECTO,
  );
  const directorio = carpeta ? path.resolve(raiz, String(carpeta)) : raiz;
  const ruta = path.resolve(directorio, original);
  const relativa = path.relative(directorio, ruta);
  if (!relativa || relativa.startsWith("..") || path.isAbsolute(relativa)) {
    return nombreInvalido("la ruta se sale del directorio permitido");
  }
  return { ok: true, nombre: original, ruta, base: raiz };
}

async function escribir(ruta, contenido) {
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  await fs.writeFile(ruta, contenido);
  return { ok: true, ruta, bytes: Buffer.byteLength(contenido, "utf8") };
}

/** Guarda el jar ya validado en el directorio de plugins del servidor. */
export async function guardarJar({ nombre, contenido, dir } = {}) {
  const datos = contenido instanceof Uint8Array ? contenido : null;
  const validacion = validarJar({ nombre, tamano: datos?.byteLength });
  if (!validacion.ok) return validacion;
  // El nombre viene de la red: la única ruta que se escribe es la que devuelve el saneador.
  const destino = resolverRutaEnBase(validacion.nombre, { base: dir, carpeta: "plugins" });
  if (!destino.ok) return destino;
  await escribir(destino.ruta, datos);
  return {
    ok: true,
    metadatos: metadatosJar({
      nombre: destino.nombre,
      tamano: validacion.tamano,
      ruta: destino.ruta,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

/**
 * Lee un `server.properties` y devuelve sus pares clave/valor. Se rechaza la línea sin `=`
 * porque es justo lo que Minecraft se traga sin decir nada y luego arranca con los valores
 * por defecto, que es peor que fallar.
 */
export function analizarServerProperties(texto) {
  const contenido = String(texto ?? "").replace(/\r\n/g, "\n");
  if (!contenido.trim()) {
    return { ok: false, status: 400, cuerpo: { error: "vacio" } };
  }
  if (Buffer.byteLength(contenido, "utf8") > LIMITE_CONFIG_BYTES) {
    return { ok: false, status: 413, cuerpo: { error: "configuracion_demasiado_grande" } };
  }
  if (contenido.includes("\u0000")) {
    return { ok: false, status: 400, cuerpo: { error: "contenido_invalido" } };
  }
  const valores = {};
  const lineas = contenido.split("\n");
  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i].trim();
    if (!linea || linea.startsWith("#")) continue;
    const corte = linea.indexOf("=");
    if (corte <= 0) {
      return {
        ok: false,
        status: 400,
        cuerpo: { error: "linea_invalida", detail: `línea ${i + 1}: falta la clave o el '='` },
      };
    }
    const clave = linea.slice(0, corte).trim();
    if (!/^[A-Za-z0-9._-]+$/.test(clave)) {
      return {
        ok: false,
        status: 400,
        cuerpo: { error: "clave_invalida", detail: `línea ${i + 1}` },
      };
    }
    valores[clave] = linea.slice(corte + 1);
  }
  if (Object.keys(valores).length === 0) {
    return { ok: false, status: 400, cuerpo: { error: "sin_valores" } };
  }
  return { ok: true, valores };
}

/**
 * Valida un yml de plugin. No se traga un parser YAML entero: se comprueba lo que rompe de
 * verdad al cargar —vacío, tamaño, bytes nulos, tabuladores de indentación (YAML los prohíbe)
 * y líneas absurdamente largas—.
 */
export function validarConfiguracionDePlugin(texto) {
  const contenido = String(texto ?? "").replace(/\r\n/g, "\n");
  if (!contenido.trim()) {
    return { ok: false, status: 400, cuerpo: { error: "vacio" } };
  }
  if (Buffer.byteLength(contenido, "utf8") > LIMITE_CONFIG_BYTES) {
    return { ok: false, status: 413, cuerpo: { error: "configuracion_demasiado_grande" } };
  }
  if (contenido.includes("\u0000")) {
    return { ok: false, status: 400, cuerpo: { error: "contenido_invalido" } };
  }
  const lineas = contenido.split("\n");
  for (let i = 0; i < lineas.length; i += 1) {
    if (/^\t/.test(lineas[i])) {
      return {
        ok: false,
        status: 400,
        cuerpo: { error: "yaml_invalido", detail: `línea ${i + 1}: tabulador de indentación` },
      };
    }
    if (lineas[i].length > 4096) {
      return {
        ok: false,
        status: 400,
        cuerpo: { error: "linea_demasiado_larga", detail: `línea ${i + 1}` },
      };
    }
  }
  return { ok: true };
}

/**
 * Guarda la configuración del servidor o de un plugin.
 * `tipo: "servidor"` escribe `server.properties`; `tipo: "plugin"` escribe
 * `plugins/<archivo>.yml`. Se valida antes de escribir y nunca se sale del directorio base.
 */
export async function guardarConfiguracion({ tipo, contenido, archivo, dir } = {}) {
  const base = dir || process.env.VTUBERDEX_MINECRAFT_DIR || DESTINO_POR_DEFECTO;
  const texto = String(contenido ?? "");

  if (tipo === "servidor") {
    const revision = analizarServerProperties(texto);
    if (!revision.ok) return revision;
    const normalizado = revision
      ? texto.replace(/\r\n/g, "\n").replace(/\n*$/, "\n")
      : texto;
    return escribir(path.join(base, "server.properties"), normalizado);
  }

  if (tipo === "plugin") {
    const revision = validarConfiguracionDePlugin(texto);
    if (!revision.ok) return revision;
    const nombre = String(archivo ?? "").trim();
    if (!/^[A-Za-z0-9._-]+\.(yml|yaml)$/i.test(nombre) || path.basename(nombre) !== nombre) {
      return {
        ok: false,
        status: 400,
        cuerpo: { error: "archivo_invalido", detail: "hace falta un .yml sin rutas" },
      };
    }
    const destino = resolverRutaEnBase(nombre, { base, carpeta: "plugins" });
    if (!destino.ok) return destino;
    const normalizado = texto.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
    return escribir(destino.ruta, normalizado);
  }

  return {
    ok: false,
    status: 400,
    cuerpo: { error: "tipo_invalido", detail: 'usa "servidor" o "plugin"' },
  };
}

/** El listado del panel: jars ya subidos y configuraciones presentes. */
export async function listarMinecraft({ dir } = {}) {
  const base = dir || process.env.VTUBERDEX_MINECRAFT_DIR || DESTINO_POR_DEFECTO;
  const leer = async (carpeta, filtro) => {
    try {
      const nombres = await fs.readdir(path.join(base, carpeta));
      return nombres.filter(filtro).sort();
    } catch {
      return [];
    }
  };
  return {
    plugins: await leer("plugins", (n) => n.toLowerCase().endsWith(".jar")),
    configuraciones: await leer("plugins", (n) => /\.(yml|yaml)$/i.test(n)),
    servidor: (await leer(".", (n) => n === "server.properties")).length > 0,
    directorio: base,
  };
}

/** Lee `server.properties` o el yml de un plugin; 404 si el archivo no está. */
export async function leerConfiguracion({ tipo, archivo, dir } = {}) {
  const base = dir || process.env.VTUBERDEX_MINECRAFT_DIR || DESTINO_POR_DEFECTO;
  let ruta;
  if (tipo === "servidor") {
    ruta = path.join(base, "server.properties");
  } else if (tipo === "plugin") {
    const nombre = String(archivo ?? "").trim();
    if (!/^[A-Za-z0-9._-]+\.(yml|yaml)$/i.test(nombre) || path.basename(nombre) !== nombre) {
      return {
        ok: false,
        status: 400,
        cuerpo: { error: "archivo_invalido", detail: "hace falta un .yml sin rutas" },
      };
    }
    const destino = resolverRutaEnBase(nombre, { base, carpeta: "plugins" });
    if (!destino.ok) return destino;
    ruta = destino.ruta;
  } else {
    return {
      ok: false,
      status: 400,
      cuerpo: { error: "tipo_invalido", detail: 'usa "servidor" o "plugin"' },
    };
  }
  try {
    const contenido = await fs.readFile(ruta, "utf8");
    return { ok: true, tipo, archivo: path.basename(ruta), contenido };
  } catch {
    return { ok: false, status: 404, cuerpo: { error: "no_existe", archivo: path.basename(ruta) } };
  }
}

/* ------------------------------------------------------------------ */
/* Sesión del mantenedor (cookie firmada)                              */
/* ------------------------------------------------------------------ */

/** La cookie que abre el panel. Va HttpOnly y SameSite=Lax, como la de los visitantes. */
export const COOKIE_MANTENEDOR = "sesion_mantenedor";

/** Dos horas: el rato de una sesión de trabajo; después se pide otro enlace. */
export const VIDA_SESION_MANTENEDOR_MS = 2 * 60 * 60 * 1000;

function secretoDeSesion(env = process.env) {
  return (
    env.VTUBERDEX_MANTENEDOR_SECRETO ||
    "desarrollo-solo-local-no-usar-en-produccion"
  );
}

const firmar = (datos, secreto) =>
  crypto.createHmac("sha256", secreto).update(datos).digest("base64url");

/**
 * Crea el valor de la cookie: `carga.firma`. La carga dice correo, rol y caducidad; la firma
 * HMAC impide que alguien se fabrique un rol `mantenedor` editando el JSON.
 */
export function crearSesionMantenedor({
  email,
  role = ROL_MANTENEDOR,
  ahora = Date.now(),
  secreto,
} = {}) {
  const limpio = String(email ?? "").trim().toLowerCase();
  if (!CORREO_VALIDO.test(limpio) || typeof role !== "string" || !role) return null;
  const datos = Buffer.from(
    JSON.stringify({ email: limpio, role, exp: ahora + VIDA_SESION_MANTENEDOR_MS }),
  ).toString("base64url");
  return `${datos}.${firmar(datos, secreto || secretoDeSesion())}`;
}

/** Devuelve `{ email, role }` o null si la firma no cuadra, la carga está rota o caducó. */
export function leerSesionMantenedor(token, { ahora = Date.now(), secreto } = {}) {
  const partes = String(token ?? "").split(".");
  if (partes.length !== 2) return null;
  const [datos, recibida] = partes;
  const esperada = firmar(datos, secreto || secretoDeSesion());
  if (recibida.length !== esperada.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(recibida), Buffer.from(esperada))) return null;
  let carga;
  try {
    carga = JSON.parse(Buffer.from(datos, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!carga || typeof carga.email !== "string" || typeof carga.role !== "string") return null;
  if (!(Number(carga.exp) > ahora)) return null;
  return { email: carga.email, role: carga.role };
}

/** La sesión que trae la petición, a partir de su cookie. */
export function sesionDeLaPeticion(request, opciones = {}) {
  const cookie = request?.headers?.get?.("cookie") ?? "";
  const trozo = cookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE_MANTENEDOR}=`));
  if (!trozo) return null;
  const valor = decodeURIComponent(trozo.slice(COOKIE_MANTENEDOR.length + 1));
  return leerSesionMantenedor(valor, opciones);
}

/** La cabecera `set-cookie` de una sesión recién abierta. */
export function cookieDeSesion(token, { seguro = true } = {}) {
  return `${COOKIE_MANTENEDOR}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(
    VIDA_SESION_MANTENEDOR_MS / 1000,
  )}; HttpOnly; SameSite=Lax${seguro ? "; Secure" : ""}`;
}
