// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Cliente del agente de archivos y terminal (`minecraft-agente/agente.mjs`), para las rutas
 * `/api/minecraft-admin/fs` y `/api/minecraft-admin/terminal`.
 *
 * La web NO toca la carpeta del servidor para el explorador ni abre shells: autoriza (sesión y rol
 * del panel, `conMantenedor`), anota en la auditoría y pasa la petición al agente por su socket
 * UNIX con el token compartido. El agente corre como `minecraft` dentro de su propia caja.
 *
 * Entorno:
 * - `VTUBERDEX_MC_AGENTE_SOCKET`: ruta del socket (en la VPS `/run/vtuberdex-mc-agente/agente.sock`).
 * - `VTUBERDEX_MC_AGENTE_TOKEN`: el mismo `AGENTE_TOKEN` del agente (≥ 32 caracteres).
 * Sin las dos, las rutas responden 503 `agente_no_configurado`.
 */
import http from "node:http";
import { Readable } from "node:stream";

import { respuestaJson } from "./minecraft-admin.mjs";

export function configDelAgente(env = process.env) {
  const socket = env.VTUBERDEX_MC_AGENTE_SOCKET ?? "";
  const token = env.VTUBERDEX_MC_AGENTE_TOKEN ?? "";
  return socket && token.length >= 32 ? { socket, token } : null;
}

/**
 * Las peticiones que CAMBIAN algo (y abrir una terminal) deben traer `X-Panel: 1`. Un formulario o
 * un `fetch` de otro sitio no puede poner esa cabecera sin una consulta previa CORS que aquí nadie
 * contesta, así que esto cierra el CSRF aunque la cookie viajara.
 */
export function rechazoSinCabeceraDelPanel(request) {
  return request.headers.get("x-panel") === "1"
    ? null
    : respuestaJson({ error: "falta_cabecera_del_panel" }, 403);
}

/**
 * Hace una petición al agente. `cuerpo` puede ser `null`, un `Buffer`/cadena o un `ReadableStream`
 * web (se pasa en streaming, sin cargarlo en memoria). Devuelve `{ status, headers, flujo }` con
 * `flujo` como stream de Node, o lanza si el agente no responde.
 */
export function pedirAlAgente(
  { metodo = "GET", ruta, cuerpo = null, quien = "", cabeceras = {}, senal } = {},
  env = process.env,
) {
  const config = configDelAgente(env);
  if (!config) {
    const e = new Error("agente_no_configurado");
    e.codigo = "agente_no_configurado";
    return Promise.reject(e);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: config.socket,
        path: ruta,
        method: metodo,
        headers: {
          ...cabeceras,
          "x-agente-token": config.token,
          "x-agente-quien": quien,
        },
        signal: senal,
      },
      (res) => resolve({ status: res.statusCode ?? 502, headers: res.headers, flujo: res }),
    );
    req.on("error", reject);
    if (cuerpo === null || cuerpo === undefined) {
      req.end();
    } else if (typeof cuerpo === "string" || Buffer.isBuffer(cuerpo)) {
      req.end(cuerpo);
    } else {
      const origen = Readable.fromWeb(cuerpo);
      origen.on("error", (e) => req.destroy(e));
      origen.pipe(req);
    }
  });
}

async function leerTodo(flujo) {
  const trozos = [];
  for await (const t of flujo) {trozos.push(t);}
  return Buffer.concat(trozos).toString("utf8");
}

/** Pide al agente y devuelve su JSON con su código, o un 502/503 legible si no responde. */
export async function respuestaDelAgente(opciones, env = process.env) {
  try {
    const r = await pedirAlAgente(opciones, env);
    const texto = await leerTodo(r.flujo);
    let cuerpo;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = { error: "respuesta_invalida_del_agente" };
    }
    return { status: r.status, cuerpo };
  } catch (e) {
    return errorDeConexion(e);
  }
}

export function errorDeConexion(e) {
  if (e?.codigo === "agente_no_configurado") {
    return {
      status: 503,
      cuerpo: {
        error: "agente_no_configurado",
        detail: "falta VTUBERDEX_MC_AGENTE_SOCKET o VTUBERDEX_MC_AGENTE_TOKEN",
      },
    };
  }
  return {
    status: 502,
    cuerpo: {
      error: "agente_caido",
      detail: "el servicio vtuberdex-mc-agente no responde",
    },
  };
}

/** Une una ruta del agente con parámetros, omitiendo los vacíos. */
export function rutaConParametros(base, parametros) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) {
    if (v !== null && v !== undefined && v !== "") {q.set(k, String(v));}
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
