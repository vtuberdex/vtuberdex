// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `/api/minecraft-admin/fs` — explorador completo de la carpeta del servidor (pestaña «Archivos»).
 *
 * - `GET ?op=listar&ruta=`    una carpeta (`""` = la raíz del servidor).
 * - `GET ?op=leer&ruta=`      texto de un archivo (hasta 5 MB; binarios y grandes se descargan).
 * - `GET ?op=descargar&ruta=` el archivo tal cual, o la carpeta como `.tar.gz`.
 * - `PUT ?ruta=&modificado=`  guarda texto; 409 `cambiado_en_disco` si cambió desde que se abrió.
 * - `POST ?op=subir&ruta=`    sube un archivo (cuerpo crudo, hasta 1 GB) creando las carpetas.
 * - `POST` con JSON           acciones: carpeta, archivo, mover, copiar, borrar, permisos,
 *                             descomprimir, comprimir, info.
 *
 * Admin y mantenedor tienen el mismo alcance (decidido con el dueño del servidor el 2026-11-20).
 * Lo hace el agente `vtuberdex-mc-agente` como usuario `minecraft`; aquí se autoriza, se exige
 * `X-Panel: 1` en lo que cambia algo y se anota cada cambio en la auditoría.
 */
import { Readable } from "node:stream";

import {
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import {
  errorDeConexion,
  pedirAlAgente,
  rechazoSinCabeceraDelPanel,
  respuestaDelAgente,
  rutaConParametros,
} from "../../../../lib/minecraft-agente.mjs";
import { anotarAuditoria } from "../../../../lib/minecraft-consola.mjs";

export const dynamic = "force-dynamic";

const OPERACIONES_GET = new Set(["listar", "leer", "descargar"]);

const anotar = (acceso, tipo, detalle, ok) =>
  anotarAuditoria({
    quien: acceso.sesion.email,
    rol: acceso.sesion.role,
    tipo,
    detalle,
    ok,
  });

export async function GET(request) {
  return conMantenedor(request, async (acceso) => {
    const params = new URL(request.url).searchParams;
    const op = params.get("op") ?? "listar";
    if (!OPERACIONES_GET.has(op)) {
      return respuestaJson({ error: "operacion_invalida" }, 400);
    }
    const ruta = rutaConParametros(`/fs/${op}`, { ruta: params.get("ruta") ?? "" });
    if (op !== "descargar") {
      const r = await respuestaDelAgente({ ruta, quien: acceso.sesion.email });
      return respuestaJson(r.cuerpo, r.status);
    }
    try {
      const r = await pedirAlAgente({ ruta, quien: acceso.sesion.email });
      if (r.status !== 200) {
        const trozos = [];
        for await (const t of r.flujo) {trozos.push(t);}
        const cuerpo = JSON.parse(Buffer.concat(trozos).toString("utf8") || "{}");
        return respuestaJson(cuerpo, r.status);
      }
      await anotar(acceso, "archivo-descargado", params.get("ruta") ?? "", true);
      const nombre = decodeURIComponent(String(r.headers["x-nombre"] ?? "archivo"));
      const cabeceras = {
        "content-type": String(r.headers["content-type"] ?? "application/octet-stream"),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      };
      if (r.headers["content-length"]) {
        cabeceras["content-length"] = String(r.headers["content-length"]);
      }
      const flujo = /** @type {ReadableStream} */ (
        /** @type {unknown} */ (Readable.toWeb(r.flujo))
      );
      return new Response(flujo, { headers: cabeceras });
    } catch (e) {
      const r = errorDeConexion(e);
      return respuestaJson(r.cuerpo, r.status);
    }
  });
}

export async function PUT(request) {
  return conMantenedor(request, async (acceso) => {
    const sinCabecera = rechazoSinCabeceraDelPanel(request);
    if (sinCabecera) {return sinCabecera;}
    const params = new URL(request.url).searchParams;
    const r = await respuestaDelAgente({
      metodo: "PUT",
      ruta: rutaConParametros("/fs/escribir", {
        ruta: params.get("ruta"),
        modificado: params.get("modificado"),
        forzar: params.get("forzar"),
      }),
      cuerpo: request.body ?? "",
      quien: acceso.sesion.email,
    });
    await anotar(acceso, "archivo-guardado", params.get("ruta") ?? "", r.status === 200);
    return respuestaJson(r.cuerpo, r.status);
  });
}

export async function POST(request) {
  return conMantenedor(request, async (acceso) => {
    const sinCabecera = rechazoSinCabeceraDelPanel(request);
    if (sinCabecera) {return sinCabecera;}
    const params = new URL(request.url).searchParams;

    if (params.get("op") === "subir") {
      const largo = request.headers.get("content-length");
      const r = await respuestaDelAgente({
        metodo: "POST",
        ruta: rutaConParametros("/fs/subir", {
          ruta: params.get("ruta"),
          sobrescribir: params.get("sobrescribir"),
        }),
        cuerpo: request.body ?? "",
        cabeceras: largo ? { "content-length": largo } : {},
        quien: acceso.sesion.email,
      });
      await anotar(
        acceso,
        "archivo-subido",
        `${params.get("ruta") ?? ""}${largo ? ` (${largo} bytes)` : ""}`,
        r.status === 201,
      );
      return respuestaJson(r.cuerpo, r.status);
    }

    const cuerpo = await request.json().catch(() => null);
    if (!cuerpo || typeof cuerpo !== "object" || typeof cuerpo.accion !== "string") {
      return respuestaJson({ error: "cuerpo_invalido" }, 400);
    }
    const texto = JSON.stringify(cuerpo);
    const r = await respuestaDelAgente({
      metodo: "POST",
      ruta: "/fs/accion",
      cuerpo: texto,
      cabeceras: { "content-type": "application/json" },
      quien: acceso.sesion.email,
    });
    if (cuerpo.accion !== "info") {
      const detalle = [cuerpo.ruta, cuerpo.de, cuerpo.a, cuerpo.destino, cuerpo.modo]
        .concat(Array.isArray(cuerpo.rutas) ? cuerpo.rutas.slice(0, 20) : [])
        .filter((v) => typeof v === "string" && v)
        .join(" → ");
      await anotar(acceso, `archivo-${cuerpo.accion}`, detalle, r.status === 200);
    }
    return respuestaJson(r.cuerpo, r.status);
  });
}
