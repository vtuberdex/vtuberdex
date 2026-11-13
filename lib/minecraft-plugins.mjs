// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Gestión de plugins del servidor para `/minecraft-admin`: qué hay instalado (con los datos
 * que el propio jar declara), cuáles están cargados, habilitar/deshabilitar y leer su registro.
 *
 * POR QUÉ NO HAY «ACTIVAR EN CALIENTE»
 * Paper no descarga ni carga plugins de forma segura con el servidor andando (`/reload` está
 * desaconsejado y rompe plugins con estado). Habilitar o deshabilitar es renombrar el jar
 * (`X.jar` ↔ `X.jar.disabled`) y el cambio surte efecto al REINICIAR. Por eso cada plugin
 * lleva dos datos: lo que dicen los archivos (`habilitado`) y lo que corre ahora (`cargado`,
 * de `/plugins` por RCON); si no coinciden, el panel avisa «pendiente de reinicio».
 *
 * `plugin.yml` se lee del jar con un lector zip mínimo (solo el directorio central y una
 * entrada): así no hace falta una dependencia ni leer jars de decenas de MB enteros.
 */
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { sinColores } from "./minecraft-rcon.mjs";

const DESTINO_POR_DEFECTO = "/srv/minecraft";
const baseDe = (dir) =>
  dir || process.env.VTUBERDEX_MINECRAFT_DIR || DESTINO_POR_DEFECTO;

/** Los plugins de VTuberDex son los que vinculan cuentas: apagarlos desde la web dejaría a todos en el lobby. */
const PROTEGIDO = /^vtuberdex/i;

/* ------------------------------------------------------------------ */
/* Lector de plugin.yml dentro de un jar                               */
/* ------------------------------------------------------------------ */

async function leerEntradaZip(manejador, tamano, nombreBuscado) {
  const cola = Math.min(tamano, 66000);
  const bufCola = Buffer.alloc(cola);
  await manejador.read(bufCola, 0, cola, tamano - cola);
  let eocd = -1;
  for (let i = cola - 22; i >= 0; i -= 1) {
    if (bufCola.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return null;
  }
  const tamDir = bufCola.readUInt32LE(eocd + 12);
  const posDir = bufCola.readUInt32LE(eocd + 16);
  if (tamDir > 8 * 1024 * 1024 || posDir + tamDir > tamano) {
    return null;
  }
  const dir = Buffer.alloc(tamDir);
  await manejador.read(dir, 0, tamDir, posDir);
  let p = 0;
  while (p + 46 <= tamDir && dir.readUInt32LE(p) === 0x02014b50) {
    const metodo = dir.readUInt16LE(p + 10);
    const comprimido = dir.readUInt32LE(p + 20);
    const lNombre = dir.readUInt16LE(p + 28);
    const lExtra = dir.readUInt16LE(p + 30);
    const lComentario = dir.readUInt16LE(p + 32);
    const cabecera = dir.readUInt32LE(p + 42);
    const nombre = dir.toString("utf8", p + 46, p + 46 + lNombre);
    if (nombre === nombreBuscado && comprimido < 1024 * 1024) {
      const local = Buffer.alloc(30);
      await manejador.read(local, 0, 30, cabecera);
      if (local.readUInt32LE(0) !== 0x04034b50) {
        return null;
      }
      const inicio =
        cabecera + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const datos = Buffer.alloc(comprimido);
      await manejador.read(datos, 0, comprimido, inicio);
      return metodo === 0
        ? datos
        : metodo === 8
          ? zlib.inflateRawSync(datos)
          : null;
    }
    p += 46 + lNombre + lExtra + lComentario;
  }
  return null;
}

/** Valor de una clave de primer nivel de un yml simple (`name: X`), sin comillas. */
function claveYml(texto, clave) {
  const m = texto.match(
    new RegExp(`^${clave}:[ \\t]*['"]?([^\\r\\n'"]*)['"]?[ \\t]*$`, "m"),
  );
  return m ? m[1].trim() : "";
}

/** Autores: `author: X` o `authors: [A, B]`. */
function autoresYml(texto) {
  const uno = claveYml(texto, "author");
  if (uno) {
    return [uno];
  }
  const m = texto.match(/^authors:[ \t]*\[([^\]]*)\]/m);
  return m
    ? m[1]
        .split(",")
        .map((a) => a.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean)
    : [];
}

const memoJar = new Map();

