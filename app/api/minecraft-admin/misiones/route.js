// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `/api/minecraft-admin/misiones` — edición de las misiones desde el panel (todas: secundarias y de grado).
 *
 * `GET` lista TODAS las misiones con los ajustes aplicados (también las desactivadas), los contadores disponibles y los límites.
 * `POST { accion: 'guardar', id, cambios }` cambia campos de una misión del catálogo o crea una propia (id nuevo);
 * `POST { accion: 'restablecer', id }` devuelve la de catálogo a su valor original o elimina la propia.
 * SOLO admin: las metas y la XP mueven el nivel de toda la comunidad y los grados que se ganan jugando.
 */
import {
  ROL_ADMIN,
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import { ejecutorDeSolicitudes } from "../../../../lib/solicitudes.mjs";
import {
  CONTADORES,
  GRADO_MAXIMO_POR_MISIONES,
  META_MAX,
  XP_MISION_MAX,
  guardarMision,
  misionesTodas,
  restablecerMision,
} from "../../../../server/src/misiones.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(
    request,
    async () =>
      respuestaJson({
        misiones: await misionesTodas(await ejecutorDeSolicitudes()),
        contadores: CONTADORES,
        limites: {
          xpMax: XP_MISION_MAX,
          metaMax: META_MAX,
          gradoMax: GRADO_MAXIMO_POR_MISIONES,
        },
      }),
    { minimo: ROL_ADMIN },
  );
}

export async function POST(request) {
  return conMantenedor(
    request,
    async (acceso) => {
      const cuerpo = await request.json().catch(() => null);
      if (!cuerpo || typeof cuerpo !== "object") {
        return respuestaJson({ error: "cuerpo_invalido" }, 400);
      }
      const e = await ejecutorDeSolicitudes();
      if (cuerpo.accion === "guardar") {
        const r = await guardarMision(e, {
          id: cuerpo.id,
          cambios: cuerpo.cambios,
          actor: acceso.sesion.email,
        });
        return r.ok
          ? respuestaJson({ ok: true, mision: r.mision })
          : respuestaJson(r.cuerpo, r.status);
      }
      if (cuerpo.accion === "restablecer") {
        return (await restablecerMision(e, { id: cuerpo.id }))
          ? respuestaJson({ ok: true })
          : respuestaJson({ error: "sin_ajustes" }, 404);
      }
      return respuestaJson({ error: "accion_invalida" }, 400);
    },
    { minimo: ROL_ADMIN },
  );
}
