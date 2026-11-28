// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Llamadas de la pestaña «Archivos» a `/api/minecraft-admin/fs`, `/terminal` y `/plugins`.
 * Las que cambian algo llevan `X-Panel: 1` (la API la exige: cierra el CSRF). Todas lanzan
 * `Error` con el mensaje del servidor para que la vista solo tenga que pintarlo.
 */

export type Entrada = {
  nombre: string;
  tipo: "dir" | "archivo" | "enlace" | "otro";
  bytes: number;
  modificado: number;
  modo: string;
  destino?: string;
  apuntaADir?: boolean;
};

export type Lectura = {
  ruta: string;
  bytes: number;
  modificado: number;
  modo: string;
  contenido?: string;
  binario?: boolean;
  demasiadoGrande?: boolean;
};

export type Plugin = {
  archivo: string;
  nombre: string;
  version: string;
  descripcion: string;
  autores: string[];
  bytes: number;
  habilitado: boolean;
  cargado: boolean | null;
  estado: "activo" | "deshabilitado" | "pendiente-reinicio" | "sin-cargar" | "sin-leer";
  protegido: boolean;
};

export type Terminal = {
  id: string;
  titulo: string;
  creada: number;
  terminada: boolean;
};

const PANEL = { "x-panel": "1" };

const MENSAJES: Record<string, string> = {
  agente_no_configurado: "El agente de archivos no está configurado en el servidor",
  agente_caido: "El agente de archivos no responde (servicio vtuberdex-mc-agente)",
  ya_existe: "Ya existe",
  no_existe: "No existe",
  cambiado_en_disco: "El archivo cambió en el disco desde que lo abriste",
  fuera_de_la_carpeta: "Esa ruta sale de la carpeta del servidor",
  sin_permiso: "Sin permiso",
  carpeta_no_vacia: "La carpeta no está vacía",
  dentro_de_si_misma: "No se puede mover una carpeta dentro de sí misma",
  demasiadas_terminales: "Hay demasiadas terminales abiertas",
  sin_sesion: "La sesión caducó: vuelve a entrar",
  modo_invalido: "Permisos no válidos (ej. 644 o 755)",
};

export class ErrorApi extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

async function comprobar(r: Response) {
  if (r.ok) {return r;}
  const c = (await r.json().catch(() => null)) as {
    error?: string;
    detail?: string;
  } | null;
  const codigo = c?.error ?? `http_${r.status}`;
  const base = MENSAJES[codigo] ?? codigo.replaceAll("_", " ");
  throw new ErrorApi(r.status, codigo, c?.detail ? `${base}: ${c.detail}` : base);
}

const q = (p: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== false && v !== "") {s.set(k, String(v === true ? 1 : v));}
  }
  return s.toString();
};

const FS = "/api/minecraft-admin/fs";

export async function listar(ruta: string) {
  const r = await comprobar(await fetch(`${FS}?${q({ op: "listar", ruta })}`, { cache: "no-store" }));
  return (await r.json()) as { ruta: string; entradas: Entrada[]; modo: string };
}

export async function leer(ruta: string) {
  const r = await comprobar(await fetch(`${FS}?${q({ op: "leer", ruta })}`, { cache: "no-store" }));
  return (await r.json()) as Lectura;
}

export const urlDeDescarga = (ruta: string) => `${FS}?${q({ op: "descargar", ruta })}`;

export async function guardar(ruta: string, contenido: string, modificado?: number, forzar = false) {
  const r = await comprobar(
    await fetch(`${FS}?${q({ ruta, modificado, forzar })}`, {
      method: "PUT",
      headers: { ...PANEL, "content-type": "text/plain; charset=utf-8" },
      body: contenido,
    }),
  );
  return (await r.json()) as { bytes: number; modificado: number };
}

export async function subir(ruta: string, archivo: Blob, sobrescribir = false) {
  await comprobar(
    await fetch(`${FS}?${q({ op: "subir", ruta, sobrescribir })}`, {
      method: "POST",
      headers: { ...PANEL, "content-type": "application/octet-stream" },
      body: archivo,
    }),
  );
}

