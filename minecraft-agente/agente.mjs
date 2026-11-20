// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Agente de archivos y terminal del servidor de Minecraft (`vtuberdex-mc-agente.service`).
 *
 * POR QUÉ UN PROCESO APARTE
 * -------------------------
 * El panel `/minecraft-admin` necesita un explorador de archivos completo y una terminal sobre
 * TODA la carpeta del servidor. La web no puede hacerlo ella misma:
 * - corre como `vtuberdex`, con `NoNewPrivileges`, sin capacidades y sin espacios de nombres:
 *   no puede cambiar de usuario ni montar una caja para la terminal;
 * - su entorno lleva los secretos de la web (Turso, correo, sesiones): una shell hija los heredaría;
 * - lo que escribe queda con dueño `vtuberdex`, no `minecraft`.
 * Este agente corre como `minecraft`, confinado por systemd a `/srv/minecraft`, y la web solo le
 * pasa las peticiones ya autorizadas (sesión y rol del panel) por un socket UNIX local.
 *
 * REGLAS
 * ------
 * 1. Toda petición lleva `X-Agente-Token` (comparación en tiempo constante). Sin token válido, 401.
 * 2. Toda ruta es RELATIVA a la raíz; se resuelve con `realpath` y debe quedar dentro. systemd
 *    impide además escribir fuera (`ProtectSystem=strict`, `ReadWritePaths=/srv/minecraft`).
 * 3. La terminal es bash dentro de bubblewrap: ve `/usr` (solo lectura), unos pocos archivos de
 *    `/etc` y `/srv/minecraft`; nada de `/home`, `/var`, `/run` ni los procesos de la máquina (PID
 *    propio). Entorno limpio: no hereda nada del agente, tampoco el token.
 * 4. Una terminal es de quien la abrió (`X-Agente-Quien`): otra persona no la lee ni le escribe.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export const LIMITE_TEXTO_BYTES = 5 * 1024 * 1024;
export const LIMITE_SUBIDA_BYTES = 1024 * 1024 * 1024;
const LIMITE_JSON_BYTES = 256 * 1024;
const SCROLLBACK_BYTES = 256 * 1024;
const SESIONES_POR_PERSONA = 4;
const SESIONES_TOTALES = 12;
const INACTIVA_MS = 30 * 60 * 1000;
const VIDA_MAXIMA_MS = 12 * 60 * 60 * 1000;

/** Archivos de `/etc` que la terminal necesita para que bash, java, curl y nano funcionen. */
const ETC_PARA_LA_TERMINAL = [
  "passwd",
  "group",
  "nsswitch.conf",
  "hosts",
  "host.conf",
  "gai.conf",
  "resolv.conf",
  "ssl",
  "ca-certificates",
  "alternatives",
  "ld.so.cache",
  "ld.so.conf",
  "ld.so.conf.d",
  "localtime",
  "timezone",
  "bash.bashrc",
  "bash_completion",
  "bash_completion.d",
  "profile",
  "profile.d",
  "inputrc",
  "terminfo",
  "environment",
  "java-21-openjdk",
  "java-25-openjdk",
  "mime.types",
  "magic",
  "magic.mime",
  "nanorc",
  "vim",
];

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

export function configDe(env = process.env) {
  return {
    raiz: path.resolve(env.AGENTE_RAIZ || "/srv/minecraft"),
    socket: env.AGENTE_SOCKET || "/run/vtuberdex-mc-agente/agente.sock",
    token: env.AGENTE_TOKEN || "",
    sandbox: env.AGENTE_SANDBOX === "ninguno" ? "ninguno" : "bwrap",
    shell: env.AGENTE_SHELL || "/bin/bash",
    python: env.AGENTE_PYTHON || "/usr/bin/python3",
  };
}

/* ------------------------------------------------------------------ */
/* Utilidades HTTP                                                     */
/* ------------------------------------------------------------------ */

class ErrorAgente extends Error {
  constructor(status, codigo, detalle) {
    super(detalle || codigo);
    this.status = status;
    this.codigo = codigo;
    this.detalle = detalle;
  }
}
const fallo = (status, codigo, detalle) =>
  new ErrorAgente(status, codigo, detalle);

function json(res, status, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(texto),
  });
  res.end(texto);
}

