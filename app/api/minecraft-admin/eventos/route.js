// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `/api/minecraft-admin/eventos` — eventos globales de XP y regalos de XP a todas las fichas vinculadas.
 *
 * `GET` lista los eventos (con su estado y la XP de bono pagada) y los últimos regalos.
 * `POST { accion: 'crear', nombre, multiplicador, inicio, fin }` crea un evento;
 * `POST { accion: 'cancelar', id }` lo cancela (lo ya pagado se queda);
 * `POST { accion: 'regalar', cantidad, motivo }` suma XP a TODAS las fichas con cuenta vinculada, una vez.
 * SOLO admin: cambia el nivel de toda la comunidad. Todo queda con su autor y su motivo.
 */
import {
  ROL_ADMIN,
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import { ejecutorDeSolicitudes } from "../../../../lib/solicitudes.mjs";
import {
  EVENTO_DURACION_MAX_DIAS,
  MULTIPLICADOR_EVENTO_MAX,
  cancelarEvento,
  crearEvento,
  listarEventos,
  listarRegalos,
  regalarXpATodas,
} from "../../../../server/src/eventos-xp.mjs";
import { XP_MANUAL_MAX } from "../../../../server/src/minecraft.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(
    request,
    async () => {
      const e = await ejecutorDeSolicitudes();
      return respuestaJson({
        eventos: await listarEventos(e),
        regalos: await listarRegalos(e),
        limites: {
          multiplicadorMax: MULTIPLICADOR_EVENTO_MAX,
          duracionMaxDias: EVENTO_DURACION_MAX_DIAS,
          regaloMax: XP_MANUAL_MAX,
        },
      });
    },
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
      const actor = acceso.sesion.email;
      if (cuerpo.accion === "crear") {
        const r = await crearEvento(e, { ...cuerpo, actor });
        return r.ok
          ? respuestaJson({ ok: true, id: r.id }, 201)
          : respuestaJson(r.cuerpo, r.status);
      }
      if (cuerpo.accion === "cancelar") {
        const hecho = await cancelarEvento(e, { id: cuerpo.id });
        return hecho
          ? respuestaJson({ ok: true })
          : respuestaJson({ error: "no_encontrado" }, 404);
      }
      if (cuerpo.accion === "regalar") {
        const r = await regalarXpATodas(e, { ...cuerpo, actor });
        return r.ok
          ? respuestaJson({ ok: true, id: r.id, fichas: r.fichas }, 201)
          : respuestaJson(r.cuerpo, r.status);
      }
      return respuestaJson({ error: "accion_invalida" }, 400);
    },
    { minimo: ROL_ADMIN },
  );
}
