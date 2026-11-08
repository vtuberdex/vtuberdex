/**
 * `/api/minecraft-admin/archivos` — explorador de archivos del servidor.
 *
 * `GET` sin `ruta` lista lo editable (raíz permitida + todo lo de texto bajo `plugins/`);
 * `GET ?ruta=` devuelve el texto; `PUT { ruta, contenido }` valida y guarda con copia `.bak`.
 * El rol se comprueba en cada método. Las reglas de qué se puede abrir viven en
 * `lib/minecraft-archivos.mjs`; cada guardado se anota en la auditoría.
 */
import {
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import {
  guardarArchivo,
  leerArchivo,
  listarArchivos,
} from "../../../../lib/minecraft-archivos.mjs";
import { anotarAuditoria } from "../../../../lib/minecraft-consola.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(request, async (acceso) => {
    const ruta = new URL(request.url).searchParams.get("ruta");
    if (!ruta) {
      return respuestaJson(await listarArchivos({ rol: acceso.sesion.role }));
    }
    const resultado = await leerArchivo({ ruta, rol: acceso.sesion.role });
    if (!resultado.ok) return respuestaJson(resultado.cuerpo, resultado.status);
    return respuestaJson(resultado);
  });
}

export async function PUT(request) {
  return conMantenedor(request, async (acceso) => {
    const cuerpo = await request.json().catch(() => null);
    if (!cuerpo || typeof cuerpo !== "object") {
      return respuestaJson({ error: "cuerpo_invalido" }, 400);
    }
    const resultado = await guardarArchivo({
      ruta: cuerpo.ruta,
      contenido: cuerpo.contenido,
      rol: acceso.sesion.role,
    });
    await anotarAuditoria({
      quien: acceso.sesion.email,
      rol: acceso.sesion.role,
      tipo: "archivo-guardado",
      detalle: String(cuerpo.ruta ?? ""),
      ok: resultado.ok,
    });
    if (!resultado.ok) return respuestaJson(resultado.cuerpo, resultado.status);
    return respuestaJson({
      ok: true,
      ruta: resultado.ruta,
      bytes: resultado.bytes,
    });
  });
}
