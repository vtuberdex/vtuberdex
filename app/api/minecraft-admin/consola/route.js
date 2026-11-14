// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `/api/minecraft-admin/consola` — comando por RCON.
 *
 * `POST { comando }` → `{ ok, comando, respuesta }`. Admin: cualquier comando de una línea.
 * Mantenedor: solo los prefijos de `PREFIJOS_MANTENEDOR` (lista blanca). `GET` (solo admin)
 * devuelve los últimos eventos de la auditoría. Ver `lib/minecraft-consola.mjs`.
 */
import {
  ROL_ADMIN,
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import {
  ejecutarComando,
  leerAuditoria,
} from "../../../../lib/minecraft-consola.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(
    request,
    async () => respuestaJson({ eventos: await leerAuditoria() }),
    { minimo: ROL_ADMIN },
  );
}

export async function POST(request) {
  return conMantenedor(request, async (acceso) => {
    const cuerpo = await request.json().catch(() => null);
    if (!cuerpo || typeof cuerpo !== "object") {
      return respuestaJson({ error: "cuerpo_invalido" }, 400);
    }
    const resultado = await ejecutarComando({
      comando: cuerpo.comando,
      sesion: acceso.sesion,
    });
    if (!resultado.ok) {
      return respuestaJson(resultado.cuerpo, resultado.status);
    }
    return respuestaJson({
      ok: true,
      comando: resultado.comando,
      respuesta: resultado.respuesta,
    });
  });
}
