// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `POST /api/minecraft-admin/plugins/estado` `{ archivo, habilitado }` — habilita o deshabilita un
 * plugin renombrando su jar. Surte efecto al reiniciar el servidor. Los plugins de VTuberDex
 * están protegidos (403). Rol: admin o mantenedor autorizado.
 */
import {
  conMantenedor,
  respuestaJson,
} from "../../../../../lib/minecraft-admin.mjs";
import { cambiarEstadoPlugin } from "../../../../../lib/minecraft-plugins.mjs";
import { anotarAuditoria } from "../../../../../lib/minecraft-consola.mjs";

export const dynamic = "force-dynamic";

export async function POST(request) {
  return conMantenedor(request, async (acceso) => {
    const cuerpo = await request.json().catch(() => null);
    if (!cuerpo || typeof cuerpo !== "object") {
      return respuestaJson({ error: "cuerpo_invalido" }, 400);
    }
    const r = await cambiarEstadoPlugin({
      archivo: cuerpo.archivo,
      habilitado: cuerpo.habilitado,
    });
    // Habilitar un jar es instalar código: queda en la auditoría como la subida.
    await anotarAuditoria({
      quien: acceso.sesion.email,
      rol: acceso.sesion.role,
      tipo: cuerpo.habilitado ? "plugin-habilitado" : "plugin-deshabilitado",
      detalle: String(cuerpo.archivo ?? ""),
      ok: r.ok,
    });
    if (!r.ok) {
      return respuestaJson(r.cuerpo, r.status);
    }
    return respuestaJson({
      ok: true,
      archivo: r.archivo,
      requiereReinicio: true,
    });
  });
}
