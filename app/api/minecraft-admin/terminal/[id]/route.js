// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `/api/minecraft-admin/terminal/[id]` — una terminal abierta.
 *
 * - `GET`  la salida como Server-Sent Events: primero lo que ya había (hasta 256 KB) y luego en
 *   vivo. Cada evento lleva los bytes en base64 (la salida no tiene por qué ser UTF-8 completo
 *   en cada trozo). Al cerrarse la shell llega `event: fin`. Un comentario cada 15 s mantiene
 *   viva la conexión a través de nginx.
 * - `POST ?op=entrada` cuerpo crudo: lo tecleado. `POST ?op=tamano { filas, columnas }`.
 * - `DELETE` cierra la terminal (SIGHUP a la shell).
 *
 * Por qué SSE y no WebSocket: las rutas de Next no hacen WebSocket y así la autorización es la
 * misma cookie y `conMantenedor` de todo el panel, sin un segundo canal que proteger.
 * La terminal es de quien la abrió: el agente compara el correo de la sesión.
 */
import {
  conMantenedor,
  respuestaJson,
} from "../../../../../lib/minecraft-admin.mjs";
import {
  errorDeConexion,
  pedirAlAgente,
  rechazoSinCabeceraDelPanel,
  respuestaDelAgente,
} from "../../../../../lib/minecraft-agente.mjs";
import { anotarAuditoria } from "../../../../../lib/minecraft-consola.mjs";

export const dynamic = "force-dynamic";

const ID_VALIDO = /^[\w-]{8,40}$/;
const LATIDO_MS = 15_000;

async function idDe(contexto) {
  const { id } = await contexto.params;
  return ID_VALIDO.test(String(id)) ? String(id) : null;
}

export async function GET(request, contexto) {
  return conMantenedor(request, async (acceso) => {
    const id = await idDe(contexto);
    if (!id) {return respuestaJson({ error: "terminal_no_existe" }, 404);}
    const control = new AbortController();
    let r;
    try {
      r = await pedirAlAgente({
        ruta: `/term/${id}/salida`,
        quien: acceso.sesion.email,
        senal: control.signal,
      });
    } catch (e) {
      const fallo = errorDeConexion(e);
      return respuestaJson(fallo.cuerpo, fallo.status);
    }
    if (r.status !== 200) {
      r.flujo.resume();
      return respuestaJson({ error: "terminal_no_existe" }, r.status);
    }
    const codificador = new TextEncoder();
    let latido;
    const flujo = new ReadableStream({
      start(controlador) {
        const enviar = (texto) => {
          try {
            controlador.enqueue(codificador.encode(texto));
          } catch {
            /* el navegador ya se fue */
          }
        };
        enviar(": abierta\n\n");
        latido = setInterval(() => enviar(": latido\n\n"), LATIDO_MS);
        r.flujo.on("data", (trozo) => enviar(`data: ${trozo.toString("base64")}\n\n`));
        r.flujo.on("end", () => {
          clearInterval(latido);
          enviar("event: fin\ndata: \n\n");
          try {
            controlador.close();
          } catch {
            /* ya cerrado */
          }
        });
        r.flujo.on("error", () => {
          clearInterval(latido);
          try {
            controlador.close();
          } catch {
            /* ya cerrado */
          }
        });
        request.signal?.addEventListener("abort", () => {
          clearInterval(latido);
          control.abort();
        });
      },
      cancel() {
        clearInterval(latido);
        control.abort();
      },
    });
    return new Response(flujo, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      },
    });
  });
}

export async function POST(request, contexto) {
  return conMantenedor(request, async (acceso) => {
    const sinCabecera = rechazoSinCabeceraDelPanel(request);
    if (sinCabecera) {return sinCabecera;}
    const id = await idDe(contexto);
    if (!id) {return respuestaJson({ error: "terminal_no_existe" }, 404);}
    const op = new URL(request.url).searchParams.get("op");
    if (op === "entrada") {
      const datos = Buffer.from(await request.arrayBuffer());
      if (datos.length > 64 * 1024) {
        return respuestaJson({ error: "demasiado_grande" }, 413);
      }
      const r = await respuestaDelAgente({
        metodo: "POST",
        ruta: `/term/${id}/entrada`,
        cuerpo: datos,
        quien: acceso.sesion.email,
      });
      return respuestaJson(r.cuerpo, r.status);
    }
    if (op === "tamano") {
      const cuerpo = await request.json().catch(() => ({}));
      const r = await respuestaDelAgente({
        metodo: "POST",
        ruta: `/term/${id}/tamano`,
        cuerpo: JSON.stringify({ filas: cuerpo?.filas, columnas: cuerpo?.columnas }),
        cabeceras: { "content-type": "application/json" },
        quien: acceso.sesion.email,
      });
      return respuestaJson(r.cuerpo, r.status);
    }
    return respuestaJson({ error: "operacion_invalida" }, 400);
  });
}

export async function DELETE(request, contexto) {
  return conMantenedor(request, async (acceso) => {
    const sinCabecera = rechazoSinCabeceraDelPanel(request);
    if (sinCabecera) {return sinCabecera;}
    const id = await idDe(contexto);
    if (!id) {return respuestaJson({ error: "terminal_no_existe" }, 404);}
    const r = await respuestaDelAgente({
      metodo: "DELETE",
      ruta: `/term/${id}`,
      quien: acceso.sesion.email,
    });
    await anotarAuditoria({
      quien: acceso.sesion.email,
      rol: acceso.sesion.role,
      tipo: "terminal-cerrada",
      detalle: id,
      ok: r.status === 200,
    });
    return respuestaJson(r.cuerpo, r.status);
  });
}