export async function accion<T = Record<string, unknown>>(cuerpo: Record<string, unknown>) {
  const r = await comprobar(
    await fetch(FS, {
      method: "POST",
      headers: { ...PANEL, "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    }),
  );
  return (await r.json()) as T;
}

export async function listarPlugins() {
  const r = await comprobar(await fetch("/api/minecraft-admin/plugins", { cache: "no-store" }));
  return ((await r.json()) as { plugins?: Plugin[] }).plugins ?? [];
}

export async function cambiarPlugin(archivo: string, habilitado: boolean) {
  await comprobar(
    await fetch("/api/minecraft-admin/plugins/estado", {
      method: "POST",
      headers: { ...PANEL, "content-type": "application/json" },
      body: JSON.stringify({ archivo, habilitado }),
    }),
  );
}

export async function registroDePlugin(plugin: string) {
  const r = await comprobar(
    await fetch(`/api/minecraft-admin/registros?${q({ plugin, lineas: 200 })}`, { cache: "no-store" }),
  );
  return ((await r.json()) as { lineas?: string[] }).lineas ?? [];
}

const TERM = "/api/minecraft-admin/terminal";

export async function listarTerminales() {
  const r = await comprobar(await fetch(TERM, { cache: "no-store" }));
  return ((await r.json()) as { terminales: Terminal[] }).terminales;
}

export async function abrirTerminal(filas: number, columnas: number, titulo?: string) {
  const r = await comprobar(
    await fetch(TERM, {
      method: "POST",
      headers: { ...PANEL, "content-type": "application/json" },
      body: JSON.stringify({ filas, columnas, titulo }),
    }),
  );
  return (await r.json()) as Terminal;
}

export async function escribirEnTerminal(id: string, datos: string) {
  await comprobar(
    await fetch(`${TERM}/${id}?op=entrada`, {
      method: "POST",
      headers: { ...PANEL, "content-type": "application/octet-stream" },
      body: new TextEncoder().encode(datos),
    }),
  );
}

export async function redimensionarTerminal(id: string, filas: number, columnas: number) {
  await fetch(`${TERM}/${id}?op=tamano`, {
    method: "POST",
    headers: { ...PANEL, "content-type": "application/json" },
    body: JSON.stringify({ filas, columnas }),
  }).catch(() => {});
}

export async function cerrarTerminal(id: string) {
  await fetch(`${TERM}/${id}`, { method: "DELETE", headers: PANEL }).catch(() => {});
}

export const urlDeSalida = (id: string) => `${TERM}/${id}`;

/* Utilidades de rutas */
export const unir = (carpeta: string, nombre: string) => (carpeta ? `${carpeta}/${nombre}` : nombre);
export const padre = (ruta: string) => (ruta.includes("/") ? ruta.slice(0, ruta.lastIndexOf("/")) : "");
export const nombreDe = (ruta: string) => ruta.slice(ruta.lastIndexOf("/") + 1);

export function tamanoLegible(bytes: number) {
  if (bytes < 1024) {return `${bytes} B`;}
  const u = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

/** Lenguaje de Monaco según la extensión. */
export function lenguajeDe(ruta: string) {
  const n = nombreDe(ruta).toLowerCase();
  const ext = n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : "";
  const mapa: Record<string, string> = {
    yml: "yaml",
    yaml: "yaml",
    json: "json",
    mcmeta: "json",
    bbmodel: "json",
    js: "javascript",
    mjs: "javascript",
    ts: "typescript",
    sh: "shell",
    bash: "shell",
    properties: "ini",
    conf: "ini",
    cfg: "ini",
    ini: "ini",
    toml: "ini",
    md: "markdown",
    xml: "xml",
    html: "html",
    css: "css",
    java: "java",
    kt: "kotlin",
    py: "python",
    sql: "sql",
    fsh: "c",
    vsh: "c",
    glsl: "c",
    sk: "python",
    lua: "lua",
  };
  if (n === "dockerfile") {return "dockerfile";}
  return mapa[ext] ?? "plaintext";
}

export const esComprimido = (nombre: string) =>
  /\.(zip|tar|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2)$/i.test(nombre);
export const esJar = (nombre: string) => /\.jar(\.disabled)?$/i.test(nombre);

/* Consola del servidor de Minecraft (pestaña fija del panel de abajo). */

/** Cola de `logs/latest.log` (las IP ya vienen ocultas y sin las líneas del RCON del dashboard). */
export async function colaDelServidor(lineas = 300) {
  const r = await comprobar(
    await fetch(`/api/minecraft-admin/registros?${q({ lineas })}`, { cache: "no-store" }),
  );
  return ((await r.json()) as { lineas?: string[] }).lineas ?? [];
}

/** Un comando por RCON. El servidor decide qué puede cada rol; la respuesta es el texto del servidor. */
export async function comandoDelServidor(comando: string) {
  const r = await comprobar(
    await fetch("/api/minecraft-admin/consola", {
      method: "POST",
      headers: { ...PANEL, "content-type": "application/json" },
      body: JSON.stringify({ comando }),
    }),
  );
  return ((await r.json()) as { respuesta?: string }).respuesta ?? "";
}
