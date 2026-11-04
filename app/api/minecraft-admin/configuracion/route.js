/**
 * `/api/minecraft-admin/configuracion` — lee y guarda la configuración.
 *
 * `GET ?tipo=servidor|plugin&archivo=x.yml` devuelve el texto; `PUT { tipo, archivo, contenido }`
 * lo valida (server.properties línea a línea, yml sin tabuladores) y lo escribe. El rol se
 * comprueba en cada método, no solo en la página.
 */
import {
  conMantenedor,
  guardarConfiguracion,
  leerConfiguracion,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(request, async () => {
    const url = new URL(request.url);
    const resultado = await leerConfiguracion({
      tipo: url.searchParams.get("tipo") ?? "servidor",
      archivo: url.searchParams.get("archivo") ?? undefined,
    });
    if (!resultado.ok) return respuestaJson(resultado.cuerpo, resultado.status);
    return respuestaJson(resultado);
  });
}

export async function PUT(request) {
  return conMantenedor(request, async () => {
    const cuerpo = await request.json().catch(() => null);
    if (!cuerpo || typeof cuerpo !== "object") {
      return respuestaJson({ error: "cuerpo_invalido" }, 400);
    }
    const resultado = await guardarConfiguracion({
      tipo: cuerpo.tipo,
      archivo: cuerpo.archivo,
      contenido: cuerpo.contenido,
    });
    if (!resultado.ok) return respuestaJson(resultado.cuerpo, resultado.status);
    return respuestaJson({ ok: true, ruta: resultado.ruta });
  });
}
