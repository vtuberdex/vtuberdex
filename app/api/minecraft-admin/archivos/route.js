/**
 * `/api/minecraft-admin/archivos` — explorador de archivos del servidor.
 *
 * `GET ?carpeta=` lista UNA carpeta (subcarpetas, archivos editables y si admite escritura);
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
  listarCarpeta,
} from "../../../../lib/minecraft-archivos.mjs";
import { anotarAuditoria } from "../../../../lib/minecraft-consola.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(request, async (acceso) => {
    const params = new URL(request.url).searchParams;
    const ruta = params.get("ruta");
    // Sin `ruta` es navegar: `?carpeta=plugins/MythicMobs` abre esa carpeta y sin `carpeta`
    // se abre la raíz (archivos de Paper/Bukkit/Spigot y las carpetas navegables).
    if (!ruta) {
      const resultado = await listarCarpeta({
        ruta: params.get("carpeta"),
        rol: acceso.sesion.role,
      });
      if (!resultado.ok) {
        return respuestaJson(resultado.cuerpo, resultado.status);
      }
      return respuestaJson(resultado);
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