/** Nombre, versión, descripción y autores que declara el jar; `null` si no se puede leer. */
export async function leerDatosDeJar(ruta) {
  let manejador;
  try {
    // Primero se abre y se mide EL MISMO manejador: `stat` por ruta y `open` después dejaba una
    // ventana en la que el archivo podía cambiar entre la comprobación y el uso (CodeQL
    // js/file-system-race), y se leería con un tamaño que ya no es el del archivo abierto.
    manejador = await fs.open(ruta, "r");
    const st = await manejador.stat();
    const clave = `${ruta}:${st.size}:${st.mtimeMs}`;
    if (memoJar.has(clave)) {
      return memoJar.get(clave);
    }
    let datos = null;
    for (const nombre of ["plugin.yml", "paper-plugin.yml"]) {
      const bruto = await leerEntradaZip(manejador, st.size, nombre);
      if (!bruto) {
        continue;
      }
      const texto = bruto.toString("utf8");
      datos = {
        nombre: claveYml(texto, "name"),
        version: claveYml(texto, "version"),
        descripcion: claveYml(texto, "description"),
        autores: autoresYml(texto),
      };
      break;
    }
    memoJar.set(clave, datos);
    return datos;
  } catch {
    return null;
  } finally {
    await manejador?.close();
  }
}

/* ------------------------------------------------------------------ */
/* Listado                                                             */
/* ------------------------------------------------------------------ */

/** Nombres de plugin de la respuesta de `/plugins` (líneas con sangría, separados por comas). */
export function analizarPluginsCargados(texto) {
  const nombres = new Set();
  for (const linea of sinColores(texto).split("\n")) {
    if (!/^\s/.test(linea)) {
      continue;
    }
    for (const trozo of linea.replace(/^\s*-\s*/, "").split(",")) {
      const n = trozo.trim();
      if (/^[A-Za-z0-9_.-]{1,60}$/.test(n)) {
        nombres.add(n);
      }
    }
  }
  return nombres;
}