async function leerCuerpo(req, limite) {
  const trozos = [];
  let total = 0;
  for await (const trozo of req) {
    total += trozo.length;
    if (total > limite) {
      throw fallo(413, "demasiado_grande", `máximo ${limite} bytes`);
    }
    trozos.push(trozo);
  }
  return Buffer.concat(trozos);
}

async function leerJson(req) {
  const datos = await leerCuerpo(req, LIMITE_JSON_BYTES);
  try {
    const v = JSON.parse(datos.toString("utf8") || "{}");
    if (!v || typeof v !== "object") {throw new Error("no es objeto");}
    return v;
  } catch {
    throw fallo(400, "json_invalido");
  }
}

function tokenValido(recibido, esperado) {
  if (!esperado || esperado.length < 32) {return false;}
  const a = Buffer.from(String(recibido ?? ""));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Rutas dentro de la raíz                                             */
/* ------------------------------------------------------------------ */

const dentroDe = (raiz, ruta) => {
  const r = path.relative(raiz, ruta);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
};

/** Normaliza la ruta relativa que manda el panel ("" o "." = la raíz). */
export function normalizarRelativa(entrada) {
  const texto = String(entrada ?? "")
    .normalize("NFC")
    .replaceAll("\\", "/");
  if (texto.includes("\u0000")) {throw fallo(400, "ruta_invalida");}
  if (texto.length > 2000) {throw fallo(400, "ruta_invalida", "demasiado larga");}
  const limpia = path.posix.normalize(`/${texto}`).slice(1).replace(/\/$/, "");
  if (limpia.split("/").includes("..")) {throw fallo(400, "ruta_invalida");}
  return limpia === "." ? "" : limpia;
}

/**
 * Ruta absoluta de una relativa. Comprueba con `realpath` (del propio objetivo si existe y
 * `seguirEnlace`, si no de su carpeta) que no se sale de la raíz por un enlace simbólico.
 */
export async function resolver(
  raiz,
  entrada,
  { seguirEnlace = true, permitirRaiz = true } = {},
) {
  const relativa = normalizarRelativa(entrada);
  if (!relativa && !permitirRaiz) {
    throw fallo(400, "ruta_invalida", "no se puede sobre la raíz");
  }
  const absoluta = path.resolve(raiz, relativa);
  if (!dentroDe(raiz, absoluta)) {throw fallo(400, "ruta_invalida");}
  const raizReal = await fsp.realpath(raiz);
  let comprobar = absoluta;
  if (!seguirEnlace) {comprobar = path.dirname(absoluta);}
  // Se sube hasta el primer ancestro que existe: un archivo nuevo aún no tiene realpath.
  let real = null;
  for (let p = comprobar; ; p = path.dirname(p)) {
    real = await fsp.realpath(p).catch(() => null);
    if (real || p === raiz || p === path.dirname(p)) {break;}
  }
  if (!real || !dentroDe(raizReal, real)) {
    throw fallo(403, "fuera_de_la_carpeta", "el enlace apunta fuera");
  }
  return { relativa, absoluta };
}

const modoOctal = (modo) => (modo & 0o7777).toString(8).padStart(3, "0");

async function describir(absoluta, nombre) {
  const l = await fsp.lstat(absoluta);
  let tipo = l.isDirectory() ? "dir" : l.isFile() ? "archivo" : "otro";
  let destino;
  let apuntaADir = false;
  if (l.isSymbolicLink()) {
    tipo = "enlace";
    destino = await fsp.readlink(absoluta).catch(() => "");
    apuntaADir = await fsp
      .stat(absoluta)
      .then((s) => s.isDirectory())
      .catch(() => false);
  }
  return {
    nombre,
    tipo,
    bytes: l.size,
    modificado: l.mtimeMs,
    modo: modoOctal(l.mode),
    ...(destino !== undefined ? { destino, apuntaADir } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Archivos                                                            */
/* ------------------------------------------------------------------ */

async function listar(cfg, ruta) {
  const { relativa, absoluta } = await resolver(cfg.raiz, ruta);
  const st = await fsp.stat(absoluta).catch(() => null);
  if (!st) {throw fallo(404, "no_existe", relativa);}
  if (!st.isDirectory()) {throw fallo(400, "no_es_carpeta", relativa);}
  const nombres = await fsp.readdir(absoluta);
  const entradas = [];
  for (const nombre of nombres) {
    const e = await describir(path.join(absoluta, nombre), nombre).catch(
      () => null,
    );
    if (e) {entradas.push(e);}
  }
  const esCarpeta = (e) => e.tipo === "dir" || (e.tipo === "enlace" && e.apuntaADir);
  entradas.sort(
    (a, b) =>
      Number(esCarpeta(b)) - Number(esCarpeta(a)) ||
      a.nombre.localeCompare(b.nombre, "es", { numeric: true, sensitivity: "base" }),
  );
  return { ruta: relativa, entradas, modo: modoOctal(st.mode) };
}

const decodificador = new TextDecoder("utf-8", { fatal: true });

async function leer(cfg, ruta) {
  const { relativa, absoluta } = await resolver(cfg.raiz, ruta);
  const manejador = await fsp.open(absoluta, "r").catch(() => null);
  if (!manejador) {throw fallo(404, "no_existe", relativa);}
  try {
    const st = await manejador.stat();
    if (!st.isFile()) {throw fallo(400, "no_es_archivo", relativa);}
    const base = {
      ruta: relativa,
      bytes: st.size,
      modificado: st.mtimeMs,
      modo: modoOctal(st.mode),
    };
    if (st.size > LIMITE_TEXTO_BYTES) {
      return { ...base, demasiadoGrande: true, limite: LIMITE_TEXTO_BYTES };
    }
    const datos = await manejador.readFile();
    let contenido;
    try {
      if (datos.subarray(0, 8000).includes(0)) {throw new Error("binario");}
      contenido = decodificador.decode(datos);
    } catch {
      return { ...base, binario: true };
    }
    return { ...base, contenido };
  } finally {
    await manejador.close();
  }
}

/** Escribe por un temporal y `rename`: quien lea a la vez ve el archivo viejo o el nuevo, nunca uno a medias. */
async function escribirAtomico(absoluta, fuente, { modo } = {}) {
  await fsp.mkdir(path.dirname(absoluta), { recursive: true });
  const temporal = path.join(
    path.dirname(absoluta),
    `.${path.basename(absoluta)}.panel-${crypto.randomBytes(4).toString("hex")}`,
  );
  try {
    if (Buffer.isBuffer(fuente)) {
      await fsp.writeFile(temporal, fuente, { mode: 0o664 });
    } else {
      let total = 0;
      const salida = fs.createWriteStream(temporal, { mode: 0o664 });
      await pipeline(
        fuente,
        async function* (origen) {
          for await (const trozo of origen) {
            total += trozo.length;
            if (total > LIMITE_SUBIDA_BYTES) {
              throw fallo(413, "demasiado_grande", `máximo ${LIMITE_SUBIDA_BYTES} bytes`);
            }
            yield trozo;
          }
        },
        salida,
      );
    }
    if (modo !== undefined) {await fsp.chmod(temporal, modo);}
    await fsp.rename(temporal, absoluta);
  } catch (e) {
    await fsp.rm(temporal, { force: true }).catch(() => {});
    throw e;
  }
}

async function escribir(cfg, req, params) {
  const { relativa, absoluta } = await resolver(cfg.raiz, params.get("ruta"), {
    permitirRaiz: false,
  });
  const actual = await fsp.stat(absoluta).catch(() => null);
  if (actual && !actual.isFile()) {throw fallo(400, "no_es_archivo", relativa);}
  const esperado = params.get("modificado");
  if (
    actual &&
    esperado &&
    params.get("forzar") !== "1" &&
    Math.abs(actual.mtimeMs - Number(esperado)) > 1
  ) {
    // Alguien (otra persona, un plugin, la terminal) lo cambió desde que se abrió.
    throw fallo(409, "cambiado_en_disco", relativa);
  }
  const datos = await leerCuerpo(req, LIMITE_TEXTO_BYTES);
  await escribirAtomico(absoluta, datos, {
    modo: actual ? actual.mode & 0o7777 : undefined,
  });
  const st = await fsp.stat(absoluta);
  return { ok: true, ruta: relativa, bytes: st.size, modificado: st.mtimeMs };
}

async function subir(cfg, req, params) {
  const { relativa, absoluta } = await resolver(cfg.raiz, params.get("ruta"), {
    permitirRaiz: false,
  });
  const actual = await fsp.lstat(absoluta).catch(() => null);
  if (actual?.isDirectory()) {throw fallo(409, "es_carpeta", relativa);}
  if (actual && params.get("sobrescribir") !== "1") {
    req.resume();
    throw fallo(409, "ya_existe", relativa);
  }
  await escribirAtomico(absoluta, req);
  const st = await fsp.stat(absoluta);
  return { ok: true, ruta: relativa, bytes: st.size };
}

async function descargar(cfg, res, ruta) {
  const { relativa, absoluta } = await resolver(cfg.raiz, ruta);
  const st = await fsp.stat(absoluta).catch(() => null);
  if (!st) {throw fallo(404, "no_existe", relativa);}
  const nombre = path.basename(absoluta) || "minecraft";
  if (st.isFile()) {
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": st.size,
      "x-nombre": encodeURIComponent(nombre),
    });
    await pipeline(fs.createReadStream(absoluta), res);
    return;
  }
  if (!st.isDirectory()) {throw fallo(400, "no_descargable", relativa);}
  res.writeHead(200, {
    "content-type": "application/gzip",
    "x-nombre": encodeURIComponent(`${nombre}.tar.gz`),
  });
  const tar = spawn(
    "tar",
    ["-czf", "-", "-C", path.dirname(absoluta), "--", path.basename(absoluta)],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  res.on("close", () => tar.kill("SIGTERM"));
  await pipeline(tar.stdout, res).catch(() => {});
}

function ejecutar(comando, args, opciones = {}) {
  return new Promise((resolve) => {
    const hijo = spawn(comando, args, {
      ...opciones,
      stdio: ["ignore", "ignore", "pipe"],
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
    });
    let error = "";
    hijo.stderr.on("data", (d) => {
      if (error.length < 4000) {error += d.toString();}
    });
    hijo.on("error", (e) => resolve({ ok: false, error: e.message }));
    hijo.on("close", (codigo) =>
      resolve({ ok: codigo === 0, error: error.trim() }),
    );
  });
}

const MODO_VALIDO = /^[0-7]{3,4}$/;

async function cambiarModo(absoluta, modo, recursivo) {
  const l = await fsp.lstat(absoluta);
  if (l.isSymbolicLink()) {return;} // chmod seguiría el enlace
  await fsp.chmod(absoluta, modo);
  if (recursivo && l.isDirectory()) {
    for (const nombre of await fsp.readdir(absoluta)) {
      await cambiarModo(path.join(absoluta, nombre), modo, true);
    }
  }
}

const ARCHIVO_COMPRIMIDO = /\.(zip|jar|tar|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2)$/i;

async function accion(cfg, cuerpo) {
  const r = (ruta, opciones) => resolver(cfg.raiz, ruta, opciones);
  switch (cuerpo.accion) {
    case "carpeta": {
      const { relativa, absoluta } = await r(cuerpo.ruta, { permitirRaiz: false });
      if (await fsp.lstat(absoluta).catch(() => null)) {
        throw fallo(409, "ya_existe", relativa);
      }
      await fsp.mkdir(absoluta, { recursive: true });
      return { ok: true, ruta: relativa };
    }
    case "archivo": {
      const { relativa, absoluta } = await r(cuerpo.ruta, { permitirRaiz: false });
      await fsp.mkdir(path.dirname(absoluta), { recursive: true });
      const m = await fsp.open(absoluta, "wx", 0o664).catch((e) => {
        throw e.code === "EEXIST" ? fallo(409, "ya_existe", relativa) : e;
      });
      await m.close();
      return { ok: true, ruta: relativa };
    }
    case "mover":
    case "copiar": {
      const de = await r(cuerpo.de, { permitirRaiz: false, seguirEnlace: false });
      const a = await r(cuerpo.a, { permitirRaiz: false, seguirEnlace: false });
      if (!(await fsp.lstat(de.absoluta).catch(() => null))) {
        throw fallo(404, "no_existe", de.relativa);
      }
      if (a.absoluta === de.absoluta) {return { ok: true, ruta: a.relativa };}
      if (a.absoluta.startsWith(`${de.absoluta}${path.sep}`)) {
        throw fallo(400, "dentro_de_si_misma", "no se puede meter una carpeta dentro de sí misma");
      }
      if ((await fsp.lstat(a.absoluta).catch(() => null)) && !cuerpo.sobrescribir) {
        throw fallo(409, "ya_existe", a.relativa);
      }
      await fsp.mkdir(path.dirname(a.absoluta), { recursive: true });
      if (cuerpo.accion === "mover") {
        if (cuerpo.sobrescribir) {await fsp.rm(a.absoluta, { recursive: true, force: true });}
        await fsp.rename(de.absoluta, a.absoluta);
      } else {
        await fsp.cp(de.absoluta, a.absoluta, {
          recursive: true,
          force: Boolean(cuerpo.sobrescribir),
          errorOnExist: !cuerpo.sobrescribir,
          verbatimSymlinks: true,
          preserveTimestamps: true,
        });
      }
      return { ok: true, ruta: a.relativa };
    }
    case "borrar": {
      const rutas = Array.isArray(cuerpo.rutas) ? cuerpo.rutas : [cuerpo.ruta];
      if (!rutas.length || rutas.length > 500) {throw fallo(400, "rutas_invalidas");}
      const borradas = [];
      for (const ruta of rutas) {
        // Un enlace se borra a sí mismo, no a lo que apunta: basta con que su carpeta esté dentro.
        const { relativa, absoluta } = await r(ruta, {
          permitirRaiz: false,
          seguirEnlace: false,
        });
        await fsp.rm(absoluta, { recursive: true, force: false });
        borradas.push(relativa);
      }
      return { ok: true, borradas };
    }
    case "permisos": {
      const modo = String(cuerpo.modo ?? "");
      if (!MODO_VALIDO.test(modo)) {throw fallo(400, "modo_invalido", "ej. 644 o 755");}
      const { relativa, absoluta } = await r(cuerpo.ruta);
      await cambiarModo(absoluta, Number.parseInt(modo, 8), Boolean(cuerpo.recursivo));
      return { ok: true, ruta: relativa, modo: modo.padStart(3, "0") };
    }
    case "descomprimir": {
      const archivo = await r(cuerpo.ruta, { permitirRaiz: false });
      if (!ARCHIVO_COMPRIMIDO.test(archivo.absoluta)) {
        throw fallo(400, "no_es_comprimido", "zip, jar, tar, tar.gz, tar.xz o tar.bz2");
      }
      const destino = await r(cuerpo.destino ?? path.posix.dirname(archivo.relativa));
      await fsp.mkdir(destino.absoluta, { recursive: true });
      // zip/jar con el zipfile de Python: limpia `..` y rutas absolutas y no crea enlaces.
      // tar: GNU tar quita la `/` inicial, rechaza `..` y difiere los enlaces simbólicos.
      const resultado = /\.(zip|jar)$/i.test(archivo.absoluta)
        ? await ejecutar(cfg.python, [
            "-I",
            "-c",
            "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
            archivo.absoluta,
            destino.absoluta,
          ])
        : await ejecutar("tar", [
            "-xf",
            archivo.absoluta,
            "-C",
            destino.absoluta,
            "--no-same-owner",
            "--no-overwrite-dir",
          ]);
      if (!resultado.ok) {throw fallo(400, "no_se_pudo_descomprimir", resultado.error);}
      return { ok: true, destino: destino.relativa };
    }
    case "comprimir": {
      const rutas = Array.isArray(cuerpo.rutas) ? cuerpo.rutas : [];
      if (!rutas.length || rutas.length > 500) {throw fallo(400, "rutas_invalidas");}
      const resueltas = [];
      for (const ruta of rutas) {resueltas.push(await r(ruta, { permitirRaiz: false }));}
      const carpeta = path.dirname(resueltas[0].absoluta);
      if (resueltas.some((x) => path.dirname(x.absoluta) !== carpeta)) {
        throw fallo(400, "rutas_invalidas", "todo debe estar en la misma carpeta");
      }
      const destino = await r(cuerpo.destino, { permitirRaiz: false });
      if (!/\.zip$/i.test(destino.absoluta)) {throw fallo(400, "destino_invalido", "debe terminar en .zip");}
      if (await fsp.lstat(destino.absoluta).catch(() => null)) {
        throw fallo(409, "ya_existe", destino.relativa);
      }
      const resultado = await ejecutar(
        "zip",
        ["-r", "-q", "-y", destino.absoluta, "--", ...resueltas.map((x) => path.basename(x.absoluta))],
        { cwd: carpeta },
      );
      if (!resultado.ok) {throw fallo(400, "no_se_pudo_comprimir", resultado.error);}
      return { ok: true, ruta: destino.relativa };
    }
    case "info": {
      const { relativa, absoluta } = await r(cuerpo.ruta);
      return { ok: true, ruta: relativa, ...(await describir(absoluta, path.basename(absoluta))) };
    }
    default:
      throw fallo(400, "accion_desconocida");
  }
}

/* ------------------------------------------------------------------ */
/* Terminal                                                            */
/* ------------------------------------------------------------------ */

const sesiones = new Map();

/** El comando que abre la shell: dentro de bubblewrap salvo en pruebas. */
export function comandoDeShell(cfg) {
  const entorno = {
    HOME: cfg.raiz,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    SHELL: cfg.shell,
    USER: "minecraft",
    LOGNAME: "minecraft",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    PS1: "\\[\\e[38;5;114m\\]minecraft\\[\\e[0m\\]:\\[\\e[38;5;75m\\]\\w\\[\\e[0m\\]\\$ ",
  };
  if (cfg.sandbox === "ninguno") {
    return { comando: [cfg.shell, "--login"], entorno, cwd: cfg.raiz };
  }
  const args = [
    "--die-with-parent",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup-try",
    "--hostname",
    "minecraft",
    "--clearenv",
    "--ro-bind",
    "/usr",
    "/usr",
    "--symlink",
    "usr/bin",
    "/bin",
    "--symlink",
    "usr/sbin",
    "/sbin",
    "--symlink",
    "usr/lib",
    "/lib",
    "--symlink",
    "usr/lib64",
    "/lib64",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/run",
    "--ro-bind-try",
    "/run/systemd/resolve",
    "/run/systemd/resolve",
  ];
  for (const nombre of ETC_PARA_LA_TERMINAL) {
    args.push("--ro-bind-try", `/etc/${nombre}`, `/etc/${nombre}`);
  }
  args.push("--bind", cfg.raiz, cfg.raiz, "--chdir", cfg.raiz);
  for (const [k, v] of Object.entries(entorno)) {args.push("--setenv", k, v);}
  args.push("--", cfg.shell, "--login");
  return { comando: ["/usr/bin/bwrap", ...args], entorno: { PATH: entorno.PATH }, cwd: cfg.raiz };
}

const trama = (tipo, datos) => {
  const cabecera = Buffer.alloc(5);
  cabecera[0] = tipo;
  cabecera.writeUInt32BE(datos.length, 1);
  return Buffer.concat([cabecera, datos]);
};

const acotar = (n, min, max, defecto) => {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defecto;
};

function abrirTerminal(cfg, quien, { filas, columnas, titulo } = {}) {
  const propias = [...sesiones.values()].filter((s) => s.quien === quien && !s.terminada);
  if (propias.length >= SESIONES_POR_PERSONA) {
    throw fallo(429, "demasiadas_terminales", `máximo ${SESIONES_POR_PERSONA} por persona`);
  }
  if ([...sesiones.values()].filter((s) => !s.terminada).length >= SESIONES_TOTALES) {
    throw fallo(429, "demasiadas_terminales", "el servidor tiene demasiadas abiertas");
  }
  const f = acotar(filas, 2, 500, 24);
  const c = acotar(columnas, 10, 1000, 80);
  const { comando, entorno, cwd } = comandoDeShell(cfg);
  const proc = spawn(
    cfg.python,
    ["-I", path.join(AQUI, "pty-puente.py"), String(f), String(c), "--", ...comando],
    { cwd, env: entorno, stdio: ["pipe", "pipe", "pipe"] },
  );
  const id = crypto.randomBytes(12).toString("base64url");
  const sesion = {
    id,
    quien,
    titulo: String(titulo ?? "").slice(0, 60) || "bash",
    proc,
    trozos: [],
    bytes: 0,
    oyentes: new Set(),
    creada: Date.now(),
    usada: Date.now(),
    terminada: false,
    codigo: null,
  };
  const emitir = (datos) => {
    sesion.trozos.push(datos);
    sesion.bytes += datos.length;
    while (sesion.bytes > SCROLLBACK_BYTES && sesion.trozos.length > 1) {
      sesion.bytes -= sesion.trozos.shift().length;
    }
    for (const res of sesion.oyentes) {res.write(datos);}
  };
  proc.stdout.on("data", emitir);
  proc.stderr.on("data", emitir);
  proc.stdin.on("error", () => {});
  proc.on("error", (e) => emitir(Buffer.from(`\r\n[agente] no se pudo abrir: ${e.message}\r\n`)));
  proc.on("close", (codigo) => {
    sesion.terminada = true;
    sesion.codigo = codigo;
    emitir(Buffer.from(`\r\n\x1b[2m[sesión terminada${codigo ? `, código ${codigo}` : ""}]\x1b[0m\r\n`));
    for (const res of sesion.oyentes) {res.end();}
    sesion.oyentes.clear();
    // Se guarda un rato para que el panel vea el final; luego se olvida.
    setTimeout(() => sesiones.delete(id), 60_000).unref();
  });
  sesiones.set(id, sesion);
  console.log(`[agente] terminal ${id} abierta por ${quien}`);
  return sesion;
}

/**
 * Registro de lo tecleado, por línea, en el journal del servicio (`journalctl -u
 * vtuberdex-mc-agente`). Va ahí y no a la carpeta del servidor porque quien usa la terminal
 * puede escribir en esa carpeta y borraría su propio rastro.
 */
function anotarTecleado(s, datos) {
  s.linea = (s.linea ?? "") + datos.toString("utf8");
  const partes = s.linea.split(/\r|\n/);
  s.linea = partes.pop() ?? "";
  if (s.linea.length > 2000) {
    partes.push(s.linea);
    s.linea = "";
  }
  for (const linea of partes) {
    if (linea.trim()) {
      console.log(`[agente] ${s.quien} ${s.id} $ ${JSON.stringify(linea.slice(0, 500))}`);
    }
  }
}

function sesionDe(id, quien) {
  const s = sesiones.get(String(id));
  if (!s || s.quien !== quien) {throw fallo(404, "terminal_no_existe");}
  return s;
}

const resumen = (s) => ({
  id: s.id,
  titulo: s.titulo,
  creada: s.creada,
  terminada: s.terminada,
  codigo: s.codigo,
});

function cerrarTerminal(s) {
  if (s.terminada) {return;}
  try {
    s.proc.stdin.end();
  } catch {
    /* ya cerrada */
  }
  setTimeout(() => {
    if (!s.terminada) {s.proc.kill("SIGKILL");}
  }, 3000).unref();
}

function barrerTerminales() {
  const ahora = Date.now();
  for (const s of sesiones.values()) {
    const inactiva = s.oyentes.size === 0 && ahora - s.usada > INACTIVA_MS;
    if (!s.terminada && (inactiva || ahora - s.creada > VIDA_MAXIMA_MS)) {
      console.log(`[agente] terminal ${s.id} cerrada por inactividad`);
      cerrarTerminal(s);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Enrutado                                                            */
/* ------------------------------------------------------------------ */

export function crearServidor(cfg) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://agente");
    const params = url.searchParams;
    const quien = String(req.headers["x-agente-quien"] ?? "").slice(0, 200);
    try {
      if (!tokenValido(req.headers["x-agente-token"], cfg.token)) {
        req.resume();
        return json(res, 401, { error: "sin_token" });
      }
      const ruta = url.pathname;
      const metodo = req.method;

      if (ruta === "/salud") {return json(res, 200, { ok: true, raiz: cfg.raiz });}
      if (ruta === "/fs/listar" && metodo === "GET") {return json(res, 200, await listar(cfg, params.get("ruta")));}
      if (ruta === "/fs/leer" && metodo === "GET") {return json(res, 200, await leer(cfg, params.get("ruta")));}
      if (ruta === "/fs/descargar" && metodo === "GET") {return await descargar(cfg, res, params.get("ruta"));}
      if (ruta === "/fs/escribir" && metodo === "PUT") {return json(res, 200, await escribir(cfg, req, params));}
      if (ruta === "/fs/subir" && metodo === "POST") {return json(res, 201, await subir(cfg, req, params));}
      if (ruta === "/fs/accion" && metodo === "POST") {return json(res, 200, await accion(cfg, await leerJson(req)));}

      if (!quien) {throw fallo(400, "falta_quien");}
      if (ruta === "/term" && metodo === "GET") {
        const propias = [...sesiones.values()].filter((s) => s.quien === quien);
        return json(res, 200, { terminales: propias.map(resumen) });
      }
      if (ruta === "/term" && metodo === "POST") {
        const cuerpo = await leerJson(req);
        return json(res, 201, resumen(abrirTerminal(cfg, quien, cuerpo)));
      }
      const m = /^\/term\/([\w-]{8,40})(?:\/(salida|entrada|tamano))?$/.exec(ruta);
      if (m) {
        const s = sesionDe(m[1], quien);
        if (!m[2] && metodo === "DELETE") {
          cerrarTerminal(s);
          return json(res, 200, { ok: true });
        }
        if (m[2] === "salida" && metodo === "GET") {
          res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
          for (const t of s.trozos) {res.write(t);}
          if (s.terminada) {return res.end();}
          s.oyentes.add(res);
          s.usada = Date.now();
          res.on("close", () => {
            s.oyentes.delete(res);
            s.usada = Date.now();
          });
          return undefined;
        }
        if (m[2] === "entrada" && metodo === "POST") {
          const datos = await leerCuerpo(req, 64 * 1024);
          if (s.terminada) {throw fallo(410, "terminal_terminada");}
          s.usada = Date.now();
          anotarTecleado(s, datos);
          s.proc.stdin.write(trama(0, datos));
          return json(res, 200, { ok: true });
        }
        if (m[2] === "tamano" && metodo === "POST") {
          const cuerpo = await leerJson(req);
          const t = Buffer.alloc(4);
          t.writeUInt16BE(acotar(cuerpo.filas, 2, 500, 24), 0);
          t.writeUInt16BE(acotar(cuerpo.columnas, 10, 1000, 80), 2);
          if (!s.terminada) {s.proc.stdin.write(trama(1, t));}
          return json(res, 200, { ok: true });
        }
      }
      req.resume();
      return json(res, 404, { error: "no_existe_la_ruta" });
    } catch (e) {
      req.resume();
      if (res.headersSent) {
        res.destroy();
        return undefined;
      }
      if (e instanceof ErrorAgente) {
        return json(res, e.status, e.detalle ? { error: e.codigo, detail: e.detalle } : { error: e.codigo });
      }
      const conocidos = {
        ENOENT: [404, "no_existe"],
        EEXIST: [409, "ya_existe"],
        ENOTEMPTY: [409, "carpeta_no_vacia"],
        EACCES: [403, "sin_permiso"],
        EPERM: [403, "sin_permiso"],
        EROFS: [403, "solo_lectura"],
        ENOTDIR: [400, "no_es_carpeta"],
        EISDIR: [400, "es_carpeta"],
        ENOSPC: [507, "disco_lleno"],
        EXDEV: [400, "otro_disco"],
      };
      const c = conocidos[e?.code];
      if (c) {return json(res, c[0], { error: c[1], detail: e.message });}
      console.error("[agente] error:", e);
      return json(res, 500, { error: "error_del_agente" });
    }
  });
}

export async function arrancar(env = process.env) {
  const cfg = configDe(env);
  if (cfg.token.length < 32) {
    console.error("[agente] AGENTE_TOKEN falta o es corto (mínimo 32)");
    process.exit(1);
  }
  await fsp.rm(cfg.socket, { force: true });
  await fsp.mkdir(path.dirname(cfg.socket), { recursive: true });
  const servidor = crearServidor(cfg);
  servidor.requestTimeout = 0; // las subidas grandes y la salida de la terminal duran lo que duran
  await new Promise((resolve) => servidor.listen(cfg.socket, resolve));
  // El socket lo abre la web (otro usuario); lo que protege es el token, no el modo.
  await fsp.chmod(cfg.socket, 0o666);
  setInterval(barrerTerminales, 60_000).unref();
  const salir = () => {
    for (const s of sesiones.values()) {cerrarTerminal(s);}
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on("SIGTERM", salir);
  process.on("SIGINT", salir);
  console.log(`[agente] escuchando en ${cfg.socket}, raíz ${cfg.raiz}, caja ${cfg.sandbox}`);
  return servidor;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await arrancar();
}
