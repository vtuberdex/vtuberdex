/**
 * `GET /api/minecraft-admin/registros?plugin=Nombre&lineas=200` — cola del registro del servidor
 * (`logs/latest.log`), opcionalmente solo las líneas de un plugin. Solo lectura; las IP se ocultan.
 */
import {
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import { leerRegistro } from "../../../../lib/minecraft-plugins.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(request, async () => {
    const url = new URL(request.url);
    const r = await leerRegistro({
      plugin: url.searchParams.get("plugin") ?? undefined,
      lineas: url.searchParams.get("lineas") ?? undefined,
    });
    if (!r.ok) return respuestaJson(r.cuerpo, r.status);
    return respuestaJson(r);
  });
}