async function ymlsDe(carpeta) {
  try {
    const entradas = await fs.readdir(carpeta, { withFileTypes: true });
    return entradas
      .filter((e) => e.isFile() && /\.(yml|yaml)$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Plugins instalados con sus datos. `cargados` (Set de nombres, o null si RCON no contesta) decide
 * el estado: `activo`, `deshabilitado`, `pendiente-reinicio` o `sin-cargar`.
 */
/**
 * @param {{ dir?: string, cargados?: Set<string> | null }} [opciones]
 * @returns {Promise<any>}
 */
export async function listarPlugins({ dir, cargados = null } = {}) {
  const carpeta = path.join(baseDe(dir), "plugins");
  let nombres;
  try {
    nombres = await fs.readdir(carpeta);
  } catch {
    return { ok: false, plugins: [], legible: false };
  }
  const jars = nombres
    .filter((n) => /\.jar(\.disabled)?$/i.test(n))
    .sort((a, b) => a.localeCompare(b));
  const plugins = [];
  for (const archivo of jars) {
    const ruta = path.join(carpeta, archivo);
    const habilitado = !/\.disabled$/i.test(archivo);
    const [st, datos, legible] = await Promise.all([
      fs.stat(ruta),
      leerDatosDeJar(ruta),
      fs.access(ruta, fsConstants.R_OK).then(
        () => true,
        () => false,
      ),
    ]);
    const nombre = datos?.nombre || archivo.replace(/\.jar(\.disabled)?$/i, "");
    const estaCargado = cargados ? cargados.has(nombre) : null;
    let estado = habilitado ? "activo" : "deshabilitado";
    // Sin poder abrir el jar no se conoce el nombre real del plugin (el del archivo suele ser otro:
    // `vtuberdex-mc-pirates-0.1.0.jar` es «SanityCore»), así que compararlo con lo cargado daría
    // un «pendiente de reinicio» falso. Se dice lo que pasa: falta permiso de lectura.
    if (!legible) {
      estado = "sin-leer";
    } else if (estaCargado !== null) {
      if (habilitado && !estaCargado) {
        estado = "sin-cargar";
      }
      if (!habilitado && estaCargado) {
        estado = "pendiente-reinicio";
      }
    }
    plugins.push({
      archivo,
      nombre,
      version: datos?.version || "",
      descripcion: datos?.descripcion || "",
      autores: datos?.autores || [],
      bytes: st.size,
      modificado: st.mtime.toISOString(),
      habilitado,
      cargado: estaCargado,
      estado,
      legible,
      protegido: PROTEGIDO.test(nombre) || PROTEGIDO.test(archivo),
      configuraciones: (await ymlsDe(path.join(carpeta, nombre))).map(
        (f) => `${nombre}/${f}`,
      ),
    });
  }
  return { ok: true, plugins, legible: true };
}

/* ------------------------------------------------------------------ */
/* Habilitar / deshabilitar                                            */
/* ------------------------------------------------------------------ */

/** Renombra `X.jar` ↔ `X.jar.disabled`. Surte efecto al reiniciar el servidor. */
/** @param {{ archivo?: string, habilitado?: boolean, dir?: string }} [opciones] */
export async function cambiarEstadoPlugin({ archivo, habilitado, dir } = {}) {
  const nombre = String(archivo ?? "");
  if (
    path.basename(nombre) !== nombre ||
    !/^[\p{L}\p{N}][\p{L}\p{N} ._+()-]*\.jar(\.disabled)?$/iu.test(nombre)
  ) {
    return { ok: false, status: 400, cuerpo: { error: "archivo_invalido" } };
  }
  if (typeof habilitado !== "boolean") {
    return { ok: false, status: 400, cuerpo: { error: "estado_invalido" } };
  }
  if (PROTEGIDO.test(nombre)) {
    return {
      ok: false,
      status: 403,
      cuerpo: {
        error: "plugin_protegido",
        detail: "los plugins de VTuberDex no se apagan desde la web",
      },
    };
  }
  const carpeta = path.join(baseDe(dir), "plugins");
  const base = nombre.replace(/\.disabled$/i, "");
  const origen = path.join(carpeta, habilitado ? `${base}.disabled` : base);
  const destino = path.join(carpeta, habilitado ? base : `${base}.disabled`);
  try {
    await fs.access(origen);
  } catch {
    // Ya estaba en el estado pedido (o no existe): no es un error si el destino está.
    try {
      await fs.access(destino);
      return { ok: true, archivo: path.basename(destino), sinCambios: true };
    } catch {
      return { ok: false, status: 404, cuerpo: { error: "no_existe" } };
    }
  }
  await fs.rename(origen, destino);
  return { ok: true, archivo: path.basename(destino) };
}

/* ------------------------------------------------------------------ */
/* Registro                                                            */
/* ------------------------------------------------------------------ */

const COLA_MAXIMA = 512 * 1024;

/** Las IP de los jugadores salen en el registro de conexión: no se muestran en el panel. */
function sinIp(linea) {
  return linea.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[ip]");
}

/**
 * Últimas líneas de `logs/latest.log`. Con `plugin`, solo las que lleva `[Nombre]` (Paper
 * antepone el nombre del plugin) más las líneas de continuación (trazas de error) que las siguen.
 */
/**
 * @param {{ dir?: string, plugin?: string | null, lineas?: number | string }} [opciones]
 * @returns {Promise<any>}
 */
export async function leerRegistro({ dir, plugin, lineas = 200 } = {}) {
  const maximo = Math.min(Math.max(Math.trunc(Number(lineas)) || 200, 10), 500);
  const filtro = plugin == null || plugin === "" ? null : String(plugin);
  if (filtro !== null && !/^[A-Za-z0-9_.-]{1,60}$/.test(filtro)) {
    return { ok: false, status: 400, cuerpo: { error: "plugin_invalido" } };
  }
  let manejador;
  try {
    manejador = await fs.open(
      path.join(baseDe(dir), "logs", "latest.log"),
      "r",
    );
    const { size } = await manejador.stat();
    const largo = Math.min(size, COLA_MAXIMA);
    const buf = Buffer.alloc(largo);
    await manejador.read(buf, 0, largo, size - largo);
    // El dashboard consulta por RCON cada pocos segundos y cada consulta deja tres líneas de
    // «Thread RCON Client…»: taparían todo lo demás, así que no se muestran.
    let todas = sinColores(buf.toString("utf8"))
      .split("\n")
      .filter((l) => !/RCON (Client|Listener)/.test(l));
    if (size > largo) {
      todas = todas.slice(1); // la primera quedó cortada
    }
    const nueva = /^\[\d{2}:\d{2}:\d{2}/;
    let salida = todas;
    if (filtro) {
      const marca = `[${filtro}]`;
      salida = [];
      let dentro = false;
      for (const l of todas) {
        if (nueva.test(l)) {
          dentro = l.includes(marca);
        }
        if (dentro) {
          salida.push(l);
        }
      }
    }
    salida = salida
      .filter((l) => l.trim() !== "")
      .slice(-maximo)
      .map(sinIp);
    return { ok: true, plugin: filtro, lineas: salida };
  } catch {
    return {
      ok: false,
      status: 404,
      cuerpo: { error: "registro_no_disponible" },
    };
  } finally {
    await manejador?.close();
  }
}
