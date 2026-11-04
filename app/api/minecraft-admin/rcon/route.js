/**
 * `/api/minecraft-admin/rcon` — ejecuta una ACCIÓN sobre el servidor por RCON.
 *
 * `POST { accion, jugador?, motivo?, mensaje? }` → `{ ok, accion, respuesta }`. No existe un
 * campo `comando`: el navegador elige una acción de la lista cerrada de `lib/minecraft-rcon.mjs`
 * y el servidor arma el comando. El rol se comprueba aquí y por acción (vetar es solo de admin).
 */
import {
  autorizar,
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import {
  ejecutarAccion,
  prepararAccion,
} from "../../../../lib/minecraft-rcon.mjs";

export const dynamic = "force-dynamic";

export async function POST(request) {
  return conMantenedor(request, async (acceso) => {
    const cuerpo = await request.json().catch(() => null);
    if (!cuerpo || typeof cuerpo !== "object") {
      return respuestaJson({ error: "cuerpo_invalido" }, 400);
    }
    const preparada = prepararAccion(cuerpo.accion, cuerpo);
    if (!preparada.ok) return respuestaJson(preparada.cuerpo, preparada.status);
    const permiso = autorizar(acceso.sesion, preparada.minimo);
    if (!permiso.ok) return respuestaJson(permiso.cuerpo, permiso.status);

    const resultado = await ejecutarAccion(cuerpo.accion, cuerpo);
    if (!resultado.ok) return respuestaJson(resultado.cuerpo, resultado.status);
    return respuestaJson({
      ok: true,
      accion: resultado.accion,
      respuesta: resultado.respuesta,
    });
  });
}
